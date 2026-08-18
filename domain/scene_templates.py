"""
@file scene_templates.py
@brief Named, reusable 家庭参数 (scene) templates — save-as / load / edit / delete.
@note Stored at data/scene_templates.json, independent of any wiring home.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# scene input keys worth persisting in a template (mirrors scene.DEFAULT_SCENE_INPUT + points)
_SCALAR_KEYS = (
    "pv_curve", "pv_scale_w", "pv_routes",
    "load_curve", "load_scale_w",
    "offgrid_curve", "offgrid_scale_w",
    "duration_min", "step_min",
    "backflow_enable", "backflow_w",
    "base_load_w", "work_mode", "has_meter",
)
_POINT_KEYS = ("pv_points", "load_points", "offgrid_points")


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _templates_path(data_dir: Path) -> Path:
    return data_dir / "scene_templates.json"


def _clean_knots(points: Any) -> List[Dict[str, int]]:
    if not isinstance(points, list):
        return []
    out: List[Dict[str, int]] = []
    for p in points:
        if not isinstance(p, dict):
            continue
        try:
            out.append({"t_min": int(round(float(p.get("t_min", 0)))),
                        "w": int(round(float(p.get("w", 0))))})
        except (TypeError, ValueError):
            continue
    out.sort(key=lambda x: x["t_min"])
    return out


def _clean_input(raw: Any) -> Dict[str, Any]:
    inp: Dict[str, Any] = {}
    if not isinstance(raw, dict):
        return inp
    for k in _SCALAR_KEYS:
        if k in raw and raw[k] is not None:
            inp[k] = raw[k]
    for k in _POINT_KEYS:
        knots = _clean_knots(raw.get(k))
        if knots:
            inp[k] = knots
    return inp


def _summary(inp: Dict[str, Any]) -> str:
    def _peak(key: str, fallback: str) -> int:
        pts = inp.get(key)
        if isinstance(pts, list) and pts:
            return max((int(p.get("w", 0)) for p in pts), default=0)
        return int(inp.get(fallback, 0) or 0)
    rt = max(1, int(inp.get("pv_routes", 1) or 1))
    pv = _peak("pv_points", "pv_scale_w")
    load = _peak("load_points", "load_scale_w")
    off = _peak("offgrid_points", "offgrid_scale_w")
    parts = [f"PV {pv}W" + (f"×{rt}路" if rt > 1 else ""), f"负载 {load}W"]
    if off > 0:
        parts.append(f"离网 {off}W")
    if inp.get("backflow_enable"):
        parts.append(f"防逆流 {int(inp.get('backflow_w', 0) or 0)}W")
    return " · ".join(parts)


def load_templates(data_dir: Path) -> List[Dict[str, Any]]:
    data_dir.mkdir(parents=True, exist_ok=True)
    path = _templates_path(data_dir)
    if not path.is_file():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    items = raw.get("templates") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return []
    out: List[Dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        tid = str(it.get("id") or "").strip()
        name = str(it.get("name") or "").strip()
        if not tid or not name:
            continue
        inp = _clean_input(it.get("input"))
        out.append({"id": tid, "name": name, "input": inp,
                    "summary": _summary(inp), "updated_at": it.get("updated_at")})
    return out


def _save_all(data_dir: Path, templates: List[Dict[str, Any]]) -> None:
    path = _templates_path(data_dir)
    payload = {"updated_at": _now(), "templates": templates}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _gen_id(existing: List[Dict[str, Any]]) -> str:
    base = int(time.time() * 1000)
    ids = {t["id"] for t in existing}
    tid = f"tpl_{base}"
    n = 0
    while tid in ids:
        n += 1
        tid = f"tpl_{base}_{n}"
    return tid


def upsert_template(data_dir: Path, name: str, scene_input: Any,
                    template_id: Optional[str] = None) -> Dict[str, Any]:
    name = str(name or "").strip()
    if not name:
        raise ValueError("模板名不能为空")
    templates = load_templates(data_dir)
    inp = _clean_input(scene_input)

    idx = None
    if template_id:
        idx = next((i for i, t in enumerate(templates) if t["id"] == template_id), None)
    if idx is None:
        idx = next((i for i, t in enumerate(templates) if t["name"] == name), None)

    record = {
        "id": templates[idx]["id"] if idx is not None else _gen_id(templates),
        "name": name,
        "input": inp,
        "summary": _summary(inp),
        "updated_at": _now(),
    }
    if idx is None:
        templates.append(record)
    else:
        templates[idx] = record
    _save_all(data_dir, templates)
    return record


def delete_template(data_dir: Path, template_id: str) -> List[Dict[str, Any]]:
    tid = str(template_id or "").strip()
    templates = [t for t in load_templates(data_dir) if t["id"] != tid]
    _save_all(data_dir, templates)
    return templates
