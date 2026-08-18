# AirMesh · groupAppControl

家庭设备快捷看板（本地代理 + 静态 UI）。

## 启动

```bash
# 仓库根目录
python3 -m groupAppControl
# 或
python3 server.py
```

默认地址：http://127.0.0.1:5178/

## 功能概览

- 实时运行情况 / 历史趋势 / 运行快照
- 集群选举趋势（`device_cluster_role` 时间轴、双主机冲突高亮）
- 运营后台 Cookie 代理读写

## 说明

- `data/store.json`、选举 CSV 等运行时数据不入库，本地首次启动会自动生成。
