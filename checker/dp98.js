/* ===================================================================
 * checker / 固件运行逻辑层 — 对齐 MCU 源码 CBE_RESONATE_MASTER。
 * MCU 固件改动只需同步本目录。全局作用域(经典 <script>)，无 import/export。
 * 来源：固件 get_djxt_data / djxt_tranfer_data（app_wifi.c / dev_wifi_tranfer.c）
 * =================================================================== */

/* ---------- DP98 command_receive：实际工况解析 / 编号匹配 ---------- */

function _rawToBytes(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Uint8Array) return raw;
  if (typeof ArrayBuffer !== "undefined" && raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(raw) && raw.BYTES_PER_ELEMENT === 1) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  if (Array.isArray(raw)) return Uint8Array.from(raw.map((x) => Number(x) & 0xff));
  if (typeof raw === "object") {
    if (raw.data != null) return _rawToBytes(raw.data);
    if (raw.value != null) return _rawToBytes(raw.value);
    if (raw.dpValue != null) return _rawToBytes(raw.dpValue);
  }
  const s = String(raw).trim().replace(/^"|"$/g, "");
  if (!s) return null;

  const fromB64 = (text) => {
    try {
      const bin = atob(text);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (_) {
      return null;
    }
  };
  const looksDp98 = (out) => {
    if (!out || out.length < 6) return false;
    for (let i = 0; i + 1 < out.length; i++) {
      if (out[i] === 0x03 && out[i + 1] === 0x01) return true;
      if (i + 3 < out.length && out[i] === 0x01 && out[i + 1] === 0x01 && out[i + 2] === 0x80) {
        return true;
      }
    }
    return false;
  };

  // 云端影子 DP98 几乎总是 base64（如 AQMBAQ…）
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && /[A-Za-z]/.test(s)) {
    const compact = s.replace(/\s+/g, "");
    const pad = compact + "=".repeat((4 - (compact.length % 4)) % 4);
    const out = fromB64(pad);
    if (looksDp98(out)) return out;
  }

  const hex = s.replace(/[\s,]/g, "");
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    if (looksDp98(out) || out.length >= 8) return out;
  }

  const loose = fromB64(s.replace(/\s+/g, ""));
  return looksDp98(loose) ? loose : loose;
}

function _asI16(u16) {
  const n = Number(u16) & 0xffff;
  return n > 32767 ? n - 65536 : n;
}

/**
 * 定位 03 01 功能头，并解析其前缀。
 * 现行 MCU（djxt_tranfer_data）：[fnlFlag][u8SocTest][iwGridPower BE][03][01]
 * 旧固件：[fnlFlag][03][01]；也允许裸 03 01。
 * @returns {{ i: number, fnlFlag: number|null, socTest: number|null, gridPowerW: number|null }}
 */
function _parseDp98Prefix(bytes) {
  let regStart = -1;
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 0x01 && bytes[i + 1] === 0x01 && bytes[i + 2] === 0x80) {
      regStart = i;
      break;
    }
  }
  let hdrEnd = 0;
  if (regStart >= 2 && bytes[regStart - 2] === 0x03 && bytes[regStart - 1] === 0x01) {
    hdrEnd = regStart;
  } else {
    for (let j = 0; j + 1 < Math.min(bytes.length, 8); j++) {
      if (bytes[j] === 0x03 && bytes[j + 1] === 0x01) {
        hdrEnd = j + 2;
        break;
      }
    }
  }
  const prefixLen = Math.max(0, hdrEnd - 2);
  let fnlFlag = null;
  let socTest = null;
  let gridPowerW = null;
  if (prefixLen >= 4) {
    fnlFlag = bytes[0];
    socTest = bytes[1];
    gridPowerW = _asI16((bytes[2] << 8) | bytes[3]);
  } else if (prefixLen >= 1) {
    fnlFlag = bytes[0];
  }
  return { i: hdrEnd, fnlFlag, socTest, gridPowerW };
}

/**
 * 解析 DP98 / command_receive raw。
 * 现行头：[fnlFlag u8][簇SOC u8][电网目标 int16 BE][03 01]
 * 体：重复(01 01 addr_be val_be)；地址自 0x8000 起每台 7 个寄存器。
 * @returns {{ fnlFlag: number|null, socTest: number|null, gridPowerW: number|null, units: Array<object> }|null}
 */
function parseDp98CommandReceive(raw) {
  const bytes = _rawToBytes(raw);
  if (!bytes || bytes.length < 6) return null;
  const prefix = _parseDp98Prefix(bytes);
  let i = prefix.i;
  const fnlFlag = prefix.fnlFlag;
  const socTest = prefix.socTest;
  const gridPowerW = prefix.gridPowerW;
  const byAddr = new Map();
  while (i + 5 < bytes.length) {
    if (bytes[i] === 0x01 && bytes[i + 1] === 0x01) {
      const addr = ((bytes[i + 2] << 8) | bytes[i + 3]) & 0xffff;
      const val = ((bytes[i + 4] << 8) | bytes[i + 5]) & 0xffff;
      byAddr.set(addr, val);
      i += 6;
      continue;
    }
    i += 1;
  }
  if (!byAddr.size) return null;
  const bucket = new Map();
  for (const [addr, val] of byAddr) {
    if (addr < 0x8000) continue;
    const off = addr - 0x8000;
    const idx = Math.floor(off / 7);
    const field = off % 7;
    if (!bucket.has(idx)) bucket.set(idx, {});
    bucket.get(idx)[`f${field}`] = val;
  }
  const units = [...bucket.keys()]
    .sort((a, b) => a - b)
    .map((idx) => {
      const u = bucket.get(idx) || {};
      const model = Number(u.f1 || 0) & 0xff;
      return {
        numer: Number(u.f0 || 0) & 0xff,
        workModel: model,
        label: OWNER_WORK_MODEL_CN[model] || `0x${model.toString(16)}`,
        chgCapW: Math.max(0, _asI16(u.f2 || 0)),
        dchgCapW: Math.max(0, _asI16(u.f3 || 0)),
        pvW: Math.max(0, Number(u.f4 || 0) & 0xffff),
        cmdPowerW: Math.max(0, Number(u.f5 || 0) & 0xffff),
        order: Number(u.f6 || 0) & 0xff,
      };
    });
  return { fnlFlag, socTest, gridPowerW, units };
}

function dp98UnitToActual(unit, extra = {}) {
  if (!unit) return null;
  return {
    model: unit.workModel,
    label: unit.label,
    chgCapW: unit.chgCapW,
    dchgCapW: unit.dchgCapW,
    pvW: unit.pvW,
    cmdPowerW: unit.cmdPowerW,
    order: unit.order,
    numer: unit.numer,
    fnlFlag: extra.fnlFlag != null ? extra.fnlFlag : null,
    socTest: extra.socTest != null ? extra.socTest : null,
    gridPowerW: extra.gridPowerW != null ? extra.gridPowerW : null,
    source: extra.source || "dp98",
    fromMaster: !!extra.fromMaster,
  };
}

/**
 * 从本机 DP98 报文里挑本机那一组。
 * 主机报文含全员：取 numer=0x0A；从机/单机自报文通常只有一组（numer=1）。
 * 不做 numer→deviceId 猜测（MCU 顺序拿不到，不能用字典序）。
 */
function pickOwnDp98Unit(device, parsed) {
  if (!parsed?.units?.length) return null;
  const role = Number(device?.values?.device_cluster_role);
  if (role === 0) {
    return (
      parsed.units.find((u) => u.numer === DP98_MASTER_NUMER) ||
      parsed.units[parsed.units.length - 1] ||
      parsed.units[0]
    );
  }
  return (
    parsed.units.find((u) => u.numer === 1) ||
    parsed.units.find((u) => u.numer === DP98_MASTER_NUMER) ||
    parsed.units[0]
  );
}

/**
 * 各机读各自 DP98 / command_receive 打实际状态；主机从本机全量报文里取 0x0A 槽。
 */
function applyDp98ActualForHome(home) {
  if (!home) return;
  home.dp98Header = null;
  const devices = home.devices || [];
  let masterHeader = null;
  let anyHeader = null;
  for (const d of devices) {
    d.ownerActual = null;
    const parsed = parseDp98CommandReceive(d.values?.command_receive);
    if (parsed && (parsed.fnlFlag != null || parsed.socTest != null || parsed.gridPowerW != null)) {
      const hdr = {
        fnlFlag: parsed.fnlFlag,
        socTest: parsed.socTest,
        gridPowerW: parsed.gridPowerW,
      };
      if (!anyHeader) anyHeader = hdr;
      if (Number(d.values?.device_cluster_role) === 0) masterHeader = hdr;
    }
    const unit = pickOwnDp98Unit(d, parsed);
    if (!unit) continue;
    const isMaster = Number(d.values?.device_cluster_role) === 0;
    d.ownerActual = dp98UnitToActual(unit, {
      fromMaster: false,
      source: isMaster ? "dp98-master-self" : "dp98-self",
      fnlFlag: parsed.fnlFlag,
      socTest: parsed.socTest,
      gridPowerW: parsed.gridPowerW,
    });
  }
  home.dp98Header = masterHeader || anyHeader;
  const hdr = home.dp98Header || {};
  for (const d of devices) {
    const a = d.ownerActual;
    if (!a) continue;
    if (a.fnlFlag == null && hdr.fnlFlag != null) a.fnlFlag = hdr.fnlFlag;
    if (a.socTest == null && hdr.socTest != null) a.socTest = hdr.socTest;
    if (a.gridPowerW == null && hdr.gridPowerW != null) a.gridPowerW = hdr.gridPowerW;
  }
}
