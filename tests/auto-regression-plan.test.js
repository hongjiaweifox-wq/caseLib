const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCheckerRuntime() {
  const base = path.resolve(__dirname, "..", "checker");
  const context = {
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    Date,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  for (const file of ["device-model.js", "owner-model.js", "cluster.js", "construct-lib.js"]) {
    const code = fs.readFileSync(path.join(base, file), "utf8");
    vm.runInContext(code, context, { filename: file });
  }
  return context;
}

function sampleDevice(overrides = {}) {
  return {
    uid: "dev-1",
    deviceId: "device-1",
    name: "一号机",
    pid: "rloz0sela2ltnqqp",
    values: {
      current_soc: 60,
      backup_soc: 20,
      pv_power_total: 400,
      offgrid1_export_power: 100,
      output_power_limit: 1500,
      inverter_input_power_limit: 1500,
      work_mode: "0",
    },
    ...overrides,
  };
}

test("target catalog covers all owner labels", () => {
  const ctx = loadCheckerRuntime();
  assert.equal(typeof ctx.getAutoTargetCatalog, "function");
  const labels = Array.from(ctx.getAutoTargetCatalog(), (it) => it.target);
  assert.deepEqual(labels, [
    "禁充禁放",
    "放电",
    "可放",
    "充电状态1",
    "充电状态2",
    "可充",
    "可充可放",
  ]);
});

test("device scenario plan expands every target with strategy variants", () => {
  const ctx = loadCheckerRuntime();
  assert.equal(typeof ctx.buildAutoDeviceScenarioPlan, "function");
  const plan = ctx.buildAutoDeviceScenarioPlan(sampleDevice(), { devices: [sampleDevice()] });
  assert.equal(plan.device, "一号机");
  assert.equal(plan.scenarios.length, 7);
  const byTarget = Object.fromEntries(plan.scenarios.map((item) => [item.target, item]));
  assert.ok(byTarget["充电状态1"].strategies.some((s) => s.coverageKey === "backup_soc"));
  assert.ok(byTarget["充电状态1"].strategies.some((s) => s.coverageKey === "hal_chg1_bypass"));
  assert.ok(byTarget["充电状态2"].strategies.some((s) => s.coverageKey === "input_limit"));
  assert.ok(byTarget["可充可放"].strategies.some((s) => s.coverageKey === "output_limit"));
  assert.ok(byTarget["放电"].strategies.some((s) => s.coverageKey === "hal_discharge"));
  assert.ok(byTarget["禁充禁放"].strategies.every((s) => s.coverageKey !== "limit_zero"));
  assert.ok(byTarget["禁充禁放"].strategies.some((s) => s.coverageKey === "readonly_gap"));
  assert.ok(byTarget["禁充禁放"].strategies.every((s) => s.coverageKey !== "soc_100_fallback"));
});

test("construct library lists every writable overlay combo per scenario", () => {
  const ctx = loadCheckerRuntime();
  assert.equal(typeof ctx.getScenarioConstructLibrary, "function");
  assert.equal(typeof ctx.buildConstructLibrary, "function");
  const lib = ctx.getScenarioConstructLibrary();
  assert.equal(lib.length, 7);
  const chg1 = lib.find((item) => item.key === "chg1");
  assert.equal(chg1.core.formula.includes("SoC + 11"), true);
  const view = ctx.buildConstructLibrary({ devices: [sampleDevice()] }, ["dev-1"]);
  const chg1View = view.items.find((item) => item.key === "chg1");
  const writable = chg1View.recipes.filter((r) => r.coverageKey !== "readonly_gap");
  const chg1DpOnly = writable.filter((r) => !r.labOnly);
  assert.equal(chg1DpOnly.length, 8);
  assert.ok(writable.some((r) => r.coverageKey === "backup_soc"));
  assert.ok(chg1View.recipes.some((r) => r.coverageKey === "hal_chg1_bypass"));
  assert.ok(writable.some((r) => r.coverageKey === "input_limit"));
  assert.ok(writable.some((r) => r.coverageKey === "output_limit"));
  assert.ok(writable.some((r) => r.coverageKey === "regulation_limit"));
  const chg1Backup = writable.find((r) => r.coverageKey === "backup_soc");
  assert.match(chg1Backup.example, /backup_soc=71/);
  const chg2View = view.items.find((item) => item.key === "chg2");
  const chg2Backup = chg2View.recipes.find((r) => r.coverageKey === "backup_soc");
  assert.match(chg2Backup.example, /backup_soc=65/);
  const edge = ctx.buildConstructLibrary({
    devices: [sampleDevice({ values: { ...sampleDevice().values, current_soc: 72 } })],
  }, ["dev-1"]);
  const chg2Edge = edge.items.find((item) => item.key === "chg2").recipes.find((r) => r.coverageKey === "backup_soc");
  assert.match(chg2Edge.example, /backup_soc=77/);
  const discharge = view.items.find((item) => item.key === "discharge");
  const dischargeWritable = discharge.recipes.filter((r) => r.coverageKey !== "readonly_gap");
  assert.ok(dischargeWritable.some((r) => r.coverageKey === "hal_discharge"));
  const dischargeHal = dischargeWritable.find((r) => r.coverageKey === "hal_discharge");
  assert.equal(dischargeHal.params.work_mode, "0");
  assert.ok(dischargeHal.labOnly);
  assert.ok(dischargeHal.hal && dischargeHal.hal.steps?.length);
  const candis = view.items.find((item) => item.key === "candis");
  assert.ok(candis.recipes.every((r) => r.coverageKey === "readonly_gap"));
  const disabled = view.items.find((item) => item.key === "disabled");
  const disabledWritable = disabled.recipes.filter((r) => r.coverageKey !== "readonly_gap");
  assert.equal(disabledWritable.length, 0);
  assert.ok(disabled.recipes.some((r) => /输入限制=0/.test(r.note || "")));
  assert.ok(disabled.recipes.some((r) => /故障码/.test(r.note || "")));
  assert.equal(disabled.writableN, 0);
  assert.match(disabled.rule, /0x06|电池最大充/);
});

test("combo execution plan builds dev[target] / dev[target] labels", () => {
  const ctx = loadCheckerRuntime();
  assert.equal(typeof ctx.buildComboExecutionPlan, "function");
  const home = { devices: [sampleDevice(), sampleDevice({ uid: "dev-2", deviceId: "device-2", name: "二号机" })] };
  const exec = ctx.buildComboExecutionPlan(home, ["dev-1", "dev-2"]);
  assert.equal(exec.devicePlans.length, 2);
  assert.ok(exec.cycles.length > 0);
  assert.match(exec.cycles[0].label, /一号机\[.+\] \/ 二号机\[.+\]/);
  assert.equal(exec.cycles[0].assignments.length, 2);
});

test("combo execution plan respects per-device target badges", () => {
  const ctx = loadCheckerRuntime();
  const home = { devices: [sampleDevice(), sampleDevice({ uid: "dev-2", deviceId: "device-2", name: "二号机" })] };
  const full = ctx.buildComboExecutionPlan(home, ["dev-1", "dev-2"]);
  const filtered = ctx.buildComboExecutionPlan(home, ["dev-1", "dev-2"], {
    "dev-1": { chg1: true, chg2: false, cc: false, canchg: false, candis: false, discharge: false, disabled: false },
    "dev-2": { chg1: false, chg2: true, cc: false, canchg: false, candis: false, discharge: false, disabled: false },
  });
  assert.ok(full.cycles.length > filtered.cycles.length);
  assert.equal(filtered.cycles.length, 2);
  assert.ok(filtered.cycles.every((cycle) => cycle.label === "一号机[充电1] / 二号机[充电2]"));
  assert.equal(filtered.incomplete, false);
});

test("combo cycles can be scoped by device id, target, and explicit picks", () => {
  const ctx = loadCheckerRuntime();
  const home = { devices: [sampleDevice(), sampleDevice({ uid: "dev-2", deviceId: "device-2", name: "二号机" })] };
  const exec = ctx.buildComboExecutionPlan(home, ["dev-1", "dev-2"], {
    "dev-1": { chg1: true, chg2: true, cc: false, canchg: false, candis: false, discharge: false, disabled: false },
    "dev-2": { chg1: true, chg2: true, cc: false, canchg: false, candis: false, discharge: false, disabled: false },
  });
  assert.equal(exec.cycles.length, 9);
  assert.ok(exec.cycles.every((cycle) => cycle.key));
  const byDev1Chg1 = exec.cycles.filter((cycle) => ctx.cycleMatchesScope(cycle, { deviceId: "device-1", target: "充电状态1" }));
  assert.equal(byDev1Chg1.length, 6);
  assert.ok(byDev1Chg1.every((cycle) => cycle.assignments[0].target === "充电状态1"));
  const picked = ctx.pickComboCycles(exec.cycles, { [exec.cycles[0].key]: true, [exec.cycles[1].key]: false });
  assert.equal(picked.length, 8);
});
