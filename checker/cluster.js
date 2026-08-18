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
    pvTotal += Math.max(0, _ownerNum(v.pv_power_total, 0));
    const og = _ownerNum(v.offgrid1_export_power ?? v.battery_charging_power_grid, 0);
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

const AUTO_TARGETS = [
  {
    key: "chg1", target: "充电状态1", expect: "充电状态1",
    make: (soc) => ({ work_mode: "0", backup_soc: String(_atClampSoc(soc + 11)) }),
    feasible: (soc) => soc != null && soc + 11 <= 100,
    note: "备用=SoC+11 → SoC≤备用−10",
  },
  {
    key: "chg2", target: "充电状态2", expect: "充电状态2",
    make: (soc) => ({ work_mode: "0", backup_soc: String(_atClampSoc(soc + 6)) }),
    feasible: (soc) => soc != null && soc + 6 <= 100 && soc >= 0,
    note: "备用=SoC+6 → SoC≤备用−5（自发自用）",
  },
  {
    key: "cc", target: "可充可放", expect: "可充可放",
    make: (soc) => ({ work_mode: "0", backup_soc: String(_atClampSoc(soc - 6)) }),
    feasible: (soc) => soc != null && soc > 0 && soc < 100,
    note: "备用<SoC<100",
  },
];

function buildAutoMatrix(home) {
  const rows = [];
  for (const dev of home?.devices || []) {
    const soc = _atSoc(dev);
    for (const t of AUTO_TARGETS) {
      const ok = t.feasible(soc);
      rows.push({
        uid: dev.uid,
        device: dev.name || dev.deviceId,
        soc,
        target: t.target,
        expect: t.expect,
        params: ok ? t.make(soc) : null,
        feasible: !!ok,
        note: ok ? t.note : soc == null ? "未读到 SoC，先「一键读取」" : "当前 SoC 下该目标软不可达",
      });
    }
  }
  return rows;
}
