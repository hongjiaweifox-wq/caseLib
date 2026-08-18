/* ===================================================================
 * checker / 固件运行逻辑层 — 对齐 MCU 源码 CBE_RESONATE_MASTER。
 * MCU 固件改动只需同步本目录。全局作用域(经典 <script>)，无 import/export。
 * 本文件由 app.js 原样迁出，逻辑一字未改。
 * 来源 app.js L372-664 ↔ 固件 owner_infomation_package (app_wifi.c)
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
  const bypassCap = invCap >= 2500 ? 3000 : 1500; // Lyra 1500 / CBE·Atlas 3000

  const soc = _ownerNum(v.current_soc ?? v.main_soc, NaN);
  const back = _ownerNum(v.backup_soc ?? v.backup_reserve, 20);
  const pv = Math.max(0, _ownerNum(v.pv_power_total, 0));
  const bypass = _ownerNum(v.offgrid1_export_power ?? v.battery_charging_power_grid, 0);
  const batChg = _ownerNum(v.bat_max_chg_w ?? v.battery_max_charge_power, invCap);
  const batDchg = _ownerNum(v.bat_max_dchg_w ?? v.battery_max_discharge_power, invCap);
  const outLim = _ownerNum(v.output_power_limit || v.regulation_grid_export_p_limit, invCap) || invCap;
  const gridLim = _ownerNum(v.inverter_input_power_limit, invCap) || invCap;
  const invLim = invCap;
  const pvVolt = _ownerNum(v.pv_volt_max ?? v.pv1_voltage, 0);
  const invFault = _ownerFault(v.fault) || _ownerFault(v.error_code);

  if (!device._ownerHyst) device._ownerHyst = { forceChg: false, forceChg1: false, forceChg2: false };
  const st = device._ownerHyst;

  const inputs = {
    soc,
    back,
    pv,
    bypass,
    batChg,
    batDchg,
    outLim,
    gridLim,
    invLim,
    bypassCap,
    pvVolt,
    invFault,
  };

  const clamp = (chg, dchg) => {
    let c = Math.max(0, Math.round(chg));
    let d = Math.max(0, Math.round(dchg));
    if (c > gridLim) c = invLim < gridLim ? invLim : gridLim;
    if (d > outLim) d = invLim < outLim ? invLim : outLim;
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
      "故障或电池充放限均为 0",
      `条件：故障码 ≠ 0  或  (电池最大充=${batChg} 且 最大放=${batDchg})\n` +
        `故障判定=${invFault}\n→ 禁充禁放，上报可充=0 / 可放=0`
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
