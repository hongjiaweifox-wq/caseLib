/* ===================================================================
 * checker / 固件运行逻辑层 — 对齐 MCU 源码 CBE_RESONATE_MASTER。
 * MCU 固件改动只需同步本目录。全局作用域(经典 <script>)，无 import/export。
 * 本文件由 app.js 原样迁出，逻辑一字未改。
 * 来源 app.js L6144-6289 ↔ 固件多机分配(app_wifi.c 充1/充2/一充一放)
 * =================================================================== */

function _atClampSoc(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}
function _atSoc(device) {
  const v = Number(device.values?.current_soc ?? device.values?.main_soc);
  return Number.isFinite(v) ? v : null;
}
// 软可达工况配方：靠"备用SOC 相对当前SOC"+工作模式 卡进目标态
// ── 主机决策模型（多机分配）───────────────────────────────────────
// 从机上报的只是「态」(classifyOwnerWorkModel)，主机拿到全簇的态后再按
// 分配优先级决策谁真充/真放（DP98 order/cmdPowerW）。判定分两层：
//   L1 从机判定：读回态 == 我们要制造的目标态（测 S1–S13 判定链）
//   L2 主机决策：DP98 实际 order/功率 == 用整簇上报态算出的期望分配（测主机分配）
// 参见《从机状态判》「设备电力来源/方向优先级（多机分配逻辑）」。
const _AT_CAT = {
  "充电状态1": "chg1", "充电状态2": "chg2", "可充可放": "cc",
  "可充": "canchg", "可放": "candis", "放电": "discharge",
  "禁充禁放": "disabled", "实时控制": "rt", "Modbus接管": "modbus",
};
function _atCat(label) { return _AT_CAT[label] || "other"; }

// 从各机 dev.values 复算 home 级聚合：PV 总 / bypass 负载 / 三方微逆倒灌
function _atHomeAgg(home) {
  let pvTotal = 0, loadSum = 0, microSum = 0;
  for (const d of home?.devices || []) {
    const v = d.values || {};
    pvTotal += typeof _ownerPvW === "function" ? _ownerPvW(d) : Math.max(0, _ownerNum(v.pv_power_total, 0));
    const og = typeof _ownerBypassW === "function"
      ? _ownerBypassW(d)
      : _ownerNum(v.offgrid1_export_power ?? v.battery_charging_power_grid, 0);
    if (og > 0) loadSum += og; else if (og < 0) microSum += -og;
  }
  return { pvTotal, loadSum, microSum };
}

// 主机期望决策：给每台参与分配的设备算 {order:'充'|'放'|'待机', powerW, band:[lo,hi], why, determinable}
// determinable=false → 该态方向依赖能量守恒/未采集量，仅作参考不硬判（避免误报失败）。
function computeMasterExpect(home, opts) {
  opts = opts || {};
  const agg = _atHomeAgg(home);
  const gridBuyLimit =
    opts.gridBuyLimit != null && opts.gridBuyLimit !== "" ? Number(opts.gridBuyLimit) : null;
  // 三方光伏 ≈ bypass 口三方光伏倒灌（可配置覆盖；家庭三方"未知"光伏无法直接测）
  const tpv = opts.tpv != null && opts.tpv !== "" ? Number(opts.tpv) : agg.microSum;

  const reps = [];
  for (const d of home?.devices || []) {
    const o = classifyOwnerWorkModel(d);
    if (!o) continue;
    reps.push({ uid: d.uid, name: d.name || d.deviceId, cat: _atCat(o.label), label: o.label, chg: o.chgCapW, dchg: o.dchgCapW });
  }
  const chg1Need = reps.filter((r) => r.cat === "chg1").reduce((s, r) => s + r.chg, 0);
  const disCap = reps.filter((r) => r.cat === "cc" || r.cat === "candis").reduce((s, r) => s + r.dchg, 0);
  // 充2抑制：条件1需家庭电网购电限值(规划中·可手动配置)；条件2用上报可放能力可算
  const supp2c1 = gridBuyLimit != null ? chg1Need > gridBuyLimit + tpv : false;
  const supp2c2 = chg1Need > disCap + tpv;
  const chg2Suppressed = supp2c1 || supp2c2;

  const byUid = {};
  for (const r of reps) {
    let order = "待机", powerW = 0, band = [0, 120], why = "", det = true;
    switch (r.cat) {
      case "chg1":
        order = "充"; powerW = r.chg; band = [Math.max(0, Math.round(r.chg * 0.6)), r.chg + 300];
        why = "充电状态1 强制充电（充电分配最高优先级）"; break;
      case "chg2":
        if (chg2Suppressed) {
          order = "待机"; powerW = 0; band = [0, 150];
          why = supp2c2
            ? `充2抑制：充1需求 ${chg1Need}W > 可放总 ${disCap}W + 三方 ${tpv}W`
            : `充2抑制：充1需求 ${chg1Need}W > 电网购电限 ${gridBuyLimit}W + 三方 ${tpv}W`;
        } else {
          order = "充"; powerW = r.chg; band = [Math.max(0, Math.round(r.chg * 0.4)), r.chg + 300];
          why = "充电状态2 未被抑制，允许充电";
        }
        break;
      case "disabled":
        order = "待机"; powerW = 0; band = [0, 120]; why = "禁充禁放"; break;
      case "discharge":
        order = "放"; powerW = r.dchg; band = [0, r.dchg + 300]; why = "放电（防弃光）"; break;
      case "cc": case "candis":
        if (chg2Suppressed) {
          order = "待机"; powerW = 0; band = [0, 150];
          why = "一充一放损耗规则：充2被抑制 → 对应放电不下发";
        } else {
          det = false; why = "可放/可充可放方向取决于家庭盈余/缺口（需能量守恒，参考不硬判）";
        }
        break;
      case "canchg":
        det = false; why = "可充：仅有盈余光伏时才充（需盈余判定，参考不硬判）"; break;
      case "rt": case "modbus":
        det = false; why = `${r.label}：严格按实时/Modbus 指令，不参与分配判定`; break;
      default:
        det = false; why = "未建模态，参考不硬判";
    }
    byUid[r.uid] = { order, powerW, band, why, determinable: det, rep: r };
  }
  return { byUid, chg1Need, disCap, tpv, gridBuyLimit, chg2Suppressed, supp2c1, supp2c2, agg };
}

const AUTO_TARGET_CATALOG = [
  { key: "disabled", target: "禁充禁放", cat: "disabled" },
  { key: "discharge", target: "放电", cat: "discharge" },
  { key: "candis", target: "可放", cat: "candis" },
  { key: "chg1", target: "充电状态1", cat: "chg1" },
  { key: "chg2", target: "充电状态2", cat: "chg2" },
  { key: "canchg", target: "可充", cat: "canchg" },
  { key: "cc", target: "可充可放", cat: "cc" },
];

function _atDeviceVal(device, keys, fallback = null) {
  for (const key of keys) {
    const value = device?.values?.[key];
    if (value != null && value !== "") {
      return value;
    }
  }
  return fallback;
}

function _atNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function _atLimit(device, keys, fallback) {
  return Math.max(0, Math.round(_atNum(_atDeviceVal(device, keys, fallback), fallback)));
}

function _atBaseParams(device) {
  return {
    work_mode: String(_atDeviceVal(device, ["work_mode"], "0") || "0"),
    backup_soc: String(_atClampSoc(_atNum(_atDeviceVal(device, ["backup_soc", "backup_reserve", "min_soc_discharge"], 20), 20))),
    output_power_limit: String(_atLimit(device, ["output_power_limit", "regulation_grid_export_p_limit"], modelMeta(device).maxExport || 1500)),
    inverter_input_power_limit: String(_atLimit(device, ["inverter_input_power_limit"], modelMeta(device).maxExport || 1500)),
    regulation_grid_export_p_limit: String(_atLimit(device, ["regulation_grid_export_p_limit", "output_power_limit"], modelMeta(device).maxExport || 1500)),
  };
}

function _atPickNaturalStrategy(target, currentLabel) {
  if (currentLabel !== target) {
    return null;
  }
  return {
    key: "natural-match",
    coverageKey: "natural",
    feasible: true,
    params: {},
    note: "当前设备已命中目标工况，无需额外下发",
    basis: `当前读回态=${currentLabel}`,
    risk: "low",
    rollbackNeeded: false,
  };
}

function _atStrategy(key, coverageKey, params, note, basis, extra = {}) {
  return {
    key,
    coverageKey,
    feasible: extra.feasible !== false,
    params: params || {},
    note: note || "",
    basis: basis || "",
    risk: extra.risk || "low",
    rollbackNeeded: extra.rollbackNeeded !== false,
    hal: extra.hal || null,
    labOnly: !!extra.labOnly,
  };
}

function _atUnreachableStrategy(key, coverageKey, note, basis) {
  return _atStrategy(key, coverageKey, {}, note, basis, {
    feasible: false,
    risk: "high",
    rollbackNeeded: false,
  });
}

function _atStrategiesForTarget(device, target, home) {
  if (typeof instantiateConstructRecipes === "function") {
    return instantiateConstructRecipes(device, target, home);
  }
  return [
    _atUnreachableStrategy(
      `${target}-nolib`,
      "unknown",
      "工况构造库未加载。",
      "请加载 checker/construct-lib.js"
    ),
  ];
}

function getAutoTargetCatalog() {
  return AUTO_TARGET_CATALOG.map((item) => ({ ...item }));
}

function _atAllowLabConstruct() {
  if (typeof _atLabConstructEnabled === "function") {
    return !!_atLabConstructEnabled();
  }
  // Browser without helper → off; Node unit tests (no document) keep lab paths
  return typeof document === "undefined";
}

function buildAutoDeviceScenarioPlan(device, home) {
  const current = classifyOwnerWorkModel(device);
  const allowLab = _atAllowLabConstruct();
  const scenarios = getAutoTargetCatalog().map((target) => {
    const strategies = _atStrategiesForTarget(device, target.target, home);
    const usable = (strategies || []).filter((item) =>
      item && item.feasible && item.coverageKey !== "natural" && (allowLab || !item.labOnly)
    );
    const naturalOk = (strategies || []).some((item) => item && item.feasible && item.coverageKey === "natural");
    const feasible = usable.length > 0 || naturalOk;
    const shownStrategies = _atShownStrategies(strategies, { allowLab });
    const visibleRecommended = shownStrategies[0]
      || usable.find((item) => item.coverageKey !== "natural")
      || (naturalOk ? strategies.find((item) => item.coverageKey === "natural" && item.feasible) : null)
      || null;
    return {
      key: target.key,
      target: target.target,
      cat: target.cat,
      uid: device.uid,
      device: device.name || device.deviceId,
      currentLabel: current ? current.label : "—",
      feasible,
      strategyCount: strategies.length,
      strategies,
      shownStrategies,
      recommended: visibleRecommended,
      note: feasible
        ? (visibleRecommended || {}).note || ""
        : (allowLab
          ? strategies.map((item) => item.note).filter(Boolean).join("；")
          : "无可写 DP 路径（实验室构造未启用）"),
    };
  });
  return {
    uid: device.uid,
    deviceId: device.deviceId,
    device: device.name || device.deviceId,
    currentLabel: current ? current.label : "—",
    soc: _atSoc(device),
    scenarios,
  };
}

function buildAutoDevicePlans(home) {
  return (home?.devices || []).map((device) => buildAutoDeviceScenarioPlan(device, home));
}

const AT_TARGET_SHORT = {
  "充电状态1": "充电1",
  "充电状态2": "充电2",
  "可充可放": "可充可放",
  "可充": "可充",
  "可放": "可放",
  "放电": "放电",
  "禁充禁放": "禁充禁放",
};

function _atShortTarget(label) {
  return AT_TARGET_SHORT[label] || label;
}

function _atComboKey(assignments) {
  return (assignments || []).map((item) =>
    `${item.uid || item.deviceId || ""}:${item.target || ""}:${item.strategyKey || item.coverageKey || ""}`
  ).join("|");
}

function cycleMatchesScope(cycle, opts) {
  opts = opts || {};
  const assigns = cycle?.assignments || [];
  const q = String(opts.deviceId || "").trim().toLowerCase();
  const target = String(opts.target || "").trim();
  let pool = assigns;
  if (q) {
    pool = assigns.filter((item) =>
      String(item.deviceId || "").toLowerCase().includes(q) ||
      String(item.device || "").toLowerCase().includes(q) ||
      String(item.uid || "").toLowerCase().includes(q)
    );
    if (!pool.length) {
      return false;
    }
  }
  if (target) {
    return pool.some((item) => item.target === target);
  }
  return true;
}

function pickComboCycles(cycles, picks) {
  const list = cycles || [];
  if (!picks) {
    return list.slice();
  }
  return list.filter((cycle) => picks[cycle.key] !== false);
}

function _atCartesian(arrays) {
  if (!arrays.length) {
    return [];
  }
  return arrays.reduce((acc, curr) => {
    if (!acc.length) {
      return curr.map((item) => [item]);
    }
    const out = [];
    for (const prefix of acc) {
      for (const item of curr) {
        out.push([...prefix, item]);
      }
    }
    return out;
  }, []);
}

const AT_MAX_COMBO_CYCLES = 2000;

function _atCartesianCapped(arrays, limit) {
  if (!arrays.length) {
    return [];
  }
  const max = Math.max(1, Number(limit) || AT_MAX_COMBO_CYCLES);
  return arrays.reduce((acc, curr) => {
    if (!acc.length) {
      return curr.slice(0, max).map((item) => [item]);
    }
    const out = [];
    for (const prefix of acc) {
      for (const item of curr) {
        out.push([...prefix, item]);
        if (out.length >= max) {
          return out;
        }
      }
    }
    return out;
  }, []);
}

function _atComboAssignment(plan, scenario, strategy) {
  return {
    uid: plan.uid,
    deviceId: plan.deviceId,
    device: plan.device,
    target: scenario.target,
    strategyKey: strategy.key,
    coverageKey: strategy.coverageKey,
    params: { ...(strategy.params || {}) },
    note: strategy.note || "",
    basis: strategy.basis || "",
  };
}

function _atStrategyGroupKey(strategy) {
  if (!strategy) {
    return "";
  }
  if (strategy.labOnly) {
    return strategy.coverageKey || strategy.key || "lab";
  }
  const params = strategy.params || {};
  if (params.backup_soc != null) {
    return "backup_soc";
  }
  if (strategy.coverageKey === "limit_zero") {
    return "limit_zero";
  }
  return strategy.coverageKey || strategy.key || "dp";
}

function _atShownStrategies(strategies, opts) {
  opts = opts || {};
  const allowLab = opts.allowLab != null ? !!opts.allowLab : _atAllowLabConstruct();
  const feasible = (strategies || []).filter((item) =>
    item && item.feasible && item.coverageKey !== "natural" && (allowLab || !item.labOnly)
  );
  if (!feasible.length) {
    return [];
  }
  const primary = feasible.find((item) => !item.labOnly) || feasible[0];
  const primaryGroup = _atStrategyGroupKey(primary);
  const extra = feasible.find((item) => item.key !== primary.key && _atStrategyGroupKey(item) !== primaryGroup) || null;
  return extra ? [primary, extra] : [primary];
}

function _atTargetWanted(selectedTargets, uid, scenario) {
  if (!selectedTargets) {
    return true;
  }
  const map = selectedTargets[uid];
  if (!map) {
    return true;
  }
  if (map[scenario.key] === false || map[scenario.target] === false) {
    return false;
  }
  return true;
}

/** Selected devices × checked feasible targets → Cartesian combinations like dev1[充电1] / dev2[充电2]. */
function buildComboExecutionPlan(home, selectedUids, selectedTargets) {
  const uidSet = new Set(selectedUids || []);
  const devicePlans = buildAutoDevicePlans(home).filter((plan) => uidSet.has(plan.uid));
  const perDeviceOptions = devicePlans.map((plan) => {
    const options = [];
    for (const scenario of plan.scenarios) {
      if (!scenario.feasible) {
        continue;
      }
      if (!_atTargetWanted(selectedTargets, plan.uid, scenario)) {
        continue;
      }
      const visible = Array.isArray(scenario.shownStrategies) && scenario.shownStrategies.length
        ? scenario.shownStrategies
        : (scenario.recommended ? [scenario.recommended] : []);
      const choices = visible.filter((strategy) => strategy && strategy.feasible);
      if (!choices.length) {
        continue;
      }
      for (const strategy of choices) {
        options.push(_atComboAssignment(plan, scenario, strategy));
      }
    }
    return { plan, options };
  });
  if (!perDeviceOptions.length || perDeviceOptions.some((entry) => !entry.options.length)) {
    return { devicePlans, cycles: [], incomplete: true };
  }
  const optionArrays = perDeviceOptions.map((entry) => entry.options);
  const totalCycles = optionArrays.reduce((acc, arr) => acc * Math.max(1, arr.length), 1);
  const truncated = totalCycles > AT_MAX_COMBO_CYCLES;
  const combos = truncated ? _atCartesianCapped(optionArrays, AT_MAX_COMBO_CYCLES) : _atCartesian(optionArrays);
  let no = 0;
  const cycles = combos.map((assignments) => {
    no += 1;
    const label = assignments.map((item) => `${item.device}[${_atShortTarget(item.target)}]`).join(" / ");
    return {
      no,
      key: _atComboKey(assignments),
      label,
      assignments,
      status: "ready",
      step: "ready",
    };
  });
  return { devicePlans, cycles, incomplete: false, truncated, totalCycles };
}

function buildAutoExecutionPlan(home, selectedUids, selectedTargets) {
  if (Array.isArray(selectedUids) && selectedUids.length) {
    return buildComboExecutionPlan(home, selectedUids, selectedTargets);
  }
  const devicePlans = buildAutoDevicePlans(home);
  const cycles = [];
  let no = 0;
  for (const plan of devicePlans) {
    for (const scenario of plan.scenarios) {
      const visible = Array.isArray(scenario.shownStrategies) && scenario.shownStrategies.length
        ? scenario.shownStrategies
        : scenario.strategies;
      for (const strategy of visible) {
        if (!strategy.feasible) {
          continue;
        }
        no += 1;
        cycles.push({
          no,
          uid: plan.uid,
          deviceId: plan.deviceId,
          device: plan.device,
          target: scenario.target,
          label: `${plan.device}[${_atShortTarget(scenario.target)}]`,
          assignments: [_atComboAssignment(plan, scenario, strategy)],
          currentLabel: scenario.currentLabel,
          strategyKey: strategy.key,
          coverageKey: strategy.coverageKey,
          params: { ...strategy.params },
          note: strategy.note,
          basis: strategy.basis,
          rollbackNeeded: strategy.rollbackNeeded !== false,
          status: "ready",
          step: "ready",
        });
      }
    }
  }
  return { devicePlans, cycles, incomplete: false };
}

const AUTO_TARGETS = getAutoTargetCatalog();

function buildAutoMatrix(home) {
  const rows = [];
  for (const plan of buildAutoDevicePlans(home)) {
    for (const scenario of plan.scenarios) {
      const recommended = scenario.recommended;
      rows.push({
        uid: plan.uid,
        device: plan.device,
        soc: plan.soc,
        target: scenario.target,
        expect: scenario.target,
        params: recommended?.params || null,
        feasible: !!scenario.feasible,
        note: scenario.note || "",
        strategies: scenario.strategies,
        strategyCount: scenario.strategyCount,
      });
    }
  }
  return rows;
}
