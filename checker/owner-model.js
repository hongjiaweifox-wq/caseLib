/* ===================================================================
 * checker / 固件运行逻辑层 — 对齐 groupAppControl/static/app.js classifyOwnerWorkModel。
 * MCU 固件改动只需同步本目录。全局作用域(经典 <script>)，无 import/export。
 * =================================================================== */

/**
 * 一体机上报给主机的 grid 口充放策略（对齐飞书《从机状态判》/ owner_infomation_package）。
 * @see https://icn602w9tnqf.feishu.cn/wiki/BxNGwzYxRiDDXmkijy0cje8Znjc
 */
const OWNER_WORK_MODEL = {
  FORCE_CHARGE: 0x01, // 充电状态2
  FORCE_DISCHARGE: 0x02, // 放电（防弃光）
  BIDIRECTIONAL: 0x03, // 可充可放
  CHARGE_ONLY: 0x04, // 可充
  DISCHARGE_ONLY: 0x05, // 可放
  DISABLED: 0x06, // 禁充禁放
  LOAD_FORCE_CHARGE: 0x21, // 充电状态1
};

const OWNER_WORK_MODEL_CN = {
  [OWNER_WORK_MODEL.FORCE_CHARGE]: "充电状态2",
  [OWNER_WORK_MODEL.FORCE_DISCHARGE]: "放电",
  [OWNER_WORK_MODEL.BIDIRECTIONAL]: "可充可放",
  [OWNER_WORK_MODEL.CHARGE_ONLY]: "可充",
  [OWNER_WORK_MODEL.DISCHARGE_ONLY]: "可放",
  [OWNER_WORK_MODEL.DISABLED]: "禁充禁放",
  [OWNER_WORK_MODEL.LOAD_FORCE_CHARGE]: "充电状态1",
};

function _ownerNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 功率限制 DP：0 是有效值，不能用 `|| fallback` 吞掉。多个 DP 取更小值。 */
function _ownerPickLim(v, keys, fallback) {
  let found = null;
  for (const k of keys) {
    if (v[k] == null || v[k] === "") {
      continue;
    }
    const n = Number(v[k]);
    if (!Number.isFinite(n)) {
      continue;
    }
    found = found == null ? n : Math.min(found, n);
  }
  return found == null ? fallback : found;
}

function _ownerFault(raw) {
  if (raw == null || raw === "" || raw === 0 || raw === "0") return false;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (Array.isArray(raw)) return raw.some(Boolean);
  if (typeof raw === "object") return Object.values(raw).some((x) => !!x && x !== "0" && x !== 0);
  const s = String(raw);
  if (!s || s === "0" || s === "[]" || s === "{}") return false;
  return /inverter_failure|grid_failure|inverter_output_fault|inverter_other_fault|system_/.test(s) || s !== "0";
}

/** DP20 `pv_power_total` only. */
function _ownerPvW(device) {
  const v = device?.values || {};
  return Math.max(0, _ownerNum(v.pv_power_total, 0));
}

/** DP38 `offgrid1_export_power`（影子可能记在 battery_charging_power_grid）。 */
function _ownerBypassW(device) {
  const v = device?.values || {};
  return _ownerNum(v.offgrid1_export_power ?? v.battery_charging_power_grid, 0);
}

/** app_inverter.c stChgMap：[socL, socH, tL°C, tH°C, curr]。SoC∈[L,H]，温∈(tL,tH]。 */
const OWNER_CHG_MAP = [
  [0, 100, -50, 0, 0],
  [0, 65, 0, 5, 25], [66, 75, 0, 5, 15], [76, 85, 0, 5, 10], [86, 95, 0, 5, 8], [96, 100, 0, 5, 4],
  [0, 45, 5, 10, 40], [46, 75, 5, 10, 25], [76, 85, 5, 10, 15], [86, 95, 5, 10, 10], [96, 100, 5, 10, 8],
  [0, 70, 10, 15, 50], [71, 80, 10, 15, 40], [81, 95, 10, 15, 25], [96, 98, 10, 15, 10], [99, 100, 10, 15, 8],
  [0, 90, 15, 20, 50], [91, 95, 15, 20, 40], [96, 98, 15, 20, 25], [99, 100, 15, 20, 10],
  [0, 90, 20, 45, 50], [91, 95, 20, 45, 40], [96, 98, 20, 45, 30], [99, 100, 20, 45, 20],
  [0, 80, 45, 50, 40], [81, 90, 45, 50, 25], [91, 95, 45, 50, 15], [96, 100, 45, 50, 10],
  [0, 50, 50, 55, 30], [51, 80, 50, 55, 25], [81, 95, 50, 55, 15], [96, 100, 50, 55, 10],
  [0, 50, 55, 60, 30], [51, 80, 55, 60, 25], [81, 90, 55, 60, 15], [91, 100, 55, 60, 10],
  [0, 100, 60, 65, 0],
];
const OWNER_BAT_CHG_CAP_W = 3000;
const OWNER_CHG_DEFAULT_TEMP_C = 25;

function _ownerPickTempC(v, keys) {
  for (const k of keys) {
    if (v[k] != null && v[k] !== "") {
      const n = Number(v[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function _ownerCellTempC(device) {
  const v = device?.values || {};
  const tMin = _ownerPickTempC(v, ["min_cell_temp", "cell_temp_min", "pack_temp_min", "battery_min_temp"]);
  const tMax = _ownerPickTempC(v, ["max_cell_temp", "cell_temp_max", "pack_temp_max", "battery_max_temp"]);
  const tOne = _ownerPickTempC(v, ["battery_temp", "bms_temp", "pack_temp", "cell_temp"]);
  const assumed = tMin == null && tMax == null && tOne == null;
  return {
    minC: tMin != null ? tMin : tOne != null ? tOne : OWNER_CHG_DEFAULT_TEMP_C,
    maxC: tMax != null ? tMax : tOne != null ? tOne : OWNER_CHG_DEFAULT_TEMP_C,
    assumed,
  };
}

/** chgCurr_refer_function：SoC≥100 或 T<0 或 T>60 → 0。 */
function _ownerChgCurr(soc, tempC) {
  if (soc >= 100 || tempC < 0 || tempC > 60) return 0;
  for (let i = 0; i < OWNER_CHG_MAP.length; i++) {
    const row = OWNER_CHG_MAP[i];
    if (soc >= row[0] && soc <= row[1] && tempC > row[2] && tempC <= row[3]) return row[4];
  }
  return 0;
}

/** (Chuneng_chg_map()*1080*6)/100，再与 3000 取小。 */
function _ownerMapChgW(soc, device) {
  const temps = _ownerCellTempC(device);
  const curr = Math.min(_ownerChgCurr(soc, temps.minC), _ownerChgCurr(soc, temps.maxC));
  const mapW = Math.floor((curr * 1080 * 6) / 100);
  return { mapW, capW: Math.min(OWNER_BAT_CHG_CAP_W, mapW), curr, temps };
}

/**
 * @returns {{ model: number, label: string, chgCapW: number, dchgCapW: number, reason: string, formula: string, inputs: object }|null}
 */
function classifyOwnerWorkModel(device) {
  if (!device) return null;
  const v = device.values || {};
  const hasLive =
    v.current_soc != null ||
    v.main_soc != null ||
    v.pv_power_total != null ||
    v.grid_port_power != null ||
    v.grid_power != null ||
    v.inverter_output_power != null ||
    v.battery_charging_power_grid != null ||
    v.offgrid1_export_power != null;
  if (!hasLive && !device.reportTime) return null;

  const modelMetaObj = typeof modelMeta === "function" ? modelMeta(device) : null;
  const invCap = modelMetaObj?.maxExport || 1500;
  const bypassCap = modelMetaObj?.bypassCap || (invCap >= 2500 ? 3000 : 1500);
  const modelBatChgCap = modelMetaObj?.batDcChgW || invCap;
  const modelBatDchgCap = modelMetaObj?.batDcDchgW || invCap;

  const soc = _ownerNum(v.current_soc ?? v.main_soc, NaN);
  const back = _ownerNum(v.backup_soc ?? v.backup_reserve, 20);
  const pv = _ownerPvW(device);
  const bypass = _ownerBypassW(device);
  const mapped = Number.isNaN(soc) ? { capW: 0, mapW: 0, curr: 0, temps: { minC: 25, maxC: 25, assumed: true } } : _ownerMapChgW(soc, device);
  let batChg = Math.min(mapped.capW, modelBatChgCap);
  const dpChg = _ownerPickLim(v, ["bat_max_chg_w", "battery_max_charge_power"], null);
  if (dpChg != null) {
    batChg = Math.min(batChg, Math.max(0, dpChg));
  }
  const batDchg = _ownerPickLim(v, ["bat_max_dchg_w", "battery_max_discharge_power"], modelBatDchgCap);
  const outLim = _ownerPickLim(v, ["output_power_limit"], invCap);
  const gridLim = _ownerPickLim(v, ["inverter_input_power_limit"], invCap);
  const exportLim = _ownerPickLim(v, ["regulation_grid_export_p_limit"], null);
  // 放电并网口上限：输出限制与法规输出限取更严者（法规限只影响可放功率，不单独构成禁充禁放）
  const dchgOutLim = exportLim == null ? outLim : Math.min(outLim, exportLim);
  const invLim = invCap;
  const pvVolt = _ownerNum(v.pv_volt_max ?? v.pv1_voltage, 0);
  const invFault = _ownerFault(v.fault) || _ownerFault(v.error_code);

  if (!device._ownerHyst) {
    // 刷新后 MCU 的 ubfullchgflag 还在；96–99% 按已满电处理，同会话从低 SoC 爬升则保持 false
    device._ownerHyst = {
      forceChg: false,
      forceChg1: false,
      forceChg2: false,
      fullChg: !Number.isNaN(soc) && soc > 95,
    };
  }
  const st = device._ownerHyst;
  // app_inverter.c：SoC==100 → uwbatChgpower=0，回落到 95% 才恢复
  if (soc >= 100) st.fullChg = true;
  else if (soc <= 95) st.fullChg = false;
  if (st.fullChg) batChg = 0;

  const inputs = {
    soc,
    back,
    pv,
    bypass,
    batChg,
    batDchg,
    outLim,
    gridLim,
    exportLim,
    dchgOutLim,
    invLim,
    bypassCap,
    pvVolt,
    invFault,
    fullChg: !!st.fullChg,
    chgMapCurr: mapped.curr,
    chgMapTempC: mapped.temps.assumed ? `${mapped.temps.minC}(默认)` : `${mapped.temps.minC}/${mapped.temps.maxC}`,
    modelBatChgCap,
    modelBatDchgCap,
  };

  const clamp = (chg, dchg) => {
    let c = Math.max(0, Math.round(chg));
    let d = Math.max(0, Math.round(dchg));
    if (c > gridLim) c = invLim < gridLim ? invLim : gridLim;
    if (d > dchgOutLim) d = invLim < dchgOutLim ? invLim : dchgOutLim;
    return [c, d];
  };
  const ret = (model, chg, dchg, reason, formula) => {
    const [c, d] = clamp(chg, dchg);
    return {
      model,
      label: OWNER_WORK_MODEL_CN[model] || `0x${model.toString(16)}`,
      chgCapW: c,
      dchgCapW: d,
      reason,
      formula,
      inputs,
    };
  };

  if (Number.isNaN(soc)) return null;

  if (invFault || (batChg === 0 && batDchg === 0)) {
    return ret(
      OWNER_WORK_MODEL.DISABLED,
      0,
      0,
      "故障或电池充放能力均为 0",
      `条件：故障码 ≠ 0  或  (电池最大充=${batChg} 且 最大放=${batDchg})\n` +
        `故障判定=${invFault}\n` +
        `说明：输入限制/输出限制=0 只会把上报充放功率截到 0，不会把工况改成 0x06\n` +
        `→ 禁充禁放，上报可充=0 / 可放=0`
    );
  }

  // 4 放电：PV−Bypass ≥ B充限 且 B充限>0
  if (pv - bypass >= batChg && batChg > 0) {
    let dchg = pv - bypass - batChg;
    if (soc >= back && batChg > 100) dchg += 100;
    return ret(
      OWNER_WORK_MODEL.FORCE_DISCHARGE,
      outLim,
      Math.max(0, dchg),
      "PV−Bypass ≥ 电池最大充",
      `判定条件：PV − Bypass ≥ 电池最大充电功率  且  电池最大充电功率 > 0\n` +
        `${pv} − ${bypass} = ${pv - bypass}  ≥  ${batChg}  ✓\n` +
        `可放功率 ≈ PV − Bypass − 电池最大充` +
        (soc >= back && batChg > 100 ? ` + 100（SoC≥备用）` : ``) +
        `\n= ${Math.max(0, Math.round(dchg))}W\n可充上报 = 输出限制 ${outLim}W`
    );
  }

  // 5 弱光 / bat_chg==0
  if (pv - bypass >= batChg) {
    if (pv < 50 && pvVolt >= 200) {
      const dchg = Math.max(0, 100 - bypass - batChg);
      return ret(
        OWNER_WORK_MODEL.FORCE_DISCHARGE,
        gridLim,
        dchg,
        "弱光：PV<50 且 PV电压≥200",
        `弱光分支：电池最大充=${batChg}，PV=${pv}<50 且 PV电压=${pvVolt}≥200\n→ 放电，可放≈${dchg}W`
      );
    }
    if (pvVolt >= 220) {
      let dchg = pv - bypass - batChg;
      if (dchg < 100) dchg = 100;
      return ret(
        OWNER_WORK_MODEL.FORCE_DISCHARGE,
        gridLim,
        dchg,
        "弱光：PV电压≥220",
        `弱光分支：PV电压=${pvVolt}≥220\n可放 = max(PV−Bypass−B充, 100) = ${dchg}W`
      );
    }
    return ret(
      OWNER_WORK_MODEL.DISCHARGE_ONLY,
      gridLim,
      outLim,
      "B充限=0 且未达弱光阈值 → 可放",
      `条件：PV−Bypass ≥ 电池最大充 且 最大充=0，PV电压未达弱光阈值\n` +
        `${pv}−${bypass}=${pv - bypass} ≥ ${batChg}，pvVolt=${pvVolt}\n→ 可放（可放能力=输出限制 ${outLim}W）`
    );
  }

  // 6 充电状态1：Bypass 过大
  if (bypass > batDchg + pv || bypass > bypassCap) {
    const need = batDchg + pv > bypassCap ? bypass - bypassCap : bypass - batDchg - pv;
    return ret(
      OWNER_WORK_MODEL.LOAD_FORCE_CHARGE,
      Math.max(0, need),
      gridLim,
      "Bypass 负载过大",
      `判定条件：Bypass > 电池最大放 + PV    或    Bypass > 逆变输出上限(${bypassCap}W)\n` +
        `${bypass} > ${batDchg} + ${pv} = ${batDchg + pv}  ?  ${bypass > batDchg + pv}\n` +
        `${bypass} > ${bypassCap}  ?  ${bypass > bypassCap}\n` +
        `可充缺口 ≈ ${Math.max(0, Math.round(need))}W（须从 grid 取电）`
    );
  }

  // 7 充电状态1：SoC ≤ 备用−10
  if (soc <= back - 10 || st.forceChg1) {
    st.forceChg1 = true;
    const chg = Math.max(0, batChg - pv + bypass);
    if (soc >= back - 5) st.forceChg1 = false;
    return ret(
      OWNER_WORK_MODEL.LOAD_FORCE_CHARGE,
      chg,
      0,
      "SoC ≤ 备用−10%",
      `判定条件：当前 SoC ≤ 备用 SoC − 10%（回差：回升到 备用−5% 才退出）\n` +
        `${soc} ≤ ${back} − 10 = ${back - 10}  ✓\n` +
        `可充 = max(0, 电池最大充 − PV + Bypass) = max(0, ${batChg} − ${pv} + ${bypass}) = ${chg}W`
    );
  }

  // 8 充电状态1：SoC ≤ 5
  if (soc <= 5 || st.forceChg2) {
    st.forceChg2 = true;
    const chg = Math.max(0, batChg - pv + bypass);
    if (soc >= 10) st.forceChg2 = false;
    return ret(
      OWNER_WORK_MODEL.LOAD_FORCE_CHARGE,
      chg,
      0,
      "SoC ≤ 5%",
      `判定条件：当前 SoC ≤ 5%（回差：回升到 10% 才退出）\n` +
        `${soc} ≤ 5  ✓\n` +
        `可充 = max(0, ${batChg} − ${pv} + ${bypass}) = ${chg}W`
    );
  }

  // 9 充电状态2
  if (st.forceChg || soc <= back - 5) {
    st.forceChg = true;
    const chg = Math.max(0, batChg + bypass - pv);
    if (soc >= back) st.forceChg = false;
    return ret(
      OWNER_WORK_MODEL.FORCE_CHARGE,
      chg,
      1000,
      "SoC ≤ 备用−5%",
      `判定条件：当前 SoC ≤ 备用 SoC − 5%（回差：回升到 备用 SoC 才退出）\n` +
        `${soc} ≤ ${back} − 5 = ${back - 5}  ✓\n` +
        `可充 = max(0, 电池最大充 + Bypass − PV) = max(0, ${batChg} + ${bypass} − ${pv}) = ${chg}W\n` +
        `可放上报写死 1000W（固件原样）`
    );
  }

  // 10 可放
  if (batChg === 0 && batDchg + pv - bypass > 0) {
    const dchg = batDchg + pv - bypass;
    return ret(
      OWNER_WORK_MODEL.DISCHARGE_ONLY,
      0,
      dchg,
      "仅可放",
      `判定条件：电池最大充 = 0  且  电池最大放 + PV − Bypass > 0\n` +
        `batChg=${batChg}，${batDchg} + ${pv} − ${bypass} = ${dchg} > 0\n→ 可放 ${dchg}W`
    );
  }

  // 11 可充
  if ((batDchg + pv - bypass <= 0 && batChg > 0) || soc <= back) {
    const condA = batDchg + pv - bypass <= 0 && batChg > 0;
    const condB = soc <= back;
    return ret(
      OWNER_WORK_MODEL.CHARGE_ONLY,
      gridLim,
      0,
      condB ? "当前 SoC ≤ 备用 SoC" : "放余量≤0 且可充",
      `判定条件（满足其一即可）：\n` +
        `① 电池最大放 + PV − Bypass ≤ 0  且  电池最大充 > 0\n` +
        `   ${batDchg} + ${pv} − ${bypass} = ${batDchg + pv - bypass} ≤ 0 ? ${batDchg + pv - bypass <= 0}；batChg=${batChg}\n` +
        `② 当前 SoC ≤ 备用 SoC\n` +
        `   ${soc} ≤ ${back} ? ${condB}\n` +
        `命中：${condA ? "①" : ""}${condA && condB ? " + " : ""}${condB ? "②" : ""}\n` +
        `→ 可充，上报可充能力 = 并网口充电限 ${gridLim}W，可放 = 0`
    );
  }

  // 12 可充可放
  if (back < soc && soc < 100) {
    return ret(
      OWNER_WORK_MODEL.BIDIRECTIONAL,
      gridLim,
      outLim,
      "备用 < SoC < 100%",
      `判定条件：备用 SoC < 当前 SoC < 100%\n` +
        `${back} < ${soc} < 100  ✓\n` +
        `→ 可充可放：可充=${gridLim}W，可放=${outLim}W`
    );
  }

  // 13 兜底
  return ret(
    OWNER_WORK_MODEL.DISABLED,
    gridLim,
    outLim,
    "兜底（含 SoC=100%）",
    `以上条件均未命中（常见：SoC=100%，文档注明 100%→95% 回差未实现）\n` +
      `SoC=${soc}，备用=${back}\n→ 禁充禁放（上报并网口限值：充${gridLim}/放${outLim}，非 0）`
  );
}
