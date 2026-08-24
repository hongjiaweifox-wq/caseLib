/* Family device quick console */

const STORAGE_KEY = "groupAppControl.v1"; // legacy browser cache; migrated once to data/store.json

/** @type {{ cookies: Record<string,string>, homes: Home[], activeHomeId: string|null }} */
let state = { cookies: {}, homes: [], activeHomeId: null };
let persistTimer = null;
let storePath = "";

const ENV_CONFIG = {
  "newenergy-operation-cn.wgine-inc.com": {
    name: "中国预发",
    short: "CN-Pre",
    region: "cn",
    supported: true,
  },
  "newenergy-operation-cn.tuya-inc.com": {
    name: "中国线上",
    short: "CN-Prod",
    region: "cn",
    supported: true,
  },
  "newenergy-operation-eu.wgine-inc.com": {
    name: "欧洲预发",
    short: "EU-Pre",
    region: "eu",
    supported: true,
  },
  "newenergy-operation-eu.tuya-inc.com": {
    name: "欧洲线上",
    short: "EU-Prod",
    region: "eu",
    supported: true,
  },
  "newenergy-operation-us.wgine-inc.com": {
    name: "美国预发",
    short: "US-Pre",
    region: "us",
    supported: true,
  },
  "newenergy-operation-us.tuya-inc.com": {
    name: "美国线上",
    short: "US-Prod",
    region: "us",
    supported: true,
  },
  "newenergy-operation-sg.tuya-inc.com": {
    name: "新加坡线上",
    short: "SG-Prod",
    region: "sg",
    supported: true,
  },
  "newenergy-operation-weaz.tuya-inc.com": {
    name: "西欧线上",
    short: "WEAZ",
    region: "weaz",
    supported: true,
  },
  "newenergy-operation-ueaz.tuya-inc.com": {
    name: "美东线上",
    short: "UEAZ",
    region: "ueaz",
    supported: true,
  },
  "127.0.0.1": { name: "本机", short: "Local", region: "local", supported: true },
};

/** Hestia hosts for meter bizlog */
const HESTIA_ENVS = {
  "hestia-cn.tuya-inc.com": { name: "Hestia 中国线上", short: "H-CN", region: "cn" },
  "hestia-cn.wgine-inc.com": { name: "Hestia 中国预发", short: "H-CN-Pre", region: "cn" },
  "hestia-eu.tuya-inc.com": { name: "Hestia 欧洲线上", short: "H-EU", region: "eu" },
  "hestia-eu.wgine-inc.com": { name: "Hestia 欧洲预发", short: "H-EU-Pre", region: "eu" },
  "hestia-us.tuya-inc.com": { name: "Hestia 美国线上", short: "H-US", region: "us" },
  "hestia-us.wgine-inc.com": { name: "Hestia 美国预发", short: "H-US-Pre", region: "us" },
  "hestia-sg.tuya-inc.com": { name: "Hestia 新加坡线上", short: "H-SG", region: "sg" },
  "hestia-weaz.tuya-inc.com": { name: "Hestia 西欧线上", short: "H-WEAZ", region: "weaz" },
  "hestia-ueaz.tuya-inc.com": { name: "Hestia 美东线上", short: "H-UEAZ", region: "ueaz" },
};

/** backendng hosts（家庭设备列表 /inner/backendng/device/homeDevice） */
const BACKENDNG_ENVS = {
  "backendng-cn.tuya-inc.com": { name: "backendng 中国线上", short: "B-CN", region: "cn" },
  "backendng-cn.wgine-inc.com": { name: "backendng 中国预发", short: "B-CN-Pre", region: "cn" },
  "backendng-eu.tuya-inc.com": { name: "backendng 欧洲线上", short: "B-EU", region: "eu" },
  "backendng-eu.wgine-inc.com": { name: "backendng 欧洲预发", short: "B-EU-Pre", region: "eu" },
  "backendng-us.tuya-inc.com": { name: "backendng 美国线上", short: "B-US", region: "us" },
  "backendng-us.wgine-inc.com": { name: "backendng 美国预发", short: "B-US-Pre", region: "us" },
  "backendng-sg.tuya-inc.com": { name: "backendng 新加坡线上", short: "B-SG", region: "sg" },
  "backendng-weaz.tuya-inc.com": { name: "backendng 西欧线上", short: "B-WEAZ", region: "weaz" },
  "backendng-ueaz.tuya-inc.com": { name: "backendng 美东线上", short: "B-UEAZ", region: "ueaz" },
};

/** 登录态分组：amis(operation) / hestia / backendng */
const LOGIN_GROUPS = [
  { key: "amis", title: "amis（运营后台 · operation）", envs: ENV_CONFIG },
  { key: "hestia", title: "hestia（电表 bizlog）", envs: HESTIA_ENVS },
  { key: "backendng", title: "backendng（家庭设备列表）", envs: BACKENDNG_ENVS },
];

const METER_PID = "7sndpedu8g2tkzvi";
const METER_DP_ID = "29";
const METER_DP_CODE = "active_power";
/** 三方电表 / 无电表时电网节点：一体机「局域网电表配对功率」DP26 */
const METER_THIRD_DP_ID = "26";
const METER_THIRD_DP_CODE = "grid_power";
const METER_THIRD_MODEL_CODE = "meter_power";
const BIZLOG_EVENT_IDS =
  "1,2,3,4,5,6,7,8,9,10,11,12,13,14,21,36,38,39,40,41,42,43,44,45,46,47,51,52,53,54,56,57,59,60,61,62,63";

// [moved → checker/device-model.js] DEVICE_MODELS / UNKNOWN_MODEL

const DP_DISPLAY = [
  {
    code: "pv_power_total",
    label: "发电功率",
    unit: "W",
    tone: "",
    aliases: ["pv_power_total", "total_photovoltaic_power"],
  },
  {
    code: "battery_power",
    label: "电池功率",
    unit: "W",
    tone: "green",
    aliases: ["battery_power", "total_stack_power"],
  },
  {
    code: "grid_port_power",
    label: "并网口",
    unit: "W",
    tone: "blue",
    // DP27：勿与 DP26 grid_power/meter_power（局域网电表配对功率）混用
    aliases: ["grid_port_power", "inverter_output_power"],
  },
  {
    code: "current_soc",
    label: "SOC",
    unit: "%",
    tone: "",
    aliases: ["current_soc", "main_soc", "heap_soc"],
  },
  {
    code: "offgrid1_export_power",
    label: "离网口",
    unit: "W",
    tone: "",
    aliases: ["offgrid1_export_power"],
  },
];

const DP_EDITABLE = [
  {
    code: "backup_soc",
    label: "备用SOC",
    unit: "%",
    aliases: ["backup_soc", "backup_reserve", "min_soc_discharge"],
  },
  {
    code: "regulation_grid_export_p_limit",
    label: "输出最大值",
    unit: "W",
    useModelMax: true,
    aliases: ["regulation_grid_export_p_limit"],
  },
  { code: "output_power_limit", label: "输出限制", unit: "W", aliases: ["output_power_limit"] },
  {
    code: "inverter_input_power_limit",
    label: "输入限制",
    unit: "W",
    aliases: ["inverter_input_power_limit"],
  },
];

const ALL_FIELDS = [...DP_DISPLAY, ...DP_EDITABLE];
const ALL_CODES = ALL_FIELDS.map((d) => d.code);

/** 影子只读点：不进①区网格，供能量流 BMS 等展示 */
const DP_SHADOW_EXTRA = [
  {
    code: "battery_capacity",
    label: "电池容量",
    unit: "kWh",
    aliases: ["battery_capacity"],
  },
  {
    // DP26：局域网电表配对功率（无实体电表时供「电网 Grid」节点显示）
    code: "meter_power",
    label: "局域网电表配对功率",
    unit: "W",
    aliases: ["meter_power", "grid_power"],
    dpCode: "grid_power",
    fallbackDpId: METER_THIRD_DP_ID,
  },
  {
    // DP98：多机协同实际工况（主机报文含全员；从机仅本机）
    code: "command_receive",
    label: "协同命令接收",
    unit: "",
    aliases: ["command_receive"],
    dpCode: "command_receive",
    fallbackDpId: "98",
    dpSchema: { type: "raw", maxlen: 128 },
  },
  { code: "pv_power_channel_1", label: "PV1", unit: "W", aliases: ["pv_power_channel_1"] },
  { code: "pv_power_channel_2", label: "PV2", unit: "W", aliases: ["pv_power_channel_2"] },
  { code: "pv_power_channel_3", label: "PV3", unit: "W", aliases: ["pv_power_channel_3"] },
  { code: "pv_power_channel_4", label: "PV4", unit: "W", aliases: ["pv_power_channel_4"] },
];
const DP_SHADOW_EXTRA_CODES = DP_SHADOW_EXTRA.map((d) => d.code);

// [moved → checker/device-model.js] DP98_MASTER_NUMER

/** Home-side params: issue to every device in the home. */
const HOME_FAMILY_FIELDS = [
  {
    code: "work_mode",
    label: "工作模式",
    unit: "",
    via: "dp",
    dpCode: "work_mode",
    fallbackDpId: "51",
    type: "enum",
    options: [
      { value: "self_powered", label: "自发自用" },
      { value: "time_of_use", label: "分时用电" },
      { value: "manual", label: "手动设置" },
      { value: "plug", label: "插座优先" },
      { value: "diy", label: "DIY" },
    ],
    aliases: ["work_mode"],
  },
  {
    code: "home_max_current",
    label: "最大电流限制(防总闸线路满载-规划中)",
    unit: "A",
    via: "function_set",
    type: "enum",
    options: ["10", "16", "20", "32", "40", "63"].map((v) => ({ value: v, label: `${v}A` })),
    // 物模型 → function_set(52) register
    regAddr: 0x401d,
    signed: false,
  },
  {
    code: "home_allowed_backflow_power",
    label: "逆流上限功率",
    unit: "W",
    via: "function_set",
    type: "number",
    regAddr: 0x4002,
    signed: false,
  },
  {
    code: "total_plug_power",
    label: "插座功率(智能电器·设备上报后下发)",
    unit: "W",
    via: "function_set",
    type: "number",
    regAddr: 0x5002,
    signed: true,
  },
  {
    code: "base_load",
    label: "基础负载功率(传统负载·用户手输)",
    unit: "W",
    via: "dp",
    dpCode: "base_load",
    fallbackDpId: "91",
    type: "number",
    aliases: ["base_load"],
  },
];

const HOME_SHADOW_FIELDS = HOME_FAMILY_FIELDS.filter((f) => f.via === "dp");
const HOME_MODEL_CODES = HOME_FAMILY_FIELDS.filter((f) => f.via === "function_set").map((f) => f.code);

/** 设备侧物模型只读点（property-query），不进家庭下发 */
const DEVICE_MODEL_READONLY = [
  {
    code: "device_cluster_role",
    label: "集群角色",
    via: "function_set",
    unit: "",
  },
  {
    code: "device_cluster_node_id",
    label: "集群身份id",
    via: "function_set",
    unit: "",
  },
];

/** 所有需从 property-query 拉取的物模型 code */
const ALL_MODEL_CODES = [
  ...HOME_MODEL_CODES,
  ...DEVICE_MODEL_READONLY.map((f) => f.code),
];

/**
 * device_cluster_role 文案：0 主机 / 1 从机 / 2 选举中 / 3 未使能集群。
 * @returns {string|null} null = 尚未读到值
 */
function clusterRoleLabel(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (n === 0) return "主机";
  if (n === 1) return "从机";
  if (n === 2) return "选举中";
  if (n === 3) return "未使能集群";
  if (Number.isFinite(n)) return `角色${n}`;
  return String(raw);
}

/**
 * 集群身份 id（function_set / device_cluster_node_id）。
 * @returns {string|null} 有值返回规范化字符串；空/未读返回 null（按单机）
 */
function deviceClusterNodeId(deviceOrRaw) {
  const raw =
    deviceOrRaw && typeof deviceOrRaw === "object"
      ? deviceOrRaw.values?.device_cluster_node_id
      : deviceOrRaw;
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

/** 有 device_cluster_node_id 则进对应集群框；否则单机。 */
function isClusterBoxMember(deviceOrRaw) {
  return deviceClusterNodeId(deviceOrRaw) != null;
}

/**
 * 按 device_cluster_node_id 分多集群；无 id 的进 solos。
 * 集群内优先主机(role=0)，再从机，其余按原序。
 * @returns {{ clusters: { nodeId: string, devices: object[] }[], solos: object[] }}
 */
function groupDevicesByCluster(devices) {
  const list = Array.isArray(devices) ? devices : [];
  const byNode = new Map();
  const solos = [];
  for (const d of list) {
    const nid = deviceClusterNodeId(d);
    if (nid == null) {
      solos.push(d);
      continue;
    }
    if (!byNode.has(nid)) byNode.set(nid, []);
    byNode.get(nid).push(d);
  }
  const roleRank = (d) => {
    const n = Number(d?.values?.device_cluster_role);
    if (n === 0) return 0;
    if (n === 1) return 1;
    if (Number.isFinite(n)) return 10 + n;
    return 99;
  };
  const clusters = [...byNode.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en"))
    .map(([nodeId, devs]) => ({
      nodeId,
      devices: [...devs].sort((a, b) => roleRank(a) - roleRank(b)),
    }));
  return { clusters, solos };
}

// [moved → checker/owner-model.js] OWNER_WORK_MODEL + classifyOwnerWorkModel (S1-S13)

function openOwnerStrategyDialog(home, device) {
  const dlg = document.getElementById("dlgOwnerStrat");
  if (!dlg || !device) return;
  const owner = classifyOwnerWorkModel(device);
  const title = document.getElementById("dlgOwnerStratTitle");
  const body = document.getElementById("dlgOwnerStratBody");
  const escFn = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s ?? "");
  title.textContent = `上报策略 · ${device.name || device.deviceId}`;
  if (!owner) {
    body.innerHTML = `<p class="hint">尚未读到足够实时量，无法判定。请先「一键读取」。</p>`;
  } else {
    const inp = owner.inputs || {};
    body.innerHTML = `
      <div class="owner-dlg-head">
        <span class="u3-role owner m${owner.model}">${escFn(owner.label)}</span>
        <span class="hint">可充 ${owner.chgCapW}W · 可放 ${owner.dchgCapW}W</span>
      </div>
      <p class="hint" style="margin:8px 0 4px">命中原因：${escFn(owner.reason)}</p>
      <pre class="owner-formula">${escFn(owner.formula || "")}</pre>
      <div class="owner-inputs">
        <div><b>代入量</b></div>
        <div>SoC ${inp.soc}% · 备用 ${inp.back}%</div>
        <div>PV ${inp.pv}W · Bypass ${inp.bypass}W</div>
        <div>电池最大充 ${inp.batChg}W${inp.fullChg ? "（满电回差置 0）" : inp.chgMapCurr != null ? `（电芯表档 ${inp.chgMapCurr} · ${inp.chgMapTempC}℃）` : ""} · 最大放 ${inp.batDchg}W</div>
        <div>并网充限 ${inp.gridLim}W · 输出限 ${inp.outLim}W · 逆变上限 ${inp.bypassCap}W</div>
      </div>
      <p class="hint" style="margin-top:10px">依据：飞书《从机状态判》· owner_infomation_package（grid 口能力上报主机）</p>`;
  }
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
}

// [moved → checker/dp98.js] DP98 command_receive parse/pick/apply

/** 一体机「更多点位」对照表（维度 / dpid / dpcode / 物模型 code） */
const DEVICE_MORE_POINTS = [
  {
    label: "家庭-工作模式",
    dpId: "51",
    dpCode: "work_mode",
    modelCode: "work_mode",
    unit: "",
    valueKeys: ["work_mode"],
  },
  {
    label: "家庭-最大电流限制",
    dpId: "52",
    dpCode: "function_set",
    modelCode: "home_max_current",
    unit: "A",
    valueKeys: ["home_max_current"],
  },
  {
    label: "家庭-逆流上限功率",
    dpId: "52",
    dpCode: "function_set",
    modelCode: "home_allowed_backflow_power",
    unit: "W",
    valueKeys: ["home_allowed_backflow_power"],
  },
  {
    label: "家庭-插座功率",
    dpId: "52",
    dpCode: "function_set",
    modelCode: "total_plug_power",
    unit: "W",
    valueKeys: ["total_plug_power"],
  },
  {
    label: "集群角色",
    dpId: "52",
    dpCode: "function_set",
    modelCode: "device_cluster_role",
    unit: "",
    valueKeys: ["device_cluster_role"],
  },
  {
    label: "集群身份id",
    dpId: "52",
    dpCode: "function_set",
    modelCode: "device_cluster_node_id",
    unit: "",
    valueKeys: ["device_cluster_node_id"],
  },
  {
    label: "家庭-基础负载功率",
    dpId: "91",
    dpCode: "base_load",
    modelCode: "base_load",
    unit: "W",
    valueKeys: ["base_load"],
  },
  {
    label: "发电功率",
    dpId: "20",
    dpCode: "pv_power_total",
    modelCode: "total_photovoltaic_power",
    unit: "W",
    valueKeys: ["pv_power_total", "total_photovoltaic_power"],
  },
  {
    label: "电池功率",
    dpId: "25",
    dpCode: "battery_power",
    modelCode: "total_stack_power",
    unit: "W",
    valueKeys: ["battery_power", "total_stack_power"],
  },
  {
    label: "电池容量",
    dpId: "2",
    dpCode: "battery_capacity",
    modelCode: "battery_capacity",
    unit: "kWh",
    valueKeys: ["battery_capacity"],
  },
  {
    label: "并网口",
    dpId: "27",
    dpCode: "inverter_output_power",
    modelCode: "grid_port_power",
    unit: "W",
    valueKeys: ["grid_port_power", "inverter_output_power"],
  },
  {
    label: "SOC",
    dpId: "23",
    dpCode: "current_soc",
    modelCode: "heap_soc",
    unit: "%",
    valueKeys: ["current_soc", "main_soc", "heap_soc"],
  },
  {
    label: "离网口",
    dpId: "38",
    dpCode: "offgrid1_export_power",
    modelCode: "offgrid1_export_power",
    unit: "W",
    valueKeys: ["offgrid1_export_power"],
  },
  {
    label: "备用SOC",
    dpId: "50",
    dpCode: "backup_reserve",
    modelCode: "min_soc_discharge",
    unit: "%",
    valueKeys: ["backup_soc", "backup_reserve", "min_soc_discharge"],
  },
  {
    label: "输出最大值",
    dpId: "84",
    dpCode: "regulation_grid_export_p_limit",
    modelCode: "regulation_grid_export_p_limit",
    unit: "W",
    valueKeys: ["regulation_grid_export_p_limit"],
  },
  {
    label: "输出限制",
    dpId: "53",
    dpCode: "output_power_limit",
    modelCode: "output_power_limit",
    unit: "W",
    valueKeys: ["output_power_limit"],
  },
  {
    label: "输入限制",
    dpId: "69",
    dpCode: "inverter_input_power_limit",
    modelCode: "inverter_input_power_limit",
    unit: "W",
    valueKeys: ["inverter_input_power_limit"],
  },
  {
    label: "局域网电表配对功率",
    dpId: "26",
    dpCode: "grid_power",
    modelCode: "meter_power",
    unit: "W",
    valueKeys: ["meter_power", "grid_power"],
  },
];

function schemaEntryByDpId(schema, dpId) {
  const id = String(dpId ?? "");
  if (!id) return null;
  return Object.values(schema || {}).find((e) => String(e?.dpId) === id) || null;
}

/**
 * @brief Resolve schema hit for inSchema; table columns always use catalog mapping
 */
function morePointDisplay(device, point) {
  const schema = device?.schema || {};
  if (point.dpCode === "function_set") {
    return {
      label: point.label || point.modelCode,
      dpId: point.dpId,
      dpCode: point.dpCode,
      modelCode: point.modelCode,
      inSchema: !!(schema.function_set || schema[point.modelCode]),
    };
  }
  const hit =
    schemaEntryByDpId(schema, point.dpId) ||
    schema[point.dpCode] ||
    schema[point.modelCode] ||
    (point.valueKeys || []).map((k) => schema[k]).find(Boolean) ||
    null;
  return {
    label: point.label || point.modelCode,
    dpId: point.dpId,
    dpCode: point.dpCode,
    modelCode: point.modelCode,
    inSchema: !!hit,
  };
}

function lookupDevicePointValue(device, point) {
  const values = device?.values || {};
  for (const key of point.valueKeys || [point.modelCode, point.dpCode]) {
    if (values[key] != null && values[key] !== "") return values[key];
  }
  return null;
}

function formatPointValue(raw, point) {
  if (raw == null || raw === "") return "—";
  if (point.modelCode === "device_cluster_role") {
    const role = clusterRoleLabel(raw);
    return role ? `${role} (${raw})` : String(raw);
  }
  if (point.dpCode === "work_mode" || point.modelCode === "work_mode") {
    const field = HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode");
    const hit = (field?.options || []).find((o) => String(o.value) === String(raw));
    return hit ? `${hit.label} (${raw})` : String(raw);
  }
  if (typeof raw === "number" || isFiniteNumber(raw)) {
    const n = Number(raw);
    return point.unit ? `${n}${point.unit}` : String(n);
  }
  return String(raw);
}

let devicePointsCtx = null; // { home, device }
let deviceVersionCache = { deviceId: "", html: "" };

function openDevicePointsDialog(home, device) {
  if (!device) return;
  devicePointsCtx = { home, device };
  const title = document.getElementById("dlgDevicePointsTitle");
  const hint = document.getElementById("dlgDevicePointsHint");
  const tbody = document.querySelector("#devicePointsTable tbody");
  title.textContent = `设备详情 · ${device.name || device.deviceId}`;
  hint.textContent = `设备 ID ${device.deviceId}${
    device.reportTime ? ` · 上报 ${fmtTime(device.reportTime)}` : " · 尚未读取"
  }`;
  tbody.innerHTML = DEVICE_MORE_POINTS.map((p) => {
    const raw = lookupDevicePointValue(device, p);
    const shown = morePointDisplay(device, p);
    const missing = Object.keys(device.schema || {}).length > 0 && !shown.inSchema && p.dpCode !== "function_set";
    const fsMissing =
      p.dpCode === "function_set" &&
      Object.keys(device.schema || {}).length > 0 &&
      !device.schema.function_set &&
      raw == null;
    const rowMissing = missing || fsMissing;
    return `<tr class="${rowMissing ? "point-missing" : ""}">
      <td><span class="point-dim">${escapeHtml(shown.label)}</span></td>
      <td>${escapeHtml(shown.dpId)}</td>
      <td><code>${escapeHtml(shown.dpCode)}</code></td>
      <td><code>${escapeHtml(shown.modelCode)}</code></td>
      <td class="point-val">${escapeHtml(formatPointValue(raw, p))}</td>
    </tr>`;
  }).join("");
  switchDevicePointsTab("points");
  document.getElementById("dlgDevicePoints").showModal();
}

function switchDevicePointsTab(tab) {
  const points = tab !== "version";
  document.querySelectorAll("#devicePointsTabs [data-points-tab]").forEach((btn) => {
    const on = btn.getAttribute("data-points-tab") === (points ? "points" : "version");
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("devicePointsPanel")?.classList.toggle("hidden", !points);
  document.getElementById("deviceVersionPanel")?.classList.toggle("hidden", points);
  if (!points) loadDeviceVersionPanel();
}

/**
 * @brief Unwrap backendng /api/device/detail payload → result object
 * @param[in] payload proxy or upstream JSON
 * @return {{ dataPoints?: Array, deviceMetaShowVOList?: Array, modules?: Array }}
 */
function unwrapDeviceDetail(payload) {
  const root = unwrapResult(payload);
  return root && typeof root === "object" ? root : {};
}

/**
 * @brief WiFi / MCU versions from device detail modules[]
 * @param[in] payload proxy JSON or detail result
 * @return {{ wifi: string, mcu: string }}
 */
function parseWifiMcuVersions(payload) {
  const root = unwrapDeviceDetail(payload);
  const modules = Array.isArray(root?.modules)
    ? root.modules
    : Array.isArray(root?.moduleList)
      ? root.moduleList
      : [];
  let wifi = "";
  let mcu = "";
  for (const m of modules) {
    const key = String(m?.typeDesc || "")
      .trim()
      .toLowerCase()
      .replace(/-/g, "");
    const ver = m?.verSw != null && m.verSw !== "" ? String(m.verSw) : "";
    if (!ver) continue;
    if (key === "wifi") wifi = ver;
    else if (key === "mcu") mcu = ver;
  }
  return { wifi, mcu };
}

/**
 * @brief Read deviceMetaShowVOList entry by code (e.g. ssid_hash)
 * @param[in] payload proxy JSON, detail result, or meta list
 * @param[in] code meta code
 * @return string value or ""
 */
function parseDeviceMetaValue(payload, code) {
  const want = String(code || "").trim().toLowerCase();
  if (!want) return "";
  let list = null;
  if (Array.isArray(payload)) {
    list = payload;
  } else {
    const root = unwrapDeviceDetail(payload);
    list = root?.deviceMetaShowVOList;
  }
  if (!Array.isArray(list)) return "";
  const hit = list.find((m) => String(m?.code || "").trim().toLowerCase() === want);
  if (!hit || hit.value == null || hit.value === "") return "";
  return String(hit.value);
}

/**
 * @brief Index device-detail dataPoints for DP matching (replaces shadowProperty list)
 * @param[in] dataPoints detail.result.dataPoints
 * @return {{ byCode: Object, byId: Object, latest: number|null }}
 */
function indexDetailDataPoints(dataPoints) {
  const byCode = {};
  const byId = {};
  let latest = null;
  const items = Array.isArray(dataPoints) ? dataPoints : [];
  for (const it of items) {
    const code = it.code || it.dpCode;
    if (code) byCode[code] = it;
    const id = it.dpId != null ? it.dpId : it.propertyId;
    if (id != null) byId[String(id)] = it;
    const t = Number(it.time || it.reportTime || 0);
    if (t && (!latest || t > latest)) latest = t;
  }
  return { byCode, byId, latest };
}

async function fetchDeviceDetail(home, deviceId, _retried = false) {
  const region = (ENV_CONFIG[home.envHost] || {}).region || "cn";
  const bnHost = `backendng-${region}.tuya-inc.com`;
  const cookie = resolveCookie(home.envHost);
  const { text } = await CaseApi.getDeviceDetail(bnHost, cookie, deviceId);
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    if (/<!DOCTYPE|统一登录|login-form|涂鸦统一登录/i.test(text)) {
      throw new AuthExpiredError("登录已失效，请点「数据区登录态」自动获取 Cookie");
    }
    throw new Error("版本信息接口不可用，请重启本地服务后重试");
  }
  try {
    assertProxyPayload(json);
    return json;
  } catch (err) {
    if (!_retried && err?.code === "AUTH_EXPIRED") {
      try {
        await refreshSsoCookieOnce({ quiet: true, skipRender: true, host: home.envHost, notify: true });
      } catch (refreshErr) {
        throw new AuthExpiredError(
          `登录已失效，自动刷新失败：${refreshErr.message || refreshErr}`
        );
      }
      return fetchDeviceDetail(home, deviceId, true);
    }
    if (err?.code === "AUTH_EXPIRED") {
      throw new AuthExpiredError("登录已失效，自动刷新后仍失败，请手动点「自动获取」或重新粘贴 Cookie");
    }
    throw err;
  }
}

/**
 * @brief Stable color tone for an SSID value (same hash → same color)
 * @param[in] ssid ssid_hash string
 * @return {{ color: string, background: string, border: string }|null}
 */
function ssidTone(ssid) {
  const s = String(ssid || "").trim();
  if (!s) {
    return null;
  }
  const palette = [
    { color: "#1d4ed8", background: "#dbeafe", border: "#93c5fd" },
    { color: "#b45309", background: "#ffedd5", border: "#fdba74" },
    { color: "#047857", background: "#d1fae5", border: "#6ee7b7" },
    { color: "#7e22ce", background: "#f3e8ff", border: "#d8b4fe" },
    { color: "#be123c", background: "#ffe4e6", border: "#fda4af" },
    { color: "#0f766e", background: "#ccfbf1", border: "#5eead4" },
    { color: "#c2410c", background: "#ffedd5", border: "#fb923c" },
    { color: "#4338ca", background: "#e0e7ff", border: "#a5b4fc" },
  ];
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return palette[Math.abs(h) % palette.length];
}

/**
 * @brief Inline style for SSID value chip (equal SSIDs share tone)
 * @param[in] ssid ssid_hash
 * @return CSS style attribute string (may be empty)
 */
function ssidToneStyleAttr(ssid) {
  const tone = ssidTone(ssid);
  if (!tone) {
    return "";
  }
  return ` style="color:${tone.color};background:${tone.background};border:1px solid ${tone.border}"`;
}

function versionRowHtml(lab, val, opts = {}) {
  const empty = !val;
  const isSsid = String(lab || "").toUpperCase() === "SSID";
  const toneAttr = !empty && isSsid ? ssidToneStyleAttr(val) : "";
  const valCls = empty
    ? "ver-val ver-empty"
    : isSsid
      ? "ver-val ver-ssid"
      : "ver-val";
  return `<div class="ver-row">
    <span class="ver-lab">${escapeHtml(lab)}</span>
    <span class="${valCls}"${toneAttr}>${escapeHtml(empty ? "—" : val)}</span>
  </div>`;
}

async function loadDeviceVersionPanel() {
  const body = document.getElementById("deviceVersionBody");
  const ctx = devicePointsCtx;
  if (!body || !ctx?.device) return;
  const deviceId = ctx.device.deviceId;
  if (deviceVersionCache.deviceId === deviceId && deviceVersionCache.html) {
    body.innerHTML = deviceVersionCache.html;
    return;
  }
  body.innerHTML = `<div class="hint">正在查询版本信息…</div>`;
  try {
    const json = await fetchDeviceDetail(ctx.home, deviceId);
    const detail = unwrapDeviceDetail(json);
    applyDeviceDetailMeta(ctx.device, detail);
    const { wifi, mcu } = parseWifiMcuVersions(json);
    const ssid = ctx.device?.ssidHash || parseDeviceMetaValue(json, "ssid_hash");
    const ip = ctx.device?.ip || (detail.device && detail.device.ip) || "";
    const html =
      versionRowHtml("模组版本（WiFi）", wifi) +
      versionRowHtml("MCU 版本", mcu) +
      versionRowHtml("IP", ip) +
      versionRowHtml("SSID", ssid);
    deviceVersionCache = { deviceId, html };
    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = `<div class="ver-err">${escapeHtml(err.message || String(err))}</div>`;
  }
}

/** Normalize register address for protocol-model strategySpecString (hex digits, no 0x). */
function normalizeRegAddrInput(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/^0x/i, "").replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]+$/.test(s)) return "";
  return s.toLowerCase().replace(/^0+(?=[0-9a-f])/, "") || "0";
}

let regQueryCtx = null; // { home, device, protocol }
let regQueryMode = "property"; // property | bizlog

/**
 * Step1: protocol/query → energyModelType / protocolCode / protocolPlan
 */
async function fetchDeviceProtocolInfo(home, device) {
  const res = await CaseApi.queryProtocol(home, { deviceId: device.deviceId });
  const data = unwrapResult(res);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("protocol/query 无数据");
  }
  const energyModelType = row.energyModelType || row.modelType || "";
  const protocolCode = row.protocolCode != null ? String(row.protocolCode) : "";
  const protocolPlan = row.protocolPlan != null ? String(row.protocolPlan) : "";
  if (!energyModelType || protocolCode === "") {
    throw new Error("缺少 energyModelType / protocolCode");
  }
  const protocol = { energyModelType, protocolCode, protocolPlan };
  device.protocol = { ...(device.protocol || {}), ...protocol };
  return protocol;
}

/**
 * Step2: protocol-model page by register → code
 */
async function lookupCodeByRegister(home, protocol, regHex) {
  const res = await CaseApi.queryProtocolModelPage(home, {
    energyModelType: protocol.energyModelType,
    protocolCode: protocol.protocolCode,
    sortType: "",
    page: "1",
    strategySpecString: regHex,
    perPage: "10",
  });
  const data = unwrapResult(res);
  const list = Array.isArray(data)
    ? data
    : data?.list || data?.records || data?.items || data?.rows || [];
  if (!list.length) {
    throw new Error(`未找到寄存器 ${regHex} 对应物模型`);
  }
  // Prefer exact register match when multiple hits
  const want = regHex.toLowerCase();
  const exact = list.find((it) => {
    const addr = parseRegAddr(it?.model?.strategySpec || it?.strategySpec);
    if (addr == null) return false;
    return addr.toString(16).toLowerCase() === want;
  });
  const hit = exact || list[0];
  const code = hit.code || hit.modelCode || hit?.model?.code;
  if (!code) throw new Error("反查结果无 code");
  return { code: String(code), hit, list };
}

/**
 * Step3: property/query by code → value
 */
async function fetchPropertyByCode(home, device, code) {
  const res = await CaseApi.queryProperties(home, {
    page: "1",
    deviceId: device.deviceId,
    code,
  });
  const data = unwrapResult(res);
  const items = Array.isArray(data) ? data : data?.data || data?.items || data?.list || [];
  const hit =
    (Array.isArray(items) && items.find((it) => (it.code || it.dpCode) === code)) ||
    (Array.isArray(items) && items[0]) ||
    null;
  return { items: Array.isArray(items) ? items : [], hit };
}

function renderRegQueryMeta(protocol, errText) {
  const el = document.getElementById("regQueryMeta");
  if (!el) return;
  if (errText) {
    el.innerHTML = `<span style="color:#b91c1c">${escapeHtml(errText)}</span>`;
    return;
  }
  if (!protocol) {
    el.textContent = "加载协议信息…";
    return;
  }
  el.innerHTML = `
    <div><b>energyModelType</b> · <code>${escapeHtml(protocol.energyModelType)}</code></div>
    <div><b>protocolCode</b> · <code>${escapeHtml(protocol.protocolCode)}</code></div>
    <div><b>protocolPlan</b> · <code>${escapeHtml(protocol.protocolPlan || "—")}</code></div>`;
}

function setRegQueryResult(content, isHtml) {
  const el = document.getElementById("regQueryResult");
  if (!el) return;
  el.hidden = false;
  if (isHtml) el.innerHTML = content;
  else el.textContent = content;
}

function resolveRegQueryDpIds() {
  return String(document.getElementById("regQueryDpPick")?.value || "").trim();
}

/**
 * Hestia 数据中心日志页：当前设备 + 选中 DP。
 * @param {{host:string, deviceId:string, dpId:string}} opts
 * @return {string}
 */
function hestiaDataCenterLogUrl(opts) {
  const rawHost = String(opts?.host || "hestia-cn.tuya-inc.com").replace(/^https?:\/\//, "");
  const origin = rawHost.includes(":") ? `https://${rawHost}` : `https://${rawHost}:7799`;
  const qs = new URLSearchParams();
  qs.set("devId", String(opts?.deviceId || ""));
  qs.set("eventIds[0]", BIZLOG_EVENT_IDS);
  qs.set("dpIds[0]", String(opts?.dpId || ""));
  qs.set("select", "devId");
  qs.set("pageOffset", "0");
  qs.set("logType", "");
  qs.set("gmt", "+08:00");
  return `${origin}/#/dataCenter/home/dataCenterList?${qs.toString()}`;
}

function syncRegQueryDpMoreHref() {
  const a = document.getElementById("regQueryDpMore");
  if (!a) return;
  const deviceId = String(regQueryCtx?.device?.deviceId || "").trim();
  const dpId = resolveRegQueryDpIds();
  if (!deviceId || !dpId) {
    a.removeAttribute("href");
    a.setAttribute("aria-disabled", "true");
    return;
  }
  const host = regQueryCtx?.home ? hestiaHostForHome(regQueryCtx.home) : "hestia-cn.tuya-inc.com";
  a.href = hestiaDataCenterLogUrl({ host, deviceId, dpId });
  a.removeAttribute("aria-disabled");
}

function openRegQueryDpMore(ev) {
  if (ev) ev.preventDefault();
  const deviceId = String(regQueryCtx?.device?.deviceId || "").trim();
  const dpId = resolveRegQueryDpIds();
  if (!deviceId) {
    toast("没有设备", "error");
    return;
  }
  if (!dpId) {
    toast("请先选择 type=raw 的 DP", "error");
    return;
  }
  const host = regQueryCtx?.home ? hestiaHostForHome(regQueryCtx.home) : "hestia-cn.tuya-inc.com";
  const url = hestiaDataCenterLogUrl({ host, deviceId, dpId });
  syncRegQueryDpMoreHref();
  window.open(url, "_blank", "noopener,noreferrer");
}

function fillRegQueryDpSelect(dps) {
  const sel = document.getElementById("regQueryDpPick");
  if (!sel) return;
  if (!dps.length) {
    sel.innerHTML = `<option value="">该 PID 没有 type=raw 的 DP</option>`;
    syncRegQueryDpMoreHref();
    return;
  }
  sel.innerHTML = dps
    .map(
      (d) =>
        `<option value="${escapeHtml(d.dpId)}">${escapeHtml(d.name || "")}(${escapeHtml(d.dpId)})</option>`
    )
    .join("");
  const prefer = dps.find((d) => String(d.dpId) === "52") || dps[0];
  if (prefer) sel.value = String(prefer.dpId);
  syncRegQueryDpMoreHref();
}

async function loadRegQueryRawDps() {
  const sel = document.getElementById("regQueryDpPick");
  const pid = String(regQueryCtx?.device?.pid || "").trim();
  if (!sel) return;
  if (!pid) {
    sel.innerHTML = `<option value="">设备无 PID，无法拉取 DP</option>`;
    return;
  }
  if (regQueryCtx?.rawDpsPid === pid && Array.isArray(regQueryCtx.rawDps)) {
    fillRegQueryDpSelect(regQueryCtx.rawDps);
    return;
  }
  sel.innerHTML = `<option value="">加载 raw DP…</option>`;
  try {
    const json = await CaseApi.getBeidouDpAbility(pid);
    if (!json?.ok) throw new Error(json?.error || "拉取 DP 列表失败");
    const dps = Array.isArray(json.dps) ? json.dps : [];
    if (regQueryCtx) {
      regQueryCtx.rawDps = dps;
      regQueryCtx.rawDpsPid = pid;
    }
    fillRegQueryDpSelect(dps);
  } catch (err) {
    sel.innerHTML = `<option value="">${escapeHtml(err.message || "加载失败")}</option>`;
  }
}

function switchRegQueryMode(mode) {
  regQueryMode = mode === "bizlog" ? "bizlog" : "property";
  document.querySelectorAll("#regQueryTabs [data-reg-mode]").forEach((btn) => {
    const on = btn.getAttribute("data-reg-mode") === regQueryMode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  const dpRow = document.getElementById("regQueryDpRow");
  if (dpRow) dpRow.classList.toggle("hidden", regQueryMode !== "bizlog");
  const meta = document.getElementById("regQueryMeta");
  if (meta) {
    if (regQueryMode === "bizlog") {
      const host = regQueryCtx?.home ? hestiaHostForHome(regQueryCtx.home) : "";
      meta.innerHTML = `
        <div>查 Hestia bizlog 原始上报报文，匹配寄存器地址（支持 <code>8000</code> / <code>80 00</code>）。</div>
        <div><b>Hestia</b> · <code>${escapeHtml(host || "—")}</code></div>
        <div><b>PID</b> · <code>${escapeHtml(regQueryCtx?.device?.pid || "—")}</code></div>`;
      loadRegQueryRawDps();
      syncRegQueryDpMoreHref();
    } else if (regQueryCtx?.protocol) {
      renderRegQueryMeta(regQueryCtx.protocol);
    }
  }
}

function u16be(bytes, i) {
  return (((bytes[i] & 0xff) << 8) | (bytes[i + 1] & 0xff)) & 0xffff;
}

function unwrapBizlogDetail(raw) {
  if (raw == null) return "";
  if (raw instanceof Uint8Array || (Array.isArray(raw) && raw.every((x) => Number.isInteger(x)))) {
    return raw;
  }
  if (typeof raw === "object") {
    return unwrapBizlogDetail(
      raw.value || raw.dpValue || raw.raw || raw.hex || raw.base64 || raw.data || raw.content
    );
  }
  const s = String(raw).trim();
  if (!s) return "";
  if ((s.startsWith("{") || s.startsWith("[")) && (s.includes("value") || s.includes("dpValue"))) {
    try {
      return unwrapBizlogDetail(JSON.parse(s));
    } catch (_) {
      /* keep original */
    }
  }
  return s;
}

function bytesFromHexDump(s) {
  const hex = String(s).replace(/[\s:,\-]/g, "");
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 12 || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesFromBase64(s) {
  try {
    const compact = String(s).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = compact + "=".repeat((4 - (compact.length % 4)) % 4);
    const bin = atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out.length ? out : null;
  } catch (_) {
    return null;
  }
}

function scoreRegPayload(bytes) {
  if (!bytes || bytes.length < 6) return 0;
  let score = 0;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0x03 && bytes[i + 1] === 0x01) score += 12;
    if (bytes[i] === 0x01 && bytes[i + 1] === 0x01 && i + 3 < bytes.length) {
      const addr = u16be(bytes, i + 2);
      score += addr >= 0x8000 ? 8 : 2;
    }
  }
  return score;
}

function decodeBizlogPayloadBytes(raw) {
  if (raw == null) return null;
  if (raw instanceof Uint8Array) return raw;
  if (Array.isArray(raw) && raw.every((x) => Number.isInteger(x))) {
    return Uint8Array.from(raw.map((x) => x & 0xff));
  }
  const s = unwrapBizlogDetail(raw);
  if (s instanceof Uint8Array) return s;
  if (Array.isArray(s)) return Uint8Array.from(s.map((x) => Number(x) & 0xff));
  if (!s) return null;
  const cands = [];
  const fromHex = bytesFromHexDump(s);
  if (fromHex) cands.push(fromHex);
  const fromB64 = bytesFromBase64(s);
  if (fromB64) cands.push(fromB64);
  if (typeof _rawToBytes === "function") {
    const extra = _rawToBytes(s);
    if (extra && extra.length) cands.push(extra);
  }
  const hexChunk = String(s).match(/[0-9a-fA-F]{2}(?:[\s,:-][0-9a-fA-F]{2}){7,}/);
  if (hexChunk) {
    const dumped = bytesFromHexDump(hexChunk[0]);
    if (dumped) cands.push(dumped);
  }
  if (!cands.length) return null;
  cands.sort((a, b) => scoreRegPayload(b) - scoreRegPayload(a) || b.length - a.length);
  return cands[0];
}

/**
 * Parse function_set / DP98 raw: [fnl][soc][grid_be] 03 01 + repeat(01 01 addr_be val_be).
 * Also accepts 5-byte 01 addr_be val_be when addr >= 0x8000 (cluster regs).
 * Header 03 01 may sit after a short prefix (旧：1B fnl；新：4B fnl+SOC+grid)。
 */
function parseFunctionSetEntries(payload) {
  const entries = [];
  if (!payload || !payload.length) return entries;
  const starts = [0];
  for (let j = 0; j + 1 < payload.length; j++) {
    if (payload[j] === 0x03 && payload[j + 1] === 0x01) starts.push(j + 2);
    if (j + 2 < payload.length && payload[j + 1] === 0x03 && payload[j + 2] === 0x01) {
      starts.push(j + 3);
    }
  }
  const seen = new Set();
  for (const start of starts) {
    let i = start;
    while (i + 4 < payload.length) {
      if (payload[i] === 0x01 && payload[i + 1] === 0x01 && i + 5 < payload.length) {
        const addr = u16be(payload, i + 2);
        const value = u16be(payload, i + 4);
        const key = `${i}:6:${addr}`;
        if (!seen.has(key)) {
          seen.add(key);
          entries.push({ addr, value, offset: i });
        }
        i += 6;
        continue;
      }
      if (payload[i] === 0x01 && payload[i + 1] !== 0x01) {
        const addr = u16be(payload, i + 1);
        if (addr >= 0x8000 && i + 4 < payload.length) {
          const value = u16be(payload, i + 3);
          const key = `${i}:5:${addr}`;
          if (!seen.has(key)) {
            seen.add(key);
            entries.push({ addr, value, offset: i });
          }
          i += 5;
          continue;
        }
      }
      i += 1;
    }
  }
  return entries;
}

function findRegAddrInPayload(bytes, reg) {
  if (!bytes || bytes.length < 2) return null;
  const want = reg & 0xffff;
  const hi = (want >> 8) & 0xff;
  const lo = want & 0xff;
  let loose = -1;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] !== hi || bytes[i + 1] !== lo) continue;
    if (i >= 2 && bytes[i - 2] === 0x01 && bytes[i - 1] === 0x01) return { offset: i, framed: true };
    if (i >= 1 && bytes[i - 1] === 0x01) return { offset: i, framed: true };
    if (loose < 0) loose = i;
  }
  return loose >= 0 ? { offset: loose, framed: false } : null;
}

function unwrapBizlogSearchPayload(upstream) {
  if (!upstream || typeof upstream !== "object") return {};
  const data = upstream.data;
  if (data && typeof data === "object" && (data.events || data.nextPageStartRowKey || data.totalCount != null)) {
    return data;
  }
  if (Array.isArray(upstream.events)) return upstream;
  if (upstream.result && typeof upstream.result === "object") return upstream.result;
  return data && typeof data === "object" ? data : {};
}

function extractBizlogEventRows(payload) {
  let list = [];
  if (Array.isArray(payload?.events)) list = payload.events;
  else {
    for (const key of ["list", "rows", "records", "data", "result"]) {
      if (Array.isArray(payload?.[key])) {
        list = payload[key];
        break;
      }
    }
  }
  return list.filter((it) => it && typeof it === "object").map((item) => {
    let detail =
      item.eventDetail ||
      item.eventDetails ||
      item.detail ||
      item.details ||
      item.value ||
      item.dpValue ||
      item.raw ||
      item.content ||
      item.origin;
    if (detail && typeof detail === "object") {
      detail =
        detail.value ||
        detail.dpValue ||
        detail.raw ||
        detail.hex ||
        detail.base64 ||
        JSON.stringify(detail);
    } else if (typeof detail === "string") {
      const t = detail.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          const parsed = JSON.parse(t);
          if (parsed && typeof parsed === "object") {
            detail =
              parsed.value ||
              parsed.dpValue ||
              parsed.raw ||
              parsed.hex ||
              parsed.base64 ||
              detail;
          }
        } catch (_) {
          /* keep original */
        }
      }
    }
    return {
      time: item.eventTime || item.gmtCreate || item.time || item.ts || item.occurTime,
      id: item.msgId || item.rowKey || item.id || item.uuid || item.logId,
      detail,
      raw: item,
    };
  });
}

function collectBizlogRegHits(rows, reg, hits, preview) {
  const want = reg & 0xffff;
  const consider = (detail, meta) => {
    const b = decodeBizlogPayloadBytes(detail);
    if (!b) return;
    const entries = parseFunctionSetEntries(b);
    const hexstr = Array.from(b, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join(" ");
    let matched = false;
    for (const e of entries) {
      const addr = e.addr & 0xffff;
      const value = e.value & 0xffff;
      const item = {
        time: meta.time,
        addr,
        addrHex: addr.toString(16).toUpperCase().padStart(4, "0"),
        value,
        valueHex: value.toString(16).toUpperCase().padStart(4, "0"),
        hex: hexstr,
        id: meta.id,
      };
      if (preview.length < 30) preview.push(item);
      if (addr === want && !matched) {
        hits.push(item);
        matched = true;
      }
    }
    if (matched) return;
    const found = findRegAddrInPayload(b, want);
    if (!found) return;
    const item = {
      time: meta.time,
      addr: want,
      addrHex: want.toString(16).toUpperCase().padStart(4, "0"),
      value: null,
      valueHex: "",
      hex: hexstr,
      id: meta.id,
      match: found.framed ? "frame" : "hex",
    };
    if (preview.length < 30) preview.push(item);
    hits.push(item);
  };
  for (const row of rows) {
    consider(row.detail, row);
    const ri = row.raw || {};
    for (const k of ["eventDetail", "origin", "value", "dpValue", "detail", "content", "data"]) {
      if (k in ri && ri[k] !== row.detail) consider(ri[k], row);
    }
  }
}

async function searchBizlogRegister(home, deviceId, { reg, dpIds }) {
  const host = hestiaHostForHome(home);
  const hits = [];
  const preview = [];
  let pageStartRow = "";
  let pages = 0;
  let totalEvents = 0;
  let totalCount = null;
  let stoppedEarly = false;
  let stopReason = "";
  const maxPages = 20;
  for (let i = 0; i < maxPages; i++) {
    const body = {
      eventIds: "7",
      devId: deviceId,
      limit: 50,
      dpIds,
      gmt: "+08:00",
      eventIdAll: "0",
    };
    if (pageStartRow) body.pageStartRow = pageStartRow;
    const res = await CaseApi.searchBizlog(host, body);
    const upstream = res.data || {};
    if (upstream.code !== undefined && upstream.code !== 0) {
      throw new Error(upstream.msg || upstream.message || `hestia code ${upstream.code}`);
    }
    const payload = unwrapBizlogSearchPayload(upstream);
    const rows = extractBizlogEventRows(payload);
    const before = hits.length;
    collectBizlogRegHits(rows, reg, hits, preview);
    pages += 1;
    totalEvents += rows.length;
    if (payload.totalCount != null) totalCount = payload.totalCount;
    if (hits.length > before) {
      stoppedEarly = true;
      stopReason = "已命中寄存器，找到即停";
      break;
    }
    const nextKey = payload.nextPageStartRowKey || "";
    if (!nextKey) break;
    pageStartRow = String(nextKey);
  }
  return {
    host,
    dpIds,
    reg,
    hits,
    preview,
    pages,
    totalEvents,
    totalCount,
    stoppedEarly,
    stopReason,
  };
}

function renderBizlogRegResult(data) {
  const hex = data.reg.toString(16).toUpperCase().padStart(4, "0");
  const found = data.hits.length > 0;
  let html = `<p class="reg-sum">${found ? "有上报" : "未找到"} · DP ${escapeHtml(String(data.dpIds))} · 寄存器 0x${hex} · ${escapeHtml(data.host || "")} · 翻了 ${data.pages} 页 · 共 ${data.totalEvents} 条事件 · 命中 ${data.hits.length} 条`;
  if (data.totalCount != null) html += ` · totalCount=${escapeHtml(String(data.totalCount))}`;
  if (data.stoppedEarly) html += ` · ${escapeHtml(data.stopReason || "")}`;
  html += `</p>`;
  if (data.hits.length) {
    html += `<table><thead><tr><th>时间</th><th>寄存器</th><th>值</th><th>原始 hex</th></tr></thead><tbody>`;
    for (const h of data.hits) {
      const valCell =
        h.value == null
          ? "—"
          : `<code>0x${h.valueHex}</code> (${h.value})`;
      html += `<tr><td>${escapeHtml(String(h.time || ""))}</td><td><code>0x${h.addrHex}</code></td><td>${valCell}</td><td><code>${escapeHtml(h.hex || "")}</code></td></tr>`;
    }
    html += `</tbody></table>`;
  } else if (data.preview.length) {
    html += `<p class="reg-sum">最近解析到的寄存器预览（未命中目标地址）：</p><pre>${escapeHtml(JSON.stringify(data.preview.slice(0, 8), null, 2))}</pre>`;
  }
  return html;
}

async function openRegQueryDialog(home, device) {
  if (!home || !device) return;
  const dlg = document.getElementById("dlgRegQuery");
  if (!dlg) return;
  regQueryCtx = { home, device, protocol: null };
  document.getElementById("dlgRegQueryTitle").textContent = `寄存器查询 · ${
    device.name || device.deviceId
  }`;
  document.getElementById("dlgRegQueryHint").textContent = `设备 ID ${device.deviceId}`;
  document.getElementById("regQueryAddr").value = "";
  const resultEl = document.getElementById("regQueryResult");
  resultEl.hidden = true;
  resultEl.textContent = "";
  resultEl.innerHTML = "";
  switchRegQueryMode("property");
  renderRegQueryMeta(null);
  dlg.showModal();

  try {
    const protocol = await fetchDeviceProtocolInfo(home, device);
    if (regQueryCtx?.device?.uid !== device.uid) return;
    regQueryCtx.protocol = protocol;
    if (regQueryMode === "property") renderRegQueryMeta(protocol);
  } catch (err) {
    renderRegQueryMeta(null, err.message || String(err));
  }
}

async function runRegQuery() {
  const ctx = regQueryCtx;
  if (!ctx?.home || !ctx?.device) return;
  const btn = document.getElementById("btnRegQueryRun");
  const resultEl = document.getElementById("regQueryResult");
  const addrRaw = document.getElementById("regQueryAddr")?.value || "";
  const regHex = normalizeRegAddrInput(addrRaw);
  if (!regHex) {
    toast("请输入有效寄存器地址（如 4026 或 0x4026）", "error");
    return;
  }
  if (regQueryMode === "bizlog" && !resolveRegQueryDpIds()) {
    toast("请选择 type=raw 的 DP", "error");
    return;
  }
  if (btn) btn.disabled = true;
  setRegQueryResult("查询中…");
  try {
    if (regQueryMode === "bizlog") {
      const dpIds = resolveRegQueryDpIds();
      const reg = parseInt(regHex, 16);
      if (!Number.isFinite(reg)) throw new Error("寄存器地址无效");
      const data = await searchBizlogRegister(ctx.home, ctx.device.deviceId, { reg, dpIds });
      setRegQueryResult(renderBizlogRegResult(data), true);
      toast(data.hits.length ? "已在原始报文中找到该寄存器" : "原始报文中未找到该寄存器", "ok");
      return;
    }
    let protocol = ctx.protocol;
    if (!protocol?.energyModelType || protocol.protocolCode == null || protocol.protocolCode === "") {
      protocol = await fetchDeviceProtocolInfo(ctx.home, ctx.device);
      ctx.protocol = protocol;
      renderRegQueryMeta(protocol);
    }
    const looked = await lookupCodeByRegister(ctx.home, protocol, regHex);
    const prop = await fetchPropertyByCode(ctx.home, ctx.device, looked.code);
    const hit = prop.hit;
    const value =
      hit == null
        ? null
        : hit.valueObject ?? hit.value ?? hit.dpValue ?? hit.propertyValue ?? null;
    const lines = [
      `寄存器: 0x${regHex}`,
      `code: ${looked.code}`,
      `名称: ${hit?.name || looked.hit?.name || "—"}`,
      `值: ${value == null || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : value}`,
      `时间: ${hit?.time || hit?.reportTime || hit?.gmtModified || "—"}`,
    ];
    if (looked.list.length > 1) {
      lines.push(`(协议模型命中 ${looked.list.length} 条，已取 ${looked.code})`);
    }
    resultEl.textContent = lines.join("\n");
    toast("查询完成", "ok");
  } catch (err) {
    setRegQueryResult(`失败: ${err.message || err}`);
    toast(err.message || String(err), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * @typedef {{
 *   uid: string,
 *   homeId: string,
 *   envHost: string,
 *   name: string,
 *   authId: string,
 *   devices: Device[],
 *   lastReadAt: number|null
 * }} Home
 *
 * @typedef {{
 *   uid: string,
 *   deviceId: string,
 *   name: string,
 *   model: string,
 *   note: string,
 *   values: Record<string, string|number|null>,
 *   reportTime: number|null,
 *   lastReadAt: number|null,
 *   schema: Record<string, {dpId: string, name?: string, dpSchema?: any, dpCode?: string}>,
 *   protocol: {protocolCode?: string, protocolPlan?: string}|null,
 *   socSeries: {t:number, v:number}[],
 *   socMeta: {code:string, start:number, end:number, error?:string}|null,
 *   drafts: Record<string, string>,
 *   loading: boolean,
 *   error: string|null
 * }} Device
 */

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function emptyState() {
  return { cookies: {}, homes: [], activeHomeId: null };
}

function stateFromDump(parsed) {
  return {
    cookies: parsed.cookies || {},
    homes: (parsed.homes || []).map(normalizeHome),
    activeHomeId: parsed.activeHomeId || null,
  };
}

function loadLegacyLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return stateFromDump(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

function normalizeHome(h) {
  const devices = (h.devices || []).map(normalizeDevice);
  return {
    uid: h.uid || uid(),
    homeId: String(h.homeId || ""),
    envHost: h.envHost || "newenergy-operation-cn.tuya-inc.com",
    name: h.name || "",
    authId: h.authId || "",
    lastReadAt: null, // 仅会话内，不从 store 回显
    devices,
    meters: (h.meters || []).map((m) => normalizeMeter(m, h.envHost)),
    // 无实体电表时：电网节点取该一体机 DP26（局域网电表配对功率）
    lanMeterDeviceId: String(h.lanMeterDeviceId || "").trim(),
    // 家庭侧可下发参数：值仅会话内回显，草稿可持久
    familyValues: {},
    familyDrafts: h.familyDrafts || {},
    familyRegs: null,
    wiring: normalizeWiring(
      h.wiring,
      devices.map((d) => d.uid)
    ),
    cardBox: typeof parseLiveCardBox === "function" ? parseLiveCardBox(h.cardBox) : h.cardBox || null,
  };
}

/* ---------- Wiring topology (home buses ↔ device ports) ---------- */

const WIRING_BUS_KINDS = [
  { kind: "pv", label: "光伏 PV", short: "PV" },
  { kind: "grid", label: "电网 Grid", short: "Grid" },
  { kind: "bypass", label: "Bypass负载", short: "Bypass" },
  { kind: "family", label: "家庭负载", short: "家庭" },
];

const DEVICE_WIRING_PORTS = [
  { port: "pv", label: "PV", kinds: ["pv"] },
  { port: "grid", label: "Grid 并网口", kinds: ["grid"] },
  { port: "offgrid", label: "离网口", kinds: ["bypass", "family"] },
];

/** 知识图谱·型号分类（/api/models），按 PID 匹配口数 */
let knowledgeModels = [];

/**
 * @brief Load model catalog used for PID → port-count mapping
 * @return {Promise<Array>}
 */
async function loadKnowledgeModels() {
  try {
    const json = await CaseApi.listModels();
    knowledgeModels = Array.isArray(json.models) ? json.models : [];
  } catch (_) {
    knowledgeModels = [];
  }
  return knowledgeModels;
}

/**
 * @brief Find knowledge model by product PID
 * @param {string} pid
 * @return {object|null}
 */
function knowledgeModelByPid(pid) {
  const p = String(pid || "").trim();
  if (!p) return null;
  return knowledgeModels.find((m) => (m.pids || []).map(String).includes(p)) || null;
}

/**
 * @brief Find knowledge model by id / name
 * @param {string} id
 * @return {object|null}
 */
function knowledgeModelById(id) {
  const key = String(id || "").trim();
  if (!key) return null;
  return (
    knowledgeModels.find((m) => m.id === key || m.name === key) || null
  );
}

/**
 * PIDs assigned in 型号分类维护. Falls back to DEVICE_MODELS if catalog has none.
 * @return {Set<string>}
 */
function assignedModelPidSet() {
  const set = new Set();
  const addFrom = (list) => {
    for (const m of list || []) {
      for (const p of m.pids || []) {
        const s = String(p || "").trim();
        if (s) set.add(s);
      }
    }
  };
  addFrom(knowledgeModels);
  if (!set.size && typeof DEVICE_MODELS !== "undefined") addFrom(DEVICE_MODELS);
  return set;
}

function isAssignedModelDevice(device) {
  const pid = String(device?.pid || "").trim();
  return !!pid && assignedModelPidSet().has(pid);
}

/** Devices shown on the live canvas (PID in 型号分配). */
function homeLiveDevices(home) {
  const set = assignedModelPidSet();
  return (home?.devices || []).filter((d) => set.has(String(d?.pid || "").trim()));
}

/**
 * @brief Port counts for a live device: stamped fields → PID catalog → model id → 1/1/1
 * @param {object} device
 * @return {{pv:number,grid:number,offgrid:number}}
 */
function liveDevicePortCounts(device) {
  if (!device) return { pv: 1, grid: 1, offgrid: 1 };
  const byPid = knowledgeModelByPid(device.pid);
  const byModel = knowledgeModelById(device.model);
  const cat = byPid || byModel;
  if (cat) {
    return {
      pv: Math.max(0, Number(cat.pv_n) || 0),
      grid: Math.max(0, Number(cat.grid_n) || 0),
      offgrid: Math.max(0, Number(cat.offgrid_n) || 0),
    };
  }
  if (device.pv_n != null || device.grid_n != null || device.offgrid_n != null) {
    return {
      pv: Math.max(0, Number(device.pv_n) || 0),
      grid: Math.max(0, Number(device.grid_n) || 0),
      offgrid: Math.max(0, Number(device.offgrid_n) || 0),
    };
  }
  return { pv: 1, grid: 1, offgrid: 1 };
}

/**
 * @brief Stamp pv_n/grid_n/offgrid_n (+ model id) from knowledge PID match
 * @param {object} device
 * @return {{pv:number,grid:number,offgrid:number}}
 */
function stampLiveDevicePortCounts(device) {
  if (!device) return { pv: 1, grid: 1, offgrid: 1 };
  const cat = knowledgeModelByPid(device.pid) || knowledgeModelById(device.model);
  if (cat) {
    device.model = cat.id || device.model;
    device.pv_n = Math.max(0, Number(cat.pv_n) || 0);
    device.grid_n = Math.max(0, Number(cat.grid_n) || 0);
    device.offgrid_n = Math.max(0, Number(cat.offgrid_n) || 0);
  }
  return liveDevicePortCounts(device);
}

/**
 * @brief Coerce stored port value to a slot array of length n
 * @param {*} raw
 * @param {number} n
 * @return {string[]}
 */
function coercePortSlots(raw, n) {
  const count = Math.max(0, Number(n) || 0);
  if (count <= 0) return [];
  let vals = [];
  if (Array.isArray(raw)) vals = raw.map((x) => String(x || ""));
  else if (raw != null && raw !== "") vals = [String(raw)];
  while (vals.length < count) vals.push("");
  return vals.slice(0, count);
}

/**
 * @brief Validate a stored slot value against current buses
 * @param {string} raw
 * @param {Set<string>} busIds
 * @return {string}
 */
function validPortBusId(raw, busIds) {
  const id = String(raw || "");
  return id && busIds.has(id) ? id : "";
}

function defaultWiringBuses() {
  return WIRING_BUS_KINDS.map((k) => ({
    id: `bus_${k.kind}`,
    kind: k.kind,
    label: k.label,
    x: null,
    y: null,
  }));
}

/** New devices start unconnected — user wires on the live canvas. */
function defaultDevicePorts(_buses, counts) {
  const c = counts || { pv: 1, grid: 1, offgrid: 1 };
  return {
    pv: Array(Math.max(0, c.pv || 0)).fill(""),
    grid: Array(Math.max(0, c.grid || 0)).fill(""),
    offgrid: Array(Math.max(0, c.offgrid || 0)).fill(""),
  };
}

function busDefaultSize(kind) {
  if (kind === "grid") return { w: 140, h: 72 };
  if (kind === "family") return { w: 128, h: 56 };
  if (kind === "bypass") return { w: 120, h: 56 };
  return { w: 108, h: 56 };
}

/**
 * Parse stored bus x/y. null/undefined/"" stay unset (layout uses default).
 * Note: Number(null)===0 — must not treat null as a real coordinate.
 * Legacy bug wrote (0,0) for unset; treat that pair as unset too.
 */
function parseBusCoord(x, y) {
  const hasX = x != null && x !== "" && Number.isFinite(Number(x));
  const hasY = y != null && y !== "" && Number.isFinite(Number(y));
  if (!hasX || !hasY) return { x: null, y: null };
  const nx = Number(x);
  const ny = Number(y);
  if (nx === 0 && ny === 0) return { x: null, y: null };
  return { x: nx, y: ny };
}

/** Default terminal position by kind when user hasn't dragged it yet. */
function defaultBusPosition(kind, index, ctx) {
  const { vbW, gridTop, gridCx, loadY, unitY } = ctx;
  // PV sits in the left lane, vertically aligned with device PV pads
  if (kind === "pv") return { x: 16, y: (unitY || 180) + 36 + index * 70 };
  if (kind === "grid") {
    const gw = 140;
    return { x: gridCx - gw / 2 + index * (gw + 10), y: gridTop };
  }
  if (kind === "bypass") return { x: vbW - 280, y: loadY - index * 66 };
  if (kind === "family") return { x: vbW - 144, y: loadY - index * 66 };
  return { x: 16, y: (unitY || 180) + 36 };
}

/**
 * @brief Normalize wiring; device ports are slot arrays sized by model PID counts
 * @param {object|null} raw
 * @param {string[]} deviceUids
 * @param {object[]} [deviceList]
 * @return {{buses:object[],devices:object}}
 */
function normalizeWiring(raw, deviceUids = [], deviceList = null) {
  const src = raw && typeof raw === "object" ? raw : {};
  let buses = Array.isArray(src.buses)
    ? src.buses.map((b, i) => {
        const pos = parseBusCoord(b.x, b.y);
        return {
          id: String(b.id || `bus_${i}`),
          kind: WIRING_BUS_KINDS.some((k) => k.kind === b.kind) ? b.kind : "pv",
          label: String(b.label || WIRING_BUS_KINDS.find((k) => k.kind === b.kind)?.label || b.kind),
          x: pos.x,
          y: pos.y,
        };
      })
    : [];
  if (!buses.length) buses = defaultWiringBuses();
  const busIds = new Set(buses.map((b) => b.id));
  const busById = Object.fromEntries(buses.map((b) => [b.id, b]));
  const bus_links = {};
  const rawLinks = src.bus_links && typeof src.bus_links === "object" ? src.bus_links : {};
  for (const [aId, bId] of Object.entries(rawLinks)) {
    const other = String(bId || "");
    if (!busIds.has(aId) || !busIds.has(other) || aId === other) continue;
    const a = busById[aId];
    const b = busById[other];
    if (!canConnectBusPair(a?.kind, b?.kind)) continue;
    bus_links[aId] = other;
    bus_links[other] = aId;
  }
  const byUid = {};
  for (const d of deviceList || []) {
    if (d?.uid) byUid[String(d.uid)] = d;
  }
  const devices = {};
  const srcDev = src.devices && typeof src.devices === "object" ? src.devices : {};
  for (const uid of deviceUids) {
    const key = String(uid);
    const d = srcDev[key] || {};
    const counts = liveDevicePortCounts(byUid[key] || {});
    devices[key] = {
      pv: coercePortSlots(d.pv, counts.pv).map((v) => validPortBusId(v, busIds)),
      grid: coercePortSlots(d.grid, counts.grid).map((v) => validPortBusId(v, busIds)),
      offgrid: coercePortSlots(d.offgrid, counts.offgrid).map((v) => validPortBusId(v, busIds)),
    };
  }
  for (const [uid, d] of Object.entries(srcDev)) {
    if (devices[uid]) continue;
    const counts = liveDevicePortCounts(byUid[uid] || {});
    devices[uid] = {
      pv: coercePortSlots(d.pv, counts.pv).map((v) => validPortBusId(v, busIds)),
      grid: coercePortSlots(d.grid, counts.grid).map((v) => validPortBusId(v, busIds)),
      offgrid: coercePortSlots(d.offgrid, counts.offgrid).map((v) => validPortBusId(v, busIds)),
    };
  }
  return { buses, devices, bus_links };
}

/** Ensure wiring exists and covers all current devices. */
function ensureHomeWiring(home) {
  for (const d of home.devices || []) {
    stampLiveDevicePortCounts(d);
  }
  const uids = (home.devices || []).map((d) => d.uid);
  home.wiring = normalizeWiring(home.wiring, uids, home.devices || []);
  return home.wiring;
}

function wiringBusById(home, busId) {
  if (!busId) return null;
  return (home.wiring?.buses || []).find((b) => b.id === busId) || null;
}

function deviceWiringPorts(home, device) {
  ensureHomeWiring(home);
  const w = home.wiring.devices[device.uid];
  if (w) return w;
  const def = defaultDevicePorts(home.wiring.buses, liveDevicePortCounts(device));
  home.wiring.devices[device.uid] = def;
  return def;
}

/**
 * @brief Read one port slot bus id
 * @param {object} ports
 * @param {string} kind
 * @param {number} [idx]
 * @return {string}
 */
function getPortSlot(ports, kind, idx = 0) {
  const slots = ports?.[kind];
  if (Array.isArray(slots)) return String(slots[idx] || "");
  if (Number(idx) === 0) return String(slots || "");
  return "";
}

/**
 * @brief Whether any slot of kind is linked to busId
 * @param {object} ports
 * @param {string} kind
 * @param {string} busId
 * @return {boolean}
 */
function portSlotsLinkBus(ports, kind, busId) {
  if (!busId) return false;
  const slots = ports?.[kind];
  if (Array.isArray(slots)) return slots.some((s) => s === busId);
  return slots === busId;
}

/**
 * @brief Set / clear a device port slot ↔ bus link
 * @param {object} home
 * @param {string} deviceUid
 * @param {string} port
 * @param {string} busId
 * @param {number|string} [idx] slot index, or "all" to fill/clear every slot
 * @return {boolean}
 */
function setDeviceWiringPort(home, deviceUid, port, busId, idx = 0) {
  ensureHomeWiring(home);
  const device = (home.devices || []).find((d) => d.uid === deviceUid);
  const counts = liveDevicePortCounts(device || {});
  if (!home.wiring.devices[deviceUid]) {
    home.wiring.devices[deviceUid] = defaultDevicePorts(home.wiring.buses, counts);
  }
  const meta = DEVICE_WIRING_PORTS.find((p) => p.port === port);
  if (!meta) return false;
  const n = Math.max(0, Number(counts[port]) || 0);
  if (n <= 0) return false;
  const ports = home.wiring.devices[deviceUid];
  ports[port] = coercePortSlots(ports[port], n);
  if (busId) {
    const bus = wiringBusById(home, busId);
    if (!bus || !meta.kinds.includes(bus.kind)) return false;
  }
  if (isAllPortIdx(idx)) {
    ports[port] = Array(n).fill(busId || "");
    return true;
  }
  const i = Math.max(0, Math.min(n - 1, Number(idx) || 0));
  ports[port][i] = busId || "";
  return true;
}

/** Connect every device port slot to the first matching bus (PV/Grid/Bypass). */
function autoWireAllDevices(home) {
  if (!home) return 0;
  ensureHomeWiring(home);
  const byKind = {};
  for (const b of home.wiring.buses || []) {
    if (b?.kind && !byKind[b.kind]) byKind[b.kind] = b.id;
  }
  let n = 0;
  for (const d of home.devices || []) {
    const ports = deviceWiringPorts(home, d);
    const counts = liveDevicePortCounts(d);
    const next = {
      pv: Array(counts.pv).fill(byKind.pv || ""),
      grid: Array(counts.grid).fill(byKind.grid || ""),
      offgrid: Array(counts.offgrid).fill(byKind.bypass || byKind.family || ""),
    };
    const same =
      JSON.stringify(ports.pv) === JSON.stringify(next.pv) &&
      JSON.stringify(ports.grid) === JSON.stringify(next.grid) &&
      JSON.stringify(ports.offgrid) === JSON.stringify(next.offgrid);
    if (!same) {
      ports.pv = next.pv;
      ports.grid = next.grid;
      ports.offgrid = next.offgrid;
      n += 1;
    }
  }
  const famId = byKind.family;
  const gridId = byKind.grid;
  if (famId && gridId && typeof setBusLink === "function") {
    const links = home.wiring.bus_links || {};
    if (links[famId] !== gridId) {
      setBusLink(home, famId, gridId);
      n += 1;
    }
  }
  return n;
}

/** Clear all device↔bus links on the live home. */
function clearAllDeviceWires(home) {
  if (!home) return 0;
  ensureHomeWiring(home);
  let n = 0;
  for (const d of home.devices || []) {
    const ports = deviceWiringPorts(home, d);
    const counts = liveDevicePortCounts(d);
    const had =
      (ports.pv || []).some(Boolean) ||
      (ports.grid || []).some(Boolean) ||
      (ports.offgrid || []).some(Boolean);
    ports.pv = Array(counts.pv).fill("");
    ports.grid = Array(counts.grid).fill("");
    ports.offgrid = Array(counts.offgrid).fill("");
    if (had) n += 1;
  }
  const links = home.wiring.bus_links || {};
  if (Object.keys(links).length) {
    home.wiring.bus_links = {};
    n += 1;
  }
  return n;
}

function setBusPosition(home, busId, x, y) {
  ensureHomeWiring(home);
  const bus = home.wiring.buses.find((b) => b.id === busId);
  if (!bus) return false;
  const size = busDefaultSize(bus.kind);
  // keep on canvas
  bus.x = Math.round(Math.max(0, x));
  bus.y = Math.round(Math.max(0, y));
  bus.w = size.w;
  return true;
}

function portForBusKind(kind) {
  if (kind === "pv") return "pv";
  if (kind === "grid") return "grid";
  if (kind === "bypass" || kind === "family") return "offgrid";
  return null;
}

function kindsAllowedForPort(port) {
  return DEVICE_WIRING_PORTS.find((p) => p.port === port)?.kinds || [];
}

/** Only Grid bus ↔ Family-load bus may connect to each other. */
function canConnectBusPair(kindA, kindB) {
  const set = new Set([String(kindA || ""), String(kindB || "")]);
  return set.has("grid") && set.has("family");
}

/**
 * @brief Clear a bus↔bus link involving busId
 * @param {object} home
 * @param {string} busId
 * @return {boolean}
 * @note Do not call ensureHomeWiring here — it replaces home.wiring and
 *       would drop in-flight mutations held by the caller.
 */
function clearBusLink(home, busId) {
  if (!home?.wiring) return false;
  const links = home.wiring.bus_links || (home.wiring.bus_links = {});
  const other = links[busId];
  delete links[busId];
  if (other && links[other] === busId) delete links[other];
  return !!other;
}

/**
 * @brief Connect two buses (Grid ↔ Family only)
 * @param {object} home
 * @param {string} aId
 * @param {string} bId
 * @return {boolean}
 */
function setBusLink(home, aId, bId) {
  ensureHomeWiring(home);
  if (!aId || !bId || aId === bId) return false;
  const a = wiringBusById(home, aId);
  const b = wiringBusById(home, bId);
  if (!a || !b || !canConnectBusPair(a.kind, b.kind)) return false;
  const links = home.wiring.bus_links || (home.wiring.bus_links = {});
  const prevA = links[aId];
  const prevB = links[bId];
  if (prevA && prevA !== bId && links[prevA] === aId) delete links[prevA];
  if (prevB && prevB !== aId && links[prevB] === bId) delete links[prevB];
  links[aId] = bId;
  links[bId] = aId;
  return true;
}

/** Session canvas selection: terminals + one wire */
let liveCanvasSel = { buses: new Set(), wire: null };
let liveCanvasDragging = false;
let liveCanvasZoom = 1;
let liveCanvasPinching = false;

function liveCanvasTypingTarget(el) {
  if (!el) return false;
  const n = String(el.tagName || "").toLowerCase();
  if (n === "input" || n === "textarea" || n === "select") return true;
  return !!el.isContentEditable;
}

function parseLivePortIdx(tok) {
  const s = String(tok ?? "");
  if (s === "all" || s === "*") return "all";
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function isAllPortIdx(idx) {
  return idx === "all" || idx === "*" || Number(idx) === -1;
}

function parseLiveWireSel(raw) {
  const s = String(raw || "");
  if (s.startsWith("port:")) {
    const p = s.split(":");
    return {
      kind: "port",
      uid: p[1],
      port: p[2],
      idx: parseLivePortIdx(p[3]),
      busId: p[4] || "",
    };
  }
  if (s.startsWith("buslink:")) return { kind: "buslink", busId: s.slice(8) };
  return null;
}

function liveWireSelEqual(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "port") {
    return (
      a.uid === b.uid &&
      a.port === b.port &&
      String(a.idx) === String(b.idx) &&
      String(a.busId || "") === String(b.busId || "")
    );
  }
  return a.busId === b.busId;
}

/**
 * @brief Clear slots of a device port; if busId is set, only slots on that bus
 */
function clearDevicePortBus(home, deviceUid, port, busId) {
  ensureHomeWiring(home);
  const device = (home.devices || []).find((d) => d.uid === deviceUid);
  const counts = liveDevicePortCounts(device || {});
  const n = Math.max(0, Number(counts[port]) || 0);
  if (n <= 0) return false;
  if (!home.wiring.devices[deviceUid]) {
    home.wiring.devices[deviceUid] = defaultDevicePorts(home.wiring.buses, counts);
  }
  const ports = home.wiring.devices[deviceUid];
  ports[port] = coercePortSlots(ports[port], n).map((s) => (!busId || s === busId ? "" : s));
  return true;
}

function deleteLiveCanvasSelection(home) {
  const w = liveCanvasSel.wire;
  if (!w) return false;
  if (w.kind === "port") {
    if (isAllPortIdx(w.idx)) clearDevicePortBus(home, w.uid, w.port, w.busId || "");
    else setDeviceWiringPort(home, w.uid, w.port, "", w.idx || 0);
  } else if (w.kind === "buslink") {
    clearBusLink(home, w.busId);
  }
  liveCanvasSel.wire = null;
  return true;
}

/** Auto refresh live data every 7s when enabled */
let autoRefreshEnabled = false;
let autoRefreshTimer = null;
let autoRefreshBusy = false;
const AUTO_REFRESH_MS = 7000;
const AUTO_REFRESH_KEY = "gac_auto_refresh";

try {
  autoRefreshEnabled = localStorage.getItem(AUTO_REFRESH_KEY) === "1";
} catch (_) {
  autoRefreshEnabled = false;
}

function stopAutoRefreshTimer() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

async function tickAutoRefresh() {
  if (!autoRefreshEnabled || autoRefreshBusy) return;
  if (typeof atUiFrozen !== "undefined" && atUiFrozen) return;
  if (typeof atRunning !== "undefined" && atRunning) return;
  if (document.hidden) return;
  if (liveCanvasDragging) return;
  if (typeof homeTab !== "undefined" && homeTab !== "live") return;
  if (!activeHome()) return;
  autoRefreshBusy = true;
  try {
    const home = activeHome();
    if (home?.homeId) {
      try {
        await refreshDeviceOnlineFlags(home);
      } catch (_) {}
    }
    await readAllActiveHome({ quiet: true });
  } catch (err) {
    console.warn("auto refresh failed", err);
  } finally {
    autoRefreshBusy = false;
  }
}

function syncAutoRefreshTimer() {
  stopAutoRefreshTimer();
  if (autoRefreshEnabled) {
    autoRefreshTimer = setInterval(tickAutoRefresh, AUTO_REFRESH_MS);
  }
}

function toggleAutoRefresh(on) {
  autoRefreshEnabled = on == null ? !autoRefreshEnabled : !!on;
  try {
    localStorage.setItem(AUTO_REFRESH_KEY, autoRefreshEnabled ? "1" : "0");
  } catch (_) {}
  syncAutoRefreshTimer();
  render();
  toast(autoRefreshEnabled ? "已开启自动刷新（每 7 秒）" : "已关闭自动刷新", "ok");
  if (autoRefreshEnabled) tickAutoRefresh();
}

/** High-frequency report enable: issue now, then every 1 minute while on */
let highFreqEnabled = false;
let highFreqTimer = null;
let highFreqBusy = false;
const HIGH_FREQ_MS = 60 * 1000;
const HIGH_FREQ_KEY = "gac_high_freq";

try {
  highFreqEnabled = localStorage.getItem(HIGH_FREQ_KEY) === "1";
} catch (_) {
  highFreqEnabled = false;
}

function stopHighFreqTimer() {
  if (highFreqTimer) {
    clearInterval(highFreqTimer);
    highFreqTimer = null;
  }
}

function syncHighFreqTimer() {
  stopHighFreqTimer();
  if (highFreqEnabled) {
    highFreqTimer = setInterval(() => {
      issueHighFrequencyOnce({ quiet: true, skipConfirm: true });
    }, HIGH_FREQ_MS);
  }
}

/**
 * Custom confirm — avoids browser chrome like "127.0.0.1:5178 显示".
 * @returns {Promise<boolean>}
 */
function appConfirm(message, opts = {}) {
  const dlg = document.getElementById("dlgAppConfirm");
  const titleEl = document.getElementById("appConfirmTitle");
  const msgEl = document.getElementById("appConfirmMsg");
  const okBtn = document.getElementById("btnAppConfirmOk");
  const cancelBtn = document.getElementById("btnAppConfirmCancel");
  if (!dlg || !msgEl || !okBtn || !cancelBtn) {
    return Promise.resolve(window.confirm(message));
  }
  if (titleEl) titleEl.textContent = opts.title || "确认";
  msgEl.textContent = message;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onDlgCancel);
      if (dlg.open) dlg.close();
      resolve(ok);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onDlgCancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onDlgCancel);
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  });
}

function coerceHighFreqIssueValue(value, dpSchema) {
  const t = String(dpSchema?.type || "").toLowerCase();
  if (t === "bool" || t === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  if (t === "value" || t === "number" || t === "integer") {
    const n = Number(value);
    if (!Number.isNaN(n)) return toIssueRaw(n, dpSchema);
  }
  return value;
}

/**
 * Query issueDeviceList and concurrent-issue via /api/proxy/issue.
 * @param {{quiet?: boolean, skipConfirm?: boolean}} opts
 * @returns {Promise<boolean>}
 */
async function issueHighFrequencyOnce(opts = {}) {
  const quiet = !!opts.quiet;
  const skipConfirm = !!opts.skipConfirm;
  const home = activeHome();
  if (!home) {
    if (!quiet) toast("请先选择家庭", "error");
    return false;
  }
  const groupId = String(home.homeId || "").trim();
  if (!groupId) {
    if (!quiet) toast("当前家庭缺少家庭 ID（groupId）", "error");
    return false;
  }
  if (highFreqBusy) return false;
  highFreqBusy = true;
  try {
    const res = await CaseApi.queryHighFrequency(home, { groupId });
    const raw = unwrapResult(res);
    const list = Array.isArray(raw?.issueDeviceList)
      ? raw.issueDeviceList
      : Array.isArray(raw)
        ? raw
        : [];
    const targets = list
      .map((item) => ({
        devId: String(item?.deviceId || item?.devId || "").trim(),
        dpCode: String(item?.code || item?.dpCode || "").trim(),
        value: item?.value,
      }))
      .filter((t) => t.devId && t.dpCode && t.value != null && t.value !== "");
    if (!targets.length) {
      if (!quiet) toast("未找到可高频上报的设备（issueDeviceList 为空）", "error");
      return false;
    }
    if (!skipConfirm) {
      const ok = await appConfirm(
        `将为家庭 ${groupId} 的 ${targets.length} 个设备下发高频上报使能，是否继续？`,
        { title: "开启高频上报" }
      );
      if (!ok) {
        if (!quiet) toast("已取消高频上报下发", "error");
        return false;
      }
    }

    /** @type {Map<string, Record<string, any>>} */
    const schemaByDev = new Map();
    const knownDevices = [...(home.devices || []), ...(home.meters || [])];
    for (const d of knownDevices) {
      if (d?.deviceId && d.schema && Object.keys(d.schema).length) {
        schemaByDev.set(String(d.deviceId), d.schema);
      }
    }

    async function schemaFor(devId) {
      if (schemaByDev.has(devId)) return schemaByDev.get(devId);
      const schemaRes = await CaseApi.queryPidSchema(home, { devId });
      const map = indexSchema(unwrapResult(schemaRes));
      schemaByDev.set(devId, map);
      return map;
    }

    const uniqueIds = [...new Set(targets.map((t) => t.devId))];
    await Promise.all(uniqueIds.map((id) => schemaFor(id)));

    const results = await Promise.all(
      targets.map(async (t) => {
        try {
          const schema = await schemaFor(t.devId);
          const entry = schema?.[t.dpCode];
          if (!entry?.dpId) {
            throw new Error(`找不到 dpCode=${t.dpCode} 的 dpId`);
          }
          const dpValue = coerceHighFreqIssueValue(t.value, entry.dpSchema);
          const issueRes = await CaseApi.issueDevice(home, {
            devId: t.devId,
            timestamp: null,
            propertyList: [{ dpId: String(entry.dpId), dpValue }],
          });
          const upstream = issueRes.data || {};
          const issueRaw = unwrapResult(issueRes);
          const success =
            issueRes.ok !== false &&
            upstream.success !== false &&
            (issueRaw?.success === true ||
              issueRaw?.success === undefined ||
              issueRes.status === 200);
          if (!success) {
            throw new Error(
              upstream.errorMsg || issueRaw?.message || issueRaw?.errorMsg || "下发失败"
            );
          }
          return { ok: true };
        } catch (err) {
          return { ok: false, tip: `${t.devId}/${t.dpCode}: ${err.message || err}` };
        }
      })
    );
    const okN = results.filter((r) => r.ok).length;
    const failN = results.length - okN;
    const failed = results.filter((r) => !r.ok).map((r) => r.tip);
    if (!quiet) {
      if (failN) {
        const tip = failed.slice(0, 3).join("；");
        toast(
          `高频上报：成功 ${okN} / 失败 ${failN}${tip ? `（${tip}）` : ""}`,
          okN ? "ok" : "error"
        );
      } else {
        toast(`高频上报已开启：${okN} 台下发成功，之后每 1 分钟自动再下发`, "ok");
      }
    } else if (failN) {
      console.warn("high-freq quiet issue fail", failN, failed.slice(0, 5));
    }
    return failN === 0;
  } catch (err) {
    console.warn("issueHighFrequencyOnce", err);
    if (!quiet) toast(`开启高频上报失败：${err.message || err}`, "error");
    return false;
  } finally {
    highFreqBusy = false;
  }
}

async function toggleHighFreqReporting(on) {
  const wantOn = on == null ? !highFreqEnabled : !!on;
  if (!wantOn) {
    highFreqEnabled = false;
    try {
      localStorage.setItem(HIGH_FREQ_KEY, "0");
    } catch (_) {}
    syncHighFreqTimer();
    render();
    toast("已关闭高频上报自动下发", "ok");
    return;
  }
  const ok = await issueHighFrequencyOnce({ quiet: false, skipConfirm: false });
  if (!ok) {
    highFreqEnabled = false;
    try {
      localStorage.setItem(HIGH_FREQ_KEY, "0");
    } catch (_) {}
    syncHighFreqTimer();
    render();
    return;
  }
  highFreqEnabled = true;
  try {
    localStorage.setItem(HIGH_FREQ_KEY, "1");
  } catch (_) {}
  syncHighFreqTimer();
  render();
}

function toggleWiringEditMode(_on) {
  /* wiring is always on-canvas; kept for legacy callers */
}

function normalizeMeter(m, homeEnvHost) {
  const hestia =
    homeEnvHost != null
      ? hestiaHostForEnv(homeEnvHost)
      : m.hestiaHost || "hestia-eu.tuya-inc.com";
  const isThirdParty = !!(m.isThirdParty || m.thirdParty);
  return {
    uid: m.uid || uid(),
    deviceId: String(m.deviceId || ""),
    name: m.name || "",
    pid: isThirdParty ? m.pid || "" : m.pid || METER_PID,
    isThirdParty,
    hestiaHost: hestia,
    deviceInfo: null,
    powerSeries: [],
    powerMeta: null,
    lastValue: null,
    lastReadAt: null,
    loading: false,
    error: null,
  };
}

function normalizeDevice(d) {
  return {
    uid: d.uid || uid(),
    deviceId: String(d.deviceId || ""),
    name: d.name || "",
    pid: d.pid || "",
    model: d.model || "",
    note: d.note || "",
    // 运行数值不从 store 回显，只能接口读取后展示
    values: {},
    reportTime: null,
    lastReadAt: null, // 仅会话内：本机最近一次成功读取
    isOnline: d.isOnline == null ? null : !!d.isOnline, // 会话/落盘：detail.online 或列表在线态
    ip: d.ip ? String(d.ip) : "",
    ssidHash: d.ssidHash ? String(d.ssidHash) : "",
    schema: d.schema || {},
    protocol: d.protocol || null,
    socSeries: [],
    socMeta: null,
    drafts: d.drafts || {},
    loading: false,
    error: null,
  };
}

function buildStoreDump() {
  return {
    cookies: state.cookies,
    homes: state.homes.map((h) => ({
      uid: h.uid,
      homeId: h.homeId,
      envHost: h.envHost,
      name: h.name,
      authId: h.authId,
      devices: h.devices.map((d) => ({
        uid: d.uid,
        deviceId: d.deviceId,
        name: d.name,
        pid: d.pid,
        model: d.model,
        note: d.note,
        schema: d.schema,
        protocol: d.protocol,
        drafts: d.drafts,
        isOnline: d.isOnline == null ? null : !!d.isOnline,
        ip: d.ip || "",
        ssidHash: d.ssidHash || "",
      })),
      meters: (h.meters || []).map((m) => ({
        uid: m.uid,
        deviceId: m.deviceId,
        name: m.name,
        pid: m.pid,
        isThirdParty: !!m.isThirdParty,
        hestiaHost: m.hestiaHost,
      })),
      lanMeterDeviceId: h.lanMeterDeviceId || "",
      familyDrafts: h.familyDrafts || {},
      wiring: ensureHomeWiring(h),
      cardBox: h.cardBox || null,
    })),
    activeHomeId: state.activeHomeId,
  };
}

function persist(immediate = false) {
  const dump = buildStoreDump();
  // keep a local backup for offline recovery / migration
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dump));
  } catch (_) {}

  const flush = async () => {
    try {
      const { json } = await CaseApi.saveStore(dump);
      if (!json.ok) throw new Error(json.error || "保存失败");
      if (json.path) storePath = json.path;
    } catch (err) {
      console.error("persist store failed", err);
      toast(`保存到本地文件失败: ${err.message || err}`, "error");
    }
  };

  if (immediate) {
    clearTimeout(persistTimer);
    return flush();
  }
  clearTimeout(persistTimer);
  persistTimer = setTimeout(flush, 300);
}

async function loadStoreFromServer() {
  const json = await CaseApi.loadStore();
  if (!json.ok) throw new Error(json.error || "读取失败");
  storePath = json.path || "";
  const store = json.store || emptyState();
  const hasData =
    (store.homes && store.homes.length) ||
    (store.cookies && Object.keys(store.cookies).length);
  if (hasData) {
    return stateFromDump(store);
  }
  // migrate once from legacy localStorage
  const legacy = loadLegacyLocalStorage();
  if (legacy && (legacy.homes.length || Object.keys(legacy.cookies).length)) {
    state = legacy;
    await persist(true);
    return legacy;
  }
  return emptyState();
}

function envLabel(host) {
  const e = ENV_CONFIG[host] || HESTIA_ENVS[host];
  if (!e) return host;
  return e.name;
}

function envShort(host) {
  const e = ENV_CONFIG[host] || HESTIA_ENVS[host];
  return e ? e.short : host;
}

/** Map home ops env → matching Hestia host (same region, prod/pre aligned). */
function hestiaHostForEnv(envHost) {
  const meta = ENV_CONFIG[envHost];
  const region = meta?.region;
  if (!region || region === "local") {
    return "hestia-cn.tuya-inc.com";
  }
  const isPre = String(envHost).includes("wgine");
  const candidates = Object.entries(HESTIA_ENVS).filter(([, m]) => m.region === region);
  if (!candidates.length) return "hestia-eu.tuya-inc.com";
  const prefer = candidates.find(([h]) =>
    isPre ? h.includes("wgine") : h.includes("tuya-inc.com") && !h.includes("wgine")
  );
  return (prefer || candidates[0])[0];
}

function hestiaHostForHome(home) {
  return hestiaHostForEnv(home?.envHost);
}

function homeDisplayName(home) {
  const env = envShort(home?.envHost);
  if (home.name) return `${home.name} (${env})`;
  return `${home.homeId || "未命名家庭"} (${env})`;
}

// [moved → checker/device-model.js] modelByPid / modelMeta

function applyPidModel(device, pid) {
  const p = String(pid || "").trim();
  device.pid = p;
  const km = typeof knowledgeModelByPid === "function" ? knowledgeModelByPid(p) : null;
  if (km) {
    device.model = km.id;
    device.pv_n = Math.max(0, Number(km.pv_n) || 0);
    device.grid_n = Math.max(0, Number(km.grid_n) || 0);
    device.offgrid_n = Math.max(0, Number(km.offgrid_n) || 0);
    return km;
  }
  const matched = modelByPid(p);
  if (matched) {
    device.model = matched.id;
  } else if (p) {
    device.model = "";
  }
  return matched;
}

function activeHome() {
  return state.homes.find((h) => h.uid === state.activeHomeId) || null;
}

function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

/**
 * Copy text to clipboard. Works on http://IP (non-secure) via execCommand fallback.
 * navigator.clipboard requires secure context (https / localhost).
 */
async function copyText(text) {
  const value = String(text ?? "");
  if (!value) throw new Error("内容为空");
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (_) {
      /* fall through to legacy path */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    ta.remove();
  }
  if (!ok) throw new Error("浏览器禁止复制");
}

function fmtNum(v, unit) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return `${v}${unit || ""}`;
  return `${n}${unit || ""}`;
}

function fmtTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

function relativeTime(ms) {
  if (!ms) return "";
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`;
  return `${Math.floor(sec / 86400)}天前`;
}

function countDrafts(device) {
  let n = DP_EDITABLE.filter((f) => {
    if (!resolveSchemaEntry(device.schema || {}, f)) return false;
    const v = (device.drafts[f.code] || "").trim();
    if (v === "") return false;
    const cur = device.values[f.code];
    // same as current echo — not a pending change
    if (cur != null && String(cur) === v) return false;
    return true;
  }).length;
  const wm = (device.drafts?.work_mode || "").trim();
  if (wm !== "" && String(device.values?.work_mode ?? "") !== wm) n += 1;
  return n;
}

const FAMILY_RAIL_FOLD_KEY = "gac.familyRailFold";

function loadFamilyRailFold() {
  try {
    const raw = localStorage.getItem(FAMILY_RAIL_FOLD_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch (_) {
    return {};
  }
}

function saveFamilyRailFold(next) {
  try {
    localStorage.setItem(FAMILY_RAIL_FOLD_KEY, JSON.stringify(next || {}));
  } catch (_) {
    /* ignore quota */
  }
}

function countFamilyDrafts(home) {
  const drafts = home.familyDrafts || {};
  const values = home.familyValues || {};
  return HOME_FAMILY_FIELDS.filter((f) => {
    const v = (drafts[f.code] || "").trim();
    if (v === "") return false;
    const cur = values[f.code];
    if (cur != null && String(cur) === v) return false;
    return true;
  }).length;
}

function countHomeDrafts(home) {
  return countFamilyDrafts(home) + homeLiveDevices(home).reduce((n, d) => n + countDrafts(d), 0);
}

/** Clear all pending issue drafts on the active home (family + devices). */
function clearHomeDrafts(home) {
  if (!home) return 0;
  const before = countHomeDrafts(home);
  home.familyDrafts = {};
  for (const d of home.devices || []) {
    d.drafts = {};
  }
  return before;
}

/** Pack function_set raw: 03 01 + repeated (01 01 addr_be val_be). */
function packFunctionSetRaw(entries) {
  const bytes = [0x03, 0x01];
  for (const e of entries) {
    const addr = Number(e.addr) & 0xffff;
    let val = Number(e.value) || 0;
    if (e.signed) {
      if (val > 32767) val = 32767;
      if (val < -32768) val = -32768;
      if (val < 0) val = (val + 0x10000) & 0xffff;
    } else {
      val = Math.max(0, Math.min(0xffff, Math.round(val))) & 0xffff;
    }
    bytes.push(0x01, 0x01, (addr >> 8) & 0xff, addr & 0xff, (val >> 8) & 0xff, val & 0xff);
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function parseRegAddr(spec) {
  if (!spec) return null;
  const raw = spec.registerAddr || (Array.isArray(spec.registerAddrs) ? spec.registerAddrs[0] : null);
  if (raw == null) return null;
  const s = String(raw).replace(/^0x/i, "");
  const n = parseInt(s, 16);
  return Number.isFinite(n) ? n : null;
}

/* ---------- API ---------- */

function unwrapResult(payload) {
  const data = payload?.data ?? payload;
  if (data?.result !== undefined) return data.result;
  if (data?.data !== undefined && data.success !== undefined) return data.data;
  return data;
}

/** Upstream sometimes returns SSO login HTML when cookie expired. */
class AuthExpiredError extends Error {
  constructor(message) {
    super(message || "登录已失效");
    this.name = "AuthExpiredError";
    this.code = "AUTH_EXPIRED";
  }
}

function isAuthExpiredPayload(json) {
  const raw = json?.data?.raw;
  if (typeof raw === "string" && /<!DOCTYPE|统一登录|login-form|password登录|涂鸦统一登录/i.test(raw)) {
    return true;
  }
  const msg = String(
    json?.data?.errorMsg || json?.data?.msg || json?.data?.message || json?.error || ""
  );
  if (/未登录|登录已过期|登录失效|login expired|unauthorized|无权限|请先登录|no login/i.test(msg)) {
    return true;
  }
  const code = json?.data?.code ?? json?.data?.errorCode;
  if (code === 401 || code === "401" || code === 101 || code === "101") return true;
  return false;
}

function assertProxyPayload(json) {
  if (isAuthExpiredPayload(json)) {
    throw new AuthExpiredError("登录已失效，正在尝试自动刷新 SSO…");
  }
  if (!json?.ok && json?.error) throw new Error(json.error);
  if (json?.data && json.data.success === false) {
    throw new Error(json.data.errorMsg || json.error || "请求失败");
  }
}

function resolveCookie(host) {
  if (state.cookies[host]) return state.cookies[host];
  // fallback: any cookie (SSO often works across hestia/ops)
  for (const v of Object.values(state.cookies)) {
    if (v && String(v).trim()) return v;
  }
  return "";
}

function hostOf(homeOrHost) {
  return typeof homeOrHost === "string" ? homeOrHost : homeOrHost.envHost;
}

/** Deduplicate concurrent auto-refresh during parallel reads. */
let ssoRefreshPromise = null;

async function refreshSsoCookieOnce(opts = {}) {
  if (!ssoRefreshPromise) {
    const notify = !!opts.notify;
    ssoRefreshPromise = refreshSsoCookie({ ...opts, force: true })
      .then((r) => {
        if (notify) toast("登录已失效，已自动刷新 SSO 并重试", "ok");
        return r;
      })
      .finally(() => {
        ssoRefreshPromise = null;
      });
  }
  return ssoRefreshPromise;
}

async function apiGet(path, homeOrHost, query = {}, _retried = false) {
  const host = hostOf(homeOrHost);
  const cookie = resolveCookie(host);
  const qs = new URLSearchParams(query).toString();
  const url = qs ? `${path}?${qs}` : path;
  const res = await fetch(url, {
    headers: {
      "X-Target-Host": host,
      "X-Cookie": cookie,
    },
  });
  const json = await res.json();
  try {
    assertProxyPayload(json);
    return json;
  } catch (err) {
    if (!_retried && err?.code === "AUTH_EXPIRED") {
      try {
        await refreshSsoCookieOnce({ quiet: true, skipRender: true, host, notify: true });
      } catch (refreshErr) {
        throw new AuthExpiredError(
          `登录已失效，自动刷新失败：${refreshErr.message || refreshErr}`
        );
      }
      return apiGet(path, homeOrHost, query, true);
    }
    if (err?.code === "AUTH_EXPIRED") {
      throw new AuthExpiredError("登录已失效，自动刷新后仍失败，请手动点「自动获取」或重新粘贴 Cookie");
    }
    throw err;
  }
}

async function apiPost(path, homeOrHost, body, _retried = false) {
  const host = hostOf(homeOrHost);
  const cookie = resolveCookie(host);
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Target-Host": host,
      "X-Cookie": cookie,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  try {
    assertProxyPayload(json);
    return json;
  } catch (err) {
    if (!_retried && err?.code === "AUTH_EXPIRED") {
      try {
        await refreshSsoCookieOnce({ quiet: true, skipRender: true, host, notify: true });
      } catch (refreshErr) {
        throw new AuthExpiredError(
          `登录已失效，自动刷新失败：${refreshErr.message || refreshErr}`
        );
      }
      return apiPost(path, homeOrHost, body, true);
    }
    if (err?.code === "AUTH_EXPIRED") {
      throw new AuthExpiredError("登录已失效，自动刷新后仍失败，请手动点「自动获取」或重新粘贴 Cookie");
    }
    throw err;
  }
}

if (typeof CaseApi !== "undefined" && CaseApi.bindTransport) {
  CaseApi.bindTransport({
    get: apiGet,
    post: apiPost,
    fetchJson: async (url, init) => {
      const res = await fetch(url, init || {});
      const json = await res.json().catch(() => ({}));
      return { res, json };
    },
    fetchText: async (url, init) => {
      const res = await fetch(url, init || {});
      const text = await res.text();
      return { res, text };
    },
  });
}

/** 家庭设备列表：backendng-<region>.tuya-inc.com /inner/backendng/device/homeDevice */
async function fetchHomeDevices(home) {
  const region = (ENV_CONFIG[home.envHost] || {}).region || "cn";
  const bnHost = `backendng-${region}.tuya-inc.com`;
  const cookie = resolveCookie(home.envHost); // SSO 是 .tuya-inc.com 域级，operation host 的 cookie 对 backendng 也有效
  const out = [];
  let offset = 0;
  const limit = 50;
  for (let guard = 0; guard < 40; guard++) {
    const json = await CaseApi.postHomeDevicePage(bnHost, cookie, {
      homeId: home.homeId,
      offset,
      limit,
    });
    assertProxyPayload(json);
    const data = json.data || {};
    const datas = data.datas || data.result?.datas || [];
    out.push(...datas);
    const total = data.totalCount ?? data.result?.totalCount ?? out.length;
    offset += datas.length;
    if (!datas.length || out.length >= total) break;
  }
  return out;
}

/**
 * @brief Parse online flag from backendng homeDevice row
 * @param[in] row homeDevice item
 * @return true/false when known, null when unknown
 */
function parseDeviceOnline(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  if (typeof row.isOnline === "boolean") {
    return row.isOnline;
  }
  if (typeof row.online === "boolean") {
    return row.online;
  }
  const flag = row.isOnline ?? row.online;
  if (flag === 1 || flag === "1" || flag === "true" || flag === "TRUE") {
    return true;
  }
  if (flag === 0 || flag === "0" || flag === "false" || flag === "FALSE") {
    return false;
  }
  const status = row.status ?? row.deviceStatus ?? row.onlineStatus;
  if (status === 1 || status === "1" || status === "online" || status === "ONLINE") {
    return true;
  }
  if (status === 2 || status === "2" || status === "offline" || status === "OFFLINE") {
    return false;
  }
  return null;
}

/**
 * @brief Apply online / IP / SSID from backendng device detail.result
 * @param[in,out] device device object
 * @param[in] detail unwrapped detail result
 * @return none
 */
function applyDeviceDetailMeta(device, detail) {
  if (!device || !detail || typeof detail !== "object") {
    return;
  }
  const info = detail.device && typeof detail.device === "object" ? detail.device : null;
  if (info) {
    const online = parseDeviceOnline(info);
    if (online != null) {
      device.isOnline = online;
    }
    if (info.ip != null && String(info.ip).trim() !== "") {
      device.ip = String(info.ip).trim();
    }
  }
  const ssid = parseDeviceMetaValue(detail.deviceMetaShowVOList, "ssid_hash");
  if (ssid) {
    device.ssidHash = ssid;
  }
}

/**
 * @brief Whether device can be selected for automation / shows as online
 * @param[in] device device object
 * @return false when known offline or (unknown + stale report); else true
 */
function deviceIsOnline(device) {
  if (!device) {
    return false;
  }
  if (device.isOnline === false) {
    return false;
  }
  if (device.isOnline === true) {
    return true;
  }
  // homeDevice 常无 online 字段：上报过旧时按离线展示角标，避免误当成在线
  const t = Number(device.reportTime || 0);
  if (t > 0) {
    const ageMs = Date.now() - t;
    if (Number.isFinite(ageMs) && ageMs > 30 * 60 * 1000) {
      return false;
    }
  }
  return true;
}

/**
 * @brief Refresh isOnline flags from homeDevice without rebuilding device list
 * @param[in] home home object
 * @return none
 */
async function refreshDeviceOnlineFlags(home) {
  if (!home?.homeId || !(home.devices || []).length) {
    return;
  }
  const raw = await fetchHomeDevices(home);
  const byId = new Map();
  for (const row of raw) {
    const id = String(row.devId || row.deviceId || "").trim();
    if (id) {
      byId.set(id, row);
    }
  }
  for (const dev of home.devices || []) {
    const row = byId.get(String(dev.deviceId || ""));
    if (!row) {
      // 家庭列表已无此设备，按离线处理，避免自动化误选
      dev.isOnline = false;
      continue;
    }
    const online = parseDeviceOnline(row);
    if (online != null) {
      dev.isOnline = online;
    }
  }
}

/** 按家庭 ID 重新拉取设备，只保留型号分配里关联过的 PID。 */
async function refreshHomeDevices(home, opts = {}) {
  if (!home || !home.homeId) {
    if (!opts.quiet) toast("请先填写家庭 ID", "error");
    return;
  }
  try {
    if (!opts.quiet) toast("正在刷新设备…", "ok");
    await loadKnowledgeModels();
    const raw = await fetchHomeDevices(home);
    const pidSet = assignedModelPidSet();
    const prevById = new Map((home.devices || []).map((d) => [String(d.deviceId), d]));
    const next = [];
    let skipped = 0;
    for (const x of raw) {
      const devId = String(x.devId || x.deviceId || "").trim();
      if (!devId) continue;
      const pid = String(x.productId || x.pid || prevById.get(devId)?.pid || "").trim();
      if (!pid || !pidSet.has(pid)) {
        skipped += 1;
        continue;
      }
      const prev = prevById.get(devId);
      let merged;
      if (prev) {
        prev.deviceId = devId;
        prev.name = (x.customName || x.name || prev.name || "").trim();
        prev.pid = pid;
        const online = parseDeviceOnline(x);
        if (online != null) {
          prev.isOnline = online;
        }
        merged = prev;
      } else {
        merged = normalizeDevice({
          deviceId: devId,
          name: (x.customName || x.name || "").trim(),
          pid,
          model: (x.name || "").trim(),
          isOnline: parseDeviceOnline(x),
        });
      }
      applyPidModel(merged, pid);
      stampLiveDevicePortCounts(merged);
      next.push(merged);
    }
    home.devices = next;
    ensureHomeWiring(home);
    persist();
    render();
    if (!opts.quiet) {
      const extra = skipped ? `，已过滤 ${skipped} 台非型号 PID` : "";
      toast(`已刷新：家庭 ${raw.length} 台，画布 ${next.length} 台${extra}`, "ok");
    }
  } catch (err) {
    if (!opts.quiet) toast(`刷新设备失败：${err?.message || err}`, "error");
  }
}

/** 保存家庭后自动拉取并按型号 PID 覆盖设备列表。 */
async function autoPullDevices(home, opts = {}) {
  return refreshHomeDevices(home, opts);
}

function indexSchema(result) {
  const list =
    result?.propertyList ||
    result?.property_list ||
    result?.schemaList ||
    result?.dpList ||
    [];
  /** @type {Record<string, {dpId: string, name?: string, dpCode: string, dpSchema?: any}>} */
  const map = {};
  for (const dp of list) {
    const code = dp.dpCode || dp.code || "";
    if (!code) continue;
    const dpId = dp.dpId != null ? String(dp.dpId) : "";
    if (!dpId) continue;
    map[code] = {
      dpId,
      dpCode: code,
      name: dp.name || dp.dpName,
      dpSchema: dp.dpSchema || dp.schema || null,
    };
  }
  return map;
}

/** Resolve which schema DP backs a logical field (supports aliases). */
function resolveSchemaEntry(schemaMap, field) {
  const aliases = field.aliases || [field.code];
  for (const a of aliases) {
    if (schemaMap?.[a]) return schemaMap[a];
  }
  if (field?.fallbackDpId) {
    return {
      dpId: String(field.fallbackDpId),
      dpCode: field.dpCode || field.code,
      dpSchema: field.dpSchema || null,
    };
  }
  return null;
}

function fieldMatchHint(device, field) {
  const entry = resolveSchemaEntry(device.schema || {}, field);
  if (!entry?.dpId) return "";
  const code = entry.dpCode || field.code;
  return `${entry.dpId} · ${code}`;
}

function fieldLabelHtml(device, field) {
  const hint = fieldMatchHint(device, field);
  if (!hint) {
    return `<span class="field-name">${escapeHtml(field.label)}</span>`;
  }
  return `<span class="field-name">${escapeHtml(field.label)}</span>
    <span class="dp-hint" title="${escapeAttr(hint)}">${escapeHtml(hint)}</span>`;
}

/**
 * Convert shadow/raw DP value to card display number.
 * Power fields are normalized to W; SOC stays %.
 *
 * Tuya fixed-point: display = raw / 10^scale [in schema unit].
 * When unit is kW → convert to W (*1000). If scale==0 and |raw| is large,
 * treat as mislabeled watts (already W).
 */
function toDisplayValue(raw, dpSchema, displayUnit) {
  if (raw === null || raw === undefined || raw === "") return null;
  // raw 型（DP98 command_receive 等）：原样保留 base64/hex 字符串，勿当数字
  const schemaType = String(dpSchema?.type || "").toLowerCase();
  if (schemaType === "raw" || schemaType === "rawtype") {
    if (typeof raw === "string") return raw.trim();
    if (typeof raw === "object") {
      const inner = raw.value ?? raw.dpValue ?? raw.data ?? null;
      if (inner != null) return toDisplayValue(inner, dpSchema, displayUnit);
    }
    return raw;
  }
  let n = Number(raw);
  if (Number.isNaN(n)) return raw;
  const scale = Number(dpSchema?.scale ?? 0);
  const unit = String(dpSchema?.unit || "").toLowerCase();
  n = n / Math.pow(10, scale);
  if (displayUnit === "W") {
    if (unit === "kw" || unit === "千瓦") {
      // scale>0 → fixed-point kW (e.g. raw 142 / 10^3 = 0.142 kW = 142 W)
      if (scale > 0) {
        return Math.round(n * 1000);
      }
      // scale 0: small numbers are real kW, large are mislabeled W
      if (Math.abs(n) <= 50) {
        return Math.round(n * 1000);
      }
      return Math.round(n);
    }
    return Math.round(n);
  }
  return n;
}

function toIssueRaw(display, dpSchema) {
  let n = Number(display);
  if (Number.isNaN(n)) return display;
  const scale = Number(dpSchema?.scale ?? 0);
  const unit = String(dpSchema?.unit || "").toLowerCase();
  if (unit === "kw" || unit === "千瓦") {
    if (scale > 0 || Math.abs(n) === 0 || n / 1000 <= 50) {
      n = n / 1000; // UI W → kW
    }
  }
  return Math.round(n * Math.pow(10, scale));
}

async function readDevice(home, device, opts = {}) {
  const batch = !!opts.batch;
  device.loading = true;
  device.error = null;
  if (!batch) render();
  let ok = false;
  try {
    // Refresh: device-detail dataPoints (+ SOC). pid-schema only when本地尚无 schema。
    if (!Object.keys(device.schema || {}).length || !device.pid) {
      const schemaRes = await CaseApi.queryPidSchema(home, { devId: device.deviceId });
      const schemaRaw = unwrapResult(schemaRes);
      const pidFromSchema =
        schemaRaw?.pid ||
        schemaRaw?.productId ||
        schemaRaw?.product_id ||
        "";
      applyPidModel(device, pidFromSchema);
      if (pidFromSchema && !modelByPid(pidFromSchema) && !knowledgeModelByPid(pidFromSchema)) {
        toast(`未识别 PID ${pidFromSchema}，口数/输出上限未绑定`, "error");
      }
      device.schema = indexSchema(schemaRaw);
      ensureHomeWiring(home);
    }

    const fieldToDp = {};
    const fieldsToRead = [...ALL_FIELDS, ...HOME_SHADOW_FIELDS, ...DP_SHADOW_EXTRA];
    for (const field of fieldsToRead) {
      const entry = resolveSchemaEntry(device.schema, field);
      if (!entry) continue;
      fieldToDp[field.code] = entry;
    }

    const values = { ...(device.values || {}) };
    for (const code of [...ALL_CODES, ...HOME_SHADOW_FIELDS.map((f) => f.code), ...DP_SHADOW_EXTRA_CODES]) {
      if (!(code in values)) values[code] = null;
    }
    let latest = device.reportTime || null;

    // Real-time DPs + SSID/IP/online：backendng /api/device/detail
    const detailJson = await fetchDeviceDetail(home, device.deviceId);
    const detail = unwrapDeviceDetail(detailJson);
    const { byCode, byId, latest: dpLatest } = indexDetailDataPoints(detail.dataPoints);
    if (dpLatest && (!latest || dpLatest > latest)) latest = dpLatest;
    applyDeviceDetailMeta(device, detail);
    if (deviceVersionCache.deviceId === device.deviceId) {
      deviceVersionCache = { deviceId: "", html: "" };
    }

    for (const field of fieldsToRead) {
      const entry = fieldToDp[field.code];
      if (!entry) continue;
      const hit =
        byId[entry.dpId] ||
        byCode[entry.dpCode] ||
        (field.aliases || []).map((a) => byCode[a]).find(Boolean);
      if (!hit) continue;
      const rawVal = hit.valueObject ?? hit.value ?? hit.dpValue;
      const display = toDisplayValue(rawVal, entry.dpSchema, field.unit);
      values[field.code] = display;
      if (entry.dpCode && entry.dpCode !== field.code) {
        values[entry.dpCode] = display;
      }
    }

    device.values = values;
    device.reportTime = latest;
    device.lastReadAt = Date.now();
    home.lastReadAt = Date.now();
    // 家庭侧 DP 字段：用本机影子回填（取首次有值）
    if (!home.familyValues) home.familyValues = {};
    for (const field of HOME_SHADOW_FIELDS) {
      if (home.familyValues[field.code] != null && home.familyValues[field.code] !== "") continue;
      if (values[field.code] != null && values[field.code] !== "") {
        home.familyValues[field.code] = values[field.code];
      }
    }
    ok = true;
    // 刷新只更新界面内存态，不把 value / SOC 写回 store
  } catch (err) {
    device.error = err.message || String(err);
    if (!batch) toast(`${device.name || device.deviceId}: ${device.error}`, "error");
  } finally {
    device.loading = false;
    if (!batch) {
      applyDp98ActualForHome(home);
      render();
    }
  }
  // 物模型补读；SOC 历史仅「历史趋势」页拉取，实时页不调 query-neko
  if (ok && !batch) {
    readDeviceHomeModelParams(home, device, { syncHome: true }).then(() => {
      applyDp98ActualForHome(home);
      render();
    });
  }
  return ok;
}

/** Fire-and-forget SOC fetch; patch chart when done without full re-render. */
function scheduleSocFetch(home, device) {
  const token = (device._socFetchToken = (device._socFetchToken || 0) + 1);
  device.socMeta = { ...(device.socMeta || {}), loading: true, error: null };
  patchDeviceSocStats(home, device);
  fetchSocSeries(home, device)
    .then(() => {
      if (device._socFetchToken !== token) return;
      if (device.socMeta) device.socMeta.loading = false;
      patchDeviceSocPanel(home, device);
    })
    .catch(() => {
      if (device._socFetchToken !== token) return;
      if (device.socMeta) device.socMeta.loading = false;
      patchDeviceSocPanel(home, device);
    });
}

function findDeviceCard(home, device) {
  if (!device?.uid) return null;
  return document.querySelector(`#flowHost .u3[data-device-uid="${CSS.escape(device.uid)}"]`) || null;
}

function findDeviceSocCard(device) {
  if (!device?.uid) return null;
  return document.querySelector(`#chartsHost .flow-soc-card[data-device-uid="${CSS.escape(device.uid)}"]`) || null;
}

function patchDeviceSocStats(home, device) {
  const card = findDeviceSocCard(device);
  if (!card) return;
  const statsEl = card.querySelector(".soc-stats");
  if (!statsEl) return;
  if (device.socMeta?.loading) {
    statsEl.innerHTML = `<span>SOC 加载中…</span>`;
    return;
  }
  if (device.socSeries?.length) {
    const last = device.socSeries[device.socSeries.length - 1];
    statsEl.innerHTML = `<span>${device.socSeries.length} 点</span>
      <span>近 ${device.socMeta?.hours || 24}h</span>
      <span>末值 ${escapeHtml(String(last.v))}%</span>`;
  } else if (device.socMeta?.error) {
    statsEl.innerHTML = `<span class="err">${escapeHtml(device.socMeta.error)}</span>`;
  } else {
    statsEl.innerHTML = `<span>暂无 SOC 历史</span>`;
  }
}

function patchDeviceSocPanel(home, device) {
  const card = findDeviceSocCard(device);
  if (!card) return;
  patchDeviceSocStats(home, device);
  const chartEl = card.querySelector("[data-soc-chart]");
  if (!chartEl) return;
  if (typeof chartEl._chartCleanup === "function") {
    chartEl._chartCleanup();
    chartEl._chartCleanup = null;
  }
  mountInteractiveChart(chartEl, device.socSeries || [], {
    unit: "%",
    emptyText: device.socMeta?.error || "暂无 SOC 历史",
    forceRange: [0, 100],
    height: 110,
  });
}

/** Load SOC history via query-neko (code=heap_soc by default). */
async function fetchSocSeries(home, device, hours = 24) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.max(1, hours) * 3600;
  const code = "heap_soc";
  device.socMeta = { code, start, end, hours, loading: true };
  try {
    const res = await CaseApi.queryNeko(home, {
      energyDeviceId: device.deviceId,
      code,
      startTime: String(start),
      endTime: String(end),
      pageSize: "1000",
    });
    const raw = unwrapResult(res);
    const list = Array.isArray(raw) ? raw : raw?.items || raw?.list || [];
    const series = [];
    for (const it of list) {
      let t = Number(it.time ?? it.timestamp ?? it.ts);
      if (!t) continue;
      // normalize to ms
      if (t < 1e12) t *= 1000;
      const v = Number(it.value);
      if (Number.isNaN(v)) continue;
      series.push({ t, v });
    }
    series.sort((a, b) => a.t - b.t);
    device.socSeries = series;
    device.socMeta.error = null;
    device.socMeta.loading = false;
  } catch (err) {
    device.socSeries = [];
    device.socMeta.error = err.message || String(err);
    device.socMeta.loading = false;
  }
}

function buildSeriesChartSvg(series, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 110;
  const padL = 36;
  const padR = 10;
  const padT = 10;
  const padB = 18;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const emptyText = opts.emptyText || "暂无数据";
  const forceZeroMax = opts.forceZeroMax; // e.g. SOC 0-100

  if (!series.length) {
    return `<svg class="soc-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="soc-empty-text">${escapeHtml(
      emptyText
    )}</text>
    </svg>`;
  }

  const ys = series.map((p) => p.v);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (forceZeroMax) {
    yMin = 0;
    yMax = 100;
  } else {
    if (yMax === yMin) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;
  }

  const t0 = series[0].t;
  const t1 = series[series.length - 1].t || t0 + 1;
  const xAt = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * innerW;
  const yAt = (v) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;

  const points = series.map((p) => `${xAt(p.t).toFixed(1)},${yAt(p.v).toFixed(1)}`).join(" ");
  const areaPoints = `${padL},${padT + innerH} ${points} ${padL + innerW},${padT + innerH}`;
  const last = series[series.length - 1];

  const ticks = forceZeroMax
    ? [0, 50, 100]
    : [yMin, (yMin + yMax) / 2, yMax];
  const grid = ticks
    .map((v) => {
      const y = yAt(v);
      const label = forceZeroMax ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
      return `<line x1="${padL}" y1="${y}" x2="${padL + innerW}" y2="${y}" class="soc-grid" />
        <text x="${padL - 4}" y="${y + 3}" text-anchor="end" class="soc-axis">${label}</text>`;
    })
    .join("");

  const tLabel = (t) => {
    const d = new Date(t);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return `<svg class="soc-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    ${grid}
    <polygon points="${areaPoints}" class="soc-area" />
    <polyline points="${points}" class="soc-line" fill="none" />
    <circle cx="${xAt(last.t)}" cy="${yAt(last.v)}" r="2.5" class="soc-dot" />
    <text x="${padL}" y="${height - 4}" class="soc-axis">${escapeHtml(tLabel(t0))}</text>
    <text x="${padL + innerW}" y="${height - 4}" text-anchor="end" class="soc-axis">${escapeHtml(
      tLabel(t1)
    )}</text>
  </svg>`;
}

function buildSocChartSvg(series) {
  return buildSeriesChartSvg(series, { emptyText: "暂无 SOC 历史", forceZeroMax: true, height: 96 });
}

function fmtHms(t) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Interactive power chart: tooltip, 0-axis, brush zoom, X=HH:mm:ss
 * opts.syncGroup: string — charts in same group sync zoom time-range only
 */
const chartSyncGroups = new Map(); // groupId -> Set<api>

function mountInteractiveChart(container, fullSeries, opts = {}) {
  const unit = opts.unit || "W";
  const emptyText = opts.emptyText || "暂无数据";
  const includeZero = opts.includeZero !== false;
  const forceRange = opts.forceRange || null; // e.g. [0, 100] for SOC
  const syncGroup = opts.syncGroup || null;

  if (typeof container._chartCleanup === "function") {
    container._chartCleanup();
    container._chartCleanup = null;
  }

  container.innerHTML = "";
  container.classList.add("chart-interactive");

  if (!fullSeries?.length) {
    container.innerHTML = `<div class="chart-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }

  const toolbar = document.createElement("div");
  toolbar.className = "chart-toolbar";
  toolbar.innerHTML = `<button type="button" class="btn btn-sm btn-ghost" data-act="reset" disabled>复位缩放</button>
    <span class="chart-hint">拖拽选区缩放 · 悬停看数值 · 缩放时间轴联动</span>`;
  const canvas = document.createElement("canvas");
  canvas.className = "chart-canvas";
  const tip = document.createElement("div");
  tip.className = "chart-tooltip hidden";
  container.append(toolbar, canvas, tip);

  const resetBtn = toolbar.querySelector('[data-act="reset"]');
  let range = null; // {t0,t1} or null = full
  let brush = null; // {x0,x1} in canvas css px while dragging
  let hoverIdx = -1;
  let syncingZoom = false;

  const seriesInRange = () => {
    if (!range) return fullSeries;
    return fullSeries.filter((p) => p.t >= range.t0 && p.t <= range.t1);
  };

  const layout = () => {
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(280, container.clientWidth || 640);
    const cssH = opts.height || 110;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: cssW, h: cssH, padL: 40, padR: 10, padT: 8, padB: 22 };
  };

  const draw = () => {
    const series = seriesInRange();
    const { ctx, w, h, padL, padR, padT, padB } = layout();
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    ctx.clearRect(0, 0, w, h);

    if (!series.length) {
      ctx.fillStyle = "#9aa3af";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(emptyText, w / 2, h / 2);
      return;
    }

    const ys = series.map((p) => p.v);
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (forceRange) {
      yMin = forceRange[0];
      yMax = forceRange[1];
    } else {
      if (includeZero) {
        yMin = Math.min(yMin, 0);
        yMax = Math.max(yMax, 0);
      }
      if (yMax === yMin) {
        yMin -= 1;
        yMax += 1;
      }
      const pad = (yMax - yMin) * 0.08;
      yMin -= pad;
      yMax += pad;
    }

    const t0 = series[0].t;
    const t1 = series[series.length - 1].t || t0 + 1;
    const xAt = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * innerW;
    const yAt = (v) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;

    const ticks = forceRange
      ? [forceRange[0], (forceRange[0] + forceRange[1]) / 2, forceRange[1]]
      : [yMin, (yMin + yMax) / 2, yMax];
    if (!forceRange && includeZero && yMin < 0 && yMax > 0) {
      ticks.push(0);
    }
    const uniqTicks = [...new Set(ticks.map((v) => Math.round(v * 10) / 10))];
    ctx.strokeStyle = "#e8edf3";
    ctx.fillStyle = "#9aa3af";
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    for (const v of uniqTicks) {
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + innerW, y);
      ctx.stroke();
      ctx.fillText(String(v), padL - 6, y + 3);
    }

    if (!forceRange && includeZero && yMin < 0 && yMax > 0) {
      const y0 = yAt(0);
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, y0);
      ctx.lineTo(padL + innerW, y0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.fillStyle = "#64748b";
      ctx.fillText("0", padL - 6, y0 + 3);
    }

    const yZero =
      !forceRange && includeZero && yMin < 0 && yMax > 0 ? yAt(0) : padT + innerH;
    ctx.beginPath();
    ctx.moveTo(xAt(series[0].t), yZero);
    series.forEach((p) => ctx.lineTo(xAt(p.t), yAt(p.v)));
    ctx.lineTo(xAt(series[series.length - 1].t), yZero);
    ctx.closePath();
    ctx.fillStyle = "rgba(59, 130, 246, 0.12)";
    ctx.fill();

    ctx.beginPath();
    series.forEach((p, i) => {
      const x = xAt(p.t);
      const y = yAt(p.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.stroke();

    if (hoverIdx >= 0 && series[hoverIdx]) {
      const gx = xAt(series[hoverIdx].t);
      ctx.strokeStyle = "rgba(37, 99, 235, 0.35)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(gx, padT);
      ctx.lineTo(gx, padT + innerH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (let i = 0; i < series.length; i++) {
      const p = series[i];
      const x = xAt(p.t);
      const y = yAt(p.v);
      ctx.beginPath();
      ctx.arc(x, y, i === hoverIdx ? 3.5 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = i === hoverIdx ? "#1d4ed8" : "#2563eb";
      ctx.fill();
    }

    ctx.fillStyle = "#9aa3af";
    ctx.textAlign = "left";
    ctx.fillText(fmtHms(t0), padL, h - 6);
    ctx.textAlign = "end";
    ctx.fillText(fmtHms(t1), padL + innerW, h - 6);
    if (series.length > 2) {
      const mid = series[Math.floor(series.length / 2)];
      ctx.textAlign = "center";
      ctx.fillText(fmtHms(mid.t), padL + innerW / 2, h - 6);
    }

    if (brush) {
      const x0 = Math.min(brush.x0, brush.x1);
      const x1 = Math.max(brush.x0, brush.x1);
      ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
      ctx.fillRect(x0, padT, x1 - x0, innerH);
      ctx.strokeStyle = "rgba(37, 99, 235, 0.55)";
      ctx.strokeRect(x0, padT, x1 - x0, innerH);
    }

    canvas._chartMap = { series, xAt, yAt, t0, t1, padL, padR, padT, padB, innerW, innerH, w, h };
    resetBtn.disabled = !range;
  };

  const placeTip = (p) => {
    const m = canvas._chartMap;
    if (!m || !p) {
      tip.classList.add("hidden");
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const wrap = container.getBoundingClientRect();
    tip.textContent = `${fmtHms(p.t)}  ·  ${p.v}${unit}`;
    tip.classList.remove("hidden");
    const tx = m.xAt(p.t) + rect.left - wrap.left;
    const ty = m.yAt(p.v) + rect.top - wrap.top;
    tip.style.left = Math.min(Math.max(8, tx + 10), Math.max(8, wrap.width - 140)) + "px";
    tip.style.top = Math.max(8, ty - 28) + "px";
  };

  const applyRange = (next, fromPeer = false) => {
    range = next ? { t0: next.t0, t1: next.t1 } : null;
    hoverIdx = -1;
    tip.classList.add("hidden");
    draw();
    if (!fromPeer && syncGroup) {
      syncingZoom = true;
      for (const peer of chartSyncGroups.get(syncGroup) || []) {
        if (peer !== api) peer.setRange(next, true);
      }
      syncingZoom = false;
    }
  };

  const api = {
    setRange: (next, fromPeer) => applyRange(next, !!fromPeer),
  };

  if (syncGroup) {
    if (!chartSyncGroups.has(syncGroup)) chartSyncGroups.set(syncGroup, new Set());
    chartSyncGroups.get(syncGroup).add(api);
  }

  const cssX = (e) => {
    const rect = canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  };

  const nearestIndex = (x) => {
    const m = canvas._chartMap;
    if (!m?.series?.length) return -1;
    let best = -1;
    let bestDist = Infinity;
    m.series.forEach((p, i) => {
      const dx = Math.abs(m.xAt(p.t) - x);
      if (dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    });
    return bestDist <= 24 ? best : -1;
  };

  canvas.addEventListener("mousemove", (e) => {
    const x = cssX(e);
    if (brush) {
      brush.x1 = x;
      tip.classList.add("hidden");
      draw();
      return;
    }
    const idx = nearestIndex(x);
    hoverIdx = idx;
    if (idx < 0) {
      tip.classList.add("hidden");
      draw();
      return;
    }
    const p = seriesInRange()[idx];
    draw();
    placeTip(p);
  });

  canvas.addEventListener("mouseleave", () => {
    if (brush) return;
    hoverIdx = -1;
    tip.classList.add("hidden");
    draw();
  });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    brush = { x0: cssX(e), x1: cssX(e) };
    tip.classList.add("hidden");
  });

  const onUp = () => {
    if (!brush || !canvas._chartMap || syncingZoom) {
      brush = null;
      return;
    }
    const m = canvas._chartMap;
    const x0 = Math.min(brush.x0, brush.x1);
    const x1 = Math.max(brush.x0, brush.x1);
    brush = null;
    if (x1 - x0 < 12) {
      draw();
      return;
    }
    const tAt = (x) => {
      const r = (x - m.padL) / (m.innerW || 1);
      return m.t0 + Math.min(1, Math.max(0, r)) * (m.t1 - m.t0);
    };
    applyRange({ t0: tAt(x0), t1: tAt(x1) }, false);
  };
  document.addEventListener("mouseup", onUp);

  resetBtn.addEventListener("click", () => {
    applyRange(null, false);
  });

  container._chartCleanup = () => {
    document.removeEventListener("mouseup", onUp);
    if (syncGroup && chartSyncGroups.has(syncGroup)) {
      chartSyncGroups.get(syncGroup).delete(api);
      if (!chartSyncGroups.get(syncGroup).size) chartSyncGroups.delete(syncGroup);
    }
  };

  draw();
  requestAnimationFrame(draw);
}

function parseBizlogPowerValue(detail) {
  if (!detail) return null;
  const m = String(detail).match(/value\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  if (m) return Number(m[1]);
  const m2 = String(detail).match(/(-?\d+(?:\.\d+)?)\s*kW/i);
  if (m2) return Math.round(Number(m2[1]) * 1000);
  const m3 = String(detail).match(/(-?\d+(?:\.\d+)?)/);
  return m3 ? Number(m3[1]) : null;
}

function parseBizlogTime(eventTime) {
  // "2026-08-05 15:39:42:239"
  if (!eventTime) return null;
  const s = String(eventTime).replace(/:(\d{3})$/, ".$1");
  const t = Date.parse(s.replace(/-/g, "/"));
  return Number.isNaN(t) ? null : t;
}

function meterDpSpec(meter) {
  if (meter?.isThirdParty) {
    return { dpId: METER_THIRD_DP_ID, dpCode: METER_THIRD_DP_CODE, pid: null };
  }
  return { dpId: METER_DP_ID, dpCode: METER_DP_CODE, pid: METER_PID };
}

/**
 * 无实体电表时，电网节点所用的一体机（DP26 / grid_power / meter_power）。
 * 优先 home.lanMeterDeviceId；否则家庭内第一台。
 * @param {object} home
 * @returns {object|null}
 */
function resolveLanMeterDevice(home) {
  const devices = typeof homeLiveDevices === "function" ? homeLiveDevices(home) : home?.devices || [];
  if (!devices.length) return null;
  const want = String(home.lanMeterDeviceId || "").trim();
  if (want) {
    const hit = devices.find((d) => String(d.deviceId) === want);
    if (hit) return hit;
  }
  return devices[0] || null;
}

/**
 * 一体机「局域网电表配对功率」DP26，单位 W。
 * @param {object|null} device
 * @returns {number|null} null = 尚未读到
 */
function lanMeterPowerFromDevice(device) {
  if (!device) return null;
  const v = device.values || {};
  const raw = v.meter_power ?? v.grid_power;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * 电网节点展示功率：有电表用 lastValue；无电表用选中一体机 DP26。
 * @returns {{ watts: number|null, source: "meter"|"lan"|"none", device: object|null, label: string }}
 */
function resolveGridNodePower(home) {
  const meters = home?.meters || [];
  const meter = meters[0];
  const hasMeter =
    meter?.lastValue != null &&
    meter.lastValue !== "" &&
    Number.isFinite(Number(meter.lastValue));
  if (hasMeter) {
    return {
      watts: Number(meter.lastValue),
      source: "meter",
      device: null,
      label: meter.name || meter.deviceId || "电表",
    };
  }
  const device = resolveLanMeterDevice(home);
  const watts = lanMeterPowerFromDevice(device);
  return {
    watts,
    source: device ? "lan" : "none",
    device,
    label: device
      ? `${device.name || device.deviceId} · DP26`
      : "未选一体机",
  };
}

async function readMeterShadowLive(home, meter) {
  /** Real-time power via backendng device detail dataPoints. */
  const spec = meterDpSpec(meter);
  const detailJson = await fetchDeviceDetail(home, meter.deviceId);
  const detail = unwrapDeviceDetail(detailJson);
  const { byCode, byId } = indexDetailDataPoints(detail.dataPoints);
  const hit =
    byId[String(spec.dpId)] ||
    byCode[spec.dpCode] ||
    null;
  if (!hit) {
    meter.lastValue = null;
    return;
  }
  const rawVal = hit.valueObject ?? hit.value ?? hit.dpValue;
  // 涂鸦电表 active_power：kW scale=3；三方一体机 grid_power：通常为 W
  const dpSchema = meter.isThirdParty
    ? { unit: "W", scale: 0, type: "value" }
    : { unit: "kW", scale: 3, type: "value" };
  meter.lastValue = toDisplayValue(rawVal, dpSchema, "W");
  const t = Number(hit.time || hit.reportTime || 0);
  meter.reportTime = t || meter.reportTime || null;
}

async function readMeterBizlogHistory(home, meter) {
  /** Historical curve via Hestia bizlog/search (charts tab). */
  const spec = meterDpSpec(meter);
  meter.hestiaHost = hestiaHostForHome(home);
  const res = await CaseApi.searchBizlog(meter.hestiaHost, {
    eventIds: BIZLOG_EVENT_IDS,
    devId: meter.deviceId,
    limit: 50,
    dpIds: spec.dpId,
    gmt: "+08:00",
    eventIdAll: "1",
  });
  const upstream = res.data || {};
  if (upstream.code !== undefined && upstream.code !== 0) {
    throw new Error(upstream.msg || upstream.message || `hestia code ${upstream.code}`);
  }
  const data = upstream.data || {};
  const events = data.events || [];
  const series = [];
  for (const ev of events) {
    const t = parseBizlogTime(ev.eventTime);
    const v = parseBizlogPowerValue(ev.eventDetail);
    if (t == null || v == null || Number.isNaN(v)) continue;
    series.push({ t, v });
  }
  series.sort((a, b) => a.t - b.t);
  meter.powerSeries = series;
  meter.deviceInfo = data.deviceInfo || meter.deviceInfo;
  if (
    !meter.isThirdParty &&
    meter.deviceInfo?.productId &&
    meter.deviceInfo.productId !== METER_PID
  ) {
    meter.error = `PID 非电表期望值（${meter.deviceInfo.productId}）`;
  }
  meter.powerMeta = {
    dpId: spec.dpId,
    dpCode: spec.dpCode,
    pid: spec.pid,
    isThirdParty: !!meter.isThirdParty,
    count: series.length,
  };
}

async function readMeter(home, meter, opts = {}) {
  const batch = !!opts.batch;
  // 实时功率走 device detail dataPoints；bizlog 仅 charts 页显式 history:true
  const wantHistory = opts.history === true;
  meter.loading = true;
  meter.error = null;
  if (!batch) render();
  try {
    await readMeterShadowLive(home, meter);
    if (wantHistory) {
      try {
        await readMeterBizlogHistory(home, meter);
      } catch (histErr) {
        // 实时值已到手；曲线失败不阻断
        if (!meter.powerSeries?.length) {
          meter.powerMeta = {
            ...(meter.powerMeta || {}),
            historyError: histErr.message || String(histErr),
          };
        }
      }
    }
    meter.lastReadAt = Date.now();
    home.lastReadAt = Date.now();
  } catch (err) {
    meter.error = err.message || String(err);
    if (!batch) toast(`${meter.name || meter.deviceId}: ${meter.error}`, "error");
  } finally {
    meter.loading = false;
    if (!batch) render();
  }
}

async function issueDevice(home, device, opts = {}) {
  const batch = !!opts.batch;
  if (typeof deviceIsOnline === "function" && !deviceIsOnline(device)) {
    if (!batch) toast("设备离线，无法下发", "error");
    return false;
  }
  const propertyList = [];
  const wmDraft = (device.drafts?.work_mode || "").trim();
  if (wmDraft !== "" && String(device.values?.work_mode ?? "") !== wmDraft) {
    const field = HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode");
    const entry = resolveSchemaEntry(device.schema || {}, field || { code: "work_mode", aliases: ["work_mode"] });
    propertyList.push({
      dpId: String(entry?.dpId || field?.fallbackDpId || "51"),
      dpValue: wmDraft,
    });
  }
  for (const field of DP_EDITABLE) {
    const draft = (device.drafts[field.code] || "").trim();
    if (draft === "") continue;
    const cur = device.values[field.code];
    if (cur != null && String(cur) === draft) continue;
    const entry = resolveSchemaEntry(device.schema, field);
    if (!entry?.dpId) {
      if (!batch) toast(`缺少 ${field.label} 的 dpId，请先读取`, "error");
      return false;
    }
    if (field.useModelMax) {
      const max = modelMeta(device).maxExport;
      const n = Number(draft);
      if (max != null && !Number.isNaN(n) && n > max) {
        if (!batch) toast(`${field.label} 不能超过型号上限 ${max}W`, "error");
        return false;
      }
    }
    const raw = isFiniteNumber(draft) ? toIssueRaw(draft, entry.dpSchema) : draft;
    propertyList.push({ dpId: String(entry.dpId), dpValue: raw });
  }
  if (!propertyList.length) {
    if (!batch) toast("没有待下发的改动", "error");
    return false;
  }
  device.loading = true;
  if (!batch) render();
  try {
    const res = await CaseApi.issueDevice(home, {
      devId: device.deviceId,
      timestamp: null,
      propertyList,
    });
    const raw = unwrapResult(res);
    const upstream = res.data || {};
    const ok =
      res.ok !== false &&
      upstream.success !== false &&
      (raw?.success === true ||
        raw?.success === undefined ||
        Array.isArray(raw) ||
        res.status === 200);
    if (!ok) {
      throw new Error(upstream.errorMsg || raw?.errorMsg || raw?.message || "下发失败");
    }
    if (wmDraft !== "") {
      device.values.work_mode = wmDraft;
      device.drafts.work_mode = "";
    }
    for (const field of DP_EDITABLE) {
      const draft = (device.drafts[field.code] || "").trim();
      if (draft === "") continue;
      device.values[field.code] = isFiniteNumber(draft) ? Number(draft) : draft;
      device.drafts[field.code] = "";
    }
    if (!batch) {
      persist();
      toast(`${device.name || device.deviceId} 下发成功 (${propertyList.length})`, "ok");
    }
    return true;
  } catch (err) {
    if (!batch) toast(`${device.name || device.deviceId}: ${err.message || err}`, "error");
    else device.error = err.message || String(err);
    return false;
  } finally {
    device.loading = false;
    if (!batch) render();
  }
}

/**
 * Fetch 物模型 home_* 字段（不写 device，避免与影子并行时互相覆盖）。
 * @returns {{values: Object, regs: Object}|null}
 */
async function fetchDeviceHomeModelParams(home, device) {
  if (!device) return null;
  try {
    const res = await CaseApi.queryProperties(home, {
      page: "1",
      deviceId: device.deviceId,
    });
    const list = unwrapResult(res);
    const items = Array.isArray(list) ? list : list?.data || list?.items || [];
    const values = {};
    const regs = {};
    for (const it of items) {
      const code = it.code;
      if (!ALL_MODEL_CODES.includes(code)) continue;
      const field =
        HOME_FAMILY_FIELDS.find((f) => f.code === code) ||
        DEVICE_MODEL_READONLY.find((f) => f.code === code);
      if (!field) continue;
      const raw = it.value;
      const val = raw == null || raw === "" ? null : isFiniteNumber(raw) ? Number(raw) : String(raw);
      values[code] = val;
      const addr = parseRegAddr(it.model?.strategySpec);
      if (addr != null) {
        regs[code] = { addr, signed: !!field.signed };
      }
    }
    return { values, regs };
  } catch (err) {
    console.warn("fetchDeviceHomeModelParams", device.deviceId, err);
    return null;
  }
}

/** Apply fetched model params onto device / home.familyValues / familyRegs. */
function applyDeviceHomeModelParams(home, device, model, opts = {}) {
  if (!device || !model) return;
  if (!device.values) device.values = {};
  if (!home.familyValues) home.familyValues = {};
  Object.assign(device.values, model.values || {});
  if (opts.syncHome !== false) {
    for (const [code, val] of Object.entries(model.values || {})) {
      if (DEVICE_MODEL_READONLY.some((f) => f.code === code)) continue;
      if (opts.forceHome || home.familyValues[code] == null || home.familyValues[code] === "") {
        home.familyValues[code] = val;
      }
    }
  }
  home.familyRegs = { ...(home.familyRegs || {}), ...(model.regs || {}) };
}

/** Read 物模型 home_* fields into a device (and optionally sync home.familyValues). */
async function readDeviceHomeModelParams(home, device, opts = {}) {
  const model = await fetchDeviceHomeModelParams(home, device);
  applyDeviceHomeModelParams(home, device, model, opts);
}

/** @deprecated alias — sync home rail from first device */
async function readFamilyModelParams(home) {
  const device = (home.devices || [])[0];
  if (!device) return;
  await readDeviceHomeModelParams(home, device, { forceHome: true });
}

function effectiveFamilyValue(home, code) {
  const draft = (home.familyDrafts?.[code] || "").trim();
  if (draft !== "") return draft;
  const cur = home.familyValues?.[code];
  return cur == null ? "" : String(cur);
}

function buildFamilyIssueList(home, device) {
  const drafts = home.familyDrafts || {};
  const values = home.familyValues || {};
  const changed = HOME_FAMILY_FIELDS.filter((f) => {
    const v = (drafts[f.code] || "").trim();
    if (v === "") return false;
    return !(values[f.code] != null && String(values[f.code]) === v);
  });
  if (!changed.length) return [];

  const propertyList = [];
  const wantMode = changed.some((f) => f.code === "work_mode");
  const wantBase = changed.some((f) => f.code === "base_load");
  const wantFunc = changed.some((f) => f.via === "function_set");

  if (wantMode) {
    const field = HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode");
    const entry = resolveSchemaEntry(device.schema || {}, field);
    propertyList.push({
      dpId: String(entry?.dpId || field.fallbackDpId),
      dpValue: String(drafts.work_mode).trim(),
    });
  }
  if (wantBase) {
    const field = HOME_FAMILY_FIELDS.find((f) => f.code === "base_load");
    const entry = resolveSchemaEntry(device.schema || {}, field);
    const draft = String(drafts.base_load).trim();
    const raw = isFiniteNumber(draft) ? toIssueRaw(draft, entry?.dpSchema) : draft;
    propertyList.push({
      dpId: String(entry?.dpId || field.fallbackDpId),
      dpValue: raw,
    });
  }
  if (wantFunc) {
    const entries = [];
    for (const f of HOME_FAMILY_FIELDS.filter((x) => x.via === "function_set")) {
      const v = effectiveFamilyValue(home, f.code);
      if (v === "") continue;
      const reg = home.familyRegs?.[f.code];
      const addr = reg?.addr ?? f.regAddr;
      entries.push({ addr, value: Number(v), signed: !!(reg?.signed ?? f.signed) });
    }
    if (entries.length) {
      const entry = resolveSchemaEntry(device.schema || {}, {
        code: "function_set",
        aliases: ["function_set"],
      });
      propertyList.push({
        dpId: String(entry?.dpId || "52"),
        dpValue: packFunctionSetRaw(entries),
      });
    }
  }
  return propertyList;
}

/** Issue home-side drafts to every device in the home (parallel). */
async function issueFamilyToDevices(home) {
  if (!countFamilyDrafts(home)) {
    toast("没有家庭侧待下发改动", "error");
    return { ok: 0, fail: 0 };
  }
  const devices = homeLiveDevices(home);
  if (!devices.length) {
    toast("家庭内没有设备", "error");
    return { ok: 0, fail: 0 };
  }

  // 先并行补齐缺 schema 的设备，再并行下发
  await Promise.all(
    devices.map(async (device) => {
      if (Object.keys(device.schema || {}).length) return;
      try {
        const schemaRes = await CaseApi.queryPidSchema(home, { devId: device.deviceId });
        device.schema = indexSchema(unwrapResult(schemaRes));
      } catch (_) {}
    })
  );

  const results = await Promise.all(
    devices.map(async (device) => {
      const propertyList = buildFamilyIssueList(home, device);
      if (!propertyList.length) return null;
      try {
        const res = await CaseApi.issueDevice(home, {
          devId: device.deviceId,
          timestamp: null,
          propertyList,
        });
        const raw = unwrapResult(res);
        const upstream = res.data || {};
        const success =
          res.ok !== false &&
          upstream.success !== false &&
          (raw?.success === true ||
            raw?.success === undefined ||
            Array.isArray(raw) ||
            res.status === 200);
        if (!success) {
          throw new Error(upstream.errorMsg || raw?.errorMsg || raw?.message || "下发失败");
        }
        return true;
      } catch (err) {
        console.warn("issueFamily", device.deviceId, err);
        return false;
      }
    })
  );

  const issued = results.filter((r) => r !== null);
  const ok = issued.filter(Boolean).length;
  const fail = issued.length - ok;

  if (ok > 0) {
    if (!home.familyValues) home.familyValues = {};
    for (const f of HOME_FAMILY_FIELDS) {
      const draft = (home.familyDrafts?.[f.code] || "").trim();
      if (!draft) continue;
      home.familyValues[f.code] = isFiniteNumber(draft) ? Number(draft) : draft;
      home.familyDrafts[f.code] = "";
    }
    persist();
  }
  return { ok, fail };
}

function isFiniteNumber(v) {
  const n = Number(v);
  return v !== "" && !Number.isNaN(n) && Number.isFinite(n);
}

/* ---------- Render ---------- */

function fillEnvSelect(selectEl, selected, includeHestia = false) {
  selectEl.innerHTML = "";
  const entries = Object.entries(ENV_CONFIG);
  if (includeHestia) {
    for (const [host, meta] of Object.entries(HESTIA_ENVS)) {
      entries.push([host, { ...meta, supported: true }]);
    }
    for (const [host, meta] of Object.entries(BACKENDNG_ENVS)) {
      entries.push([host, { ...meta, supported: true }]);
    }
  }
  for (const [host, meta] of entries) {
    const opt = document.createElement("option");
    opt.value = host;
    opt.textContent = `${meta.name} (${meta.short})${meta.supported === false ? " · 未开放" : ""}`;
    if (host === selected) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

function renderSidebar() {
  const list = document.getElementById("homeList");
  list.innerHTML = "";
  for (const home of state.homes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "home-item" + (home.uid === state.activeHomeId ? " active" : "");
    btn.innerHTML = `<div class="title">${escapeHtml(homeDisplayName(home))}</div>
      <div class="sub">家庭 ID ${escapeHtml(home.homeId || "—")}</div>
      <div class="sub">${homeLiveDevices(home).length} 台设备</div>`;
    btn.addEventListener("click", () => {
      state.activeHomeId = home.uid;
      persist();
      render();
    });
    list.appendChild(btn);
  }
}

/** @type {'live'|'charts'|'election'|'snapshots'|'auto'} */
let homeTab = "live";
/** @type {'home'|'auto'} 由顶栏「实时运行 / 自动化」切换 */
let uiShell = "home";

const SNAPSHOT_KEY = "groupAppControl.snapshots.v1";
const SNAPSHOT_MAX = 12;
const SNAPSHOT_MAX_W = 3600;
const SNAPSHOT_JPEG_Q = 0.7;

/* ---------------------------------------------------------------------------
 * Cluster election trend — master deviceId timeline by reportTime
 * --------------------------------------------------------------------------- */
const ELECTION_ROLE_CODE = "device_cluster_role";
const ELECTION_DEFAULT_INTERVAL_SEC = 5;
const ELECTION_POLL_KEY = "gac_election_poll";

let electionIntervalSec = ELECTION_DEFAULT_INTERVAL_SEC;
let electionPollEnabled = false;
let electionPollTimer = null;
let electionPollBusy = false;
/** @type {string|null} */
let electionLastMasterId = null;
/** @type {Array<{pollAt:number,reportTime:number,masterDeviceId:string,masterName:string,masterChanged:boolean,prevMasterDeviceId:string}>} */
let electionTimeline = [];
let electionMeta = { rowCount: 0, path: "", lastPollAt: null, lastError: null };

try {
  electionPollEnabled = localStorage.getItem(ELECTION_POLL_KEY) === "1";
} catch (_) {
  electionPollEnabled = false;
}

function electionHomeKey(home) {
  if (!home) return "";
  return String(home.homeId || home.uid || "").trim();
}

function electionRoleNum(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parsePropertyReportTime(it) {
  if (!it || typeof it !== "object") return null;
  const candidates = [it.time, it.reportTime, it.gmtModified, it.updateTime, it.ts, it.timestamp];
  for (const c of candidates) {
    const n = Number(c);
    if (!Number.isFinite(n) || n <= 0) continue;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  return null;
}

/**
 * Query one device's device_cluster_role (property-query + code).
 */
async function fetchDeviceClusterRole(home, device) {
  const base = {
    deviceId: device.deviceId,
    deviceName: device.name || device.deviceId,
    role: null,
    roleLabel: "—",
    reportTime: null,
  };
  try {
    const res = await CaseApi.queryProperties(home, {
      page: "1",
      deviceId: device.deviceId,
      code: ELECTION_ROLE_CODE,
    });
    const list = unwrapResult(res);
    const items = Array.isArray(list) ? list : list?.data || list?.items || [];
    const hit =
      items.find((it) => it && it.code === ELECTION_ROLE_CODE) ||
      (items.length === 1 ? items[0] : null);
    if (!hit) return { ...base, error: "未找到 device_cluster_role" };
    const role = electionRoleNum(hit.value ?? hit.dpValue ?? hit.valueObject);
    return {
      ...base,
      role,
      roleLabel: clusterRoleLabel(role) || "—",
      reportTime: parsePropertyReportTime(hit),
    };
  } catch (err) {
    return { ...base, error: err.message || String(err) };
  }
}

/**
 * Build election snapshot from poll samples.
 * Requires ≥1 master (role=0 + reportTime). Also collects slaves and full device table.
 */
function analyzeElectionMasters(samples) {
  const devices = (samples || [])
    .filter((s) => s && !s.error && s.deviceId != null && s.deviceId !== "")
    .map((s) => {
      const role = electionRoleNum(s.role);
      const rt = Number(s.reportTime);
      return {
        deviceId: s.deviceId,
        deviceName: s.deviceName || s.deviceId,
        role,
        roleLabel: s.roleLabel || clusterRoleLabel(role) || "—",
        reportTime: Number.isFinite(rt) && rt > 0 ? rt : null,
      };
    })
    .sort((a, b) => {
      const ra = a.role == null ? 99 : a.role;
      const rb = b.role == null ? 99 : b.role;
      if (ra !== rb) return ra - rb;
      return String(a.deviceId).localeCompare(String(b.deviceId));
    });

  const masters = devices.filter((d) => d.role === 0 && d.reportTime != null);
  if (!masters.length) return null;
  masters.sort((a, b) => {
    const dt = Number(b.reportTime) - Number(a.reportTime);
    if (dt) return dt;
    return String(a.deviceId).localeCompare(String(b.deviceId));
  });
  const slaves = devices.filter((d) => d.role === 1);
  const ids = masters.map((m) => m.deviceId);
  const conflict = masters.length > 1;
  const masterDeviceId = conflict ? ids.join(" | ") : ids[0];
  const masterName = conflict
    ? masters.map((m) => m.deviceName || m.deviceId).join(" | ")
    : masters[0].deviceName || masters[0].deviceId;
  // CSV reportTime = max(reportTime) across all devices in this poll
  const allTimes = devices.map((d) => d.reportTime).filter((t) => t != null && Number(t) > 0);
  if (!allTimes.length) return null;
  const reportTime = Math.max(...allTimes.map(Number));
  return {
    conflict,
    masters,
    slaves,
    devices,
    masterDeviceId,
    masterName,
    masterDeviceIds: ids.join(","),
    slaveDeviceIds: slaves.map((s) => s.deviceId).join(","),
    reportTime,
  };
}

function parseElectionDevicesJson(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function rowsToElectionTimeline(rows) {
  const points = [];
  for (const r of rows || []) {
    const masterDeviceId = String(r.masterDeviceId || "").trim();
    const reportTime = Number(r.reportTime);
    if (!masterDeviceId || !Number.isFinite(reportTime) || reportTime <= 0) continue;
    const idsRaw = String(r.masterDeviceIds || "").trim();
    const masterIds = idsRaw
      ? idsRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : masterDeviceId.split("|").map((x) => x.trim()).filter(Boolean);
    const slaveIds = String(r.slaveDeviceIds || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const devices = parseElectionDevicesJson(r.devicesJson);
    points.push({
      pollAt: r.pollAt ? Number(r.pollAt) : reportTime,
      reportTime,
      masterDeviceId,
      masterName: r.masterName || masterDeviceId,
      masterChanged: String(r.masterChanged) === "1",
      prevMasterDeviceId: r.prevMasterDeviceId || "",
      conflict: String(r.conflict) === "1" || masterIds.length > 1,
      masterIds,
      slaveIds,
      devices,
    });
  }
  points.sort((a, b) => a.reportTime - b.reportTime || a.pollAt - b.pollAt);
  let prev = "";
  for (const p of points) {
    const key = p.conflict ? `conflict:${(p.masterIds || []).slice().sort().join(",")}` : p.masterDeviceId;
    const changed = !!prev && key !== prev;
    p.masterChanged = changed || !!p.conflict;
    if (changed && !p.conflict) p.prevMasterDeviceId = prev.startsWith("conflict:") ? prev.slice(9) : prev;
    prev = key;
  }
  return points;
}

function stopElectionPollTimer() {
  if (electionPollTimer) {
    clearInterval(electionPollTimer);
    electionPollTimer = null;
  }
}

function syncElectionPollUi() {
  const btn = document.getElementById("btnElectionPollToggle");
  const label = document.getElementById("electionPollLabel");
  const input = document.getElementById("electionIntervalSec");
  if (input && document.activeElement !== input) {
    input.value = String(electionIntervalSec);
  }
  if (btn) {
    btn.classList.toggle("on", !!electionPollEnabled);
    btn.setAttribute("aria-checked", electionPollEnabled ? "true" : "false");
  }
  if (label) {
    label.textContent = electionPollEnabled ? `轮询 · ${electionIntervalSec}s` : "轮询";
  }
}

function ensureElectionPollTimer() {
  stopElectionPollTimer();
  if (!electionPollEnabled) return;
  const ms = Math.max(1, electionIntervalSec) * 1000;
  electionPollTimer = setInterval(() => {
    tickElectionPoll();
  }, ms);
}

async function loadElectionSettings(home) {
  const homeId = electionHomeKey(home);
  if (!homeId) return;
  try {
    const data = await CaseApi.getElectionSettings(homeId);
    if (data?.ok && data.intervalSec) {
      electionIntervalSec = Math.max(1, Math.min(3600, Number(data.intervalSec) || ELECTION_DEFAULT_INTERVAL_SEC));
    }
  } catch (err) {
    console.warn("loadElectionSettings", err);
  }
  syncElectionPollUi();
}

async function saveElectionInterval(home, sec) {
  const homeId = electionHomeKey(home);
  const n = Math.max(1, Math.min(3600, Math.round(Number(sec) || ELECTION_DEFAULT_INTERVAL_SEC)));
  electionIntervalSec = n;
  syncElectionPollUi();
  try {
    await CaseApi.saveElectionSettings({ homeId, intervalSec: n });
  } catch (err) {
    console.warn("saveElectionInterval", err);
  }
  if (electionPollEnabled) ensureElectionPollTimer();
  toast(`轮询周期已设为 ${n}s`, "ok");
}

async function ensureElectionTimelineLoaded(home) {
  if (electionTimeline.length) return;
  const homeId = electionHomeKey(home);
  if (!homeId) return;
  try {
    const data = await CaseApi.getElectionRows(homeId, 2000);
    if (!data?.ok) return;
    electionMeta.rowCount = data.rowCount || 0;
    electionMeta.path = data.path || "";
    electionTimeline = rowsToElectionTimeline(data.rows || []);
    const last = electionTimeline[electionTimeline.length - 1];
    if (last?.masterDeviceId) electionLastMasterId = last.masterDeviceId;
  } catch (err) {
    console.warn("ensureElectionTimelineLoaded", err);
  }
}

async function loadElectionRows(home) {
  const host = document.getElementById("electionHost");
  const homeId = electionHomeKey(home);
  if (!homeId) {
    if (host) host.innerHTML = `<div class="election-empty">请先配置家庭 ID</div>`;
    return;
  }
  try {
    const data = await CaseApi.getElectionRows(homeId, 2000);
    if (!data?.ok) throw new Error(data?.error || "加载失败");
    electionMeta.rowCount = data.rowCount || 0;
    electionMeta.path = data.path || "";
    if (data.intervalSec) {
      electionIntervalSec = Math.max(1, Math.min(3600, Number(data.intervalSec)));
    }
    electionTimeline = rowsToElectionTimeline(data.rows || []);
    const last = electionTimeline[electionTimeline.length - 1];
    electionLastMasterId = last?.masterDeviceId || null;
  } catch (err) {
    electionMeta.lastError = err.message || String(err);
    if (host) {
      host.innerHTML = `<div class="election-empty">加载 CSV 失败：${escapeHtml(electionMeta.lastError)}</div>`;
    }
    return;
  }
  renderElectionPanel(home);
}

function renderElectionPanel(home) {
  const host = document.getElementById("electionHost");
  const summary = document.getElementById("electionSummary");
  if (!host || !summary) return;
  syncElectionPollUi();

  const points = electionTimeline;
  const changes = points.filter((p) => p.masterChanged && !p.conflict);
  const conflicts = points.filter((p) => p.conflict);
  const latest = points.length ? points[points.length - 1] : null;
  summary.innerHTML = `
    <div class="election-stat${latest?.conflict ? " warn" : ""}">
      <div class="k">当前主机</div>
      <div class="v">${escapeHtml(latest?.masterDeviceId || "—")}</div>
    </div>
    <div class="election-stat${changes.length ? " warn" : ""}">
      <div class="k">主机切换次数</div>
      <div class="v">${changes.length}</div>
    </div>
    <div class="election-stat${conflicts.length ? " warn" : ""}">
      <div class="k">双主机冲突</div>
      <div class="v">${conflicts.length}</div>
    </div>
    <div class="election-stat">
      <div class="k">上次采样</div>
      <div class="v">${electionMeta.lastPollAt ? fmtTime(electionMeta.lastPollAt) : "—"}</div>
    </div>
  `;

  if (!points.length) {
    host.innerHTML = `<div class="election-empty">暂无主机时间轴。开启轮询或点「立即采样」后，将按 reportTime 记录主机 deviceId。</div>`;
    return;
  }

  const ordered = [...points].reverse();
  host.innerHTML = `<ol class="election-timeline">${ordered
    .map((p, idx) => {
      const conflict = !!p.conflict;
      const changed = !!p.masterChanged && !conflict;
      // newest / conflict / change → expanded; stable older → collapsed
      const collapsed = !(idx === 0 || conflict || changed);
      const badge = conflict
        ? `<span class="election-badge conflict">双主机冲突 ×${(p.masterIds || []).length || 2}</span>`
        : changed
          ? `<span class="election-badge change">主机切换</span>`
          : `<span class="election-badge stable">稳定</span>`;
      const masterIds = p.masterIds?.length
        ? p.masterIds
        : String(p.masterDeviceId || "")
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean);
      const slaveIds =
        p.slaveIds?.length
          ? p.slaveIds
          : (p.devices || []).filter((d) => Number(d.role) === 1).map((d) => d.deviceId);
      const masterList = masterIds
        .map((id) => `<div class="election-tl-id master">${escapeHtml(id)}</div>`)
        .join("");
      const slaveList = slaveIds.length
        ? slaveIds.map((id) => `<div class="election-tl-id slave">${escapeHtml(id)}</div>`).join("")
        : `<div class="election-tl-muted">（无）</div>`;
      const tableRows = (p.devices || [])
        .map((d) => {
          const roleN = d.role;
          const roleTxt = d.roleLabel || clusterRoleLabel(roleN) || "—";
          const rt = d.reportTime ? fmtTime(d.reportTime) : "—";
          const cls =
            roleN === 0 ? "is-master" : roleN === 1 ? "is-slave" : roleN === 2 ? "is-electing" : "";
          return `<tr class="${cls}">
            <td class="col-name">${escapeHtml(d.deviceName || "—")}</td>
            <td class="col-id">${escapeHtml(d.deviceId || "—")}</td>
            <td class="col-role">${escapeHtml(roleTxt)}${roleN == null ? "" : ` (${roleN})`}</td>
            <td class="col-rt">${escapeHtml(rt)}</td>
          </tr>`;
        })
        .join("");
      const table = tableRows
        ? `<div class="election-tl-table-wrap">
            <table class="election-tl-table">
              <thead><tr><th>名称</th><th>设备 ID</th><th>角色</th><th>reportTime</th></tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>`
        : `<div class="election-tl-muted">无设备明细（旧记录）</div>`;
      const summaryLine = conflict
        ? `冲突主机 ${masterIds.length} · 从机 ${slaveIds.length}`
        : `主机 ${escapeHtml(masterIds[0] || "—")} · 从机 ${slaveIds.length}`;
      return `<li class="election-tl-item${conflict ? " conflict" : changed ? " changed" : ""}${
        collapsed ? " is-collapsed" : ""
      }">
        <div class="election-tl-dot" aria-hidden="true"></div>
        <div class="election-tl-card">
          <button type="button" class="election-tl-head" data-act="election-fold" aria-expanded="${collapsed ? "false" : "true"}">
            <span class="election-tl-chevron" aria-hidden="true"></span>
            <div class="election-tl-head-main">
              <div class="election-tl-top">
                <div class="election-tl-time">reportTime ${escapeHtml(fmtTime(p.reportTime))}</div>
                ${badge}
              </div>
              <div class="election-tl-summary">${summaryLine}</div>
            </div>
          </button>
          <div class="election-tl-body">
            <div class="election-tl-cols">
              <div class="election-tl-master">
                <span class="k">${conflict ? "主机(冲突)" : "主机"}</span>
                <div class="election-tl-ids">${masterList}</div>
              </div>
              <div class="election-tl-master">
                <span class="k">从机${slaveIds.length ? ` · ${slaveIds.length}` : ""}</span>
                <div class="election-tl-ids">${slaveList}</div>
              </div>
            </div>
            ${
              changed
                ? `<div class="election-tl-change">${escapeHtml(p.prevMasterDeviceId || "—")} → ${escapeHtml(
                    p.masterDeviceId
                  )}</div>`
                : ""
            }
            ${
              conflict
                ? `<div class="election-tl-change">同时有 ${masterIds.length} 台 device_cluster_role=0</div>`
                : ""
            }
            ${table}
            <div class="election-tl-poll">采样 ${escapeHtml(fmtTime(p.pollAt))}</div>
          </div>
        </div>
      </li>`;
    })
    .join("")}</ol>`;

  host.querySelectorAll('[data-act="election-fold"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".election-tl-item");
      if (!item) return;
      const open = item.classList.toggle("is-collapsed");
      // open=true means now collapsed
      btn.setAttribute("aria-expanded", open ? "false" : "true");
    });
  });
}

async function tickElectionPoll(opts = {}) {
  if (electionPollBusy) return;
  const home = activeHome();
  if (!home) return;
  if (!opts.force && !electionPollEnabled) return;
  const devices = homeLiveDevices(home);
  if (!devices.length) {
    if (opts.force) toast("当前家庭没有一体机", "error");
    return;
  }
  electionPollBusy = true;
  try {
    const pollAt = Date.now();
    const samples = await Promise.all(devices.map((d) => fetchDeviceClusterRole(home, d)));
    for (const s of samples) {
      const d = devices.find((x) => x.deviceId === s.deviceId);
      if (!d) continue;
      if (!d.values) d.values = {};
      if (s.role != null) d.values.device_cluster_role = s.role;
    }
    const master = analyzeElectionMasters(samples);
    electionMeta.lastPollAt = pollAt;
    electionMeta.lastError = null;
    if (!master) {
      if (opts.force) toast("本轮未落盘：未找到主机（device_cluster_role=0）", "ok");
      if (homeTab === "election") await loadElectionRows(home);
      return;
    }
    await ensureElectionTimelineLoaded(home);
    const prev = electionLastMasterId || "";
    const changed = !!prev && prev !== master.masterDeviceId;
    // reportTime already in table/CSV → do not write again
    const existsSameReportTime = electionTimeline.some(
      (p) => Number(p.reportTime) === Number(master.reportTime)
    );
    if (existsSameReportTime) {
      electionMeta.lastPollAt = pollAt;
      if (opts.force) {
        toast(`reportTime ${fmtTime(master.reportTime)} 已存在，跳过写入`, "ok");
      }
      if (homeTab === "election") renderElectionPanel(home);
      return;
    }
    const homeId = electionHomeKey(home);
    const row = {
      pollAt: String(pollAt),
      reportTime: String(master.reportTime),
      homeId,
      masterDeviceId: master.masterDeviceId,
      masterName: master.masterName,
      masterChanged: changed || master.conflict ? "1" : "0",
      prevMasterDeviceId: changed ? prev : "",
      conflict: master.conflict ? "1" : "0",
      masterDeviceIds: master.masterDeviceIds,
      slaveDeviceIds: master.slaveDeviceIds || "",
      devicesJson: JSON.stringify(master.devices || []),
    };
    if (homeId) {
      const { json: data } = await CaseApi.appendElection({ homeId, rows: [row] });
      if (!data?.ok) throw new Error(data?.error || "写入 CSV 失败");
      electionMeta.rowCount = data.rowCount || electionMeta.rowCount;
      electionMeta.path = data.path || electionMeta.path;
    }
    electionLastMasterId = master.masterDeviceId;
    if (homeTab === "election") await loadElectionRows(home);
    if (master.conflict) {
      toast(`双主机冲突：${master.masterDeviceId}`, "error");
    } else if (opts.force) {
      toast(
        changed
          ? `主机切换 → ${master.masterDeviceId}`
          : `主机 ${master.masterDeviceId} · ${fmtTime(master.reportTime)}`,
        changed ? "error" : "ok"
      );
    } else if (changed) {
      toast(`主机切换 → ${master.masterDeviceId}`, "error");
    }
  } catch (err) {
    electionMeta.lastError = err.message || String(err);
    console.warn("tickElectionPoll", err);
    if (opts.force || homeTab === "election") {
      toast(`选举采样失败：${electionMeta.lastError}`, "error");
    }
  } finally {
    electionPollBusy = false;
  }
}

function setElectionPollEnabled(on) {
  electionPollEnabled = !!on;
  try {
    localStorage.setItem(ELECTION_POLL_KEY, electionPollEnabled ? "1" : "0");
  } catch (_) {}
  syncElectionPollUi();
  if (electionPollEnabled) {
    ensureElectionPollTimer();
    tickElectionPoll({ force: true });
    toast(`已开启选举轮询（每 ${electionIntervalSec}s）`, "ok");
  } else {
    stopElectionPollTimer();
    toast("已关闭选举轮询", "ok");
  }
}

async function mountElectionPanel(home) {
  if (!home) return;
  await loadElectionSettings(home);
  syncElectionPollUi();
  await loadElectionRows(home);
  if (electionPollEnabled) ensureElectionPollTimer();
}

function applyUiShell(shell) {
  const next = shell === "auto" ? "auto" : (shell === "monitor" ? "monitor" : "home");
  const changed = uiShell !== next;
  uiShell = next;
  document.body.classList.toggle("shell-auto", next === "auto");
  document.body.classList.toggle("shell-monitor", next === "monitor");
  const monView = document.getElementById("familyMonitorView");
  if (monView) {
    monView.classList.toggle("hidden", next !== "monitor");
  }
  if (next === "auto") {
    homeTab = "auto";
  } else if (homeTab === "auto") {
    homeTab = "live";
  }
  if (changed) {
    render();
  } else {
    _syncHomeTabPanels();
  }
}

function setHomeTab(tab) {
  if (uiShell === "auto") {
    homeTab = "auto";
    _syncHomeTabPanels();
    renderAutoTest();
    return;
  }
  const allowed = ["live", "charts", "snapshots", "election"];
  homeTab = allowed.includes(tab) ? tab : "live";
  _syncHomeTabPanels();
  if (homeTab === "live") {
    const home = activeHome();
    if (home?.homeId && (home.devices || []).length) {
      refreshDeviceOnlineFlags(home)
        .then(() => {
          if (homeTab === "live" && activeHome()?.uid === home.uid) {
            render();
          }
        })
        .catch(() => {});
    }
  }
  if (homeTab === "charts") {
    const home = activeHome();
    if (home) {
      mountChartsPanel(home);
      // 历史曲线：电表 bizlog + 设备 SOC query-neko（实时页不调）
      for (const m of home.meters || []) {
        if (m.powerSeries?.length) continue;
        readMeter(home, m, { batch: true, history: true }).then(() => {
          if (homeTab === "charts" && activeHome()?.uid === home.uid) mountChartsPanel(home);
        });
      }
      for (const d of homeLiveDevices(home)) {
        if (d.socSeries?.length) continue;
        scheduleSocFetch(home, d);
      }
    }
  }
  if (homeTab === "election") {
    const home = activeHome();
    if (home) mountElectionPanel(home);
  }
  if (homeTab === "snapshots") {
    mountSnapshotsPanel();
  }
  if (homeTab === "auto") {
    renderAutoTest();
  }
}

function _syncHomeTabPanels() {
  document.querySelectorAll("#homeTabs .home-tab").forEach((btn) => {
    const on = btn.getAttribute("data-tab") === homeTab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("tabLive")?.classList.toggle("hidden", homeTab !== "live");
  document.getElementById("tabCharts")?.classList.toggle("hidden", homeTab !== "charts");
  document.getElementById("tabElection")?.classList.toggle("hidden", homeTab !== "election");
  document.getElementById("tabSnapshots")?.classList.toggle("hidden", homeTab !== "snapshots");
  document.getElementById("tabAuto")?.classList.toggle("hidden", uiShell !== "auto");
}

let uiRoute = "home"; // "home" | "loginMgr"（不入 store）

function renderMain() {
  const empty = document.getElementById("emptyState");
  const view = document.getElementById("homeView");
  const lm = document.getElementById("loginMgrView");
  const monView = document.getElementById("familyMonitorView");
  if (uiRoute === "loginMgr") {
    empty.classList.add("hidden");
    view.classList.add("hidden");
    monView?.classList.add("hidden");
    if (lm) lm.classList.remove("hidden");
    renderLoginMgr();
    return;
  }
  if (lm) lm.classList.add("hidden");
  if (uiShell === "monitor") {
    empty.classList.add("hidden");
    view.classList.add("hidden");
    monView?.classList.remove("hidden");
    return;
  }
  monView?.classList.add("hidden");
  if (uiShell === "auto") {
    empty.classList.add("hidden");
    view.classList.remove("hidden");
    const home = activeHome();
    document.getElementById("homeTitle").textContent = "自动化";
    document.getElementById("homeMeta").textContent = home
      ? `${homeDisplayName(home)}${home.homeId ? ` · ${home.homeId}` : ""} · ${homeLiveDevices(home).length} 台设备`
      : "运行 / 报告时请选择家庭";
    const hasCookie = Object.values(state.cookies || {}).some(Boolean);
    document.getElementById("cookieBanner")?.classList.toggle("hidden", hasCookie);
    _syncHomeTabPanels();
    renderAutoTest();
    return;
  }
  const home = activeHome();
  if (!home) {
    empty.classList.remove("hidden");
    view.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  view.classList.remove("hidden");

  document.getElementById("homeTitle").textContent = homeDisplayName(home);
  const parts = [];
  if (home.homeId) parts.push(`家庭 ID ${home.homeId}`);
  parts.push(`${homeLiveDevices(home).length} 台设备`);
  if (home.authId) parts.push(`authId ${home.authId}`);
  if (home.lastReadAt) parts.push(`上次读取 ${fmtTime(home.lastReadAt)}`);
  document.getElementById("homeMeta").textContent = parts.join("，");

  const draftCount = countHomeDrafts(home);
  const issueAll = document.getElementById("btnIssueAll");
  issueAll.disabled = draftCount === 0;
  issueAll.textContent = draftCount ? `一键下发 (${draftCount})` : "一键下发";

  const hasCookie = !!(state.cookies[home.envHost] || "").trim() || Object.values(state.cookies).some(Boolean);
  document.getElementById("cookieBanner").classList.toggle("hidden", hasCookie);
  const onLocal = isLocalHostPage();
  const bannerText = document.getElementById("cookieBannerText");
  const bannerBtn = document.getElementById("btnAutoCookieBanner");
  if (bannerText) {
    bannerText.textContent = onLocal
      ? "当前环境尚未配置 Cookie。可点「自动获取」从本机浏览器 SSO 填入，再「推送到虚拟机」。"
      : "当前环境尚未配置 Cookie。请在本机自动获取后推送到虚拟机，或打开「登录态」手动粘贴。";
  }
  if (bannerBtn) bannerBtn.classList.toggle("hidden", !onLocal);

  _syncHomeTabPanels();

  const host = document.getElementById("flowHost");
  const canvasView = captureLiveCanvasView();
  host.innerHTML = typeof renderHomeEnergyFlow === "function" ? renderHomeEnergyFlow(home) : "";
  bindFlowHost(home);
  restoreLiveCanvasView(canvasView);

  if (homeTab === "charts") {
    mountChartsPanel(home);
  }
  if (homeTab === "election") {
    mountElectionPanel(home);
  }
  if (homeTab === "snapshots") {
    mountSnapshotsPanel();
  }
  if (uiShell === "auto" || homeTab === "auto") {
    renderAutoTest();
  }
}

function renderMeterCard(home, meter) {
  meter.hestiaHost = hestiaHostForHome(home);
  const card = document.createElement("article");
  card.className = "card meter-card" + (meter.loading ? " status-loading" : "");
  if (meter.error) card.classList.add("status-error");
  const hestia = HESTIA_ENVS[meter.hestiaHost] || { short: meter.hestiaHost };
  const info = meter.deviceInfo || {};
  const lastText =
    meter.lastValue == null || Number.isNaN(Number(meter.lastValue))
      ? "—"
      : `${meter.lastValue}W`;

  card.innerHTML = `
    <div class="card-head">
      <div class="card-head-main">
        <div class="card-title-row">
          <input type="text" class="name-input" data-act="name"
            value="${escapeAttr(meter.name || "")}" placeholder="填写电表名称" />
          <span class="badge badge-meter">${meter.isThirdParty ? "三方电表" : "电表"}</span>
        </div>
        <div class="card-sub">
          <button type="button" class="id id-copy" data-act="copy-id"
            title="点击复制设备 ID">${escapeHtml(meter.deviceId)}</button>
          <span class="dot">·</span>
          <span class="note">${escapeHtml(hestia.short || "")}</span>
          ${info.productName ? `<span class="dot">·</span><span class="note">${escapeHtml(info.productName)}</span>` : ""}
          ${info.dbStatus ? `<span class="dot">·</span><span class="note">${escapeHtml(info.dbStatus)}</span>` : ""}
        </div>
      </div>
    </div>
    <div class="soc-panel meter-power-panel">
      <div class="soc-head">
        <div class="soc-title">
          <span>功率曲线</span>
          <span class="dp-hint">${METER_DP_ID} · ${METER_DP_CODE}</span>
        </div>
        <div class="soc-stats">
          <span class="meter-power-now ${meter.lastValue != null && meter.lastValue < 0 ? "green" : ""}">${escapeHtml(lastText)}</span>
          ${
            meter.powerSeries?.length
              ? `<span>${meter.powerSeries.length} 点</span>`
              : meter.error
                ? `<span class="err">${escapeHtml(meter.error)}</span>`
                : `<span>读取后加载</span>`
          }
          ${meter.lastReadAt ? `<span>${escapeHtml(fmtTime(meter.lastReadAt))}</span>` : ""}
        </div>
      </div>
      <div class="soc-chart" data-power-chart></div>
    </div>
    <div class="card-foot">
      <div class="time">
        <span class="time-label">Hestia</span>
        <span>${escapeHtml(meter.hestiaHost)}</span>
        ${meter.error && meter.powerSeries?.length ? `<span class="err">· ${escapeHtml(meter.error)}</span>` : ""}
      </div>
      <div class="ops">
        <button type="button" class="btn-link" data-act="edit">编辑</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="read">读取</button>
        <button type="button" class="btn btn-sm btn-danger-outline" data-act="remove">移除</button>
      </div>
    </div>
  `;

  card.querySelector('[data-act="name"]').addEventListener("input", (e) => {
    meter.name = e.target.value.trim();
    persist();
  });
  card.querySelector('[data-act="copy-id"]').addEventListener("click", async () => {
    try {
      await copyText(meter.deviceId);
      toast("已复制电表设备 ID", "ok");
    } catch (err) {
      toast(`复制失败: ${err.message || err}`, "error");
    }
  });
  card.querySelector('[data-act="edit"]').addEventListener("click", () => openMeterDialog(meter));
  card.querySelector('[data-act="read"]').addEventListener("click", () => readMeter(home, meter));
  card.querySelector('[data-act="remove"]').addEventListener("click", () => {
    if (!confirm(`移除电表 ${meter.name || meter.deviceId}？`)) return;
    home.meters = home.meters.filter((x) => x.uid !== meter.uid);
    persist();
    render();
  });

  const chartEl = card.querySelector("[data-power-chart]");
  mountInteractiveChart(chartEl, meter.powerSeries || [], {
    unit: "W",
    includeZero: true,
    emptyText: "暂无功率历史",
    height: 160,
  });

  return card;
}

function renderDeviceCard(home, device) {
  const model = modelMeta(device);
  const card = document.createElement("article");
  card.className = "card";
  if (device.loading) card.classList.add("status-loading");
  if (device.error) card.classList.add("status-error");

  const draftsN = countDrafts(device);

  const visibleDisplay = DP_DISPLAY.filter((m) => resolveSchemaEntry(device.schema || {}, m));
  const visibleEditable = DP_EDITABLE.filter((f) => resolveSchemaEntry(device.schema || {}, f));

  const metricsHtml = visibleDisplay.length
    ? visibleDisplay
        .map((m) => {
          const raw = device.values[m.code];
          const cls = ["value", m.tone || (raw == null ? "muted" : "")].filter(Boolean).join(" ");
          return `<div class="metric">
      <div class="label">${fieldLabelHtml(device, m)}</div>
      <div class="${cls}">${escapeHtml(fmtNum(raw, m.unit))}</div>
    </div>`;
        })
        .join("")
    : `<div class="metric-empty">${
        Object.keys(device.schema || {}).length
          ? "当前 pid-schema 无匹配展示点"
          : "请先读取以加载 pid-schema"
      }</div>`;

  const limitsHtml = visibleEditable
    .map((f) => {
      const cur = device.values[f.code];
      const draft = (device.drafts[f.code] || "").trim();
      const echo = cur != null && cur !== "" && !Number.isNaN(Number(cur)) ? String(cur) : "";
      const shown = draft !== "" ? draft : echo;
      const isDirty = draft !== "" && draft !== echo;
      const maxHint = f.useModelMax && model.maxExport != null ? model.maxExport : null;
      const over =
        maxHint != null &&
        cur != null &&
        !Number.isNaN(Number(cur)) &&
        Number(cur) > maxHint;
      const maxAttr = maxHint != null ? ` max="${maxHint}"` : "";
      const curText = fmtNum(cur, f.unit);
      const capText = maxHint != null ? `上限 ${maxHint}${f.unit}` : "";
      const ph = echo || "—";
      return `<div class="limit-row" data-code="${f.code}">
      <div class="limit-meta">
        <div class="limit-title">
          <span class="field-name">${escapeHtml(f.label)}</span>
          ${over ? '<span class="warn">超限</span>' : ""}
        </div>
        <div class="dp-hint">${escapeHtml(fieldMatchHint(device, f))}</div>
        <div class="limit-cur">
          当前 <strong>${escapeHtml(curText)}</strong>
          ${capText ? `<span class="cap">· ${escapeHtml(capText)}</span>` : ""}
        </div>
      </div>
      <div class="limit-input-wrap">
        <input type="number" inputmode="numeric" placeholder="${escapeAttr(ph)}"
          value="${escapeAttr(shown)}" data-field="${f.code}" data-echo="${escapeAttr(echo)}"
          ${maxHint != null ? `data-max="${maxHint}"` : ""}${maxAttr}
          min="0" class="${isDirty ? "dirty" : ""}" />
        <span class="unit">${escapeHtml(f.unit)}</span>
      </div>
    </div>`;
    })
    .join("");

  card.innerHTML = `
    <div class="card-head">
      <div class="card-head-main">
        <div class="card-title-row">
          <input type="text" class="name-input" data-act="name"
            value="${escapeAttr(device.name || "")}"
            placeholder="填写设备名称" />
          <span class="badge" title="${escapeAttr(
            device.pid
              ? `PID ${device.pid}${model.maxExport != null ? ` · 上限 ${model.maxExport}W` : ""}`
              : "读取后按 PID 匹配型号"
          )}">${escapeHtml(model.badge)}${
            model.maxExport != null ? ` · ${model.maxExport}W` : ""
          }</span>
        </div>
        <div class="card-sub">
          <button type="button" class="id id-copy" data-act="copy-id"
            title="点击复制设备 ID">${escapeHtml(device.deviceId)}</button>
          ${device.pid ? `<span class="dot">·</span><span class="note">PID ${escapeHtml(device.pid)}</span>` : ""}
          ${device.note ? `<span class="dot">·</span><span class="note">${escapeHtml(device.note)}</span>` : ""}
        </div>
        <div class="version-kv card-meta-kv">
          ${versionRowHtml("IP", device.ip || "")}
          ${versionRowHtml("SSID", device.ssidHash || "")}
        </div>
      </div>
      <div class="card-head-actions">
        <button type="button" class="btn-icon-refresh" data-act="refresh"
          title="读取该设备（detail dataPoints + SOC）" ${device.loading ? "disabled" : ""} aria-label="刷新">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
      </div>
    </div>
    <div class="metrics">${metricsHtml}</div>
    ${limitsHtml ? `<div class="limits">${limitsHtml}</div>` : ""}
    <div class="soc-panel">
      <div class="soc-head">
        <div class="soc-title">
          <span>SOC 曲线</span>
          <span class="dp-hint">${escapeHtml(
            device.socMeta?.code ? `query-neko · ${device.socMeta.code}` : "query-neko · heap_soc"
          )}</span>
        </div>
        <div class="soc-stats">
          ${
            device.socMeta?.loading
              ? `<span>SOC 加载中…</span>`
              : device.socSeries?.length
              ? `<span>${device.socSeries.length} 点</span>
                 <span>近 ${device.socMeta?.hours || 24}h</span>
                 <span>末值 ${escapeHtml(String(device.socSeries[device.socSeries.length - 1].v))}%</span>`
              : device.socMeta?.error
                ? `<span class="err">${escapeHtml(device.socMeta.error)}</span>`
                : `<span>读取后加载</span>`
          }
        </div>
      </div>
      <div class="soc-chart" data-soc-chart></div>
    </div>
    <div class="card-foot">
      <div class="time">
        <span class="time-label">最近上报</span>
        <span>${fmtTime(device.reportTime)}</span>
        ${device.reportTime ? `<span class="rel">${relativeTime(device.reportTime)}</span>` : ""}
        ${device.error ? `<span class="err">· ${escapeHtml(device.error)}</span>` : ""}
      </div>
      <div class="ops">
        <button type="button" class="btn-link" data-act="edit">编辑</button>
        <button type="button" class="btn btn-sm btn-danger-outline" data-act="remove">移除</button>
        <button type="button" class="btn btn-sm ${
          draftsN ? "btn-primary" : ""
        }" data-act="issue" ${draftsN ? "" : "disabled"}>
          ${draftsN ? `下发 (${draftsN})` : "下发"}
        </button>
      </div>
    </div>
  `;

  const nameInput = card.querySelector('[data-act="name"]');
  nameInput.addEventListener("input", () => {
    device.name = nameInput.value.trim();
    persist();
  });
  nameInput.addEventListener("change", () => {
    device.name = nameInput.value.trim();
    persist();
  });

  card.querySelector('[data-act="copy-id"]').addEventListener("click", async () => {
    try {
      await copyText(device.deviceId);
      toast("已复制设备 ID", "ok");
    } catch (err) {
      toast(`复制失败: ${err.message || err}`, "error");
    }
  });

  card.querySelectorAll("input[data-field]").forEach((input) => {
    const applyValue = ({ commitEmptyToEcho }) => {
      const code = input.getAttribute("data-field");
      const maxRaw = input.getAttribute("data-max");
      const echo = input.getAttribute("data-echo") || "";
      let v = input.value.trim();

      // Allow clearing digits while typing; only restore echo on blur
      if (v === "") {
        device.drafts[code] = "";
        input.classList.remove("dirty", "invalid");
        if (commitEmptyToEcho && echo) {
          input.value = echo;
        }
        persist();
        updateIssueButtons();
        return;
      }

      if (maxRaw != null && isFiniteNumber(v)) {
        const max = Number(maxRaw);
        let n = Number(v);
        if (n > max) {
          n = max;
          v = String(max);
          input.value = v;
          input.classList.add("invalid");
          toast(`${DP_EDITABLE.find((f) => f.code === code)?.label || "该值"}不能超过上限 ${max}`, "error");
        } else {
          input.classList.remove("invalid");
        }
        if (n < 0) {
          n = 0;
          v = "0";
          input.value = v;
        }
      }

      if (v === echo) {
        device.drafts[code] = "";
        input.classList.remove("dirty", "invalid");
      } else {
        device.drafts[code] = v;
        input.classList.add("dirty");
      }
      persist();
      updateIssueButtons();
    };

    input.addEventListener("input", () => applyValue({ commitEmptyToEcho: false }));
    input.addEventListener("change", () => applyValue({ commitEmptyToEcho: false }));
    input.addEventListener("blur", () => applyValue({ commitEmptyToEcho: true }));
  });

  card.querySelector('[data-act="edit"]').addEventListener("click", () => openDeviceDialog(device));
  card.querySelector('[data-act="refresh"]').addEventListener("click", () => readDevice(home, device));
  card.querySelector('[data-act="remove"]').addEventListener("click", () => {
    if (!confirm(`移除设备 ${device.name || device.deviceId}？`)) return;
    home.devices = home.devices.filter((d) => d.uid !== device.uid);
    persist();
    render();
  });
  card.querySelector('[data-act="issue"]').addEventListener("click", () => {
    if (!deviceIsOnline(device)) {
      toast("设备离线，无法下发", "error");
      return;
    }
    issueDevice(home, device);
  });

  mountInteractiveChart(card.querySelector("[data-soc-chart]"), device.socSeries || [], {
    unit: "%",
    emptyText: device.socMeta?.error || "暂无 SOC 历史",
    forceRange: [0, 100],
    height: 110,
  });

  return card;
}

function updateIssueButtons() {
  const home = activeHome();
  if (!home) return;
  const draftCount = countHomeDrafts(home);
  const issueAll = document.getElementById("btnIssueAll");
  issueAll.disabled = draftCount === 0;
  issueAll.textContent = draftCount ? `一键下发 (${draftCount})` : "一键下发";

  const famN = countFamilyDrafts(home);
  const famBtn = document.querySelector('#flowHost [data-act="family-issue"]');
  if (famBtn) {
    famBtn.disabled = famN === 0;
    famBtn.textContent = famN ? `下发 (${famN})` : "下发";
    famBtn.classList.toggle("on", famN > 0);
  }
  const famHint = document.querySelector("#flowHost .fb-foot-hint");
  if (famHint) {
    famHint.textContent = famN ? `${famN} 项待下发` : "无草稿";
  }

  document.querySelectorAll("#flowHost .u3[data-device-uid]").forEach((card) => {
    const uid = card.getAttribute("data-device-uid");
    const device = home.devices.find((d) => d.uid === uid);
    if (!device) return;
    const online = deviceIsOnline(device);
    const n = countDrafts(device);
    const canIssue = online && n > 0;
    const btn = card.querySelector('[data-act="issue"]');
    if (!btn) return;
    btn.disabled = !canIssue;
    btn.textContent = n ? `下发 (${n})` : "下发";
    btn.classList.toggle("on", canIssue);
    btn.classList.toggle("is-offline", !online);
    btn.title = online
      ? (n ? `下发 ${n} 个草稿点` : "暂无待下发草稿")
      : "设备离线，无法下发";
    card.classList.toggle("is-offline", !online);
    let mark = card.querySelector(".u3-offline-mark");
    if (!online) {
      if (!mark) {
        mark = document.createElement("span");
        mark.className = "u3-offline-mark";
        mark.title = "设备离线，无法下发";
        mark.textContent = "离线";
        card.prepend(mark);
      }
    } else if (mark) {
      mark.remove();
    }
    const reportEl = card.querySelector(".u3-report-time");
    if (reportEl) {
      const reportAt = device.reportTime ? Number(device.reportTime) : 0;
      const reportAbs = reportAt > 0 ? fmtTime(reportAt) : "";
      const reportRel = reportAt > 0 ? relativeTime(reportAt) : "";
      reportEl.textContent = reportAt > 0
        ? `${reportAbs}${reportRel ? ` · ${reportRel}` : ""}`
        : "尚未上报";
      reportEl.title = reportAt > 0
        ? `最新上报时间 ${reportAbs}${reportRel ? `（${reportRel}）` : ""}`
        : "尚未读到设备上报时间";
    }
  });
}

/** Drag one card corner: width/height apply to every device card. */
function bindLiveCardResize(home, host) {
  const svg = host.querySelector("svg.flow-svg");
  if (!svg) return;
  const hs = 11;
  const toSvg = (clientX, clientY) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  };

  const originsOf = () =>
    [...svg.querySelectorAll("foreignObject[data-unit-card]")]
      .map((fo) => ({
        fo,
        uid: fo.getAttribute("data-unit-card"),
        x: Number(fo.getAttribute("x")),
        y: Number(fo.getAttribute("y")),
        gap: Number(fo.getAttribute("data-next-gap") || 0),
      }))
      .sort((a, b) => a.x - b.x);

  const applyBox = (origins, box) => {
    let x = origins.length ? origins[0].x : 0;
    origins.forEach((o) => {
      o.fo.setAttribute("x", String(x));
      o.fo.setAttribute("width", String(box.w));
      o.fo.setAttribute("height", String(box.h));
      const handle = svg.querySelector(`.live-card-resize[data-device-uid="${CSS.escape(o.uid)}"]`);
      if (handle) {
        handle.setAttribute("x", String(x + box.w - hs / 2));
        handle.setAttribute("y", String(o.y + box.h - hs / 2));
      }
      x += box.w + o.gap;
    });
  };

  svg.querySelectorAll("[data-card-resize]").forEach((el) => {
    el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      home.cardBox = null;
      persist();
      render();
      toast("已恢复卡片默认大小", "ok");
    });
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const uid = el.getAttribute("data-device-uid");
      const fo = svg.querySelector(`foreignObject[data-unit-card="${CSS.escape(uid)}"]`);
      if (!fo) return;
      const origins = originsOf();
      const x0 = Number(fo.getAttribute("x"));
      const y0 = Number(fo.getAttribute("y"));
      const w0 = Number(fo.getAttribute("width"));
      const h0 = Number(fo.getAttribute("height"));
      liveCanvasDragging = true;
      let moved = false;
      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {}
      const onMove = (ev) => {
        const p = toSvg(ev.clientX, ev.clientY);
        const next = clampLiveCardBox(p.x - x0, p.y - y0);
        if (Math.hypot(next.w - w0, next.h - h0) < 3 && !moved) return;
        moved = true;
        applyBox(origins, next);
      };
      const onUp = (ev) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        try {
          el.releasePointerCapture(e.pointerId);
        } catch (_) {}
        liveCanvasDragging = false;
        if (!moved) return;
        const p = toSvg(ev.clientX, ev.clientY);
        home.cardBox = clampLiveCardBox(p.x - x0, p.y - y0);
        persist();
        render();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  });
}

/** Drag terminal nodes; multi-select moves together. */
function bindBusMove(home, host) {
  const svg = host.querySelector("svg.flow-svg");
  if (!svg) return;

  const toSvg = (clientX, clientY) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  };

  const applySelClass = () => {
    host.querySelectorAll(".wire-bus-node[data-bus-id]").forEach((n) => {
      n.classList.toggle("selected", liveCanvasSel.buses.has(n.getAttribute("data-bus-id")));
    });
  };

  svg.querySelectorAll("[data-bus-move]").forEach((hit) => {
    hit.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest?.(".wire-plug, [data-wire-src]")) return;
      e.preventDefault();
      e.stopPropagation();
      const busId = hit.getAttribute("data-bus-id");
      if (!busId) return;
      liveCanvasSel.wire = null;
      if (e.shiftKey) {
        if (liveCanvasSel.buses.has(busId)) liveCanvasSel.buses.delete(busId);
        else liveCanvasSel.buses.add(busId);
        applySelClass();
        return;
      }
      if (!liveCanvasSel.buses.has(busId)) {
        liveCanvasSel.buses = new Set([busId]);
        applySelClass();
      }
      const ids = [...liveCanvasSel.buses];
      const items = ids
        .map((id) => {
          const nodes = [
            ...host.querySelectorAll(`.wire-bus-node[data-bus-id="${CSS.escape(id)}"]`),
          ];
          const body = nodes.find((n) => n.querySelector("rect:not(.bus-move-hit)")) || nodes[0];
          const rect = body?.querySelector("rect:not(.bus-move-hit)");
          if (!body || !rect) return null;
          return {
            id,
            nodes,
            x: Number(rect.getAttribute("x")),
            y: Number(rect.getAttribute("y")),
          };
        })
        .filter(Boolean);
      if (!items.length) return;
      const start = toSvg(e.clientX, e.clientY);
      let moved = false;
      liveCanvasDragging = true;
      const onMove = (ev) => {
        const p = toSvg(ev.clientX, ev.clientY);
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        items.forEach((it) => {
          it.nodes.forEach((node) => {
            node.setAttribute("transform", `translate(${dx}, ${dy})`);
            node.classList.add("moving");
          });
        });
      };
      const onUp = (ev) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        liveCanvasDragging = false;
        items.forEach((it) => it.nodes.forEach((node) => node.classList.remove("moving")));
        if (!moved) {
          items.forEach((it) => it.nodes.forEach((node) => node.removeAttribute("transform")));
          return;
        }
        const p = toSvg(ev.clientX, ev.clientY);
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        items.forEach((it) => setBusPosition(home, it.id, it.x + dx, it.y + dy));
        persist();
        render();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  });
}

function applyLiveCanvasZoom(host) {
  const wrap = host?.querySelector?.(".flow-svg-wrap") || document.querySelector("#flowHost .flow-svg-wrap");
  const svg = wrap?.querySelector("svg.flow-svg");
  if (!wrap || !svg) {
    return;
  }
  const vb = String(svg.getAttribute("viewBox") || "").trim().split(/\s+/);
  const baseW = Number(svg.getAttribute("width")) || Number(vb[2]) || svg.clientWidth || 1;
  const baseH = Number(svg.getAttribute("height")) || Number(vb[3]) || svg.clientHeight || 1;
  const scale = Math.max(0.45, Math.min(3, liveCanvasZoom));
  liveCanvasZoom = scale;
  svg.style.width = `${Math.round(baseW * scale)}px`;
  svg.style.height = `${Math.round(baseH * scale)}px`;
}

function zoomLiveCanvasAt(wrap, clientX, clientY, nextScale) {
  const prev = liveCanvasZoom;
  const scale = Math.max(0.45, Math.min(3, nextScale));
  if (!wrap || prev <= 0) {
    liveCanvasZoom = scale;
    applyLiveCanvasZoom(wrap?.closest?.("#flowHost") || wrap);
    return;
  }
  const rect = wrap.getBoundingClientRect();
  const cx = wrap.scrollLeft + (clientX - rect.left);
  const cy = wrap.scrollTop + (clientY - rect.top);
  const ratio = scale / prev;
  liveCanvasZoom = scale;
  applyLiveCanvasZoom(wrap.closest("#flowHost") || wrap);
  wrap.scrollLeft = cx * ratio - (clientX - rect.left);
  wrap.scrollTop = cy * ratio - (clientY - rect.top);
}

/**
 * @brief Two-finger pinch / trackpad pinch to zoom the live energy canvas
 * @param[in] host flow host element
 * @return none
 */
function bindLiveCanvasPinchZoom(host) {
  const wrap = host.querySelector(".flow-svg-wrap");
  if (!wrap) {
    return;
  }
  applyLiveCanvasZoom(host);
  const pointers = new Map();
  let pinch = null;
  let gestureBase = 1;
  wrap.addEventListener(
    "wheel",
    (ev) => {
      if (!(ev.ctrlKey || ev.metaKey)) {
        return;
      }
      ev.preventDefault();
      const factor = Math.exp(-ev.deltaY * 0.012);
      zoomLiveCanvasAt(wrap, ev.clientX, ev.clientY, liveCanvasZoom * factor);
    },
    { passive: false }
  );
  wrap.addEventListener("pointerdown", (ev) => {
    if (liveCanvasTypingTarget(ev.target)) {
      return;
    }
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size >= 2) {
      liveCanvasPinching = true;
      const pts = [...pointers.values()];
      pinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        scale: liveCanvasZoom,
      };
    }
  });
  wrap.addEventListener("pointermove", (ev) => {
    if (!pointers.has(ev.pointerId)) {
      return;
    }
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size < 2 || !pinch || pinch.dist < 8) {
      return;
    }
    ev.preventDefault();
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const cx = (pts[0].x + pts[1].x) / 2;
    const cy = (pts[0].y + pts[1].y) / 2;
    zoomLiveCanvasAt(wrap, cx, cy, pinch.scale * (dist / pinch.dist));
  });
  const endPtr = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) {
      pinch = null;
      liveCanvasPinching = false;
    }
  };
  wrap.addEventListener("pointerup", endPtr);
  wrap.addEventListener("pointercancel", endPtr);
  wrap.addEventListener("gesturestart", (ev) => {
    ev.preventDefault();
    gestureBase = liveCanvasZoom;
  });
  wrap.addEventListener("gesturechange", (ev) => {
    ev.preventDefault();
    zoomLiveCanvasAt(wrap, ev.clientX, ev.clientY, gestureBase * ev.scale);
  });
}

/** Empty-canvas drag: marquee-select terminals. */
function bindLiveMarquee(home, host) {
  const svg = host.querySelector("svg.flow-svg");
  if (!svg) return;
  const layer = svg.querySelector("#marqueeLayer");
  const toSvg = (clientX, clientY) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  };
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (liveCanvasPinching || !e.isPrimary) return;
    if (
      e.target.closest?.(
        ".wire-plug, .wire-port-pad, .wire-bus-node, .u3, foreignObject, .wire-select-hit, [data-select-wire], [data-wire-src], .live-card-resize, [data-card-resize]"
      )
    ) {
      return;
    }
    e.preventDefault();
    const p0 = toSvg(e.clientX, e.clientY);
    let box = null;
    liveCanvasDragging = true;
    const onMove = (ev) => {
      if (liveCanvasPinching) {
        return;
      }
      const p1 = toSvg(ev.clientX, ev.clientY);
      const x = Math.min(p0.x, p1.x);
      const y = Math.min(p0.y, p1.y);
      const w = Math.abs(p1.x - p0.x);
      const h = Math.abs(p1.y - p0.y);
      box = { x, y, w, h };
      if (layer) {
        layer.innerHTML = `<rect class="live-marquee" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      liveCanvasDragging = false;
      if (layer) layer.innerHTML = "";
      if (!box || box.w < 8 || box.h < 8) {
        if (liveCanvasSel.buses.size || liveCanvasSel.wire) {
          liveCanvasSel.buses = new Set();
          liveCanvasSel.wire = null;
          render();
        }
        return;
      }
      liveCanvasSel.wire = null;
      const next = new Set();
      host.querySelectorAll(".wire-bus-node[data-bus-id]").forEach((node) => {
        const r = node.querySelector("rect:not(.bus-move-hit)");
        if (!r) return;
        const bx = Number(r.getAttribute("x"));
        const by = Number(r.getAttribute("y"));
        const bw = Number(r.getAttribute("width"));
        const bh = Number(r.getAttribute("height"));
        if (bx + bw < box.x || box.x + box.w < bx || by + bh < box.y || box.y + box.h < by) return;
        next.add(node.getAttribute("data-bus-id"));
      });
      liveCanvasSel.buses = next;
      render();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

/** On-canvas drag wiring: bus ↔ device port, Grid ↔ Family bus. */
function bindWiringDrag(home, host) {
  const svg = host.querySelector("svg.flow-svg");
  if (!svg) return;
  const rubber = svg.querySelector("#wireRubberBand");
  let drag = null;

  const toSvg = (clientX, clientY) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  };

  const clearRubber = () => {
    if (rubber) rubber.innerHTML = "";
    svg.classList.remove("wire-dragging");
    host.querySelectorAll(".wire-port-pad.drop-ok, .wire-port-pad.drop-bad").forEach((el) => {
      el.classList.remove("drop-ok", "drop-bad");
    });
    host.querySelectorAll(".wire-pv-group.drop-ok, .wire-pv-group.drop-bad").forEach((el) => {
      el.classList.remove("drop-ok", "drop-bad");
    });
    host.querySelectorAll(".wire-bus-node.drop-ok, .wire-bus-node.drop-bad").forEach((el) => {
      el.classList.remove("drop-ok", "drop-bad");
    });
  };

  const drawRubber = (x1, y1, x2, y2, ok) => {
    if (!rubber) return;
    rubber.innerHTML = `<path d="M${x1} ${y1} L${x2} ${y2}" class="wire-rubber${ok ? " ok" : ""}" />
      <circle cx="${x2}" cy="${y2}" r="5" class="wire-rubber-dot${ok ? " ok" : ""}"/>`;
  };

  const parseSrc = (el) => {
    const raw = el?.getAttribute?.("data-wire-src") || "";
    if (raw.startsWith("bus:")) {
      return {
        type: "bus",
        busId: raw.slice(4),
        kind: el.getAttribute("data-bus-kind") || wiringBusById(home, raw.slice(4))?.kind,
      };
    }
    if (raw.startsWith("device:")) {
      const parts = raw.split(":");
      return {
        type: "device",
        deviceUid: parts[1],
        port: parts[2],
        idx: parseLivePortIdx(parts[3]),
      };
    }
    return null;
  };

  const busKindOfNode = (node) =>
    node?.getAttribute?.("data-bus-kind") ||
    node?.querySelector?.("[data-bus-kind]")?.getAttribute("data-bus-kind") ||
    wiringBusById(home, node?.getAttribute?.("data-bus-id"))?.kind;

  const padCompatible = (src, pad) => {
    const port = pad.getAttribute("data-port");
    if (src.type === "bus") return kindsAllowedForPort(port).includes(src.kind);
    return false;
  };

  const busCompatible = (src, node) => {
    if (!src || src.type !== "bus") return false;
    const id = node.getAttribute("data-bus-id");
    if (!id || id === src.busId) return false;
    return canConnectBusPair(src.kind, busKindOfNode(node));
  };

  /** Snap to nearest compatible device port within screen px. */
  const nearestPad = (clientX, clientY, src, maxPx = 56) => {
    let best = null;
    let bestD = maxPx;
    host.querySelectorAll(".wire-port-pad").forEach((pad) => {
      if (!padCompatible(src, pad)) return;
      const c = pad.querySelector("circle:not(.wire-hit)") || pad.querySelector("circle");
      if (!c) return;
      const r = c.getBoundingClientRect();
      const d0 = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
      const d = pad.getAttribute("data-port-idx") === "all" ? d0 * 0.65 : d0;
      if (d < bestD) {
        bestD = d;
        best = pad;
      }
    });
    return best;
  };

  const nearestBus = (clientX, clientY, src, maxPx = 56) => {
    let best = null;
    let bestD = maxPx;
    host.querySelectorAll(".wire-bus-node[data-bus-id]").forEach((node) => {
      const busId = node.getAttribute("data-bus-id");
      const kind = busKindOfNode(node);
      if (src.type === "device") {
        if (!kindsAllowedForPort(src.port).includes(kind)) return;
      } else if (src.type === "bus") {
        if (!canConnectBusPair(src.kind, kind) || busId === src.busId) return;
      } else {
        return;
      }
      const plug = node.querySelector(".wire-plug");
      const box = plug || node.querySelector("rect");
      if (!box) return;
      const r = box.getBoundingClientRect();
      const d = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    });
    return best;
  };

  const highlightTargets = (src) => {
    host.querySelectorAll(".wire-port-pad").forEach((pad) => {
      pad.classList.remove("drop-ok", "drop-bad");
      if (!src) return;
      if (src.type === "bus") {
        pad.classList.add(padCompatible(src, pad) ? "drop-ok" : "drop-bad");
      }
    });
    host.querySelectorAll(".wire-bus-node[data-bus-id]").forEach((node) => {
      node.classList.remove("drop-ok", "drop-bad");
      if (!src || src.type !== "bus") return;
      node.classList.add(busCompatible(src, node) ? "drop-ok" : "drop-bad");
    });
    host.querySelectorAll(".wire-pv-group").forEach((grp) => {
      grp.classList.remove("drop-ok", "drop-bad");
      if (!src || src.type !== "bus") return;
      const pads = [...grp.querySelectorAll(".wire-port-pad")];
      if (pads.some((p) => p.classList.contains("drop-ok"))) grp.classList.add("drop-ok");
      else if (pads.length && pads.every((p) => p.classList.contains("drop-bad"))) grp.classList.add("drop-bad");
    });
  };

  const onMove = (e) => {
    if (!drag) return;
    const p = toSvg(e.clientX, e.clientY);
    let ok = false;
    if (drag.src.type === "bus") {
      ok = !!nearestPad(e.clientX, e.clientY, drag.src, 56) || !!nearestBus(e.clientX, e.clientY, drag.src, 56);
    } else if (drag.src.type === "device") {
      ok = !!nearestBus(e.clientX, e.clientY, drag.src, 56);
    }
    drawRubber(drag.x0, drag.y0, p.x, p.y, ok);
  };

  const onUp = (e) => {
    if (!drag) return;
    const src = drag.src;
    const cur = drag;
    clearRubber();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    liveCanvasDragging = false;
    drag = null;

    let changed = false;
    if (src.type === "bus") {
      const hitEl = document.elementFromPoint(e.clientX, e.clientY);
      const hitOtherBus =
        hitEl?.closest?.(".wire-bus-node") || nearestBus(e.clientX, e.clientY, src, 56);
      const dstPad =
        hitEl?.closest?.("[data-wire-dst]") || nearestPad(e.clientX, e.clientY, src, 56);
      const dstBusId = hitOtherBus?.getAttribute?.("data-bus-id") || "";
      const dstKind = hitOtherBus ? busKindOfNode(hitOtherBus) : "";
      if (dstBusId && dstBusId !== src.busId && canConnectBusPair(src.kind, dstKind)) {
        if (setBusLink(home, src.busId, dstBusId)) {
          changed = true;
          toast("已连接 电网 ↔ 家庭负载", "ok");
        } else {
          toast("端子之间仅支持 电网 ↔ 家庭负载", "error");
        }
      } else if (dstPad) {
        const uid = dstPad.getAttribute("data-device-uid");
        const port = dstPad.getAttribute("data-port");
        const idx = parseLivePortIdx(dstPad.getAttribute("data-port-idx"));
        if (setDeviceWiringPort(home, uid, port, src.busId, idx)) {
          changed = true;
          toast(
            isAllPortIdx(idx) && port === "pv"
              ? `已连接 ${src.kind} → 全部 PV 口`
              : `已连接 ${src.kind} → ${port}`,
            "ok"
          );
        } else {
          toast("端子类型与端口不匹配（Grid→Grid / PV→PV / 家庭·Bypass→离网）", "error");
        }
      } else {
        const p = toSvg(e.clientX, e.clientY);
        const dx = p.x - cur.x0;
        const dy = p.y - cur.y0;
        if (dx * dx + dy * dy > 400) {
          toast("未落到端口，接线取消", "error");
        }
      }
    } else if (src.type === "device") {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const dstBus =
        el?.closest?.("[data-bus-id]") || nearestBus(e.clientX, e.clientY, src, 56);
      if (dstBus) {
        const busId = dstBus.getAttribute("data-bus-id");
        if (setDeviceWiringPort(home, src.deviceUid, src.port, busId, src.idx)) {
          changed = true;
          toast(
            isAllPortIdx(src.idx) && src.port === "pv"
              ? "已连接 全部 PV 口 → 端子"
              : `已连接 ${src.port} → 端子`,
            "ok"
          );
        } else {
          toast("端子类型与端口不匹配", "error");
        }
      } else {
        const p = toSvg(e.clientX, e.clientY);
        const dx = p.x - cur.x0;
        const dy = p.y - cur.y0;
        if (dx * dx + dy * dy > 400) {
          toast("未落到端子，接线取消", "error");
        }
      }
    }

    host.querySelectorAll(".wire-port-pad.drop-ok, .wire-port-pad.drop-bad").forEach((n) => {
      n.classList.remove("drop-ok", "drop-bad");
    });
    host.querySelectorAll(".wire-pv-group.drop-ok, .wire-pv-group.drop-bad").forEach((n) => {
      n.classList.remove("drop-ok", "drop-bad");
    });
    host.querySelectorAll(".wire-bus-node.drop-ok, .wire-bus-node.drop-bad").forEach((n) => {
      n.classList.remove("drop-ok", "drop-bad");
    });

    if (changed) {
      persist();
      render();
    }
  };

  svg.querySelectorAll("[data-wire-src]").forEach((el) => {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const src = parseSrc(el);
      if (!src) return;
      if (src.type === "bus" && !src.kind) {
        src.kind = wiringBusById(home, src.busId)?.kind;
      }
      const p = toSvg(e.clientX, e.clientY);
      drag = { src, x0: p.x, y0: p.y };
      liveCanvasDragging = true;
      svg.classList.add("wire-dragging");
      highlightTargets(src);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  });

  const selectWire = (sel) => {
    liveCanvasSel.wire = sel;
    liveCanvasSel.buses.clear();
    render();
  };

  svg.querySelectorAll("[data-select-wire]").forEach((el) => {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectWire(parseLiveWireSel(el.getAttribute("data-select-wire")));
    });
  });
}

/** Bind clicks / drafts inside energy-flow foreignObject cards + rail. */
function bindFlowHost(home) {
  const host = document.getElementById("flowHost");
  if (!host || !home) return;

  host.querySelector('[data-act="auto-wire"]')?.addEventListener("click", () => {
    const n = autoWireAllDevices(home);
    persist();
    render();
    toast(n ? `已一键全接 ${n} 台设备` : "接线已是全接状态", "ok");
  });
  host.querySelector('[data-act="clear-wires"]')?.addEventListener("click", () => {
    if (!confirm("清除当前家庭全部设备与端子的连线？")) return;
    const n = clearAllDeviceWires(home);
    persist();
    render();
    toast(n ? `已清空 ${n} 台设备接线` : "当前没有接线", "ok");
  });
  host.querySelector('[data-act="toggle-auto-refresh"]')?.addEventListener("click", () => {
    toggleAutoRefresh();
  });
  host.querySelector('[data-act="toggle-high-freq"]')?.addEventListener("click", () => {
    toggleHighFreqReporting();
  });
  host.querySelector('[data-act="clear-drafts"]')?.addEventListener("click", () => {
    const n = countHomeDrafts(home);
    if (!n) {
      toast("没有待下发的缓存参数", "ok");
      return;
    }
    if (!confirm(`清除当前家庭 ${n} 项待下发草稿？不会影响设备已生效参数。`)) return;
    const cleared = clearHomeDrafts(home);
    persist();
    updateIssueButtons();
    render();
    toast(`已清空 ${cleared} 项待下发缓存`, "ok");
  });
  host.querySelector('[data-act="manage-buses"]')?.addEventListener("click", () => {
    if (typeof openWiringDialog === "function") openWiringDialog();
    else if (typeof window.openWiringDialog === "function") window.openWiringDialog();
  });
  bindBusMove(home, host);
  bindWiringDrag(home, host);
  bindLiveMarquee(home, host);
  bindLiveCardResize(home, host);
  bindLiveCanvasPinchZoom(host);

  host.querySelectorAll(".u3[data-device-uid]").forEach((card) => {
    const device = home.devices.find((d) => d.uid === card.getAttribute("data-device-uid"));
    if (!device) return;

    card.querySelectorAll("input[data-field]").forEach((input) => {
      const applyValue = ({ commitEmptyToEcho }) => {
        const code = input.getAttribute("data-field");
        const maxRaw = input.getAttribute("data-max");
        const echo = input.getAttribute("data-echo") || "";
        let v = input.value.trim();
        if (v === "") {
          device.drafts[code] = "";
          input.classList.remove("dirty", "invalid");
          if (commitEmptyToEcho && echo) input.value = echo;
          persist();
          updateIssueButtons();
          return;
        }
        if (maxRaw != null && isFiniteNumber(v)) {
          const max = Number(maxRaw);
          let n = Number(v);
          if (n > max) {
            n = max;
            v = String(max);
            input.value = v;
            input.classList.add("invalid");
            toast(`${DP_EDITABLE.find((f) => f.code === code)?.label || "该值"}不能超过上限 ${max}`, "error");
          } else {
            input.classList.remove("invalid");
          }
          if (n < 0) {
            v = "0";
            input.value = v;
          }
        }
        if (v === echo) {
          device.drafts[code] = "";
          input.classList.remove("dirty", "invalid");
        } else {
          device.drafts[code] = v;
          input.classList.add("dirty");
        }
        persist();
        updateIssueButtons();
      };
      input.addEventListener("input", () => applyValue({ commitEmptyToEcho: false }));
      input.addEventListener("change", () => applyValue({ commitEmptyToEcho: false }));
      input.addEventListener("blur", () => applyValue({ commitEmptyToEcho: true }));
    });

    card.querySelectorAll("select[data-field]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const code = sel.getAttribute("data-field");
        const echo = sel.getAttribute("data-echo") || "";
        const v = String(sel.value ?? "").trim();
        if (v === "" || v === echo) {
          device.drafts[code] = "";
          sel.classList.remove("dirty");
        } else {
          device.drafts[code] = v;
          sel.classList.add("dirty");
        }
        persist();
        updateIssueButtons();
        if (code === "work_mode" && v === "manual") {
          openManualScheduleDialog(home, device, { kind: "manual" });
        } else if (code === "work_mode" && v === "time_of_use") {
          openManualScheduleDialog(home, device, { kind: "time_of_use" });
        } else if (code === "work_mode") {
          // re-render so 配置时段 button shows/hides
          render();
        }
      });
    });

    card.querySelector('[data-act="manual-schedule"]')?.addEventListener("click", () => {
      openManualScheduleDialog(home, device, { kind: "manual" });
    });
    card.querySelector('[data-act="tou-schedule"]')?.addEventListener("click", () => {
      openManualScheduleDialog(home, device, { kind: "time_of_use" });
    });

    card.querySelector('[data-act="edit"]')?.addEventListener("click", () => openDeviceDialog(device));
    card.querySelector('[data-act="refresh"]')?.addEventListener("click", () => readDevice(home, device));
    card.querySelector('[data-act="more-points"]')?.addEventListener("click", () => openDevicePointsDialog(home, device));
    card.querySelector('[data-act="reg-query"]')?.addEventListener("click", () => openRegQueryDialog(home, device));
    card.querySelector('[data-act="owner-strat"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openOwnerStrategyDialog(home, device);
    });
    card.querySelector('[data-act="copy-id"]')?.addEventListener("click", async () => {
      try {
        await copyText(device.deviceId);
        toast("已复制设备 ID", "ok");
      } catch (err) {
        toast(`复制失败: ${err.message || err}`, "error");
      }
    });
    card.querySelector('[data-act="remove"]')?.addEventListener("click", () => {
      if (!confirm(`移除设备 ${device.name || device.deviceId}？`)) return;
      home.devices = home.devices.filter((d) => d.uid !== device.uid);
      if (home.wiring?.devices) delete home.wiring.devices[device.uid];
      ensureHomeWiring(home);
      persist();
      render();
    });
    card.querySelector('[data-act="issue"]')?.addEventListener("click", () => {
      if (!deviceIsOnline(device)) {
        toast("设备离线，无法下发", "error");
        return;
      }
      issueDevice(home, device);
    });
  });

  host.querySelectorAll(".rail-meter[data-meter-uid]").forEach((el) => {
    const meter = (home.meters || []).find((m) => m.uid === el.getAttribute("data-meter-uid"));
    if (!meter) return;
    el.querySelector('[data-act="meter-name"]')?.addEventListener("input", (e) => {
      meter.name = e.target.value.trim();
      persist();
    });
    el.querySelector('[data-act="meter-read"]')?.addEventListener("click", () => readMeter(home, meter));
    el.querySelector('[data-act="meter-edit"]')?.addEventListener("click", () => openMeterDialog(meter));
    el.querySelector('[data-act="meter-remove"]')?.addEventListener("click", () => {
      if (!confirm(`移除电表 ${meter.name || meter.deviceId}？`)) return;
      home.meters = home.meters.filter((x) => x.uid !== meter.uid);
      persist();
      render();
    });
  });

  host.querySelectorAll(".rail-dev[data-device-uid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.getAttribute("data-device-uid");
      const device = (home.devices || []).find((d) => d.uid === uid);
      host.querySelectorAll(".u3").forEach((c) => c.classList.toggle("active", c.getAttribute("data-device-uid") === uid));
      host.querySelectorAll(".rail-dev").forEach((b) => b.classList.toggle("active", b === btn));
      const card = host.querySelector(`.u3[data-device-uid="${CSS.escape(uid)}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      if (device?.deviceId) {
        // 无电表时：选中一体机 → 电网节点用其 DP26
        const meters = home.meters || [];
        const hasMeterVal = meters.some(
          (m) =>
            m.lastValue != null &&
            m.lastValue !== "" &&
            Number.isFinite(Number(m.lastValue))
        );
        if (!meters.length || !hasMeterVal) {
          if (home.lanMeterDeviceId !== device.deviceId) {
            home.lanMeterDeviceId = device.deviceId;
            persist();
            render();
            toast(`电网功率来源：${device.name || device.deviceId}（DP26）`, "ok");
            return;
          }
        }
        try {
          await copyText(device.deviceId);
          toast("已复制设备 ID", "ok");
        } catch (err) {
          toast(`复制失败: ${err.message || err}`, "error");
        }
      }
    });
  });

  host.querySelector('[data-act="lan-meter-device"]')?.addEventListener("change", (e) => {
    home.lanMeterDeviceId = String(e.target.value || "").trim();
    persist();
    render();
    const d = resolveLanMeterDevice(home);
    toast(
      d
        ? `电网功率来源：${d.name || d.deviceId}（DP26）`
        : "已清空电网功率来源一体机",
      "ok"
    );
  });

  if (!home.familyDrafts) home.familyDrafts = {};
  host.querySelectorAll("[data-fam-field]").forEach((el) => {
    const apply = () => {
      const code = el.getAttribute("data-fam-field");
      const echo = el.getAttribute("data-echo") || "";
      const v = String(el.value ?? "").trim();
      if (v === "" || v === echo) {
        home.familyDrafts[code] = "";
        el.classList.remove("dirty");
      } else {
        home.familyDrafts[code] = v;
        el.classList.add("dirty");
      }
      persist();
      updateIssueButtons();
      if (code === "work_mode" && v === "manual") {
        const device = (home.devices || [])[0];
        if (!device) {
          toast("家庭内没有一体机，无法配置手动时段", "error");
          return;
        }
        openManualScheduleDialog(home, device, { fromFamily: true, kind: "manual" });
      } else if (code === "work_mode" && v === "time_of_use") {
        const device = (home.devices || [])[0];
        if (!device) {
          toast("家庭内没有一体机，无法配置分时时段", "error");
          return;
        }
        openManualScheduleDialog(home, device, { fromFamily: true, kind: "time_of_use" });
      } else if (code === "work_mode") {
        render();
      }
    };
    if (el.tagName === "SELECT") {
      el.addEventListener("change", apply);
    } else {
      el.addEventListener("input", apply);
      el.addEventListener("change", apply);
    }
  });
  host.querySelector('[data-act="family-manual-schedule"]')?.addEventListener("click", () => {
    const device = (home.devices || [])[0];
    if (!device) {
      toast("家庭内没有一体机，无法配置手动时段", "error");
      return;
    }
    openManualScheduleDialog(home, device, { fromFamily: true, kind: "manual" });
  });
  host.querySelector('[data-act="family-tou-schedule"]')?.addEventListener("click", () => {
    const device = (home.devices || [])[0];
    if (!device) {
      toast("家庭内没有一体机，无法配置分时时段", "error");
      return;
    }
    openManualScheduleDialog(home, device, { fromFamily: true, kind: "time_of_use" });
  });
  host.querySelectorAll('[data-act="fb-fold"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const block = btn.closest(".fb-fold");
      if (!block) return;
      const key = block.getAttribute("data-fold");
      const collapsed = block.classList.toggle("is-collapsed");
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      if (key) {
        const st = loadFamilyRailFold();
        st[key] = collapsed;
        saveFamilyRailFold(st);
      }
    });
  });
  host.querySelector('[data-act="fb-rail-toggle"]')?.addEventListener("click", () => {
    const st = loadFamilyRailFold();
    st.railHidden = !st.railHidden;
    saveFamilyRailFold(st);
    render();
  });
  host.querySelector('[data-act="family-issue"]')?.addEventListener("click", async () => {
    const r = await issueFamilyToDevices(home);
    if (r.ok) toast(`家庭参数已下发至 ${r.ok} 台设备${r.fail ? `（失败 ${r.fail}）` : ""}`, "ok");
    else toast(`家庭参数下发失败`, "error");
    render();
  });
}

/** ---------- Live view snapshots (localStorage) ---------- */

function loadSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function saveSnapshots(list) {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list));
}

function buildLiveSnapshotMeta(home) {
  const devices = homeLiveDevices(home);
  return {
    homeId: home.homeId || "",
    homeName: homeDisplayName(home),
    envHost: home.envHost || "",
    deviceCount: devices.length,
    meterCount: (home.meters || []).length,
    devices: devices.map((d) => ({
      name: d.name || "",
      deviceId: d.deviceId,
      values: { ...(d.values || {}) },
    })),
    meters: (home.meters || []).map((m) => ({
      name: m.name || "",
      deviceId: m.deviceId,
      isThirdParty: !!m.isThirdParty,
      lastValue: m.lastValue,
    })),
    familyValues: { ...(home.familyValues || {}) },
  };
}

function canvasToJpegDataUrl(sourceCanvas, maxW, quality) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (!w || !h) return sourceCanvas.toDataURL("image/jpeg", quality);
  const scale = w > maxW ? maxW / w : 1;
  if (scale >= 0.999) return sourceCanvas.toDataURL("image/jpeg", quality);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(sourceCanvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

/**
 * @brief Crop near-background empty rows/cols so the snapshot is not letterboxed
 * @param[in] canvas source canvas
 * @return cropped canvas
 */
function trimCanvasWhitespace(canvas) {
  if (!canvas || canvas.width < 16 || canvas.height < 16) {
    return canvas;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }
  const w = canvas.width;
  const h = canvas.height;
  const { data } = ctx.getImageData(0, 0, w, h);
  const bg = [0xf8, 0xfa, 0xfc];
  const tol = 14;
  const isBg = (x, y) => {
    const i = (y * w + x) * 4;
    return Math.abs(data[i] - bg[0]) <= tol &&
      Math.abs(data[i + 1] - bg[1]) <= tol &&
      Math.abs(data[i + 2] - bg[2]) <= tol;
  };
  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;
  while (top < bottom) {
    let empty = true;
    for (let x = 0; x < w; x++) {
      if (!isBg(x, top)) {
        empty = false;
        break;
      }
    }
    if (!empty) {
      break;
    }
    top += 1;
  }
  while (bottom > top) {
    let empty = true;
    for (let x = 0; x < w; x++) {
      if (!isBg(x, bottom)) {
        empty = false;
        break;
      }
    }
    if (!empty) {
      break;
    }
    bottom -= 1;
  }
  while (left < right) {
    let empty = true;
    for (let y = top; y <= bottom; y++) {
      if (!isBg(left, y)) {
        empty = false;
        break;
      }
    }
    if (!empty) {
      break;
    }
    left += 1;
  }
  while (right > left) {
    let empty = true;
    for (let y = top; y <= bottom; y++) {
      if (!isBg(right, y)) {
        empty = false;
        break;
      }
    }
    if (!empty) {
      break;
    }
    right -= 1;
  }
  const pad = 8;
  top = Math.max(0, top - pad);
  left = Math.max(0, left - pad);
  bottom = Math.min(h - 1, bottom + pad);
  right = Math.min(w - 1, right + pad);
  const cw = right - left + 1;
  const ch = bottom - top + 1;
  if (cw < 40 || ch < 40 || (cw >= w - 2 && ch >= h - 2)) {
    return canvas;
  }
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  out.getContext("2d").drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch);
  return out;
}

/** Temporarily expand scroll/overflow clips so html2canvas can see full live view. */
function prepareFlowHostForCapture(host) {
  const restore = [];
  const setStyle = (el, props) => {
    if (!el) return;
    const prev = {};
    for (const [k, v] of Object.entries(props)) {
      prev[k] = el.style[k];
      el.style[k] = v;
    }
    restore.push(() => {
      for (const [k, v] of Object.entries(prev)) el.style[k] = v;
    });
  };

  const svg = host.querySelector(".flow-svg");
  const wrap = host.querySelector(".flow-svg-wrap");
  const panel = host.querySelector(".flow-panel");
  const rail = host.querySelector(".flow-rail");
  const main = host.querySelector(".flow-main");
  const shell = host.querySelector(".home-flow-shell");
  const svgW = Math.ceil(
    Number(svg?.getAttribute("width") || 0) || svg?.scrollWidth || svg?.getBoundingClientRect().width || 0
  );
  const svgH = Math.ceil(
    Number(svg?.getAttribute("height") || 0) || svg?.scrollHeight || svg?.getBoundingClientRect().height || 0
  );
  const railW = Math.ceil(rail?.scrollWidth || rail?.offsetWidth || 260);
  const gap = 14;
  const shellW = Math.max(railW + gap + svgW, host.scrollWidth || 0);

  setStyle(host, {
    overflow: "visible",
    height: "auto",
    maxHeight: "none",
    width: `${shellW}px`,
    maxWidth: "none",
  });
  setStyle(shell, {
    overflow: "visible",
    height: "auto",
    maxHeight: "none",
    alignItems: "start",
    gridTemplateColumns: `${railW}px ${Math.max(svgW, 800)}px`,
    width: `${shellW}px`,
    maxWidth: "none",
  });
  setStyle(rail, {
    position: "static",
    maxHeight: "none",
    overflow: "visible",
    height: "auto",
    width: `${railW}px`,
  });
  setStyle(main, {
    overflow: "visible",
    minWidth: `${svgW}px`,
    width: `${Math.max(svgW, 800)}px`,
    maxWidth: "none",
  });
  setStyle(panel, {
    overflow: "visible",
    height: "auto",
    maxHeight: "none",
    width: `${Math.max(svgW, 800)}px`,
    maxWidth: "none",
  });
  setStyle(wrap, {
    overflow: "visible",
    position: "relative",
    width: svgW ? `${svgW}px` : "auto",
    maxWidth: "none",
    height: svgH ? `${svgH + 12}px` : "auto",
  });
  if (svg) {
    setStyle(svg, {
      maxWidth: "none",
      width: svgW ? `${svgW}px` : "auto",
      height: svgH ? `${svgH}px` : "auto",
    });
  }
  host.querySelectorAll(".u3").forEach((card) => {
    setStyle(card, { overflow: "visible", height: "auto", maxHeight: "none" });
    card.querySelectorAll(".layer.l1").forEach((layer) => {
      setStyle(layer, { overflow: "visible", maxHeight: "none", flex: "0 0 auto" });
    });
  });

  // Hoist foreignObject cards to HTML overlays so css (.u3 etc.) is preserved.
  // html2canvas often drops styles for XHTML inside SVG foreignObject.
  const padX = 6;
  const padY = 6;
  if (svg && wrap) {
    svg.querySelectorAll("foreignObject").forEach((fo) => {
      const content = fo.firstElementChild;
      if (!content) return;
      const x = Number(fo.getAttribute("x") || 0);
      const y = Number(fo.getAttribute("y") || 0);
      const w = Number(fo.getAttribute("width") || 0) || content.offsetWidth || 180;
      const h = Number(fo.getAttribute("height") || 0) || content.scrollHeight || 400;
      const overlay = document.createElement("div");
      overlay.className = "snap-fo-overlay";
      overlay.setAttribute("data-snap-fo", "1");
      overlay.style.cssText = [
        "position:absolute",
        `left:${padX + x}px`,
        `top:${padY + y}px`,
        `width:${w}px`,
        `height:${h}px`,
        "z-index:6",
        "pointer-events:none",
        "box-sizing:border-box",
        "overflow:visible",
      ].join(";");
      const clone = content.cloneNode(true);
      clone.removeAttribute("xmlns");
      if (clone.style) {
        clone.style.width = "100%";
        clone.style.height = "100%";
        clone.style.boxSizing = "border-box";
      }
      overlay.appendChild(clone);
      wrap.appendChild(overlay);
      const prevVis = fo.style.visibility;
      fo.style.visibility = "hidden";
      restore.push(() => {
        fo.style.visibility = prevVis;
        overlay.remove();
      });
    });
  }

  void host.offsetHeight;
  return () => {
    while (restore.length) restore.pop()();
  };
}

async function captureLiveViewCanvas() {
  const el = document.getElementById("flowHost") || document.getElementById("tabLive");
  if (!el) throw new Error("未找到实时运行区域");
  if (typeof html2canvas !== "function") throw new Error("截图库未加载");
  const livePanel = document.getElementById("tabLive");
  const wasHidden = !!livePanel?.classList.contains("hidden");
  if (livePanel) livePanel.classList.remove("hidden");
  document.body.classList.add("capturing-live");
  void livePanel?.offsetHeight;
  let undoExpand = () => {};
  const wrap = el.querySelector(".flow-svg-wrap");
  const prevScrollLeft = wrap?.scrollLeft || 0;
  const prevScrollTop = wrap?.scrollTop || 0;
  try {
    undoExpand = prepareFlowHostForCapture(el);
    if (wrap) {
      wrap.scrollLeft = 0;
      wrap.scrollTop = 0;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const svg = el.querySelector(".flow-svg");
    const rail = el.querySelector(".flow-rail");
    const shell = el.querySelector(".home-flow-shell");
    const svgW = Math.ceil(Number(svg?.getAttribute("width") || 0) || svg?.scrollWidth || 0);
    const svgH = Math.ceil(Number(svg?.getAttribute("height") || 0) || svg?.scrollHeight || 0);
    const railW = Math.ceil(rail?.scrollWidth || rail?.offsetWidth || 0);
    const fullW = Math.ceil(
      Math.max(
        el.scrollWidth,
        el.offsetWidth,
        shell?.scrollWidth || 0,
        railW + 14 + svgW,
        el.getBoundingClientRect().width
      )
    );
    const fullH = Math.ceil(
      Math.max(
        el.scrollHeight || 0,
        shell?.scrollHeight || 0,
        svgH + 180
      )
    );
    // Large boards: keep scale=1 to avoid canvas memory limits / blank captures
    const scale = fullW > 2200 ? 1 : Math.min(1.25, window.devicePixelRatio || 1);
    const canvas = await html2canvas(el, {
      backgroundColor: "#f8fafc",
      scale,
      width: fullW,
      height: fullH,
      windowWidth: fullW,
      windowHeight: fullH,
      x: 0,
      y: 0,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
      useCORS: true,
      allowTaint: true,
      // Cards are hoisted to HTML overlays; FO path not needed
      foreignObjectRendering: false,
      logging: false,
      onclone: (doc, cloned) => {
        doc.body?.classList.add("capturing-live");
        const live = doc.getElementById("tabLive");
        if (live) {
          live.classList.remove("hidden");
          live.style.setProperty("display", "block", "important");
          live.style.setProperty("position", "static", "important");
          live.style.setProperty("left", "auto", "important");
          live.style.setProperty("visibility", "visible", "important");
          live.style.setProperty("opacity", "1", "important");
        }
        const root = cloned.id === "flowHost" ? cloned : cloned.querySelector?.("#flowHost") || cloned;
        if (!root || !root.style) return;
        const cSvg = root.querySelector?.(".flow-svg");
        const cRail = root.querySelector?.(".flow-rail");
        const cW = Math.ceil(Number(cSvg?.getAttribute("width") || 0) || svgW || 0);
        const cH = Math.ceil(Number(cSvg?.getAttribute("height") || 0) || svgH || 0);
        const cRailW = Math.ceil(cRail?.scrollWidth || railW || 260);
        const cShellW = cRailW + 14 + Math.max(cW, 800);
        root.style.overflow = "visible";
        root.style.height = "auto";
        root.style.maxHeight = "none";
        root.style.width = `${cShellW}px`;
        root.style.maxWidth = "none";
        root.querySelectorAll?.(".home-flow-shell").forEach((n) => {
          n.style.overflow = "visible";
          n.style.height = "auto";
          n.style.maxHeight = "none";
          n.style.alignItems = "start";
          n.style.gridTemplateColumns = `${cRailW}px ${Math.max(cW, 800)}px`;
          n.style.width = `${cShellW}px`;
          n.style.maxWidth = "none";
        });
        root.querySelectorAll?.(".flow-main").forEach((n) => {
          n.style.overflow = "visible";
          n.style.minWidth = `${cW}px`;
          n.style.width = `${Math.max(cW, 800)}px`;
          n.style.maxWidth = "none";
        });
        root.querySelectorAll?.(".flow-panel").forEach((n) => {
          n.style.overflow = "visible";
          n.style.width = `${Math.max(cW, 800)}px`;
          n.style.maxWidth = "none";
        });
        root.querySelectorAll?.(".flow-svg-wrap").forEach((n) => {
          n.style.overflow = "visible";
          n.style.position = "relative";
          n.style.maxWidth = "none";
          n.style.width = cW ? `${cW}px` : "auto";
          n.style.height = cH ? `${cH + 12}px` : "auto";
        });
        root.querySelectorAll?.(".flow-svg").forEach((n) => {
          n.style.maxWidth = "none";
          if (cW) n.style.width = `${cW}px`;
          if (cH) n.style.height = `${cH}px`;
        });
        root.querySelectorAll?.(".flow-rail").forEach((n) => {
          n.style.position = "static";
          n.style.maxHeight = "none";
          n.style.overflow = "visible";
          n.style.height = "auto";
          n.style.width = `${cRailW}px`;
        });
        root.querySelectorAll?.(".u3").forEach((n) => {
          n.style.overflow = "visible";
          n.style.height = "auto";
        });
        root.querySelectorAll?.(".layer.l1").forEach((n) => {
          n.style.overflow = "visible";
          n.style.maxHeight = "none";
          n.style.flex = "0 0 auto";
        });
        // Keep hoisted overlays; hide FO originals in clone too
        root.querySelectorAll?.("foreignObject").forEach((n) => {
          n.style.visibility = "hidden";
        });
      },
    });
    if (!canvas || canvas.width < 8 || canvas.height < 8) {
      throw new Error("截图区域尺寸为空");
    }
    return trimCanvasWhitespace(canvas);
  } finally {
    if (wrap) {
      wrap.scrollLeft = prevScrollLeft;
      wrap.scrollTop = prevScrollTop;
    }
    undoExpand();
    document.body.classList.remove("capturing-live");
    if (wasHidden && livePanel && homeTab !== "live") livePanel.classList.add("hidden");
  }
}

async function fetchScheduleWeekForSnapshot(home, device, kind) {
  const res = await CaseApi.queryProperties(home, {
    page: "1",
    deviceId: device.deviceId,
  });
  const list = unwrapResult(res);
  const items = Array.isArray(list) ? list : list?.data || list?.items || [];
  return msParsePropertyList(items, kind);
}

function scheduleModeLabel(mode) {
  return String(mode) === MS_MODE_DISCHARGE ? "放电" : "充电";
}

function scheduleDayLabel(dayKey) {
  const hit = MS_DAYS.find((d) => d.key === dayKey);
  return hit ? hit.label : dayKey === MS_TOU_DAY ? "分时" : dayKey;
}

/** Flatten active slots → table rows for snapshot footer. */
function buildScheduleTableModel(week, kind) {
  const isTou = kind === MS_KIND_TOU;
  const headers = isTou
    ? ["时段", "开始", "结束", "模式", "功率(W)", "目标SOC(%)", "弃光", "忽略防逆流"]
    : ["星期", "时段", "开始", "结束", "模式", "功率(W)", "目标SOC(%)", "弃光", "忽略防逆流"];
  const rows = [];
  for (const day of msDayKeys(kind)) {
    const slots = week?.[day] || [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const range = msSlotRange(slot);
      if (!range) continue;
      const cells = isTou
        ? [
            String(i + 1),
            msMinToLabel(range.start),
            msMinToLabel(range.end),
            scheduleModeLabel(slot.mode),
            String(slot.mode) === MS_MODE_DISCHARGE ? String(slot.power ?? "") : "—",
            String(slot.soc ?? ""),
            slot.pv_abandon ? "是" : "否",
            slot.ignore_anti_backflow ? "是" : "否",
          ]
        : [
            scheduleDayLabel(day),
            String(i + 1),
            msMinToLabel(range.start),
            msMinToLabel(range.end),
            scheduleModeLabel(slot.mode),
            String(slot.mode) === MS_MODE_DISCHARGE ? String(slot.power ?? "") : "—",
            String(slot.soc ?? ""),
            slot.pv_abandon ? "是" : "否",
            slot.ignore_anti_backflow ? "是" : "否",
          ];
      rows.push(cells);
    }
  }
  return { headers, rows };
}

function effectiveFamilyWorkMode(home) {
  return String(effectiveFamilyValue(home, "work_mode") || "").trim();
}

/**
 * Draw schedule table below base screenshot and return a new canvas.
 */
function composeSnapshotWithScheduleTable(baseCanvas, tableModel, title) {
  const pad = 24;
  const titleH = 36;
  const rowH = 28;
  const headH = 30;
  const colN = tableModel.headers.length;
  const emptyHint = !tableModel.rows.length;
  const bodyRows = emptyHint ? 1 : tableModel.rows.length;
  const tableH = titleH + headH + bodyRows * rowH + pad * 2;
  const width = Math.max(baseCanvas.width, 900);
  const height = baseCanvas.height + tableH;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);
  // top: live screenshot (centered if narrower)
  const dx = Math.max(0, Math.floor((width - baseCanvas.width) / 2));
  ctx.drawImage(baseCanvas, dx, 0);
  // bottom panel
  const top = baseCanvas.height;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, top, width, tableH);
  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(0, top + 0.5);
  ctx.lineTo(width, top + 0.5);
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(title, pad, top + pad + titleH / 2);

  const tableTop = top + pad + titleH;
  const tableWidth = width - pad * 2;
  const colW = tableWidth / colN;
  const drawRow = (cells, y, isHead) => {
    ctx.fillStyle = isHead ? "#eff6ff" : "#ffffff";
    ctx.fillRect(pad, y, tableWidth, isHead ? headH : rowH);
    ctx.strokeStyle = "#cbd5e1";
    ctx.strokeRect(pad + 0.5, y + 0.5, tableWidth - 1, (isHead ? headH : rowH) - 1);
    for (let c = 1; c < colN; c++) {
      const x = pad + colW * c;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y);
      ctx.lineTo(x + 0.5, y + (isHead ? headH : rowH));
      ctx.stroke();
    }
    ctx.fillStyle = isHead ? "#1e40af" : "#0f172a";
    ctx.font = `${isHead ? "bold " : ""}12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
    ctx.textBaseline = "middle";
    for (let c = 0; c < colN; c++) {
      const text = String(cells[c] ?? "");
      const cx = pad + colW * c + 8;
      ctx.fillText(text, cx, y + (isHead ? headH : rowH) / 2, colW - 16);
    }
  };
  drawRow(tableModel.headers, tableTop, true);
  if (emptyHint) {
    drawRow(["（未读到有效时段）", ...Array(colN - 1).fill("")], tableTop + headH, false);
  } else {
    tableModel.rows.forEach((r, i) => drawRow(r, tableTop + headH + i * rowH, false));
  }
  return out;
}

async function appendScheduleTableIfNeeded(home, baseCanvas) {
  const mode = effectiveFamilyWorkMode(home);
  if (mode !== MS_KIND_TOU && mode !== MS_KIND_MANUAL) {
    return { canvas: baseCanvas, schedule: null };
  }
  const device = (home.devices || [])[0];
  if (!device?.deviceId) {
    toast("家庭模式为时段类，但无一体机可读时段", "error");
    return { canvas: baseCanvas, schedule: null };
  }
  const kind = mode === MS_KIND_TOU ? MS_KIND_TOU : MS_KIND_MANUAL;
  const modeLabel = kind === MS_KIND_TOU ? "分时用电" : "手动设置";
  try {
    const parsed = await fetchScheduleWeekForSnapshot(home, device, kind);
    const table = buildScheduleTableModel(parsed.week, kind);
    const title = `${modeLabel}时段表 · 模板设备 ${device.name || device.deviceId} · 共 ${table.rows.length} 段`;
    const canvas = composeSnapshotWithScheduleTable(baseCanvas, table, title);
    return {
      canvas,
      schedule: {
        kind,
        modeLabel,
        deviceId: device.deviceId,
        deviceName: device.name || "",
        headers: table.headers,
        rows: table.rows,
      },
    };
  } catch (err) {
    console.warn("appendScheduleTableIfNeeded", err);
    toast(`时段表读取失败：${err.message || err}（已保存实况截图）`, "error");
    return { canvas: baseCanvas, schedule: null };
  }
}

async function saveLiveSnapshot() {
  const home = activeHome();
  if (!home) {
    toast("请先选择家庭", "error");
    return;
  }
  const btn = document.getElementById("btnSaveSnapshot");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "截图中…";
  }
  try {
    if (homeTab !== "live") setHomeTab("live");
    await new Promise((r) => setTimeout(r, 80));
    let canvas = await captureLiveViewCanvas();
    const mode = effectiveFamilyWorkMode(home);
    let scheduleMeta = null;
    if (mode === MS_KIND_TOU || mode === MS_KIND_MANUAL) {
      if (btn) btn.textContent = "读取时段…";
      const composed = await appendScheduleTableIfNeeded(home, canvas);
      canvas = composed.canvas;
      scheduleMeta = composed.schedule;
    }
    const image = canvasToJpegDataUrl(canvas, SNAPSHOT_MAX_W, SNAPSHOT_JPEG_Q);
    const thumb = canvasToJpegDataUrl(canvas, 360, 0.65);
    const defaultName = `场景 ${fmtTime(Date.now())}`;
    let sceneName = defaultName;
    const typed = window.prompt("请输入场景名称", defaultName);
    if (typed == null) {
      toast("已取消保存快照", "error");
      return;
    }
    sceneName = String(typed).trim() || defaultName;
    const meta = buildLiveSnapshotMeta(home);
    if (scheduleMeta) meta.schedule = scheduleMeta;
    meta.workMode = mode || meta.familyValues?.work_mode || "";
    const item = {
      id: uid(),
      at: Date.now(),
      name: sceneName,
      image,
      thumb,
      meta,
    };
    let list = loadSnapshots();
    list.unshift(item);
    while (list.length > SNAPSHOT_MAX) list.pop();
    try {
      saveSnapshots(list);
    } catch (quotaErr) {
      while (list.length > 1) {
        list.pop();
        try {
          saveSnapshots(list);
          break;
        } catch (_) {}
      }
      if (list.length === 1) {
        try {
          saveSnapshots(list);
        } catch (_) {
          throw new Error("浏览器存储空间不足，请先清空部分快照");
        }
      }
    }
    toast(`快照「${sceneName}」已保存（共 ${loadSnapshots().length} 条）`, "ok");
    setHomeTab("snapshots");
  } catch (err) {
    console.warn("saveLiveSnapshot", err);
    toast(`保存快照失败：${err.message || err}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "保存快照";
    }
  }
}

function snapshotDisplayName(item) {
  const n = String(item?.name || "").trim();
  if (n) return n;
  return item?.meta?.homeName ? `${item.meta.homeName} · ${fmtTime(item.at)}` : `场景 ${fmtTime(item?.at)}`;
}

/** Safe filename from scene name, keep CJK / letters / digits. */
function snapshotFileName(name, at) {
  let base = String(name || "").trim() || `场景_${at || Date.now()}`;
  base = base
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  if (!base) base = `场景_${at || Date.now()}`;
  return `${base}.jpg`;
}

function downloadSnapshot(id, preferredName) {
  const item = loadSnapshots().find((x) => x.id === id);
  if (!item?.image) {
    toast("找不到快照图片", "error");
    return;
  }
  const name = String(preferredName || "").trim() || snapshotDisplayName(item);
  const a = document.createElement("a");
  a.href = item.image;
  a.download = snapshotFileName(name, item.at);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function renameSnapshot(id, name) {
  const next = String(name || "").trim();
  if (!next) {
    toast("场景名称不能为空", "error");
    mountSnapshotsPanel();
    return false;
  }
  const list = loadSnapshots();
  const hit = list.find((x) => x.id === id);
  if (!hit) return false;
  hit.name = next;
  try {
    saveSnapshots(list);
  } catch (err) {
    toast(`保存名称失败：${err.message || err}`, "error");
    return false;
  }
  return true;
}

function deleteSnapshot(id) {
  const list = loadSnapshots().filter((x) => x.id !== id);
  saveSnapshots(list);
  mountSnapshotsPanel();
  toast("已删除快照", "ok");
}

function clearAllSnapshots() {
  if (!loadSnapshots().length) return;
  if (!confirm("清空本机全部运行快照？此操作不可恢复。")) return;
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch (_) {}
  mountSnapshotsPanel();
  toast("已清空快照", "ok");
}

function openSnapshotPreview(id) {
  const item = loadSnapshots().find((x) => x.id === id);
  if (!item?.image) return;
  const dlg = document.getElementById("dlgSnapshotPreview");
  const img = document.getElementById("snapPreviewImg");
  const meta = document.getElementById("snapPreviewMeta");
  if (!dlg || !img) {
    window.open(item.image, "_blank");
    return;
  }
  img.src = item.image;
  const m = item.meta || {};
  meta.textContent = `${snapshotDisplayName(item)} · ${m.homeName || "家庭"} · ${fmtTime(item.at)} · ${m.deviceCount || 0} 台设备`;
  dlg.showModal();
}

function openSnapshotFullscreen(src) {
  const layer = document.getElementById("snapFullscreen");
  const img = document.getElementById("snapFullscreenImg");
  if (!layer || !img || !src) return;
  img.src = src;
  layer.hidden = false;
  layer.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeSnapshotFullscreen() {
  const layer = document.getElementById("snapFullscreen");
  const img = document.getElementById("snapFullscreenImg");
  if (!layer) return;
  layer.hidden = true;
  layer.classList.add("hidden");
  if (img) img.removeAttribute("src");
  document.body.style.overflow = "";
}

function mountSnapshotsPanel() {
  const host = document.getElementById("snapshotsHost");
  const maxHint = document.getElementById("snapMaxHint");
  if (maxHint) maxHint.textContent = String(SNAPSHOT_MAX);
  if (!host) return;
  const home = activeHome();
  const all = loadSnapshots();
  const list = home
    ? all.filter(
        (s) =>
          !s.meta?.homeId ||
          !home.homeId ||
          String(s.meta.homeId) === String(home.homeId) ||
          s.meta.homeName === homeDisplayName(home)
      )
    : all;
  const shown = list.length ? list : all;
  if (!shown.length) {
    host.innerHTML = `<div class="charts-empty">暂无快照。在「实时运行情况」点右上角「保存快照」即可。</div>`;
    return;
  }
  host.innerHTML = shown
    .map((s) => {
      const m = s.meta || {};
      const title = snapshotDisplayName(s);
      const sub = `${m.homeName || "家庭"} · ${fmtTime(s.at)} · ${m.deviceCount ?? "—"} 机 · ${(s.image?.length || 0) >> 10} KB`;
      return `<article class="snap-card" data-snap-id="${escapeAttr(s.id)}">
        <button type="button" class="snap-thumb" data-act="snap-preview" title="查看大图">
          <img src="${escapeAttr(s.thumb || s.image)}" alt="snapshot" loading="lazy" />
        </button>
        <div class="snap-body">
          <label class="snap-name-lab">
            <span>场景名称</span>
            <input type="text" class="snap-name-input" data-act="snap-rename"
              value="${escapeAttr(title)}" maxlength="64" placeholder="输入场景名称" />
          </label>
          <div class="snap-sub">${escapeHtml(sub)}</div>
          <div class="snap-ops">
            <button type="button" class="btn btn-sm btn-ghost" data-act="snap-preview">查看</button>
            <button type="button" class="btn btn-sm btn-ghost" data-act="snap-download">下载</button>
            <button type="button" class="btn-link danger" data-act="snap-delete">删除</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
  host.querySelectorAll(".snap-card").forEach((card) => {
    const id = card.getAttribute("data-snap-id");
    card.querySelectorAll('[data-act="snap-preview"]').forEach((btn) => {
      btn.addEventListener("click", () => openSnapshotPreview(id));
    });
    const nameInput = card.querySelector('[data-act="snap-rename"]');
    nameInput?.addEventListener("change", () => {
      if (renameSnapshot(id, nameInput.value)) toast("场景名称已更新", "ok");
    });
    nameInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        nameInput.blur();
      }
    });
    card.querySelector('[data-act="snap-download"]')?.addEventListener("click", () => {
      const liveName = nameInput?.value?.trim() || "";
      // persist rename first if input differs from stored
      if (liveName) renameSnapshot(id, liveName);
      downloadSnapshot(id, liveName);
    });
    card.querySelector('[data-act="snap-delete"]')?.addEventListener("click", () => {
      if (!confirm("删除该快照？")) return;
      deleteSnapshot(id);
    });
  });
}

/** Historical charts tab: meter power + device SOC. */
function mountChartsPanel(home) {
  const row = document.getElementById("chartsHost");
  if (!row) return;
  row.querySelectorAll("[data-soc-chart], [data-power-chart]").forEach((el) => {
    if (typeof el._chartCleanup === "function") el._chartCleanup();
  });
  const parts = [];
  for (const meter of home.meters || []) {
    parts.push(`<div class="flow-soc-card" data-meter-uid="${escapeAttr(meter.uid)}">
      <div class="soc-title"><span>${escapeHtml(meter.name || meter.deviceId)} · 功率${
        meter.isThirdParty ? "（三方·grid_power）" : ""
      }</span>
        <span>${meter.lastValue == null ? "—" : `${meter.lastValue}W`}</span></div>
      <div class="soc-stats">
        ${meter.powerSeries?.length ? `<span>${meter.powerSeries.length} 点</span>` : ""}
        ${meter.error ? `<span class="err">${escapeHtml(meter.error)}</span>` : ""}
        ${meter.lastReadAt ? `<span>${escapeHtml(fmtTime(meter.lastReadAt))}</span>` : ""}
      </div>
      <div class="soc-chart" data-power-chart></div>
    </div>`);
  }
  for (const device of home.devices || []) {
    parts.push(`<div class="flow-soc-card" data-device-uid="${escapeAttr(device.uid)}">
      <div class="soc-title"><span>${escapeHtml(device.name || device.deviceId)} · SOC</span>
        <span>${device.values?.current_soc != null ? `${device.values.current_soc}%` : "—"}</span></div>
      <div class="soc-stats soc-stats-live"></div>
      <div class="soc-chart" data-soc-chart></div>
    </div>`);
  }
  row.innerHTML =
    parts.join("") ||
    `<div class="charts-empty">暂无曲线数据。请先在「实时运行情况」中添加电表/设备并点击「一键读取」。</div>`;

  row.querySelectorAll("[data-meter-uid]").forEach((card) => {
    const meter = (home.meters || []).find((m) => m.uid === card.getAttribute("data-meter-uid"));
    if (!meter) return;
    mountInteractiveChart(card.querySelector("[data-power-chart]"), meter.powerSeries || [], {
      unit: "W",
      includeZero: true,
      emptyText: "暂无功率历史",
      height: 110,
      syncGroup: "home-trends",
    });
  });
  row.querySelectorAll("[data-device-uid]").forEach((card) => {
    const device = home.devices.find((d) => d.uid === card.getAttribute("data-device-uid"));
    if (!device) return;
    patchDeviceSocStats(home, device);
    mountInteractiveChart(card.querySelector("[data-soc-chart]"), device.socSeries || [], {
      unit: "%",
      emptyText: device.socMeta?.error || "暂无 SOC 历史",
      forceRange: [0, 100],
      height: 110,
      syncGroup: "home-trends",
    });
  });
}

function captureLiveCanvasView() {
  const main = document.querySelector(".main");
  const wrap = document.querySelector("#flowHost .flow-svg-wrap");
  return {
    mainX: main?.scrollLeft || 0,
    mainY: main?.scrollTop || 0,
    wrapX: wrap?.scrollLeft || 0,
    wrapY: wrap?.scrollTop || 0,
  };
}

function restoreLiveCanvasView(view) {
  if (!view) return;
  const apply = () => {
    const main = document.querySelector(".main");
    const wrap = document.querySelector("#flowHost .flow-svg-wrap");
    if (main) {
      main.scrollLeft = view.mainX;
      main.scrollTop = view.mainY;
    }
    if (wrap) {
      wrap.scrollLeft = view.wrapX;
      wrap.scrollTop = view.wrapY;
    }
  };
  apply();
  requestAnimationFrame(apply);
}

function render() {
  if (typeof atUiFrozen !== "undefined" && atUiFrozen) {
    return;
  }
  renderSidebar();
  renderMain();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

/* ---------- Dialogs ---------- */

let editingHomeUid = null;
let editingDeviceUid = null;
let editingMeterUid = null;

function isLocalHostPage() {
  return /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
}

const REMOTE_PUSH_URL_KEY = "groupAppControl.remotePushUrl";
const DEFAULT_REMOTE_PUSH_URL = "http://172.16.239.236:5178";

function getRemotePushUrl() {
  const input = document.getElementById("remotePushUrl");
  const fromInput = (input?.value || "").trim();
  if (fromInput) return fromInput.replace(/\/$/, "");
  try {
    const saved = (localStorage.getItem(REMOTE_PUSH_URL_KEY) || "").trim();
    if (saved) return saved.replace(/\/$/, "");
  } catch (_) {
    /* ignore */
  }
  return DEFAULT_REMOTE_PUSH_URL;
}

function cookiePreview(ck) {
  const s = String(ck || "").trim();
  if (!s) return "";
  const m = s.match(/SSO_USER_TOKEN=([^;]{6,})/);
  const v = m ? m[1] : s;
  return v.slice(0, 16) + (v.length > 16 ? "…" : "");
}

function renderLoginMgr() {
  const body = document.getElementById("loginMgrBody");
  if (!body) return;
  const onLocal = isLocalHostPage();
  const hint = document.getElementById("loginMgrHint");
  if (hint) {
    hint.textContent = onLocal
      ? "同一 SSO 在 .tuya-inc.com 域内通用，「自动获取(本机)」一次填充全部环境；也可逐行「编辑」手动粘贴。"
      : "虚拟机页面无法自动获取：请逐行「编辑」粘贴 Cookie，或在本机自动获取后推送到虚拟机。";
  }
  const autoBtn = document.getElementById("btnLoginMgrAuto");
  if (autoBtn) autoBtn.classList.toggle("hidden", !onLocal);
  let html = "";
  for (const g of LOGIN_GROUPS) {
    const rows = Object.entries(g.envs);
    const configured = rows.filter(([h]) => (state.cookies[h] || "").trim()).length;
    html += `<div class="loginmgr-group"><h4>${escapeHtml(g.title)} <span class="count">· ${configured}/${rows.length} 已配置</span></h4>`;
    html += `<table class="loginmgr-table"><thead><tr><th style="width:26%">环境</th><th style="width:32%">Host</th><th>Cookie</th><th style="width:140px">操作</th></tr></thead><tbody>`;
    for (const [host, meta] of rows) {
      const ck = (state.cookies[host] || "").trim();
      const off = meta.supported === false;
      const status = ck
        ? `<span class="ck-ok">✓ 已配置</span><span class="ck-prev">${escapeHtml(cookiePreview(ck))}</span>`
        : `<span class="ck-no">— 未配置</span>`;
      html +=
        `<tr class="${off ? "off" : ""}"><td>${escapeHtml(meta.name)} <span class="ck-prev">${escapeHtml(meta.short)}</span></td>` +
        `<td class="host">${escapeHtml(host)}</td>` +
        `<td>${status}</td>` +
        `<td><div class="row-actions"><button type="button" class="btn btn-ghost" data-lm-edit="${escapeAttr(host)}">编辑</button>` +
        (ck ? `<button type="button" class="btn btn-ghost" data-lm-clear="${escapeAttr(host)}">清除</button>` : "") +
        `</div></td></tr>`;
    }
    html += `</tbody></table></div>`;
  }
  body.innerHTML = html;
}

function openLoginMgr() {
  uiRoute = "loginMgr";
  render();
}

function closeLoginMgr() {
  if (window.self !== window.top) {
    try {
      window.parent.postMessage({ type: "caselib-close-login-mgr" }, window.location.origin);
    } catch (_) {}
    return;
  }
  uiRoute = "home";
  render();
}

/* ============== 自动回归测试（软下发排列组合 → 跑工况 → 出报告） ============== */
const _atSleep = async (ms) => {
  const step = 200;
  let left = Math.max(0, Number(ms) || 0);
  while (left > 0) {
    if (atPauseRequested) {
      return "paused";
    }
    const chunk = Math.min(step, left);
    await new Promise((r) => setTimeout(r, chunk));
    left -= chunk;
  }
  return "ok";
};
// [moved → checker/cluster.js] _atClampSoc/_atSoc/_atCat/_atHomeAgg/computeMasterExpect

// 读取自动测试页上可选的「家庭电网购电限值 / 三方光伏」配置
function _atMasterOpts() {
  const g = document.getElementById("atGridBuyLimit");
  const t = document.getElementById("atThirdPv");
  return { gridBuyLimit: g ? g.value : "", tpv: t ? t.value : "" };
}

// [moved → checker/cluster.js] AUTO_TARGETS / buildAutoMatrix

let atRunning = false;
let atUiFrozen = false;
let atPauseRequested = false;
let atActiveReportId = null;
let atShowResults = false; // true 时保留时间轴/报告，不重建矩阵预览
let atLastReport = null;
let atReportFrameIndex = 0;
let atReportOnlyFailures = false;
let atReportCycleNo = null;
let atPeekPos = null;
let atPeekSize = null;
let atPeekOpen = false;
let atSelectedUids = null;
let atSelectedTargets = {}; // uid -> { scenarioKey: boolean }
let atCasePicks = {}; // combo key -> boolean
let atCaseFilterId = "";
let atCaseFilterTarget = "";
let atReplayOpen = false;
let atInnerTab = "lib";

const AT_LAB_CONSTRUCT_KEY = "caselib.atEnableLabConstruct";

/**
 * @brief Whether lab-only construct paths (PV/Bypass HAL) are enabled
 * @return true when checkbox checked
 * @note Default off — lab path not ready yet
 */
function _atLabConstructEnabled() {
  const el = document.getElementById("atEnableLabConstruct")
    || document.getElementById("atEnableLabConstructRun");
  if (el) {
    return !!el.checked;
  }
  try {
    return localStorage.getItem(AT_LAB_CONSTRUCT_KEY) === "1";
  } catch (_) {
    return false;
  }
}

/**
 * @brief Keep lib/run lab checkboxes in sync and persist
 * @param[in] fromEl optional checkbox that changed
 * @return none
 */
function _atSyncLabConstructChecks(fromEl) {
  const on = !!(fromEl ? fromEl.checked : _atLabConstructEnabled());
  try {
    localStorage.setItem(AT_LAB_CONSTRUCT_KEY, on ? "1" : "0");
  } catch (_) {
    /* ignore */
  }
  const a = document.getElementById("atEnableLabConstruct");
  const b = document.getElementById("atEnableLabConstructRun");
  if (a && a !== fromEl) {
    a.checked = on;
  }
  if (b && b !== fromEl) {
    b.checked = on;
  }
}

/**
 * @brief Wire lab-construct toggles (default unchecked)
 * @return none
 */
function _atInitLabConstructToggle() {
  let saved = false;
  try {
    saved = localStorage.getItem(AT_LAB_CONSTRUCT_KEY) === "1";
  } catch (_) {
    saved = false;
  }
  const a = document.getElementById("atEnableLabConstruct");
  const b = document.getElementById("atEnableLabConstructRun");
  if (a) {
    a.checked = saved;
  }
  if (b) {
    b.checked = saved;
  }
  const onChange = (ev) => {
    _atSyncLabConstructChecks(ev.target);
    if (atRunning) {
      toast(ev.target.checked ? "已勾选实验室构造，下轮用例生效" : "已关闭实验室构造，下轮用例生效", "ok");
      return;
    }
    renderAutoLib();
    if (!atShowResults) {
      renderAutoRun();
    }
  };
  a?.addEventListener("change", onChange);
  b?.addEventListener("change", onChange);
}

const AT_STEPS = [
  { key: "check", label: "开始前检查" },
  { key: "before", label: "开始前状态" },
  { key: "issue", label: "下发参数" },
  { key: "runtime", label: "运行时态" },
  { key: "checker", label: "检查结果" },
  { key: "collect", label: "结果回收" },
];

function openAutoTest() {
  atShowResults = false;
  applyUiShell("auto");
  setAtInnerTab("run");
}
function closeAutoTest() {
  if (atRunning) {
    toast("测试进行中，请先点「暂停」保存后再离开", "error");
    return;
  }
  applyUiShell("home");
}

function setAtInnerTab(tab) {
  atInnerTab = tab === "run" || tab === "report" ? tab : "lib";
  document.querySelectorAll("#autoInnerTabs .home-tab").forEach((btn) => {
    const on = btn.getAttribute("data-at-tab") === atInnerTab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("atPanelLib")?.classList.toggle("hidden", atInnerTab !== "lib");
  document.getElementById("atPanelRun")?.classList.toggle("hidden", atInnerTab !== "run");
  document.getElementById("atPanelReport")?.classList.toggle("hidden", atInnerTab !== "report");
  if (atInnerTab === "lib") {
    renderAutoLib();
  } else if (atInnerTab === "run") {
    renderAutoRun();
    const home = activeHome();
    if (home?.homeId && (home.devices || []).length) {
      refreshDeviceOnlineFlags(home)
        .then(() => {
          if (atInnerTab === "run") {
            renderAutoRun();
          }
        })
        .catch(() => {});
    }
  } else {
    renderAutoReport();
  }
  _atBindHomeSelects();
  _atSetRunButtons();
}

function _atFillHomeSelect(selId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const homes = state.homes || [];
  const cur = state.activeHomeId || "";
  sel.disabled = atRunning;
  sel.innerHTML =
    `<option value="">请选择家庭</option>` +
    homes.map((home) =>
      `<option value="${escapeAttr(home.uid)}" ${home.uid === cur ? "selected" : ""}>${escapeHtml(homeDisplayName(home))}${home.homeId ? ` · ${home.homeId}` : ""}</option>`
    ).join("");
  sel.onchange = () => {
    const uid = sel.value;
    if (uid === (state.activeHomeId || "")) return;
    if (atRunning) {
      toast("测试进行中，请先暂停再切换家庭", "error");
      sel.value = state.activeHomeId || "";
      return;
    }
    const stayReport = atInnerTab === "report";
    state.activeHomeId = uid || "";
    persist();
    atShowResults = false;
    atSelectedUids = null;
    atSelectedTargets = {};
    atCasePicks = {};
    atCaseFilterId = "";
    atCaseFilterTarget = "";
    if (stayReport) {
      atLastReport = null;
    }
    render();
  };
}

function _atBindHomeSelects() {
  _atFillHomeSelect("atHomeSelectRun");
  _atFillHomeSelect("atHomeSelectReport");
}

function _atSetRunButtons() {
  const runBtn = document.getElementById("btnAutoTestRun");
  const pauseBtn = document.getElementById("btnAutoTestPause");
  if (runBtn) {
    runBtn.disabled = atRunning || !activeHome();
  }
  if (pauseBtn) {
    pauseBtn.classList.toggle("hidden", !atRunning);
    pauseBtn.disabled = !atRunning || atPauseRequested;
    pauseBtn.textContent = atPauseRequested ? "暂停中…" : "暂停";
  }
}

function pauseAutoTest() {
  if (!atRunning || atPauseRequested) {
    return;
  }
  atPauseRequested = true;
  _atSetRunButtons();
  toast("将结束当前用例后暂停，并立刻保存到本地", "ok");
}

function _atEnsureSelected(home) {
  const all = (home?.devices || []).filter((dev) => deviceIsOnline(dev)).map((dev) => dev.uid);
  if (atSelectedUids == null) {
    atSelectedUids = [...all];
    return atSelectedUids;
  }
  atSelectedUids = atSelectedUids.filter((uid) => all.includes(uid));
  return atSelectedUids;
}

function _atEnsureTargetMap(plan) {
  const prev = atSelectedTargets[plan.uid] || {};
  const next = {};
  for (const scenario of plan.scenarios || []) {
    if (!scenario.feasible) {
      continue;
    }
    next[scenario.key] = prev[scenario.key] !== false;
  }
  atSelectedTargets[plan.uid] = next;
  return next;
}

function _atSetAllTargets(home, on) {
  const plans = typeof buildAutoDevicePlans === "function" ? buildAutoDevicePlans(home) : [];
  for (const plan of plans) {
    if (!(atSelectedUids || []).includes(plan.uid)) {
      continue;
    }
    const map = {};
    for (const scenario of plan.scenarios || []) {
      if (scenario.feasible) {
        map[scenario.key] = !!on;
      }
    }
    atSelectedTargets[plan.uid] = map;
  }
}

function _atTargetOnCount(plan) {
  const map = atSelectedTargets[plan.uid] || {};
  return (plan.scenarios || []).filter((scenario) => scenario.feasible && map[scenario.key] !== false).length;
}

function _atComboMathTxt(plans, selectedUids) {
  const parts = [];
  for (const uid of selectedUids || []) {
    const plan = (plans || []).find((item) => item.uid === uid);
    if (!plan) {
      continue;
    }
    parts.push({ name: plan.device, n: _atTargetOnCount(plan) });
  }
  if (!parts.length) {
    return "";
  }
  const total = parts.reduce((acc, item) => acc * item.n, 1);
  return parts.map((item) => `${item.name} ${item.n}`).join(" × ") + ` = ${total} 条`;
}

function _atCycleKey(cycle) {
  if (cycle?.key) {
    return cycle.key;
  }
  if (typeof _atComboKey === "function") {
    return _atComboKey(_atCycleAssignments(cycle));
  }
  return String(cycle?.no || "");
}

function _atEnsureCasePicks(cycles) {
  const next = {};
  for (const cycle of cycles || []) {
    const key = _atCycleKey(cycle);
    next[key] = atCasePicks[key] !== false;
  }
  atCasePicks = next;
  return next;
}

function _atPickedCycles(cycles) {
  if (typeof pickComboCycles === "function") {
    return pickComboCycles(cycles, atCasePicks);
  }
  return (cycles || []).filter((cycle) => atCasePicks[_atCycleKey(cycle)] !== false);
}

function _atCaseFilterOpts() {
  return { deviceId: atCaseFilterId, target: atCaseFilterTarget };
}

function _atRowMatchesFilter(row) {
  const opts = _atCaseFilterOpts();
  const parts = String(row.getAttribute("data-parts") || "").split(";;").filter(Boolean);
  const q = String(opts.deviceId || "").trim().toLowerCase();
  const target = String(opts.target || "").trim();
  const pool = parts.filter((part) => {
    const fields = part.split("|");
    const uid = fields[0] || "";
    const deviceId = fields[1] || "";
    const device = fields[2] || "";
    if (!q) {
      return true;
    }
    return uid.toLowerCase().includes(q) || deviceId.toLowerCase().includes(q) || device.toLowerCase().includes(q);
  });
  if (!pool.length) {
    return false;
  }
  if (!target) {
    return true;
  }
  return pool.some((part) => part.split("|").pop() === target);
}

function _atApplyCaseFilter() {
  const idEl = document.getElementById("atCaseFilterId");
  const tEl = document.getElementById("atCaseFilterTarget");
  if (idEl) {
    atCaseFilterId = idEl.value || "";
  }
  if (tEl) {
    atCaseFilterTarget = tEl.value || "";
  }
  const rows = document.querySelectorAll(".at-case-row[data-case-key]");
  rows.forEach((row) => {
    row.classList.toggle("hidden", !_atRowMatchesFilter(row));
  });
  _atRefreshCasePickMeta(rows.length);
}

function _atRefreshCasePickMeta(total) {
  const el = document.getElementById("atCasePickMeta");
  if (!el) {
    return;
  }
  let picked = 0;
  let shown = 0;
  document.querySelectorAll(".at-case-row[data-case-key]").forEach((row) => {
    const on = !!row.querySelector("input[data-case-key]")?.checked;
    const vis = !row.classList.contains("hidden");
    if (on) {
      picked += 1;
    }
    if (vis) {
      shown += 1;
    }
    row.classList.toggle("is-off", !on);
  });
  el.innerHTML = `显示 ${shown}/${total} · <b>将执行 ${picked}</b>`;
}

function _atSetVisibleCasePicks(on) {
  document.querySelectorAll(".at-case-row[data-case-key]").forEach((row) => {
    if (row.classList.contains("hidden")) {
      return;
    }
    const key = row.getAttribute("data-case-key");
    const box = row.querySelector("input[data-case-key]");
    atCasePicks[key] = !!on;
    if (box) {
      box.checked = !!on;
    }
  });
  _atRefreshCasePickMeta(document.querySelectorAll(".at-case-row[data-case-key]").length);
}

function _atSetAllCasePicks(on) {
  Object.keys(atCasePicks).forEach((key) => {
    atCasePicks[key] = !!on;
  });
  document.querySelectorAll("input[data-case-key]").forEach((box) => {
    box.checked = !!on;
  });
  _atRefreshCasePickMeta(document.querySelectorAll(".at-case-row[data-case-key]").length);
}

function _atCaseFilterBarHtml() {
  const catalog = typeof getAutoTargetCatalog === "function" ? getAutoTargetCatalog() : [];
  const opts = catalog.map((item) =>
    `<option value="${escapeAttr(item.target)}" ${atCaseFilterTarget === item.target ? "selected" : ""}>${escapeHtml(typeof _atShortTarget === "function" ? _atShortTarget(item.target) : item.target)}</option>`
  ).join("");
  return `<div class="at-case-filter">` +
    `<input id="atCaseFilterId" type="search" placeholder="设备 ID / 名称" value="${escapeAttr(atCaseFilterId)}" />` +
    `<select id="atCaseFilterTarget"><option value="">全部工况</option>${opts}</select>` +
    `<button type="button" class="btn btn-ghost btn-xs" id="atCasePickShown">勾选筛选结果</button>` +
    `<button type="button" class="btn btn-ghost btn-xs" id="atCaseUnpickShown">取消筛选结果</button>` +
    `<button type="button" class="btn btn-ghost btn-xs" id="atCasePickAll">用例全选</button>` +
    `<button type="button" class="btn btn-ghost btn-xs" id="atCasePickNone">用例清空</button>` +
  `</div>`;
}

function _atCaseRowHtml(cycle) {
  const key = _atCycleKey(cycle);
  const on = atCasePicks[key] !== false;
  const assigns = _atCycleAssignments(cycle);
  const parts = assigns.map((item) => [item.uid || "", item.deviceId || "", item.device || "", item.target || ""].join("|")).join(";;");
  const ids = assigns.map((item) => item.deviceId || item.uid || "—").join(" / ");
  const label = assigns.length
    ? `<span class="at-case-assigns">${assigns.map((item) =>
      `<span class="at-case-assign">${escapeHtml(item.device || "—")} ${_atModelChipHtml(item.target)}</span>`
    ).join("")}</span>`
    : `<span class="at-case-label">${escapeHtml(cycle.label || "—")}</span>`;
  return `<label class="at-case-row ${on ? "" : "is-off"}" data-case-no="${cycle.no}" data-case-key="${escapeAttr(key)}" data-parts="${escapeAttr(parts)}">` +
    `<input type="checkbox" data-case-key="${escapeAttr(key)}" ${on ? "checked" : ""} />` +
    `<span class="at-case-no">${cycle.no}</span>` +
    `<span class="at-case-main">${label}` +
      `<span class="at-case-ids">${escapeHtml(ids)}</span></span>` +
    `<span class="at-case-status at-case-ready">就绪</span>` +
  `</label>`;
}

function _atBindCasePicker(total) {
  document.getElementById("atCaseFilterId")?.addEventListener("input", () => _atApplyCaseFilter());
  document.getElementById("atCaseFilterTarget")?.addEventListener("change", () => _atApplyCaseFilter());
  document.getElementById("atCasePickShown")?.addEventListener("click", () => _atSetVisibleCasePicks(true));
  document.getElementById("atCaseUnpickShown")?.addEventListener("click", () => _atSetVisibleCasePicks(false));
  document.getElementById("atCasePickAll")?.addEventListener("click", () => _atSetAllCasePicks(true));
  document.getElementById("atCasePickNone")?.addEventListener("click", () => _atSetAllCasePicks(false));
  document.querySelectorAll("input[data-case-key]").forEach((box) => {
    box.addEventListener("change", () => {
      atCasePicks[box.getAttribute("data-case-key")] = box.checked;
      _atRefreshCasePickMeta(total);
    });
  });
  _atApplyCaseFilter();
}

function _atDeviceScopeHtml(home, selectedUids, devicePlans) {
  return (home?.devices || []).map((dev) => {
    const plan = (devicePlans || []).find((item) => item.uid === dev.uid)
      || (typeof buildAutoDeviceScenarioPlan === "function" ? buildAutoDeviceScenarioPlan(dev, home) : null);
    if (!plan) {
      return "";
    }
    const online = deviceIsOnline(dev);
    const checked = online && selectedUids.includes(dev.uid);
    const map = _atEnsureTargetMap(plan);
    const chips = (plan.scenarios || []).map((scenario) => {
      const short = typeof _atShortTarget === "function" ? _atShortTarget(scenario.target) : scenario.target;
      const tone = _atModelClass(scenario.target);
      if (!online) {
        return `<button type="button" class="at-tchip ${tone} skip" disabled title="设备离线，不可参与自动化">${escapeHtml(short)}</button>`;
      }
      if (!scenario.feasible) {
        return `<button type="button" class="at-tchip ${tone} skip" disabled title="${escapeAttr(scenario.note || "当前无法构造")}">${escapeHtml(short)}</button>`;
      }
      const on = map[scenario.key] !== false;
      return `<button type="button" class="at-tchip ${tone} ${on ? "ok" : "off"}" data-at-target-uid="${escapeAttr(dev.uid)}" data-at-target-key="${escapeAttr(scenario.key)}" aria-pressed="${on ? "true" : "false"}" title="${escapeAttr(scenario.target + (on ? "（已选入笛卡尔积）" : "（不参与组合）"))}">${escapeHtml(short)}</button>`;
    }).join("");
    const onN = online ? _atTargetOnCount(plan) : 0;
    const feasN = (plan.scenarios || []).filter((scenario) => scenario.feasible).length;
    const onlineBadge = online
      ? `<span class="at-dev-online is-on" title="在线">在线</span>`
      : `<span class="at-dev-online is-off" title="离线设备不可参与自动化">离线</span>`;
    return `<div class="at-dev-card ${checked ? "" : "is-off"} ${online ? "" : "is-offline"}">` +
      `<div class="at-dev-head">` +
        `<label class="at-dev-name"><input type="checkbox" data-at-uid="${escapeAttr(dev.uid)}" ${checked ? "checked" : ""} ${online ? "" : "disabled"} /> ${escapeHtml(dev.name || dev.deviceId)}</label>` +
        `<span class="at-dev-soc">${onlineBadge} · SoC ${plan.soc == null ? "—" : plan.soc + "%"} · ${_atModelChipHtml(plan.currentLabel)}</span>` +
      `</div>` +
      `<div class="at-dev-targets"><span class="k">工况</span>${chips}<span class="at-dev-feas">${online ? `${onN}/${feasN} 已选` : "离线不可选"}</span></div>` +
    `</div>`;
  }).join("");
}

function _atCycleAssignments(cycle) {
  if (Array.isArray(cycle?.assignments) && cycle.assignments.length) {
    return cycle.assignments;
  }
  if (cycle?.uid) {
    return [{
      uid: cycle.uid,
      deviceId: cycle.deviceId,
      device: cycle.device,
      target: cycle.target,
      strategyKey: cycle.strategyKey,
      coverageKey: cycle.coverageKey,
      params: { ...(cycle.params || {}) },
    }];
  }
  return [];
}

function _atCycleDevices(home, cycle) {
  const uids = new Set(_atCycleAssignments(cycle).map((item) => item.uid));
  return (home?.devices || []).filter((dev) => uids.has(dev.uid));
}

function _atCycleLabel(cycle) {
  return cycle.label || `${cycle.device || "—"} · ${cycle.target || "—"}`;
}

function _atStepIndex(stepKey) {
  return AT_STEPS.findIndex((item) => item.key === stepKey);
}

function _atRenderStepPipeline(cycle) {
  const cur = _atStepIndex(cycle.step);
  return AT_STEPS.map((item, idx) => {
    const cls = idx < cur ? "done" : idx === cur ? "active" : "";
    return `<span class="at-pipe-step ${cls}">${escapeHtml(item.label)}</span>`;
  }).join('<span class="at-pipe-arrow">→</span>');
}

function _atStatusBadge(cycle) {
  if (cycle.status === "running" || (cycle.step && cycle.step !== "ready" && cycle.step !== "done")) {
    return `<span class="at-badge at-run">执行中</span>`;
  }
  if (cycle.failed || cycle.status === "fail") {
    return `<span class="at-badge at-fail">失败</span>`;
  }
  if (cycle.status === "done") {
    return `<span class="at-badge at-pass">通过</span>`;
  }
  if (cycle.status === "paused") {
    return `<span class="at-badge at-wait">已暂停</span>`;
  }
  return `<span class="at-badge at-wait">就绪</span>`;
}

function renderAutoTest() {
  setAtInnerTab(atInnerTab || "lib");
}

function _atHomeSummaryHtml(home, expect) {
  let expChg = 0, expDchg = 0, actChg = 0, actDchg = 0;
  for (const dev of home.devices || []) {
    const ex = expect.byUid[dev.uid];
    if (ex) { if (ex.order === "充") expChg += ex.powerW; else if (ex.order === "放") expDchg += ex.powerW; }
    const a = dev.ownerActual;
    if (a) { if (a.order === 1) actChg += a.cmdPowerW || 0; else if (a.order === 2) actDchg += a.cmdPowerW || 0; }
  }
  const agg = expect.agg || { pvTotal: 0, loadSum: 0, microSum: 0 };
  const netTxt = expDchg > expChg ? "整体偏放电 / 倾向馈网" : expChg > expDchg ? "整体偏充电 / 倾向取电" : "充放均衡";
  return (
    `<div class="at-home-dir">` +
      `<div class="at-home-dir-main">` +
        `<span class="at-dir-title">家庭整体方向</span>` +
        `<span class="at-dir dir-chg" title="主机期望：AC口输入给电池充电合计">集群充 ${expChg}W</span>` +
        `<span class="at-dir dir-dchg" title="主机期望：AC口输出放电合计">集群放 ${expDchg}W</span>` +
        `<span class="at-dir-net">${escapeHtml(netTxt)}</span>` +
        (expect.chg2Suppressed && Object.values(expect.byUid).some((v) => v.rep.cat === "chg2")
          ? `<span class="at-badge at-skip" title="充1需求 > 可放总+三方光伏(或电网购电限)，主机抑制充2及对应放电">充2抑制生效</span>` : "") +
      `</div>` +
      `<div class="at-home-dir-sub hint">PV总 ${agg.pvTotal}W · bypass负载 ${agg.loadSum}W · 三方光伏 ${expect.tpv}W · 充1需求 ${expect.chg1Need}W · 可放总 ${expect.disCap}W` +
        (actChg || actDchg ? ` ｜ DP98实际：集群充 ${actChg}W · 放 ${actDchg}W` : ` ｜ DP98实际：暂无`) + `</div>` +
    `</div>`
  );
}

const AT_LIB_META = {
  chg1: { tone: "chg1", how: "把备用电量抬到当前之上 11%，卡进充电1（SoC ≤ 备用−10），避免贴边落到充电2。", delta: 11, mark: "above" },
  chg2: { tone: "chg2", how: "备用比当前高 5%，对齐固件 SoC ≤ 备用−5% 进入充电2。", delta: 5, mark: "above" },
  cc: { tone: "cc", how: "备用略低于当前，电量夹在中间，可充也可放。", delta: -1, mark: "below" },
  canchg: { tone: "canchg", how: "纯 DP 路是备用对齐当前电量；实验室里也能靠调 PV / Bypass / 家庭负载，把放余量压到 ≤0。", delta: 0, mark: "same" },
  candis: { tone: "candis", how: "要现场把电池最大充拉到 0，页面本身写不出来。", delta: null, mark: "none" },
  discharge: { tone: "dchg", how: "实验室可调 PV / Bypass / 家庭负载时，可以构造；核心是让 PV−Bypass ≥ 电池最大充，且 batChg>0。", delta: null, mark: "none" },
  disabled: { tone: "off", how: "MCU 只有故障或电池充放都为 0 才报 0x06。输入/输出限制=0 只能截断功率，状态字仍可能停在充电1 等分支。", delta: null, mark: "none" },
};
const AT_LIB_DP = {
  work_mode: {
    label: "工作模式",
    fmt: (v) => {
      const s = String(v ?? "");
      if (s === "0" || s === "self_powered") return "自用";
      if (s === "1" || s === "time_of_use") return "分时";
      return s || "—";
    },
  },
  backup_soc: { label: "备用电量", fmt: (v) => `${v}%` },
  inverter_input_power_limit: { label: "输入限制", fmt: (v) => `${v}W` },
  output_power_limit: { label: "输出限制", fmt: (v) => `${v}W` },
  regulation_grid_export_p_limit: { label: "法规输出限", fmt: (v) => `${v}W` },
};
const AT_LIB_HAL = [
  { key: "pv_w", label: "目标PV", fmt: (v) => `${v}W` },
  { key: "bypass_w", label: "目标Bypass", fmt: (v) => `${v}W` },
  { key: "grid_load_w", label: "目标负载", fmt: (v) => `${v}W` },
];
const AT_LIB_LIMITS = [
  { dp: "inverter_input_power_limit", short: "输入" },
  { dp: "output_power_limit", short: "输出" },
  { dp: "regulation_grid_export_p_limit", short: "法规" },
];
const AT_LIB_MOCK = {
  pv: 0,
  soc: 55,
  bypass: 0,
  batChg: 1500,
  batDchg: 1500,
  gridLim: 300,
  outLim: 500,
  regLim: 500,
};

function _atLibParseSoc(recipe, meta) {
  const text = String(recipe?.example || "");
  const m = text.match(/SoC\s*=\s*(\d+)/i);
  if (m) return Number(m[1]);
  const backup = Number(recipe?.params?.backup_soc);
  if (Number.isFinite(backup) && meta?.delta != null) {
    return _atClampSoc ? _atClampSoc(backup - meta.delta) : backup - meta.delta;
  }
  if (meta?.mark === "full") return 100;
  return 65;
}

function _atLibCoreTitle(recipe) {
  if (recipe?.coverageKey === "limit_zero") {
    return "仅截断功率 · 输入=0 + 输出=0（不改 MCU 工况字）";
  }
  if (recipe?.coverageKey === "hal_discharge") {
    return "实验室构造 · 放电";
  }
  if (recipe?.coverageKey === "hal_chg1_bypass") {
    return "实验室构造 · Bypass过大";
  }
  if (recipe?.coverageKey === "natural") {
    return "这条路";
  }
  return recipe && Object.keys(recipe.params || {}).length ? "核心下发" : "可写 DP";
}

function _atLibHalChips(recipe) {
  const hal = recipe?.hal || {};
  const steps = Array.isArray(hal.steps) ? hal.steps : [];
  const chips = AT_LIB_HAL
    .map((item) => {
      const raw = hal[item.key];
      if (raw == null || raw === "") {
        return "";
      }
      return `<span class="at-lib-chip is-hal"><i>${escapeHtml(item.label)}</i><b>${escapeHtml(String(raw))}</b></span>`;
    })
    .filter(Boolean)
    .join("");
  const stepChips = steps.map((line) => `<span class="at-lib-chip is-hal">${escapeHtml(line)}</span>`).join("");
  return chips + stepChips || `<span class="at-lib-chip is-hal">${escapeHtml(recipe?.note || "现场调节 PV/Bypass/负载")}</span>`;
}

function _atLibIssueHtml(writable, core, coreParams, noWritableCore) {
  const alts = (writable || []).filter((r) => r.coverageKey === "limit_zero");
  if (alts.length) {
    return alts.map((r) =>
      `<div class="at-lib-issue">` +
        `<span class="at-lib-field-k">${escapeHtml(_atLibCoreTitle(r))}</span>` +
        `<div class="at-lib-chips">${r.labOnly ? `${_atLibParamChips(r.params || {})}${_atLibHalChips(r)}` : _atLibParamChips(r.params || {})}</div>` +
      `</div>`
    ).join("");
  }
  return (
    `<div class="at-lib-issue">` +
      `<span class="at-lib-field-k">${escapeHtml(_atLibCoreTitle(core))}</span>` +
      `<div class="at-lib-chips">${
        noWritableCore && core?.coverageKey !== "natural"
          ? `<span class="at-lib-chip is-skip">构造不了，靠故障或现场条件</span>`
          : (core?.labOnly
              ? `${_atLibParamChips(coreParams || core?.params || {})}${_atLibHalChips(core)}`
              : _atLibParamChips(coreParams || core?.params || {}))
      }</div>` +
    `</div>`
  );
}

function _atLibExtraRoutesHtml(writable, core) {
  const extras = (writable || []).filter((r) => r.labOnly && r.key !== core?.key);
  if (!extras.length) {
    return "";
  }
  return extras.map((r) =>
    `<div class="at-lib-issue">` +
      `<span class="at-lib-field-k">${escapeHtml(_atLibCoreTitle(r))}</span>` +
      `<div class="at-lib-chips">${_atLibParamChips(r.params || {})}${_atLibHalChips(r)}</div>` +
    `</div>`
  ).join("");
}

function _atLibParamChips(params) {
  const entries = Object.entries(params || {});
  if (!entries.length) {
    return `<span class="at-lib-chip is-skip">不用下发</span>`;
  }
  return entries.map(([dp, raw]) => {
    const meta = AT_LIB_DP[dp] || { label: dp, fmt: String };
    return `<span class="at-lib-chip"><i>${escapeHtml(meta.label)}</i><b>${escapeHtml(meta.fmt(raw))}</b></span>`;
  }).join("");
}

function _atLibMockCurrent() {
  return { ...AT_LIB_MOCK };
}

function _atLibCurrentHtml() {
  const inp = _atLibMockCurrent();
  const chips = [
    ["PV", `${Number(inp.pv || 0)}W`],
    ["当前SoC", `${Number(inp.soc || 0)}%`],
    ["Bypass", `${Number(inp.bypass || 0)}W`],
    ["电池最大充", `${Number(inp.batChg || 0)}W`],
    ["电池最大放", `${Number(inp.batDchg || 0)}W`],
    ["AC输入限制", `${Number(inp.gridLim || 0)}W`],
    ["AC输出限制", `${Number(inp.outLim || 0)}W`],
    ["法规输出限制", `${Number(inp.regLim || 0)}W`],
  ];
  return (
    `<div class="at-lib-field">` +
      `<span class="at-lib-field-k">1. 当前值（Mock）</span>` +
      `<div class="at-lib-chips">` +
        chips.map(([k, v]) => `<span class="at-lib-chip is-hal"><i>${escapeHtml(k)}</i><b>${escapeHtml(String(v))}</b></span>`).join("") +
      `</div>` +
    `</div>`
  );
}

function _atLibFormulaHtml(item) {
  const lines = [item?.rule || ""];
  if (item?.also) {
    lines.push(item.also);
  }
  return (
    `<div class="at-lib-field">` +
      `<span class="at-lib-field-k">2. 判定公式</span>` +
      `<div class="at-lib-formula">` +
        lines.filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join("") +
      `</div>` +
    `</div>`
  );
}

function _atLibPointClass(key) {
  if (key === "work_mode") return "is-mode";
  if (key === "backup_soc") return "is-soc";
  if (key === "inverter_input_power_limit") return "is-input";
  if (key === "output_power_limit" || key === "regulation_grid_export_p_limit") return "is-output";
  if (key === "pv_w") return "is-pv";
  if (key === "bypass_w" || key === "grid_load_w") return "is-load";
  return "is-generic";
}

function _atLibPointHtml(key, label, text) {
  return `<span class="at-lib-point ${_atLibPointClass(key)}"><i>${escapeHtml(label)}</i><b>${escapeHtml(text)}</b></span>`;
}

function _atLibRecipePointHtml(recipe) {
  const parts = [];
  for (const [dp, raw] of Object.entries(recipe?.params || {})) {
    const meta = AT_LIB_DP[dp] || { label: dp, fmt: String };
    parts.push(_atLibPointHtml(dp, meta.label, meta.fmt(raw)));
  }
  const hal = recipe?.hal || {};
  for (const item of AT_LIB_HAL) {
    const raw = hal[item.key];
    if (raw == null || raw === "") continue;
    parts.push(_atLibPointHtml(item.key, item.label, item.fmt(raw)));
  }
  return parts.join("") || `<span class="at-lib-point is-generic"><i>无需下发</i><b>天然命中</b></span>`;
}

function _atLibComboFlowHtml(recipe) {
  const title = _atLibCoreTitle(recipe);
  return (
    `<div class="at-lib-route-flow">` +
      `<span>当前值</span><i></i><span class="is-core">${escapeHtml(title)}</span><i></i><span>命中工况</span>` +
    `</div>`
  );
}

function _atLibComboNoteHtml(recipe) {
  const note = String(recipe?.note || "").trim();
  if (!note) {
    return "";
  }
  if (!recipe?.labOnly && recipe?.coverageKey !== "limit_zero") {
    return "";
  }
  const brief = note.replace(/；/g, "； ").slice(0, 120);
  return `<div class="at-lib-combo-note">${escapeHtml(brief)}${note.length > 120 ? "..." : ""}</div>`;
}

function _atLibComboCardHtml(recipe, idx) {
  return (
    `<div class="at-lib-combo-card ${recipe?.feasible ? "is-ok" : "is-off"}">` +
      `<div class="at-lib-combo-head"><span>路径 ${idx + 1}</span><b>${escapeHtml(_atLibCoreTitle(recipe))}</b></div>` +
      _atLibComboFlowHtml(recipe) +
      `<div class="at-lib-points">${_atLibRecipePointHtml(recipe)}</div>` +
      _atLibComboNoteHtml(recipe) +
    `</div>`
  );
}

function _atLibComboSummaryText(recipe) {
  if (!recipe) {
    return "";
  }
  if (recipe.labOnly) {
    return _atLibCoreTitle(recipe);
  }
  return _atLibOverlayName(recipe.params || {});
}

function _atLibComboGroupKey(recipe) {
  if (!recipe) {
    return "";
  }
  if (recipe.labOnly) {
    return recipe.coverageKey || recipe.key || "lab";
  }
  const params = recipe.params || {};
  if (params.backup_soc != null) {
    return "backup_soc";
  }
  if (params.work_mode != null && Object.keys(params).length === 1) {
    return "work_mode_only";
  }
  if (recipe.coverageKey === "limit_zero") {
    return "limit_zero";
  }
  return recipe.coverageKey || recipe.key || "dp";
}

function _atLibExtraComboHtml(writable, primary) {
  const extras = (writable || []).filter((recipe) => recipe && recipe.key !== primary?.key);
  if (!extras.length) {
    return "";
  }
  const primaryGroup = _atLibComboGroupKey(primary);
  const alt = extras.find((recipe) => _atLibComboGroupKey(recipe) !== primaryGroup) || null;
  const sameGroupN = extras.filter((recipe) => _atLibComboGroupKey(recipe) === primaryGroup).length;
  const moreN = extras.length - sameGroupN - (alt ? 1 : 0);
  if (!alt) {
    return sameGroupN > 0
      ? `<div class="at-lib-combo-note">其余 ${sameGroupN} 组属于同类下发路径，已合并不重复展示。</div>`
      : "";
  }
  return (
    `<div class="at-lib-field">` +
      `<span class="at-lib-field-k">其余可达路径（示例）</span>` +
      `<div class="at-lib-combos">${_atLibComboCardHtml(alt, 0)}</div>` +
      `<div class="at-lib-combo-note">同类路径已合并；其余同类 ${sameGroupN} 组不重复展示${moreN > 0 ? `，另外还有 ${moreN} 组其它路径未展开` : ""}。</div>` +
    `</div>`
  );
}

function _atLibCombosHtml(writable, primary) {
  const row = primary ? _atLibComboCardHtml(primary, 0) : "";
  return (
    `<div class="at-lib-field">` +
      `<span class="at-lib-field-k">3. 下发组合</span>` +
      `<div class="at-lib-combos">${row || `<div class="at-lib-combo-note">暂无可达路径</div>`}</div>` +
      _atLibExtraComboHtml(writable, primary) +
    `</div>`
  );
}

function _atLibCurrentDeprecated(item) {
  const cur = item?.current;
  const inp = cur?.inputs;
  if (!inp) {
    return "";
  }
  const chips = [
    ["当前设备", cur.device || "—"],
    ["当前工况", cur.label || "—"],
    ["PV", `${Number(inp.pv || 0)}W`],
    ["Bypass", `${Number(inp.bypass || 0)}W`],
    ["电池最大充", `${Number(inp.batChg || 0)}W`],
    ["电池最大放", `${Number(inp.batDchg || 0)}W`],
  ];
  if (Number.isFinite(inp.gridLim)) {
    chips.push(["AC输入限", `${Number(inp.gridLim)}W`]);
  }
  if (Number.isFinite(inp.outLim)) {
    chips.push(["AC输出限", `${Number(inp.outLim)}W`]);
  }
  return (
    `<div class="at-lib-field">` +
      `<span class="at-lib-field-k">当前值</span>` +
      `<div class="at-lib-chips">` +
        chips.map(([k, v]) => `<span class="at-lib-chip is-hal"><i>${escapeHtml(k)}</i><b>${escapeHtml(String(v))}</b></span>`).join("") +
      `</div>` +
    `</div>`
  );
}

function _atLibSocTrack(item, recipe) {
  const meta = AT_LIB_META[item.key] || {};
  if (meta.mark === "none") {
    return (
      `<div class="at-lib-field">` +
        `<span class="at-lib-field-k">MCU 判定</span>` +
        `<div class="at-lib-soc-caption">${escapeHtml(item.rule)}</div>` +
      `</div>`
    );
  }
  const soc = _atLibParseSoc(recipe, meta);
  const backup = Number(recipe?.params?.backup_soc);
  const backupPct = Number.isFinite(backup) ? backup : (meta.delta != null ? soc + meta.delta : (meta.mark === "full" ? 100 : soc));
  const nowStyle = `left:${Math.max(0, Math.min(100, soc))}%`;
  const bakStyle = `left:${Math.max(0, Math.min(100, backupPct))}%`;
  const same = Math.abs(backupPct - soc) < 0.5;
  return (
    `<div class="at-lib-soc">` +
      `<div class="at-lib-soc-scale"><span>0%</span><span>电量</span><span>100%</span></div>` +
      `<div class="at-lib-soc-track">` +
        `<div class="at-lib-soc-fill" style="width:${Math.max(0, Math.min(100, soc))}%"></div>` +
        `<div class="at-lib-soc-mark is-now" style="${nowStyle}"><em>当前 ${soc}%</em></div>` +
        (same || meta.mark === "full"
          ? ""
          : `<div class="at-lib-soc-mark is-backup" style="${bakStyle}"><em>备用 ${backupPct}%</em></div>`) +
      `</div>` +
      `<div class="at-lib-soc-caption">${escapeHtml(item.rule)}</div>` +
    `</div>`
  );
}

function _atLibOverlayName(params) {
  const on = AT_LIB_LIMITS.filter((item) => params && params[item.dp] != null);
  return on.length ? `再叠 ${on.map((item) => item.short).join(" + ")}` : "只改备用";
}

function _atLibOverlayTile(recipe, live) {
  const onSet = new Set(Object.keys(recipe.params || {}));
  const dots = AT_LIB_LIMITS.map((item) => {
    const on = onSet.has(item.dp);
    const val = recipe.params?.[item.dp];
    return `<span class="at-lib-dot ${on ? "on" : ""}" title="${escapeAttr(item.short)}${on && val != null ? ` ${val}W` : ""}">${escapeHtml(item.short)}${on && val != null ? ` ${val}` : ""}</span>`;
  }).join("");
  const ok = recipe.feasible;
  return (
    `<div class="at-lib-overlay ${ok ? "is-ok" : "is-off"}">` +
      `<div class="at-lib-overlay-top">` +
        `<span>${escapeHtml(_atLibOverlayName(recipe.params))}</span>` +
        (live
          ? `<span class="at-lib-mini ${ok ? "ok" : ""}">${recipe.feasibleN}/${recipe.deviceN}</span>`
          : "") +
      `</div>` +
      `<div class="at-lib-dots">${dots}</div>` +
    `</div>`
  );
}

function renderAutoLib() {
  const body = document.getElementById("autoTestLibBody");
  if (!body) return;
  const hint = document.getElementById("autoTestHintLib");
  if (hint) hint.classList.add("hidden");
  const home = activeHome();
  const demoHome = {
    devices: [{ uid: "_demo", name: "示例机", deviceId: "demo", values: { current_soc: 65, work_mode: "0", backup_soc: 20 } }],
  };
  const live = !!home;
  const allowLab = _atLabConstructEnabled();
  const selectedUids = home ? _atEnsureSelected(home) : ["_demo"];
  const lib = typeof buildConstructLibrary === "function"
    ? buildConstructLibrary(home || demoHome, selectedUids)
    : { items: [], dps: [] };
  const map = (lib.items || []).map((item) => {
    const meta = AT_LIB_META[item.key] || { tone: "cc" };
    const writable = (item.recipes || []).filter((r) =>
      r.coverageKey !== "readonly_gap" && (allowLab || !r.labOnly)
    );
    const ok = live
      ? writable.some((r) => r.feasible)
      : writable.length > 0;
    return `<button type="button" class="at-lib-map-item ${_atModelClass(item.target)} ${ok ? "" : "is-muted"}" data-lib-jump="${escapeAttr(item.key)}">` +
      `<b>${escapeHtml(item.short || item.target)}</b>` +
      `<span>${live ? `${writable.filter((r) => r.feasible).length}/${writable.length || 0}` : "示意"}</span>` +
    `</button>`;
  }).join("");
  const cards = (lib.items || []).map((item) => {
    const meta = AT_LIB_META[item.key] || { tone: "cc", how: item.rule };
    const recipes = item.recipes || [];
    const writable = recipes.filter((r) =>
      r.coverageKey !== "readonly_gap" && (allowLab || !r.labOnly)
    );
    const blocked = recipes.filter((r) => r.coverageKey === "readonly_gap");
    const labHidden = !allowLab
      ? recipes.filter((r) => r.labOnly && r.coverageKey !== "readonly_gap")
      : [];
    const core = writable.find((r) => !r.labOnly) || (allowLab ? writable[0] : null) || null;
    const reach = live
      ? (core
          ? `<span class="at-lib-reach ${core.feasible ? "ok" : ""}">${core.feasibleN}/${core.deviceN} 台能走到</span>`
          : `<span class="at-lib-reach">${labHidden.length ? "需启用实验室构造" : "无可写下发"}</span>`)
      : (core
          ? (item.key === "disabled"
              ? `<span class="at-lib-reach">页面构造不了 0x06</span>`
              : `<span class="at-lib-reach">SoC=65% 示意</span>`)
          : `<span class="at-lib-reach">${labHidden.length ? "需启用实验室构造" : "无可写下发"}</span>`);
    const blockedLine = blocked.length
      ? `<div class="at-lib-gaps">${blocked.map((r) => `<span>${escapeHtml(r.note)}</span>`).join("")}</div>`
      : "";
    const labOffLine = labHidden.length
      ? `<div class="at-lib-gaps"><span>另有 ${labHidden.length} 条实验室路径（需勾选「启用实验室构造路径」）</span></div>`
      : "";
    return (
      `<article class="at-lib-card ${_atModelClass(item.target)}" id="at-lib-${escapeAttr(item.key)}">` +
        `<header class="at-lib-card-head">` +
          `<div><h3>${_atModelChipHtml(item.target)}</h3><p>${escapeHtml(meta.how)}</p></div>` +
          reach +
        `</header>` +
        _atLibCurrentHtml(item) +
        _atLibFormulaHtml(item) +
        _atLibCombosHtml(writable, core) +
        blockedLine +
        labOffLine +
      `</article>`
    );
  }).join("");
  body.innerHTML =
    `<div class="at-lib-wrap">` +
      `<nav class="at-lib-map" id="atLibMap">${map}</nav>` +
      `<div class="at-lib-hero">` +
        `<div class="at-lib-flow">` +
          `<span>读当前电量</span><i></i><span class="is-core">改 DP${allowLab ? " 或调现场" : ""}</span><i></i><span>命中判定</span><i></i><span>目标工况</span>` +
        `</div>` +
        (allowLab
          ? `<p class="at-lib-demo">已启用实验室构造：含 PV/Bypass/负载现场调节路径（尚未完全打通）。</p>`
          : `<p class="at-lib-demo">实验室构造路径默认关闭，当前只展示可写 DP 路线。</p>`) +
        (live ? "" : `<p class="at-lib-demo">还没选家庭，下面用 65% 电量做示意。到「运行」里选家庭后会换成实机数字。</p>`) +
      `</div>` +
      `<div class="at-lib-grid">${cards}</div>` +
    `</div>`;
  body.querySelectorAll("[data-lib-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(`at-lib-${btn.getAttribute("data-lib-jump")}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderAutoRun() {
  const body = document.getElementById("autoTestBody");
  if (!body) return;
  if (atRunning || atShowResults) {
    _atSetRunButtons();
    return;
  }
  document.getElementById("autoTestTimeline")?.classList.add("hidden");
  document.getElementById("autoTestProgress")?.classList.add("hidden");
  const home = activeHome();
  const hint = document.getElementById("autoTestHint");
  if (!home) {
    if (hint) hint.textContent = "请先选择家庭，再勾选设备并开始自动测试。";
    body.innerHTML = "";
    return;
  }
  const selectedUids = _atEnsureSelected(home);
  if (hint) {
    hint.innerHTML =
      "组合用例是各设备<strong>已选工况徽章</strong>的笛卡尔积。可用设备 ID、工况筛选后，再勾选要执行的那几条。启动后按 <b>开始前状态 → 下发参数 → 运行时态 → 检查结果 → 结果回收</b> 执行。失败高亮但不中断。";
  }
  const allPlans = typeof buildAutoDevicePlans === "function" ? buildAutoDevicePlans(home) : [];
  for (const plan of allPlans) {
    _atEnsureTargetMap(plan);
  }
  const execPlan = buildAutoExecutionPlan(home, selectedUids, atSelectedTargets);
  _atEnsureCasePicks(execPlan.cycles || []);
  const pickedN = _atPickedCycles(execPlan.cycles || []).length;
  const expect = computeMasterExpect(home, _atMasterOpts());
  const summary = _atHomeSummaryHtml(home, expect);
  const comboMath = _atComboMathTxt(allPlans, selectedUids);
  const scopeSection =
    `<div class="at-scope-card">` +
      `<div class="at-scope-head"><span class="at-scope-title">设备与工况</span>` +
        `<span class="at-scope-actions"><button type="button" class="btn btn-ghost btn-xs" id="atSelectAll">设备全选</button>` +
        `<button type="button" class="btn btn-ghost btn-xs" id="atSelectNone">设备清空</button>` +
        `<button type="button" class="btn btn-ghost btn-xs" id="atTargetAll">工况全选</button>` +
        `<button type="button" class="btn btn-ghost btn-xs" id="atTargetNone">工况清空</button></span></div>` +
      `<p class="hint">勾选设备后，再点工况徽章决定这台机参与哪些态。划掉的是当前构造不了的工况；离线设备不可勾选。</p>` +
      `<div class="at-dev-cards">${_atDeviceScopeHtml(home, selectedUids, allPlans) || `<span class="hint">当前家庭暂无设备</span>`}</div>` +
    `</div>`;
  const caseRows = (execPlan.cycles || []).map((cycle) => _atCaseRowHtml(cycle)).join("");
  const totalCycleN = Number.isFinite(execPlan.totalCycles) ? execPlan.totalCycles : (execPlan.cycles || []).length;
  const caseMeta = execPlan.truncated
    ? `当前仅渲染前 <b>${(execPlan.cycles || []).length}</b> / ${totalCycleN} 条（组合过大，已截断）`
    : `将执行 <b>${pickedN}</b> / ${(execPlan.cycles || []).length}`;
  const caseSection =
    `<div class="at-case-card">` +
      `<div class="at-scope-head"><span class="at-scope-title">组合用例</span>` +
        `<span class="hint" id="atCasePickMeta">${comboMath ? escapeHtml(comboMath) + " · " : ""}${caseMeta}</span></div>` +
      (execPlan.incomplete
        ? `<p class="hint at-warn">有设备没勾任何可构造工况，笛卡尔积为空。请点徽章选入工况，或先读取状态。</p>`
        : execPlan.truncated
          ? `<p class="hint at-warn">当前设备/工况组合数为 ${totalCycleN}，运行页只展示前 ${(execPlan.cycles || []).length} 条，避免页面卡死。建议减少勾选设备或工况后再跑。</p>` + _atCaseFilterBarHtml() + `<div class="at-case-list">${caseRows || `<div class="hint">暂无可执行组合用例</div>`}</div>`
        : _atCaseFilterBarHtml() + `<div class="at-case-list">${caseRows || `<div class="hint">暂无可执行组合用例</div>`}</div>`) +
    `</div>`;
  body.innerHTML = summary + scopeSection + caseSection;
  body.querySelectorAll("[data-at-uid]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const uid = cb.getAttribute("data-at-uid");
      if (!uid) return;
      const dev = (home.devices || []).find((item) => item.uid === uid);
      if (!deviceIsOnline(dev)) {
        cb.checked = false;
        toast("离线设备不可参与自动化", "error");
        renderAutoRun();
        return;
      }
      if (cb.checked) {
        if (!atSelectedUids.includes(uid)) atSelectedUids.push(uid);
      } else {
        atSelectedUids = atSelectedUids.filter((item) => item !== uid);
      }
      renderAutoRun();
    });
  });
  body.querySelectorAll("[data-at-target-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uid = btn.getAttribute("data-at-target-uid");
      const key = btn.getAttribute("data-at-target-key");
      if (!uid || !key) return;
      const dev = (home.devices || []).find((item) => item.uid === uid);
      if (!deviceIsOnline(dev)) {
        toast("离线设备不可参与自动化", "error");
        return;
      }
      if (!atSelectedUids.includes(uid)) {
        atSelectedUids.push(uid);
      }
      const map = atSelectedTargets[uid] || {};
      map[key] = map[key] === false;
      atSelectedTargets[uid] = map;
      renderAutoRun();
    });
  });
  body.querySelector("#atSelectAll")?.addEventListener("click", () => {
    atSelectedUids = (home.devices || []).filter((dev) => deviceIsOnline(dev)).map((dev) => dev.uid);
    renderAutoRun();
  });
  body.querySelector("#atSelectNone")?.addEventListener("click", () => {
    atSelectedUids = [];
    renderAutoRun();
  });
  body.querySelector("#atTargetAll")?.addEventListener("click", () => {
    _atSetAllTargets(home, true);
    renderAutoRun();
  });
  body.querySelector("#atTargetNone")?.addEventListener("click", () => {
    _atSetAllTargets(home, false);
    renderAutoRun();
  });
  if (!execPlan.incomplete) {
    _atBindCasePicker((execPlan.cycles || []).length);
  }
  _atSetRunButtons();
  _atBindHomeSelects();
}

function renderAutoReport() {
  _atBindHomeSelects();
  void _atLoadReportPanel();
}

function _atReportOptionLabel(item) {
  const when = item.createdAt || item.id || "";
  const paused = item.status === "paused" ? "暂停" : "完成";
  const sum = item.summary || item.title || item.id || "";
  return `${when} · ${paused} · ${sum}`;
}

function _atSortReports(items) {
  return [...(items || [])].sort((a, b) => String(b.createdAt || b.id || "").localeCompare(String(a.createdAt || a.id || "")));
}

async function _atLoadReportPanel() {
  const reportSel = document.getElementById("atReportSelect");
  const hint = document.getElementById("atReportPickHint");
  const rep = document.getElementById("autoTestReport");
  const home = activeHome();
  if (!reportSel) {
    return;
  }
  if (!home) {
    reportSel.disabled = true;
    reportSel.innerHTML = `<option value="">请先选择家庭</option>`;
    if (hint) hint.textContent = "请先选择家庭，再看报告。";
    if (rep) {
      rep.classList.add("hidden");
      rep.innerHTML = "";
    }
    return;
  }
  const items = _atSortReports((await _atFetchReportList()).filter((item) => _atReportBelongsToHome(item, home)));
  if (!items.length) {
    reportSel.disabled = true;
    reportSel.innerHTML = `<option value="">暂无报告</option>`;
    if (hint) hint.textContent = "该家庭还没有报告。跑测或暂停后会自动保存。";
    if (rep) {
      rep.classList.add("hidden");
      rep.innerHTML = "";
    }
    return;
  }
  const currentId = atLastReport?.id || atActiveReportId || "";
  const keep = items.some((item) => item.id === currentId) ? currentId : items[0].id;
  reportSel.disabled = false;
  reportSel.innerHTML = items.map((item) =>
    `<option value="${escapeAttr(item.id)}" ${item.id === keep ? "selected" : ""}>${escapeHtml(_atReportOptionLabel(item))}</option>`
  ).join("");
  reportSel.onchange = () => {
    const id = reportSel.value;
    if (id && id !== (atLastReport?.id || "")) {
      void _atLoadReport(id);
    }
  };
  if (hint) hint.textContent = `共 ${items.length} 份，默认最新，可改选。`;
  if (atLastReport && atLastReport.id === keep) {
    _atRenderReportPlayer(keep);
    return;
  }
  await _atLoadReport(keep);
}

// AC 充放方向徽章：充=AC口输入(买电/给电池充)，放=AC口输出(放电)，待机=无
function _atDirChip(order, powerW) {
  const map = {
    "充": ["dir-chg", "AC 充 ←"],
    "放": ["dir-dchg", "AC 放 →"],
    "待机": ["dir-idle", "待机"],
  };
  const m = map[order] || ["dir-na", "—"];
  const pw = powerW == null || order === "待机" || order === "—" ? "" : ` ${powerW}W`;
  return `<span class="at-dir ${m[0]}">${m[1]}${pw}</span>`;
}

function _atSetProg(done, total, msg) {
  const prog = document.getElementById("autoTestProgress");
  if (!prog) return;
  prog.classList.remove("hidden");
  const pct = total ? Math.round((done / total) * 100) : 0;
  prog.innerHTML = `<div>${escapeHtml(msg)} · ${done}/${total}</div><div class="bar"><i style="width:${pct}%"></i></div>`;
}

function _nowHMS(at) {
  const d = at == null ? new Date() : new Date(at);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const _atParamStr = (params) => Object.entries(params || {}).map(([k, v]) => `${k}=${v}`).join(" ");

function _atStateLabel(actual) {
  if (!actual) return "—";
  if (actual.order === 1) return "充";
  if (actual.order === 2) return "放";
  return "待机";
}

function _atSnapshotData(canvas) {
  return {
    image: canvasToJpegDataUrl(canvas, SNAPSHOT_MAX_W, 0.76),
    thumb: canvasToJpegDataUrl(canvas, 360, 0.62),
  };
}

function _atFamilyState(home) {
  return (home?.devices || []).map((dev) => {
    const owner = classifyOwnerWorkModel(dev);
    const actual = dev.ownerActual;
    const v = dev.values || {};
    const soc = typeof _atSoc === "function" ? _atSoc(dev) : Number(v.current_soc ?? v.main_soc);
    return {
      uid: dev.uid,
      deviceId: dev.deviceId,
      device: dev.name || dev.deviceId,
      reportTime: dev.reportTime || null,
      soc: Number.isFinite(soc) ? soc : null,
      backup: v.backup_soc != null && v.backup_soc !== "" ? Number(v.backup_soc) : null,
      workMode: v.work_mode != null ? String(v.work_mode) : "",
      pv: typeof _ownerPvW === "function" ? _ownerPvW(dev) : 0,
      bypass: typeof _ownerBypassW === "function" ? _ownerBypassW(dev) : 0,
      theory: owner ? owner.label : "—",
      theoryChargeW: owner ? owner.chgCapW : null,
      theoryDischargeW: owner ? owner.dchgCapW : null,
      actualLabel: actual ? actual.label : "—",
      actualOrder: _atStateLabel(actual),
      actualPowerW: actual ? actual.cmdPowerW : null,
    };
  });
}

function _atFamilyLoadW(home) {
  const grid = typeof resolveGridNodePower === "function"
    ? resolveGridNodePower(home)
    : { watts: null, source: "none" };
  const meterW = grid.watts != null && Number.isFinite(Number(grid.watts)) ? Number(grid.watts) : null;
  let sumNegGrid = 0;
  for (const dev of home?.devices || []) {
    const v = dev.values || {};
    const g = Number(v.grid_port_power ?? v.inverter_output_power);
    if (Number.isFinite(g)) {
      sumNegGrid += -g;
    }
  }
  if (meterW != null && (grid.source === "meter" || grid.source === "lan")) {
    return Math.round(meterW - sumNegGrid);
  }
  const fv = home?.familyValues || {};
  const base = Number(fv.base_load);
  const plug = Number(fv.total_plug_power);
  const sum = (Number.isFinite(base) ? base : 0) + (Number.isFinite(plug) ? plug : 0);
  return sum ? Math.round(sum) : null;
}

function _atHomeFlow(home) {
  const agg = typeof _atHomeAgg === "function" ? _atHomeAgg(home) : { pvTotal: 0, loadSum: 0, microSum: 0 };
  let actChg = 0;
  let actDchg = 0;
  const bypasses = [];
  for (const dev of home?.devices || []) {
    const actual = dev.ownerActual;
    if (actual) {
      if (actual.order === 1) {
        actChg += actual.cmdPowerW || 0;
      } else if (actual.order === 2) {
        actDchg += actual.cmdPowerW || 0;
      }
    }
    bypasses.push({
      uid: dev.uid,
      device: dev.name || dev.deviceId,
      w: typeof _ownerBypassW === "function" ? Math.round(_ownerBypassW(dev) || 0) : 0,
    });
  }
  const grid = typeof resolveGridNodePower === "function" ? resolveGridNodePower(home) : { watts: null };
  return {
    pvTotal: Math.round(agg.pvTotal || 0),
    bypass: Math.round(agg.loadSum || 0),
    micro: Math.round(agg.microSum || 0),
    actChg: Math.round(actChg),
    actDchg: Math.round(actDchg),
    gridW: grid.watts == null || !Number.isFinite(Number(grid.watts)) ? null : Math.round(Number(grid.watts)),
    familyLoad: _atFamilyLoadW(home),
    bypasses,
  };
}

function _atPhaseLabel(phase) {
  return ({
    before: "开始前",
    issued: "下发",
    mid: "运行中",
    observe: "检查",
    "fail-focus": "失败",
    restore: "回收",
  })[phase] || phase;
}

/**
 * @brief Comma-separated device IDs involved in a cycle
 * @param[in] cycle test cycle
 * @return device id text or empty
 */
function _atCycleDeviceIds(cycle) {
  const ids = [...new Set(_atCycleAssignments(cycle).map((item) => item.deviceId).filter(Boolean))];
  if (ids.length) {
    return ids.join(" · ");
  }
  return cycle.deviceId || "";
}

/**
 * @brief Append device id(s) to a step title for report display
 * @param[in] base title prefix
 * @param[in] cycle test cycle
 * @return title with device id
 */
function _atFrameTitleWithDevice(base, cycle) {
  const ids = _atCycleDeviceIds(cycle);
  return ids ? `${base} · ${ids}` : base;
}

/**
 * @brief Whether any assignment in this cycle failed to issue
 * @param[in] cycle test cycle
 * @return true if issue failed
 */
function _atIssueFailed(cycle) {
  return (cycle.issued || []).some((item) => item.ok === false);
}

/**
 * @brief CSS class for per-step pass/fail frame border
 * @param[in] frame captured frame
 * @return is-ok or is-fail
 */
function _atFrameStepClass(frame) {
  if (frame?.stepOk === false || frame?.emphasis === "fail") {
    return "is-fail";
  }
  if (frame?.stepOk === true) {
    return "is-ok";
  }
  if (frame?.phase === "issued") {
    return _atIssueFailed({ issued: frame.issued || [] }) ? "is-fail" : "is-ok";
  }
  if (frame?.phase === "observe" || frame?.phase === "fail-focus") {
    const results = frame.checkerState || [];
    return results.some((item) => !item.pass || item.error) ? "is-fail" : "is-ok";
  }
  if (frame?.failed) {
    return "is-fail";
  }
  return "is-ok";
}

/**
 * @brief Restore device params after a cycle; capture restore frame
 * @param[in] home active home
 * @param[in] cycle test cycle
 * @param[in] orig snapshot before run
 * @param[in] fieldsToRestore dp keys to restore
 * @return true if all restores succeeded
 */
async function _atRunCycleRestore(home, cycle, orig, fieldsToRestore) {
  let restoreOk = true;
  for (const assignment of _atCycleAssignments(cycle)) {
    const dev = (home.devices || []).find((item) => item.uid === assignment.uid);
    if (!dev || !Object.keys(assignment.params || {}).length) {
      continue;
    }
    for (const key of fieldsToRestore) {
      dev.drafts[key] = orig[assignment.uid]?.[key] || "";
    }
    try {
      const ok = await issueDevice(home, dev, { batch: true });
      if (!ok) {
        restoreOk = false;
      }
    } catch (_) {
      restoreOk = false;
    }
  }
  await _atCaptureFrame(home, cycle, "restore", {
    title: _atFrameTitleWithDevice("5. 结果回收", cycle),
    readScope: "family",
    stepOk: restoreOk,
    issued: _atCycleAssignments(cycle).map((assignment) => ({
      device: assignment.device,
      deviceId: assignment.deviceId,
      target: assignment.target,
      params: orig[assignment.uid] || {},
      from: { ...(assignment.params || {}) },
      ok: restoreOk,
    })),
    note: restoreOk ? "已恢复本用例涉及设备的原始参数。" : "部分设备参数回收失败，请人工核对。",
  });
  return restoreOk;
}

/**
 * @brief Build checker-style rows when issue step failed (skip observe)
 * @param[in] cycle test cycle
 * @return result rows
 */
function _atResultsFromIssueFail(cycle) {
  return _atCycleAssignments(cycle).map((assignment) => {
    const issuedItem = (cycle.issued || []).find((item) => item.uid === assignment.uid);
    const failed = issuedItem?.ok === false;
    return {
      uid: assignment.uid,
      device: assignment.device,
      deviceId: assignment.deviceId,
      role: "target",
      params: assignment.params,
      target: assignment.target,
      coverageKey: assignment.coverageKey,
      theory: "—",
      actLabel: "—",
      actOrder: "—",
      actPower: null,
      hitTarget: false,
      expOrder: "—",
      expPower: null,
      pass: !failed,
      error: failed ? (issuedItem?.err || "下发失败") : null,
      failTags: failed ? ["下发失败"] : [],
      masterPass: null,
      masterNote: failed ? (issuedItem?.err || "下发失败") : "",
      l1Formula: "下发失败，未检查 L1",
      l2Formula: "下发失败，未检查 L2",
      failStage: failed ? "issue" : "ok",
    };
  }).filter(Boolean);
}

function _atW(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) {
    return "—";
  }
  return `${Math.round(Number(value))}W`;
}

function _atParamHuman(params) {
  return Object.entries(params || {}).map(([key, value]) => {
    const meta = AT_LIB_DP[key];
    if (meta) {
      return `${meta.label}=${meta.fmt(value)}`;
    }
    return `${key}=${value}`;
  }).join("，");
}

function _atParamFmt(key, value) {
  const meta = AT_LIB_DP[key];
  if (meta) {
    return meta.fmt(value);
  }
  return value == null || value === "" ? "—" : String(value);
}

/**
 * @brief Show param changes as "label 旧值→新值"
 * @param[in] params new values
 * @param[in] from previous values (optional)
 * @return human text
 */
function _atParamChangeHuman(params, from) {
  const entries = Object.entries(params || {});
  if (!entries.length) {
    return "";
  }
  return entries.map(([key, value]) => {
    const meta = AT_LIB_DP[key] || { label: key };
    const toTxt = _atParamFmt(key, value);
    const hasFrom = from && Object.prototype.hasOwnProperty.call(from, key);
    if (!hasFrom) {
      return `${meta.label}→${toTxt}`;
    }
    const fromTxt = _atParamFmt(key, from[key]);
    if (String(from[key] ?? "") === String(value ?? "")) {
      return `${meta.label}=${toTxt}`;
    }
    return `${meta.label} ${fromTxt}→${toTxt}`;
  }).join("，");
}

function _atModelClass(label) {
  const raw = String(label || "").trim();
  const map = {
    "充电状态1": "m33", "充电1": "m33", chg1: "m33", m33: "m33", "0x21": "m33", "33": "m33",
    "充电状态2": "m1", "充电2": "m1", chg2: "m1", m1: "m1", "0x01": "m1", "1": "m1",
    "可充可放": "m3", cc: "m3", m3: "m3", "0x03": "m3", "3": "m3",
    "可充": "m4", canchg: "m4", m4: "m4", "0x04": "m4", "4": "m4",
    "可放": "m5", candis: "m5", m5: "m5", "0x05": "m5", "5": "m5",
    "放电": "m2", discharge: "m2", dchg: "m2", m2: "m2", "0x02": "m2", "2": "m2",
    "禁充禁放": "m6", disabled: "m6", off: "m6", m6: "m6", "0x06": "m6", "6": "m6",
  };
  if (map[raw]) {
    return map[raw];
  }
  const short = typeof _atShortTarget === "function" ? _atShortTarget(raw) : raw;
  return map[short] || "";
}

function _atModelChipHtml(label, extraClass) {
  const text = String(label || "").trim();
  if (!text || text === "—") {
    return `<span class="owner-chip">${escapeHtml(text || "—")}</span>`;
  }
  const shown = typeof _atShortTarget === "function" ? _atShortTarget(text) : text;
  return `<span class="owner-chip ${_atModelClass(text)}${extraClass ? ` ${extraClass}` : ""}">${escapeHtml(shown)}</span>`;
}

function _atGridFlowTxt(flow) {
  if (!flow || flow.gridW == null) {
    return "电网 —";
  }
  if (flow.gridW > 0) {
    return `电网取电 ${flow.gridW}W`;
  }
  if (flow.gridW < 0) {
    return `电网馈网 ${-flow.gridW}W`;
  }
  return "电网 0W";
}

function _atTermChip(kind, name, value, dir) {
  const dirHtml = dir ? `<i class="at-term-dir">${escapeHtml(dir)}</i>` : "";
  const on = value && value !== "—" && value !== "0W";
  return `<span class="at-term at-term-${kind}${on ? " is-on" : ""}"><b>${escapeHtml(name)}</b>${dirHtml}<em>${escapeHtml(value)}</em></span>`;
}

function _atGridTermHtml(flow) {
  if (!flow || flow.gridW == null) {
    return _atTermChip("grid", "电网", "—");
  }
  if (flow.gridW > 0) {
    return _atTermChip("grid", "电网", `${flow.gridW}W`, "取电");
  }
  if (flow.gridW < 0) {
    return _atTermChip("grid", "电网", `${-flow.gridW}W`, "馈网");
  }
  return _atTermChip("grid", "电网", "0W");
}

function _atBypassTermsHtml(flow, familyState) {
  let items = [];
  if (Array.isArray(flow?.bypasses) && flow.bypasses.length) {
    items = flow.bypasses.map((item) => ({ name: item.device || "—", w: item.w }));
  } else if ((familyState || []).length) {
    items = familyState.map((item) => ({ name: item.device || "—", w: item.bypass }));
  } else if (flow?.bypass != null) {
    items = [{ name: "合计", w: flow.bypass }];
  }
  if (!items.length) {
    return _atTermChip("bypass", "Bypass", "—");
  }
  return items.map((item) => _atTermChip("bypass", item.name, _atW(item.w))).join("");
}

function _atFlowSchematicHtml(flow, familyState, size) {
  const pvExtra = flow?.micro ? _atTermChip("pv", "三方", _atW(flow.micro)) : "";
  return `<div class="at-schematic${size === "lg" ? " is-lg" : ""}" title="左 PV 进 · 上 电网/集群充放 · 右 负载 · 下 Bypass">` +
    `<div class="at-sch-n">` +
      _atGridTermHtml(flow) +
      `<div class="at-sch-cluster">` +
        _atTermChip("chg", "集群充", _atW(flow?.actChg)) +
        _atTermChip("dchg", "集群放", _atW(flow?.actDchg)) +
      `</div>` +
    `</div>` +
    `<div class="at-sch-vn" aria-hidden="true"></div>` +
    `<div class="at-sch-w">${_atTermChip("pv", "PV", _atW(flow?.pvTotal))}${pvExtra}</div>` +
    `<div class="at-sch-hw" aria-hidden="true"></div>` +
    `<div class="at-sch-hub">家</div>` +
    `<div class="at-sch-he" aria-hidden="true"></div>` +
    `<div class="at-sch-e">${_atTermChip("load", "负载", _atW(flow?.familyLoad))}</div>` +
    `<div class="at-sch-vs" aria-hidden="true"></div>` +
    `<div class="at-sch-s">${_atBypassTermsHtml(flow, familyState)}</div>` +
  `</div>`;
}

function _atFlowTermsHtml(flow, familyState) {
  return `<div class="at-flow-terms">` +
    `<div class="at-flow-row">` +
      _atTermChip("pv", "PV", _atW(flow?.pvTotal)) +
      _atGridTermHtml(flow) +
      _atTermChip("load", "负载", _atW(flow?.familyLoad)) +
    `</div>` +
    `<div class="at-flow-row">` +
      _atTermChip("chg", "集群", _atW(flow?.actChg), "充") +
      _atTermChip("dchg", "集群", _atW(flow?.actDchg), "放") +
      (flow?.micro ? _atTermChip("pv", "三方", _atW(flow.micro)) : "") +
    `</div>` +
    `<div class="at-flow-row at-flow-bypass"><span class="at-flow-kicker">Bypass</span>${_atBypassTermsHtml(flow, familyState)}</div>` +
    `</div>`;
}

function _atVerdictBadgeHtml(verdict) {
  const kind = verdict?.kind || "paused";
  const icons = {
    pass: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><path d="M6 10.4l2.6 2.6L14.4 7.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    fail: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
    paused: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><path d="M8 6.5h1.6v7H8zm2.4 0H12v7h-1.6z" fill="currentColor"/></svg>`,
  };
  const cls = kind === "pass" ? "is-pass" : kind === "fail" ? "is-fail" : "is-pause";
  const label = kind === "pass" ? "通过" : kind === "fail" ? "失败" : (verdict?.label || "暂停");
  return `<span class="at-verdict ${cls}">${icons[kind] || icons.paused}<b>${escapeHtml(label)}</b></span>`;
}

function _atBypassPlain(flow, familyState) {
  if (Array.isArray(flow?.bypasses) && flow.bypasses.length) {
    return flow.bypasses.map((item) => `${item.device || "—"} ${_atW(item.w)}`).join(" · ");
  }
  const list = familyState || [];
  if (!list.length) {
    return flow?.bypass != null ? `合计 ${_atW(flow.bypass)}` : "—";
  }
  return list.map((item) => `${item.device || "—"} ${_atW(item.bypass)}`).join(" · ");
}

function _atHomeFlowHtml(flow, familyState) {
  if (!flow && !(familyState || []).length) {
    return "";
  }
  return `<div class="at-step-flow">` +
    `<div class="at-step-kicker">家庭流向</div>` +
    _atFlowTermsHtml(flow, familyState) +
    `</div>`;
}

function _atDeviceStateTable(familyState) {
  const list = familyState || [];
  if (!list.length) {
    return "";
  }
  const rows = list.map((item) =>
    `<tr>` +
      `<td>${escapeHtml(item.device || "—")}</td>` +
      `<td class="mono">${item.soc != null ? `${item.soc}%` : "—"}${item.backup != null && Number.isFinite(item.backup) ? `/${item.backup}%` : ""}</td>` +
      `<td>${_atModelChipHtml(item.theory)}</td>` +
      `<td class="mono">${escapeHtml(_atFmtCmd(item.actualOrder, item.actualPowerW))}</td>` +
      `<td class="mono">PV ${_atW(item.pv)} · By ${_atW(item.bypass)}</td>` +
    `</tr>`
  ).join("");
  return `<div class="at-step-kicker">各设备状态</div>` +
    `<div class="at-step-table-wrap"><table class="at-step-table at-step-table-compact"><thead><tr><th>设备</th><th>SoC/备</th><th>工况</th><th>DP98</th><th>口功率</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function _atIssuedTable(issued) {
  const list = issued || [];
  if (!list.length) {
    return `<div class="at-player-note">本步没有下发记录。</div>`;
  }
  const rows = list.map((item) => {
    const human = _atParamChangeHuman(item.params, item.from) || _atParamHuman(item.params);
    const ok = item.ok !== false;
    return `<tr class="${ok ? "" : "is-fail"}">` +
      `<td>${escapeHtml(item.device || "—")}</td>` +
      `<td>${_atModelChipHtml(item.target)}</td>` +
      `<td class="mono at-param-change">${escapeHtml(human || "天然命中，未改参")}</td>` +
      `<td>${ok
        ? `<span class="at-badge at-pass">${human ? "已下发" : "未改参"}</span>`
        : `<span class="at-badge at-fail">下发失败</span>${item.err ? `<div class="at-fail-text">${escapeHtml(item.err)}</div>` : ""}`}</td>` +
      `</tr>`;
  }).join("");
  return `<div class="at-step-table-wrap"><table class="at-step-table at-step-table-compact"><thead><tr><th>设备</th><th>目标</th><th>参数变更</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function _atFrameOneLiner(frame) {
  if (frame.phase === "before" && frame.homeFlow) {
    return `PV ${_atW(frame.homeFlow.pvTotal)} · Bypass ${_atW(frame.homeFlow.bypass)} · ${_atGridFlowTxt(frame.homeFlow)}`;
  }
  if (frame.phase === "issued") {
    const changed = (frame.issued || []).filter((item) => Object.keys(item.params || {}).length).length;
    const failN = (frame.issued || []).filter((item) => item.ok === false).length;
    if (failN) {
      return `${failN} 台下发失败`;
    }
    return changed ? `下发 ${changed} 台参数` : "天然命中，未改参";
  }
  if (frame.phase === "mid" && frame.homeFlow) {
    return `PV ${_atW(frame.homeFlow.pvTotal)} · Bypass ${_atW(frame.homeFlow.bypass)}`;
  }
  if (frame.phase === "observe" || frame.phase === "fail-focus") {
    const l3 = frame.masterExpect?.l3 || (frame.homeFlow ? _atEvalFamilyL3(frame.homeFlow) : null);
    const stats = _atCheckerStageStats(frame.checkerState || [], l3);
    const parts = [];
    if (stats.issueFail) {
      parts.push(`下发✗${stats.issueFail}`);
    }
    if (stats.l1Fail) {
      parts.push(`L1✗${stats.l1Fail}`);
    }
    if (stats.l2Fail) {
      parts.push(`L2✗${stats.l2Fail}`);
    }
    if (stats.l3Fail) {
      parts.push("L3✗");
    }
    if (!parts.length) {
      return stats.total ? `${stats.total} 台通过` + (l3 && l3.pass !== false ? " · L3✓" : "") : "检查通过";
    }
    return `${parts.join(" · ")} / ${stats.total}`;
  }
  if (frame.phase === "restore") {
    return "已恢复下发前参数";
  }
  return frame.note || "";
}

function _atCycleDevice(home, cycle) {
  return _atCycleDevices(home, cycle)[0] || null;
}

function _atFmtCmd(order, powerW) {
  if (!order || order === "—") {
    return powerW == null ? "—" : `—/${powerW}W`;
  }
  return `${order}/${powerW == null ? "—" : powerW}W`;
}

function _atL2DirOk(r) {
  return r.actOrder === r.expOrder;
}

function _atL2PowOk(r) {
  return Array.isArray(r.expBand) && r.actPower != null && r.actPower >= r.expBand[0] && r.actPower <= r.expBand[1];
}

function _atFailTags(r) {
  const tags = [];
  if (r.error) {
    tags.push("下发失败");
  }
  if (_atIsL1Row(r) && !r.hitTarget) {
    tags.push("工况未中");
  }
  if (r.masterPass === false) {
    if (!_atL2DirOk(r)) {
      tags.push("方向不符");
    } else if (!_atL2PowOk(r)) {
      tags.push("功率越界");
    } else {
      tags.push("主机不符");
    }
  }
  return tags;
}

function _atIsLegacyWhy(text) {
  return /参考不硬判|能量守恒|强制充电|充2抑制|未被抑制|仅有盈余/.test(String(text || ""));
}

function _atFailReason(r) {
  if (r.failReason && !_atIsLegacyWhy(r.failReason)) {
    return r.failReason;
  }
  const lines = [];
  if (r.error) {
    lines.push(`下发失败：${r.error}`);
  }
  if (_atIsL1Row(r) && !r.hitTarget) {
    lines.push(`工况未中：目标 ${r.target || "—"}，读回 ${r.theory || "—"}`);
  }
  if (r.masterPass === false) {
    const exp = _atFmtCmd(r.expOrder, r.expPower);
    const act = _atFmtCmd(r.actOrder, r.actPower);
    const band = Array.isArray(r.expBand) ? `（容 ${r.expBand[0]}~${r.expBand[1]}）` : "";
    if (!_atL2DirOk(r)) {
      lines.push(`方向不符：期望 ${exp}，实际 ${act}`);
    } else {
      lines.push(`功率越界：期望 ${exp}${band}，实际 ${act}`);
    }
  }
  return lines.join("；");
}

function _atFailLines(results) {
  return (results || [])
    .filter((item) => !item.pass || !!item.error)
    .map((item) => `${item.device}：${_atFailReason(item) || "未通过"}`);
}

function _atSortChecker(results) {
  return [...(results || [])].sort((a, b) => {
    const af = (!a.pass || a.error) ? 0 : 1;
    const bf = (!b.pass || b.error) ? 0 : 1;
    return af - bf;
  });
}

function _atWattTerm(name, w, note) {
  return { name: String(name || "—"), w: Math.round(Number(w) || 0), note: note || "" };
}

function _atJoinWattTerms(terms, keepZero) {
  const list = keepZero
    ? (terms || [])
    : (terms || []).filter((item) => item && Number(item.w) !== 0);
  if (!list.length) {
    return "0";
  }
  return list.map((item) => `${item.name} ${item.w}W`).join(" + ");
}

/**
 * Snapshot L2 cluster inputs plus per-device substitution terms for checker formulas.
 * @param[in] expect computeMasterExpect result
 * @param[in] home active home
 * @return brief object or null
 */
function _atExpectMetaBrief(expect, home) {
  if (!expect) {
    return null;
  }
  const pvTerms = [];
  const loadTerms = [];
  const microTerms = [];
  const chg1Terms = [];
  const disTerms = [];
  for (const d of home?.devices || []) {
    const name = d.name || d.deviceId || "—";
    const pv = typeof _ownerPvW === "function" ? _ownerPvW(d) : Math.max(0, Number(d.values?.pv_power_total) || 0);
    const og = typeof _ownerBypassW === "function"
      ? _ownerBypassW(d)
      : Number(d.values?.offgrid1_export_power ?? d.values?.battery_charging_power_grid) || 0;
    pvTerms.push(_atWattTerm(name, pv, "DP20 pv_power_total"));
    if (og > 0) {
      loadTerms.push(_atWattTerm(name, og, "DP38 offgrid1_export_power>0"));
    } else if (og < 0) {
      microTerms.push(_atWattTerm(name, -og, "DP38 负值（三方倒灌）"));
    }
    const o = typeof classifyOwnerWorkModel === "function" ? classifyOwnerWorkModel(d) : null;
    const cat = o && typeof _atCat === "function" ? _atCat(o.label) : "";
    if (cat === "chg1") {
      chg1Terms.push(_atWattTerm(`${name}[${o.label}]`, o.chgCapW, "chgCapW"));
    }
    if (cat === "cc" || cat === "candis") {
      disTerms.push(_atWattTerm(`${name}[${o.label}]`, o.dchgCapW, "dchgCapW"));
    }
  }
  const microSum = expect.agg?.microSum;
  const tpvIsManual = expect.tpv != null && Number(expect.tpv) !== Number(microSum || 0);
  return {
    chg1Need: expect.chg1Need,
    disCap: expect.disCap,
    tpv: expect.tpv,
    gridBuyLimit: expect.gridBuyLimit,
    chg2Suppressed: !!expect.chg2Suppressed,
    supp2c1: !!expect.supp2c1,
    supp2c2: !!expect.supp2c2,
    agg: expect.agg ? { ...expect.agg } : null,
    pvTerms,
    loadTerms,
    microTerms,
    chg1Terms,
    disTerms,
    tpvSource: tpvIsManual ? "手动 #atTpv" : "默认 = bypass 负值合计 microSum",
  };
}

/** Min simultaneous AC charge & discharge (W) to flag 边充边放 */
const AT_L3_BOTH_EPS_W = 50;

/**
 * @brief Family-level L3: reverse flow + AC both-way charge/discharge
 * @param[in] flow from _atHomeFlow
 * @return l3 snapshot
 * @note gridW>0=取电, gridW<0=馈网(逆流)；与报告页流向文案一致
 */
function _atEvalFamilyL3(flow) {
  const f = flow || {};
  const gridW = f.gridW == null || !Number.isFinite(Number(f.gridW)) ? null : Number(f.gridW);
  const actChg = Math.max(0, Math.round(Number(f.actChg) || 0));
  const actDchg = Math.max(0, Math.round(Number(f.actDchg) || 0));
  const reverseFlow = gridW != null && gridW < 0;
  const reverseW = reverseFlow ? Math.round(-gridW) : 0;
  const reversePass = gridW == null ? null : !reverseFlow;
  const bothWay = actChg > AT_L3_BOTH_EPS_W && actDchg > AT_L3_BOTH_EPS_W;
  const bothPass = !bothWay;
  const pass = reversePass !== false && bothPass;
  return {
    gridW,
    gridKnown: gridW != null,
    actChg,
    actDchg,
    reverseFlow,
    reverseW,
    reversePass,
    bothWay,
    bothPass,
    bothEps: AT_L3_BOTH_EPS_W,
    pass,
  };
}

/**
 * @brief Foldable section shell for L1/L2/L3
 */
function _atChkFoldSecHtml(no, title, hint, bodyHtml, opts) {
  opts = opts || {};
  const fail = !!opts.fail;
  const open = opts.open !== false;
  const badge = opts.badge || "";
  return `<section class="at-chk-sec ${fail ? "is-fail" : ""} ${open ? "" : "is-collapsed"}" data-chk-fold-sec="1">` +
    `<button type="button" class="at-chk-sec-head at-chk-fold-hit" data-chk-fold="1" aria-expanded="${open ? "true" : "false"}">` +
      `<span class="at-chk-sec-no">${escapeHtml(String(no))}</span>` +
      `<b>${escapeHtml(title)}</b>` +
      (hint ? `<span class="hint">${hint}</span>` : "") +
      badge +
      `<span class="at-chk-fold-chevron" aria-hidden="true"></span>` +
    `</button>` +
    `<div class="at-chk-sec-body">${bodyHtml}</div>` +
  `</section>`;
}

/**
 * @brief Per-layer pass/fail counts for checker summary bar
 * @param[in] results checker rows
 * @param[in] l3 optional family L3
 * @return stage stats object
 */
function _atIsL1Row(r) {
  return r && r.role !== "peer";
}

function _atCheckerStageStats(results, l3) {
  const list = results || [];
  const l1List = list.filter(_atIsL1Row);
  const total = list.length;
  const issueFail = list.filter((r) => !!r.error).length;
  const l1Fail = l1List.filter((r) => !r.error && !r.hitTarget).length;
  const l1Ok = l1List.filter((r) => !r.error && r.hitTarget).length;
  const l2Judged = list.filter((r) => !r.error && r.masterPass !== null);
  const l2Fail = l2Judged.filter((r) => r.masterPass === false).length;
  const l2Ok = l2Judged.filter((r) => r.masterPass === true).length;
  const l2Ref = list.filter((r) => !r.error && r.masterPass === null).length;
  const pass = list.filter((r) => r.pass).length;
  const l3Fail = l3 && l3.pass === false ? 1 : 0;
  const deviceFail = total - pass;
  return {
    total,
    issueFail,
    l1Fail,
    l1Ok,
    l2Fail,
    l2Ok,
    l2Ref,
    l2Judged: l2Judged.length,
    l3Fail,
    l3Pass: l3 ? l3.pass !== false : null,
    pass,
    overallFail: deviceFail + l3Fail,
  };
}

/**
 * @brief Which layer caused failure for one checker row
 * @param[in] r result row
 * @return issue | l1 | l2 | ok
 */
function _atResultFailStage(r) {
  if (r?.error) {
    return "issue";
  }
  if (_atIsL1Row(r) && !r?.hitTarget) {
    return "l1";
  }
  if (r?.masterPass === false) {
    return "l2";
  }
  return "ok";
}

function _atCheckerStageChip(label, formula, state, detail) {
  const stateCls = state === "fail" ? "is-fail" : (state === "skip" ? "is-skip" : "is-ok");
  const badge = state === "fail"
    ? `<span class="at-badge at-fail">失败</span>`
    : (state === "skip"
      ? `<span class="at-badge at-skip">跳过/参考</span>`
      : `<span class="at-badge at-pass">通过</span>`);
  return `<div class="at-stage-chip ${stateCls}">` +
    `<div class="at-stage-chip-head"><span class="at-stage-chip-title">${escapeHtml(label)}</span>${badge}</div>` +
    `<div class="at-stage-chip-formula">${formula}</div>` +
    (detail ? `<div class="at-stage-chip-detail">${detail}</div>` : "") +
  `</div>`;
}

/**
 * @brief Top summary: which stage failed at a glance
 * @param[in] stats from _atCheckerStageStats
 * @return html
 */
function _atCheckerStageBarHtml(stats) {
  if (!stats || !stats.total) {
    return "";
  }
  const issueState = stats.issueFail ? "fail" : "ok";
  const l1State = stats.issueFail ? "skip" : (stats.l1Fail ? "fail" : "ok");
  const l2State = stats.issueFail ? "skip" : (stats.l2Fail ? "fail" : "ok");
  const overallState = stats.overallFail ? "fail" : "ok";
  return `<div class="at-checker-stage-bar">` +
    _atCheckerStageChip(
      "Layer 0 · 下发",
      "issueDevice 成功",
      issueState,
      stats.issueFail ? `${stats.issueFail}/${stats.total} 台下发失败` : `${stats.total} 台已下发`
    ) +
    `<span class="at-stage-arrow">→</span>` +
    _atCheckerStageChip(
      "L1 · 从机工况",
      "hitTarget = (读回态 === 目标态)；读回态 = MCU if/else 首次命中（S1故障/bat0 → … → S8 SoC≤备用−5 充电2 → …）",
      l1State,
      stats.issueFail
        ? "下发失败，未检查"
        : (stats.l1Fail ? `${stats.l1Fail}/${stats.total} 台工况未中` : `${stats.l1Ok}/${stats.total} 台命中`)
    ) +
    `<span class="at-stage-arrow">→</span>` +
    _atCheckerStageChip(
      "L2 · 主机分配",
      "①方向一致：实际order==期望order；②功率落在允许区间[下限,上限]内；两项都真才通过",
      l2State,
      stats.issueFail
        ? "未检查"
        : (stats.l2Fail
          ? `${stats.l2Fail}/${stats.l2Judged} 台硬判失败`
          : (stats.l2Judged
            ? `${stats.l2Ok}/${stats.l2Judged} 台通过`
            : `${stats.l2Ref} 台仅参考（不硬判）`))
    ) +
    `<span class="at-stage-arrow">→</span>` +
    _atCheckerStageChip(
      "综合",
      "L1 命中 且 L2 ≠ 失败（L2 参考不计失败）",
      overallState,
      stats.overallFail ? `${stats.overallFail}/${stats.total} 台未通过` : `${stats.pass}/${stats.total} 台通过`
    ) +
  `</div>`;
}

/**
 * @brief Cluster context formulas shown under checker stage bar
 * @param[in] expectMeta brief expect snapshot
 * @return html
 */
function _atFormulaLine(name, formula, subst, result, extra = {}) {
  const tone = extra.tone || "";
  const span = extra.span ? " is-wide" : "";
  const action = extra.action || "";
  return `<div class="at-fx-card${span}${tone ? ` is-${tone}` : ""}">` +
    `<div class="at-fx-name">${escapeHtml(name)}</div>` +
    (result != null && result !== "" ? `<div class="at-fx-res">${escapeHtml(String(result))}</div>` : "") +
    (action ? `<div class="at-fx-action"><span class="at-fx-action-k">主机动作</span>${escapeHtml(action)}</div>` : "") +
    `<div class="at-fx-eq">${escapeHtml(formula)}</div>` +
    (subst ? `<div class="at-fx-sub">${escapeHtml(subst)}</div>` : "") +
  `</div>`;
}

/**
 * @brief Host DP98 action table under current chg2-suppress flag
 * @param[in] suppressed whether charge-2 suppress is on
 * @return html wide card
 */
function _atL2ActionSheetHtml(suppressed) {
  const rows = suppressed
    ? [
      ["充电1", "下发「充」", "强制充，不受抑制"],
      ["充电2", "压成「待机」", "不给充"],
      ["可放 / 可充可放", "压成「待机」", "也不下发放电"],
      ["放电", "下发「放」", "防弃光"],
      ["可充", "不硬判", "看家庭盈余"],
      ["禁充禁放", "下发「待机」", "0W"],
    ]
    : [
      ["充电1", "下发「充」", "强制充"],
      ["充电2", "下发「充」", "允许充"],
      ["可放 / 可充可放", "不硬判", "看家庭盈余"],
      ["放电", "下发「放」", "防弃光"],
      ["可充", "不硬判", "看家庭盈余"],
      ["禁充禁放", "下发「待机」", "0W"],
    ];
  const body = rows.map(([state, act, why]) =>
    `<div class="at-fx-act-row">` +
      `<span class="at-fx-act-state">${escapeHtml(state)}</span>` +
      `<span class="at-fx-act-do">${escapeHtml(act)}</span>` +
      `<span class="at-fx-act-why">${escapeHtml(why)}</span>` +
    `</div>`
  ).join("");
  return `<div class="at-chk-action-sheet ${suppressed ? "is-warn" : "is-ok"}">` +
    `<div class="at-chk-action-cap">${suppressed ? "充2抑制 = 开 → 各态主机动作" : "充2抑制 = 关 → 各态主机动作"}</div>` +
    `<div class="at-fx-act-table">${body}</div>` +
  `</div>`;
}

function _atCheckerClusterHtml(expectMeta) {
  const wrap = (inner) =>
    `<div class="at-checker-cluster">` +
      `<div class="at-fx-title">L2 簇级公式（整家庭，不只被测机）</div>` +
      `<div class="at-fx-grid">${inner}</div>` +
    `</div>`;
  if (!expectMeta) {
    return wrap(
      _atFormulaLine("PV总", "Σ 各机 DP20 pv_power_total", "", "—", { action: "只作家庭能量背景，不直接改 DP98" }) +
      _atFormulaLine("Bypass负载", "Σ 各机 DP38（>0 的部分）", "", "—", { action: "只作背景" }) +
      _atFormulaLine("三方光伏 tpv", "手动 #atTpv，缺省 = Σ |DP38<0|", "", "—", { action: "参与充2抑制不等式" }) +
      _atFormulaLine("充1需求", "Σ 读回态=充电1 的 chgCapW", "", "—", { action: "需求越大，越容易触发充2抑制" }) +
      _atFormulaLine("可放总", "Σ 读回态∈{可充可放,可放} 的 dchgCapW", "", "—", { action: "可放能力不够 → 抑制充2" }) +
      _atFormulaLine("充2抑制", "chg1Need > disCap+tpv  或  chg1Need > gridBuyLimit+tpv", "", "—", {
        action: "开：充电2/可放/可充可放 → 待机；关：充电2 → 充",
        span: true,
      })
    );
  }
  const gridConfigured = expectMeta.gridBuyLimit != null && expectMeta.gridBuyLimit !== "";
  const gridNum = gridConfigured ? Number(expectMeta.gridBuyLimit) : NaN;
  const gridTxt = Number.isFinite(gridNum) ? `${gridNum}W` : "未配置（条件1不计）";
  const pvSub = _atJoinWattTerms(expectMeta.pvTerms, true);
  const loadSub = _atJoinWattTerms(expectMeta.loadTerms);
  const microSub = _atJoinWattTerms(expectMeta.microTerms);
  const chg1Sub = _atJoinWattTerms(expectMeta.chg1Terms);
  const disSub = _atJoinWattTerms(expectMeta.disTerms);
  const c1 = Number(expectMeta.chg1Need) || 0;
  const dis = Number(expectMeta.disCap) || 0;
  const tpv = Number(expectMeta.tpv) || 0;
  const left2 = `${c1} > ${dis} + ${tpv} → ${c1} > ${dis + tpv}`;
  const left1 = Number.isFinite(gridNum)
    ? `${c1} > ${gridNum} + ${tpv} → ${c1} > ${gridNum + tpv}`
    : "电网购电限未配置，条件1不计";
  const suppressRes = expectMeta.chg2Suppressed
    ? `是（${expectMeta.supp2c2 ? "条件2" : "条件1"}）`
    : "否";
  const suppressAction = expectMeta.chg2Suppressed
    ? "主机动作：凡读回「充电2」→ DP98 下发待机(不充)；凡读回「可放/可充可放」→ 也不下发放电，压成待机。充电1仍强制充，放电仍可放。"
    : "主机动作：读回「充电2」→ 允许下发充；「可放/可充可放」方向不硬判（看家庭盈余）。";
  return wrap(
    _atFormulaLine("PV总", "Σ 各机 DP20 pv_power_total", pvSub, `${expectMeta.agg?.pvTotal ?? 0}W`, {
      action: "背景量：描述家庭光伏总量，不直接改某台 DP98",
    }) +
    _atFormulaLine("Bypass负载", "Σ 各机 DP38（仅 >0）", loadSub, `${expectMeta.agg?.loadSum ?? 0}W`, {
      action: "背景量：家庭旁路负载合计",
    }) +
    _atFormulaLine("三方光伏 tpv", "手动 #atTpv；缺省 Σ |DP38<0|", `${expectMeta.tpvSource || ""} · ${microSub}`, `${tpv}W`, {
      action: "参与抑制不等式：可抵消一部分充1需求",
    }) +
    _atFormulaLine("充1需求", "Σ 充电1.chgCapW", chg1Sub, `${c1}W`, {
      action: c1 > 0
        ? `行动含义：家里有充电1 共需约 ${c1}W，主机必须优先满足这些机充电`
        : "行动含义：当前没有充电1，抑制不易触发",
    }) +
    _atFormulaLine("可放总", "Σ {可充可放,可放}.dchgCapW", disSub, `${dis}W`, {
      action: dis > 0
        ? `行动含义：可用放电余量约 ${dis}W，用来支撑充1；不够就会抑制充2`
        : "行动含义：没有可放余量 → 充1 只能靠电网/三方，易触发充2抑制",
    }) +
    _atFormulaLine("电网购电限", "手动 #atGridBuyLimit（非设备 DP）", "", gridTxt, {
      action: Number.isFinite(gridNum)
        ? `行动含义：家庭购电最多 ${gridNum}W，超过则条件1抑制充2`
        : "行动含义：未配置则条件1不参与判定",
    }) +
    _atFormulaLine("抑制条件2", "chg1Need > disCap + tpv", left2, expectMeta.supp2c2 ? "真" : "假", {
      tone: expectMeta.supp2c2 ? "warn" : "ok",
      action: expectMeta.supp2c2
        ? "行动：可放+三方撑不住充1 → 打开充2抑制"
        : "行动：可放+三方够用 → 本条件不抑制",
    }) +
    _atFormulaLine("抑制条件1", "chg1Need > gridBuyLimit + tpv", left1, expectMeta.supp2c1 ? "真" : "假", {
      tone: expectMeta.supp2c1 ? "warn" : "ok",
      action: expectMeta.supp2c1
        ? "行动：购电限+三方撑不住充1 → 打开充2抑制"
        : "行动：本条件未触发（未配置或不成立）",
    }) +
    _atFormulaLine("充2抑制", "supp2c1 || supp2c2", `${!!expectMeta.supp2c1} || ${!!expectMeta.supp2c2}`, suppressRes, {
      tone: expectMeta.chg2Suppressed ? "warn" : "ok",
      action: suppressAction,
      span: true,
    }) +
    _atL2ActionSheetHtml(!!expectMeta.chg2Suppressed) +
    _atFormulaLine(
      "L2 怎么判通过",
      "① 方向：DP98 实际 order 必须等于上表「主机动作」；② 功率：实际功率必须落在「允许功率区间」内（例如充电1 期望400W时，允许 240~700W，不是必须刚好400）",
      "例：期望充/400W，允许区间[240,700]W，实际充/400W → 方向对且400落在区间内 → L2 通过",
      "方向对 + 功率落在允许区间",
      { span: true }
    )
  );
}

function _atCheckerStageBadge(r) {
  const stage = _atResultFailStage(r);
  if (stage === "issue") {
    return `<span class="at-badge at-fail">下发</span>`;
  }
  if (stage === "l1") {
    return `<span class="at-badge at-fail">L1</span>`;
  }
  if (stage === "l2") {
    return `<span class="at-badge at-fail">L2</span>`;
  }
  return `<span class="at-badge at-pass">—</span>`;
}

function _atCheckerL1Cell(r) {
  const formula = r.l1Formula || `hitTarget = (读回态 === 目标态) = (${r.theory || "—"} ${r.hitTarget ? "==" : "!="} ${r.target || "—"})`;
  return `<div class="at-checker-formula">${escapeHtml(formula)}</div>`;
}

function _atCheckerL2BandHtml(r) {
  if (!Array.isArray(r.expBand) || r.expBand.length < 2) {
    return "";
  }
  const lo = Number(r.expBand[0]);
  const hi = Number(r.expBand[1]);
  const act = r.actPower == null ? null : Number(r.actPower);
  const inBand = act != null && Number.isFinite(act) && Number.isFinite(lo) && Number.isFinite(hi)
    && act >= lo && act <= hi;
  let marker = "";
  if (act != null && Number.isFinite(act) && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
    const pct = Math.max(0, Math.min(100, ((act - lo) / (hi - lo)) * 100));
    marker = `<span class="at-band-mark ${inBand ? "is-ok" : "is-fail"}" style="left:${pct}%" title="实际 ${act}W"></span>`;
  }
  return `<div class="at-band-box ${inBand ? "is-ok" : (act == null ? "" : "is-fail")}">` +
    `<div class="at-band-title">允许功率区间（不是单点）</div>` +
    `<div class="at-band-range"><b>${lo}</b>W ～ <b>${hi}</b>W</div>` +
    `<div class="at-band-track">${marker}</div>` +
    `<div class="at-band-act">${act == null
      ? "实际功率：未读到"
      : `实际功率：<b>${act}W</b> ${inBand ? "✓ 落在区间内" : "✗ 超出区间"}`}</div>` +
  `</div>`;
}

function _atCheckerL2Cell(r) {
  if (r.error) {
    return `<span class="hint">下发失败，未检查</span>`;
  }
  if (r.masterPass === null) {
    return `<div class="at-checker-formula hint">${escapeHtml(r.l2Formula || r.masterNote || "参考不硬判")}</div>`;
  }
  const dirOk = r.actOrder === r.expOrder;
  const head =
    `<div class="at-checker-formula">` +
      `① 方向：期望「${escapeHtml(r.expOrder || "—")}」· 实际「${escapeHtml(r.actOrder || "—")}」→ ${dirOk ? "一致" : "不符"}` +
    `</div>` +
    _atCheckerL2BandHtml(r) +
    (r.l2Formula ? `<div class="at-checker-formula hint">${escapeHtml(r.l2Formula)}</div>` : "");
  return head;
}

function _atPassBadge(ok, softLabel, hitAttrs) {
  const attrs = hitAttrs || "";
  if (ok === null) {
    return `<button type="button" class="at-badge at-skip at-pass-hit" ${attrs} title="点击查看判定">${escapeHtml(softLabel || "参考")}</button>`;
  }
  return ok
    ? `<button type="button" class="at-badge at-pass at-pass-hit" ${attrs} title="点击查看怎么算的">通过</button>`
    : `<button type="button" class="at-badge at-fail at-pass-hit" ${attrs} title="点击查看怎么算的">失败</button>`;
}

/**
 * @brief Six home metrics used by L2, with formula + substitution
 * @param[in] expectMeta brief expect snapshot
 * @return metric defs
 */
function _atHomeMetricDefs(expectMeta) {
  const m = expectMeta || {};
  const gridConfigured = m.gridBuyLimit != null && m.gridBuyLimit !== "";
  const gridNum = gridConfigured ? Number(m.gridBuyLimit) : NaN;
  const c1 = Number(m.chg1Need) || 0;
  const dis = Number(m.disCap) || 0;
  const tpv = Number(m.tpv) || 0;
  return [
    {
      id: "pv",
      name: "PV总",
      value: `${m.agg?.pvTotal ?? 0}W`,
      short: "Σ DP20",
      formula: "PV总 = Σ 各机 DP20 pv_power_total",
      subst: _atJoinWattTerms(m.pvTerms, true),
      note: "家庭光伏合计，只作背景，不直接改 DP98",
    },
    {
      id: "bypass",
      name: "Bypass负载",
      value: `${m.agg?.loadSum ?? 0}W`,
      short: "Σ DP38>0",
      formula: "Bypass负载 = Σ 各机 DP38 offgrid1_export_power（仅取 >0）",
      subst: _atJoinWattTerms(m.loadTerms) || "0（没有正 Bypass）",
      note: "旁路口负载合计",
    },
    {
      id: "tpv",
      name: "三方光伏",
      value: `${tpv}W`,
      short: "#atTpv 或 Σ|DP38<0|",
      formula: "tpv = 手动 #atTpv；若未填，则 = Σ |DP38<0|（microSum）",
      subst: `${m.tpvSource || "默认"}；microSum 代入 ${_atJoinWattTerms(m.microTerms) || "0"}`,
      note: "参与充2抑制不等式，可抵消一部分充1需求",
    },
    {
      id: "chg1",
      name: "充1总",
      value: `${c1}W`,
      short: "Σ 充电1.chgCapW",
      formula: "充1总 = Σ 读回态=充电1 的设备 chgCapW",
      subst: _atJoinWattTerms(m.chg1Terms) || "0（当前没有充电1）",
      note: "主机必须优先满足的强充需求",
    },
    {
      id: "dis",
      name: "可放总",
      value: `${dis}W`,
      short: "Σ 可放/可充可放.dchgCapW",
      formula: "可放总 = Σ 读回态∈{可放, 可充可放} 的 dchgCapW",
      subst: _atJoinWattTerms(m.disTerms) || "0（当前没有可放机）",
      note: "用来支撑充1；不够就会触发充2抑制",
    },
    {
      id: "grid",
      name: "电网购电限",
      value: Number.isFinite(gridNum) ? `${gridNum}W` : "未配置",
      short: "#atGridBuyLimit",
      formula: "电网购电限 = 手动 #atGridBuyLimit（固件规划中，不是设备 DP）",
      subst: Number.isFinite(gridNum) ? `已配置 ${gridNum}W` : "未配置 → 抑制条件1不计",
      note: "仅用于抑制条件1：充1总 > 购电限 + 三方",
    },
  ];
}

/**
 * @brief L1 section: only devices this case actually targeted
 */
function _atCheckerL1SectionHtml(results) {
  const rows = _atSortChecker((results || []).filter(_atIsL1Row)).map((r) => {
    const ok = !r.error && !!r.hitTarget;
    const fail = !ok;
    const uid = r.uid || r.deviceId || "";
    return `<tr class="${fail ? "is-fail" : ""}">` +
      `<td>` +
        `<div class="at-dev-name">${escapeHtml(r.device || "—")}</div>` +
        (r.deviceId ? `<div class="at-dev-id mono">${escapeHtml(r.deviceId)}</div>` : "") +
      `</td>` +
      `<td>${_atModelChipHtml(r.target)}</td>` +
      `<td>${_atModelChipHtml(r.theory)}${r.error ? `<div class="at-fail-text">${escapeHtml(r.error)}</div>` : ""}</td>` +
      `<td>${_atPassBadge(r.error ? false : ok, null, `data-chk-pass="l1" data-uid="${escapeAttr(String(uid))}"`)}</td>` +
    `</tr>`;
  }).join("");
  const l1List = (results || []).filter(_atIsL1Row);
  const l1Fail = l1List.some((r) => r.error || !r.hitTarget);
  const body =
    `<table class="at-checker-table at-chk-simple"><thead><tr>` +
      `<th>设备</th><th>目标</th><th>读回</th><th>通过？</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`;
  return _atChkFoldSecHtml(
    "一",
    "L1 · 设备工况",
    "只看本用例目标机 · 点「通过？」弹框",
    body,
    {
      fail: l1Fail,
      open: l1Fail || !l1List.length,
      badge: l1Fail
        ? `<span class="at-badge at-fail">有失败</span>`
        : `<span class="at-badge at-pass">通过</span>`,
    }
  );
}

/**
 * @brief L3 family checks: reverse flow + AC both-way
 */
function _atCheckerL3SectionHtml(l3) {
  if (!l3) {
    return _atChkFoldSecHtml(
      "三",
      "L3 · 家庭异常",
      "本帧无家庭流向，无法判定",
      `<p class="hint">缺少 homeFlow（旧报告常见）。重新跑测后会有逆流 / 边充边放结果。</p>`,
      { open: false, badge: `<span class="at-badge at-skip">跳过</span>` }
    );
  }
  const revPass = l3.reversePass;
  const bothPass = l3.bothPass;
  const revBadge = revPass === null
    ? _atPassBadge(null, "无电表", `data-chk-l3="reverse"`)
    : _atPassBadge(!!revPass, null, `data-chk-l3="reverse"`);
  const bothBadge = _atPassBadge(!!bothPass, null, `data-chk-l3="both"`);
  const gridTxt = l3.gridKnown
    ? (l3.gridW > 0 ? `取电 ${l3.gridW}W` : (l3.gridW < 0 ? `馈网 ${l3.reverseW}W` : `0W`))
    : "未读到电表/LAN";
  const body =
    `<table class="at-checker-table at-chk-simple"><thead><tr>` +
      `<th>检查项</th><th>读数</th><th>判定式</th><th>通过？</th>` +
    `</tr></thead><tbody>` +
      `<tr class="${revPass === false ? "is-fail" : ""}">` +
        `<td><div class="at-dev-name">逆流（馈网）</div><div class="hint">家庭并网点向外送电</div></td>` +
        `<td class="mono">${escapeHtml(gridTxt)}</td>` +
        `<td class="hint">gridW &lt; 0 → 逆流失败；无电表则跳过</td>` +
        `<td>${revBadge}</td>` +
      `</tr>` +
      `<tr class="${bothPass === false ? "is-fail" : ""}">` +
        `<td><div class="at-dev-name">AC 边充边放</div><div class="hint">集群 DP98 同时有充有放</div></td>` +
        `<td class="mono">充 ${l3.actChg}W · 放 ${l3.actDchg}W</td>` +
        `<td class="hint">充 &gt; ${l3.bothEps}W 且 放 &gt; ${l3.bothEps}W → 失败</td>` +
        `<td>${bothBadge}</td>` +
      `</tr>` +
    `</tbody></table>`;
  const fail = l3.pass === false;
  return _atChkFoldSecHtml(
    "三",
    "L3 · 家庭异常",
    "逆流 + AC边充边放 · 点「通过？」弹框",
    body,
    {
      fail,
      open: true,
      badge: fail
        ? `<span class="at-badge at-fail">家庭异常</span>`
        : `<span class="at-badge at-pass">正常</span>`,
    }
  );
}

/**
 * @brief L2.1 home metrics — click card to see formula
 */
function _atCheckerL2HomeHtml(expectMeta) {
  const defs = _atHomeMetricDefs(expectMeta);
  const suppress = expectMeta?.chg2Suppressed
    ? `<button type="button" class="at-badge at-fail at-pass-hit" data-chk-home="suppress" title="点击查看抑制怎么算">充2抑制开</button>`
    : `<button type="button" class="at-badge at-pass at-pass-hit" data-chk-home="suppress" title="点击查看抑制怎么算">充2抑制关</button>`;
  return `<div class="at-chk-subhead at-chk-home-hit" data-chk-home="all" role="button" tabindex="0" title="点击弹框查看公式">` +
      `<span class="at-chk-step">1</span>家庭数据` +
      `<span class="hint">共 ${defs.length} 种 · 点这里或卡片弹框看公式</span> ${suppress}</div>` +
    `<div class="at-chk-home-grid">` +
      defs.map((item) =>
        `<button type="button" class="at-chk-home-card" data-chk-home="${escapeAttr(item.id)}" title="点击查看怎么算出来的">` +
          `<div class="k">${escapeHtml(item.name)} <span class="at-chk-more">?</span></div>` +
          `<div class="v">${escapeHtml(String(item.value))}</div>` +
          `<div class="s">${escapeHtml(item.short)}</div>` +
        `</button>`
      ).join("") +
    `</div>`;
}

/**
 * @brief Build popup lines explaining how L2 power band is derived
 * @param[in] r checker row
 * @param[in] expectMeta optional home expect brief
 * @return explain line objects
 */
function _atBandExplainLines(r, expectMeta) {
  const cat = r.bandCat || (typeof _atCat === "function" ? _atCat(r.theory) : "") || "";
  const chg = Number(r.chgCapW);
  const dchg = Number(r.dchgCapW);
  const lo = Array.isArray(r.expBand) ? r.expBand[0] : null;
  const hi = Array.isArray(r.expBand) ? r.expBand[1] : null;
  const suppressed = !!expectMeta?.chg2Suppressed;
  const lines = [
    { kind: "note", text: "区间不是固件 DP，是检查器按读回工况给的「允许功率容差」。实际落在区间内即过，不必等于期望点位。" },
  ];
  if (cat === "chg1") {
    const loCalc = Number.isFinite(chg) ? Math.max(0, Math.round(chg * 0.6)) : "?";
    const hiCalc = Number.isFinite(chg) ? chg + 300 : "?";
    lines.push(
      { kind: "eq", text: "充电1：下限 = max(0, round(chgCapW × 0.6))；上限 = chgCapW + 300" },
      { kind: "sub", text: Number.isFinite(chg) ? `chgCapW=${chg}W → [${loCalc}, ${hiCalc}]` : "缺 chgCapW" },
      { kind: "note", text: "充电1强制充，容差较宽（60%～+300W）。" }
    );
  } else if (cat === "chg2" && suppressed) {
    lines.push(
      { kind: "eq", text: "充电2 + 充2抑制开：固定区间 [0, 150]" },
      { kind: "sub", text: "期望待机 0W，允许少量抖动 ≤150W" },
      { kind: "note", text: "抑制开时主机不下发充电2。" }
    );
  } else if (cat === "chg2") {
    const loCalc = Number.isFinite(chg) ? Math.max(0, Math.round(chg * 0.4)) : "?";
    const hiCalc = Number.isFinite(chg) ? chg + 300 : "?";
    lines.push(
      { kind: "eq", text: "充电2（未抑制）：下限 = max(0, round(chgCapW × 0.4))；上限 = chgCapW + 300" },
      { kind: "sub", text: Number.isFinite(chg) ? `chgCapW=${chg}W → [${loCalc}, ${hiCalc}]` : "缺 chgCapW" },
      { kind: "note", text: "比充电1更松（40% 起）。" }
    );
  } else if (cat === "disabled") {
    lines.push(
      { kind: "eq", text: "禁充禁放：固定区间 [0, 120]" },
      { kind: "sub", text: "期望待机 0W" }
    );
  } else if (cat === "discharge") {
    const hiCalc = Number.isFinite(dchg) ? dchg + 300 : "?";
    lines.push(
      { kind: "eq", text: "放电：下限 = 0；上限 = dchgCapW + 300" },
      { kind: "sub", text: Number.isFinite(dchg) ? `dchgCapW=${dchg}W → [0, ${hiCalc}]` : "缺 dchgCapW" }
    );
  } else if ((cat === "cc" || cat === "candis") && suppressed) {
    lines.push(
      { kind: "eq", text: "可放/可充可放 + 充2抑制开：固定区间 [0, 150]" },
      { kind: "sub", text: "一充一放：抑制开时对应放电也不下发，期望待机" }
    );
  } else if (cat === "cc" || cat === "candis" || cat === "canchg") {
    lines.push(
      { kind: "eq", text: "可放/可充可放/可充：方向依赖家庭盈余，L2 不硬判" },
      { kind: "sub", text: lo != null && hi != null ? `示意区间 [${lo}, ${hi}]（默认占位，不参与成败）` : "无区间" },
      { kind: "note", text: "标「参考」，实际功率不判过/不过。" }
    );
  } else {
    lines.push(
      { kind: "eq", text: r.bandFormula || "本态未建模硬判区间" },
      { kind: "sub", text: lo != null && hi != null ? `当前 [${lo}, ${hi}]` : "—" }
    );
  }
  if (lo != null && hi != null) {
    const act = r.actPower;
    const hasAct = act != null && Number.isFinite(Number(act));
    const inBand = hasAct && Number(act) >= lo && Number(act) <= hi;
    lines.push(
      { kind: "res", text: `本机区间 ${lo} ~ ${hi} W` + (hasAct ? ` · 实际 ${Math.round(Number(act))}W → ${inBand ? "落在区间内" : "在区间外"}` : " · 无实测") }
    );
  }
  return lines;
}

/**
 * @brief Horizontal range bar with actual-power marker (on-bar vs off-bar)
 * @param[in] lo band min watts
 * @param[in] hi band max watts
 * @param[in] act actual watts or null
 * @param[in] skipped true when L2 not judged
 * @param[in] hitAttrs optional click attrs for popup
 * @return html
 */
function _atPowerBandBarHtml(lo, hi, act, skipped, hitAttrs) {
  if (lo == null || hi == null || !Number.isFinite(Number(lo)) || !Number.isFinite(Number(hi))) {
    return `<span class="hint">—</span>`;
  }
  const min = Number(lo);
  const max = Number(hi);
  const span = Math.max(1, max - min);
  const g = 16;
  const bandW = 100 - g * 2;
  let pct = null;
  let inBand = false;
  let hasAct = act != null && act !== "" && Number.isFinite(Number(act));
  if (hasAct) {
    const w = Number(act);
    inBand = w >= min && w <= max;
    if (inBand) {
      pct = g + bandW * ((w - min) / span);
    } else if (w < min) {
      const t = Math.min(1, (min - w) / span);
      pct = Math.max(2, g - 4 - t * (g - 6));
    } else {
      const t = Math.min(1, (w - max) / span);
      pct = Math.min(98, 100 - g + 4 + t * (g - 6));
    }
  }
  const cls = skipped ? "is-skip" : (hasAct ? (inBand ? "is-ok" : "is-out") : "is-skip");
  const title = hasAct
    ? `允许 ${min}~${max}W · 实际 ${Number(act)}W · ${inBand ? "在区间内" : "在区间外"} · 点击看公式`
    : `允许 ${min}~${max}W · 无实际功率 · 点击看公式`;
  const attrs = hitAttrs || "";
  return `<button type="button" class="at-pbar ${cls} at-pbar-hit" ${attrs} title="${escapeAttr(title)}">` +
    `<div class="at-pbar-track">` +
      `<i class="at-pbar-axis"></i>` +
      `<i class="at-pbar-band"></i>` +
      (pct == null ? "" : `<i class="at-pbar-dot ${inBand ? "is-in" : "is-out"}" style="left:${pct.toFixed(1)}%"></i>`) +
    `</div>` +
    `<div class="at-pbar-lab">` +
      `<span>${min}</span>` +
      `<span class="act">${hasAct ? `${Math.round(Number(act))}W${inBand ? "" : " · 区间外"}` : (skipped ? "不硬判" : "无实测")}</span>` +
      `<span>${max}</span>` +
    `</div>` +
  `</button>`;
}
function _atCheckerL2ExecHtml(results) {
  const list = results || [];
  const judged = list.filter((r) => !r.error && r.masterPass !== null);
  const failN = judged.filter((r) => r.masterPass === false).length;
  const okN = judged.filter((r) => r.masterPass === true).length;
  const refN = list.filter((r) => !r.error && r.masterPass === null).length;
  const peerN = list.filter((r) => r.role === "peer").length;
  const rows = list.map((r) => {
    const skipped = !!r.error || r.masterPass === null;
    const dirOk = !skipped && r.actOrder === r.expOrder;
    const lo = Array.isArray(r.expBand) ? r.expBand[0] : null;
    const hi = Array.isArray(r.expBand) ? r.expBand[1] : null;
    const act = r.actPower;
    const uid = r.uid || r.deviceId || "";
    const passCell = r.error
      ? _atPassBadge(false, null, `data-chk-pass="l2" data-uid="${escapeAttr(String(uid))}"`)
      : (r.masterPass === null
        ? _atPassBadge(null, "参考", `data-chk-pass="l2" data-uid="${escapeAttr(String(uid))}"`)
        : _atPassBadge(!!r.masterPass, null, `data-chk-pass="l2" data-uid="${escapeAttr(String(uid))}"`));
    const dirTxt = r.error
      ? "—"
      : (r.masterPass === null
        ? `<span class="hint">${escapeHtml(r.masterNote || "不硬判")}</span>`
        : `<span class="${dirOk ? "" : "at-fail-text"}">期望 ${escapeHtml(r.expOrder || "—")} → 实际 ${escapeHtml(r.actOrder || "—")}</span>`);
    const roleBadge = r.role === "peer"
      ? `<span class="at-badge at-skip" title="本用例未改这台，但仍按整家庭期望核对 DP98">旁观</span>`
      : `<span class="at-badge at-pass" title="本用例指定目标机">目标</span>`;
    return `<tr class="${r.masterPass === false || r.error ? "is-fail" : ""}">` +
      `<td>` +
        `<div class="at-dev-name">${escapeHtml(r.device || "—")} ${roleBadge}</div>` +
        (r.deviceId ? `<div class="at-dev-id mono">${escapeHtml(r.deviceId)}</div>` : "") +
        `${_atModelChipHtml(r.theory)}` +
      `</td>` +
      `<td>${dirTxt}</td>` +
      `<td class="at-pbar-cell">${_atPowerBandBarHtml(lo, hi, act, skipped, `data-chk-band="1" data-uid="${escapeAttr(String(uid))}"`)}</td>` +
      `<td>${passCell}</td>` +
    `</tr>`;
  }).join("");
  return `<div class="at-chk-subhead"><span class="at-chk-step">3</span>设备执行` +
      `<span class="hint">整家庭 ${list.length} 台` +
        (peerN ? ` · 旁观 ${peerN}` : "") +
        ` · 硬判 ${okN} 过 / ${failN} 败` +
        (refN ? ` · 参考 ${refN}` : "") +
        ` · 点功率区间 /「通过？」弹框</span></div>` +
    `<table class="at-checker-table at-chk-simple"><thead><tr>` +
      `<th>设备</th><th>方向</th><th>功率区间 <span class="hint">点看公式</span></th><th>通过？</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`;
}

const _atChkExplainStore = Object.create(null);

let _atChkExplainDlgBound = false;

function _atEnsureChkExplainDlg() {
  const dlg = document.getElementById("dlgChkExplain");
  if (!dlg) {
    return null;
  }
  if (!_atChkExplainDlgBound) {
    _atChkExplainDlgBound = true;
    document.getElementById("btnChkExplainClose")?.addEventListener("click", () => {
      if (dlg.open) {
        dlg.close();
      }
    });
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg) {
        dlg.close();
      }
    });
  }
  return dlg;
}

function _atShowChkExplain(_wrap, title, lines) {
  const dlg = _atEnsureChkExplainDlg();
  const titleEl = document.getElementById("chkExplainTitle");
  const body = document.getElementById("chkExplainBody");
  if (!dlg || !body) {
    return;
  }
  if (titleEl) {
    titleEl.textContent = title;
  }
  body.innerHTML = _atRenderExplainBody(title, lines);
  if (typeof dlg.showModal === "function") {
    if (dlg.open) {
      dlg.close();
    }
    dlg.showModal();
  } else {
    dlg.setAttribute("open", "");
  }
}

function _atRenderExplainBody(title, lines) {
  return `<div class="at-chk-explain-title-line">${escapeHtml(title)}</div>` +
    lines.map((line) => {
      if (line.kind === "eq") {
        return `<div class="at-chk-fx-eq">${escapeHtml(line.text)}</div>`;
      }
      if (line.kind === "sub") {
        return `<div class="at-chk-fx-sub"><span class="lab">代入</span>${escapeHtml(line.text)}</div>`;
      }
      if (line.kind === "res") {
        return `<div class="at-chk-fx-res"><span class="lab">结果</span>${escapeHtml(line.text)}</div>`;
      }
      return `<div class="at-chk-fx-note">${escapeHtml(line.text)}</div>`;
    }).join("");
}

function _atExplainHomeMetric(wrap, metricId) {
  const ctx = _atChkExplainStore[wrap.getAttribute("data-chk-id")];
  const defs = ctx?.metrics || [];
  if (metricId === "all") {
    const lines = [
      { kind: "note", text: `家庭量共 ${defs.length} 种。点各卡片可单独看代入；点「充2抑制」看抑制判定。` },
      ...defs.flatMap((item, i) => [
        { kind: "eq", text: `${i + 1}. ${item.name}：${item.formula}` },
        { kind: "sub", text: `${item.subst || "—"} → ${item.value}` },
        { kind: "note", text: item.note || "" },
      ]),
    ];
    _atShowChkExplain(wrap, `家庭数据 · 共 ${defs.length} 种`, lines);
    return;
  }
  if (metricId === "suppress") {
    const m = ctx?.expectMeta || {};
    const c1 = Number(m.chg1Need) || 0;
    const dis = Number(m.disCap) || 0;
    const tpv = Number(m.tpv) || 0;
    const gridConfigured = m.gridBuyLimit != null && m.gridBuyLimit !== "";
    const gridNum = gridConfigured ? Number(m.gridBuyLimit) : NaN;
    const lines = [
      { kind: "note", text: `家庭量共 6 种；充2抑制由其中「充1总 / 可放总 / 三方 / 购电限」算出。` },
      { kind: "eq", text: "条件2：充1总 > 可放总 + 三方光伏" },
      { kind: "sub", text: `${c1} > ${dis} + ${tpv} → ${c1} > ${dis + tpv} → ${m.supp2c2 ? "真" : "假"}` },
      { kind: "eq", text: "条件1：充1总 > 电网购电限 + 三方光伏（购电限未配置则跳过）" },
      {
        kind: "sub",
        text: Number.isFinite(gridNum)
          ? `${c1} > ${gridNum} + ${tpv} → ${c1} > ${gridNum + tpv} → ${m.supp2c1 ? "真" : "假"}`
          : "购电限未配置 → 条件1 = 假",
      },
      { kind: "eq", text: "充2抑制 = 条件1 || 条件2" },
      { kind: "res", text: m.chg2Suppressed ? "开 → 充电2/可放/可充可放 压成待机；充电1仍强制充" : "关 → 充电2 允许充" },
    ];
    _atShowChkExplain(wrap, "充2抑制怎么算", lines);
    return;
  }
  const item = defs.find((row) => row.id === metricId);
  if (!item) {
    return;
  }
  const idx = defs.findIndex((row) => row.id === metricId) + 1;
  _atShowChkExplain(wrap, `${item.name} · 第 ${idx} / ${defs.length} 种家庭量`, [
    { kind: "eq", text: item.formula },
    { kind: "sub", text: item.subst || "—" },
    { kind: "res", text: String(item.value) },
    { kind: "note", text: item.note || "" },
  ]);
}

function _atL2RosterLine(r) {
  const role = r.role === "peer" ? "旁观" : "目标";
  if (r.error) {
    return `${r.device || "—"}[${role}] 下发失败`;
  }
  if (r.masterPass === null) {
    return `${r.device || "—"}[${role}] 参考 · ${r.theory || "—"} · ${r.masterNote || "不硬判"}`;
  }
  const mark = r.masterPass ? "通过" : "失败";
  return `${r.device || "—"}[${role}] ${mark} · 读回 ${r.theory || "—"} · 期望 ${r.expOrder || "—"}${r.expPower == null ? "" : `/${r.expPower}W`} · 实际 ${r.actOrder || "—"}${r.actPower == null ? "" : `/${r.actPower}W`}`;
}

function _atFindChkResult(list, uid, idx) {
  if (uid != null && uid !== "") {
    const hit = (list || []).find((row) => String(row.uid || "") === String(uid) || String(row.deviceId || "") === String(uid));
    if (hit) {
      return hit;
    }
  }
  if (idx != null && idx !== "") {
    return (list || [])[Number(idx)] || null;
  }
  return null;
}

function _atExplainPass(wrap, layer, uid, idx) {
  const ctx = _atChkExplainStore[wrap.getAttribute("data-chk-id")];
  const list = ctx?.results || [];
  const r = _atFindChkResult(list, uid, idx);
  if (!r) {
    return;
  }
  if (layer === "l1") {
    const ok = !r.error && !!r.hitTarget;
    _atShowChkExplain(wrap, `L1 · ${r.device || "设备"}`, [
      { kind: "note", text: "L1 只看本用例目标机：MCU 读回工况是否等于用例目标。旁观机不进 L1。" },
      { kind: "eq", text: "通过 ⇔ 读回态 === 目标态" },
      { kind: "sub", text: `读回「${r.theory || "—"}」 ${ok ? "==" : "!="} 目标「${r.target || "—"}」` },
      { kind: "res", text: r.error ? `下发失败：${r.error}` : (ok ? "通过" : "失败（工况未中）") },
      ...(r.l1Formula ? [{ kind: "note", text: r.l1Formula }] : []),
    ]);
    return;
  }
  const familyLines = [
    { kind: "eq", text: `全家 L2 对照（共 ${list.length} 台，含旁观）` },
    ...list.map((row) => ({ kind: "sub", text: _atL2RosterLine(row) })),
  ];
  if (r.error) {
    _atShowChkExplain(wrap, `L2 · ${r.device || "设备"}`, [
      { kind: "res", text: `下发失败，未检查 L2：${r.error}` },
      ...familyLines,
    ]);
    return;
  }
  if (r.masterPass === null) {
    _atShowChkExplain(wrap, `L2 · ${r.device || "设备"}`, [
      { kind: "note", text: `${r.role === "peer" ? "旁观机 · " : ""}本态 L2 不硬判（参考）。` },
      { kind: "eq", text: r.masterNote || r.l2Formula || "determinable=false" },
      { kind: "res", text: "参考 · 不影响综合失败" },
      ...familyLines,
    ]);
    return;
  }
  const lo = Array.isArray(r.expBand) ? r.expBand[0] : "?";
  const hi = Array.isArray(r.expBand) ? r.expBand[1] : "?";
  const dirOk = r.actOrder === r.expOrder;
  const act = r.actPower;
  const inBand = act != null && Number.isFinite(Number(lo)) && Number.isFinite(Number(hi))
    && act >= lo && act <= hi;
  _atShowChkExplain(wrap, `L2 · ${r.device || "设备"}${r.role === "peer" ? " · 旁观" : " · 目标"}`, [
    { kind: "note", text: "L2 是家庭级：主机按整簇上报态算每台期望，再和该机 DP98 比对。旁观机也要符合。" },
    { kind: "eq", text: "① 方向：实际 order == 期望 order（来自工况 action）" },
    { kind: "sub", text: `实际「${r.actOrder || "—"}」 ${dirOk ? "==" : "!="} 期望「${r.expOrder || "—"}」 → ${dirOk ? "过" : "不过"}` },
    { kind: "eq", text: `② 功率：允许区间下限 ≤ 实际功率 ≤ 上限；期望点位 ${r.expPower ?? "—"}W 只是参考中心` },
    { kind: "sub", text: `区间 ${lo} ~ ${hi} W；实际 ${act == null ? "—" : act} W → ${inBand ? "落在区间内" : "超出区间"}` },
    { kind: "res", text: r.masterPass ? "本机 L2 通过" : "本机 L2 失败" },
    ...(r.l2Formula ? [{ kind: "note", text: r.l2Formula }] : []),
    ...familyLines,
  ]);
}

function _atExplainBand(wrap, uid) {
  const ctx = _atChkExplainStore[wrap.getAttribute("data-chk-id")];
  const list = ctx?.results || [];
  const r = _atFindChkResult(list, uid, null);
  if (!r) {
    return;
  }
  _atShowChkExplain(wrap, `功率区间 · ${r.device || "设备"}`, _atBandExplainLines(r, ctx?.expectMeta));
}

function _atExplainL3(wrap, kind) {
  const ctx = _atChkExplainStore[wrap.getAttribute("data-chk-id")];
  const l3 = ctx?.l3;
  if (!l3) {
    _atShowChkExplain(wrap, "L3 · 家庭异常", [
      { kind: "note", text: "本帧没有家庭流向数据，无法判定。" },
    ]);
    return;
  }
  if (kind === "reverse") {
    const lines = [
      { kind: "note", text: "逆流 = 家庭并网点向电网送电（馈网）。与报告页「电网馈网」同号：gridW < 0。" },
      { kind: "eq", text: "通过 ⇔ 无电表跳过，或 gridW ≥ 0（取电/零）" },
      {
        kind: "sub",
        text: l3.gridKnown
          ? `gridW=${l3.gridW}W → ${l3.reverseFlow ? `馈网 ${l3.reverseW}W → 失败` : "无逆流 → 通过"}`
          : "未读到电表/LAN → 跳过（不硬判）",
      },
      {
        kind: "res",
        text: l3.reversePass === null ? "跳过" : (l3.reversePass ? "通过" : "失败"),
      },
    ];
    _atShowChkExplain(wrap, "L3 · 逆流", lines);
    return;
  }
  const lines = [
    { kind: "note", text: "AC 边充边放 = 同一时刻家庭集群 DP98 既有充电又有放电，空转损耗。" },
    { kind: "eq", text: `失败 ⇔ 集群充 > ${l3.bothEps}W 且 集群放 > ${l3.bothEps}W` },
    { kind: "sub", text: `充 ${l3.actChg}W · 放 ${l3.actDchg}W → ${l3.bothWay ? "同时超阈值 → 失败" : "未同时超阈值 → 通过"}` },
    { kind: "res", text: l3.bothPass ? "通过" : "失败" },
  ];
  _atShowChkExplain(wrap, "L3 · AC边充边放", lines);
}

function _atBindCheckerExplain(root) {
  if (!root) {
    return;
  }
  root.querySelectorAll(".at-checker-wrap[data-chk-id]").forEach((wrap) => {
    if (wrap.dataset.fxBound === "1") {
      return;
    }
    wrap.dataset.fxBound = "1";
    wrap.addEventListener("click", (ev) => {
      const foldBtn = ev.target.closest("[data-chk-fold]");
      if (foldBtn && wrap.contains(foldBtn)) {
        const sec = foldBtn.closest("[data-chk-fold-sec]");
        if (sec) {
          const open = sec.classList.toggle("is-collapsed") === false;
          foldBtn.setAttribute("aria-expanded", open ? "true" : "false");
        }
        return;
      }
      const homeBtn = ev.target.closest("[data-chk-home]");
      if (homeBtn && wrap.contains(homeBtn)) {
        _atExplainHomeMetric(wrap, homeBtn.getAttribute("data-chk-home"));
        return;
      }
      const bandBtn = ev.target.closest("[data-chk-band]");
      if (bandBtn && wrap.contains(bandBtn)) {
        _atExplainBand(wrap, bandBtn.getAttribute("data-uid"));
        return;
      }
      const l3Btn = ev.target.closest("[data-chk-l3]");
      if (l3Btn && wrap.contains(l3Btn)) {
        _atExplainL3(wrap, l3Btn.getAttribute("data-chk-l3"));
        return;
      }
      const passBtn = ev.target.closest("[data-chk-pass]");
      if (passBtn && wrap.contains(passBtn)) {
        _atExplainPass(wrap, passBtn.getAttribute("data-chk-pass"), passBtn.getAttribute("data-uid"), passBtn.getAttribute("data-idx"));
        return;
      }
    });
  });
}

function _atCheckerTableHtml(results, expectMeta, homeFlow) {
  const list = results || [];
  if (!list.length) {
    return "";
  }
  const l3 = expectMeta?.l3 || (homeFlow ? _atEvalFamilyL3(homeFlow) : null);
  const stats = _atCheckerStageStats(list, l3);
  const chkId = `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const metrics = _atHomeMetricDefs(expectMeta);
  _atChkExplainStore[chkId] = { results: list, expectMeta: expectMeta || null, metrics, l3, homeFlow: homeFlow || null };
  const verdict = stats.overallFail
    ? `<div class="at-chk-verdict is-fail">${stats.overallFail} 项未通过` +
        `${stats.issueFail ? ` · 下发失败 ${stats.issueFail}` : ""}` +
        `${stats.l1Fail ? ` · L1 未中 ${stats.l1Fail}` : ""}` +
        `${stats.l2Fail ? ` · L2 失败 ${stats.l2Fail}` : ""}` +
        `${stats.l3Fail ? ` · L3 家庭异常` : ""}</div>`
    : `<div class="at-chk-verdict is-ok">设备 ${stats.pass}/${stats.total} 通过` +
        `${l3 && l3.pass !== false ? " · L3 正常" : ""}</div>`;
  const l2Body =
      _atCheckerL2HomeHtml(expectMeta) +
      `<div class="at-chk-subhead"><span class="at-chk-step">2</span>工况 action</div>` +
      _atL2ActionSheetHtml(!!expectMeta?.chg2Suppressed) +
      _atCheckerL2ExecHtml(list);
  return `<div class="at-checker-wrap at-checker-clean" data-chk-id="${chkId}">` +
    verdict +
    _atCheckerL1SectionHtml(list) +
    _atChkFoldSecHtml(
      "二",
      "L2 · 主机决策",
      "整家庭算期望，每台（含旁观）对 DP98",
      l2Body,
      {
        fail: !!stats.l2Fail,
        open: !!stats.l2Fail || !!stats.l1Fail,
        badge: stats.l2Fail
          ? `<span class="at-badge at-fail">L2 失败</span>`
          : `<span class="at-badge at-pass">L2 通过</span>`,
      }
    ) +
    _atCheckerL3SectionHtml(l3) +
  `</div>`;
}

function _atPlayerCheckerHtml(frame) {
  const results = Array.isArray(frame.checkerState) ? frame.checkerState : [];
  if (results.length) {
    return _atCheckerTableHtml(results, frame.masterExpect || null, frame.homeFlow || null);
  }
  if (frame.note && !_atIsLegacyWhy(frame.note)) {
    return `<div class="at-player-note">${escapeHtml(frame.note)}</div>`;
  }
  return `<div class="at-player-note">本帧没有逐设备检查结果。</div>`;
}

function _atPlayerStepHtml(frame) {
  const phase = frame.phase;
  if (phase === "before") {
    return `<p class="at-step-lead">下发前各设备当前工况。</p>` +
      _atDeviceStateTable(frame.familyState);
  }
  if (phase === "issued") {
    return `<p class="at-step-lead">本步参数变更（旧值→新值）。</p>` +
      _atIssuedTable(frame.issued);
  }
  if (phase === "mid") {
    return `<p class="at-step-lead">观察窗口中点：各设备工况是否开始变化。</p>` +
      _atDeviceStateTable(frame.familyState);
  }
  if (phase === "observe" || phase === "fail-focus") {
    return _atPlayerCheckerHtml(frame);
  }
  if (phase === "restore") {
    return `<p class="at-step-lead">已把本用例改过的参数恢复到下发前。</p>` +
      (frame.issued && frame.issued.length ? _atIssuedTable(frame.issued) : "") +
      _atDeviceStateTable(frame.familyState);
  }
  return _atPlayerCheckerHtml(frame);
}

function _atUpdateCaseRow(cycle) {
  const row = document.querySelector(`.at-case-row[data-case-no="${cycle.no}"]`);
  if (!row) return;
  const status = row.querySelector(".at-case-status");
  if (!status) return;
  row.classList.toggle("is-fail", !!(cycle.failed || cycle.status === "fail"));
  let reasonEl = row.querySelector(".at-case-reason");
  if (cycle.status === "running" || (cycle.step && cycle.step !== "ready" && cycle.step !== "done")) {
    status.className = "at-case-status at-case-running";
    status.textContent = "执行中";
    if (reasonEl) reasonEl.remove();
  } else if (cycle.failed || cycle.status === "fail") {
    status.className = "at-case-status at-case-fail";
    status.textContent = "失败";
    const text = _atFailLines(cycle.results).join("；") || "未通过";
    if (!reasonEl) {
      reasonEl = document.createElement("span");
      reasonEl.className = "at-case-reason";
      row.appendChild(reasonEl);
    }
    reasonEl.textContent = text;
  } else if (cycle.status === "done") {
    status.className = "at-case-status at-case-done";
    status.textContent = "通过";
    if (reasonEl) reasonEl.remove();
  } else {
    status.className = "at-case-status at-case-ready";
    status.textContent = "就绪";
    if (reasonEl) reasonEl.remove();
  }
}

function _atRefreshLiveHost(home) {
  const host = document.getElementById("flowHost");
  if (!host || !home) return;
  const canvasView = captureLiveCanvasView();
  host.innerHTML = typeof renderHomeEnergyFlow === "function" ? renderHomeEnergyFlow(home) : "";
  bindFlowHost(home);
  restoreLiveCanvasView(canvasView);
}

async function _atReadDevices(home, devices) {
  const list = (devices || []).filter(Boolean);
  await Promise.all(list.map(async (dev) => {
    try {
      await readDevice(home, dev, { quiet: true, batch: true });
    } catch (_) {}
  }));
  if (typeof applyDp98ActualForHome === "function") {
    applyDp98ActualForHome(home);
  }
}

async function _atCaptureFrame(home, cycle, phase, extra = {}) {
  if (extra.readScope === "family") {
    await _atReadDevices(home, home.devices || []);
  } else if (extra.readScope === "device") {
    await _atReadDevices(home, _atCycleDevices(home, cycle));
  }
  const shotAt = extra.at || Date.now();
  const prevFrozen = atUiFrozen;
  atUiFrozen = true;
  let snap = { image: "", thumb: "" };
  try {
    _atRefreshLiveHost(home);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      snap = _atSnapshotData(await captureLiveViewCanvas());
    } catch (err) {
      extra.note = `${extra.note || ""} 截图失败：${err.message || err}`.trim();
    }
  } finally {
    atUiFrozen = prevFrozen;
  }
  const assignments = _atCycleAssignments(cycle);
  const primary = assignments[0] || cycle;
  const targetDevice = _atCycleDevice(home, cycle);
  const owner = targetDevice ? classifyOwnerWorkModel(targetDevice) : null;
  const actual = targetDevice?.ownerActual || null;
  const frame = {
    id: uid(),
    at: shotAt,
    time: extra.time || _nowHMS(shotAt),
    phase,
    title: extra.title || phase,
    note: extra.note || "",
    label: _atCycleLabel(cycle),
    target: primary.target || cycle.target,
    deviceId: primary.deviceId || cycle.deviceId,
    device: _atCycleLabel(cycle),
    image: snap.image,
    thumb: snap.thumb,
    strategyKey: primary.strategyKey || cycle.strategyKey,
    coverageKey: primary.coverageKey || cycle.coverageKey,
    params: { ...(primary.params || cycle.params || {}) },
    deviceState: {
      theory: owner ? owner.label : "—",
      theoryChargeW: owner ? owner.chgCapW : null,
      theoryDischargeW: owner ? owner.dchgCapW : null,
      actualLabel: actual ? actual.label : "—",
      actualOrder: _atStateLabel(actual),
      actualPowerW: actual ? actual.cmdPowerW : null,
    },
    familyState: extra.familyState || _atFamilyState(home),
    homeFlow: extra.homeFlow || _atHomeFlow(home),
    issued: extra.issued || (phase === "issued" ? (cycle.issued || []).map((item) => ({ ...item })) : null),
    checkerState: extra.checkerState || null,
    masterExpect: extra.masterExpect || null,
    emphasis: extra.emphasis || "",
    stepOk: extra.stepOk !== undefined ? !!extra.stepOk : true,
    failed: extra.stepOk === false || !!extra.emphasis,
  };
  cycle.frames.push(frame);
  renderCycleCard(cycle, cycle.failed ? "done fail" : "running");
  _atUpdateCaseRow(cycle);
  return frame;
}

/**
 * @brief Bind once: click cycle head to expand/collapse finished cards
 * @param[in] tl timeline container
 * @return none
 */
function _atBindTimelineFold(tl) {
  if (!tl || tl.dataset.foldBound === "1") {
    return;
  }
  tl.dataset.foldBound = "1";
  tl.addEventListener("click", (ev) => {
    const head = ev.target.closest("[data-at-cycle-fold]");
    if (!head) {
      return;
    }
    const card = head.closest(".at-cycle");
    if (!card) {
      return;
    }
    const collapsed = card.classList.toggle("is-collapsed");
    card.dataset.userOpen = collapsed ? "0" : "1";
    head.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });
}

// 时间轴：把一个周期(cycle)渲染/更新成一张卡片
function renderCycleCard(cycle, phase) {
  const tl = document.getElementById("autoTestTimeline");
  if (!tl) return;
  _atBindTimelineFold(tl);
  let card = tl.querySelector(`[data-cycle="${cycle.no}"]`);
  if (!card) {
    card = document.createElement("div");
    card.setAttribute("data-cycle", String(cycle.no));
    tl.appendChild(card);
  }
  const finished = cycle.step === "done";
  const userOpen = card.dataset.userOpen === "1";
  const collapsed = finished && !userOpen;
  card.className = `at-cycle ${phase || ""}${cycle.failed ? " fail" : ""}${collapsed ? " is-collapsed" : ""}`;
  const issuedRows = cycle.issued.length
    ? cycle.issued.map((it) =>
        `<div class="at-issue-line">• ${escapeHtml(it.device)} → <b>${escapeHtml(it.target || cycle.target || "—")}</b> ← <span class="mono">${escapeHtml(_atParamStr(it.params)) || "天然命中"}</span>${it.ok ? "" : ' <span class="at-badge at-fail">下发失败</span>'}</div>`
      ).join("")
    : `<div class="hint">（等待下发）</div>`;
  const framesHtml = cycle.frames?.length
    ? `<div class="at-frame-strip">` +
        cycle.frames.map((frame) => {
          const stepCls = _atFrameStepClass(frame);
          return `<figure class="at-frame ${stepCls}">
            <img src="${escapeAttr(frame.thumb || frame.image)}" alt="${escapeAttr(frame.title || frame.phase)}" />
            <figcaption><b>${escapeHtml(frame.time)}</b> ${escapeHtml(_atPhaseLabel(frame.phase))}<div class="at-frame-brief">${escapeHtml(_atFrameOneLiner(frame))}</div></figcaption>
          </figure>`;
        }).join("") +
      `</div>`
    : "";
  let resultBlock;
  if (cycle.results.length) {
    resultBlock =
      `<div class="at-step"><span class="t">${escapeHtml(cycle.tObserve || "")}</span>结果回收${cycle.failed ? ' <span class="at-badge at-fail">失败</span>' : ""}</div>` +
      _atCheckerTableHtml(cycle.results, cycle.masterExpect || null, cycle.homeFlow || null) +
      framesHtml;
  } else if (cycle.step === "runtime" || cycle.step === "checker") {
    resultBlock = `<div class="at-step"><span class="at-badge at-wait">等待观察窗口…</span></div>${framesHtml}`;
  } else {
    resultBlock = framesHtml;
  }
  card.innerHTML =
    `<div class="at-cycle-head" data-at-cycle-fold="1" role="button" tabindex="0" aria-expanded="${collapsed ? "false" : "true"}">` +
      `<span class="at-cycle-chevron" aria-hidden="true"></span>` +
      `<span class="at-cycle-no">用例 ${cycle.no}</span>` +
      `<span class="at-cycle-target">${escapeHtml(_atCycleLabel(cycle))}</span>` +
      `<span class="at-cycle-time">${escapeHtml(cycle.tIssue || "")}</span>${_atStatusBadge(cycle)}` +
    `</div>` +
    `<div class="at-cycle-body">` +
      `<div class="at-pipeline">${_atRenderStepPipeline(cycle)}</div>` +
      `<div class="at-step"><span class="t">${escapeHtml(cycle.tIssue || "—")}</span>下发到 ${cycle.issued.length || _atCycleAssignments(cycle).length} 台：</div>${issuedRows}` +
      resultBlock +
    `</div>`;
  _atBindCheckerExplain(card);
  _atUpdateCaseRow(cycle);
}

const _atL2Txt = (r) => (r.masterPass === null ? "参考" : r.masterPass ? "通过" : "失败");
function _atFlattenFrames(cycles) {
  return cycles.flatMap((cycle) => (cycle.frames || []).map((frame) => ({
    ...frame,
    cycleNo: cycle.no,
    failed: !!cycle.failed,
  }))).sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
}

function _atReportMd(home, cycles, settle) {
  const flat = cycles.flatMap((c) => c.results);
  const pass = flat.filter((r) => r.pass).length;
  const fail = flat.length - pass;
  const l1ok = flat.filter((r) => r.hitTarget).length;
  const l2judged = flat.filter((r) => r.masterPass !== null);
  const l2ok = l2judged.filter((r) => r.masterPass).length;
  const t = new Date().toLocaleString("zh-CN");
  let md = `# 自动回归测试报告\n\n- 家庭：${home.name || ""}（ID ${home.homeId}）\n- 时间：${t}\n- 周期：${cycles.length} · 组：${flat.length} · 每周期等待 ${settle}s\n`;
  md += `- 综合通过：${pass}/${flat.length}（失败 ${fail}）\n`;
  md += `- L1 从机判定（读回态命中目标态）：${l1ok}/${flat.length}\n`;
  md += `- L2 主机决策（DP98 分配==期望）：${l2ok}/${l2judged.length} 可硬判（其余 ${flat.length - l2judged.length} 组依赖能量守恒/未采集量，仅参考）\n\n`;
  md += `> 判定说明：L1 测从机 S1–S13 判定链；L2 用整簇上报态按分配优先级（充1强充 / 充2抑制 / 一充一放）算出主机期望决策，与 DP98 实际 order+cmdPower 比对。每个周期都保留前态、下发后、中间态、终态时间帧。\n\n`;
  for (const c of cycles) {
    const label = _atCycleLabel(c);
    md += `## 用例 ${c.no} · ${label}${c.failed ? " · 失败高亮" : ""}\n\n`;
    md += `- ${c.tIssue || "—"} 下发：${c.issued.map((it) => `${it.device}[${it.target || c.target}](${_atParamStr(it.params) || "天然命中"})`).join("；") || "无"}\n`;
    md += `- 时间帧：${(c.frames || []).map((f) => `${f.time} ${_atPhaseLabel(f.phase)}`).join(" → ") || "无"}\n`;
    for (const frame of c.frames || []) {
      if (frame.phase === "fail-focus") {
        continue;
      }
      md += `\n### ${_atPhaseLabel(frame.phase)}\n\n`;
      if (frame.homeFlow && (frame.phase === "before" || frame.phase === "mid" || frame.phase === "restore")) {
        md += `- 家庭流向：PV ${_atW(frame.homeFlow.pvTotal)} · Bypass ${_atW(frame.homeFlow.bypass)} · ${_atGridFlowTxt(frame.homeFlow)} · DP98 充 ${_atW(frame.homeFlow.actChg)} / 放 ${_atW(frame.homeFlow.actDchg)}\n`;
        for (const item of frame.familyState || []) {
          md += `  - ${item.device}：SoC ${item.soc == null ? "—" : item.soc + "%"} · ${item.theory} · DP98 ${_atFmtCmd(item.actualOrder, item.actualPowerW)} · PV ${_atW(item.pv)} / Bypass ${_atW(item.bypass)}\n`;
        }
      }
      if (frame.phase === "issued") {
        for (const item of frame.issued || c.issued || []) {
          md += `  - ${item.device} → ${item.target || "—"}：${_atParamHuman(item.params) || "天然命中，未改参"}${item.ok === false ? " · 下发失败" : ""}\n`;
        }
      }
      if (frame.phase === "observe" || frame.phase === "fail-focus") {
        const failLines = _atFailLines(frame.checkerState || c.results);
        md += failLines.length ? failLines.map((line) => `- ${line}\n`).join("") : "- 全部通过\n";
      }
    }
    md += `\n`;
    md += `- ${c.tObserve || ""} 观察：\n\n`;
    const failLines = _atFailLines(c.results);
    if (failLines.length) {
      md += `**失败原因**\n`;
      for (const line of failLines) {
        md += `- ${line}\n`;
      }
      md += `\n`;
    }
    md += `| 设备 | 目标态 | 读回态 | L1从机 | 期望决策 | 实际决策 | L2主机 | 综合 | 失败原因 |\n|---|---|---|---|---|---|---|---|---|\n`;
    for (const r of c.results) {
      const exp = _atFmtCmd(r.expOrder, r.expPower);
      const act = _atFmtCmd(r.actOrder, r.actPower);
      md += `| ${r.device} | ${r.target || c.target} | ${r.theory} | ${r.hitTarget ? "命中" : "未中"} | ${exp} | ${act} | ${_atL2Txt(r)} | ${r.pass ? "通过" : "失败"} | ${(_atFailReason(r) || "").replace(/\n/g, " ")} |\n`;
    }
    md += `\n`;
  }
  return md;
}
function _atReportCsv(cycles) {
  const head = ["周期", "设备", "设备ID", "目标工况", "构造策略", "下发时刻", "观察时刻", "下发参数", "读回态", "L1从机判定", "期望order", "期望功率W", "实际order", "实际功率W", "L2主机决策", "综合", "失败原因"];
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(",")];
  for (const c of cycles) {
    for (const r of c.results) {
      lines.push([
        c.no, r.device, r.deviceId, r.target || c.target, r.coverageKey || "", c.tIssue, c.tObserve || "", _atParamStr(r.params),
        r.theory, r.hitTarget ? "Y" : "N", r.expOrder, r.expPower == null ? "" : r.expPower,
        r.actOrder, r.actPower == null ? "" : r.actPower, _atL2Txt(r), r.pass ? "PASS" : "FAIL",
        _atFailReason(r).replace(/\n/g, " "),
      ].map(esc).join(","));
    }
  }
  return lines.join("\n");
}

function _atReportPayload(home, cycles, settle, savedId, extra = {}) {
  const flat = cycles.flatMap((c) => c.results || []);
  const pass = flat.filter((r) => r.pass).length;
  const fail = flat.length - pass;
  const l1ok = flat.filter((r) => r.hitTarget).length;
  const l2j = flat.filter((r) => r.masterPass !== null);
  const l2ok = l2j.filter((r) => r.masterPass).length;
  const planned = extra.planned != null ? extra.planned : cycles.length;
  const status = extra.status || "done";
  const caseStats = _atReportCaseStats({ cycles, planned, status, paused: status === "paused" });
  return {
    id: savedId || extra.reportId || null,
    createdAt: Date.now(),
    settle,
    homeId: home.homeId || "",
    homeName: home.name || "",
    status,
    planned,
    paused: status === "paused",
    summary: {
      cycles: cycles.length,
      planned,
      total: flat.length,
      passed: pass,
      failed: fail,
      l1ok,
      l2ok,
      l2judged: l2j.length,
      status,
      casesTotal: caseStats.total,
      casesPassed: caseStats.passed,
      casesFailed: caseStats.failed,
      casesPaused: caseStats.paused,
    },
    cycles: cycles.map((cycle) => ({
      ...cycle,
      frames: cycle.frames || [],
      results: cycle.results || [],
    })),
    frames: _atFlattenFrames(cycles),
  };
}

function _atParseWatt(re, text) {
  const m = re.exec(text);
  return m ? Number(m[1]) : null;
}

function _atParseFlowLine(line) {
  const text = String(line || "");
  let gridW = _atParseWatt(/电网取电\s+(-?\d+)\s*W/, text);
  if (gridW == null) {
    const feed = _atParseWatt(/电网馈网\s+(-?\d+)\s*W/, text);
    gridW = feed == null ? _atParseWatt(/电网\s+(-?\d+)\s*W/, text) : -feed;
  }
  return {
    pvTotal: _atParseWatt(/PV\s+(-?\d+)\s*W/, text),
    bypass: _atParseWatt(/Bypass\s+(-?\d+)\s*W/, text),
    actChg: _atParseWatt(/DP98 充\s+(-?\d+)\s*W/, text),
    actDchg: _atParseWatt(/放\s+(-?\d+)\s*W/, text),
    gridW,
    familyLoad: _atParseWatt(/家庭负载\s+(-?\d+)\s*W/, text),
    bypasses: [],
  };
}

function _atParseDeviceLine(line) {
  const m = /^\s*-\s*(.+?)：SoC\s+(\d+|—)%?\s*·\s*(.+?)\s*·\s*DP98\s+(\S+)\s*·\s*PV\s+(-?\d+)W\s*\/\s*Bypass\s+(-?\d+)W/.exec(line);
  if (!m) {
    return null;
  }
  const dp = m[4] === "—" ? { actualOrder: "—", actualPowerW: null } : (() => {
    const hit = /^([^/]+)\/(\d+)W$/.exec(m[4]);
    return hit ? { actualOrder: hit[1], actualPowerW: Number(hit[2]) } : { actualOrder: m[4], actualPowerW: null };
  })();
  return {
    device: m[1].trim(),
    soc: m[2] === "—" ? null : Number(m[2]),
    theory: m[3].trim(),
    pv: Number(m[5]),
    bypass: Number(m[6]),
    ...dp,
  };
}

function _atParseIssueItems(text) {
  return String(text || "").split(/；|;/).map((part) => {
    const m = /(.+?)\[([^\]]+)\](?:\(([^)]*)\))?/.exec(part.trim());
    if (!m) {
      return null;
    }
    const params = {};
    for (const kv of String(m[3] || "").split(/\s+/)) {
      const idx = kv.indexOf("=");
      if (idx > 0) {
        params[kv.slice(0, idx)] = kv.slice(idx + 1);
      }
    }
    return { device: m[1].trim(), target: m[2], params, ok: true };
  }).filter(Boolean);
}

function _atCyclesFromMarkdown(md) {
  const blocks = String(md || "").split(/^## 用例\s+/m).slice(1);
  return blocks.map((block, idx) => {
    const headLine = (block.split("\n")[0] || "").trim();
    const head = /^(\d+)\s*·\s*(.+?)(?:\s*·\s*失败高亮)?$/.exec(headLine);
    const no = head ? Number(head[1]) : idx + 1;
    const label = head ? head[2].trim() : headLine || `用例 ${no}`;
    const issueHit = block.match(/下发：(.+)/);
    const issued = issueHit ? _atParseIssueItems(issueHit[1]) : [];
    const sections = {};
    let cur = "";
    for (const line of block.split("\n")) {
      const h = /^###\s+(.+)/.exec(line);
      if (h) {
        cur = h[1].trim();
        sections[cur] = [];
        continue;
      }
      if (cur) {
        sections[cur].push(line);
      }
    }
    const pick = sections["运行中"] || sections["检查"] || sections["回收"] || sections["开始前"] || [];
    const flowLine = pick.find((line) => line.includes("家庭流向")) || "";
    const flow = flowLine ? _atParseFlowLine(flowLine) : null;
    const family = pick.map(_atParseDeviceLine).filter(Boolean);
    if (flow && family.length) {
      flow.bypasses = family.map((item) => ({ device: item.device, w: item.bypass }));
    }
    const results = [];
    for (const line of block.split("\n")) {
      if (!line.startsWith("|") || /---/.test(line) || /设备/.test(line) && /目标/.test(line)) {
        continue;
      }
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.length < 8) {
        continue;
      }
      const pass = cells[7] === "通过";
      results.push({
        device: cells[0],
        target: cells[1],
        theory: cells[2],
        hitTarget: cells[3] === "命中",
        pass,
        masterPass: cells[6] === "通过" ? true : cells[6] === "失败" ? false : null,
        failReason: cells[8] || "",
        failTags: pass ? [] : (cells[8] ? [cells[8]] : ["未通过"]),
      });
    }
    const failed = results.some((item) => !item.pass);
    return {
      no,
      label,
      issued,
      assignments: issued.map((item) => ({ ...item })),
      results,
      frames: flow || family.length
        ? [{ phase: "observe", homeFlow: flow, familyState: family, checkerState: results, failed }]
        : [],
      failed,
      status: failed ? "fail" : "done",
    };
  });
}

function _atHydrateReport(report) {
  if (!report) {
    return report;
  }
  if (Array.isArray(report.cycles) && report.cycles.length) {
    return report;
  }
  if (report.markdown) {
    report.cycles = _atCyclesFromMarkdown(report.markdown);
    report.frames = typeof _atFlattenFrames === "function" ? _atFlattenFrames(report.cycles) : [];
  }
  return report;
}

function _atPersistableReport(report) {
  /** Keep frame image/thumb for server-side disk persist; server rewrites to asset URLs. */
  if (!report || typeof report !== "object") {
    return report;
  }
  return report;
}

function _atReportCaseStats(report) {
  const cycles = report?.cycles || [];
  const summary = report?.summary;
  const sumTxt = typeof summary === "string" ? summary : "";
  const pair = sumTxt.match(/(\d+)\s*\/\s*(\d+)\s*用例/);
  const planned = Number(
    report?.planned
    ?? (summary && typeof summary === "object" ? summary.planned : null)
    ?? (pair ? pair[2] : null)
    ?? cycles.length
  ) || 0;
  let passed = 0;
  let failed = 0;
  let pausedRun = 0;
  for (const cycle of cycles) {
    if (cycle.status === "paused" || cycle.status === "running") {
      pausedRun += 1;
    } else if (cycle.failed || cycle.status === "fail") {
      failed += 1;
    } else if (cycle.status === "done" || (cycle.results && cycle.results.length)) {
      passed += 1;
    } else {
      pausedRun += 1;
    }
  }
  const unrun = Math.max(0, planned - cycles.length);
  return {
    total: planned || cycles.length,
    ran: cycles.length,
    passed,
    failed,
    paused: pausedRun + unrun,
  };
}

function _atReportCycleByNo(no) {
  return (atLastReport?.cycles || []).find((cycle) => Number(cycle.no) === Number(no)) || null;
}

function _atCycleSnapshot(cycle) {
  const frames = cycle?.frames || [];
  const prefer = ["observe", "mid", "before", "restore"];
  let snap = null;
  for (const phase of prefer) {
    snap = frames.find((frame) => frame.phase === phase && (frame.homeFlow || (frame.familyState || []).length));
    if (snap) {
      break;
    }
  }
  if (!snap) {
    snap = [...frames].reverse().find((frame) => frame.homeFlow || (frame.familyState || []).length) || frames[frames.length - 1] || null;
  }
  return {
    flow: snap?.homeFlow || null,
    family: snap?.familyState || [],
    issued: cycle?.issued || snap?.issued || [],
  };
}

function _atCycleConstructTxt(cycle) {
  const assigns = _atCycleAssignments(cycle);
  const rows = assigns.length
    ? assigns
    : (cycle?.issued || []).map((item) => ({
      device: item.device,
      target: item.target,
      params: item.params,
    }));
  if (!rows.length) {
    return cycle?.label || "—";
  }
  return rows.map((item) => {
    const human = _atParamHuman(item.params);
    return `${item.device || "—"}→${item.target || "—"}${human ? `（${human}）` : ""}`;
  }).join(" · ");
}

function _atCycleConstructHtml(cycle) {
  const assigns = _atCycleAssignments(cycle);
  const rows = assigns.length
    ? assigns
    : (cycle?.issued || []).map((item) => ({
      device: item.device,
      target: item.target,
      params: item.params,
    }));
  if (!rows.length) {
    return `<span class="hint">${escapeHtml(cycle?.label || "—")}</span>`;
  }
  return `<div class="at-construct-list">` + rows.map((item) => {
    const chips = _atLibParamChips(item.params || {});
    return `<div class="at-construct-item">` +
      `<span class="at-construct-dev">${escapeHtml(item.device || "—")}</span>` +
      `<span class="at-construct-arrow">→</span>` +
      _atModelChipHtml(item.target) +
      (Object.keys(item.params || {}).length ? `<span class="at-construct-params">${chips}</span>` : "") +
    `</div>`;
  }).join("") + `</div>`;
}

function _atCycleVerdict(cycle) {
  const fails = (cycle?.results || []).filter((item) => !item.pass || item.error);
  if (cycle?.status === "paused" || cycle?.status === "running") {
    return { kind: "paused", label: "暂停", text: "未跑完" };
  }
  if (cycle?.issueFailed) {
    const text = (cycle.issued || []).filter((item) => item.ok === false).map((item) =>
      `${item.device || item.deviceId || "—"}${item.err ? `: ${item.err}` : " 下发失败"}`
    ).join(" · ") || "下发失败";
    return { kind: "fail", label: "失败", text };
  }
  if (cycle?.failed || cycle?.status === "fail" || fails.length) {
    const text = fails.map((item) => {
      const tags = (item.failTags || _atFailTags(item)).join("/");
      return `${item.device}${tags ? ` ${tags}` : ""}`;
    }).join(" · ") || _atFailLines(cycle?.results).join("；") || "未通过";
    return { kind: "fail", label: "失败", text };
  }
  if (cycle?.status === "done" || (cycle?.results && cycle.results.length)) {
    return { kind: "pass", label: "通过", text: "" };
  }
  return { kind: "paused", label: "未完成", text: "" };
}

function _atReportStatsHtml(stats) {
  return `<div class="at-report-stats">` +
    `<div class="at-stat"><span>共</span><b>${stats.total}</b><span>用例</span></div>` +
    `<div class="at-stat is-pass"><span>通过</span><b>${stats.passed}</b></div>` +
    `<div class="at-stat is-fail"><span>失败</span><b>${stats.failed}</b></div>` +
    `<div class="at-stat is-pause"><span>暂停</span><b>${stats.paused}</b></div>` +
    `</div>`;
}

function _atReportFrameSet() {
  const cycle = atReportCycleNo != null ? _atReportCycleByNo(atReportCycleNo) : null;
  const frames = cycle
    ? (cycle.frames || []).map((frame) => ({ ...frame, cycleNo: cycle.no, failed: !!cycle.failed }))
    : (atLastReport?.frames || []);
  if (cycle) {
    return frames;
  }
  return atReportOnlyFailures ? frames.filter((frame) => frame.failed || frame.emphasis === "fail") : frames;
}

async function _atFetchReportList() {
  try {
    const json = await CaseApi.listReports();
    return json.reports || [];
  } catch (_) {
    return [];
  }
}

function _atReportBelongsToHome(item, home) {
  if (!item || !home) {
    return false;
  }
  const ids = [home.homeId, home.uid].map((value) => String(value || "").trim()).filter(Boolean);
  const names = [
    home.name,
    typeof homeDisplayName === "function" ? homeDisplayName(home) : "",
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const hid = String(item.homeId || "").trim();
  if (hid && ids.includes(hid)) {
    return true;
  }
  const fromFile = String(item.id || "").includes("_")
    ? String(item.id).split("_").slice(1).join("_")
    : "";
  if (fromFile && ids.includes(fromFile)) {
    return true;
  }
  const hname = String(item.homeName || "").trim();
  return !!hname && names.includes(hname);
}

async function _atLoadReport(reportId) {
  if (!reportId) return;
  if (atRunning) {
    toast("测试进行中，请先暂停再回放", "error");
    return;
  }
  try {
    const { json } = await CaseApi.getReport(reportId, "json");
    if (!json.report) {
      toast("回放加载失败", "error");
      return;
    }
    const report = json.report;
    if (!(report.cycles && report.cycles.length) && !report.markdown) {
      try {
        const md = await CaseApi.getReport(reportId, "md");
        if (md.res?.ok) {
          report.markdown = md.text;
        }
      } catch (_) {}
    }
    _atApplyReplayReport(report, reportId);
  } catch (e) {
    toast(`回放加载失败：${e.message || e}`, "error");
  }
}

async function openAutoTestReplay(reportId) {
  await _atLoadReport(reportId);
  if (atInnerTab !== "report") {
    setAtInnerTab("report");
  }
}

function _atApplyReplayReport(report, savedId) {
  atShowResults = true;
  atLastReport = _atHydrateReport(report);
  atLastReport.id = savedId;
  atReportFrameIndex = 0;
  atReportOnlyFailures = false;
  atReportCycleNo = null;
  const body = document.getElementById("autoTestBody");
  if (body) body.innerHTML = "";
  document.getElementById("autoTestProgress")?.classList.add("hidden");
  _atRenderReportPlayer(savedId);
}

function _atBindReportList(rep, savedId) {
  rep.querySelector("#atToggleFailures")?.addEventListener("click", () => {
    atReportOnlyFailures = !atReportOnlyFailures;
    _atRenderReportPlayer(savedId);
  });
  rep.querySelectorAll("[data-report-case]").forEach((row) => {
    row.addEventListener("click", () => {
      atReportCycleNo = Number(row.getAttribute("data-report-case") || 0);
      atReportFrameIndex = 0;
      _atRenderReportPlayer(savedId);
    });
  });
}

let atPeekZoom = { scale: 1, x: 0, y: 0 };

function _atResetPeekZoom() {
  atPeekZoom = { scale: 1, x: 0, y: 0 };
  const img = document.getElementById("atFramePeekImg");
  if (img) {
    img.style.transform = "";
  }
}

function _atApplyPeekZoom() {
  const img = document.getElementById("atFramePeekImg");
  const view = document.getElementById("atFramePeekView");
  if (!img || !view) {
    return;
  }
  const scale = Math.max(1, Math.min(8, atPeekZoom.scale));
  atPeekZoom.scale = scale;
  const vw = view.clientWidth || 1;
  const vh = view.clientHeight || 1;
  const iw = img.offsetWidth * scale;
  const ih = img.offsetHeight * scale;
  const minX = Math.min(0, vw - iw);
  const minY = Math.min(0, vh - ih);
  atPeekZoom.x = Math.max(minX, Math.min(0, atPeekZoom.x));
  atPeekZoom.y = Math.max(minY, Math.min(0, atPeekZoom.y));
  if (scale <= 1.001) {
    atPeekZoom.scale = 1;
    atPeekZoom.x = 0;
    atPeekZoom.y = 0;
  }
  img.style.transform = `translate(${atPeekZoom.x}px, ${atPeekZoom.y}px) scale(${atPeekZoom.scale})`;
}

function _atZoomPeekAt(view, clientX, clientY, nextScale) {
  const rect = view.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  const prev = atPeekZoom.scale;
  const scale = Math.max(1, Math.min(8, nextScale));
  const k = scale / prev;
  atPeekZoom.x = cx - (cx - atPeekZoom.x) * k;
  atPeekZoom.y = cy - (cy - atPeekZoom.y) * k;
  atPeekZoom.scale = scale;
  _atApplyPeekZoom();
}

/**
 * @brief Close the floating frame preview
 * @return none
 */
function _atCloseFramePeek() {
  atPeekOpen = false;
  _atResetPeekZoom();
  document.getElementById("atFramePeek")?.classList.add("hidden");
}

/**
 * @brief Update prev/next controls on the floating frame preview
 * @return none
 */
function _atUpdatePeekNavButtons() {
  const frames = _atReportFrameSet();
  const prevBtn = document.getElementById("atFramePeekPrev");
  const nextBtn = document.getElementById("atFramePeekNext");
  const hasFrames = frames.length > 1;
  if (prevBtn) {
    prevBtn.disabled = !hasFrames || atReportFrameIndex <= 0;
  }
  if (nextBtn) {
    nextBtn.disabled = !hasFrames || atReportFrameIndex >= frames.length - 1;
  }
}

/**
 * @brief Step the report frame index while the peek is open
 * @param[in] delta -1 for previous, +1 for next
 * @return none
 */
function _atPeekNavFrame(delta) {
  const frames = _atReportFrameSet();
  if (!atPeekOpen || !frames.length || !delta) {
    return;
  }
  const next = Math.max(0, Math.min(frames.length - 1, atReportFrameIndex + delta));
  if (next === atReportFrameIndex) {
    return;
  }
  _atSnapshotPeekBox(document.getElementById("atFramePeek"));
  atReportFrameIndex = next;
  const savedId = atLastReport?.id || atActiveReportId || "";
  _atRenderReportPlayer(savedId);
}

function _atPeekHostWin() {
  try {
    if (window.top && window.top.document) {
      return window.top;
    }
  } catch (_) {}
  return window;
}

function _atSnapshotPeekBox(peek) {
  if (!peek) {
    return;
  }
  const rect = peek.getBoundingClientRect();
  if (rect.width > 1 && rect.height > 1) {
    atPeekSize = { w: Math.round(rect.width), h: Math.round(rect.height) };
  }
  if (rect.left || rect.top) {
    atPeekPos = { left: Math.round(rect.left), top: Math.round(rect.top) };
  }
}

function _atFitPeekToImage(peek, img) {
  const hostWin = _atPeekHostWin();
  const nw = img.naturalWidth || 1;
  const nh = img.naturalHeight || 1;
  const headerH = peek.querySelector(".at-frame-peek-head")?.offsetHeight || 34;
  const maxW = Math.min(1080, hostWin.innerWidth - 24);
  const maxH = hostWin.innerHeight - 24;
  let w = atPeekSize?.w || maxW;
  w = Math.min(w, maxW);
  let h = headerH + Math.round(w * (nh / nw));
  if (h > maxH) {
    h = maxH;
    w = Math.max(280, Math.round((h - headerH) * (nw / nh)));
  }
  peek.style.width = `${w}px`;
  peek.style.height = `${h}px`;
  _atSnapshotPeekBox(peek);
}

function _atApplyFramePeekBox(peek) {
  if (atPeekSize) {
    peek.style.width = `${atPeekSize.w}px`;
    peek.style.height = `${atPeekSize.h}px`;
  } else {
    peek.style.width = `${Math.min(1080, _atPeekHostWin().innerWidth - 24)}px`;
    peek.style.height = "auto";
  }
  if (atPeekPos) {
    peek.style.left = `${atPeekPos.left}px`;
    peek.style.top = `${atPeekPos.top}px`;
    peek.style.right = "auto";
  } else {
    peek.style.top = "12px";
    peek.style.right = "12px";
    peek.style.left = "auto";
  }
}

/**
 * @brief Bind window drag, pinch-zoom and image pan (once)
 * @return none
 */
function _atBindFramePeekDrag() {
  const peek = document.getElementById("atFramePeek");
  const view = document.getElementById("atFramePeekView");
  if (!peek || peek.dataset.dragBound === "1") {
    return;
  }
  peek.dataset.dragBound = "1";
  peek.querySelector("#atFramePeekClose")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    _atCloseFramePeek();
  });
  peek.querySelector("#atFramePeekPrev")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    _atPeekNavFrame(-1);
  });
  peek.querySelector("#atFramePeekNext")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    _atPeekNavFrame(1);
  });
  if (peek.dataset.keyBound !== "1") {
    peek.dataset.keyBound = "1";
    document.addEventListener("keydown", (ev) => {
      if (!atPeekOpen || ev.defaultPrevented) {
        return;
      }
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        _atPeekNavFrame(-1);
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        _atPeekNavFrame(1);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        _atCloseFramePeek();
      }
    });
  }
  peek.querySelector("#atFramePeekHead")?.addEventListener("pointerdown", (ev) => {
    if (ev.button != null && ev.button !== 0) {
      return;
    }
    if (ev.target.closest("#atFramePeekClose, .at-frame-peek-nav")) {
      return;
    }
    const rect = peek.getBoundingClientRect();
    const dx = ev.clientX - rect.left;
    const dy = ev.clientY - rect.top;
    peek.classList.add("is-dragging");
    const onMove = (mv) => {
      const hostWin = _atPeekHostWin();
      const left = Math.max(8, Math.min(hostWin.innerWidth - 80, mv.clientX - dx));
      const top = Math.max(8, Math.min(hostWin.innerHeight - 40, mv.clientY - dy));
      peek.style.left = `${left}px`;
      peek.style.top = `${top}px`;
      peek.style.right = "auto";
      atPeekPos = { left, top };
    };
    const onUp = () => {
      peek.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
  if (!view) {
    return;
  }
  const pointers = new Map();
  let pinchStart = null;
  view.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) {
      const factor = Math.exp(-ev.deltaY * 0.012);
      _atZoomPeekAt(view, ev.clientX, ev.clientY, atPeekZoom.scale * factor);
      return;
    }
    atPeekZoom.x -= ev.deltaX;
    atPeekZoom.y -= ev.deltaY;
    _atApplyPeekZoom();
  }, { passive: false });
  view.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".at-frame-peek-nav")) {
      return;
    }
    if (ev.button != null && ev.button !== 0 && ev.pointerType === "mouse") {
      return;
    }
    view.setPointerCapture?.(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchStart = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        scale: atPeekZoom.scale,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
      };
    } else {
      view.classList.add("is-panning");
    }
  });
  view.addEventListener("pointermove", (ev) => {
    if (!pointers.has(ev.pointerId)) {
      return;
    }
    const prev = pointers.get(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size >= 2 && pinchStart) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      if (pinchStart.dist > 8) {
        _atZoomPeekAt(view, cx, cy, pinchStart.scale * (dist / pinchStart.dist));
      }
      atPeekZoom.x += cx - pinchStart.cx;
      atPeekZoom.y += cy - pinchStart.cy;
      pinchStart.cx = cx;
      pinchStart.cy = cy;
      _atApplyPeekZoom();
      return;
    }
    atPeekZoom.x += ev.clientX - prev.x;
    atPeekZoom.y += ev.clientY - prev.y;
    _atApplyPeekZoom();
  });
  const endPtr = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) {
      pinchStart = null;
    }
    if (!pointers.size) {
      view.classList.remove("is-panning");
    }
  };
  view.addEventListener("pointerup", endPtr);
  view.addEventListener("pointercancel", endPtr);
  peek.querySelector("#atFramePeekResize")?.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.button != null && ev.button !== 0) {
      return;
    }
    const rect = peek.getBoundingClientRect();
    const right = rect.right;
    const top = rect.top;
    const imgEl = peek.querySelector("#atFramePeekImg");
    const headerH = peek.querySelector(".at-frame-peek-head")?.offsetHeight || 34;
    const nw = imgEl?.naturalWidth || rect.width;
    const nh = imgEl?.naturalHeight || Math.max(1, rect.height - headerH);
    const ratio = nw / nh;
    peek.classList.add("is-resizing");
    const hostWin = _atPeekHostWin();
    const onMove = (mv) => {
      const minW = 280;
      const maxW = hostWin.innerWidth - 16;
      const maxH = hostWin.innerHeight - 16;
      let w = Math.max(minW, Math.min(maxW, right - mv.clientX));
      let h = headerH + Math.round(w / ratio);
      if (h > maxH) {
        h = maxH;
        w = Math.max(minW, Math.round((h - headerH) * ratio));
      }
      let left = right - w;
      if (left < 8) {
        w = right - 8;
        left = 8;
        h = headerH + Math.round(w / ratio);
      }
      peek.style.width = `${w}px`;
      peek.style.height = `${h}px`;
      peek.style.left = `${left}px`;
      peek.style.top = `${top}px`;
      peek.style.right = "auto";
      atPeekSize = { w, h };
      atPeekPos = { left, top };
      _atApplyPeekZoom();
    };
    const onUp = () => {
      peek.classList.remove("is-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

/**
 * @brief Open or update the floating frame preview at top-right
 * @param[in] src image url
 * @param[in] title caption
 * @param[in] opts keepView preserves window size/zoom when switching frames
 * @return none
 */
function _atOpenFramePeek(src, title, opts) {
  const peek = document.getElementById("atFramePeek");
  const img = document.getElementById("atFramePeekImg");
  const cap = document.getElementById("atFramePeekTitle");
  if (!peek || !img || !src) {
    return;
  }
  const keepView = !!(opts && opts.keepView) && atPeekOpen;
  _atBindFramePeekDrag();
  if (!keepView) {
    _atResetPeekZoom();
  }
  const applyView = () => {
    if (!img.naturalWidth) {
      return;
    }
    if (keepView) {
      _atApplyFramePeekBox(peek);
      _atApplyPeekZoom();
      return;
    }
    _atFitPeekToImage(peek, img);
  };
  img.onload = applyView;
  if (img.src !== src) {
    img.src = src;
  }
  if (cap) {
    cap.textContent = title || "过程截图";
  }
  peek.classList.remove("hidden");
  _atApplyFramePeekBox(peek);
  if (img.complete && img.naturalWidth) {
    applyView();
  }
  atPeekOpen = true;
  _atUpdatePeekNavButtons();
}

/**
 * @brief If peek is open, refresh it to the current selected frame
 * @param[in] frames report frames
 * @return none
 */
function _atSyncFramePeek(frames) {
  if (!atPeekOpen) {
    return;
  }
  const frame = (frames || [])[atReportFrameIndex];
  const src = frame?.image || frame?.thumb || "";
  if (!src) {
    return;
  }
  _atSnapshotPeekBox(document.getElementById("atFramePeek"));
  _atOpenFramePeek(src, frame.title || `${frame.time || ""} · ${_atPhaseLabel(frame.phase)}`, { keepView: true });
}

function _atBindReportDetail(rep, savedId, frames) {
  rep.querySelector("#atReportBackList")?.addEventListener("click", () => {
    atReportCycleNo = null;
    atReportFrameIndex = 0;
    _atCloseFramePeek();
    _atRenderReportPlayer(savedId);
  });
  rep.querySelector("#atPrevFrame")?.addEventListener("click", () => {
    atReportFrameIndex = Math.max(0, atReportFrameIndex - 1);
    _atRenderReportPlayer(savedId);
  });
  rep.querySelector("#atNextFrame")?.addEventListener("click", () => {
    atReportFrameIndex = Math.min(Math.max(0, frames.length - 1), atReportFrameIndex + 1);
    _atRenderReportPlayer(savedId);
  });
  rep.querySelectorAll("[data-frame-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      atReportFrameIndex = Number(btn.getAttribute("data-frame-idx") || 0);
      const frame = frames[atReportFrameIndex];
      const src = frame?.image || frame?.thumb || "";
      if (src) {
        _atOpenFramePeek(src, frame.title || `${frame.time || ""} · ${_atPhaseLabel(frame.phase)}`);
      }
      _atRenderReportPlayer(savedId);
    });
  });
  _atBindCheckerExplain(rep);
}

function _atRenderReportList(rep, savedId, stats) {
  const cycles = atLastReport.cycles || [];
  const rows = (atReportOnlyFailures
    ? cycles.filter((cycle) => cycle.failed || cycle.status === "fail")
    : cycles);
  const body = rows.map((cycle) => {
    const snap = _atCycleSnapshot(cycle);
    const verdict = _atCycleVerdict(cycle);
    const cls = verdict.kind === "fail" ? "is-fail" : verdict.kind === "paused" ? "is-pause" : "is-pass";
    return `<tr class="${cls}" data-report-case="${escapeAttr(String(cycle.no))}">` +
      `<td class="at-case-no">${cycle.no}</td>` +
      `<td>${_atFlowCellHtml(snap.flow, snap.family)}</td>` +
      `<td class="at-construct-cell">${_atCycleConstructHtml(cycle)}</td>` +
      `<td class="at-result-cell">${_atVerdictBadgeHtml(verdict)}${verdict.text ? `<div class="at-fail-text">${escapeHtml(verdict.text)}</div>` : ""}</td>` +
      `</tr>`;
  }).join("");
  const empty = cycles.length
    ? (rows.length ? "" : `<tr><td colspan="4" class="hint">没有失败用例。</td></tr>`)
    : `<tr><td colspan="4" class="hint">暂无用例。</td></tr>`;
  rep.innerHTML =
    `<h3>测试报告 · ${escapeHtml(atLastReport.title || savedId || "")}</h3>` +
    _atReportStatsHtml(stats) +
    `<p class="hint">点击表格行查看该用例详情。</p>` +
    `<div class="at-player-head"><div class="at-player-meta">用例列表</div>` +
    `<div class="at-player-controls">` +
      `<button type="button" class="btn btn-ghost" id="atToggleFailures">${atReportOnlyFailures ? "显示全部" : "仅看失败"}</button>` +
    `</div></div>` +
    `<div class="at-report-table-wrap"><table class="at-report-table">` +
      `<thead><tr><th>#</th><th>家庭流向</th><th>构造工况</th><th>结果</th></tr></thead>` +
      `<tbody>${body || empty}</tbody>` +
    `</table></div>`;
  _atBindReportList(rep, savedId);
}

function _atFlowCellHtml(flow, family) {
  if (!flow && !(family || []).length) {
    return `<span class="hint">—</span>`;
  }
  return `<div class="at-flow-cell">${_atFlowSchematicHtml(flow, family)}</div>`;
}

function _atRenderReportDetail(rep, savedId, cycle) {
  const frames = _atReportFrameSet();
  const verdict = _atCycleVerdict(cycle);
  const badge = _atVerdictBadgeHtml(verdict);
  const deviceIds = _atCycleDeviceIds(cycle);
  const head =
    `<h3>用例 ${cycle.no} ${badge}${deviceIds ? ` · <span class="mono">${escapeHtml(deviceIds)}</span>` : ""}</h3>` +
    (verdict.text ? `<p class="at-fail-text">${escapeHtml(verdict.text)}</p>` : "") +
    `<div class="at-player-head"><div class="at-player-meta">${_atCycleConstructHtml(cycle)}</div>` +
    `<div class="at-player-controls">` +
      `<button type="button" class="btn btn-ghost" id="atReportBackList">返回列表</button>` +
      (frames.length
        ? `<button type="button" class="btn btn-ghost" id="atPrevFrame">上一帧</button>` +
          `<button type="button" class="btn btn-ghost" id="atNextFrame">下一帧</button>` +
          `<span class="hint">${Math.min(atReportFrameIndex + 1, frames.length)}/${frames.length}</span>`
        : "") +
    `</div></div>`;
  if (!frames.length) {
    const snap = _atCycleSnapshot(cycle);
    rep.innerHTML = head +
      `<p class="hint">这条用例没有录播截图，下面是当时的检查结果。</p>` +
      _atDeviceStateTable(snap.family) +
      ((cycle.issued || []).length ? _atIssuedTable(cycle.issued) : "") +
      ((cycle.results || []).length ? _atCheckerTableHtml(cycle.results, cycle.masterExpect || null, cycle.homeFlow || null) : "");
    _atBindReportDetail(rep, savedId, frames);
    return;
  }
  atReportFrameIndex = Math.max(0, Math.min(atReportFrameIndex, frames.length - 1));
  const frame = frames[atReportFrameIndex];
  rep.innerHTML = head +
    `<div class="at-detail-stack">` +
      `<section class="at-detail-level at-detail-frames">` +
        `<div class="at-detail-level-kicker">1 · 中间过程态</div>` +
        `<p class="hint at-frame-hint">点击帧条放大预览；预览窗口左右按钮或 ← → 切换帧。双指捏合/滑动看图，拖标题栏移动窗口，左下角拖拽缩放窗口。</p>` +
        `<div class="at-player-strip">` +
          frames.map((item, idx) => {
            const stepCls = _atFrameStepClass(item);
            return `<button type="button" class="at-player-thumb ${idx === atReportFrameIndex ? "active" : ""} ${stepCls}" data-frame-idx="${idx}" title="点击放大预览">` +
            (item.thumb || item.image ? `<img src="${escapeAttr(item.thumb || item.image)}" alt="${escapeAttr(item.title || item.phase)}" />` : `<span class="at-thumb-ph">${escapeHtml(_atPhaseLabel(item.phase))}</span>`) +
            `<span>${escapeHtml(item.time || "")} · ${escapeHtml(_atPhaseLabel(item.phase))}</span></button>`;
          }).join("") +
        `</div>` +
      `</section>` +
      `<section class="at-detail-level at-detail-note ${_atFrameStepClass(frame)}">` +
        `<div class="at-detail-level-kicker">2 · 说明</div>` +
        `<div class="at-player-info"><div class="at-player-title">${escapeHtml(frame.title || _atPhaseLabel(frame.phase))} · ${escapeHtml(frame.time || "")}${frame.stepOk === false || frame.emphasis === "fail" ? ' <span class="at-badge at-fail">失败</span>' : ' <span class="at-badge at-pass">通过</span>'}</div>` +
        _atPlayerStepHtml(frame) +
        `</div>` +
      `</section>` +
    `</div>`;
  _atBindReportDetail(rep, savedId, frames);
  _atSyncFramePeek(frames);
}

function _atRenderReportPlayer(savedId) {
  const rep = document.getElementById("autoTestReport");
  if (!rep || !atLastReport) {
    return;
  }
  atLastReport = _atHydrateReport(atLastReport);
  const stats = _atReportCaseStats(atLastReport);
  const cycles = atLastReport.cycles || [];
  rep.classList.remove("hidden");
  if (atReportCycleNo != null) {
    const cycle = _atReportCycleByNo(atReportCycleNo);
    if (cycle) {
      _atRenderReportDetail(rep, savedId, cycle);
      return;
    }
    atReportCycleNo = null;
  }
  _atRenderReportList(rep, savedId, stats);
}

function _atEvaluateAssignmentResult(home, assignment, expect, issuedItem, opts) {
  opts = opts || {};
  const role = opts.role || "target";
  const isPeer = role === "peer";
  const dev = (home?.devices || []).find((item) => item.uid === assignment.uid);
  if (!dev) {
    return null;
  }
  const owner = classifyOwnerWorkModel(dev);
  const theory = owner ? owner.label : "—";
  const act = dev.ownerActual;
  const actLabel = act ? act.label : "—";
  const actOrder = _atStateLabel(act);
  const actPower = act ? act.cmdPowerW : null;
  const target = isPeer ? "" : (assignment.target || "");
  const hitTarget = isPeer ? true : (theory !== "—" && theory === target);
  const ex = expect?.byUid?.[dev.uid];
  let masterPass = null;
  let masterNote = "";
  let expOrder = "—";
  let expPower = null;
  let expBand = null;
  if (!ex) {
    masterNote = "无期望模型（未读到上报态）";
  } else if (!ex.determinable) {
    masterNote = ex.why;
    expOrder = ex.order;
    expPower = ex.powerW;
    expBand = ex.band;
  } else {
    expOrder = ex.order;
    expPower = ex.powerW;
    expBand = ex.band;
    const dirOk = actOrder === ex.order;
    const powOk = actPower != null && actPower >= ex.band[0] && actPower <= ex.band[1];
    masterPass = dirOk && powOk;
    masterNote =
      `期望 ${ex.order}/${ex.powerW}W(容 ${ex.band[0]}~${ex.band[1]}) · 实际 ${actOrder}/${actPower == null ? "—" : actPower}W` +
      (dirOk ? "" : " · 方向不符") +
      (powOk || !dirOk ? "" : " · 功率越界") +
      " · " +
      ex.why;
  }
  const ownerHit = owner?.reason ? `MCU首次命中「${owner.reason}」→ ${theory}` : `MCU首次命中 → ${theory}`;
  const l1Formula = isPeer
    ? `旁观机：本用例未指定目标，L1 不判。读回「${theory}」。`
    : `${ownerHit}；hitTarget = (读回态 === 目标态) = (${theory} ${hitTarget ? "==" : "!="} ${target})`;
  const issueErr = issuedItem?.err || null;
  let l2Formula = "";
  if (issueErr) {
    l2Formula = "下发失败，未检查 L2";
  } else if (!ex) {
    l2Formula = "无期望模型";
  } else if (!ex.determinable) {
    l2Formula = `determinable=false，不硬判。${ex.why || ""}`.trim();
  } else {
    const lo = Array.isArray(ex.band) ? ex.band[0] : "?";
    const hi = Array.isArray(ex.band) ? ex.band[1] : "?";
    const dirOk = actOrder === ex.order;
    const powOk = actPower != null && Number.isFinite(Number(lo)) && Number.isFinite(Number(hi))
      && actPower >= lo && actPower <= hi;
    const cat = ex.rep?.cat || "";
    const chg2Note = cat === "chg1"
      ? "本机=充电1，充2抑制管不到，期望始终为充。"
      : (cat === "chg2"
        ? (ex.order === "待机" ? "本机=充电2且已被抑制，期望待机。" : "本机=充电2且未抑制，期望充。")
        : (ex.why || ""));
    l2Formula =
      `${isPeer ? "旁观机仍按整家庭期望核对。" : ""}${chg2Note}` +
      ` ①方向：实际「${actOrder}」${dirOk ? "=" : "≠"}期望「${ex.order}」→${dirOk ? "过" : "不过"}；` +
      ` ②功率：允许区间 ${lo}~${hi}W，实际 ${actPower == null ? "—" : actPower}W →${powOk ? "落在区间内" : "超出区间"}；` +
      ` L2=${!!masterPass ? "通过" : "失败"}。` +
      `（期望点位 ${ex.powerW}W 只是中心参考，判定看区间不看单点）`;
  }
  const result = {
    uid: assignment.uid || dev.uid,
    device: assignment.device || dev.name || dev.deviceId,
    deviceId: assignment.deviceId || dev.deviceId,
    role,
    params: assignment.params || {},
    target: target || "—",
    coverageKey: assignment.coverageKey || "",
    theory,
    actLabel,
    actOrder,
    actPower,
    hitTarget,
    expOrder,
    expPower,
    expBand,
    bandCat: ex?.rep?.cat || (typeof _atCat === "function" ? _atCat(theory) : "") || "",
    chgCapW: ex?.rep?.chg ?? owner?.chgCapW ?? null,
    dchgCapW: ex?.rep?.dchg ?? owner?.dchgCapW ?? null,
    bandFormula: "",
    masterPass,
    masterNote,
    l1Formula,
    l2Formula,
    pass: isPeer ? (!issueErr && masterPass !== false) : (hitTarget && masterPass !== false),
    error: issueErr,
  };
  result.bandFormula = _atBandExplainLines(result, {
    chg2Suppressed: !!expect?.chg2Suppressed,
  }).filter((line) => line.kind === "eq").map((line) => line.text).join("；");
  result.failStage = _atResultFailStage(result);
  result.failTags = _atFailTags(result);
  result.failReason = _atFailReason({ ...result, failReason: "" });
  return result;
}

/**
 * @brief Evaluate whole-home L2; L1 only for devices this case targeted
 */
function _atEvaluateComboResult(home, cycle, expect) {
  const issuedMap = new Map((cycle.issued || []).map((item) => [item.uid, item]));
  const assignMap = new Map(_atCycleAssignments(cycle).map((item) => [item.uid, item]));
  const rows = [];
  const seen = new Set();
  for (const dev of home?.devices || []) {
    if (!dev?.uid) {
      continue;
    }
    seen.add(dev.uid);
    const assignment = assignMap.get(dev.uid) || {
      uid: dev.uid,
      deviceId: dev.deviceId,
      device: dev.name || dev.deviceId,
      target: "",
      coverageKey: "",
      params: {},
    };
    const role = assignMap.has(dev.uid) ? "target" : "peer";
    const row = _atEvaluateAssignmentResult(home, assignment, expect, issuedMap.get(dev.uid), { role });
    if (row) {
      rows.push(row);
    }
  }
  for (const assignment of assignMap.values()) {
    if (seen.has(assignment.uid)) {
      continue;
    }
    const row = _atEvaluateAssignmentResult(home, assignment, expect, issuedMap.get(assignment.uid), { role: "target" });
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

async function runAutoTest() {
  if (atRunning) return;
  const home = activeHome();
  if (!home) {
    toast("请先选择家庭", "error");
    return;
  }
  try {
    await refreshDeviceOnlineFlags(home);
  } catch (_) {}
  renderAutoRun();
  const selectedUids = _atEnsureSelected(home);
  if (!selectedUids.length) {
    const offlineN = (home.devices || []).filter((dev) => !deviceIsOnline(dev)).length;
    toast(
      offlineN
        ? `没有可执行设备：当前有 ${offlineN} 台离线，请先选在线设备`
        : "请至少选择一台设备",
      "error"
    );
    return;
  }
  const execPlan = buildAutoExecutionPlan(home, selectedUids, atSelectedTargets);
  _atEnsureCasePicks(execPlan.cycles || []);
  const picked = _atPickedCycles(execPlan.cycles || []);
  if (!picked.length) {
    toast("没有可执行的组合用例，请勾选设备、工况徽章，并在列表里勾选要跑的用例", "error");
    return;
  }
  const settle = Math.max(10, Number(document.getElementById("atSettle").value || 30));
  const restore = document.getElementById("atRestore").checked;
  const totalCycleN = Number.isFinite(execPlan.totalCycles) ? execPlan.totalCycles : execPlan.cycles.length;
  const truncTxt = execPlan.truncated ? `；总组合 ${totalCycleN} 条，当前仅加载前 ${execPlan.cycles.length} 条` : "";
  const ok = await appConfirm(
    `将执行 ${picked.length}/${execPlan.cycles.length} 条组合用例（${selectedUids.length} 台设备${truncTxt}）；每条用例按检查→快照→下发→运行拍照→checker→回收执行，并真实改设备参数。确认开始？`,
    { title: "开始自动化" }
  );
  if (!ok) {
    return;
  }
  atRunning = true;
  atPauseRequested = false;
  atUiFrozen = false;
  stopAutoRefreshTimer();
  atActiveReportId = null;
  atShowResults = true;
  atLastReport = null;
  atReportFrameIndex = 0;
  atReportOnlyFailures = false;
  atReportCycleNo = null;
  atReplayOpen = false;
  _atSetRunButtons();
  setAtInnerTab("run");
  document.getElementById("autoTestReport")?.classList.add("hidden");
  const tl = document.getElementById("autoTestTimeline");
  tl.classList.remove("hidden");
  tl.innerHTML = `<div class="at-scope-head at-timeline-head"><span class="at-scope-title">用例执行列表</span><span class="hint">完成后自动折叠，点标题可展开</span></div>`;
  _atBindTimelineFold(tl);
  _atSetProg(0, picked.length, "开始…");

  const fieldsToRestore = ["work_mode", "backup_soc", "output_power_limit", "inverter_input_power_limit", "regulation_grid_export_p_limit"];
  const orig = {};
  for (const dev of home.devices || []) {
    orig[dev.uid] = {};
    for (const key of fieldsToRestore) {
      orig[dev.uid][key] = dev.values?.[key] != null ? String(dev.values[key]) : "";
    }
  }

  const cycles = [];
  let paused = false;
  try {
    for (let idx = 0; idx < picked.length; idx++) {
      const step = picked[idx];
      if (atPauseRequested) {
        paused = true;
        break;
      }
      const cycle = {
        ...step,
        settle,
        tIssue: null,
        tObserve: null,
        issued: [],
        results: [],
        frames: [],
        failed: false,
        status: "running",
        step: "check",
      };
      cycles.push(cycle);
      renderCycleCard(cycle, "running");
      _atSetProg(idx, picked.length, `用例 ${cycle.no}（${idx + 1}/${picked.length}）· ${_atCycleLabel(cycle)}`);

      await _atReadDevices(home, _atCycleDevices(home, cycle));
      cycle.step = "before";
      cycle.tIssue = _nowHMS();
      await _atCaptureFrame(home, cycle, "before", {
        title: _atFrameTitleWithDevice("1. 开始前 · 家庭流向与设备状态", cycle),
        readScope: "family",
        stepOk: true,
        note: "下发前家庭各端口流向，以及各设备当前工况。",
      });

      cycle.step = "issue";
      await Promise.all(_atCycleAssignments(cycle).map(async (assignment) => {
        const dev = (home.devices || []).find((item) => item.uid === assignment.uid);
        if (!dev) {
          return;
        }
        for (const [k, v] of Object.entries(assignment.params || {})) {
          dev.drafts[k] = String(v);
        }
        let ok = true;
        let err = null;
        if (Object.keys(assignment.params || {}).length) {
          try {
            ok = await issueDevice(home, dev, { batch: true });
            if (!ok) {
              err = dev.error || "下发失败";
            }
          } catch (e) {
            ok = false;
            err = String(e.message || e);
          }
        }
        cycle.issued.push({
          device: assignment.device,
          deviceId: assignment.deviceId,
          uid: assignment.uid,
          target: assignment.target,
          params: { ...(assignment.params || {}) },
          from: Object.fromEntries(
            Object.keys(assignment.params || {}).map((key) => [key, orig[assignment.uid]?.[key] ?? ""])
          ),
          ok,
          err,
        });
      }));
      const issueFailed = _atIssueFailed(cycle);
      renderCycleCard(cycle, "running");
      await _atCaptureFrame(home, cycle, "issued", {
        title: _atFrameTitleWithDevice("2. 下发参数", cycle),
        readScope: "family",
        stepOk: !issueFailed,
        issued: cycle.issued.map((item) => ({ ...item })),
        note: issueFailed
          ? "下发失败，跳过后续运行/检查，直接进入回收。"
          : (cycle.issued.some((item) => Object.keys(item.params || {}).length)
            ? "已按下表参数下发到各设备。"
            : "各设备已是目标工况，无需改参。"),
      });

      if (issueFailed) {
        cycle.issueFailed = true;
        cycle.failed = true;
        cycle.results = _atResultsFromIssueFail(cycle);
        cycle.tObserve = _nowHMS();
        cycle.step = "collect";
        if (restore) {
          await _atRunCycleRestore(home, cycle, orig, fieldsToRestore);
        }
        cycle.step = "done";
        cycle.status = "fail";
        renderCycleCard(cycle, "done fail");
        _atSetProg(idx + 1, picked.length, `用例 ${cycle.no}（${idx + 1}/${picked.length}）下发失败`);
        if (atPauseRequested) {
          paused = true;
          break;
        }
        continue;
      }

      cycle.step = "runtime";
      const midDelayMs = Math.max(1000, Math.floor((settle * 1000) / 2));
      _atSetProg(idx, picked.length, `用例 ${cycle.no}（${idx + 1}/${picked.length}）· 等待运行时态`);
      await _atSleep(midDelayMs);
      await _atCaptureFrame(home, cycle, "mid", {
        title: _atFrameTitleWithDevice("3. 运行中 · 家庭流向", cycle),
        readScope: "family",
        stepOk: true,
        note: atPauseRequested ? "已收到暂停，提前进入检查。" : "观察窗口中点的家庭流向和设备状态。",
      });
      if (!atPauseRequested) {
        await _atSleep(Math.max(0, settle * 1000 - midDelayMs));
      }

      cycle.step = "checker";
      await _atReadDevices(home, home.devices || []);
      const expect = computeMasterExpect(home, _atMasterOpts());
      const homeFlow = _atHomeFlow(home);
      const familyL3 = _atEvalFamilyL3(homeFlow);
      cycle.chg2Suppressed = expect.chg2Suppressed;
      cycle.homeFlow = homeFlow;
      cycle.familyL3 = familyL3;
      cycle.masterExpect = { ..._atExpectMetaBrief(expect, home), l3: familyL3 };
      cycle.results = _atEvaluateComboResult(home, cycle, expect);
      cycle.failed = cycle.results.some((item) => !item.pass || !!item.error) || familyL3.pass === false;
      const tCheck = Date.now();
      cycle.tObserve = _nowHMS(tCheck);
      const checkSnap = {
        at: tCheck,
        time: cycle.tObserve,
        familyState: _atFamilyState(home),
        homeFlow,
      };
      await _atCaptureFrame(home, cycle, "observe", {
        title: _atFrameTitleWithDevice(cycle.failed ? "4. 检查结果 · 失败" : "4. 检查结果 · 通过", cycle),
        stepOk: !cycle.failed,
        note: cycle.failed
          ? `${_atFailLines(cycle.results).length}/${cycle.results.length} 台设备失败` +
            (familyL3.pass === false
              ? ` · L3${familyL3.reverseFlow ? "逆流" : ""}${familyL3.bothWay ? (familyL3.reverseFlow ? "+边充边放" : "边充边放") : ""}`
              : "")
          : `${cycle.results.length} 台通过 · L3 正常`,
        checkerState: cycle.results,
        masterExpect: cycle.masterExpect,
        emphasis: cycle.failed ? "fail" : "",
        ...checkSnap,
      });
      if (cycle.failed) {
        await _atCaptureFrame(home, cycle, "fail-focus", {
          title: _atFrameTitleWithDevice("失败回溯", cycle),
          stepOk: false,
          note: `${_atFailLines(cycle.results).length}/${cycle.results.length} 台失败` +
            (familyL3.pass === false ? " · L3 家庭异常" : ""),
          checkerState: cycle.results,
          masterExpect: cycle.masterExpect,
          emphasis: "fail",
          ...checkSnap,
        });
      }

      cycle.step = "collect";
      if (restore) {
        await _atRunCycleRestore(home, cycle, orig, fieldsToRestore);
      }

      cycle.step = "done";
      cycle.status = cycle.failed ? "fail" : "done";
      renderCycleCard(cycle, cycle.failed ? "done fail" : "done");
      _atSetProg(idx + 1, picked.length, `用例 ${cycle.no}（${idx + 1}/${picked.length}）完成`);
      if (atPauseRequested) {
        paused = true;
        break;
      }
    }
  } finally {
    atRunning = false;
    atPauseRequested = false;
    atUiFrozen = false;
    syncAutoRefreshTimer();
    _atSetRunButtons();
  }
  await finishAutoTest(home, cycles, settle, {
    paused,
    planned: picked.length,
  });
}

async function finishAutoTest(home, cycles, settle, extra = {}) {
  const paused = !!extra.paused;
  const planned = extra.planned != null ? extra.planned : cycles.length;
  const flat = cycles.flatMap((c) => c.results || []);
  const pass = flat.filter((r) => r.pass).length;
  const fail = flat.length - pass;
  const l1ok = flat.filter((r) => r.hitTarget).length;
  const l2j = flat.filter((r) => r.masterPass !== null);
  const l2ok = l2j.filter((r) => r.masterPass).length;
  const status = paused ? "paused" : "done";
  const md = _atReportMd(home, cycles, settle);
  const csv = _atReportCsv(cycles);
  let savedId = atActiveReportId || null;
  let reportJson = null;
  try {
    reportJson = _atReportPayload(home, cycles, settle, savedId, { status, planned, reportId: savedId });
    const { json: j } = await CaseApi.saveReport({
        id: savedId,
        name: `${home.homeId || "home"}`,
        title: `${paused ? "自动回归(暂停)" : "自动回归"} · ${home.name || home.homeId}`,
        homeId: home.homeId || home.uid || "",
        homeName: home.name || "",
        summary: `${paused ? "暂停" : "完成"} ${cycles.length}/${planned} 用例 · ${flat.length} 组 · 通过 ${pass} · 失败 ${fail}`,
        status,
        planned,
        done: cycles.length,
        total: flat.length,
        passed: pass,
        failed: fail,
        markdown: md,
        csv,
        reportJson: _atPersistableReport(reportJson),
      });
    savedId = j.id;
    atActiveReportId = savedId;
    if (savedId) {
      try {
        const loaded = await CaseApi.getReport(savedId, "json");
        if (loaded.json?.report) {
          reportJson = loaded.json.report;
        }
      } catch (_) {}
    }
  } catch (e) {
    toast(`报告保存失败：${e.message || e}`, "error");
  }
  atLastReport = reportJson || _atReportPayload(home, cycles, settle, savedId, { status, planned });
  atLastReport.id = savedId;
  atReportCycleNo = null;
  atReportFrameIndex = 0;
  document.getElementById("autoTestProgress")?.classList.add("hidden");
  setAtInnerTab("report");
  _atRenderReportPlayer(savedId);
  toast(
    paused
      ? `已暂停并保存：${cycles.length}/${planned} 用例 · 通过 ${pass}/${flat.length}。可在「报告」里回放`
      : `测试完成：${cycles.length} 用例 · 通过 ${pass}/${flat.length}`,
    fail ? "error" : "ok"
  );
}

function openLoginDialog(forceHost) {
  const home = activeHome();
  const host =
    (typeof forceHost === "string" && forceHost) || home?.envHost || Object.keys(ENV_CONFIG)[1];
  fillEnvSelect(document.getElementById("loginEnv"), host, true);
  document.getElementById("loginCookie").value = state.cookies[host] || "";
  const onLocal = isLocalHostPage();
  const pushRow = document.getElementById("remotePushRow");
  const autoBtn = document.getElementById("btnAutoCookie");
  if (pushRow) pushRow.classList.toggle("hidden", !onLocal);
  if (autoBtn) autoBtn.classList.toggle("hidden", !onLocal);
  const urlInput = document.getElementById("remotePushUrl");
  if (urlInput && onLocal) {
    try {
      urlInput.value =
        localStorage.getItem(REMOTE_PUSH_URL_KEY) || DEFAULT_REMOTE_PUSH_URL;
    } catch (_) {
      urlInput.value = DEFAULT_REMOTE_PUSH_URL;
    }
  }
  document.getElementById("loginHint").textContent = state.cookies[host]
    ? onLocal
      ? "已保存 Cookie。可「自动获取」刷新，或「推送到虚拟机」同步给别人用的服务。"
      : "已保存 Cookie。虚拟机端请用本机推送更新，或在此手动粘贴覆盖。"
    : onLocal
      ? "推荐：本机「自动获取」→「推送到虚拟机」。也可手动从 DevTools 粘贴。"
      : "虚拟机无法读你电脑的 Chrome。请在本机 http://127.0.0.1:5178 自动获取后点「推送到虚拟机」，或在此手动粘贴。";
  document.getElementById("dlgLogin").showModal();
}

/**
 * Pull SSO_USER_TOKEN via server-side tuya-sso-token (local Chrome only).
 * @param {{force?: boolean, quiet?: boolean, skipRender?: boolean, host?: string}} opts
 */
async function refreshSsoCookie(opts = {}) {
  const force = !!opts.force;
  const quiet = !!opts.quiet;
  const skipRender = !!opts.skipRender;
  const host =
    opts.host ||
    document.getElementById("loginEnv")?.value ||
    activeHome()?.envHost ||
    Object.keys(ENV_CONFIG)[1];
  const onLocal = isLocalHostPage();
  if (!onLocal) {
    const msg =
      "虚拟机页面不支持自动获取。请在本机打开 http://127.0.0.1:5178，自动获取后点「推送到虚拟机」，或在此手动粘贴 Cookie";
    if (!quiet) toast(msg, "error");
    const hint = document.getElementById("loginHint");
    if (hint) hint.textContent = msg;
    throw new Error(msg);
  }

  const payload = {
    force,
    host,
    applyAll: true,
    url: host ? `https://${host}` : "",
  };

  const { json } = await CaseApi.refreshSso(payload);
  if (!json.ok) {
    let msg = json.error || "自动获取失败";
    if (json.hint) msg = `${msg}（${json.hint}）`;
    if (!quiet) toast(msg, "error");
    const hint = document.getElementById("loginHint");
    if (hint) {
      hint.textContent = json.detail
        ? `${msg}（${String(json.detail).slice(0, 180)}）`
        : msg;
    }
    throw new Error(msg);
  }
  if (json.cookies && typeof json.cookies === "object") {
    state.cookies = { ...state.cookies, ...json.cookies };
  }
  const ta = document.getElementById("loginCookie");
  if (ta && host) ta.value = state.cookies[host] || "";
  const n = (json.appliedHosts || []).length;
  if (!quiet) {
    toast(
      `已自动填入 SSO（${n} 个环境）${json.preview ? " · " + json.preview : ""}`,
      "ok"
    );
  }
  const hint = document.getElementById("loginHint");
  if (hint && !skipRender) {
    hint.textContent = `已自动更新 SSO_USER_TOKEN（来源：${
      json.source || "sso-token"
    }）。需要同步虚拟机时再点「推送到虚拟机」。`;
  }
  persist();
  if (!skipRender) render();
  return json;
}

/**
 * Push local cookies to a remote groupAppControl (VM).
 * @param {{url?: string, refreshFirst?: boolean, quiet?: boolean}} opts
 */
async function pushCookiesToRemote(opts = {}) {
  const quiet = !!opts.quiet;
  if (!isLocalHostPage()) {
    const msg = "请在本机页面执行推送";
    if (!quiet) toast(msg, "error");
    throw new Error(msg);
  }
  if (opts.refreshFirst) {
    await refreshSsoCookie({ force: true, quiet: true, skipRender: true });
  }
  const remote = (opts.url || getRemotePushUrl()).replace(/\/$/, "");
  if (!remote) {
    const msg = "请填写虚拟机地址，例如 http://172.16.239.236:5178";
    if (!quiet) toast(msg, "error");
    throw new Error(msg);
  }
  try {
    localStorage.setItem(REMOTE_PUSH_URL_KEY, remote);
  } catch (_) {
    /* ignore */
  }
  const cookies = state.cookies || {};
  const n = Object.keys(cookies).filter((k) => String(cookies[k] || "").trim()).length;
  if (!n) {
    const msg = "本机尚无 Cookie，请先「自动获取」或粘贴保存";
    if (!quiet) toast(msg, "error");
    throw new Error(msg);
  }
  let res;
  let json = {};
  try {
    ({ res, json } = await CaseApi.importCookies(remote, cookies, true));
  } catch (err) {
    const msg = `连不上虚拟机 ${remote}（${err?.message || err}）`;
    if (!quiet) toast(msg, "error");
    throw new Error(msg);
  }
  if (!res.ok || !json.ok) {
    const msg = json.error || `推送失败 HTTP ${res.status}`;
    if (!quiet) toast(msg, "error");
    throw new Error(msg);
  }
  const imported = json.imported ?? n;
  if (!quiet) toast(`已推送 ${imported} 条 Cookie → ${remote}`, "ok");
  const hint = document.getElementById("loginHint");
  if (hint) hint.textContent = `已推送到 ${remote}（合并写入虚拟机 store）。`;
  return json;
}

function openHomeDialog(home) {
  editingHomeUid = home?.uid || null;
  const isEdit = !!home;
  document.getElementById("dlgHomeTitle").textContent = isEdit ? "编辑家庭" : "新增家庭";
  const envSel = document.getElementById("homeEnv");
  fillEnvSelect(envSel, home?.envHost || "newenergy-operation-cn.tuya-inc.com", false);
  envSel.disabled = isEdit;
  const hint = document.getElementById("homeEnvHint");
  if (hint) hint.hidden = !isEdit;
  document.getElementById("homeId").value = home?.homeId || "";
  document.getElementById("homeName").value = home?.name || "";
  document.getElementById("dlgHome").showModal();
}

function openDeviceDialog(device) {
  editingDeviceUid = device?.uid || null;
  document.getElementById("dlgDeviceTitle").textContent = device ? "编辑设备" : "新增设备";
  document.getElementById("deviceId").value = device?.deviceId || "";
  document.getElementById("deviceName").value = device?.name || "";
  document.getElementById("dlgDevice").showModal();
}

function syncMeterDialogMode() {
  const isThird = document.getElementById("meterThirdParty")?.value === "1";
  const idWrap = document.getElementById("meterIdWrap");
  const devWrap = document.getElementById("meterDeviceWrap");
  const meterId = document.getElementById("meterId");
  const meterSel = document.getElementById("meterDeviceSelect");
  const hint = document.getElementById("meterDlgHint");
  const regionHint = document.getElementById("meterRegionHint");
  idWrap?.classList.toggle("hidden", isThird);
  devWrap?.classList.toggle("hidden", !isThird);
  if (meterId) meterId.required = !isThird;
  if (meterSel) meterSel.required = isThird;
  if (hint) {
    hint.innerHTML = isThird
      ? "三方电表：选择一台一体机，实时/历史功率取该机 <code>dp 26 / grid_power</code>（局域网电表配对功率 / meter_power）。"
      : "PID 固定为 <code>7sndpedu8g2tkzvi</code>，功率曲线走 Hestia bizlog（dpId 29 / active_power）。";
  }
  if (regionHint) {
    regionHint.classList.toggle("hidden", isThird);
  }
}

function fillMeterDeviceSelect(home, selectedId) {
  const sel = document.getElementById("meterDeviceSelect");
  if (!sel) return;
  const devices = home?.devices || [];
  sel.innerHTML =
    `<option value="">请选择一体机</option>` +
    devices
      .map(
        (d) =>
          `<option value="${escapeAttr(d.deviceId)}" ${
            String(selectedId || "") === String(d.deviceId) ? "selected" : ""
          }>${escapeHtml(d.name || d.deviceId)}（${escapeHtml(d.deviceId)}）</option>`
      )
      .join("");
  if (!devices.length) {
    sel.innerHTML = `<option value="">家庭内暂无一体机，请先添加设备</option>`;
  }
}

function openMeterDialog(meter) {
  editingMeterUid = meter?.uid || null;
  const home = activeHome();
  document.getElementById("dlgMeterTitle").textContent = meter ? "编辑电表" : "添加电表";
  const isThird = !!meter?.isThirdParty;
  document.getElementById("meterThirdParty").value = isThird ? "1" : "0";
  document.getElementById("meterId").value = isThird ? "" : meter?.deviceId || "";
  document.getElementById("meterName").value = meter?.name || "";
  fillMeterDeviceSelect(home, isThird ? meter?.deviceId : "");
  syncMeterDialogMode();
  const hint = document.getElementById("meterRegionHint");
  if (hint && home && !isThird) {
    const hHost = hestiaHostForHome(home);
    hint.textContent = `Hestia 区域随家庭环境自动跟随：${envLabel(home.envHost)} → ${hHost}`;
  }
  document.getElementById("dlgMeter").showModal();
}

/* ---------- Schedule dialog: manual (按星期) / time_of_use (分时, 无星期) ---------- */

const MS_DAYS = [
  { key: "mon", label: "周一" },
  { key: "tue", label: "周二" },
  { key: "wed", label: "周三" },
  { key: "thu", label: "周四" },
  { key: "fri", label: "周五" },
  { key: "sat", label: "周六" },
  { key: "sun", label: "周日" },
];
const MS_KIND_MANUAL = "manual";
const MS_KIND_TOU = "time_of_use";
const MS_TOU_DAY = "tou";
const MS_SLOT_N = 8;
const MS_FIELDS = ["start", "end", "mode", "power", "soc", "pv_abandon", "ignore_anti_backflow"];
const MS_MODE_CHARGE = "0";
const MS_MODE_DISCHARGE = "1";
const MS_FUNC_BATCH = 20; // function_set raw maxlen 128 ≈ 21 entries

/** @type {any} */
let msCtx = null;

function msIsTou() {
  return msCtx?.kind === MS_KIND_TOU;
}

function msDayKeys(kind = msCtx?.kind) {
  return kind === MS_KIND_TOU ? [MS_TOU_DAY] : MS_DAYS.map((d) => d.key);
}

function msCode(day, slotIdx, field, kind = msCtx?.kind) {
  if (kind === MS_KIND_TOU) return `day_time${slotIdx + 1}_${field}`;
  return `user_${day}_day_time${slotIdx + 1}_${field}`;
}

function msEmptySlot() {
  return {
    start: "0000",
    end: "0000",
    mode: MS_MODE_CHARGE,
    power: "0",
    soc: "80",
    pv_abandon: false,
    ignore_anti_backflow: false,
  };
}

function msEmptyWeek(kind = MS_KIND_MANUAL) {
  const week = {};
  for (const key of msDayKeys(kind)) {
    week[key] = Array.from({ length: MS_SLOT_N }, () => msEmptySlot());
  }
  return week;
}

function msCloneWeek(week) {
  return JSON.parse(JSON.stringify(week));
}

/** HHMM string ↔ input[type=time] HH:MM */
function msHmmToTime(hmm) {
  const s = String(hmm || "0000").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

function msTimeToHmm(t) {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "0000";
  const h = Math.max(0, Math.min(23, Number(m[1])));
  const min = Math.max(0, Math.min(59, Number(m[2])));
  return `${String(h).padStart(2, "0")}${String(min).padStart(2, "0")}`;
}

/** register3_hourmin_1: high byte = hour, low byte = minute (e.g. 03:30 → 0x031e) */
function msHmmToReg(hmm) {
  const s = String(hmm || "0000").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  let h = Number(s.slice(0, 2));
  let m = Number(s.slice(2, 4));
  if (h === 24 && m === 0) {
    // 24:00 → end of day; store as 24:00 if device accepts, else 23:59
    return (24 << 8) | 0;
  }
  h = Math.max(0, Math.min(23, h));
  m = Math.max(0, Math.min(59, m));
  return ((h & 0xff) << 8) | (m & 0xff);
}

function msParseBool(v) {
  if (v === true || v === 1 || v === "1" || v === "true" || v === "True") return true;
  return false;
}

function msSlotFromProps(byCode, day, slotIdx, kind) {
  const slot = msEmptySlot();
  const get = (f) => byCode[msCode(day, slotIdx, f, kind)];
  const start = get("start");
  const end = get("end");
  const mode = get("mode");
  const power = get("power");
  const soc = get("soc");
  const pv = get("pv_abandon");
  const ign = get("ignore_anti_backflow");
  if (start?.value != null && start.value !== "") slot.start = String(start.value).padStart(4, "0").slice(-4);
  if (end?.value != null && end.value !== "") slot.end = String(end.value).padStart(4, "0").slice(-4);
  if (mode?.value != null && mode.value !== "") slot.mode = String(mode.value);
  if (power?.value != null && power.value !== "") slot.power = String(power.value);
  if (soc?.value != null && soc.value !== "") slot.soc = String(soc.value);
  if (pv) slot.pv_abandon = msParseBool(pv.value);
  if (ign) slot.ignore_anti_backflow = msParseBool(ign.value);
  return slot;
}

function msParsePropertyList(items, kind = MS_KIND_MANUAL) {
  const byCode = {};
  const meta = {};
  for (const it of items || []) {
    const code = it?.code;
    if (!code) continue;
    let ok = false;
    if (kind === MS_KIND_TOU) {
      ok = /^day_time[1-8]_/.test(code);
    } else {
      ok = code.startsWith("user_") && code.includes("_day_time") && !code.startsWith("user_day_time");
    }
    if (!ok) continue;
    byCode[code] = it;
    const addr = parseRegAddr(it.model?.strategySpec);
    if (addr != null) {
      meta[code] = {
        addr,
        dataType: it.model?.dataType || it.model?.dataSpec?.type || "",
        strategyType: it.model?.strategySpec?.type || "",
      };
    }
  }
  const week = msEmptyWeek(kind);
  for (const day of msDayKeys(kind)) {
    for (let i = 0; i < MS_SLOT_N; i++) {
      week[day][i] = msSlotFromProps(byCode, day, i, kind);
    }
  }
  return { week, meta };
}

function msFieldRegValue(field, slot) {
  if (field === "start" || field === "end") return msHmmToReg(slot[field]);
  if (field === "mode") return Number(slot.mode) || 0;
  if (field === "power") return Math.max(0, Math.min(65535, Math.round(Number(slot.power) || 0)));
  if (field === "soc") return Math.max(0, Math.min(100, Math.round(Number(slot.soc) || 0)));
  if (field === "pv_abandon" || field === "ignore_anti_backflow") return slot[field] ? 1 : 0;
  return 0;
}

function msFieldEqual(field, a, b) {
  if (field === "pv_abandon" || field === "ignore_anti_backflow") {
    return !!a === !!b;
  }
  return String(a ?? "") === String(b ?? "");
}

function msCollectDirtyEntries(week, baseline, meta, kind = msCtx?.kind) {
  const entries = [];
  for (const day of msDayKeys(kind)) {
    for (let i = 0; i < MS_SLOT_N; i++) {
      const cur = week[day][i];
      const base = baseline?.[day]?.[i] || msEmptySlot();
      const slotDirty = MS_FIELDS.some((field) => !msFieldEqual(field, cur[field], base[field]));
      // 时段有任意改动时，整段字段一并下发（含未勾选的弃光/忽略防逆流 → 写 0/false）
      if (!slotDirty) continue;
      for (const field of MS_FIELDS) {
        const code = msCode(day, i, field, kind);
        const m = meta[code];
        if (!m || m.addr == null) {
          console.warn("schedule missing reg", code);
          continue;
        }
        entries.push({ code, addr: m.addr, value: msFieldRegValue(field, cur), signed: false });
      }
    }
  }
  return entries;
}

/* ---- timeline helpers (00:00–24:00, snap 15min, max 8 active) ---- */

const MS_DAY_MIN = 24 * 60;
const MS_SNAP = 15;

function msHmmToMin(hmm) {
  const s = String(hmm || "0000").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  const h = Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  if (h === 24 && m === 0) return MS_DAY_MIN;
  return Math.max(0, Math.min(MS_DAY_MIN - 1, h * 60 + m));
}

function msMinToHmm(min) {
  let n = Math.round(Number(min) || 0);
  if (n >= MS_DAY_MIN) return "2400";
  n = Math.max(0, Math.min(MS_DAY_MIN - 1, n));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

function msMinToLabel(min) {
  const hmm = msMinToHmm(min);
  if (hmm === "2400") return "24:00";
  return msHmmToTime(hmm);
}

function msSnapMin(min) {
  return Math.max(0, Math.min(MS_DAY_MIN, Math.round(min / MS_SNAP) * MS_SNAP));
}

function msIsActiveSlot(slot) {
  return !!msSlotRange(slot);
}

/** Active if start < end in minutes. Unused slots are 0000–0000. */
function msSlotRange(slot) {
  if (!slot) return null;
  if (slot.start === "0000" && (slot.end === "0000" || slot.end === "0")) return null;
  const a = msHmmToMin(slot.start);
  let b = msHmmToMin(slot.end);
  if (slot.end === "2400") b = MS_DAY_MIN;
  if (b <= a) return null;
  return { start: a, end: b };
}

function msActiveCount(dayKey) {
  const slots = msCtx?.week?.[dayKey] || [];
  return slots.filter((s) => msSlotRange(s)).length;
}

function msFirstFreeSlotIdx(dayKey) {
  const slots = msCtx?.week?.[dayKey] || [];
  for (let i = 0; i < slots.length; i++) {
    if (!msSlotRange(slots[i])) return i;
  }
  return -1;
}

function msEnsureSelected() {
  if (!msCtx) return;
  const slots = msCtx.week[msCtx.day] || [];
  if (msCtx.selectedIdx != null && msSlotRange(slots[msCtx.selectedIdx])) return;
  const first = slots.findIndex((s) => msSlotRange(s));
  msCtx.selectedIdx = first >= 0 ? first : null;
}

function msClearSlot(slot) {
  Object.assign(slot, msEmptySlot());
}

/** Clamp [start,end] against other active slots; returns null if too short / blocked. */
function msClampRange(dayKey, start, end, selfIdx) {
  let a = msSnapMin(Math.min(start, end));
  let b = msSnapMin(Math.max(start, end));
  a = Math.max(0, Math.min(a, MS_DAY_MIN - MS_SNAP));
  b = Math.max(a + MS_SNAP, Math.min(b, MS_DAY_MIN));
  const others = (msCtx.week[dayKey] || [])
    .map((s, i) => ({ i, r: msSlotRange(s) }))
    .filter((x) => x.r && x.i !== selfIdx)
    .sort((p, q) => p.r.start - q.r.start);
  for (const o of others) {
    if (!(a < o.r.end && b > o.r.start)) continue;
    // completely covering or inside other → reject
    if (a <= o.r.start && b >= o.r.end) return null;
    if (a >= o.r.start && b <= o.r.end) return null;
    if (a < o.r.start) b = Math.min(b, o.r.start);
    else a = Math.max(a, o.r.end);
  }
  if (b - a < MS_SNAP) return null;
  return { start: a, end: b };
}

function msApplyRangeToSlot(slot, range) {
  slot.start = msMinToHmm(range.start);
  slot.end = range.end >= MS_DAY_MIN ? "2400" : msMinToHmm(range.end);
}

function msClientToMin(trackEl, clientX) {
  const rect = trackEl.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
  return msSnapMin((x / Math.max(1, rect.width)) * MS_DAY_MIN);
}

function renderMsTimeline() {
  const host = document.getElementById("msTimeline");
  if (!host || !msCtx) return;
  const slots = msCtx.week[msCtx.day] || [];
  const activeN = msActiveCount(msCtx.day);
  const ticks = [0, 6, 12, 18, 24].map(
    (h) =>
      `<span class="ms-tick" style="left:${(h / 24) * 100}%"><i></i>${String(h).padStart(2, "0")}:00</span>`
  );
  const segs = slots
    .map((slot, i) => {
      const r = msSlotRange(slot);
      if (!r) return "";
      const left = (r.start / MS_DAY_MIN) * 100;
      const width = ((r.end - r.start) / MS_DAY_MIN) * 100;
      const isChg = String(slot.mode) === MS_MODE_CHARGE;
      const sel = msCtx.selectedIdx === i ? " selected" : "";
      const kind = isChg ? "chg" : "dchg";
      const label = isChg ? `充 ${slot.soc}%` : `放 ${slot.power}W · ${slot.soc}%`;
      return `<div class="ms-seg ${kind}${sel}" data-ms-seg="${i}" style="left:${left}%;width:${width}%" title="时段${i + 1} ${msMinToLabel(r.start)}–${msMinToLabel(r.end)}">
        <span class="ms-seg-label">${label}</span>
        <i class="ms-handle ms-handle-l" data-ms-handle="start" data-ms-seg="${i}"></i>
        <i class="ms-handle ms-handle-r" data-ms-handle="end" data-ms-seg="${i}"></i>
      </div>`;
    })
    .join("");
  host.innerHTML = `
    <div class="ms-timeline-meta">
      <span class="ms-count"><b>${activeN}</b> / ${MS_SLOT_N} 段</span>
      <span class="ms-tip">拖拽空白添加 · 点选编辑 · 拖边缘调时长</span>
    </div>
    <div class="ms-timeline" id="msTrack">
      <div class="ms-track-line"></div>
      ${ticks.join("")}
      ${segs}
      <div class="ms-ghost hidden" id="msGhost"></div>
    </div>`;
}

function renderMsEditor() {
  const slotsEl = document.getElementById("msSlots");
  if (!slotsEl || !msCtx) return;
  const i = msCtx.selectedIdx;
  const slots = msCtx.week[msCtx.day] || [];
  if (i == null || !msSlotRange(slots[i])) {
    slotsEl.innerHTML = `<div class="ms-editor-empty">
      <div class="ms-empty-icon" aria-hidden="true"></div>
      <p>在时间轴上拖拽添加时段</p>
      <p class="hint">最多 ${MS_SLOT_N} 段 · 选中色块后在此配置参数</p>
    </div>`;
    return;
  }
  const slot = slots[i];
  const range = msSlotRange(slot);
  const isChg = String(slot.mode) === MS_MODE_CHARGE;
  const rangeLabel = range
    ? `${msMinToLabel(range.start)} – ${msMinToLabel(range.end)}`
    : "";
  const codeHint = escapeHtml(msCode(msCtx.day, i, "soc"));
  const socField = `<div class="ms-field">
        <div class="ms-field-main">
          <span class="ms-k">目标 SOC</span>
          <span class="ms-v ms-v-num">
            <input type="number" min="0" max="100" step="1" data-ms-slot="${i}" data-ms-field="soc" value="${escapeAttr(slot.soc)}" />
            <span class="ms-unit">%</span>
          </span>
        </div>
        <p class="ms-desc">物模型 <code>${codeHint}</code></p>
      </div>`;
  const params = isChg
    ? `${socField}
      <div class="ms-field ms-toggle">
        <div class="ms-field-main">
          <div>
            <span class="ms-k">弃光</span>
            <p class="ms-desc">需要完全用电网充电时开启</p>
          </div>
          <label class="ms-switch">
            <input type="checkbox" data-ms-slot="${i}" data-ms-field="pv_abandon" ${slot.pv_abandon ? "checked" : ""} />
            <span></span>
          </label>
        </div>
      </div>`
    : `<div class="ms-field">
        <div class="ms-field-main">
          <span class="ms-k">放电功率</span>
          <span class="ms-v ms-v-num">
            <input type="number" min="0" max="65535" step="1" data-ms-slot="${i}" data-ms-field="power" value="${escapeAttr(slot.power)}" />
            <span class="ms-unit">W</span>
          </span>
        </div>
        <p class="ms-desc">本时段按设定功率向家庭输出</p>
      </div>
      ${socField}
      <div class="ms-field ms-toggle">
        <div class="ms-field-main">
          <div>
            <span class="ms-k">忽略防逆流</span>
            <p class="ms-desc">防逆流开启时，可能降功率或停放</p>
          </div>
          <label class="ms-switch">
            <input type="checkbox" data-ms-slot="${i}" data-ms-field="ignore_anti_backflow" ${slot.ignore_anti_backflow ? "checked" : ""} />
            <span></span>
          </label>
        </div>
      </div>
      <div class="ms-field ms-toggle">
        <div class="ms-field-main">
          <div>
            <span class="ms-k">弃光</span>
            <p class="ms-desc">优先执行放电策略时可开启</p>
          </div>
          <label class="ms-switch">
            <input type="checkbox" data-ms-slot="${i}" data-ms-field="pv_abandon" ${slot.pv_abandon ? "checked" : ""} />
            <span></span>
          </label>
        </div>
      </div>`;

  slotsEl.innerHTML = `<section class="ms-editor" data-slot="${i}">
    <header class="ms-ed-head">
      <div class="ms-ed-title">
        <span class="ms-ed-badge ${isChg ? "chg" : "dchg"}">时段 ${i + 1}</span>
        <span class="ms-ed-range">${escapeHtml(rangeLabel)}</span>
        <code class="ms-ed-code">${escapeHtml(msCode(msCtx.day, i, "*").replace("_*", "_*"))}</code>
      </div>
      <button type="button" class="btn btn-sm btn-ghost ms-del" data-ms-del="${i}">删除</button>
    </header>
    <div class="ms-ed-grid">
      <div class="ms-ed-cell">
        <span class="ms-label">开始</span>
        <input type="time" data-ms-slot="${i}" data-ms-field="start" value="${escapeAttr(msHmmToTime(slot.start === "2400" ? "0000" : slot.start))}" />
      </div>
      <div class="ms-ed-cell">
        <span class="ms-label">结束</span>
        <input type="time" data-ms-slot="${i}" data-ms-field="end" value="${escapeAttr(slot.end === "2400" ? "23:59" : msHmmToTime(slot.end))}" />
      </div>
      <div class="ms-ed-cell ms-ed-mode">
        <span class="ms-label">模式</span>
        <div class="ms-seg-ctrl" role="group">
          <button type="button" class="ms-seg-opt ${isChg ? "on chg" : ""}" data-ms-slot="${i}" data-ms-mode="${MS_MODE_CHARGE}">充电</button>
          <button type="button" class="ms-seg-opt ${!isChg ? "on dchg" : ""}" data-ms-slot="${i}" data-ms-mode="${MS_MODE_DISCHARGE}">放电</button>
        </div>
      </div>
    </div>
    <div class="ms-ed-params">${params}</div>
  </section>`;
}

function renderManualScheduleDialog() {
  if (!msCtx) return;
  const daysEl = document.getElementById("msDays");
  if (!daysEl) return;
  if (msIsTou()) {
    daysEl.classList.add("hidden");
    daysEl.innerHTML = "";
  } else {
    daysEl.classList.remove("hidden");
    daysEl.innerHTML = MS_DAYS.map(
      (d) =>
        `<button type="button" class="ms-day-btn ${msCtx.day === d.key ? "active" : ""}" data-ms-day="${d.key}">${d.label}</button>`
    ).join("");
  }
  msEnsureSelected();
  renderMsTimeline();
  renderMsEditor();
}

function msApplyField(slotIdx, field, raw) {
  if (!msCtx) return;
  const slot = msCtx.week[msCtx.day][slotIdx];
  if (!slot) return;
  if (field === "start" || field === "end") {
    slot[field] = msTimeToHmm(raw);
    // keep range valid
    const r = msSlotRange(slot);
    if (!r) {
      // try interpret end before start as invalid — leave and let clamp on blur via timeline
    } else {
      const clamped = msClampRange(msCtx.day, r.start, r.end, slotIdx);
      if (clamped) msApplyRangeToSlot(slot, clamped);
    }
    renderMsTimeline();
  } else if (field === "mode") {
    slot.mode = String(raw);
  } else if (field === "power" || field === "soc") {
    slot[field] = String(raw);
  } else if (field === "pv_abandon" || field === "ignore_anti_backflow") {
    slot[field] = !!raw;
  }
}

function msBindTimelinePointer() {
  const dlg = document.getElementById("dlgManualSchedule");
  if (!dlg || dlg.dataset.tlBound === "1") return;
  dlg.dataset.tlBound = "1";

  const onMove = (e) => {
    if (!msCtx?.drag) return;
    const track = document.getElementById("msTrack");
    if (!track) return;
    const cur = msClientToMin(track, e.clientX);
    const d = msCtx.drag;
    if (d.type === "create") {
      const ghost = document.getElementById("msGhost");
      const a = Math.min(d.origin, cur);
      const b = Math.max(d.origin, cur);
      if (ghost) {
        ghost.classList.remove("hidden");
        ghost.style.left = `${(a / MS_DAY_MIN) * 100}%`;
        ghost.style.width = `${(Math.max(MS_SNAP, b - a) / MS_DAY_MIN) * 100}%`;
      }
    } else if (d.type === "resize-start" || d.type === "resize-end" || d.type === "move") {
      const slot = msCtx.week[msCtx.day][d.idx];
      const base = d.base;
      let start = base.start;
      let end = base.end;
      if (d.type === "resize-start") start = cur;
      else if (d.type === "resize-end") end = cur;
      else {
        const delta = cur - d.origin;
        start = base.start + delta;
        end = base.end + delta;
        const span = base.end - base.start;
        if (start < 0) {
          start = 0;
          end = span;
        }
        if (end > MS_DAY_MIN) {
          end = MS_DAY_MIN;
          start = MS_DAY_MIN - span;
        }
      }
      const clamped = msClampRange(msCtx.day, start, end, d.idx);
      if (clamped) {
        msApplyRangeToSlot(slot, clamped);
        renderMsTimeline();
      }
    }
  };

  const onUp = (e) => {
    if (!msCtx?.drag) return;
    const track = document.getElementById("msTrack");
    const d = msCtx.drag;
    msCtx.drag = null;
    document.getElementById("msGhost")?.classList.add("hidden");
    if (d.type === "create" && track) {
      const cur = msClientToMin(track, e.clientX);
      if (msActiveCount(msCtx.day) >= MS_SLOT_N) {
        toast(`最多 ${MS_SLOT_N} 个时段`, "error");
        return;
      }
      const free = msFirstFreeSlotIdx(msCtx.day);
      if (free < 0) {
        toast(`最多 ${MS_SLOT_N} 个时段`, "error");
        return;
      }
      const clamped = msClampRange(msCtx.day, d.origin, cur, free);
      if (!clamped) {
        toast("时段过短或与已有时段重叠", "error");
        return;
      }
      const slot = msCtx.week[msCtx.day][free];
      msClearSlot(slot);
      msApplyRangeToSlot(slot, clamped);
      slot.mode = MS_MODE_DISCHARGE;
      slot.power = "200";
      slot.soc = "80";
      msCtx.selectedIdx = free;
      renderManualScheduleDialog();
      return;
    }
    if (d.type === "resize-start" || d.type === "resize-end" || d.type === "move") {
      renderManualScheduleDialog();
    }
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  dlg.addEventListener("pointerdown", (e) => {
    if (!msCtx) return;
    const handle = e.target.closest("[data-ms-handle]");
    const seg = e.target.closest("[data-ms-seg]");
    const track = e.target.closest("#msTrack");
    if (handle) {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(handle.getAttribute("data-ms-seg"));
      const r = msSlotRange(msCtx.week[msCtx.day][idx]);
      if (!r) return;
      msCtx.selectedIdx = idx;
      msCtx.drag = {
        type: handle.getAttribute("data-ms-handle") === "start" ? "resize-start" : "resize-end",
        idx,
        base: { ...r },
        origin: msClientToMin(document.getElementById("msTrack"), e.clientX),
      };
      renderMsTimeline();
      renderMsEditor();
      return;
    }
    if (seg) {
      e.preventDefault();
      const idx = Number(seg.getAttribute("data-ms-seg"));
      const r = msSlotRange(msCtx.week[msCtx.day][idx]);
      if (!r) return;
      msCtx.selectedIdx = idx;
      msCtx.drag = {
        type: "move",
        idx,
        base: { ...r },
        origin: msClientToMin(document.getElementById("msTrack"), e.clientX),
      };
      renderMsTimeline();
      renderMsEditor();
      return;
    }
    if (track) {
      if (e.target.closest(".ms-seg")) return;
      e.preventDefault();
      if (msActiveCount(msCtx.day) >= MS_SLOT_N) {
        toast(`最多 ${MS_SLOT_N} 个时段`, "error");
        return;
      }
      const origin = msClientToMin(document.getElementById("msTrack"), e.clientX);
      msCtx.drag = { type: "create", origin };
      msCtx.selectedIdx = null;
      renderMsEditor();
    }
  });
}

async function openManualScheduleDialog(home, device, opts = {}) {
  const dlg = document.getElementById("dlgManualSchedule");
  if (!dlg || !home || !device) return;
  const fromFamily = !!opts.fromFamily;
  const kind = opts.kind === MS_KIND_TOU ? MS_KIND_TOU : MS_KIND_MANUAL;
  const modeValue = kind === MS_KIND_TOU ? MS_KIND_TOU : MS_KIND_MANUAL;
  const title = document.getElementById("dlgManualScheduleTitle");
  const hint = dlg.querySelector(".manual-schedule-modal > .hint");
  if (title) {
    const tag = kind === MS_KIND_TOU ? "分时用电" : "手动设置";
    title.textContent = fromFamily
      ? `${tag} · 家庭（以 ${device.name || device.deviceId} 为模板）`
      : `${tag} · ${device.name || device.deviceId}`;
  }
  if (hint) {
    hint.textContent =
      kind === MS_KIND_TOU
        ? "分时用电：无星期，最多 8 段（day_time1…8_*）。拖拽选段后配置参数并下发。"
        : "手动设置：按星期配置，每天最多 8 段（user_{weekday}_day_timeN_*）。拖拽选段后配置并下发。";
  }
  msCtx = {
    home,
    device,
    fromFamily,
    kind,
    modeValue,
    day: kind === MS_KIND_TOU ? MS_TOU_DAY : MS_DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1].key,
    week: msEmptyWeek(kind),
    baseline: msEmptyWeek(kind),
    meta: {},
    loading: true,
    selectedIdx: null,
    drag: null,
  };
  document.getElementById("msDays").innerHTML = "";
  document.getElementById("msTimeline").innerHTML = "";
  document.getElementById("msSlots").innerHTML = `<p class="hint">正在读取物模型时段…</p>`;
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");

  try {
    const res = await CaseApi.queryProperties(home, {
      page: "1",
      deviceId: device.deviceId,
    });
    const list = unwrapResult(res);
    const items = Array.isArray(list) ? list : list?.data || list?.items || [];
    const parsed = msParsePropertyList(items, kind);
    msCtx.week = parsed.week;
    msCtx.baseline = msCloneWeek(parsed.week);
    msCtx.meta = parsed.meta;
    msCtx.loading = false;
    if (!Object.keys(parsed.meta).length) {
      const tip =
        kind === MS_KIND_TOU
          ? "未读到 day_time* 寄存器（请确认 Cookie / 机型是否支持分时用电）。"
          : "未读到 user_*_day_time* 寄存器（请确认 Cookie / 机型是否支持手动时段）。";
      document.getElementById("msSlots").innerHTML = `<p class="hint">${tip}</p>`;
      return;
    }
    renderManualScheduleDialog();
  } catch (err) {
    msCtx.loading = false;
    document.getElementById("msSlots").innerHTML = `<p class="hint">读取失败：${escapeHtml(err.message || err)}</p>`;
  }
}

async function saveManualScheduleAndIssue() {
  if (!msCtx?.device || !msCtx.home) return;
  const { home, device, week, baseline, meta, fromFamily, kind, modeValue } = msCtx;
  const dirty = msCollectDirtyEntries(week, baseline, meta, kind);
  const targets = fromFamily
    ? homeLiveDevices(home).filter((d) => d?.deviceId)
    : [device];
  if (!targets.length) {
    toast("没有可下发的一体机", "error");
    return;
  }

  const modeNow = String(
    fromFamily
      ? home.familyValues?.work_mode ?? device.values?.work_mode ?? ""
      : device.values?.work_mode ?? ""
  );
  const needMode = fromFamily || modeNow !== modeValue;
  if (!dirty.length && modeNow === modeValue) {
    toast("时段无改动", "ok");
    document.getElementById("dlgManualSchedule")?.close();
    return;
  }

  const btn = document.getElementById("btnManualScheduleSave");
  if (btn) btn.disabled = true;
  try {
    const propertyList = [];
    if (needMode) {
      const field = HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode");
      const entry = resolveSchemaEntry(
        device.schema || {},
        field || { code: "work_mode", aliases: ["work_mode"] }
      );
      propertyList.push({
        dpId: String(entry?.dpId || field?.fallbackDpId || "51"),
        dpValue: modeValue,
      });
    }
    if (dirty.length) {
      const fsEntry = resolveSchemaEntry(device.schema || {}, {
        code: "function_set",
        aliases: ["function_set"],
      });
      const dpId = String(fsEntry?.dpId || "52");
      for (let i = 0; i < dirty.length; i += MS_FUNC_BATCH) {
        const chunk = dirty.slice(i, i + MS_FUNC_BATCH);
        propertyList.push({ dpId, dpValue: packFunctionSetRaw(chunk) });
      }
    }
    if (!propertyList.length) {
      toast("没有待下发内容", "error");
      return;
    }

    const results = await Promise.all(
      targets.map(async (d) => {
        try {
          const res = await CaseApi.issueDevice(home, {
            devId: d.deviceId,
            timestamp: null,
            propertyList,
          });
          const raw = unwrapResult(res);
          const upstream = res.data || {};
          const ok =
            res.ok !== false &&
            upstream.success !== false &&
            (raw?.success === true ||
              raw?.success === undefined ||
              Array.isArray(raw) ||
              res.status === 200);
          if (!ok) {
            throw new Error(upstream.errorMsg || raw?.errorMsg || raw?.message || "下发失败");
          }
          return true;
        } catch (err) {
          d.error = err.message || String(err);
          return false;
        }
      })
    );
    const okN = results.filter(Boolean).length;
    const failN = results.length - okN;
    if (!okN) throw new Error(targets[0]?.error || "下发失败");

    if (!home.familyValues) home.familyValues = {};
    if (!home.familyDrafts) home.familyDrafts = {};
    home.familyValues.work_mode = modeValue;
    home.familyDrafts.work_mode = "";
    for (const d of targets) {
      if (!d.values) d.values = {};
      if (!d.drafts) d.drafts = {};
      d.values.work_mode = modeValue;
      d.drafts.work_mode = "";
    }
    if (dirty.length) {
      msCtx.baseline = msCloneWeek(week);
      device.manualSchedule = { kind, week: msCloneWeek(week), updatedAt: Date.now() };
    }

    const modeLabel = kind === MS_KIND_TOU ? "分时用电" : "手动设置";
    toast(
      fromFamily
        ? `${modeLabel}时段已下发至 ${okN}/${targets.length} 台${failN ? `（失败 ${failN}）` : ""}`
        : `已下发 ${modeLabel}${dirty.length ? ` + ${dirty.length} 个寄存器` : ""}`,
      failN ? "error" : "ok"
    );
    document.getElementById("dlgManualSchedule")?.close();
    persist();
    render();
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}


function bindManualScheduleDialog() {
  const dlg = document.getElementById("dlgManualSchedule");
  if (!dlg || dlg.dataset.bound === "1") return;
  dlg.dataset.bound = "1";
  msBindTimelinePointer();
  document.getElementById("btnManualScheduleClose")?.addEventListener("click", () => dlg.close());
  document.getElementById("btnManualScheduleSave")?.addEventListener("click", () => saveManualScheduleAndIssue());
  dlg.addEventListener("close", () => {
    if (msCtx?.device) render();
  });
  dlg.addEventListener("click", (e) => {
    const dayBtn = e.target.closest("[data-ms-day]");
    if (dayBtn && msCtx) {
      msCtx.day = dayBtn.getAttribute("data-ms-day");
      msCtx.selectedIdx = null;
      renderManualScheduleDialog();
      return;
    }
    const modeBtn = e.target.closest("[data-ms-mode]");
    if (modeBtn && msCtx) {
      const idx = Number(modeBtn.getAttribute("data-ms-slot"));
      const mode = modeBtn.getAttribute("data-ms-mode");
      msApplyField(idx, "mode", mode);
      renderMsTimeline();
      renderMsEditor();
      return;
    }
    const del = e.target.closest("[data-ms-del]");
    if (del && msCtx) {
      const idx = Number(del.getAttribute("data-ms-del"));
      const slot = msCtx.week[msCtx.day][idx];
      if (slot) msClearSlot(slot);
      msCtx.selectedIdx = null;
      renderManualScheduleDialog();
    }
  });
  dlg.addEventListener("change", (e) => {
    const el = e.target.closest("[data-ms-field]");
    if (!el || !msCtx) return;
    const slotIdx = Number(el.getAttribute("data-ms-slot"));
    const field = el.getAttribute("data-ms-field");
    const raw = el.type === "checkbox" ? el.checked : el.value;
    msApplyField(slotIdx, field, raw);
    if (field === "mode" || field === "start" || field === "end" || field === "power" || field === "soc") {
      renderMsTimeline();
      if (field === "mode") renderMsEditor();
    }
  });
}

/* ---------- Events ---------- */

function bindEvents() {
  bindManualScheduleDialog();
  const SIDEBAR_KEY = "groupAppControl.sidebarCollapsed";
  const appEl = document.getElementById("app");
  const btnToggle = document.getElementById("btnToggleSidebar");
  const applySidebar = (collapsed) => {
    appEl?.classList.toggle("sidebar-collapsed", !!collapsed);
    if (btnToggle) {
      btnToggle.title = collapsed ? "展开左侧栏" : "折叠左侧栏";
      btnToggle.setAttribute("aria-label", collapsed ? "展开左侧栏" : "折叠左侧栏");
      btnToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  };
  try {
    applySidebar(localStorage.getItem(SIDEBAR_KEY) === "1");
  } catch (_) {}
  btnToggle?.addEventListener("click", () => {
    const next = !appEl.classList.contains("sidebar-collapsed");
    applySidebar(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
    } catch (_) {}
  });

  document.getElementById("homeTabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".home-tab[data-tab]");
    if (!btn) return;
    setHomeTab(btn.getAttribute("data-tab"));
  });
  document.getElementById("btnElectionPollToggle")?.addEventListener("click", () => {
    setElectionPollEnabled(!electionPollEnabled);
  });
  document.getElementById("btnElectionApplyInterval")?.addEventListener("click", () => {
    const home = activeHome();
    const input = document.getElementById("electionIntervalSec");
    if (!home || !input) return;
    saveElectionInterval(home, input.value);
  });
  document.getElementById("electionIntervalSec")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    document.getElementById("btnElectionApplyInterval")?.click();
  });
  document.getElementById("btnElectionPollOnce")?.addEventListener("click", () => {
    tickElectionPoll({ force: true });
  });
  document.getElementById("btnElectionRefresh")?.addEventListener("click", () => {
    const home = activeHome();
    if (home) loadElectionRows(home);
  });
  document.getElementById("btnElectionExpandAll")?.addEventListener("click", () => {
    document.querySelectorAll("#electionHost .election-tl-item").forEach((item) => {
      item.classList.remove("is-collapsed");
      item.querySelector('[data-act="election-fold"]')?.setAttribute("aria-expanded", "true");
    });
  });
  document.getElementById("btnElectionCollapseAll")?.addEventListener("click", () => {
    document.querySelectorAll("#electionHost .election-tl-item").forEach((item) => {
      item.classList.add("is-collapsed");
      item.querySelector('[data-act="election-fold"]')?.setAttribute("aria-expanded", "false");
    });
  });
  document.getElementById("btnElectionDownload")?.addEventListener("click", () => {
    const home = activeHome();
    const homeId = electionHomeKey(home);
    if (!homeId) {
      toast("缺少家庭 ID", "error");
      return;
    }
    window.open(`${CaseApi.PATHS.electionDownload}?homeId=${encodeURIComponent(homeId)}`, "_blank");
  });
  document.getElementById("btnElectionClear")?.addEventListener("click", async () => {
    const home = activeHome();
    const homeId = electionHomeKey(home);
    if (!homeId) return;
    if (!(await appConfirm("清空该家庭的选举趋势 CSV 记录？", { title: "清空记录" }))) return;
    try {
      const { json: data } = await CaseApi.clearElection({ homeId });
      if (!data?.ok) throw new Error(data?.error || "清空失败");
      electionTimeline = [];
      electionLastMasterId = null;
      electionMeta.rowCount = 0;
      toast("已清空选举记录", "ok");
      renderElectionPanel(home);
    } catch (err) {
      toast(err.message || String(err), "error");
    }
  });
  document.getElementById("btnAddHome").addEventListener("click", () => openHomeDialog(null));
  window.addEventListener("keydown", (ev) => {
    if (homeTab !== "live") return;
    if (liveCanvasTypingTarget(ev.target)) return;
    if (document.querySelector("dialog[open]")) return;
    if (ev.key !== "Delete" && ev.key !== "Backspace") return;
    if (!liveCanvasSel.wire) return;
    const home = activeHome();
    if (!home) return;
    ev.preventDefault();
    if (!deleteLiveCanvasSelection(home)) return;
    persist();
    toast("已删除接线", "ok");
    render();
  });
  document.getElementById("btnEmptyAdd").addEventListener("click", () => openHomeDialog(null));
  document.getElementById("btnLogin").addEventListener("click", openLoginMgr);
  document.getElementById("btnLoginMgrBack")?.addEventListener("click", closeLoginMgr);
  document.getElementById("autoInnerTabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-at-tab]");
    if (!btn) return;
    setAtInnerTab(btn.getAttribute("data-at-tab"));
  });
  document.getElementById("btnAutoTestReload")?.addEventListener("click", () => {
    if (atRunning) {
      toast("测试进行中，请先暂停", "error");
      return;
    }
    atShowResults = false;
    atReplayOpen = false;
    setAtInnerTab("run");
    renderAutoRun();
  });
  _atInitLabConstructToggle();
  document.getElementById("btnAutoTestRun")?.addEventListener("click", () => runAutoTest());
  document.getElementById("btnAutoTestPause")?.addEventListener("click", () => pauseAutoTest());
  document.getElementById("btnLoginMgrAuto")?.addEventListener("click", async () => {
    const btn = document.getElementById("btnLoginMgrAuto");
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = "获取中…";
    try {
      await refreshSsoCookie({ skipRender: true });
    } catch (_) {
      /* toast shown inside */
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
      renderLoginMgr();
    }
  });
  document.getElementById("loginMgrBody")?.addEventListener("click", (e) => {
    const editHost = e.target.closest("[data-lm-edit]")?.getAttribute("data-lm-edit");
    if (editHost) {
      openLoginDialog(editHost);
      return;
    }
    const clearHost = e.target.closest("[data-lm-clear]")?.getAttribute("data-lm-clear");
    if (clearHost) {
      delete state.cookies[clearHost];
      persist();
      renderLoginMgr();
      toast(`已清除 ${envLabel(clearHost)} Cookie`, "ok");
    }
  });
  document.getElementById("btnEditHome").addEventListener("click", () => {
    const h = activeHome();
    if (h) openHomeDialog(h);
  });
  document.getElementById("btnDeleteHome").addEventListener("click", () => {
    const h = activeHome();
    if (!h) return;
    if (!confirm(`删除家庭 ${homeDisplayName(h)}？`)) return;
    state.homes = state.homes.filter((x) => x.uid !== h.uid);
    state.activeHomeId = state.homes[0]?.uid || null;
    persist();
    render();
  });
  document.getElementById("btnRefreshDevices").addEventListener("click", () => {
    const h = activeHome();
    if (h) refreshHomeDevices(h);
  });
  document.getElementById("btnAddMeter").addEventListener("click", () => openMeterDialog(null));

  document.getElementById("btnReadAll").addEventListener("click", () => readAllActiveHome());
  document.getElementById("btnSaveSnapshot")?.addEventListener("click", () => saveLiveSnapshot());
  document.getElementById("btnSnapRefresh")?.addEventListener("click", () => mountSnapshotsPanel());
  document.getElementById("btnSnapClearAll")?.addEventListener("click", () => clearAllSnapshots());
  document.getElementById("btnSnapPreviewClose")?.addEventListener("click", () => {
    closeSnapshotFullscreen();
    document.getElementById("dlgSnapshotPreview")?.close();
  });
  document.getElementById("snapPreviewImg")?.addEventListener("click", (e) => {
    e.preventDefault();
    const src = e.currentTarget?.src;
    if (src) openSnapshotFullscreen(src);
  });
  document.getElementById("btnSnapFsClose")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSnapshotFullscreen();
  });
  document.getElementById("snapFullscreen")?.addEventListener("click", () => {
    closeSnapshotFullscreen();
  });
  document.getElementById("snapFullscreenImg")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSnapshotFullscreen();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      const layer = document.getElementById("snapFullscreen");
      if (layer && !layer.hidden) {
        e.preventDefault();
        e.stopPropagation();
        closeSnapshotFullscreen();
      }
    },
    true
  );
  document.getElementById("dlgSnapshotPreview")?.addEventListener("close", () => {
    closeSnapshotFullscreen();
  });

  document.getElementById("btnIssueAll").addEventListener("click", async () => {
    const home = activeHome();
    if (!home) return;
    const famN = countFamilyDrafts(home);
    const deviceTargets = homeLiveDevices(home).filter((d) => countDrafts(d) > 0);
    // 家庭参数下发 + 各设备草稿下发：全部并行
    const [famResult, ...deviceResults] = await Promise.all([
      famN ? issueFamilyToDevices(home) : Promise.resolve({ ok: 0, fail: 0 }),
      ...deviceTargets.map((d) => issueDevice(home, d, { batch: true })),
    ]);
    const deviceOk = deviceResults.filter(Boolean).length;
    if (famN) {
      if (famResult.fail) toast(`家庭参数：${famResult.ok} 台成功 / ${famResult.fail} 台失败`, famResult.ok ? "ok" : "error");
      else if (famResult.ok) toast(`家庭参数已下发至 ${famResult.ok} 台设备`, "ok");
    }
    if (deviceTargets.length) {
      toast(`设备参数：成功 ${deviceOk} / ${deviceTargets.length}`, deviceOk === deviceTargets.length ? "ok" : "error");
    }
    if (!famN && !deviceTargets.length) toast("没有待下发改动", "error");
    persist();
    render();
  });

  document.getElementById("loginEnv").addEventListener("change", (e) => {
    const host = e.target.value;
    document.getElementById("loginCookie").value = state.cookies[host] || "";
  });

  const bindAutoCookie = (btn) => {
    btn?.addEventListener("click", async () => {
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = "获取中…";
      try {
        await refreshSsoCookie({ force: true });
        // Keep dialog open so user can review; banner path may not have dialog
        if (!document.getElementById("dlgLogin")?.open) {
          /* no-op */
        }
      } catch (_) {
        /* toast already shown */
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  };
  bindAutoCookie(document.getElementById("btnAutoCookie"));
  bindAutoCookie(document.getElementById("btnAutoCookieBanner"));

  document.getElementById("btnPushCookies")?.addEventListener("click", async () => {
    const btn = document.getElementById("btnPushCookies");
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "推送中…";
    }
    try {
      // Prefer current store; if empty for active host, refresh first
      const host =
        document.getElementById("loginEnv")?.value ||
        activeHome()?.envHost ||
        "";
      const needRefresh = !(state.cookies[host] || "").trim();
      await pushCookiesToRemote({ refreshFirst: needRefresh });
    } catch (_) {
      /* toast already shown */
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || "推送到虚拟机";
      }
    }
  });

  document.getElementById("remotePushUrl")?.addEventListener("change", (e) => {
    const v = String(e.target.value || "").trim().replace(/\/$/, "");
    try {
      if (v) localStorage.setItem(REMOTE_PUSH_URL_KEY, v);
    } catch (_) {
      /* ignore */
    }
  });

  document.getElementById("btnLoginCancel").addEventListener("click", () => {
    document.getElementById("dlgLogin").close();
  });
  document.getElementById("formLogin").addEventListener("submit", (e) => {
    e.preventDefault();
    const host = document.getElementById("loginEnv").value;
    const cookie = document.getElementById("loginCookie").value.trim();
    state.cookies[host] = cookie;
    persist();
    document.getElementById("dlgLogin").close();
    toast(cookie ? `已保存 ${envLabel(host)} 登录态` : `已清空 ${envLabel(host)} Cookie`, "ok");
    render();
  });

  document.getElementById("btnHomeCancel").addEventListener("click", () => {
    document.getElementById("dlgHome").close();
  });
  document.getElementById("formHome").addEventListener("submit", (e) => {
    e.preventDefault();
    const envHost = document.getElementById("homeEnv").value;
    const homeId = document.getElementById("homeId").value.trim();
    const name = document.getElementById("homeName").value.trim();
    const authId = "";
    if (!homeId) return;
    let savedHome = null;
    let homeIdChanged = true;
    if (editingHomeUid) {
      const h = state.homes.find((x) => x.uid === editingHomeUid);
      if (h) {
        homeIdChanged = h.homeId !== homeId;
        // envHost locked after create — keep bound region
        h.homeId = homeId;
        h.name = name;
        h.authId = authId;
        for (const m of h.meters || []) {
          m.hestiaHost = hestiaHostForHome(h);
        }
        savedHome = h;
      }
    } else {
      const h = normalizeHome({
        uid: uid(),
        envHost,
        homeId,
        name,
        authId,
        devices: [],
      });
      state.homes.push(h);
      state.activeHomeId = h.uid;
      savedHome = h;
    }
    persist();
    document.getElementById("dlgHome").close();
    render();
    // 保存后自动拉取家庭设备（家庭ID 有变化时；已有设备按 devId 去重只新增）
    if (savedHome && savedHome.homeId && homeIdChanged) {
      autoPullDevices(savedHome);
    }
  });

  document.getElementById("btnDeviceCancel").addEventListener("click", () => {
    document.getElementById("dlgDevice").close();
  });
  document.getElementById("formDevice").addEventListener("submit", (e) => {
    e.preventDefault();
    const home = activeHome();
    if (!home) return;
    const deviceId = document.getElementById("deviceId").value.trim();
    const name = document.getElementById("deviceName").value.trim();
    if (!deviceId) return;
    if (editingDeviceUid) {
      const d = home.devices.find((x) => x.uid === editingDeviceUid);
      if (d) {
        if (d.deviceId !== deviceId) {
          d.pid = "";
          d.model = "";
        }
        d.deviceId = deviceId;
        d.name = name;
      }
    } else {
      home.devices.push(
        normalizeDevice({
          uid: uid(),
          deviceId,
          name,
        })
      );
    }
    ensureHomeWiring(home);
    persist();
    document.getElementById("dlgDevice").close();
    render();
  });

  /* ---- Wiring editor ---- */
  let _wiringDraft = null;

  function openWiringDialog() {
    const home = activeHome();
    if (!home) return;
    ensureHomeWiring(home);
    _wiringDraft = JSON.parse(JSON.stringify(home.wiring));
    renderWiringDialog(home);
    document.getElementById("dlgWiring").showModal();
  }

  function renderWiringDialog(home) {
    const draft = _wiringDraft;
    const busList = document.getElementById("wiringBusList");
    busList.innerHTML = draft.buses
      .map((b, idx) => {
        const kindLab = WIRING_BUS_KINDS.find((k) => k.kind === b.kind)?.label || b.kind;
        return `<div class="wiring-bus-row" data-bus-idx="${idx}">
          <span class="wiring-kind">${escapeHtml(kindLab)}</span>
          <input type="text" data-bus-label value="${escapeAttr(b.label)}" placeholder="端子名称" />
          <button type="button" class="btn-link danger" data-bus-del ${draft.buses.length <= 1 ? "disabled" : ""}>删除</button>
        </div>`;
      })
      .join("");

    busList.querySelectorAll("[data-bus-label]").forEach((input) => {
      input.addEventListener("input", () => {
        const idx = Number(input.closest("[data-bus-idx]").getAttribute("data-bus-idx"));
        if (draft.buses[idx]) draft.buses[idx].label = input.value;
      });
    });
    busList.querySelectorAll("[data-bus-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.closest("[data-bus-idx]").getAttribute("data-bus-idx"));
        const removed = draft.buses[idx];
        if (!removed || draft.buses.length <= 1) return;
        draft.buses.splice(idx, 1);
        for (const ports of Object.values(draft.devices)) {
          for (const p of ["pv", "grid", "offgrid"]) {
            if (Array.isArray(ports[p])) {
              ports[p] = ports[p].map((v) => (v === removed.id ? "" : v));
            } else if (ports[p] === removed.id) {
              ports[p] = "";
            }
          }
        }
        if (draft.bus_links) {
          const other = draft.bus_links[removed.id];
          delete draft.bus_links[removed.id];
          if (other) delete draft.bus_links[other];
        }
        renderWiringDialog(home);
      });
    });
  }

  document.getElementById("btnWiringAddBus").addEventListener("click", () => {
    if (!_wiringDraft) return;
    const kind = document.getElementById("wiringNewBusKind").value;
    const meta = WIRING_BUS_KINDS.find((k) => k.kind === kind) || WIRING_BUS_KINDS[0];
    const n = _wiringDraft.buses.filter((b) => b.kind === kind).length + 1;
    _wiringDraft.buses.push({
      id: `bus_${kind}_${Date.now().toString(36)}`,
      kind,
      label: n > 1 ? `${meta.label} ${n}` : meta.label,
      x: null,
      y: null,
    });
    renderWiringDialog(activeHome());
  });

  document.getElementById("btnWiringReset").addEventListener("click", () => {
    const home = activeHome();
    if (!home) return;
    _wiringDraft = normalizeWiring(null, home.devices.map((d) => d.uid), home.devices);
    renderWiringDialog(home);
  });

  document.getElementById("btnWiringCancel").addEventListener("click", () => {
    document.getElementById("dlgWiring").close();
    _wiringDraft = null;
  });

  document.getElementById("btnDevicePointsClose").addEventListener("click", () => {
    document.getElementById("dlgDevicePoints").close();
  });
  document.getElementById("dlgDevicePoints").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  document.getElementById("devicePointsTabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-points-tab]");
    if (!btn) return;
    switchDevicePointsTab(btn.getAttribute("data-points-tab"));
  });
  document.getElementById("btnRegQueryClose")?.addEventListener("click", () => {
    document.getElementById("dlgRegQuery")?.close();
  });
  document.getElementById("btnRegQueryRun")?.addEventListener("click", () => runRegQuery());
  document.getElementById("regQueryDpMore")?.addEventListener("click", (e) => openRegQueryDpMore(e));
  document.getElementById("regQueryDpPick")?.addEventListener("change", () => syncRegQueryDpMoreHref());
  document.getElementById("regQueryTabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-reg-mode]");
    if (!btn) return;
    switchRegQueryMode(btn.getAttribute("data-reg-mode"));
  });
  document.getElementById("regQueryAddr")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runRegQuery();
    }
  });
  document.getElementById("dlgRegQuery")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  document.getElementById("btnOwnerStratClose")?.addEventListener("click", () => {
    document.getElementById("dlgOwnerStrat")?.close();
  });
  document.getElementById("dlgOwnerStrat")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  document.getElementById("formWiring").addEventListener("submit", (e) => {
    e.preventDefault();
    const home = activeHome();
    if (!home || !_wiringDraft) return;
    home.wiring = normalizeWiring(
      _wiringDraft,
      home.devices.map((d) => d.uid),
      home.devices
    );
    _wiringDraft = null;
    persist();
    document.getElementById("dlgWiring").close();
    toast("接线已保存", "ok");
    render();
  });

  // expose for flow button
  window.openWiringDialog = openWiringDialog;

  document.getElementById("btnMeterCancel").addEventListener("click", () => {
    document.getElementById("dlgMeter").close();
  });
  document.getElementById("meterThirdParty")?.addEventListener("change", () => {
    syncMeterDialogMode();
    const home = activeHome();
    if (document.getElementById("meterThirdParty").value === "1") {
      fillMeterDeviceSelect(home, document.getElementById("meterDeviceSelect").value);
    } else {
      const hint = document.getElementById("meterRegionHint");
      if (hint && home) {
        const hHost = hestiaHostForHome(home);
        hint.textContent = `Hestia 区域随家庭环境自动跟随：${envLabel(home.envHost)} → ${hHost}`;
      }
    }
  });
  document.getElementById("formMeter").addEventListener("submit", (e) => {
    e.preventDefault();
    const home = activeHome();
    if (!home) return;
    if (!home.meters) home.meters = [];
    const isThirdParty = document.getElementById("meterThirdParty").value === "1";
    const deviceId = isThirdParty
      ? document.getElementById("meterDeviceSelect").value.trim()
      : document.getElementById("meterId").value.trim();
    const name = document.getElementById("meterName").value.trim();
    const hestiaHost = hestiaHostForHome(home);
    if (!deviceId) {
      toast(isThirdParty ? "请选择一体机" : "请填写电表设备 ID", "error");
      return;
    }
    if (editingMeterUid) {
      const m = home.meters.find((x) => x.uid === editingMeterUid);
      if (m) {
        m.deviceId = deviceId;
        m.name = name;
        m.isThirdParty = isThirdParty;
        m.hestiaHost = hestiaHost;
        m.pid = isThirdParty ? "" : METER_PID;
      }
    } else {
      home.meters.push(
        normalizeMeter(
          {
            uid: uid(),
            deviceId,
            name,
            isThirdParty,
            pid: isThirdParty ? "" : METER_PID,
          },
          home.envHost
        )
      );
    }
    persist();
    document.getElementById("dlgMeter").close();
    render();
  });
}

/** 电表：本机最近影子读取相对时间，如「7秒前已读」 */
function meterReadAgoLabel(meter) {
  if (!meter?.lastReadAt) return meter?.error ? "异常" : "未读";
  return `${relativeTime(meter.lastReadAt)}已读${meter.error ? " · 异常" : ""}`;
}

/** ③ 操作栏：本机最近读取相对时间，如「7秒前已读」 */
function deviceReadAgoLabel(device) {
  if (!device?.lastReadAt) return device?.error ? "异常" : "未读";
  return `${relativeTime(device.lastReadAt)}已读${device.error ? " · 异常" : ""}`;
}

function refreshRelativeTimes() {
  if (document.activeElement && document.activeElement.matches("input, textarea, select")) {
    return;
  }
  const home = activeHome();
  if (!home) return;
  document.querySelectorAll("#flowHost .u3[data-device-uid]").forEach((card) => {
    const device = home.devices.find((d) => d.uid === card.getAttribute("data-device-uid"));
    if (!device) return;
    const el = card.querySelector(".layer.l3 .lh span:last-child");
    if (!el) return;
    el.textContent = deviceReadAgoLabel(device);
  });
  const primaryMeter = (home.meters || [])[0];
  document.querySelectorAll("#flowHost [data-meter-ago]").forEach((el) => {
    el.textContent = meterReadAgoLabel(primaryMeter);
  });
  document.querySelectorAll("#flowHost [data-meter-ago-uid]").forEach((el) => {
    const uid = el.getAttribute("data-meter-ago-uid");
    const m = (home.meters || []).find((x) => x.uid === uid);
    el.textContent = meterReadAgoLabel(m);
  });
}

async function readAllActiveHome(opts = {}) {
  const quiet = !!opts.quiet;
  const home = activeHome();
  if (!home) return;
  const devices = homeLiveDevices(home);
  const meters = home.meters || [];
  if (!devices.length && !meters.length) {
    if (!quiet) toast("没有设备或电表", "error");
    return;
  }

  if (!quiet) {
    for (const d of devices) {
      d.loading = true;
      d.error = null;
    }
    for (const m of meters) {
      m.loading = true;
      m.error = null;
    }
    home.familyValues = {};
    render();
  }

  // 全并行：一体机影子 + 电表影子（电表实时功率必拉）
  const results = await Promise.all([
    ...devices.map(async (d) => {
      const [ok, model] = await Promise.all([
        readDevice(home, d, { batch: true }),
        fetchDeviceHomeModelParams(home, d),
      ]);
      applyDeviceHomeModelParams(home, d, model, { syncHome: false });
      return ok;
    }),
    ...meters.map((m) =>
      readMeter(home, m, { batch: true, quiet }).then(() => !m.error)
    ),
  ]);

  // 家庭侧栏：用第一台设备的影子 + 物模型回填（不再串行重拉）
  if (devices[0]?.values) {
    if (!home.familyValues) home.familyValues = {};
    for (const field of HOME_FAMILY_FIELDS) {
      const v = devices[0].values[field.code];
      if (v != null && v !== "") home.familyValues[field.code] = v;
    }
  }

  home.lastReadAt = Date.now();
  applyDp98ActualForHome(home);
  persist();
  render();

  const deviceMeterResults = results.slice(0, devices.length + meters.length);
  const failN = deviceMeterResults.filter((ok) => !ok).length;
  if (!quiet) {
    if (failN) toast(`一键读取完成：${failN} 台失败`, "error");
    else toast("一键读取完成", "ok");
  }
}

/**
 * @brief Reply to parent shell for family monitor (list-homes / check)
 * @param[in] data postMessage payload
 * @param[in] origin target origin
 * @return none
 */
async function handleFamilyMonitorMessage(data, origin) {
  const requestId = data.requestId || "";
  const reply = (payload) => {
    try {
      window.parent.postMessage({
        type: "caselib-family-monitor-reply",
        requestId,
        ...payload,
      }, origin || window.location.origin);
    } catch (_) {}
  };
  try {
    if (data.action === "list-homes") {
      reply({
        ok: true,
        activeHomeId: state.activeHomeId || "",
        homes: (state.homes || []).map((h) => ({
          uid: h.uid,
          homeId: h.homeId || h.uid,
          name: h.name || h.homeId || h.uid,
        })),
      });
      return;
    }
    if (data.action === "check") {
      const result = await runFamilyMonitorCheck(data.homeId);
      reply({ ok: true, ...result });
      return;
    }
    reply({ ok: false, error: `未知动作 ${data.action || ""}` });
  } catch (err) {
    reply({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * @brief Whether device should be included in family-monitor L1/L2
 * @param[in] device device object
 * @return true when online and device_cluster_role is present
 * @note Offline or empty cluster role are skipped (not failed)
 */
function _monDeviceCheckable(device) {
  if (!device) {
    return false;
  }
  if (typeof deviceIsOnline === "function" && !deviceIsOnline(device)) {
    return false;
  }
  const role = device.values?.device_cluster_role;
  if (role == null || role === "") {
    return false;
  }
  return true;
}

/**
 * @brief Paint monitor result with the same checker layout as auto-test report
 * @param[in] html checker HTML
 * @param[in] metaLine status text
 * @return none
 */
function _monRenderCheckerHost(html, metaLine) {
  const body = document.getElementById("familyMonitorBody");
  const meta = document.getElementById("familyMonitorMeta");
  if (meta) {
    meta.textContent = metaLine || "";
  }
  if (!body) {
    return;
  }
  body.innerHTML = html || `<div class="family-monitor-empty">无检查结果</div>`;
  _atBindCheckerExplain(body);
}

/**
 * @brief Persist a failed family-monitor check as a report (same store as auto-test)
 * @param[in] home home object
 * @param[in] cycle monitor cycle payload
 * @param[in] summary short summary
 * @return report id or ""
 */
async function _monPersistFailReport(home, cycle, summary) {
  const cycles = [cycle];
  const flat = cycle.results || [];
  const passN = flat.filter((r) => r.pass).length;
  const failN = flat.length - passN;
  const reportJson = _atReportPayload(home, cycles, 0, null, {
    status: "fail",
    planned: 1,
    reportId: null,
  });
  reportJson.kind = "family-monitor";
  reportJson.status = "fail";
  const md = `# 家庭监控失败报告\n\n- 家庭：${home.name || ""}（ID ${home.homeId || home.uid || ""}）\n` +
    `- 时间：${new Date().toLocaleString("zh-CN")}\n- 摘要：${summary || "未通过"}\n` +
    `- 设备组：${flat.length} · 通过 ${passN} · 失败 ${failN}\n`;
  const csv = _atReportCsv(cycles);
  try {
    const { json: j } = await CaseApi.saveReport({
        name: `${home.homeId || home.uid || "monitor"}`,
        title: `家庭监控失败 · ${home.name || home.homeId || ""}`,
        homeId: home.homeId || home.uid || "",
        homeName: home.name || "",
        summary: summary || "家庭监控未通过",
        status: "fail",
        planned: 1,
        done: 1,
        total: flat.length,
        passed: passN,
        failed: failN,
        markdown: md,
        csv,
        reportJson: _atPersistableReport(reportJson),
      });
    return j?.id || "";
  } catch (err) {
    console.error("family monitor persist failed", err);
    return "";
  }
}

/**
 * @brief Read home devices and evaluate L1–L3 for family monitor tab
 * @param[in] homeId home uid
 * @return monitor snapshot
 * @note Layout reuses report checker; offline / empty cluster role skipped; fail → persist report
 */
async function runFamilyMonitorCheck(homeId) {
  const uid = String(homeId || "").trim();
  if (!uid) {
    throw new Error("未指定家庭");
  }
  const home = (state.homes || []).find((h) => h.uid === uid || h.homeId === uid);
  if (!home) {
    throw new Error("家庭不存在，请先到实时运行配置");
  }
  const prevActive = state.activeHomeId;
  state.activeHomeId = home.uid;
  try {
    await _atReadDevices(home, home.devices || []);
    const checkable = (home.devices || []).filter(_monDeviceCheckable);
    const skippedN = (home.devices || []).length - checkable.length;
    const expect = typeof computeMasterExpect === "function"
      ? computeMasterExpect(home, _atMasterOpts())
      : { byUid: {} };
    const homeFlow = _atHomeFlow({ ...home, devices: checkable });
    const familyL3 = _atEvalFamilyL3(homeFlow);
    const expectMeta = {
      ...(typeof _atExpectMetaBrief === "function" ? _atExpectMetaBrief(expect, home) : {}),
      l3: familyL3,
    };
    const results = [];
    for (const dev of checkable) {
      const owner = typeof classifyOwnerWorkModel === "function" ? classifyOwnerWorkModel(dev) : null;
      const theory = owner && owner.label ? owner.label : "—";
      const row = _atEvaluateAssignmentResult(
        home,
        {
          uid: dev.uid,
          deviceId: dev.deviceId,
          device: dev.name || dev.deviceId,
          target: theory,
        },
        expect,
        null,
        { role: "target" }
      );
      if (row) {
        results.push(row);
      }
    }
    const stats = _atCheckerStageStats(results, familyL3);
    const pass = !stats.overallFail;
    const parts = [];
    if (stats.l1Fail) parts.push(`L1 ${stats.l1Fail}`);
    if (stats.l2Fail) parts.push(`L2 ${stats.l2Fail}`);
    if (stats.l3Fail) {
      parts.push(familyL3.reverseFlow
        ? (familyL3.bothWay ? "L3逆流+边充边放" : "L3逆流")
        : "L3边充边放");
    }
    const summary = pass
      ? (skippedN ? `全部通过（跳过 ${skippedN} 台离线/无集群身份）` : "全部通过")
      : parts.join(" · ");
    const checkedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    let checkerHtml = "";
    if (results.length) {
      checkerHtml = _atCheckerTableHtml(results, expectMeta, homeFlow);
    } else {
      checkerHtml =
        `<div class="at-checker-wrap at-checker-clean">` +
          `<div class="at-chk-verdict is-ok">无可检设备` +
            (skippedN ? `（已跳过 ${skippedN} 台离线/无集群身份）` : "") +
          `</div>` +
          _atCheckerL3SectionHtml(familyL3) +
        `</div>`;
    }

    let reportId = "";
    if (!pass) {
      const tCheck = Date.now();
      const cycle = {
        no: 1,
        label: "家庭监控巡检",
        target: "monitor",
        status: "fail",
        failed: true,
        tIssue: _nowHMS(tCheck),
        tObserve: _nowHMS(tCheck),
        issued: [],
        results,
        masterExpect: expectMeta,
        homeFlow,
        familyL3,
        chg2Suppressed: !!expect.chg2Suppressed,
        frames: [{
          id: uid(),
          at: tCheck,
          time: _nowHMS(tCheck),
          phase: "observe",
          title: "家庭监控 · 检查失败",
          note: summary,
          stepOk: false,
          emphasis: "fail",
          checkerState: results,
          masterExpect: expectMeta,
          homeFlow,
          familyState: _atFamilyState(home),
        }],
      };
      reportId = await _monPersistFailReport(home, cycle, summary);
    }

    return {
      pass,
      summary,
      checkedAt,
      homeId: home.uid,
      homeName: home.name || home.homeId || home.uid,
      skippedN,
      reportId,
      checkerHtml,
      results,
      l3: familyL3,
      homeFlow,
      chg2Suppressed: !!expect.chg2Suppressed,
    };
  } finally {
    state.activeHomeId = prevActive;
  }
}

async function init() {
  if (window.self !== window.top) {
    document.documentElement.classList.add("embedded");
  }
  window.addEventListener("message", (ev) => {
    const data = ev && ev.data;
    if (!data || typeof data !== "object") return;
    if (ev.origin && ev.origin !== window.location.origin) return;
    if (data.type === "caselib-open-login-mgr") {
      openLoginMgr();
    }
    if (data.type === "caselib-close-login-mgr") {
      if (uiRoute === "loginMgr") {
        uiRoute = "home";
        render();
      }
    }
    if (data.type === "caselib-set-shell") {
      applyUiShell(data.shell);
    }
    if (data.type === "caselib-ping") {
      try {
        window.parent.postMessage({ type: "caselib-pong" }, ev.origin || window.location.origin);
      } catch (_) {}
    }
    if (data.type === "caselib-family-monitor") {
      void handleFamilyMonitorMessage(data, ev.origin || window.location.origin);
    }
  });
  bindEvents();
  try {
    await loadKnowledgeModels();
  } catch (_) {
    /* port counts fall back to 1/1/1 */
  }
  try {
    state = await loadStoreFromServer();
  } catch (err) {
    console.error(err);
    const legacy = loadLegacyLocalStorage();
    state = legacy || emptyState();
    toast(`读取本地文件失败，已回退浏览器缓存: ${err.message || err}`, "error");
  }
  if (!state.activeHomeId && state.homes.length) {
    state.activeHomeId = state.homes[0].uid;
  }
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "caselib-live-ready" }, window.location.origin);
    }
  } catch (_) {}
  render();
  setInterval(refreshRelativeTimes, 1000);
  syncAutoRefreshTimer();
  syncHighFreqTimer();
  if (electionPollEnabled) {
    const home = activeHome();
    if (home) {
      loadElectionSettings(home).then(() => {
        ensureElectionPollTimer();
      });
    } else {
      ensureElectionPollTimer();
    }
  }
  // Soft auto-fill when no SSO present (local Chrome / cache / env)
  const hasSso = Object.values(state.cookies || {}).some((c) =>
    /SSO_USER_TOKEN=/i.test(String(c || ""))
  );
  if (!hasSso) {
    try {
      await refreshSsoCookie({ quiet: true });
    } catch (_) {
      /* keep manual path */
    }
  }
  // 浏览器刷新 ≡ 一键读取：从接口拉取当前家庭全部数值
  await readAllActiveHome();
}

init();
