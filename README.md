# caseLib

与 `groupAppControl` **同级**的用例库目录。只参考看板实现，**不修改** `groupAppControl` 内任何文件。

## 当前能力

主页 Tab：**知识图谱** · **家庭仿真** · **实时运行**（接线拓扑编辑已并入实时运行画布）。

实时运行画布：

- 拖拽接线（端子蓝点 → 一体机端口）· 管理端子
- 一键全接 / 清空接线
- 点线 / 双击端口断线 · 端子拖动改位置
- 能量流实况、读数、下发

家庭仿真（实验室 `lab_*.json`）：

- 顶栏：新建 / 一键全接 / 清空接线 / 保存；页内：已保存家庭切换、+设备/+端子
- PV/负载/离网曲线 + 防逆流，写入同一 `lab_*.json` 的 `scene`
  - **拖拽式曲线编辑**：预览图即编辑器 —「编辑 PV / 家庭 / 离网口」分层，拖圆点调时间/功率（拖动实时显示 `时刻·功率` 气泡）、空白处点击加点、双击圆点删点；预设/峰值/快捷值作为种子，「重置为预设」「均匀化」一键整形；改动即自动保存（控制点落盘到 `scene.input.pv_points/load_points/offgrid_points`，重载精确还原）
  - **三条可编辑曲线**：PV 源、家庭负载、**离网口负载**（设备 offgrid 端子 → Bypass 母线）。⚠️ Grid 侧是**入户电表读数**（`family_params.电表功率`，测量/派生值），不是场景输入项，故不在曲线编辑内
  - **PV 路数**：PV 源可选「几路」并联，**总功率 = 单路 × 路数**（单路仍 ≤600W = 单通道 SAS）。控制点按单路存储，图表/Y 轴按总功率显示，气泡显示 `总W (N×单路)`；`resolved.pv` 带 `routes / scale_w_total`，每点带 `w_total`
  - **参数模板库**：左栏顶「参数模板」卡片，把整套家庭仿真（PV含路数/家庭/离网/防逆流 + 曲线控制点）**另存为命名模板**、下拉切换即载入、保存到所选更新、删除。存 `data/scene_templates.json`，与接线家庭解耦。接口 `GET /api/scene/templates`、`POST /api/scene/template/save|delete`，模块 `caseLib/scene_templates.py`
  - **单页紧凑布局**：左栏参数（模板 / 真实导入 / 时间轴 / PV / 家庭 / 离网口 / 防逆流）+ 右栏大图表，曲线图直接可见免滚动；窄屏 <980px 自动堆叠为单列；左栏可**「收起参数」折叠**（图表全宽，状态记忆）
  - **导入 Excel/CSV**：每通道标题旁「⬆ 导入」按钮 → 选 `.xlsx/.csv` → 后端 `openpyxl`/`csv` 解析（自动识别表头，两列 = 时间[分钟/HH:MM/Excel 时间] + 功率W；单列则按 24h 均布）→ 载入该通道控制点并自动保存。接口 `POST /api/scene/import`（base64 上传），解析器 `caseLib/scene_import.py`。工具条「⬇ Excel模板」下载标准两列样例（`GET /api/scene/import-template`，openpyxl 生成）
  - **真实数据导入（Tuya 历史某天）**：左栏顶部卡片填 家庭ID + 日期 + 粒度（15m/30m/1h）→「拉取并导入」→ 后端调 Tuya 能源 RPC 网关 `getMultiDataDateConvertUnitToW` 拉 PV/负载真实曲线 → PV 自动按 `≤600W/路` 拆路数（总功率不变）、家庭负载按总功率载入 → 自动保存。接口 `POST /api/scene/fetch-remote`，实现 `caseLib/remote_data.py`（含瞬时超时自动重试）
    - **凭证**：点卡片「凭证」粘贴请求 Cookie（含 `SSO_USER_TOKEN`）+ 区域 Host（默认 `pie-eu.tuya-inc.com:7799`），**仅存浏览器 localStorage**，随请求转发，不写入代码/落盘。Cookie 过期需重设
- **型号维护**：`/models.html` 表格编辑（PV·Grid·离网·电池·PID）

## 启动

在仓库根目录用**前台**跑（关掉终端会停；不要依赖后台 `&`，容易被系统清掉）：

```bash
python3 -m caseLib
# http://127.0.0.1:8780/
# 拓扑 /  ·  场景 /scene.html  ·  型号 /models.html
```

> 注：旧默认端口 `8770` 在部分 macOS 上会被系统 `sharingd` 占用，已改为 `8780`。若需指定：`python3 -m caseLib 127.0.0.1 8780`

另开终端可后台常驻：

```bash
nohup python3 -m caseLib >>/tmp/caselib.log 2>&1 &
```

## 实时运行（内置拷贝 caseLib/live）

`caseLib/live/` 是 `groupAppControl` 的**独立拷贝**（可自由修改，不影响原目录），默认端口 **5179**、数据独立在 `caseLib/live/data/`。

- `python3 -m caseLib` 启动时会**自动带起** `caseLib.live`（可用 `CASELIB_NO_LIVE=1` 关闭；端口用 `CASELIB_LIVE_PORT` 改）。
- 主页 tab「实时运行」内嵌它（`GET /api/gac/ping` 探测可达性，未就绪时给出启动提示）。
- 单独跑：`python3 -m caseLib.live`。
