"""Device model catalog + PID association for caseLib.

Table-oriented fields:
  pv_n / grid_n / offgrid_n / battery_kwh / battery_expand
  ac_in_limit_w / ac_out_limit_w / reg_out_limit_w        (AC 侧限值 / 法规输出上限)
  bat_dc_chg_w / bat_dc_dchg_w                            (电池 DC 侧充/放限制)
  pids
Persisted at data/models.json.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


def _num(v: Any, default: float = 0) -> float:
    try:
        if v is None or v == "":
            return float(default)
        return float(v)
    except (TypeError, ValueError):
        return float(default)


def _int(v: Any, default: int = 0) -> int:
    return int(round(_num(v, default)))


# Seed catalog — numeric columns for table UI.
DEFAULT_MODELS: List[Dict[str, Any]] = [
    {
        "id": "CBE2000 Pro",
        "name": "CBE2000 Pro",
        "pv_n": 4,
        "grid_n": 1,
        "offgrid_n": 1,
        "battery_kwh": 2.05,
        "battery_expand": 1,
        "ac_in_limit_w": 3000,
        "ac_out_limit_w": 3000,
        "reg_out_limit_w": 3000,
        "bat_dc_chg_w": 1500,
        "bat_dc_dchg_w": 1500,
        "pids": [],
    },
    {
        "id": "CBE5000 Pro",
        "name": "CBE5000 Pro",
        "pv_n": 2,
        "grid_n": 1,
        "offgrid_n": 1,
        "battery_kwh": 5,
        "battery_expand": 1,
        "ac_in_limit_w": 3000,
        "ac_out_limit_w": 3000,
        "reg_out_limit_w": 3000,
        "bat_dc_chg_w": 1500,
        "bat_dc_dchg_w": 1500,
        "pids": [],
    },
    {
        "id": "Lyra 2500 AC/Pro（欧标）",
        "name": "Lyra 2500 AC/Pro（欧标）",
        "pv_n": 0,
        "grid_n": 1,
        "offgrid_n": 2,
        "battery_kwh": 0,
        "battery_expand": 0,
        "ac_in_limit_w": 1500,
        "ac_out_limit_w": 1500,
        "reg_out_limit_w": 1500,
        "bat_dc_chg_w": 1500,
        "bat_dc_dchg_w": 1500,
        "pids": [],
    },
    {
        "id": "Lyra 2500 Pro（英规）",
        "name": "Lyra 2500 Pro（英规）",
        "pv_n": 4,
        "grid_n": 1,
        "offgrid_n": 2,
        "battery_kwh": 0,
        "battery_expand": 0,
        "ac_in_limit_w": 1500,
        "ac_out_limit_w": 1500,
        "reg_out_limit_w": 1500,
        "bat_dc_chg_w": 1500,
        "bat_dc_dchg_w": 1500,
        "pids": [],
    },
    {
        "id": "Atlas 6000 AC",
        "name": "Atlas 6000 AC",
        "pv_n": 0,
        "grid_n": 1,
        "offgrid_n": 1,
        "battery_kwh": 0,
        "battery_expand": 1,
        "ac_in_limit_w": 3000,
        "ac_out_limit_w": 3000,
        "reg_out_limit_w": 3000,
        "bat_dc_chg_w": 1500,
        "bat_dc_dchg_w": 1500,
        "pids": [],
    },
]


def _models_path(data_dir: Path) -> Path:
    return data_dir / "models.json"


def _normalize_pids(raw: Any) -> List[str]:
    out: List[str] = []
    seen = set()
    if isinstance(raw, str):
        # allow "a/b/c" or "a,b,c"
        parts = raw.replace(",", "/").replace("，", "/").replace("、", "/").split("/")
        raw = parts
    if not isinstance(raw, list):
        return out
    for item in raw:
        pid = str(item or "").strip()
        if not pid or pid in seen:
            continue
        seen.add(pid)
        out.append(pid)
    return out


def _normalize_model(raw: Any, fallback_id: str = "") -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    mid = str(raw.get("id") or fallback_id or raw.get("name") or "").strip()
    if not mid:
        return None
    name = str(raw.get("name") or mid).strip() or mid
    # migrate legacy verbose text fields if new keys missing
    pv_n = raw.get("pv_n")
    grid_n = raw.get("grid_n")
    offgrid_n = raw.get("offgrid_n", raw.get("bypass_n"))
    battery_kwh = raw.get("battery_kwh")
    battery_expand = raw.get("battery_expand")
    return {
        "id": mid,
        "name": name,
        "pv_n": _int(pv_n, 0),
        "grid_n": _int(grid_n, 0),
        "offgrid_n": _int(offgrid_n, 0),
        "battery_kwh": round(_num(battery_kwh, 0), 3),
        "battery_expand": 1 if _int(battery_expand, 0) else 0,
        "ac_in_limit_w": _int(raw.get("ac_in_limit_w"), 0),
        "ac_out_limit_w": _int(raw.get("ac_out_limit_w"), 0),
        "reg_out_limit_w": _int(raw.get("reg_out_limit_w"), 0),
        "bat_dc_chg_w": _int(raw.get("bat_dc_chg_w"), 0),
        "bat_dc_dchg_w": _int(raw.get("bat_dc_dchg_w"), 0),
        "pids": _normalize_pids(raw.get("pids")),
        "updated_at": raw.get("updated_at"),
    }


def _merge_defaults(stored: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_id: Dict[str, Dict[str, Any]] = {}
    for m in DEFAULT_MODELS:
        nm = _normalize_model(m)
        if nm:
            by_id[nm["id"]] = nm
    for m in stored:
        nm = _normalize_model(m)
        if not nm:
            continue
        base = by_id.get(nm["id"], {})
        # If stored still has only legacy text and zeros for numeric, keep default numbers.
        if base and nm.get("pv_n") == 0 and nm.get("grid_n") == 0 and "pv_n" not in m and "pv" in m:
            nm = {
                **base,
                "pids": nm.get("pids") or base.get("pids") or [],
                "updated_at": nm.get("updated_at") or base.get("updated_at"),
                "name": nm.get("name") or base.get("name"),
            }
        else:
            merged = {**base, **nm}
            if not merged.get("pids") and base.get("pids"):
                # keep stored empty pids if explicitly saved; only fill when key absent
                if "pids" not in m:
                    merged["pids"] = base["pids"]
            # New limit columns: when a stored row predates them, keep the seeded
            # default instead of the normalized 0 (only backfill when key absent).
            for k in ("ac_in_limit_w", "ac_out_limit_w", "reg_out_limit_w", "bat_dc_chg_w", "bat_dc_dchg_w"):
                if k not in m and base.get(k):
                    merged[k] = base[k]
            nm = merged
        by_id[nm["id"]] = nm
    ordered: List[Dict[str, Any]] = []
    seen = set()
    for m in DEFAULT_MODELS:
        mid = m["id"]
        if mid in by_id:
            ordered.append(by_id[mid])
            seen.add(mid)
    for mid, m in by_id.items():
        if mid not in seen:
            ordered.append(m)
    return ordered


def load_models(data_dir: Path) -> List[Dict[str, Any]]:
    data_dir.mkdir(parents=True, exist_ok=True)
    path = _models_path(data_dir)
    stored: List[Dict[str, Any]] = []
    if path.is_file():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and isinstance(raw.get("models"), list):
                stored = raw["models"]
            elif isinstance(raw, list):
                stored = raw
        except Exception:
            stored = []
    return _merge_defaults(stored)


def save_models(data_dir: Path, models: List[Dict[str, Any]]) -> Path:
    data_dir.mkdir(parents=True, exist_ok=True)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    normalized = []
    for m in models:
        nm = _normalize_model(m)
        if nm:
            nm["updated_at"] = now
            normalized.append(nm)
    path = _models_path(data_dir)
    payload = {"updated_at": now, "models": normalized}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def replace_models(data_dir: Path, models: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Replace full catalog from table save (keeps unknown extra rows)."""
    save_models(data_dir, models)
    return load_models(data_dir)


def model_ids(data_dir: Path) -> List[str]:
    return [m["id"] for m in load_models(data_dir)]


def get_model(data_dir: Path, model_id: str) -> Optional[Dict[str, Any]]:
    mid = str(model_id or "").strip()
    for m in load_models(data_dir):
        if m["id"] == mid:
            return m
    return None


def upsert_model(data_dir: Path, patch: Dict[str, Any]) -> Dict[str, Any]:
    models = load_models(data_dir)
    mid = str(patch.get("id") or patch.get("name") or "").strip()
    if not mid:
        raise ValueError("missing model id")
    found = None
    for i, m in enumerate(models):
        if m["id"] == mid:
            found = i
            break
    base = models[found] if found is not None else {"id": mid, "name": mid, "pids": []}
    keys = (
        "name", "pv_n", "grid_n", "offgrid_n", "battery_kwh", "battery_expand",
        "ac_in_limit_w", "ac_out_limit_w", "reg_out_limit_w", "bat_dc_chg_w", "bat_dc_dchg_w",
    )
    merged = {**base, **{k: patch[k] for k in keys if k in patch}}
    if "pids" in patch:
        merged["pids"] = _normalize_pids(patch.get("pids"))
    merged["id"] = mid
    merged["name"] = str(merged.get("name") or mid)
    merged["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    nm = _normalize_model(merged)
    assert nm is not None
    if found is None:
        models.append(nm)
    else:
        models[found] = nm
    save_models(data_dir, models)
    return nm


def resolve_model_name(data_dir: Path, model: str) -> str:
    """Pick a catalog id; fall back to first model if unknown."""
    ids = model_ids(data_dir)
    if not ids:
        return str(model or "CBE2000 Pro")
    m = str(model or "").strip()
    if m in ids:
        return m
    aliases = {
        "CBE2000": "CBE2000 Pro",
        "CBE5000": "CBE5000 Pro",
        "Lyra1500": "Lyra 2500 AC/Pro（欧标）",
        "Atlas3000": "Atlas 6000 AC",
    }
    if m in aliases and aliases[m] in ids:
        return aliases[m]
    return ids[0]
