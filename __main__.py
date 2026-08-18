import sys
from pathlib import Path

_pkg_root = Path(__file__).resolve().parent
_repo_root = _pkg_root.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from caseLib.server import main

if __name__ == "__main__":
    main()
