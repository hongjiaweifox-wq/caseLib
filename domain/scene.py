"""
@file scene.py
@brief Family scene (PV / load step curves + anti-backflow) bound to a lab home.
@note Reuses algo_core.scene_gen.curves as the curve oracle; persists on home["scene"].
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from caseLib.domain.curves import (
    PV_DURATION_MIN,
    PV_STEP_DEFAULT,
    curves_catalog,
    resolve_family,
)

DEFAULT_SCENE_INPUT: Dict[str, Any] = {
    "has_meter": True,
    "pv_curve": "sunny_day",
    "pv_scale_w": 600,
    "pv_routes": 1,
    "load_curve": "home_day",
    "load_scale_w": 1200,
    "offgrid_curve": "zero",
    "offgrid_scale_w": 0,
    "duration_min": PV_DURATION_MIN,
    "step_min": PV_STEP_DEFAULT,
    "backflow_enable": True,
    "backflow_w": 0,
    "base_load_w": 500,
    "work_mode": 0,
}


def default_scene_input() -> Dict[str, Any]:
    return dict(DEFAULT_SCENE_INPUT)


def _clean_knots(points: Any) -> list:
    """Normalize control points to sorted [{t_min, w}] (empty when none)."""
    if not isinstance(points, list):
        return []
    out = []
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


def scene_input_from_home(home: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Read editable scene knobs from home (or defaults)."""
    out = default_scene_input()
    if not isinstance(home, dict):
        return out
    raw = home.get("scene") if isinstance(home.get("scene"), dict) else {}
    # prefer explicit input block; else flatten from resolved
    src = raw.get("input") if isinstance(raw.get("input"), dict) else raw
    for k in DEFAULT_SCENE_INPUT:
        if k in src and src[k] is not None:
            out[k] = src[k]
    # restore hand-edited control points (drag-editor knots)
    for pk in ("pv_points", "load_points", "offgrid_points"):
        knots = _clean_knots(src.get(pk))
        if knots:
            out[pk] = knots
    # aliases from older saves
    if "pv_step_min" in src and "step_min" not in src:
        out["step_min"] = src["pv_step_min"]
    if "pv_duration_min" in src and "duration_min" not in src:
        out["duration_min"] = src["pv_duration_min"]
    return out


def build_scene(body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Resolve family curves + backflow into a full scene block."""
    inp = default_scene_input()
    if isinstance(body, dict):
        inp.update({k: body[k] for k in body if k in DEFAULT_SCENE_INPUT or k in (
            "pv_points", "load_points", "offgrid_points",
            "meter_w", "plug_w", "home_chg_limit_w", "pv_v_const",
        )})
    resolved = resolve_family(inp)
    input_block: Dict[str, Any] = {
        "has_meter": bool(inp.get("has_meter", True)),
        "pv_curve": str(inp.get("pv_curve") or "sunny_day"),
        "pv_scale_w": int(inp.get("pv_scale_w") or 0),
        "pv_routes": max(1, int(inp.get("pv_routes") or 1)),
        "load_curve": str(inp.get("load_curve") or "home_day"),
        "load_scale_w": int(inp.get("load_scale_w") or 0),
        "duration_min": int(inp.get("duration_min") or PV_DURATION_MIN),
        "step_min": int(inp.get("step_min") or PV_STEP_DEFAULT),
        "backflow_enable": bool(inp.get("backflow_enable", True)),
        "backflow_w": int(inp.get("backflow_w") or 0),
        "base_load_w": int(inp.get("base_load_w") or 0),
        "work_mode": int(inp.get("work_mode") or 0),
        "offgrid_curve": str(inp.get("offgrid_curve") or "zero"),
        "offgrid_scale_w": int(inp.get("offgrid_scale_w") or 0),
    }
    # Persist hand-edited control points so the drag-editor can restore the exact
    # shape on reload (resolved.* is a dense grid; these are the sparse knots).
    for pk in ("pv_points", "load_points", "offgrid_points"):
        input_block[pk] = _clean_knots(inp.get(pk))
    return {"input": input_block, "resolved": resolved}


def attach_scene(home: Dict[str, Any], body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Write scene onto home and return home."""
    home["scene"] = build_scene(body if body is not None else scene_input_from_home(home))
    return home


def catalog() -> Dict[str, Any]:
    return curves_catalog()
