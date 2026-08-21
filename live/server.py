#!/usr/bin/env python3
"""Family device quick console — local proxy + static UI.

Usage (from repo root or this folder):
  python3 groupAppControl/server.py
  # http://127.0.0.1:5178  (本机)
  # http://<局域网IP>:5178  (同网段可访问)
"""

import base64
import csv
import json
import os
import re
import socket
import subprocess
import ssl
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, quote, urlparse

STATIC_DIR = Path(__file__).resolve().parent / "static"
# checker/ 固件运行逻辑层（层3）在 caseLib 顶层，跨服务共享；此处按 /checker/ 前缀桥接。
CHECKER_DIR = Path(__file__).resolve().parent.parent / "checker"
DATA_DIR = Path(__file__).resolve().parent.parent / "results" / "data"  # 层4 统一持久化
STORE_FILE = DATA_DIR / "store.json"
ELECTION_DIR = DATA_DIR / "election"
REPORTS_DIR = DATA_DIR / "reports"  # 自动回归测试报告（md + csv + json 索引）
ELECTION_SETTINGS_FILE = DATA_DIR / "election_settings.json"
ELECTION_LOCK = threading.Lock()
ELECTION_CSV_FIELDS = [
    "pollAt",
    "reportTime",
    "homeId",
    "masterDeviceId",
    "masterName",
    "masterChanged",
    "prevMasterDeviceId",
    "conflict",
    "masterDeviceIds",
    "slaveDeviceIds",
    "devicesJson",
]
ELECTION_DEFAULT_INTERVAL_SEC = 5
# 0.0.0.0 = 允许局域网访问；可用 CASELIB_LIVE_HOST=127.0.0.1 仅本机
# caseLib 内的拷贝：默认 5179，独立 env，避免与原 groupAppControl(5178) 冲突
DEFAULT_HOST = os.environ.get("CASELIB_LIVE_HOST", os.environ.get("DEVICE_CONSOLE_HOST", "0.0.0.0"))
DEFAULT_PORT = int(os.environ.get("CASELIB_LIVE_PORT", "5179"))

# Hosts allowed for proxy (ops + hestia)
ALLOWED_HOSTS = {
    "newenergy-operation-cn.wgine-inc.com",
    "newenergy-operation-cn.tuya-inc.com",
    "newenergy-operation-eu.wgine-inc.com",
    "newenergy-operation-eu.tuya-inc.com",
    "newenergy-operation-us.wgine-inc.com",
    "newenergy-operation-us.tuya-inc.com",
    "newenergy-operation-sg.tuya-inc.com",
    "newenergy-operation-weaz.tuya-inc.com",
    "newenergy-operation-ueaz.tuya-inc.com",
    "hestia-cn.tuya-inc.com",
    "hestia-cn.wgine-inc.com",
    "hestia-eu.tuya-inc.com",
    "hestia-eu.wgine-inc.com",
    "hestia-us.tuya-inc.com",
    "hestia-us.wgine-inc.com",
    "hestia-sg.tuya-inc.com",
    "hestia-weaz.tuya-inc.com",
    "hestia-ueaz.tuya-inc.com",
    # backendng：家庭设备列表 (/inner/backendng/device/homeDevice)
    "backendng-cn.tuya-inc.com",
    "backendng-cn.wgine-inc.com",
    "backendng-eu.tuya-inc.com",
    "backendng-eu.wgine-inc.com",
    "backendng-us.tuya-inc.com",
    "backendng-us.wgine-inc.com",
    "backendng-sg.tuya-inc.com",
    "backendng-weaz.tuya-inc.com",
    "backendng-ueaz.tuya-inc.com",
    # iot：北斗产品详情（型号图标 headInfo）
    "iot.tuya-inc.com",
    "iot.wgine-inc.com",
    "127.0.0.1",
    "localhost",
}

API_PORT = 7799


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def _json_response(handler: SimpleHTTPRequestHandler, code: int, payload: Any) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)


def _default_store() -> Dict[str, Any]:
    return {"cookies": {}, "homes": [], "activeHomeId": None}


def _load_store() -> Dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STORE_FILE.exists():
        return _default_store()
    try:
        raw = json.loads(STORE_FILE.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return _default_store()
        return {
            "cookies": raw.get("cookies") if isinstance(raw.get("cookies"), dict) else {},
            "homes": raw.get("homes") if isinstance(raw.get("homes"), list) else [],
            "activeHomeId": raw.get("activeHomeId"),
        }
    except Exception:
        return _default_store()


def _save_store(payload: Dict[str, Any]) -> Dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    store = {
        "cookies": payload.get("cookies") if isinstance(payload.get("cookies"), dict) else {},
        "homes": payload.get("homes") if isinstance(payload.get("homes"), list) else [],
        "activeHomeId": payload.get("activeHomeId"),
    }
    tmp = STORE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(store, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(STORE_FILE)
    return store


def _import_cookies(incoming: Dict[str, Any], merge: bool = True) -> Dict[str, Any]:
    """Merge or replace store cookies from a remote push (e.g. Mac → VM)."""
    if not isinstance(incoming, dict):
        raise ValueError("cookies must be an object")
    store = _load_store()
    cookies = store.get("cookies") if isinstance(store.get("cookies"), dict) else {}
    if not isinstance(cookies, dict):
        cookies = {}
    cleaned: Dict[str, str] = {}
    for host, raw in incoming.items():
        h = str(host or "").strip()
        if not h:
            continue
        val = str(raw or "").strip()
        if not val:
            continue
        cleaned[h] = val
    if merge:
        cookies = {**cookies, **cleaned}
    else:
        cookies = cleaned
    store["cookies"] = cookies
    return _save_store(store)


def _tuya_domain_cookie(host: str = "iot.tuya-inc.com") -> str:
    """取用于 *.tuya-inc.com 的 cookie：优先该 host，否则复用任一域内 host 的（SSO 域级共享）。"""
    store = _load_store()
    cookies = store.get("cookies") if isinstance(store.get("cookies"), dict) else {}
    if not isinstance(cookies, dict):
        return ""
    if cookies.get(host):
        return cookies[host]
    for h, v in cookies.items():
        if v and str(h).endswith(".tuya-inc.com"):
            return v
    return ""


def _beidou_icon(pid: str) -> Dict[str, Any]:
    """北斗 headInfo → result.productVO.icon，拼 images.tuyacn.com 全量地址。"""
    pid = str(pid or "").strip()
    if not pid:
        return {"ok": False, "error": "missing pid", "icon": ""}
    cookie = _tuya_domain_cookie("iot.tuya-inc.com")
    path_qs = "/api/beidou/product/detail/headInfo?productId=" + urllib.parse.quote(pid)
    status, payload = _proxy_upstream("GET", "iot.tuya-inc.com", path_qs, cookie)
    icon = ""
    try:
        icon = (((payload.get("data") or {}).get("result") or {}).get("productVO") or {}).get("icon") or ""
    except Exception:
        icon = ""
    if icon and not str(icon).startswith("http"):
        icon = "https://images.tuyacn.com/" + str(icon).lstrip("/")
    if icon:
        return {"ok": True, "pid": pid, "icon": icon}
    return {"ok": False, "pid": pid, "icon": "", "upstreamStatus": status,
            "error": payload.get("error") or "no icon (可能未登录 iot.tuya-inc.com)"}


def _collect_raw_product_dps(obj: Any, out: List[Dict[str, str]]) -> None:
    """Walk Beidou DP ability payload; keep items with type=raw."""
    if isinstance(obj, list):
        for item in obj:
            _collect_raw_product_dps(item, out)
        return
    if not isinstance(obj, dict):
        return
    dtype = str(obj.get("type") or obj.get("dpType") or "").strip().lower()
    dp_id = obj.get("dpId") if obj.get("dpId") is not None else obj.get("id")
    if dp_id is None:
        dp_id = obj.get("dp_id")
    name = obj.get("name") or obj.get("dpName") or obj.get("code") or ""
    if dp_id is not None and str(dp_id) != "" and dtype == "raw":
        rec = {"dpId": str(dp_id), "name": str(name), "type": "raw"}
        if rec not in out:
            out.append(rec)
        return
    for val in obj.values():
        if isinstance(val, (dict, list)):
            _collect_raw_product_dps(val, out)


def _beidou_dp_ability(pid: str) -> Dict[str, Any]:
    """北斗 getProductDPAbility → type=raw 的 DP 列表（name / dpId）。"""
    pid = str(pid or "").strip()
    if not pid:
        return {"ok": False, "error": "missing pid", "dps": []}
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,64}", pid):
        return {"ok": False, "error": "invalid pid", "dps": []}
    cookie = _tuya_domain_cookie("iot.tuya-inc.com")
    path_qs = "/api/beidou/product/detail/getProductDPAbility?productId=" + urllib.parse.quote(pid)
    status, payload = _proxy_upstream("GET", "iot.tuya-inc.com", path_qs, cookie)
    data = payload.get("data") if isinstance(payload, dict) else {}
    if isinstance(data, dict) and (
        "<!DOCTYPE" in str(data.get("raw") or "") or "统一登录" in str(data.get("raw") or "")
    ):
        return {"ok": False, "error": "未登录 iot.tuya-inc.com，请点数据区登录态获取 Cookie", "dps": []}
    dps: List[Dict[str, str]] = []
    _collect_raw_product_dps(data if data else payload, dps)
    if payload.get("ok") is False and not dps:
        return {
            "ok": False,
            "pid": pid,
            "dps": [],
            "upstreamStatus": status,
            "error": payload.get("error") or "拉取 DP 能力失败",
        }
    return {"ok": True, "pid": pid, "dps": dps}


def _read_json(handler: SimpleHTTPRequestHandler) -> Dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


def _report_home_id(stem, meta=None):
    hid = str((meta or {}).get("homeId") or "").strip()
    if hid:
        return hid
    if "_" in str(stem or ""):
        return str(stem).split("_", 1)[1]
    return ""


def _strip_report_images(obj):
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if key in ("image", "thumb") and isinstance(value, str) and value.startswith("data:"):
                continue
            out[key] = _strip_report_images(value)
        return out
    if isinstance(obj, list):
        return [_strip_report_images(item) for item in obj]
    return obj


def _decode_data_url(data_url: str) -> Optional[Tuple[bytes, str]]:
    """Parse data:[mime];base64,... → (bytes, mime)."""
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        return None
    try:
        header, b64 = data_url.split(",", 1)
        mime = "image/jpeg"
        if ";" in header:
            mime = header[5:].split(";", 1)[0] or mime
        elif header.startswith("data:") and len(header) > 5:
            mime = header[5:] or mime
        return base64.b64decode(b64), mime
    except Exception:
        return None


def _mime_to_ext(mime: str) -> str:
    m = (mime or "").lower()
    if "png" in m:
        return ".png"
    if "webp" in m:
        return ".webp"
    if "gif" in m:
        return ".gif"
    return ".jpg"


def _persist_report_images(rid: str, payload: Any) -> Any:
    """Write frame JPEG data-URLs under reports/{rid}/frames/ and rewrite to /api/report/asset URLs."""
    if not isinstance(payload, (dict, list)):
        return payload
    frames_dir = REPORTS_DIR / rid / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    seq = {"n": 0}

    def save_blob(data_url: str, stem: str) -> Optional[str]:
        decoded = _decode_data_url(data_url)
        if not decoded:
            return None
        raw, mime = decoded
        name = f"{stem}{_mime_to_ext(mime)}"
        try:
            (frames_dir / name).write_bytes(raw)
        except Exception as exc:
            print(f"[caseLib] report frame write failed: {exc}", file=sys.stderr)
            return None
        return f"/api/report/asset?id={quote(rid)}&file={quote(name)}"

    def walk_frame(frame: Any) -> Any:
        if not isinstance(frame, dict):
            return frame
        out = dict(frame)
        seq["n"] += 1
        fid = re.sub(r"[^A-Za-z0-9._-]+", "_", str(out.get("id") or f"f{seq['n']}"))[:64] or f"f{seq['n']}"
        for key, suffix in (("image", ""), ("thumb", ".thumb")):
            val = out.get(key)
            if isinstance(val, str) and val.startswith("data:"):
                url = save_blob(val, f"{fid}{suffix}")
                if url:
                    out[key] = url
                else:
                    out.pop(key, None)
            elif isinstance(val, str) and val.startswith("/api/report/asset"):
                pass
            elif key in out and isinstance(val, str) and not val:
                out.pop(key, None)
        return out

    def walk(obj: Any) -> Any:
        if isinstance(obj, list):
            return [walk(item) for item in obj]
        if not isinstance(obj, dict):
            return obj
        out = {}
        for key, value in obj.items():
            if key == "frames" and isinstance(value, list):
                out[key] = [walk_frame(item) for item in value]
            else:
                out[key] = walk(value)
        return out

    return walk(payload)


def _report_asset_path(rid: str, filename: str) -> Optional[Path]:
    """Resolve a safe path under reports/{rid}/frames/."""
    rid = _safe_home_key(rid)
    name = Path(str(filename or "")).name
    if not rid or not name or not re.match(r"^[A-Za-z0-9._-]+$", name):
        return None
    target = (REPORTS_DIR / rid / "frames" / name).resolve()
    root = (REPORTS_DIR / rid / "frames").resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return None
    return target if target.is_file() else None


def _safe_home_key(home_id: str) -> str:
    key = re.sub(r"[^A-Za-z0-9._-]+", "_", str(home_id or "").strip())
    return key[:120] or "default"


def _election_csv_path(home_id: str) -> Path:
    ELECTION_DIR.mkdir(parents=True, exist_ok=True)
    return ELECTION_DIR / f"{_safe_home_key(home_id)}.csv"


def _load_election_settings() -> Dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not ELECTION_SETTINGS_FILE.exists():
        return {"intervalSec": ELECTION_DEFAULT_INTERVAL_SEC, "byHome": {}}
    try:
        raw = json.loads(ELECTION_SETTINGS_FILE.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return {"intervalSec": ELECTION_DEFAULT_INTERVAL_SEC, "byHome": {}}
        interval = int(raw.get("intervalSec") or ELECTION_DEFAULT_INTERVAL_SEC)
        by_home = raw.get("byHome") if isinstance(raw.get("byHome"), dict) else {}
        return {"intervalSec": max(1, min(3600, interval)), "byHome": by_home}
    except Exception:
        return {"intervalSec": ELECTION_DEFAULT_INTERVAL_SEC, "byHome": {}}


def _save_election_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cur = _load_election_settings()
    if "intervalSec" in payload:
        try:
            cur["intervalSec"] = max(1, min(3600, int(payload.get("intervalSec"))))
        except Exception:
            pass
    home_id = str(payload.get("homeId") or "").strip()
    if home_id and "intervalSec" in payload:
        by_home = cur.get("byHome") if isinstance(cur.get("byHome"), dict) else {}
        by_home[home_id] = {"intervalSec": cur["intervalSec"]}
        cur["byHome"] = by_home
    tmp = ELECTION_SETTINGS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cur, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(ELECTION_SETTINGS_FILE)
    return cur


def _election_interval_for(home_id: str) -> int:
    settings = _load_election_settings()
    home_id = str(home_id or "").strip()
    by_home = settings.get("byHome") if isinstance(settings.get("byHome"), dict) else {}
    if home_id and isinstance(by_home.get(home_id), dict):
        try:
            return max(1, min(3600, int(by_home[home_id].get("intervalSec"))))
        except Exception:
            pass
    return int(settings.get("intervalSec") or ELECTION_DEFAULT_INTERVAL_SEC)


def _append_election_rows(home_id: str, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    path = _election_csv_path(home_id)
    with ELECTION_LOCK:
        header_ok = False
        if path.exists() and path.stat().st_size > 0:
            try:
                with path.open("r", encoding="utf-8", newline="") as f:
                    reader = csv.reader(f)
                    header = next(reader, [])
                header_ok = list(header) == list(ELECTION_CSV_FIELDS)
            except Exception:
                header_ok = False
            if not header_ok:
                # schema changed — drop legacy file and start fresh
                path.unlink(missing_ok=True)
        new_file = not path.exists() or path.stat().st_size == 0
        with path.open("a", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=ELECTION_CSV_FIELDS, extrasaction="ignore")
            if new_file:
                writer.writeheader()
            for row in rows:
                out = {k: "" if row.get(k) is None else row.get(k) for k in ELECTION_CSV_FIELDS}
                writer.writerow(out)
        count = 0
        with path.open("r", encoding="utf-8", newline="") as f:
            count = max(0, sum(1 for _ in f) - 1)
    return {"path": str(path), "rowCount": count}


def _read_election_rows(home_id: str, limit: int = 800) -> Dict[str, Any]:
    path = _election_csv_path(home_id)
    limit = max(1, min(5000, int(limit or 800)))
    if not path.exists():
        return {"path": str(path), "rows": [], "rowCount": 0}
    with ELECTION_LOCK:
        with path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            all_rows = list(reader)
    return {"path": str(path), "rows": all_rows[-limit:], "rowCount": len(all_rows)}


def _clear_election_csv(home_id: str) -> Dict[str, Any]:
    path = _election_csv_path(home_id)
    with ELECTION_LOCK:
        if path.exists():
            path.unlink()
    return {"path": str(path), "rowCount": 0}


def _send_csv_file(handler: SimpleHTTPRequestHandler, path: Path, download_name: str) -> None:
    if not path.exists():
        body = (",".join(ELECTION_CSV_FIELDS) + "\n").encode("utf-8")
    else:
        body = path.read_bytes()
    handler.send_response(200)
    handler.send_header("Content-Type", "text/csv; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)


# Real upstream paths mirrored on this host (browser Network shows the real API).
# Still uses X-Target-Host + X-Cookie; never calls tuya from the browser directly.
_PROXY_PATH_PREFIXES = (
    "/api/wireman-kong/",
    "/api/smartenergy-kong/",
    "/api/bizlog/",
    "/inner/backendng/",
    "/api/device/detail/",
)

# Legacy short aliases → real upstream path (keep old clients working)
_PROXY_GET_ALIASES = {
    "/api/proxy/pid-schema": "/api/wireman-kong/ems/energy-device/pid-schema",
    "/api/proxy/property-query": "/api/wireman-kong/ems/energy-device/property/query",
    "/api/proxy/protocol-query": "/api/wireman-kong/ems/energy-device/protocol/query",
    "/api/proxy/protocol-model-page": "/api/wireman-kong/ems/protocol-model/query/page",
    "/api/proxy/query-neko": "/api/wireman-kong/ems/energy-device/query-neko",
    "/api/proxy/high-frequency": "/api/smartenergy-kong/group/high/frequency",
}
_PROXY_POST_ALIASES = {
    "/api/proxy/issue": "/api/wireman-kong/ems/energy-device/issue",
    "/api/proxy/group-device-issue": "/api/wireman-kong/ems/energy-group/device/issue",
    "/api/proxy/shadow-property": "/api/wireman-kong/ems/energy-device/query-shadow-property",
    "/api/proxy/bizlog-search": "/api/bizlog/search",
    "/api/proxy/home-device": "/inner/backendng/device/homeDevice",
}


def _is_passthrough_proxy_path(path: str) -> bool:
    return any(path.startswith(p) for p in _PROXY_PATH_PREFIXES)


SSO_SCRIPT = Path(__file__).resolve().parent / "scripts" / "sso-token.mjs"
SSO_DEFAULT_URL = "https://newenergy-operation-eu.tuya-inc.com"


def _find_node_bin() -> Optional[str]:
    env_bin = (os.environ.get("NODE_BIN") or "").strip()
    candidates = [env_bin] if env_bin else []
    candidates.extend(
        [
            "node",
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            str(Path.home() / ".nvm/current/bin/node"),
        ]
    )
    for cand in candidates:
        if not cand:
            continue
        try:
            subprocess.run(
                [cand, "-v"],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=3,
            )
            return cand
        except Exception:
            continue
    return None


def _normalize_sso_cookie(raw: str) -> str:
    """Return a Cookie header fragment that includes SSO_USER_TOKEN=..."""
    text = (raw or "").strip().strip('"').strip("'")
    if not text:
        return ""
    # Prefer explicit SSO_USER_TOKEN pair from a full cookie string
    for part in text.split(";"):
        part = part.strip()
        if part.upper().startswith("SSO_USER_TOKEN="):
            return part
    if "=" not in text:
        return f"SSO_USER_TOKEN={text}"
    if text.upper().startswith("SSO_USER_TOKEN="):
        return text.split(";", 1)[0].strip()
    return text


def _merge_sso_cookie(existing: str, sso_pair: str) -> str:
    pair = _normalize_sso_cookie(sso_pair)
    if not pair:
        return (existing or "").strip()
    parts = [p.strip() for p in (existing or "").split(";") if p.strip()]
    out: List[str] = []
    replaced = False
    for p in parts:
        name = p.split("=", 1)[0].strip()
        if name.upper() == "SSO_USER_TOKEN":
            if not replaced:
                out.append(pair)
                replaced = True
            continue
        out.append(p)
    if not replaced:
        out.insert(0, pair)
    return "; ".join(out)


def _sso_apply_hosts(store: Dict[str, Any], sso_pair: str, host: str = "") -> List[str]:
    cookies = store.get("cookies") if isinstance(store.get("cookies"), dict) else {}
    if not isinstance(cookies, dict):
        cookies = {}
    targets = set()
    if host and host in ALLOWED_HOSTS:
        targets.add(host)
    for h in list(cookies.keys()) + list(ALLOWED_HOSTS):
        if not h or h in ("127.0.0.1", "localhost"):
            continue
        if h.endswith(".tuya-inc.com") or h.endswith(".wgine-inc.com") or h.endswith(".tuya-inc.top"):
            targets.add(h)
    applied: List[str] = []
    for h in sorted(targets):
        cookies[h] = _merge_sso_cookie(str(cookies.get(h) or ""), sso_pair)
        applied.append(h)
    store["cookies"] = cookies
    return applied


def _fetch_sso_token(force: bool = False, url: str = "") -> Dict[str, Any]:
    """Run vendored tuya-sso-token script; return {ok, cookie, preview, source?, error?}."""
    node = _find_node_bin()
    if not node:
        return {
            "ok": False,
            "error": "未找到 node，请安装 Node.js ≥ 22.5 或设置 NODE_BIN",
            "hint": "若页面开在虚拟机 IP：请先在本机启动 groupAppControl（127.0.0.1:5178），再点自动获取；或手动粘贴 Cookie",
        }
    if not SSO_SCRIPT.is_file():
        return {"ok": False, "error": f"缺少 SSO 脚本: {SSO_SCRIPT}"}
    target = (url or "").strip() or SSO_DEFAULT_URL
    cmd = [node, str(SSO_SCRIPT), "get", "--quiet", "--url", target]
    if force:
        cmd.append("--force")
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=90,
            env={**os.environ, "TUYA_SSO_BOOTSTRAPPED": os.environ.get("TUYA_SSO_BOOTSTRAPPED", "")},
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "获取 SSO Token 超时（可能卡在钥匙串授权）"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode != 0 or not stdout:
        hint = stderr.splitlines()[-1] if stderr else f"exit={proc.returncode}"
        # keep stderr short for UI
        detail = "\n".join(stderr.splitlines()[-8:]) if stderr else hint
        return {
            "ok": False,
            "error": "无法自动获取 SSO Token（本机浏览器未登录 / 钥匙串未授权 / 虚拟机无 Chrome 登录态）",
            "detail": detail,
            "exitCode": proc.returncode,
        }
    cookie = _normalize_sso_cookie(stdout.splitlines()[-1].strip())
    if not cookie.upper().startswith("SSO_USER_TOKEN="):
        return {"ok": False, "error": "SSO 脚本输出无法识别", "detail": stdout[:120]}
    preview = cookie[:28] + f"...({len(cookie)} chars)"
    source = ""
    for line in stderr.splitlines():
        if "来源:" in line or "命中" in line or "从缓存" in line or "source=" in line:
            source = line.strip()
            break
    return {"ok": True, "cookie": cookie, "preview": preview, "source": source or "sso-token"}


def _proxy_upstream(
    method: str,
    target_host: str,
    path_qs: str,
    cookie: str,
    body: Optional[bytes] = None,
) -> Tuple[int, Dict[str, Any]]:
    if target_host not in ALLOWED_HOSTS:
        return 400, {"ok": False, "error": f"host not allowed: {target_host}"}

    if target_host in ("127.0.0.1", "localhost"):
        base = f"http://{target_host}:{API_PORT}"
    else:
        base = f"https://{target_host}:{API_PORT}"

    url = f"{base}{path_qs}"
    headers = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "groupAppControl/1.0",
        "Referer": f"{base}/",
        "Origin": base,
    }
    if cookie:
        headers["Cookie"] = cookie
    if body is not None:
        headers["Content-Type"] = "application/json;charset=UTF-8"

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(raw) if raw else {}
            except Exception:
                data = {"raw": raw}
            return resp.status, {"ok": True, "status": resp.status, "data": data}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {"raw": raw}
        return exc.code, {"ok": False, "status": exc.code, "error": str(exc.reason), "data": data}
    except Exception as exc:
        return 502, {
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def end_headers(self) -> None:
        # Avoid stale app.js/css/favicon after local edits
        if (
            self.path.startswith("/app.js")
            or self.path.startswith("/flow.js")
            or self.path.startswith("/style.css")
            or self.path.startswith("/index")
            or self.path.startswith("/favicon")
            or self.path.startswith("/app-icon")
        ):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[groupAppControl] " + (fmt % args) + "\n")

    def _serve_checker(self, path: str) -> None:
        """Serve checker/ (层3 固件逻辑) js from caseLib/checker/, guarded against traversal."""
        rel = path[len("/checker/"):].split("?", 1)[0].lstrip("/")
        target = (CHECKER_DIR / rel).resolve()
        if CHECKER_DIR.resolve() not in target.parents or not target.is_file():
            self.send_error(404, "checker file not found")
            return
        data = target.read_bytes()
        ctype = "text/javascript; charset=utf-8" if target.suffix == ".js" else "text/plain; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Cookie, X-Target-Host")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/checker/"):
            return self._serve_checker(path)

        if path == "/api/health":
            return _json_response(
                self,
                200,
                {
                    "ok": True,
                    "service": "groupAppControl",
                    "port": DEFAULT_PORT,
                    "storeFile": str(STORE_FILE),
                },
            )

        if path == "/api/store":
            store = _load_store()
            return _json_response(
                self,
                200,
                {"ok": True, "store": store, "path": str(STORE_FILE)},
            )

        if path == "/api/reports":
            REPORTS_DIR.mkdir(parents=True, exist_ok=True)
            items = []
            for p in sorted(REPORTS_DIR.glob("*.json"), reverse=True):
                if p.name.endswith(".data.json"):
                    continue
                try:
                    meta = json.loads(p.read_text(encoding="utf-8"))
                except Exception:
                    continue
                hid = _report_home_id(p.stem, meta)
                items.append({
                    "id": p.stem,
                    "title": meta.get("title") or p.stem,
                    "createdAt": meta.get("createdAt"),
                    "summary": meta.get("summary") or "",
                    "status": meta.get("status") or "done",
                    "planned": meta.get("planned"),
                    "done": meta.get("done"),
                    "total": meta.get("total"),
                    "passed": meta.get("passed"),
                    "failed": meta.get("failed"),
                    "hasMd": (REPORTS_DIR / f"{p.stem}.md").is_file(),
                    "hasCsv": (REPORTS_DIR / f"{p.stem}.csv").is_file(),
                    "hasJson": (REPORTS_DIR / f"{p.stem}.data.json").is_file(),
                    "homeId": hid,
                    "homeName": meta.get("homeName") or "",
                })
            return _json_response(self, 200, {"ok": True, "reports": items})

        if path == "/api/report":
            qs = parse_qs(urlparse(self.path).query)
            rid = _safe_home_key((qs.get("id") or [""])[0])
            fmt = (qs.get("fmt") or ["md"])[0]
            ext = "csv" if fmt == "csv" else "json" if fmt == "json" else "md"
            if ext == "json":
                data_p = REPORTS_DIR / f"{rid}.data.json"
                meta_p = REPORTS_DIR / f"{rid}.json"
                md_p = REPORTS_DIR / f"{rid}.md"
                if data_p.is_file():
                    return _json_response(self, 200, {"ok": True, "id": rid, "report": json.loads(data_p.read_text(encoding="utf-8"))})
                if meta_p.is_file():
                    meta = json.loads(meta_p.read_text(encoding="utf-8"))
                    markdown = md_p.read_text(encoding="utf-8") if md_p.is_file() else ""
                    return _json_response(self, 200, {
                        "ok": True,
                        "id": rid,
                        "report": {
                            "id": rid,
                            "homeId": _report_home_id(rid, meta),
                            "homeName": meta.get("homeName") or "",
                            "title": meta.get("title") or rid,
                            "createdAt": meta.get("createdAt"),
                            "status": meta.get("status") or "done",
                            "summary": {
                                "cycles": meta.get("done") or 0,
                                "planned": meta.get("planned"),
                                "total": meta.get("total") or 0,
                                "passed": meta.get("passed") or 0,
                                "failed": meta.get("failed") or 0,
                                "status": meta.get("status") or "done",
                            },
                            "cycles": [],
                            "frames": [],
                            "markdown": markdown,
                        },
                    })
                return _json_response(self, 404, {"ok": False, "error": "report not found"})
            p = REPORTS_DIR / f"{rid}.{ext}"
            if not rid or not p.is_file():
                return _json_response(self, 404, {"ok": False, "error": "report not found"})
            if ext == "csv":
                data = p.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{rid}.csv"')
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
                return
            if ext == "json":
                return _json_response(self, 200, {"ok": True, "id": rid, "report": json.loads(p.read_text(encoding="utf-8"))})
            return _json_response(self, 200, {"ok": True, "id": rid, "markdown": p.read_text(encoding="utf-8")})

        if path == "/api/report/asset":
            qs = parse_qs(urlparse(self.path).query)
            rid = (qs.get("id") or [""])[0]
            fname = (qs.get("file") or [""])[0]
            asset = _report_asset_path(rid, fname)
            if not asset:
                return _json_response(self, 404, {"ok": False, "error": "asset not found"})
            data = asset.read_bytes()
            ctype = "image/jpeg"
            if asset.suffix.lower() == ".png":
                ctype = "image/png"
            elif asset.suffix.lower() == ".webp":
                ctype = "image/webp"
            elif asset.suffix.lower() == ".gif":
                ctype = "image/gif"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(data)
            return

        if path == "/api/config":
            return _json_response(
                self,
                200,
                {
                    "envs": [
                        {
                            "host": h,
                            "name": n["name"],
                            "short": n["short"],
                            "region": n["region"],
                            "supported": n["supported"],
                        }
                        for h, n in ENV_CONFIG.items()
                    ],
                },
            )

        if path == "/api/beidou/icon":
            qs = parse_qs(parsed.query)
            return _json_response(self, 200, _beidou_icon((qs.get("pid") or [""])[0]))

        if path == "/api/beidou/dp-ability":
            qs = parse_qs(parsed.query)
            return _json_response(self, 200, _beidou_dp_ability((qs.get("pid") or [""])[0]))

        if path == "/api/proxy/pid-schema":
            return self._handle_proxy_get(_PROXY_GET_ALIASES[path])

        if path == "/api/proxy/property-query":
            return self._handle_proxy_get(_PROXY_GET_ALIASES[path])

        if path == "/api/proxy/protocol-query":
            return self._handle_proxy_get(_PROXY_GET_ALIASES[path])

        if path == "/api/proxy/protocol-model-page":
            return self._handle_proxy_get(_PROXY_GET_ALIASES[path])

        if path == "/api/proxy/query-neko":
            return self._handle_proxy_get(_PROXY_GET_ALIASES[path])

        if path == "/api/proxy/high-frequency":
            return self._handle_proxy_get(_PROXY_GET_ALIASES[path])

        if path == "/api/proxy/device-detail":
            return self._handle_proxy_device_detail()

        # Real upstream paths (preferred): browser Network shows wireman/backendng paths
        if path.startswith("/api/device/detail/"):
            return self._handle_proxy_device_detail_path(path)
        if _is_passthrough_proxy_path(path):
            return self._handle_proxy_get(path)

        if path == "/api/sso/status":
            node = _find_node_bin()
            return _json_response(
                self,
                200,
                {
                    "ok": True,
                    "node": bool(node),
                    "nodeBin": node or "",
                    "script": SSO_SCRIPT.is_file(),
                    "scriptPath": str(SSO_SCRIPT),
                },
            )

        if path == "/api/election/settings":
            qs = parse_qs(parsed.query)
            home_id = (qs.get("homeId") or [""])[0]
            return _json_response(
                self,
                200,
                {
                    "ok": True,
                    "intervalSec": _election_interval_for(home_id),
                    "settings": _load_election_settings(),
                    "csvPath": str(_election_csv_path(home_id)) if home_id else str(ELECTION_DIR),
                },
            )

        if path == "/api/election/rows":
            qs = parse_qs(parsed.query)
            home_id = (qs.get("homeId") or [""])[0]
            if not home_id:
                return _json_response(self, 400, {"ok": False, "error": "missing homeId"})
            try:
                limit = int((qs.get("limit") or ["800"])[0])
            except Exception:
                limit = 800
            data = _read_election_rows(home_id, limit)
            return _json_response(
                self,
                200,
                {
                    "ok": True,
                    "homeId": home_id,
                    "intervalSec": _election_interval_for(home_id),
                    **data,
                },
            )

        if path == "/api/election/download":
            qs = parse_qs(parsed.query)
            home_id = (qs.get("homeId") or [""])[0]
            if not home_id:
                return _json_response(self, 400, {"ok": False, "error": "missing homeId"})
            path_csv = _election_csv_path(home_id)
            return _send_csv_file(self, path_csv, f"election_{_safe_home_key(home_id)}.csv")

        if path in ("/", "/index.html"):
            self.path = "/index.html"
            return super().do_GET()
        if path.startswith("/api/"):
            return _json_response(self, 404, {"ok": False, "error": f"not found: {path}"})
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/report/save":
            body = _read_json(self)
            REPORTS_DIR.mkdir(parents=True, exist_ok=True)
            ts = time.strftime("%Y%m%d-%H%M%S", time.localtime())
            base = _safe_home_key(str(body.get("name") or "report"))
            req_id = _safe_home_key(str(body.get("id") or ""))
            if req_id and (REPORTS_DIR / f"{req_id}.json").is_file():
                rid = req_id
            else:
                rid = f"{ts}_{base}"[:80]
            status = str(body.get("status") or "done")
            meta = {
                "title": str(body.get("title") or base),
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
                "summary": str(body.get("summary") or ""),
                "status": status,
                "homeId": str(body.get("homeId") or ""),
                "homeName": str(body.get("homeName") or ""),
                "planned": body.get("planned"),
                "done": body.get("done"),
                "total": body.get("total"),
                "passed": body.get("passed"),
                "failed": body.get("failed"),
            }
            (REPORTS_DIR / f"{rid}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            if body.get("markdown") is not None:
                (REPORTS_DIR / f"{rid}.md").write_text(str(body.get("markdown")), encoding="utf-8")
            if body.get("csv") is not None:
                (REPORTS_DIR / f"{rid}.csv").write_text(str(body.get("csv")), encoding="utf-8")
            if body.get("reportJson") is not None:
                data_p = REPORTS_DIR / f"{rid}.data.json"
                payload = body.get("reportJson")
                try:
                    payload = _persist_report_images(rid, payload)
                    data_p.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
                except Exception as exc:
                    print(f"[caseLib] report data.json failed: {exc}", file=sys.stderr)
                    try:
                        data_p.write_text(json.dumps(_strip_report_images(payload), ensure_ascii=False), encoding="utf-8")
                    except Exception as exc2:
                        print(f"[caseLib] report data.json slim failed: {exc2}", file=sys.stderr)
            return _json_response(self, 200, {"ok": True, "id": rid})

        if path == "/api/store":
            body = _read_json(self)
            try:
                saved = _save_store(body.get("store") if isinstance(body.get("store"), dict) else body)
            except Exception as exc:
                return _json_response(
                    self,
                    500,
                    {"ok": False, "error": str(exc), "traceback": traceback.format_exc()},
                )
            return _json_response(
                self,
                200,
                {"ok": True, "store": saved, "path": str(STORE_FILE)},
            )

        if path == "/api/cookies/import":
            body = _read_json(self)
            incoming = body.get("cookies") if isinstance(body.get("cookies"), dict) else None
            if not incoming:
                return _json_response(self, 400, {"ok": False, "error": "missing cookies object"})
            merge = body.get("merge", True)
            try:
                saved = _import_cookies(incoming, merge=bool(merge))
            except Exception as exc:
                return _json_response(
                    self,
                    500,
                    {"ok": False, "error": str(exc), "traceback": traceback.format_exc()},
                )
            n = len(incoming)
            return _json_response(
                self,
                200,
                {
                    "ok": True,
                    "imported": n,
                    "hosts": sorted(str(k) for k in incoming.keys()),
                    "cookies": saved.get("cookies") if isinstance(saved, dict) else {},
                    "path": str(STORE_FILE),
                    "merge": bool(merge),
                },
            )

        if path == "/api/proxy/issue":
            return self._handle_proxy_post(_PROXY_POST_ALIASES[path])

        if path == "/api/proxy/group-device-issue":
            return self._handle_proxy_post(_PROXY_POST_ALIASES[path])

        if path == "/api/proxy/shadow-property":
            return self._handle_proxy_post(_PROXY_POST_ALIASES[path])

        if path == "/api/proxy/bizlog-search":
            return self._handle_proxy_post(_PROXY_POST_ALIASES[path])

        if path == "/api/proxy/home-device":
            # 家庭设备列表：POST {homeId, offset, limit} → backendng-<region>.tuya-inc.com
            return self._handle_proxy_post(_PROXY_POST_ALIASES[path])

        if _is_passthrough_proxy_path(path):
            return self._handle_proxy_post(path)

        if path == "/api/sso/refresh":
            body = _read_json(self)
            force = bool(body.get("force"))
            host = str(body.get("host") or "").strip()
            apply_all = body.get("applyAll", True)
            url = str(body.get("url") or "").strip()
            cookie_in = str(body.get("cookie") or "").strip()
            if not url and host and host in ALLOWED_HOSTS and host not in ("127.0.0.1", "localhost"):
                url = f"https://{host}"
            # Remote UI may import cookie harvested from local Mac (127.0.0.1:5178)
            if cookie_in:
                sso_pair = _normalize_sso_cookie(cookie_in)
                if not sso_pair:
                    return _json_response(self, 200, {"ok": False, "error": "cookie 无效"})
                result = {
                    "ok": True,
                    "cookie": sso_pair,
                    "preview": sso_pair[:48] + ("…" if len(sso_pair) > 48 else ""),
                    "source": "imported",
                }
            else:
                result = _fetch_sso_token(force=force, url=url)
                if not result.get("ok"):
                    return _json_response(self, 200, result)
                sso_pair = str(result.get("cookie") or "")
            store = _load_store()
            applied: List[str] = []
            if apply_all:
                applied = _sso_apply_hosts(store, sso_pair, host=host)
            elif host:
                cookies = store.get("cookies") if isinstance(store.get("cookies"), dict) else {}
                cookies[host] = _merge_sso_cookie(str(cookies.get(host) or ""), sso_pair)
                store["cookies"] = cookies
                applied = [host]
            try:
                saved = _save_store(store)
            except Exception as exc:
                return _json_response(
                    self,
                    500,
                    {"ok": False, "error": str(exc), "traceback": traceback.format_exc()},
                )
            return _json_response(
                self,
                200,
                {
                    "ok": True,
                    "cookie": sso_pair,
                    "preview": result.get("preview"),
                    "source": result.get("source"),
                    "appliedHosts": applied,
                    "cookies": saved.get("cookies") if isinstance(saved, dict) else store.get("cookies"),
                    "path": str(STORE_FILE),
                },
            )

        if path == "/api/election/settings":
            body = _read_json(self)
            try:
                saved = _save_election_settings(body)
                home_id = str(body.get("homeId") or "").strip()
                return _json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "settings": saved,
                        "intervalSec": _election_interval_for(home_id) if home_id else saved.get("intervalSec"),
                    },
                )
            except Exception as exc:
                return _json_response(
                    self,
                    500,
                    {"ok": False, "error": str(exc), "traceback": traceback.format_exc()},
                )

        if path == "/api/election/append":
            body = _read_json(self)
            home_id = str(body.get("homeId") or "").strip()
            rows = body.get("rows")
            if not home_id:
                return _json_response(self, 400, {"ok": False, "error": "missing homeId"})
            if not isinstance(rows, list) or not rows:
                return _json_response(self, 400, {"ok": False, "error": "missing rows"})
            try:
                meta = _append_election_rows(home_id, rows)
                return _json_response(self, 200, {"ok": True, "homeId": home_id, **meta})
            except Exception as exc:
                return _json_response(
                    self,
                    500,
                    {"ok": False, "error": str(exc), "traceback": traceback.format_exc()},
                )

        if path == "/api/election/clear":
            body = _read_json(self)
            home_id = str(body.get("homeId") or "").strip()
            if not home_id:
                return _json_response(self, 400, {"ok": False, "error": "missing homeId"})
            try:
                meta = _clear_election_csv(home_id)
                return _json_response(self, 200, {"ok": True, "homeId": home_id, **meta})
            except Exception as exc:
                return _json_response(
                    self,
                    500,
                    {"ok": False, "error": str(exc), "traceback": traceback.format_exc()},
                )

        return _json_response(self, 404, {"ok": False, "error": "not found"})

    def _proxy_meta(self) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """Return (host, cookie, error)."""
        host = self.headers.get("X-Target-Host") or ""
        cookie = self.headers.get("X-Cookie") or ""
        if not host:
            qs = parse_qs(urlparse(self.path).query)
            host = (qs.get("host") or [""])[0]
        if not host:
            return None, None, "missing X-Target-Host"
        if host not in ALLOWED_HOSTS:
            return None, None, f"host not allowed: {host}"
        return host, cookie, None

    def _handle_proxy_get(self, api_path: str) -> None:
        host, cookie, err = self._proxy_meta()
        if err:
            return _json_response(self, 400, {"ok": False, "error": err})

        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        # strip our helper params
        forward = {k: v[0] for k, v in qs.items() if k not in ("host",)}
        path_qs = api_path
        if forward:
            path_qs += "?" + urllib.parse.urlencode(forward)

        status, payload = _proxy_upstream("GET", host, path_qs, cookie or "")
        return _json_response(self, 200 if payload.get("ok") else status, payload)

    def _handle_proxy_device_detail(self) -> None:
        """GET backendng /api/device/detail/{deviceId} for module/MCU versions (legacy ?deviceId=)."""
        host, cookie, err = self._proxy_meta()
        if err:
            return _json_response(self, 400, {"ok": False, "error": err})
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        device_id = (qs.get("deviceId") or [""])[0].strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", device_id):
            return _json_response(self, 400, {"ok": False, "error": "invalid deviceId"})
        status, payload = _proxy_upstream(
            "GET", host, f"/api/device/detail/{device_id}", cookie or ""
        )
        return _json_response(self, 200 if payload.get("ok") else status, payload)

    def _handle_proxy_device_detail_path(self, path: str) -> None:
        """GET /api/device/detail/{deviceId} — real path shape for Network panel."""
        host, cookie, err = self._proxy_meta()
        if err:
            return _json_response(self, 400, {"ok": False, "error": err})
        device_id = path[len("/api/device/detail/") :].split("?", 1)[0].strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", device_id):
            return _json_response(self, 400, {"ok": False, "error": "invalid deviceId"})
        status, payload = _proxy_upstream(
            "GET", host, f"/api/device/detail/{device_id}", cookie or ""
        )
        return _json_response(self, 200 if payload.get("ok") else status, payload)

    def _handle_proxy_post(self, api_path: str) -> None:
        host, cookie, err = self._proxy_meta()
        if err:
            return _json_response(self, 400, {"ok": False, "error": err})

        body_obj = _read_json(self)
        body = json.dumps(body_obj, ensure_ascii=False).encode("utf-8")
        status, payload = _proxy_upstream("POST", host, api_path, cookie or "", body)
        return _json_response(self, 200 if payload.get("ok") else status, payload)


ENV_CONFIG = {
    "newenergy-operation-cn.wgine-inc.com": {
        "name": "中国预发",
        "short": "CN-Pre",
        "region": "cn",
        "supported": True,
    },
    "newenergy-operation-cn.tuya-inc.com": {
        "name": "中国线上",
        "short": "CN-Prod",
        "region": "cn",
        "supported": True,
    },
    "newenergy-operation-eu.wgine-inc.com": {
        "name": "欧洲预发",
        "short": "EU-Pre",
        "region": "eu",
        "supported": True,
    },
    "newenergy-operation-eu.tuya-inc.com": {
        "name": "欧洲线上",
        "short": "EU-Prod",
        "region": "eu",
        "supported": True,
    },
    "newenergy-operation-us.wgine-inc.com": {
        "name": "美国预发",
        "short": "US-Pre",
        "region": "us",
        "supported": True,
    },
    "newenergy-operation-us.tuya-inc.com": {
        "name": "美国线上",
        "short": "US-Prod",
        "region": "us",
        "supported": True,
    },
    "newenergy-operation-sg.tuya-inc.com": {
        "name": "新加坡线上",
        "short": "SG-Prod",
        "region": "sg",
        "supported": True,
    },
    "newenergy-operation-weaz.tuya-inc.com": {
        "name": "西欧线上",
        "short": "WEAZ",
        "region": "weaz",
        "supported": True,
    },
    "newenergy-operation-ueaz.tuya-inc.com": {
        "name": "美东线上",
        "short": "UEAZ",
        "region": "ueaz",
        "supported": True,
    },
    "127.0.0.1": {"name": "本机", "short": "Local", "region": "local", "supported": True},
}


def _lan_ips():
    """Best-effort list of non-loopback IPv4 addresses for LAN URL hints."""
    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127.") and ip not in ips:
            ips.insert(0, ip)
    except OSError:
        pass
    return ips


def main() -> None:
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STORE_FILE.exists():
        _save_store(_default_store())
    server = ThreadingHTTPServer((DEFAULT_HOST, DEFAULT_PORT), AppHandler)
    print(f"groupAppControl listening on {DEFAULT_HOST}:{DEFAULT_PORT}")
    print(f"  本机:   http://127.0.0.1:{DEFAULT_PORT}")
    for ip in _lan_ips():
        print(f"  局域网: http://{ip}:{DEFAULT_PORT}")
    if DEFAULT_HOST in ("127.0.0.1", "localhost"):
        print("  (仅本机；设 DEVICE_CONSOLE_HOST=0.0.0.0 可开放局域网)")
    print(f"store file: {STORE_FILE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
