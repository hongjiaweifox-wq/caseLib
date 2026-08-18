"""已合并进单服务：实时运行/自动测试由 `python3 -m caseLib`（端口 8780，/live.html）提供。

本模块（caseLib.live.server）现仅作为统一服务的后端基类被 caseLib.server 复用，
不再独立监听端口。直接运行 `python -m caseLib.live` 已停用，避免起第二个进程。
"""

import sys

if __name__ == "__main__":
    sys.exit(
        "caseLib.live 已并入单服务：请运行 `python3 -m caseLib`（http://127.0.0.1:8780/ ，实时运行在 /live.html）。"
    )
