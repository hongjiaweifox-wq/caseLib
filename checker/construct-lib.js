/* ===================================================================
 * checker / 工况构造库
 * 统一维护：如何用可写 DP 把设备构造到目标工况。
 * 自动回归第三节、策略展开、组合用例推荐路径都读这里。
 * 可写 DP：work_mode / backup_soc / inverter_input_power_limit /
 *          output_power_limit / regulation_grid_export_p_limit
 * =================================================================== */

const AT_WRITABLE_DPS = [
  { dp: "work_mode", label: "工作模式" },
  { dp: "backup_soc", label: "备用SoC" },
  { dp: "inverter_input_power_limit", label: "AC输入限" },
  { dp: "output_power_limit", label: "AC输出限" },
  { dp: "regulation_grid_export_p_limit", label: "法规输出限" },
];

/** 实验室可调现场量（非云 DP，仅构造说明用） */
const AT_LAB_HAL_FIELDS = [
  { key: "pv_w", label: "PV" },
  { key: "bypass_w", label: "Bypass" },
  { key: "grid_load_w", label: "电网负载" },
];

const AT_LIMIT_DPS = [
  "inverter_input_power_limit",
  "output_power_limit",
  "regulation_grid_export_p_limit",
];

const AT_LIMIT_COVERAGE = {
  inverter_input_power_limit: "input_limit",
  output_power_limit: "output_limit",
  regulation_grid_export_p_limit: "regulation_limit",
};

/** 3 个限功率 DP 的全部子集：空集 + 7 种叠加，共 8 组。 */
function _atLimitOverlayCombos() {
  const combos = [[]];
  for (const dp of AT_LIMIT_DPS) {
    const next = [];
    for (const combo of combos) {
      next.push(combo);
      next.push([...combo, dp]);
    }
    combos.length = 0;
    combos.push(...next);
  }
  return combos;
}

const AT_LIMIT_OVERLAYS = _atLimitOverlayCombos();

/**
 * 工况构造库正文，顺序对齐 MCU classifyOwnerWorkModel if/else 首次命中：
 * 禁充禁放 → 放电 → 可放 → 充电状态1 → 充电状态2 → 可充 → 可充可放
 */
const SCENARIO_CONSTRUCT_LIB = [
  {
    key: "disabled",
    target: "禁充禁放",
    short: "禁充禁放",
    rule: "MCU 第一条：故障，或电池最大充=0 且最大放=0，或输出限与法规输出限均为 0",
    also: "",
    core: {
      type: "limit_zero",
      formula: "work_mode=0，AC输出限=0，法规输出限=0",
      need: "AC输出限与法规输出限可写 0",
      backupOf: null,
      coverageKey: "limit_zero",
    },
    cores: [
      {
        type: "limit_zero",
        formula: "work_mode=0，AC输出限=0，法规输出限=0",
        coverageKey: "limit_zero",
      },
    ],
    overlays: false,
    blocked: [
      { key: "fault", note: "故障码 ≠ 0 → 禁充禁放，故障码不可写" },
      { key: "bat-zero", note: "电池最大充=0 且最大放=0 依赖 BMS/温度/SoC/现场条件，页面无法直接构造" },
      { key: "fallback", note: "前面分支都未命中才兜底。满电不等于这一态，不靠改备用 SoC" },
    ],
  },
  {
    key: "discharge",
    target: "放电",
    short: "放电",
    rule: "PV − Bypass ≥ 电池最大充 且 电池最大充>0（含弱光分支）",
    also: "",
    core: {
      type: "hal_discharge",
      formula: "实验室：work_mode=0，调 PV/Bypass/家庭负载，使 PV−Bypass ≥ 电池最大充，且 batChg>0",
      coverageKey: "hal_discharge",
    },
    overlays: false,
    blocked: [
      { key: "bat-chg-positive", note: "需 batChg>0；若满电、禁充温区或电池告警导致 batChg=0，则这条放电路走不通" },
    ],
  },
  {
    key: "candis",
    target: "可放",
    short: "可放",
    rule: "电池最大充=0，且 电池最大放+PV−Bypass > 0",
    also: "",
    core: null,
    overlays: false,
    blocked: [
      { key: "bat-chg-zero", note: "需 bat_max_chg=0，页面无可写点" },
    ],
  },
  {
    key: "chg1",
    target: "充电状态1",
    short: "充电1",
    rule: "SoC ≤ 备用−10%（回差到备用−5%退出）",
    also: "前置分支还有 Bypass 过大、SoC≤5%；其中 Bypass 过大可在实验室通过调 PV/Bypass/负载构造",
    core: {
      type: "backup_soc",
      formula: "work_mode=0，backup_soc = SoC + 10",
      need: "SoC + 10 ≤ 100",
      backupOf: (soc) => soc + 10,
    },
    cores: [
      {
        type: "hal_chg1_bypass",
        formula: "实验室：work_mode=0，调 Bypass/家庭负载，使 Bypass > 电池最大放+PV 或 Bypass > 逆变上限",
        coverageKey: "hal_chg1_bypass",
      },
      {
        type: "backup_soc",
        formula: "work_mode=0，backup_soc = SoC + 10",
        need: "SoC + 10 ≤ 100",
        backupOf: (soc) => soc + 10,
      },
    ],
    overlays: true,
    blocked: [
      { key: "soc-le-5", note: "SoC ≤ 5%：无法直接改 SoC" },
    ],
  },
  {
    key: "chg2",
    target: "充电状态2",
    short: "充电2",
    rule: "SoC ≤ 备用−5%（回差到备用 SoC 退出）",
    also: "",
    core: {
      type: "backup_soc",
      formula: "work_mode=0，backup_soc = SoC + 5",
      need: "SoC + 5 ≤ 100",
      backupOf: (soc) => soc + 5,
    },
    overlays: true,
    blocked: [],
  },
  {
    key: "canchg",
    target: "可充",
    short: "可充",
    rule: "SoC ≤ 备用 SoC（或放余量≤0 且电池可充）",
    also: "纯 DP 可用 backup_soc=SoC；实验室也可调 PV/Bypass/负载，让 放余量≤0 且电池可充",
    core: {
      type: "backup_soc",
      formula: "work_mode=0，backup_soc = SoC",
      need: "SoC ≤ 100",
      backupOf: (soc) => soc,
    },
    overlays: true,
    blocked: [
      { key: "dchg-headroom", note: "放余量分支可在实验室通过调 PV/Bypass/负载构造，但不是纯 DP 单独触发" },
    ],
  },
  {
    key: "cc",
    target: "可充可放",
    short: "可充可放",
    rule: "备用 SoC < 当前 SoC < 100%",
    also: "",
    core: {
      type: "backup_soc",
      formula: "work_mode=0，backup_soc = SoC − 1",
      need: "0 < SoC < 100",
      backupOf: (soc) => Math.max(0, soc - 1),
    },
    overlays: true,
    blocked: [],
  },
];

function getScenarioConstructLibrary() {
  return SCENARIO_CONSTRUCT_LIB.map((item) => ({
    ...item,
    core: item.core ? { ...item.core } : null,
    cores: (item.cores || (item.core ? [item.core] : [])).map((row) => ({ ...row })),
    blocked: (item.blocked || []).map((row) => ({ ...row })),
  }));
}

function _atCoresOf(entry) {
  if (Array.isArray(entry.cores) && entry.cores.length) {
    return entry.cores;
  }
  return entry.core ? [entry.core] : [];
}

function _atCloneOwnerDevice(device, valuePatch, hystPatch) {
  const baseHyst = device._ownerHyst
    ? { ...device._ownerHyst }
    : { forceChg: false, forceChg1: false, forceChg2: false, fullChg: false };
  return {
    ...device,
    values: { ...(device.values || {}), ...(valuePatch || {}) },
    _ownerHyst: { ...baseHyst, ...(hystPatch || {}) },
  };
}

/**
 * 实验室构造 batChg=0 且 batDchg=0：电池能力非 DP，靠 SoC/map 与 PV/Bypass/负载现场调节。
 */
function _atHalBatZeroPlan(device, soc) {
  const invCap = (typeof modelMeta === "function" ? modelMeta(device).maxExport : 0) || 1500;
  const pv = typeof _ownerPvW === "function" ? _ownerPvW(device) : 0;
  const bypass = typeof _ownerBypassW === "function" ? _ownerBypassW(device) : 0;
  const atFull = classifyOwnerWorkModel(_atCloneOwnerDevice(device, {
    current_soc: 100,
    pv_power_total: 0,
    offgrid1_export_power: 0,
  }, { fullChg: true }));
  const batChgAtFull = atFull?.inputs?.batChg ?? 0;
  const batDchgAtFull = atFull?.inputs?.batDchg ?? invCap;
  const atLow = classifyOwnerWorkModel(_atCloneOwnerDevice(device, {
    current_soc: 2,
    pv_power_total: 0,
    offgrid1_export_power: 0,
  }, { fullChg: false }));
  const lowHits = atLow?.label === "禁充禁放";
  const steps = [];
  if (soc <= 5) {
    steps.push("PV=0；Bypass/负载压低");
    steps.push("低 SOC map 禁放档 → batDchg=0");
    if (atLow?.inputs?.batChg === 0) {
      steps.push("同档 batChg=0 → 命中禁充禁放");
    }
  } else if (soc >= 100) {
    steps.push("已满电 → batChg=0");
    steps.push(`PV=0；Bypass≥${Math.max(bypass, batDchgAtFull + pv)}W，配合读回 batDchg=0`);
  } else {
    steps.push(`路线 A：充至 SoC=100%（当前 ${soc}%）→ batChg=0`);
    steps.push("路线 B：PV=0，放电至 0~3% map 禁放档 → batDchg=0");
    steps.push("两能力同时为 0 才走 MCU 第一条，按现 SOC 选其一");
  }
  return {
    pv_w: 0,
    bypass_w: lowHits ? 0 : Math.max(bypass, batDchgAtFull + pv),
    grid_load_w: 0,
    soc_target: lowHits ? 2 : 100,
    steps,
    note: steps.join("；"),
    simFull: atFull,
    simLow: atLow,
  };
}

function _atHalBatZeroFeasible(device, soc) {
  if (soc == null) {
    return { ok: false, reason: "未读到 SoC" };
  }
  const plan = _atHalBatZeroPlan(device, soc);
  const hitFullBat = plan.simFull?.inputs?.batChg === 0 && plan.simFull?.inputs?.batDchg === 0;
  const hitLowBat = plan.simLow?.label === "禁充禁放";
  const now = classifyOwnerWorkModel(device);
  const already = now?.label === "禁充禁放" && now?.inputs?.batChg === 0 && now?.inputs?.batDchg === 0;
  return {
    ok: hitFullBat || hitLowBat || already || soc != null,
    reason: "",
    plan,
    already,
  };
}

/**
 * 实验室构造放电：保持 batChg>0，并把 PV-BP 差值抬到 batChg 以上。
 */
function _atHalDischargePlan(device, soc) {
  const now = classifyOwnerWorkModel(device);
  const pv = typeof _ownerPvW === "function" ? _ownerPvW(device) : 0;
  const bypass = typeof _ownerBypassW === "function" ? _ownerBypassW(device) : 0;
  const batChg = now?.inputs?.batChg ?? 0;
  const margin = 100;
  const needDelta = Math.max(0, batChg - (pv - bypass));
  const targetPv = Math.max(pv, bypass + batChg + margin);
  const targetBypass = Math.max(0, pv - batChg - margin);
  const steps = [
    `保持 batChg>0（当前约 ${batChg}W），避免满电/禁充温区/禁充告警`,
    `把 PV−Bypass 从当前 ${pv - bypass}W 拉高到 ≥ ${batChg}W`,
    `优先抬高 PV 到 ≥${targetPv}W；若 PV 不够，再压低 Bypass/家庭负载到 ≤${targetBypass}W`,
  ];
  return {
    pv_w: targetPv,
    bypass_w: targetBypass,
    grid_load_w: 0,
    soc_target: soc,
    steps,
    note: steps.join("；"),
  };
}

function _atHalDischargeFeasible(device, soc) {
  if (soc == null) {
    return { ok: false, reason: "未读到 SoC" };
  }
  const now = classifyOwnerWorkModel(device);
  const batChg = now?.inputs?.batChg ?? 0;
  if (!(batChg > 0)) {
    return { ok: false, reason: "当前 batChg=0，需先脱离满电/禁充温区/禁充告警" };
  }
  return { ok: true, reason: "", plan: _atHalDischargePlan(device, soc) };
}

function _atHalChg1BypassPlan(device, soc) {
  const now = classifyOwnerWorkModel(device);
  const pv = typeof _ownerPvW === "function" ? _ownerPvW(device) : 0;
  const bypass = typeof _ownerBypassW === "function" ? _ownerBypassW(device) : 0;
  const batDchg = now?.inputs?.batDchg ?? 0;
  const bypassCap = now?.inputs?.bypassCap ?? 1500;
  const targetBypass = Math.max(bypass, batDchg + pv + 100, bypassCap + 100);
  const steps = [
    `保持 work_mode=自用；当前 PV=${pv}W，Bypass=${bypass}W，电池最大放约 ${batDchg}W`,
    `把 Bypass/家庭负载抬到 > max(电池最大放+PV, 逆变上限) = > ${Math.max(batDchg + pv, bypassCap)}W`,
    `建议目标：Bypass≥${targetBypass}W；若负载不够，可同时压低 PV`,
  ];
  return {
    pv_w: Math.max(0, pv),
    bypass_w: targetBypass,
    grid_load_w: targetBypass,
    soc_target: soc,
    steps,
    note: steps.join("；"),
  };
}

function _atHalChg1BypassFeasible(device, soc) {
  if (soc == null) {
    return { ok: false, reason: "未读到 SoC" };
  }
  return { ok: true, reason: "", plan: _atHalChg1BypassPlan(device, soc) };
}

function _atCoverageKeyForOverlay(overlay) {
  if (!overlay.length) {
    return "backup_soc";
  }
  if (overlay.length === 1) {
    return AT_LIMIT_COVERAGE[overlay[0]] || overlay[0];
  }
  return overlay.map((dp) => AT_LIMIT_COVERAGE[dp] || dp).join("+");
}

function _atLimitValue(device, dp, maxExport) {
  if (dp === "inverter_input_power_limit") {
    return Math.max(300, Math.min(maxExport, _atLimit(device, ["inverter_input_power_limit"], maxExport) || maxExport));
  }
  return Math.max(
    300,
    Math.min(maxExport, _atLimit(device, ["output_power_limit", "regulation_grid_export_p_limit"], maxExport) || maxExport)
  );
}

function _atParamExample(params) {
  return Object.entries(params || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

function _atCoreFeasible(entry, soc, device) {
  if (!entry.core) {
    return { ok: false, reason: "当前无可写核心参数" };
  }
  if (entry.core.type === "limit_zero") {
    return { ok: true, reason: "" };
  }
  if (entry.core.type === "hal_bat_zero") {
    return _atHalBatZeroFeasible(device, soc);
  }
  if (entry.core.type === "hal_discharge") {
    return _atHalDischargeFeasible(device, soc);
  }
  if (entry.core.type === "hal_chg1_bypass") {
    return _atHalChg1BypassFeasible(device, soc);
  }
  if (entry.core.type === "soc_100") {
    return soc === 100
      ? { ok: true, reason: "SoC=100%，天然命中" }
      : { ok: false, reason: `SoC=${soc}，未到 100% 兜底` };
  }
  if (entry.core.type === "backup_soc") {
    if (soc == null) {
      return { ok: false, reason: "未读到 SoC" };
    }
    if (entry.key === "chg1" && soc + 10 > 100) {
      return { ok: false, reason: `SoC=${soc}，backup_soc 需要 >100` };
    }
    if (entry.key === "chg2" && soc + 5 > 100) {
      return { ok: false, reason: `SoC=${soc}，backup_soc 需要 >100` };
    }
    if (entry.key === "cc" && !(soc > 0 && soc < 100)) {
      return { ok: false, reason: `SoC=${soc}，不满足 0<SoC<100` };
    }
    return { ok: true, reason: "" };
  }
  return { ok: false, reason: "未知核心构造" };
}

function _atBuildCoreParams(entry, device, soc) {
  if (entry.core?.type === "hal_bat_zero") {
    return {};
  }
  if (entry.core?.type === "hal_chg1_bypass") {
    return { work_mode: "0" };
  }
  if (entry.core?.type === "hal_discharge") {
    return { work_mode: "0" };
  }
  if (entry.core?.type === "limit_zero") {
    return {
      work_mode: "0",
      output_power_limit: "0",
      regulation_grid_export_p_limit: "0",
    };
  }
  if (entry.core?.type === "soc_100") {
    return {};
  }
  if (entry.core?.type === "backup_soc") {
    const backup = _atClampSoc(entry.core.backupOf(soc));
    return { work_mode: "0", backup_soc: String(backup) };
  }
  return {};
}

function _atApplyOverlay(device, params, overlay) {
  const maxExport = (typeof modelMeta === "function" ? modelMeta(device).maxExport : 0) || 1500;
  const next = { ...params };
  for (const dp of overlay) {
    next[dp] = String(_atLimitValue(device, dp, maxExport));
  }
  return next;
}

function _atRecipeNote(entry, overlay, coreOk) {
  if (!coreOk.ok) {
    return coreOk.reason;
  }
  if (entry.core?.type === "hal_bat_zero" || entry.core?.type === "hal_discharge" || entry.core?.type === "hal_chg1_bypass") {
    return coreOk.plan?.note || entry.core.formula;
  }
  if (entry.core?.type === "limit_zero") {
    return "AC 输出限 / 法规输出限同时置 0 → 禁充禁放；其余路径需故障或现场条件";
  }
  if (entry.core?.type === "soc_100") {
    return "当前 SoC=100%，无需下发。";
  }
  if (!overlay.length) {
    return entry.core.formula;
  }
  return `${entry.core.formula}，再叠加 ${overlay.join(" + ")}`;
}

/**
 * 把构造库实例化到一台设备：每个工况展开全部下发组合。
 * @returns {Array} 与旧 _atStrategiesForTarget 同结构的 strategies
 */
function instantiateConstructRecipes(device, target, home) {
  const entry = SCENARIO_CONSTRUCT_LIB.find((item) => item.target === target);
  const soc = _atSoc(device);
  const current = classifyOwnerWorkModel(device);
  const currentLabel = current ? current.label : "—";
  const strategies = [];
  const natural = _atPickNaturalStrategy(target, currentLabel);
  if (natural) {
    strategies.push(natural);
  }
  if (!entry) {
    strategies.push(_atUnreachableStrategy(`${target}-unknown`, "unknown", "未知目标工况。", "target 不在工况构造库内。"));
    return _atStampRecipes(target, strategies);
  }
  if (soc == null) {
    strategies.push(
      _atUnreachableStrategy(
        `${target}-missing-soc`,
        "read_required",
        "未读到当前 SoC，无法基于现态反查构造。",
        "先执行一键读取，拿到 SoC/限功率后再编排。"
      )
    );
    return _atStampRecipes(target, strategies);
  }

  const cores = _atCoresOf(entry);
  const overlays = entry.overlays ? AT_LIMIT_OVERLAYS : [[]];
  for (const core of cores) {
    const sub = { ...entry, core };
    const coreOk = _atCoreFeasible(sub, soc, device);
    for (const overlay of overlays) {
      const coverageKey = core.coverageKey
        || (core.type === "soc_100"
          ? "soc_100_fallback"
          : (core.type === "limit_zero"
              ? "limit_zero"
              : (core.type === "hal_bat_zero"
                  ? "hal_bat_zero"
                  : (core.type === "hal_discharge"
                      ? "hal_discharge"
                      : (core.type === "hal_chg1_bypass" ? "hal_chg1_bypass" : _atCoverageKeyForOverlay(overlay))))));
      const params = coreOk.ok ? _atApplyOverlay(device, _atBuildCoreParams(sub, device, soc), overlay) : {};
      const key = `${entry.key}-${coverageKey}`;
      const note = _atRecipeNote(sub, overlay, coreOk);
      const basis = coreOk.ok
        ? ((core.type === "hal_bat_zero" || core.type === "hal_discharge" || core.type === "hal_chg1_bypass")
            ? `SoC=${soc} → 现场 ${coreOk.plan?.note || note}`
            : `SoC=${soc} → ${_atParamExample(params) || "无需下发"}`)
        : coreOk.reason;
      if (coreOk.ok) {
        strategies.push(
          _atStrategy(key, coverageKey, params, note, basis, {
            rollbackNeeded: Object.keys(params).length > 0,
            hal: (core.type === "hal_bat_zero" || core.type === "hal_discharge" || core.type === "hal_chg1_bypass") ? (coreOk.plan || null) : null,
            labOnly: core.type === "hal_bat_zero" || core.type === "hal_discharge" || core.type === "hal_chg1_bypass",
          })
        );
      } else {
        strategies.push(_atUnreachableStrategy(key, coverageKey, note, basis));
      }
    }
  }
  for (const blocked of entry.blocked || []) {
    strategies.push(
      _atUnreachableStrategy(
        `${entry.key}-${blocked.key}`,
        "readonly_gap",
        blocked.note,
        "owner-model 判定分支，当前自动回归可写 DP 无法单独触发。"
      )
    );
  }
  if (!entry.core && !(entry.blocked || []).length) {
    strategies.push(_atUnreachableStrategy(`${entry.key}-empty`, "unknown", "该工况尚未登记构造路径。", "请补工况构造库。"));
  }
  return _atStampRecipes(target, strategies);
}

function _atStampRecipes(target, strategies) {
  return strategies.map((item, idx) => ({
    ...item,
    sortKey: `${target}-${String(idx + 1).padStart(2, "0")}`,
  }));
}

function _atRecipeLabel(strategy) {
  if (strategy?.labOnly) {
    return "实验室构造";
  }
  const params = strategy.params || {};
  const keys = Object.keys(params);
  if (!keys.length) {
    return strategy.feasible ? "天然命中 / 无需下发" : "无法下发";
  }
  return keys.join(" + ");
}

/**
 * 第三节展示模型：每个工况列出全部下发组合，并带当前选中设备举例。
 */
function buildConstructLibrary(home, selectedUids) {
  const uidSet = new Set(selectedUids || []);
  const devices = (home?.devices || []).filter((dev) => !uidSet.size || uidSet.has(dev.uid));
  const items = SCENARIO_CONSTRUCT_LIB.map((entry) => {
    const recipes = [];
    const seen = new Set();
    const deviceHints = devices.map((device) => {
      const soc = _atSoc(device);
      const strategies = instantiateConstructRecipes(device, entry.target, home);
      return { device, soc, strategies };
    });
    const templateDevice = devices[0] || null;
    const currentOwner = templateDevice && typeof classifyOwnerWorkModel === "function"
      ? classifyOwnerWorkModel(templateDevice)
      : null;
    const templateStrategies = templateDevice
      ? instantiateConstructRecipes(templateDevice, entry.target, home)
      : [];
    for (const strategy of templateStrategies) {
      if (strategy.coverageKey === "natural" || strategy.coverageKey === "read_required") {
        continue;
      }
      const id = strategy.coverageKey + ":" + Object.keys(strategy.params || {}).sort().join(",");
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const hints = deviceHints.map((hint) => {
        const match = hint.strategies.find((item) => item.coverageKey === strategy.coverageKey && item.key === strategy.key)
          || hint.strategies.find((item) => item.coverageKey === strategy.coverageKey);
        return {
          uid: hint.device.uid,
          device: hint.device.name || hint.device.deviceId,
          soc: hint.soc,
          feasible: !!(match && match.feasible),
          example: match && match.feasible ? (match.basis || _atParamExample(match.params)) : (match?.basis || match?.note || ""),
        };
      });
      const feasibleN = hints.filter((item) => item.feasible).length;
      const exampleHint = hints.find((item) => item.feasible) || hints[0] || null;
      recipes.push({
        key: strategy.key,
        coverageKey: strategy.coverageKey,
        label: _atRecipeLabel(strategy),
        params: { ...(strategy.params || {}) },
        paramText: strategy.labOnly
          ? (strategy.hal?.note || strategy.note || "现场调节 PV/Bypass/负载")
          : (_atParamExample(strategy.params) || "无需下发"),
        note: strategy.note || "",
        hal: strategy.hal || null,
        labOnly: !!strategy.labOnly,
        feasible: feasibleN > 0,
        feasibleN,
        deviceN: hints.length,
        example: exampleHint
          ? `${exampleHint.device} SoC=${exampleHint.soc == null ? "—" : exampleHint.soc} → ${exampleHint.example || strategy.note}`
          : strategy.basis || strategy.note,
        blocked: strategy.coverageKey === "readonly_gap" || !strategy.feasible,
      });
    }
    const writableN = recipes.filter((item) => item.feasible && item.coverageKey !== "readonly_gap").length;
    return {
      key: entry.key,
      target: entry.target,
      short: entry.short,
      rule: entry.rule,
      also: entry.also || "",
      formula: _atCoresOf(entry).map((row) => row.formula).filter(Boolean).join("；或 ") || "无可写核心路径",
      current: currentOwner ? {
        device: templateDevice?.name || templateDevice?.deviceId || "",
        label: currentOwner.label || "",
        inputs: { ...(currentOwner.inputs || {}) },
      } : null,
      overlays: !!entry.overlays,
      recipes,
      writableN,
      recipeN: recipes.length,
    };
  });
  return {
    dps: AT_WRITABLE_DPS.slice(),
    overlays: AT_LIMIT_OVERLAYS.map((combo) => combo.slice()),
    items,
  };
}
