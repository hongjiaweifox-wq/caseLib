const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
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

function cbe2000(values = {}, extra = {}) {
  return {
    uid: "n2eo4ba2hlu6",
    deviceId: "bf3b759e55217fcc09qf87",
    name: "CBE2000 Pro",
    pid: "c4ilzd7aybycece9",
    values: {
      current_soc: 70,
      backup_soc: 20,
      backup_reserve: 20,
      pv_power_total: 0,
      offgrid1_export_power: 80,
      output_power_limit: 2000,
      inverter_input_power_limit: 2000,
      ...values,
    },
    ...extra,
  };
}

function cbe5000(values = {}, extra = {}) {
  return {
    uid: "cbe5000-1",
    deviceId: "cbe5000-dev",
    name: "CBE5000 Pro",
    pid: "sl8ynevg5zhtkvsc",
    values: {
      current_soc: 70,
      backup_soc: 20,
      backup_reserve: 20,
      pv_power_total: 0,
      offgrid1_export_power: 80,
      output_power_limit: 2000,
      inverter_input_power_limit: 2000,
      ...values,
    },
    ...extra,
  };
}

test("theory PV is DP20 pv_power_total, ignores DP98", () => {
  const ctx = loadCheckerRuntime();
  const device = cbe2000(
    { pv_power_total: 0, battery_max_charge_power: 400, battery_max_discharge_power: 1500 },
    { ownerActual: { pvW: 900 } }
  );
  const owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.pv, 0);
  assert.notEqual(owner.label, "放电");
});

test("theory PV ignores channel DPs when pv_power_total is 0", () => {
  const ctx = loadCheckerRuntime();
  const device = cbe2000({
    pv_power_total: 0,
    pv_power_channel_1: 500,
    pv_power_channel_2: 400,
    battery_max_charge_power: 400,
    battery_max_discharge_power: 1500,
    offgrid1_export_power: 50,
  });
  const owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.pv, 0);
  assert.notEqual(owner.label, "放电");
});

test("model battery cap limits batChg at 25C SoC70", () => {
  const ctx = loadCheckerRuntime();
  const device = cbe2000({ current_soc: 70, pv_power_total: 0, offgrid1_export_power: 80 });
  const owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.modelBatChgCap, 1800);
  assert.equal(owner.inputs.batChg, 1800);
  assert.equal(owner.inputs.fullChg, false);
  assert.equal(owner.label, "可充可放");
});

test("CBE5000 uses higher battery cap", () => {
  const ctx = loadCheckerRuntime();
  const owner = ctx.classifyOwnerWorkModel(cbe5000({ current_soc: 70, pv_power_total: 0, offgrid1_export_power: 80 }));
  assert.equal(owner.inputs.modelBatChgCap, 2500);
  assert.equal(owner.inputs.modelBatDchgCap, 2500);
  assert.equal(owner.inputs.batChg, 2500);
  assert.equal(owner.inputs.batDchg, 2500);
});

test("high SoC still derates below model battery cap", () => {
  const ctx = loadCheckerRuntime();
  const hystOff = { forceChg: false, forceChg1: false, forceChg2: false, fullChg: false };
  const o93 = ctx.classifyOwnerWorkModel({ ...cbe2000({ current_soc: 93 }), _ownerHyst: { ...hystOff } });
  const o97 = ctx.classifyOwnerWorkModel({ ...cbe2000({ current_soc: 97 }), _ownerHyst: { ...hystOff } });
  const o99 = ctx.classifyOwnerWorkModel({ ...cbe2000({ current_soc: 99 }), _ownerHyst: { ...hystOff } });
  assert.equal(o93.inputs.batChg, 1800);
  assert.equal(o97.inputs.batChg, 1800);
  assert.equal(o99.inputs.batChg, 1296);
});

test("SoC=100 zeros charge until 95%", () => {
  const ctx = loadCheckerRuntime();
  const device = cbe2000({ current_soc: 100, pv_power_total: 0, offgrid1_export_power: 80 });
  let owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.batChg, 0);
  assert.equal(owner.inputs.fullChg, true);
  device.values.current_soc = 97;
  owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.batChg, 0);
  assert.equal(owner.inputs.fullChg, true);
  device.values.current_soc = 95;
  owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.fullChg, false);
  assert.equal(owner.inputs.batChg, 1800);
});

test("theory Bypass uses DP38 even when stored as battery_charging_power_grid", () => {
  const ctx = loadCheckerRuntime();
  const device = cbe2000({
    pv_power_total: 0,
    battery_charging_power_grid: 120,
  });
  delete device.values.offgrid1_export_power;
  const owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.bypass, 120);
});

test("PV 597 Bypass 1506 at SoC 97 (post-full) is 可放 not 可充可放", () => {
  const ctx = loadCheckerRuntime();
  const device = cbe2000({
    current_soc: 97,
    backup_soc: 20,
    pv_power_total: 597,
    offgrid1_export_power: 1506,
  });
  const owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.fullChg, true);
  assert.equal(owner.inputs.batChg, 0);
  assert.equal(owner.label, "可放");
});

test("PV 597 Bypass 1506 is 可放 not 充电状态1 when batChg=0", () => {
  const ctx = loadCheckerRuntime();
  const device = cbe2000({
    current_soc: 100,
    backup_soc: 20,
    pv_power_total: 597,
    offgrid1_export_power: 1506,
  });
  const owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.bypassCap, 3000);
  assert.equal(owner.inputs.batChg, 0);
  assert.notEqual(owner.label, "充电状态1");
  assert.equal(owner.label, "可放");
});

test("SoC=100 with no PV surplus is 可放 because batChg=0", () => {
  const ctx = loadCheckerRuntime();
  const device = cbe2000({ current_soc: 100, backup_soc: 20, pv_power_total: 0, offgrid1_export_power: 80 });
  const owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.batChg, 0);
  assert.equal(owner.label, "可放");
});

test("telemetry bat max charge and discharge both 0 is 禁充禁放", () => {
  const ctx = loadCheckerRuntime();
  const device = cbe2000({
    current_soc: 70,
    backup_soc: 20,
    inverter_input_power_limit: 2000,
    output_power_limit: 2000,
    battery_max_charge_power: 0,
    battery_max_discharge_power: 0,
  });
  const owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.batChg, 0);
  assert.equal(owner.inputs.batDchg, 0);
  assert.equal(owner.label, "禁充禁放");
});

test("AC input and output limits both 0 do not force 禁充禁放 workModel", () => {
  const ctx = loadCheckerRuntime();
  const device = cbe2000({
    current_soc: 70,
    backup_soc: 20,
    inverter_input_power_limit: 0,
    output_power_limit: 0,
    regulation_grid_export_p_limit: 0,
    pv_power_total: 0,
    offgrid1_export_power: 0,
  });
  const owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.inputs.gridLim, 0);
  assert.equal(owner.inputs.outLim, 0);
  assert.notEqual(owner.label, "禁充禁放");
  assert.equal(owner.chgCapW, 0);
  assert.equal(owner.dchgCapW, 0);
});

test("AC limits 0 with large Bypass still reports 充电状态1 with zero power", () => {
  const ctx = loadCheckerRuntime();
  const device = cbe2000({
    current_soc: 70,
    backup_soc: 20,
    inverter_input_power_limit: 0,
    output_power_limit: 0,
    pv_power_total: 0,
    offgrid1_export_power: 2000,
  });
  const owner = ctx.classifyOwnerWorkModel(device);
  assert.equal(owner.label, "充电状态1");
  assert.equal(owner.chgCapW, 0);
  assert.equal(owner.dchgCapW, 0);
});
