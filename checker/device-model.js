/* ===================================================================
 * checker / 固件运行逻辑层 — 对齐 MCU 源码 CBE_RESONATE_MASTER。
 * MCU 固件改动只需同步本目录。全局作用域(经典 <script>)，无 import/export。
 * 本文件由 app.js 原样迁出，逻辑一字未改。
 * 来源 app.js: 型号/限值常量 + DP98 主机编号 + modelMeta
 * =================================================================== */

/** Device models: pid-schema.pid → model bucket → regulation_grid_export_p_limit cap */
const DEVICE_MODELS = [
  {
    id: "CBE2000",
    label: "CBE2000",
    badge: "CBE2000",
    maxExport: 2048,
    pids: ["c4ilzd7aybycece9"],
  },
  {
    id: "Lyra1500",
    label: "Lyra 1500",
    badge: "Lyra 1500",
    maxExport: 1500,
    pids: ["rloz0sela2ltnqqp", "jns5mgxgranqxjq3"],
  },
  {
    id: "Atlas3000",
    label: "atlas 3000",
    badge: "Atlas 3000",
    maxExport: 3000,
    pids: ["8lkqbvmmrx043jig"],
  },
];

const UNKNOWN_MODEL = { id: "unknown", label: "未知型号", badge: "未知", maxExport: null, pids: [] };

/** DP98 主机编号：固定 0x0A 表示本机主机槽位 */
const DP98_MASTER_NUMER = 0x0a;

function modelByPid(pid) {
  if (!pid) return null;
  return DEVICE_MODELS.find((m) => (m.pids || []).includes(String(pid))) || null;
}

function modelMeta(deviceOrModelId) {
  if (deviceOrModelId && typeof deviceOrModelId === "object") {
    const byPid = modelByPid(deviceOrModelId.pid);
    if (byPid) return byPid;
    if (deviceOrModelId.model) {
      return DEVICE_MODELS.find((m) => m.id === deviceOrModelId.model) || UNKNOWN_MODEL;
    }
    return UNKNOWN_MODEL;
  }
  return DEVICE_MODELS.find((m) => m.id === deviceOrModelId) || UNKNOWN_MODEL;
}
