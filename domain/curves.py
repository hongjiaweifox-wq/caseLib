"""Family-side curve presets: PV (timeline + SAS V/I) & load profiles.

Vendored 2026-08-17 from algo_core/scene_gen/curves.py so caseLib is zero-external-dependency
(self-contained, movable). Keep in sync if the upstream curve oracle changes.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

# PV 源：时间轴功率曲线。真机激励建议恒压 Vset=45V，用电流限 I=P/V 做功率闭环
# （Chroma 62000H：OUTP:MODE CVCC；用户口中的「SAS 调电流」按此落地）。
PV_V_CONST = 50.0  # V — Chroma 恒压写死 50V
PV_I_MAX = 12.0    # A — 电流上限
PV_W_MAX = int(PV_V_CONST * PV_I_MAX)  # 600 W
PV_DURATION_MIN = 24 * 60  # 默认 24h 时间轴
PV_STEP_DEFAULT = 60  # 默认步长 1H → 24 点

# 步长选项：duration / step = 点数（24h 下 1H=24 点）
PV_STEP_OPTIONS: List[Dict[str, Any]] = [
    {"id": "60", "label": "1 H", "step_min": 60, "points_24h": 24},
    {"id": "30", "label": "30 min", "step_min": 30, "points_24h": 48},
    {"id": "15", "label": "15 min", "step_min": 15, "points_24h": 96},
    {"id": "10", "label": "10 min", "step_min": 10, "points_24h": 144},
    {"id": "5", "label": "5 min", "step_min": 5, "points_24h": 288},
]

# 晴空辐照相对幅度（0=起点, 1=终点），用于按网格采样
_SUNNY_KNOTS = [
    (0.00, 0.00),
    (0.08, 0.05),
    (0.18, 0.28),
    (0.30, 0.62),
    (0.42, 0.88),
    (0.50, 1.00),
    (0.58, 0.95),
    (0.70, 0.72),
    (0.82, 0.38),
    (0.92, 0.12),
    (1.00, 0.00),
]

_CLOUD_DIP_KNOTS = [
    (0.35, 0.35),
    (0.38, 0.85),
    (0.55, 0.25),
    (0.58, 0.90),
    (0.65, 0.40),
    (0.68, 0.75),
]


def _pv_point(t_min: float, w: float, v: float = PV_V_CONST) -> Dict[str, Any]:
    w_i = max(0, min(PV_W_MAX, int(round(w))))
    i_a = round(min(PV_I_MAX, w_i / v), 3) if v > 0 else 0.0
    return {"t_min": int(round(t_min)), "w": w_i, "v": v, "i_a": i_a}


def _interp_knots(knots: List[tuple], frac: float) -> float:
    """Piecewise linear interpolation on fraction in [0, 1]."""
    frac = max(0.0, min(1.0, float(frac)))
    for i in range(len(knots) - 1):
        f0, v0 = knots[i]
        f1, v1 = knots[i + 1]
        if f0 <= frac <= f1:
            if f1 <= f0:
                return v0
            t = (frac - f0) / (f1 - f0)
            return v0 + (v1 - v0) * t
    return knots[-1][1]


def _sunny_amp(frac: float) -> float:
    return _interp_knots(_SUNNY_KNOTS, frac)


def _cloud_amp(frac: float) -> float:
    base = _sunny_amp(frac)
    dip = _interp_knots([(0.0, 1.0)] + _CLOUD_DIP_KNOTS + [(1.0, 1.0)], frac)
    return base * dip


def grid_point_count(duration_min: int, step_min: int) -> int:
    step = max(1, int(step_min))
    dur = max(step, int(duration_min))
    return dur // step


def _amp_for_curve(curve_id: str, frac: float) -> float:
    meta = PV_CURVES.get(curve_id, {})
    kind = meta.get("builder") or "sunny"
    if kind == "flat":
        return 1.0 if curve_id != "zero" else 0.0
    if kind == "cloud":
        return _cloud_amp(frac)
    return _sunny_amp(frac)


def build_pv_grid(
    curve_id: str,
    scale_w: int,
    duration_min: int = PV_DURATION_MIN,
    step_min: int = PV_STEP_DEFAULT,
    v_const: float = PV_V_CONST,
) -> List[Dict[str, Any]]:
    """Build PV curve on uniform time grid (default 24h × 1H = 24 points)."""
    dur = max(int(step_min), int(duration_min))
    step = max(1, int(step_min))
    n = grid_point_count(dur, step)
    out: List[Dict[str, Any]] = []
    for i in range(n):
        t = i * step
        frac = t / dur if dur > 0 else 0.0
        w = scale_w * _amp_for_curve(curve_id, frac)
        out.append(_pv_point(t, w, v_const))
    return out


def _interp_power_at(points: List[Dict[str, Any]], t_min: float, duration_min: int) -> float:
    if not points:
        return 0.0
    pts = sorted(points, key=lambda p: float(p.get("t_min", 0)))
    t = float(t_min)
    if t <= pts[0]["t_min"]:
        return float(pts[0].get("w", 0))
    if t >= pts[-1]["t_min"]:
        return float(pts[-1].get("w", 0))
    for i in range(len(pts) - 1):
        t0 = float(pts[i]["t_min"])
        t1 = float(pts[i + 1]["t_min"])
        if t0 <= t <= t1:
            w0 = float(pts[i].get("w", 0))
            w1 = float(pts[i + 1].get("w", 0))
            if t1 <= t0:
                return w0
            r = (t - t0) / (t1 - t0)
            return w0 + (w1 - w0) * r
    return float(pts[-1].get("w", 0))


def resample_points_to_grid(
    points: List[Dict[str, Any]],
    duration_min: int = PV_DURATION_MIN,
    step_min: int = PV_STEP_DEFAULT,
    v_const: float = PV_V_CONST,
) -> List[Dict[str, Any]]:
    """Resample arbitrary control points onto uniform grid (keeps curve shape)."""
    dur = max(int(step_min), int(duration_min))
    step = max(1, int(step_min))
    n = grid_point_count(dur, step)
    src = sorted(points, key=lambda p: float(p.get("t_min", 0)))
    out: List[Dict[str, Any]] = []
    for i in range(n):
        t = i * step
        w = _interp_power_at(src, t, dur)
        out.append(_pv_point(t, w, v_const))
    return out


def resample_load_to_grid(
    points: List[Dict[str, Any]],
    duration_min: int = PV_DURATION_MIN,
    step_min: int = PV_STEP_DEFAULT,
) -> List[Dict[str, Any]]:
    """Resample load control points onto uniform grid (no PV 600W clamp / no V·I)."""
    dur = max(int(step_min), int(duration_min))
    step = max(1, int(step_min))
    n = grid_point_count(dur, step)
    src = sorted(points, key=lambda p: float(p.get("t_min", 0)))
    out: List[Dict[str, Any]] = []
    for i in range(n):
        t = i * step
        w = max(0, int(round(_interp_power_at(src, t, dur))))
        out.append({"t_min": t, "w": w})
    return out


PV_CURVES: Dict[str, Dict[str, Any]] = {
    "sunny_day": {
        "name": "晴天日照",
        "summary": "真实晴空：缓升→正午峰→缓降（24h · 默认 1H/24点）",
        "default_scale_w": 600,
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
        "builder": "sunny",
    },
    "cloud_day": {
        "name": "多云遮挡",
        "summary": "晴空底 + 云影跌落，测电流跟踪",
        "default_scale_w": 600,
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
        "builder": "cloud",
    },
    "flat_high": {
        "name": "恒定高功率",
        "summary": "全时段高 PV，适合放电/防弃光",
        "default_scale_w": 600,
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
        "builder": "flat",
    },
    "flat_low": {
        "name": "恒定低功率",
        "summary": "轻 PV，适合可充可放/跟表",
        "default_scale_w": 200,
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
        "builder": "flat",
    },
    "zero": {
        "name": "无 PV",
        "summary": "关源 / 夜间",
        "default_scale_w": 0,
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
        "builder": "flat",
    },
}


def build_pv_points(
    curve_id: str,
    scale_w: int,
    duration_min: Optional[int] = None,
    step_min: Optional[int] = None,
) -> List[Dict[str, Any]]:
    meta = PV_CURVES[curve_id]
    dur = int(duration_min or meta.get("duration_min") or PV_DURATION_MIN)
    step = int(step_min or meta.get("step_min") or PV_STEP_DEFAULT)
    return build_pv_grid(curve_id, scale_w, dur, step)


def annotate_sas(points: List[Dict[str, Any]], v_const: float = PV_V_CONST) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in points:
        w = max(0, int(round(float(p.get("w", 0)))))
        t = int(round(float(p.get("t_min", 0))))
        out.append(_pv_point(t, w, v_const))
    out.sort(key=lambda x: x["t_min"])
    return out


LOAD_CURVES: Dict[str, Dict[str, Any]] = {
    "flat_mid": {
        "name": "恒定中负载",
        "summary": "家庭侧稳定取电（24h 网格）",
        "default_scale_w": 800,
        "scope": "home",
        "builder": "flat",
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
        "points": [{"t_min": 0, "w": 800}, {"t_min": 30, "w": 800}],
    },
    "flat_high": {
        "name": "恒定大负载",
        "summary": "大需电，跟表压力大（24h 网格）",
        "default_scale_w": 1500,
        "scope": "home",
        "builder": "flat",
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
        "points": [{"t_min": 0, "w": 1500}, {"t_min": 30, "w": 1500}],
    },
    "home_day": {
        "name": "典型日负荷",
        "summary": "凌晨低 → 早高峰 → 日间中 → 晚高峰 → 深夜降",
        "default_scale_w": 1200,
        "scope": "home",
        "builder": "home_day",
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
    },
    "evening_peak": {
        "name": "晚高峰爬升",
        "summary": "傍晚阶梯升高后维持（映射到 24h）",
        "default_scale_w": 1200,
        "scope": "home",
        "builder": "knots",
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
        "knots": [
            (0.00, 0.25),
            (0.50, 0.30),
            (0.70, 0.55),
            (0.78, 0.85),
            (0.85, 1.00),
            (0.92, 0.90),
            (1.00, 0.40),
        ],
        "points": [
            {"t_min": 0, "w": 300},
            {"t_min": 10, "w": 700},
            {"t_min": 20, "w": 1200},
            {"t_min": 40, "w": 1200},
        ],
    },
    "step": {
        "name": "阶跃投切",
        "summary": "中午突然加大再恢复（映射到 24h）",
        "default_scale_w": 1000,
        "scope": "home",
        "builder": "knots",
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
        "knots": [
            (0.00, 0.20),
            (0.45, 0.20),
            (0.48, 1.00),
            (0.55, 1.00),
            (0.58, 0.20),
            (1.00, 0.20),
        ],
        "points": [
            {"t_min": 0, "w": 200},
            {"t_min": 5, "w": 1000},
            {"t_min": 15, "w": 200},
            {"t_min": 30, "w": 200},
        ],
    },
    "bypass_force": {
        "name": "Bypass 强充负载",
        "summary": "打在设备 Bypass 口，推充电1",
        "default_scale_w": 2000,
        "scope": "bypass",
        "builder": "flat",
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
        "points": [{"t_min": 0, "w": 2000}, {"t_min": 30, "w": 2000}],
    },
    "zero": {
        "name": "无负载",
        "summary": "家庭/口负载都关",
        "default_scale_w": 0,
        "scope": "home",
        "builder": "flat",
        "duration_min": PV_DURATION_MIN,
        "step_min": PV_STEP_DEFAULT,
        "points": [{"t_min": 0, "w": 0}, {"t_min": 30, "w": 0}],
    },
}

# 典型日负荷相对幅度（0=起点, 1=终点）
_HOME_DAY_KNOTS = [
    (0.00, 0.18),
    (0.25, 0.15),  # 06:00
    (0.30, 0.55),  # 07:00 早高峰
    (0.35, 0.45),
    (0.50, 0.40),  # 正午
    (0.70, 0.50),
    (0.78, 0.85),  # ~19:00
    (0.85, 1.00),  # 晚高峰
    (0.92, 0.55),
    (1.00, 0.22),
]


def _load_amp(curve_id: str, frac: float) -> float:
    meta = LOAD_CURVES.get(curve_id) or {}
    kind = meta.get("builder") or "flat"
    if kind == "flat":
        return 0.0 if curve_id == "zero" else 1.0
    if kind == "home_day":
        return _interp_knots(_HOME_DAY_KNOTS, frac)
    if kind == "knots":
        knots = meta.get("knots") or [(0.0, 1.0), (1.0, 1.0)]
        return _interp_knots(list(knots), frac)
    # legacy control points → stretch over [0,1]
    pts = meta.get("points") or [{"t_min": 0, "w": 1}]
    tmax = max(float(p.get("t_min", 0)) for p in pts) or 1.0
    stretched = [{"t_min": float(p["t_min"]) / tmax, "w": float(p.get("w", 0))} for p in pts]
    # reuse power interp by faking t_min as fraction*1000
    fake = [{"t_min": int(round(p["t_min"] * 1000)), "w": p["w"]} for p in stretched]
    return _interp_power_at(fake, frac * 1000, 1000) / max(1.0, float(meta.get("default_scale_w") or 1))


def build_load_grid(
    curve_id: str,
    scale_w: int,
    duration_min: int = PV_DURATION_MIN,
    step_min: int = PV_STEP_DEFAULT,
) -> List[Dict[str, Any]]:
    """Build load curve on uniform time grid (same step model as PV)."""
    dur = max(int(step_min), int(duration_min))
    step = max(1, int(step_min))
    n = grid_point_count(dur, step)
    out: List[Dict[str, Any]] = []
    for i in range(n):
        t = i * step
        frac = t / dur if dur > 0 else 0.0
        w = max(0, int(round(scale_w * _load_amp(curve_id, frac))))
        out.append({"t_min": t, "w": w})
    return out


def build_load_points(
    curve_id: str,
    scale_w: int,
    duration_min: Optional[int] = None,
    step_min: Optional[int] = None,
) -> List[Dict[str, Any]]:
    meta = LOAD_CURVES[curve_id]
    dur = int(duration_min or meta.get("duration_min") or PV_DURATION_MIN)
    step = int(step_min or meta.get("step_min") or PV_STEP_DEFAULT)
    return build_load_grid(curve_id, scale_w, dur, step)


def _scaled_points(points: List[Dict[str, Any]], default_w: int, scale_w: int) -> List[Dict[str, Any]]:
    if default_w <= 0:
        return [{"t_min": p["t_min"], "w": int(scale_w)} for p in points]
    ratio = float(scale_w) / float(default_w)
    return [{"t_min": p["t_min"], "w": int(round(p["w"] * ratio))} for p in points]


def curves_catalog() -> Dict[str, Any]:
    return {
        "pv": [
            {
                "id": k,
                "name": v["name"],
                "summary": v["summary"],
                "default_scale_w": v["default_scale_w"],
                "duration_min": v.get("duration_min", PV_DURATION_MIN),
                "step_min": v.get("step_min", PV_STEP_DEFAULT),
            }
            for k, v in PV_CURVES.items()
        ],
        "load": [
            {
                "id": k,
                "name": v["name"],
                "summary": v["summary"],
                "default_scale_w": v["default_scale_w"],
                "scope": v.get("scope", "home"),
                "duration_min": v.get("duration_min", PV_DURATION_MIN),
                "step_min": v.get("step_min", PV_STEP_DEFAULT),
            }
            for k, v in LOAD_CURVES.items()
        ],
        "step_options": PV_STEP_OPTIONS,
        "duration_min": PV_DURATION_MIN,
        "backflow_presets_w": [0, 100, 500, 1000, 2000],
        "pv_sas": {
            "v_const": PV_V_CONST,
            "i_max": PV_I_MAX,
            "w_max": PV_W_MAX,
            "mode": "SAS",
            "transport": "LXI",
            "port": 80,
            "duration_min": PV_DURATION_MIN,
            "step_min": PV_STEP_DEFAULT,
            "step_options": PV_STEP_OPTIONS,
            "note": (
                "Chroma 62180H 局域网 LXI：POST /lxi_client_cgi；OUTP:MODE SAS；VOLT 50；"
                "按时间轴 I=P/50 发 CURR（最大 12A / 600W）。默认 24h × 1H = 24 点。"
            ),
            "scpi_hint": "OUTP:MODE SAS; VOLT 50; CURR <I>; OUTP ON",
        },
    }


def resolve_family(body: Dict[str, Any]) -> Dict[str, Any]:
    """Build family dimension block from UI payload."""
    has_meter = bool(body.get("has_meter", True))
    pv_id = str(body.get("pv_curve") or "sunny_day")
    load_id = str(body.get("load_curve") or "home_day")
    if pv_id not in PV_CURVES:
        raise KeyError(f"unknown pv_curve: {pv_id}")
    if load_id not in LOAD_CURVES:
        raise KeyError(f"unknown load_curve: {load_id}")

    pv_meta = PV_CURVES[pv_id]
    load_meta = LOAD_CURVES[load_id]
    pv_scale = min(PV_W_MAX, int(body.get("pv_scale_w", pv_meta["default_scale_w"])))
    pv_routes = max(1, int(body.get("pv_routes", 1) or 1))  # 几路并联 → 总功率 = 单路 × 路数
    load_scale = int(body.get("load_scale_w", load_meta["default_scale_w"]))
    v_const = float(body.get("pv_v_const", PV_V_CONST))
    duration_min = int(
        body.get("duration_min")
        or body.get("pv_duration_min")
        or pv_meta.get("duration_min")
        or PV_DURATION_MIN
    )
    step_min = int(
        body.get("step_min")
        or body.get("pv_step_min")
        or body.get("load_step_min")
        or pv_meta.get("step_min")
        or PV_STEP_DEFAULT
    )

    custom_pts = body.get("pv_points")
    if isinstance(custom_pts, list) and custom_pts:
        pv_points = resample_points_to_grid(custom_pts, duration_min, step_min, v_const)
    else:
        pv_points = build_pv_grid(pv_id, pv_scale, duration_min, step_min, v_const)
    # per-route point is a single SAS channel (≤600W); w_total is the parallel sum
    for _p in pv_points:
        _p["w_total"] = int(_p["w"]) * pv_routes

    custom_load = body.get("load_points")
    if isinstance(custom_load, list) and custom_load:
        load_points = resample_load_to_grid(custom_load, duration_min, step_min)
    else:
        load_points = build_load_grid(load_id, load_scale, duration_min, step_min)

    def _resolve_load_channel(curve_key: str, scale_key: str, pts_key: str,
                              default_curve: str, default_scope: str) -> Dict[str, Any]:
        """Resolve an extra load channel (grid / offgrid) like the home load."""
        cid = str(body.get(curve_key) or default_curve)
        if cid not in LOAD_CURVES:
            raise KeyError(f"unknown {curve_key}: {cid}")
        meta = LOAD_CURVES[cid]
        scale = int(body.get(scale_key, 0) or 0)
        custom = body.get(pts_key)
        if isinstance(custom, list) and custom:
            pts = resample_load_to_grid(custom, duration_min, step_min)
        else:
            pts = build_load_grid(cid, scale, duration_min, step_min)
        return {
            "curve_id": cid,
            "name": meta["name"],
            "scope": meta.get("scope", default_scope),
            "scale_w": scale,
            "duration_min": duration_min,
            "step_min": step_min,
            "point_count": len(pts),
            "points": pts,
        }

    # Off-grid port load lands on the Bypass bus. (Grid is the household import
    # meter — a measured value, not an automation input — so it is NOT a channel.)
    offgrid_channel = _resolve_load_channel("offgrid_curve", "offgrid_scale_w", "offgrid_points", "zero", "bypass")

    n_pts = len(pv_points)

    meter_w = body.get("meter_w")
    base_load_w = body.get("base_load_w", 500)
    plug_w = body.get("plug_w", 0)
    backflow_enable = bool(body.get("backflow_enable", True))
    backflow_w = int(body.get("backflow_w", 0))
    home_chg_limit_w = body.get("home_chg_limit_w", 2400)

    if has_meter:
        if meter_w is None:
            # 用负载曲线峰值近似电表读数（瞬时场景）
            meter_w = max((p.get("w") or 0) for p in load_points) if load_points else load_scale
        family_params = {
            "工作模式": int(body.get("work_mode", 0)),
            "auto_family": True,
            "电表功率": int(meter_w),
            "逆流功率": int(backflow_w) if backflow_enable else 0,
            "基础负载": int(base_load_w),
            "插座功率": int(plug_w),
            "家庭充电功率": int(home_chg_limit_w),
            "家庭充电电流": 0,
            "P_family_power": 0,
            "防逆流": "使能" if backflow_enable else "关闭",
        }
    else:
        family_params = {
            "工作模式": int(body.get("work_mode", 0)),
            "auto_family": True,
            "电表功率": None,
            "逆流功率": int(backflow_w) if backflow_enable else 0,
            "基础负载": int(base_load_w if body.get("base_load_w") is not None else load_scale),
            "插座功率": int(plug_w),
            "家庭充电功率": int(home_chg_limit_w),
            "家庭充电电流": 0,
            "P_family_power": 0,
            "防逆流": "使能" if backflow_enable else "关闭",
        }

    return {
        "has_meter": has_meter,
        "work_mode": int(body.get("work_mode", 0)),
        "duration_min": duration_min,
        "step_min": step_min,
        "point_count": n_pts,
        "backflow_enable": backflow_enable,
        "backflow_w": int(backflow_w) if backflow_enable else 0,
        "family_params": family_params,
        "pv": {
            "curve_id": pv_id,
            "name": pv_meta["name"],
            "scale_w": pv_scale,
            "routes": pv_routes,
            "scale_w_total": pv_scale * pv_routes,
            "duration_min": duration_min,
            "step_min": step_min,
            "point_count": n_pts,
            "sas": {
                "mode": "SAS",
                "v_const": v_const,
                "i_max": PV_I_MAX,
                "w_max": PV_W_MAX,
                "formula": "I = P / V",
                "transport": "LXI",
                "port": 80,
                "scpi_hint": f"OUTP:MODE SAS; VOLT {v_const:g}; CURR <I>; OUTP ON",
            },
            "points": pv_points,
        },
        "load": {
            "curve_id": load_id,
            "name": load_meta["name"],
            "scope": load_meta.get("scope", "home"),
            "scale_w": load_scale,
            "duration_min": duration_min,
            "step_min": step_min,
            "point_count": len(load_points),
            "points": load_points,
        },
        "offgrid": offgrid_channel,
        "quick": {
            "meter_presets_w": [0, 200, 800, 1500],
            "pv_quick_w": [0, 200, 400, 600],
            "load_quick_w": [0, 300, 800, 1500, 2500],
            "backflow_presets_w": [0, 100, 500, 1000, 2000],
        },
    }
