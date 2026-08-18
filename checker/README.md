# checker/ — 固件运行逻辑层（层3）

这一层是 **MCU 主机固件行为的前端复现**。真机怎么判工况、主机怎么多机分配、DP98 怎么打包，都在这里。
**权威源是 `CBE_RESONATE_MASTER`（主机 C 固件）。MCU 固件改了，只需同步本目录。**

- 纯 JS、全局作用域（经典 `<script>`，无 import/export、无打包）。
- 纯函数：只吃 `device`/`home`/`opts` 参数，不碰 `state`/DOM/`render`/`toast`。UI 层（app.js）调用它们。
- 加载顺序（见 live/static/index.html）：`device-model.js → owner-model.js → dp98.js → cluster.js`，再 flow.js、app.js。

## 文件 ↔ 固件映射

| 本层文件 | 职责 | 对应 CBE_RESONATE_MASTER |
|---|---|---|
| `device-model.js` | 型号/PID→限值(maxExport)、DP98 主机编号 `0x0A`、`modelMeta` | 机型能力常量；`u8workModel`/编号相关 |
| `owner-model.js` | 从机上报态判定 S1–S13（`classifyOwnerWorkModel`）+ 充放能力 clamp | `owner_infomation_package` 分类链（app/src/app_wifi.c，`u8workModel` 赋值 0x01~0x08/0x21） |
| `dp98.js` | DP98 `command_receive` 解析：头(防逆流/簇SOC/电网目标) + 编号/工作模式/充放/PV/指令/方向 | `get_djxt_data`(app_wifi.c) + `djxt_tranfer_data`(dev/src/dev_wifi_tranfer.c)。头 = `uwfnlflag` + `u8SocTest` + `iwGridPower` BE + `03 01`；每台 7 寄存器自 0x8000：numer / uwdata(=u8workModel) / chg / dchg / pv / 令 / order |
| `cluster.js` | 主机多机分配期望：充1强充 / 充2抑制 / 一充一放 / 充放优先级；自动测试目标矩阵 | 主机分配逻辑(app_wifi.c 的充1/充2/可放判定与抑制)；《从机状态判》「设备电力来源/方向优先级(多机分配)」 |

## 已知与固件的差异 / 待办

- 家庭电网购电限值：固件标"规划中"、非可读点位 → cluster.js 用可选配置项(UI `#atGridBuyLimit`)兜底充2抑制条件一。
- 电池 DC 充/放限值：固件 `bat_max_chg_w`(dev/inc + limits 表, `min(1500, curr*272/10)`, 随 SoC/温度)。当前 owner-model 直接读设备上报的 `battery_max_charge_power`；型号表新增的 `bat_dc_chg_w/bat_dc_dchg_w` 可作为读不到时的兜底（尚未接入，见 device-model.js）。
- 期望充电功率应取 `min(AC输入限, 电池DC充电限)`，当前用 gridLim 封顶，待接型号表 DC 限值。

## 改动纪律

- 只改本目录来跟随固件；不要在这里读 DOM 或调用 UI。
- 改判定阈值/分配规则 → 先对照 `CBE_RESONATE_MASTER` 对应函数，注释里标出固件文件行号。
