"""caseLib — lab case library (sibling of groupAppControl).

First slice: home lab wiring topology with one-click + drag wiring.
Does not modify groupAppControl; only mirrors its wiring model for reference.
"""

from __future__ import annotations

import atexit
import json
import os
import subprocess
import sys
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import unquote, urlparse

from caseLib.knowledge.models import get_model, load_models, replace_models, resolve_model_name, upsert_model
from caseLib.domain.scene import attach_scene, build_scene, catalog as scene_catalog, scene_input_from_home
from caseLib.domain.scene_import import build_import_template, parse_curve_upload
from caseLib.api.energy_rpc import fetch_home_curves
from caseLib.domain.scene_templates import delete_template, load_templates, upsert_template
from caseLib.knowledge import kg_store
from caseLib.domain.wiring import (
    BUS_KINDS,
    add_bus,
    add_device,
    auto_wire_lab,
    clear_all_wires,
    connect_endpoints,
    default_lab_home,
    delete_home,
    disconnect_endpoint,
    disconnect_port,
    list_saved,
    load_home,
    parse_ref,
    remove_bus,
    remove_device,
    save_home,
    set_bus_label,
    set_bus_position,
    set_wire,
    wire_device_ports,
    wiring_rules_public,
)

# 层2/4 实时运行+自动测试后端（代理/SSO/store/reports/election）——合并单服务后作为基类复用
from caseLib.live.server import AppHandler as LiveHandler

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "web"  # 层0 前端：配置SPA(index)+实时SPA(live.html)+models/scene+js/css
KNOWLEDGE_DIR = ROOT / "knowledge"  # 层1 离线知识：kg_* + 型号规格 models.json
RESULTS_DATA_DIR = ROOT / "results" / "data"  # 层4 运行持久化：lab_*/scene_templates
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8780


def _json(handler: SimpleHTTPRequestHandler, code: int, payload: Any) -> None:
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _read(handler: SimpleHTTPRequestHandler) -> Dict[str, Any]:
    n = int(handler.headers.get("Content-Length") or 0)
    if n <= 0:
        return {}
    try:
        return json.loads(handler.rfile.read(n).decode("utf-8"))
    except Exception:
        return {}


class Handler(LiveHandler):
    """单服务统一处理：先匹配配置类路由(型号/知识图谱/场景/接线)，未命中则委托给
    LiveHandler(实时运行/自动测试/代理/SSO/store/reports/election) 及静态文件(web/)。"""

    def __init__(self, *args, **kwargs):
        # 绕过 LiveHandler.__init__（其硬编码 live/static 目录）；统一从 web/ 提供静态
        SimpleHTTPRequestHandler.__init__(self, *args, directory=str(STATIC_DIR), **kwargs)

    def send_header(self, keyword: str, value: str) -> None:
        # never cache static assets so front-end edits load immediately
        if keyword.lower() == "cache-control":
            self._cc_sent = True
        super().send_header(keyword, value)

    def end_headers(self) -> None:
        if not getattr(self, "_cc_sent", False):
            super().send_header("Cache-Control", "no-store")
        self._cc_sent = False
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[caseLib] " + (fmt % args) + "\n")

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            return _json(
                self,
                200,
                {"ok": True, "service": "caseLib", "data_dir": str(RESULTS_DATA_DIR)},
            )
        if path == "/api/meta":
            models = load_models(KNOWLEDGE_DIR)
            return _json(
                self,
                200,
                {
                    "ok": True,
                    "models": [m["id"] for m in models],
                    "model_catalog": models,
                    "bus_kinds": BUS_KINDS,
                    **wiring_rules_public(),
                },
            )
        if path == "/api/models":
            return _json(self, 200, {"ok": True, "models": load_models(KNOWLEDGE_DIR)})
        if path.startswith("/api/models/"):
            mid = path[len("/api/models/") :]
            model = get_model(KNOWLEDGE_DIR, unquote(mid))
            if not model:
                return _json(self, 404, {"ok": False, "error": "model not found"})
            return _json(self, 200, {"ok": True, "model": model})
        if path == "/api/homes":
            return _json(self, 200, {"ok": True, "homes": list_saved(RESULTS_DATA_DIR)})
        if path == "/api/scene/catalog":
            return _json(self, 200, {"ok": True, **scene_catalog()})
        if path == "/api/gac/ping":
            import urllib.request
            from urllib.parse import parse_qs

            qs = parse_qs(urlparse(self.path).query)
            base = (qs.get("url", ["http://127.0.0.1:5179"])[0] or "").rstrip("/")
            reachable, err = False, None
            if not (base.startswith("http://") or base.startswith("https://")):
                err = "非法地址"
            else:
                try:
                    with urllib.request.urlopen(base + "/api/health", timeout=2) as r:
                        reachable = 200 <= getattr(r, "status", 200) < 400
                except Exception as exc:  # noqa: BLE001 — surface "not running" to UI
                    err = str(exc)
            return _json(self, 200, {"ok": True, "reachable": reachable, "url": base, "error": err})
        if path == "/api/scene/templates":
            return _json(self, 200, {"ok": True, "templates": load_templates(RESULTS_DATA_DIR)})
        if path == "/api/kg/hardware-image":
            img = kg_store.hardware_image_path(KNOWLEDGE_DIR)
            if not img:
                return _json(self, 404, {"ok": False, "error": "no image"})
            data = img.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", kg_store.hardware_image_mime(img))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        if path.startswith("/api/kg/"):
            key = path[len("/api/kg/"):].strip("/")
            if key not in kg_store.ALLOWED_KEYS:
                return _json(self, 404, {"ok": False, "error": "unknown kg key"})
            return _json(self, 200, {"ok": True, "key": key, "data": kg_store.load(KNOWLEDGE_DIR, key)})
        if path == "/api/scene/import-template":
            try:
                data = build_import_template()
            except Exception as exc:  # noqa: BLE001
                return _json(self, 500, {"ok": False, "error": str(exc)})
            self.send_response(200)
            self.send_header(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            self.send_header("Content-Disposition", 'attachment; filename="caselib_curve_template.xlsx"')
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        if path.startswith("/api/home/"):
            hid = path.split("/")[-1]
            home = load_home(RESULTS_DATA_DIR, hid)
            if not home:
                return _json(self, 404, {"ok": False, "error": "not found"})
            return _json(self, 200, {"ok": True, "home": home})
        if path in ("/", "/index.html", "/scene.html", "/models.html"):
            return super().do_GET()
        return super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        # 非配置类 POST（store/proxy/report/election/sso/cookies…）→ 交实时后端自行读 body
        # 必须在读取 body 之前委托，否则 body 被消费导致 LiveHandler 再读时阻塞。
        if not path.startswith(("/api/home/", "/api/kg/", "/api/scene/", "/api/models/")):
            return super().do_POST()
        body = _read(self)
        try:
            if path == "/api/home/delete":
                hid = str(body.get("id") or "").strip()
                if not hid:
                    return _json(self, 400, {"ok": False, "error": "缺少家庭ID"})
                try:
                    removed = delete_home(RESULTS_DATA_DIR, hid)
                except ValueError as exc:
                    return _json(self, 400, {"ok": False, "error": str(exc)})
                return _json(self, 200, {"ok": True, "removed": removed, "homes": list_saved(RESULTS_DATA_DIR)})

            if path == "/api/kg/hardware-image":
                import base64

                try:
                    raw = base64.b64decode(body.get("content_b64") or "") if body.get("content_b64") else b""
                except Exception:
                    return _json(self, 400, {"ok": False, "error": "无法解码图片"})
                if not raw:
                    return _json(self, 400, {"ok": False, "error": "空文件"})
                try:
                    out = kg_store.save_hardware_image(KNOWLEDGE_DIR, str(body.get("filename") or ""), raw)
                except ValueError as exc:
                    return _json(self, 400, {"ok": False, "error": str(exc)})
                return _json(self, 200, {"ok": True, "file": out.name})

            if path == "/api/kg/save":
                key = str(body.get("key") or "").strip()
                if key not in kg_store.ALLOWED_KEYS:
                    return _json(self, 400, {"ok": False, "error": "unknown kg key"})
                payload: Dict[str, Any] = {"source_url": str(body.get("source_url") or "")}
                if body.get("markdown") is not None:
                    payload["markdown"] = str(body.get("markdown") or "")
                elif body.get("csv") is not None:
                    cols, rows = kg_store.parse_delimited(str(body.get("csv") or ""))
                    payload["columns"], payload["rows"] = cols, rows
                else:
                    payload["columns"] = body.get("columns") or []
                    payload["rows"] = body.get("rows") or []
                saved = kg_store.save(KNOWLEDGE_DIR, key, payload)
                return _json(self, 200, {"ok": True, "key": key, "data": saved})

            if path == "/api/scene/template/save":
                try:
                    tpl = upsert_template(
                        RESULTS_DATA_DIR,
                        name=body.get("name") or "",
                        scene_input=body.get("input") or body,
                        template_id=body.get("id"),
                    )
                except ValueError as exc:
                    return _json(self, 400, {"ok": False, "error": str(exc)})
                return _json(self, 200, {"ok": True, "template": tpl, "templates": load_templates(RESULTS_DATA_DIR)})

            if path == "/api/scene/template/delete":
                tid = str(body.get("id") or "").strip()
                if not tid:
                    return _json(self, 400, {"ok": False, "error": "缺少模板 id"})
                return _json(self, 200, {"ok": True, "templates": delete_template(RESULTS_DATA_DIR, tid)})

            if path == "/api/scene/import":
                import base64

                b64 = body.get("content_b64") or ""
                fname = str(body.get("filename") or "")
                try:
                    raw = base64.b64decode(b64) if b64 else b""
                except Exception:
                    return _json(self, 400, {"ok": False, "error": "无法解码文件内容"})
                if not raw:
                    return _json(self, 400, {"ok": False, "error": "空文件"})
                try:
                    result = parse_curve_upload(fname, raw)
                except Exception as exc:  # noqa: BLE001 — surface parse errors to UI
                    return _json(self, 400, {"ok": False, "error": f"解析失败: {exc}"})
                if not result.get("points"):
                    return _json(self, 400, {"ok": False, "error": "未识别到有效数据（需两列：时间、功率）"})
                return _json(self, 200, {"ok": True, **result})

            if path == "/api/scene/fetch-remote":
                home_id = str(body.get("home_id") or "").strip()
                date = str(body.get("date") or "").strip()
                cookie = str(body.get("cookie") or "")
                host = str(body.get("host") or "").strip()
                gran = str(body.get("granularity") or "15m").strip() or "15m"
                if not home_id or not date:
                    return _json(self, 400, {"ok": False, "error": "缺少 家庭ID 或 日期"})
                if not cookie:
                    return _json(self, 400, {"ok": False, "error": "缺少凭证 Cookie（点「凭证」粘贴）"})
                try:
                    res = fetch_home_curves(home_id, date, cookie, host=host or None, granularity=gran)
                except Exception as exc:  # noqa: BLE001 — surface network/auth errors to UI
                    return _json(self, 400, {"ok": False, "error": f"拉取失败: {exc}"})
                ch = res.get("channels") or {}
                if not ch.get("pv") and not ch.get("load"):
                    return _json(self, 400, {"ok": False, "error": "未取到 PV/负载数据（检查家庭ID/日期/凭证是否过期）"})
                return _json(self, 200, {"ok": True, **res})

            if path == "/api/home/new":
                catalog = load_models(KNOWLEDGE_DIR)
                home = default_lab_home(
                    name=str(body.get("name") or "实验室家庭"),
                    device_n=int(body.get("device_n") or 3),
                    model_catalog=catalog,
                )
                if body.get("auto_wire", True):
                    auto_wire_lab(home, catalog)
                attach_scene(home)
                save_home(RESULTS_DATA_DIR, home)
                return _json(self, 200, {"ok": True, "home": home})

            if path == "/api/home/save":
                home = body.get("home")
                if not isinstance(home, dict):
                    return _json(self, 400, {"ok": False, "error": "missing home"})
                path_out = save_home(RESULTS_DATA_DIR, home)
                try:
                    rel = str(path_out.relative_to(ROOT.parent))
                except Exception:
                    rel = str(path_out)
                return _json(
                    self,
                    200,
                    {
                        "ok": True,
                        "path": str(path_out),
                        "rel": rel,
                        "file": path_out.name,
                        "home": home,
                    },
                )

            if path == "/api/home/auto-wire":
                home = body.get("home") or default_lab_home(model_catalog=load_models(KNOWLEDGE_DIR))
                auto_wire_lab(home, load_models(KNOWLEDGE_DIR))
                return _json(self, 200, {"ok": True, "home": home})

            if path == "/api/home/clear-wires":
                home = body.get("home") or default_lab_home(model_catalog=load_models(KNOWLEDGE_DIR))
                clear_all_wires(home, load_models(KNOWLEDGE_DIR))
                return _json(self, 200, {"ok": True, "home": home})

            if path == "/api/home/wire":
                home = body.get("home")
                if not isinstance(home, dict):
                    return _json(self, 400, {"ok": False, "error": "missing home"})
                # new: connect two endpoints {a,b} or legacy device_uid/port/bus_id
                if isinstance(body.get("a"), dict) and isinstance(body.get("b"), dict):
                    ok = connect_endpoints(home, body["a"], body["b"])
                    return _json(self, 200, {"ok": ok, "home": home})
                ok = set_wire(
                    home,
                    str(body.get("device_uid") or ""),
                    str(body.get("port") or ""),
                    str(body.get("bus_id") or body.get("target") or "") or None,
                    idx=body.get("idx", 0),
                )
                return _json(self, 200, {"ok": ok, "home": home})

            if path == "/api/home/disconnect":
                home = body.get("home")
                if not isinstance(home, dict):
                    return _json(self, 400, {"ok": False, "error": "missing home"})
                if isinstance(body.get("endpoint"), dict):
                    disconnect_endpoint(home, body["endpoint"])
                else:
                    disconnect_port(
                        home,
                        str(body.get("device_uid") or ""),
                        str(body.get("port") or ""),
                        idx=body.get("idx", 0),
                    )
                return _json(self, 200, {"ok": True, "home": home})

            if path == "/api/home/add-device":
                home = body.get("home") or default_lab_home(device_n=0, model_catalog=load_models(KNOWLEDGE_DIR))
                catalog = load_models(KNOWLEDGE_DIR)
                model = resolve_model_name(KNOWLEDGE_DIR, str(body.get("model") or ""))
                meta = next((m for m in catalog if m.get("id") == model), None)
                add_device(home, model=model, model_meta=meta)
                uid = (home.get("devices") or [])[-1]["uid"]
                wire_device_ports(home, uid, catalog)
                if body.get("save", True):
                    save_home(RESULTS_DATA_DIR, home)
                return _json(self, 200, {"ok": True, "home": home})

            if path == "/api/models/save":
                if isinstance(body.get("models"), list):
                    models = replace_models(KNOWLEDGE_DIR, body["models"])
                    return _json(self, 200, {"ok": True, "models": models})
                model = upsert_model(KNOWLEDGE_DIR, body.get("model") if isinstance(body.get("model"), dict) else body)
                return _json(self, 200, {"ok": True, "model": model, "models": load_models(KNOWLEDGE_DIR)})

            if path == "/api/home/add-bus":
                home = body.get("home")
                if not isinstance(home, dict):
                    return _json(self, 400, {"ok": False, "error": "missing home"})
                add_bus(
                    home,
                    kind=str(body.get("kind") or "pv"),
                    label=body.get("label"),
                )
                return _json(self, 200, {"ok": True, "home": home})

            if path == "/api/home/remove-bus":
                home = body.get("home")
                if not isinstance(home, dict):
                    return _json(self, 400, {"ok": False, "error": "missing home"})
                ok = remove_bus(home, str(body.get("bus_id") or ""))
                return _json(self, 200, {"ok": ok, "home": home})

            if path == "/api/home/remove-device":
                home = body.get("home")
                if not isinstance(home, dict):
                    return _json(self, 400, {"ok": False, "error": "missing home"})
                ok = remove_device(home, str(body.get("uid") or ""))
                return _json(self, 200, {"ok": ok, "home": home})

            if path == "/api/home/move-bus":
                home = body.get("home")
                if not isinstance(home, dict):
                    return _json(self, 400, {"ok": False, "error": "missing home"})
                set_bus_position(
                    home,
                    str(body.get("bus_id") or ""),
                    float(body.get("x") or 0),
                    float(body.get("y") or 0),
                )
                return _json(self, 200, {"ok": True, "home": home})

            if path == "/api/home/rename-bus":
                home = body.get("home")
                if not isinstance(home, dict):
                    return _json(self, 400, {"ok": False, "error": "missing home"})
                ok = set_bus_label(
                    home,
                    str(body.get("bus_id") or ""),
                    str(body.get("label") or ""),
                )
                return _json(self, 200, {"ok": ok, "home": home})

            if path == "/api/scene/resolve":
                scene = build_scene(body if isinstance(body, dict) else None)
                return _json(self, 200, {"ok": True, "scene": scene})

            if path == "/api/home/scene":
                home = body.get("home")
                if not isinstance(home, dict):
                    # allow home_id + scene knobs
                    hid = str(body.get("home_id") or "")
                    home = load_home(RESULTS_DATA_DIR, hid) if hid else None
                if not isinstance(home, dict):
                    return _json(self, 400, {"ok": False, "error": "missing home"})
                knobs = body.get("scene") if isinstance(body.get("scene"), dict) else body
                # strip nested home from knobs
                knobs = {k: v for k, v in (knobs or {}).items() if k not in ("home", "home_id", "scene")}
                if not knobs:
                    knobs = scene_input_from_home(home)
                attach_scene(home, knobs)
                path_out = save_home(RESULTS_DATA_DIR, home)
                try:
                    rel = str(path_out.relative_to(ROOT.parent))
                except Exception:
                    rel = str(path_out)
                return _json(
                    self,
                    200,
                    {
                        "ok": True,
                        "home": home,
                        "scene": home.get("scene"),
                        "file": path_out.name,
                        "rel": rel,
                    },
                )

            # 配置前缀但无匹配路由 → 404（此处 body 已读，不能再委托 super 二次读取）
            return _json(self, 404, {"ok": False, "error": "not found"})
        except Exception as exc:
            traceback.print_exc()
            return _json(self, 500, {"ok": False, "error": str(exc)})


_LIVE_PROC: Optional[subprocess.Popen] = None


def _live_port() -> str:
    return os.environ.get("CASELIB_LIVE_PORT", "5179")


def _stop_live() -> None:
    global _LIVE_PROC
    if _LIVE_PROC and _LIVE_PROC.poll() is None:
        try:
            _LIVE_PROC.terminate()
        except Exception:
            pass


def _maybe_start_live() -> None:
    """Auto-start the embedded 实时运行 copy (caseLib.live) unless disabled/already up."""
    global _LIVE_PROC
    if os.environ.get("CASELIB_NO_LIVE"):
        return
    import urllib.request

    port = _live_port()
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1):
            print(f"caseLib.live (实时运行) already running on :{port}")
            return
    except Exception:
        pass
    try:
        env = dict(os.environ)
        env.setdefault("CASELIB_LIVE_HOST", "127.0.0.1")
        _LIVE_PROC = subprocess.Popen(
            [sys.executable, "-m", "caseLib.live"],
            cwd=str(ROOT.parent),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        atexit.register(_stop_live)
        print(f"caseLib.live (实时运行) starting on :{port} (pid {_LIVE_PROC.pid})")
    except Exception as exc:  # noqa: BLE001 — best-effort; tab shows fallback if it fails
        print(f"[caseLib] 无法自动启动 live 子进程: {exc}")


def main(argv: Optional[List[str]] = None) -> None:
    argv = list(argv if argv is not None else sys.argv[1:])
    host = DEFAULT_HOST
    port = DEFAULT_PORT
    if len(argv) >= 1:
        host = argv[0]
    if len(argv) >= 2:
        port = int(argv[1])
    RESULTS_DATA_DIR.mkdir(parents=True, exist_ok=True)
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    if not STATIC_DIR.is_dir():
        raise SystemExit(f"missing web dir: {STATIC_DIR}")
    # 单服务单端口：实时运行/自动测试已并入本进程（LiveHandler 基类），不再拉起 5179 子进程
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"caseLib（单服务）→ http://{host}:{port}/  · 实时运行 → /live.html")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
