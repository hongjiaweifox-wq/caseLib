"""Wiring model for caseLib (reference only; no groupAppControl dependency).

Rules:
1. PV bus ↔ device PV only
2. Grid bus ↔ device Grid only
3. Bypass bus ↔ device offgrid only
4. Family load ↔ Grid bus only
5. Device Grid ↔ other device Grid or offgrid (also Grid bus via rule 2)
6. Device offgrid ↔ other device offgrid or Bypass bus
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

BUS_KINDS = [
    {"kind": "pv", "label": "光伏 PV"},
    {"kind": "grid", "label": "电网 Grid"},
    {"kind": "bypass", "label": "Bypass负载"},
    {"kind": "family", "label": "家庭负载"},
]

PORT_NAMES = ("pv", "grid", "offgrid")

# Fallback ids when catalog file is unavailable; live list comes from models.load_models.
MODELS = [
    "CBE2000 Pro",
    "CBE5000 Pro",
    "Lyra 2500 AC/Pro（欧标）",
    "Lyra 2500 Pro（英规）",
    "Atlas 6000 AC",
]

_ALLOWED_PAIRS = {
    frozenset({("bus", "pv"), ("dev", "pv")}),
    frozenset({("bus", "grid"), ("dev", "grid")}),
    frozenset({("bus", "bypass"), ("dev", "offgrid")}),
    frozenset({("bus", "family"), ("bus", "grid")}),
    frozenset({("dev", "grid"), ("dev", "grid")}),
    frozenset({("dev", "grid"), ("dev", "offgrid")}),
    frozenset({("dev", "offgrid"), ("dev", "offgrid")}),
}


def model_port_counts(model_meta: Optional[Dict[str, Any]]) -> Dict[str, int]:
    """Port slot counts from catalog. Unknown model → 1 each."""
    if not model_meta:
        return {"pv": 1, "grid": 1, "offgrid": 1}
    return {
        "pv": max(0, int(model_meta.get("pv_n") or 0)),
        "grid": max(0, int(model_meta.get("grid_n") or 0)),
        "offgrid": max(0, int(model_meta.get("offgrid_n") or 0)),
    }


def model_port_flags(model_meta: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    c = model_port_counts(model_meta)
    return {k: c[k] > 0 for k in PORT_NAMES}


def device_port_counts(device: Dict[str, Any], catalog_by_id: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, int]:
    """Prefer stamped pv_n/grid_n/offgrid_n on device; else catalog; else 1/1/1."""
    if any(k in device for k in ("pv_n", "grid_n", "offgrid_n")):
        return {
            "pv": max(0, int(device.get("pv_n") or 0)),
            "grid": max(0, int(device.get("grid_n") or 0)),
            "offgrid": max(0, int(device.get("offgrid_n") or 0)),
        }
    meta = None
    if catalog_by_id:
        meta = catalog_by_id.get(str(device.get("model") or ""))
    return model_port_counts(meta)


def stamp_device_port_counts(device: Dict[str, Any], model_meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    c = model_port_counts(model_meta)
    device["pv_n"] = c["pv"]
    device["grid_n"] = c["grid"]
    device["offgrid_n"] = c["offgrid"]
    return device


def default_buses() -> List[Dict[str, Any]]:
    return [
        {"id": f"bus_{k['kind']}", "kind": k["kind"], "label": k["label"], "x": None, "y": None}
        for k in BUS_KINDS
    ]


def bus_ref(bus_id: str) -> str:
    return f"bus:{bus_id}"


def dev_ref(uid: str, port: str, idx: Any = 0) -> str:
    return f"dev:{uid}:{port}:{int(idx)}"


def parse_ref(raw: Any) -> Optional[Dict[str, str]]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s.startswith("bus:"):
        return {"type": "bus", "id": s[4:]}
    if s.startswith("dev:"):
        parts = s.split(":")
        # legacy: dev:uid:port
        if len(parts) == 3 and parts[2] in PORT_NAMES:
            return {"type": "dev", "uid": parts[1], "port": parts[2], "idx": "0"}
        # indexed: dev:uid:port:idx
        if len(parts) == 4 and parts[2] in PORT_NAMES:
            try:
                idx = str(int(parts[3]))
            except ValueError:
                return None
            return {"type": "dev", "uid": parts[1], "port": parts[2], "idx": idx}
        return None
    return {"type": "bus", "id": s}


def ref_key(ep: Dict[str, str]) -> str:
    if ep["type"] == "bus":
        return bus_ref(ep["id"])
    return dev_ref(ep["uid"], ep["port"], ep.get("idx", 0))


def endpoint_kind(ep: Dict[str, str], buses_by_id: Dict[str, Dict[str, Any]]) -> Optional[str]:
    if ep["type"] == "bus":
        b = buses_by_id.get(ep["id"])
        return str(b["kind"]) if b else None
    return ep.get("port")


def can_connect(a: Dict[str, str], b: Dict[str, str], buses_by_id: Dict[str, Dict[str, Any]]) -> bool:
    if ref_key(a) == ref_key(b):
        return False
    ka = endpoint_kind(a, buses_by_id)
    kb = endpoint_kind(b, buses_by_id)
    if not ka or not kb:
        return False
    return frozenset({(a["type"], ka), (b["type"], kb)}) in _ALLOWED_PAIRS


def _bus_map(buses: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {str(b["id"]): b for b in buses}


def _coerce_slots(raw: Any, n: int) -> List[str]:
    if n <= 0:
        return []
    if isinstance(raw, list):
        vals = [str(x or "") for x in raw]
    elif raw is None or raw == "":
        vals = []
    else:
        vals = [str(raw)]
    if len(vals) < n:
        vals = vals + [""] * (n - len(vals))
    return vals[:n]


def _get_slot(ports: Dict[str, Any], kind: str, idx: Any) -> str:
    i = int(idx or 0)
    slots = ports.get(kind)
    if isinstance(slots, list):
        if 0 <= i < len(slots):
            return str(slots[i] or "")
        return ""
    # legacy single string
    if i == 0:
        return str(slots or "")
    return ""


def _set_slot(ports: Dict[str, Any], kind: str, idx: Any, value: str) -> None:
    i = int(idx or 0)
    slots = ports.get(kind)
    if not isinstance(slots, list):
        # upgrade legacy
        slots = [str(slots or "")] if slots else []
        ports[kind] = slots
    while len(slots) <= i:
        slots.append("")
    slots[i] = value


def _iter_device_slots(ports: Dict[str, Any]):
    for kind in PORT_NAMES:
        slots = ports.get(kind)
        if isinstance(slots, list):
            for i, val in enumerate(slots):
                yield kind, i, str(val or "")
        elif slots:
            yield kind, 0, str(slots)


def _clear_endpoint(wiring: Dict[str, Any], ep: Dict[str, str]) -> None:
    if ep["type"] == "bus":
        links = wiring.setdefault("bus_links", {})
        other = links.pop(ep["id"], None)
        if other and links.get(other) == ep["id"]:
            links.pop(other, None)
        return
    ports = wiring.get("devices", {}).get(ep["uid"])
    if not ports:
        return
    old = _get_slot(ports, ep["port"], ep.get("idx", 0))
    _set_slot(ports, ep["port"], ep.get("idx", 0), "")
    old_ep = parse_ref(old)
    if not old_ep:
        return
    if old_ep["type"] == "dev":
        peer = wiring.get("devices", {}).get(old_ep["uid"])
        if not peer:
            return
        peer_val = _get_slot(peer, old_ep["port"], old_ep.get("idx", 0))
        p2 = parse_ref(peer_val)
        if p2 and ref_key(p2) == ref_key(ep):
            _set_slot(peer, old_ep["port"], old_ep.get("idx", 0), "")


def _set_link(wiring: Dict[str, Any], a: Dict[str, str], b: Dict[str, str]) -> bool:
    buses_by_id = _bus_map(wiring.get("buses") or [])
    if not can_connect(a, b, buses_by_id):
        return False
    _clear_endpoint(wiring, a)
    _clear_endpoint(wiring, b)

    if a["type"] == "bus" and b["type"] == "bus":
        links = wiring.setdefault("bus_links", {})
        links[a["id"]] = b["id"]
        links[b["id"]] = a["id"]
        return True

    if a["type"] == "dev" and b["type"] == "bus":
        _set_slot(wiring["devices"][a["uid"]], a["port"], a.get("idx", 0), b["id"])
        return True
    if a["type"] == "bus" and b["type"] == "dev":
        _set_slot(wiring["devices"][b["uid"]], b["port"], b.get("idx", 0), a["id"])
        return True

    _set_slot(wiring["devices"][a["uid"]], a["port"], a.get("idx", 0), ref_key(b))
    _set_slot(wiring["devices"][b["uid"]], b["port"], b.get("idx", 0), ref_key(a))
    return True


def _valid_device_port_value(raw: Any, bus_ids: set, uids: set, self_uid: str) -> str:
    ep = parse_ref(raw)
    if not ep:
        return ""
    if ep["type"] == "bus":
        return ep["id"] if ep["id"] in bus_ids else ""
    if ep["type"] == "dev":
        if ep["uid"] not in uids or ep["uid"] == self_uid:
            return ""
        if ep["port"] not in PORT_NAMES:
            return ""
        return ref_key(ep)
    return ""


def normalize_wiring(
    raw: Optional[Dict[str, Any]],
    uids: List[str],
    port_counts: Optional[Dict[str, Dict[str, int]]] = None,
) -> Dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    buses = []
    for i, b in enumerate(src.get("buses") or []):
        kind = str(b.get("kind") or "pv")
        if kind not in {k["kind"] for k in BUS_KINDS}:
            kind = "pv"
        buses.append(
            {
                "id": str(b.get("id") or f"bus_{i}"),
                "kind": kind,
                "label": str(b.get("label") or kind),
                "x": b.get("x"),
                "y": b.get("y"),
            }
        )
        sc = b.get("scale")
        if sc is not None and sc != "":
            try:
                buses[-1]["scale"] = round(float(sc), 2)
            except (TypeError, ValueError):
                pass
    if not buses:
        buses = default_buses()
    bus_ids = {b["id"] for b in buses}
    uid_set = set(uids)
    buses_by_id = _bus_map(buses)
    counts = port_counts or {}

    src_dev = src.get("devices") if isinstance(src.get("devices"), dict) else {}
    devices: Dict[str, Dict[str, List[str]]] = {}
    for uid in uids:
        d = src_dev.get(uid) or {}
        c = counts.get(uid) or {"pv": 1, "grid": 1, "offgrid": 1}
        devices[uid] = {
            kind: [
                _valid_device_port_value(v, bus_ids, uid_set, uid)
                for v in _coerce_slots(d.get(kind), int(c.get(kind) or 0))
            ]
            for kind in PORT_NAMES
        }

    bus_links: Dict[str, str] = {}
    raw_links = src.get("bus_links") if isinstance(src.get("bus_links"), dict) else {}
    for a_id, b_id in raw_links.items():
        a_id, b_id = str(a_id), str(b_id)
        if a_id not in bus_ids or b_id not in bus_ids:
            continue
        if can_connect({"type": "bus", "id": a_id}, {"type": "bus", "id": b_id}, buses_by_id):
            bus_links[a_id] = b_id
            bus_links[b_id] = a_id

    for uid, ports in devices.items():
        for kind, idx, val in list(_iter_device_slots(ports)):
            ep = parse_ref(val)
            if not ep:
                _set_slot(ports, kind, idx, "")
                continue
            self_ep = {"type": "dev", "uid": uid, "port": kind, "idx": str(idx)}
            other = {"type": "bus", "id": ep["id"]} if ep["type"] == "bus" else ep
            if not can_connect(self_ep, other, buses_by_id):
                _set_slot(ports, kind, idx, "")

    for uid, ports in devices.items():
        for kind, idx, val in list(_iter_device_slots(ports)):
            ep = parse_ref(val)
            if not ep or ep["type"] != "dev":
                continue
            peer = devices.get(ep["uid"])
            if not peer:
                _set_slot(ports, kind, idx, "")
                continue
            back = _get_slot(peer, ep["port"], ep.get("idx", 0))
            want = ref_key({"type": "dev", "uid": uid, "port": kind, "idx": str(idx)})
            if back != want:
                if not back:
                    _set_slot(peer, ep["port"], ep.get("idx", 0), want)
                else:
                    _set_slot(ports, kind, idx, "")

    return {"buses": buses, "devices": devices, "bus_links": bus_links}


def _port_counts_map(home: Dict[str, Any], model_catalog: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Dict[str, int]]:
    by_id = {m["id"]: m for m in (model_catalog or []) if isinstance(m, dict) and m.get("id")}
    out: Dict[str, Dict[str, int]] = {}
    for d in home.get("devices") or []:
        uid = str(d.get("uid") or "")
        if not uid:
            continue
        out[uid] = device_port_counts(d, by_id)
    return out


def default_lab_home(name: str = "实验室家庭", device_n: int = 3, model_catalog: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    by_id = {m["id"]: m for m in (model_catalog or []) if isinstance(m, dict) and m.get("id")}
    devices = []
    for i in range(max(0, device_n)):
        model = MODELS[i % len(MODELS)]
        d = {"uid": f"dut{i+1}", "name": f"DUT{i+1}", "model": model}
        stamp_device_port_counts(d, by_id.get(model))
        devices.append(d)
    uids = [d["uid"] for d in devices]
    counts = {d["uid"]: device_port_counts(d, by_id) for d in devices}
    return {
        "id": f"lab_{int(time.time())}",
        "name": name,
        "devices": devices,
        "wiring": normalize_wiring({"buses": default_buses(), "devices": {}, "bus_links": {}}, uids, counts),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def ensure_wiring(home: Dict[str, Any], model_catalog: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    uids = [str(d.get("uid")) for d in home.get("devices") or []]
    home["wiring"] = normalize_wiring(home.get("wiring"), uids, _port_counts_map(home, model_catalog))
    return home["wiring"]


def _device_model_map(home: Dict[str, Any]) -> Dict[str, str]:
    return {str(d.get("uid")): str(d.get("model") or "") for d in (home.get("devices") or [])}


def auto_wire_lab(home: Dict[str, Any], model_catalog: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    w = ensure_wiring(home, model_catalog)
    by_kind = {}
    for b in w["buses"]:
        by_kind.setdefault(b["kind"], b["id"])
    for uid, ports in w["devices"].items():
        for kind in PORT_NAMES:
            slots = ports.get(kind) or []
            if not isinstance(slots, list):
                continue
            target = ""
            if kind == "pv":
                target = by_kind.get("pv", "")
            elif kind == "grid":
                target = by_kind.get("grid", "")
            elif kind == "offgrid":
                target = by_kind.get("bypass", "")
            ports[kind] = [target] * len(slots) if target else [""] * len(slots)
    w["bus_links"] = {}
    fam, grid = by_kind.get("family"), by_kind.get("grid")
    if fam and grid:
        w["bus_links"][fam] = grid
        w["bus_links"][grid] = fam
    home["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return home


def wire_device_ports(home: Dict[str, Any], uid: str, model_catalog: Optional[List[Dict[str, Any]]] = None) -> None:
    """Auto-connect one device's available port slots to default buses."""
    w = ensure_wiring(home, model_catalog)
    if uid not in w["devices"]:
        return
    by_kind = {}
    for b in w["buses"]:
        by_kind.setdefault(b["kind"], b["id"])
    ports = w["devices"][uid]
    mapping = {"pv": by_kind.get("pv", ""), "grid": by_kind.get("grid", ""), "offgrid": by_kind.get("bypass", "")}
    for kind in PORT_NAMES:
        slots = ports.get(kind) or []
        if not isinstance(slots, list):
            continue
        target = mapping.get(kind, "")
        ports[kind] = [(target or "") for _ in slots]


def clear_all_wires(home: Dict[str, Any], model_catalog: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    w = ensure_wiring(home, model_catalog)
    for uid, ports in w["devices"].items():
        for kind in PORT_NAMES:
            slots = ports.get(kind) or []
            n = len(slots) if isinstance(slots, list) else 0
            ports[kind] = [""] * n
    w["bus_links"] = {}
    return home


def connect_endpoints(home: Dict[str, Any], a: Dict[str, str], b: Dict[str, str]) -> bool:
    w = ensure_wiring(home)
    # normalize idx
    if a.get("type") == "dev" and "idx" not in a:
        a = {**a, "idx": "0"}
    if b.get("type") == "dev" and "idx" not in b:
        b = {**b, "idx": "0"}
    ok = _set_link(w, a, b)
    if ok:
        home["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return ok


def set_wire(home: Dict[str, Any], device_uid: str, port: str, target: Optional[str], idx: Any = 0) -> bool:
    w = ensure_wiring(home)
    if device_uid not in w["devices"] or port not in PORT_NAMES:
        return False
    a = {"type": "dev", "uid": device_uid, "port": port, "idx": str(int(idx or 0))}
    if not target:
        _clear_endpoint(w, a)
        return True
    b = parse_ref(target)
    if not b:
        return False
    return _set_link(w, a, b)


def disconnect_port(home: Dict[str, Any], device_uid: str, port: str, idx: Any = 0) -> None:
    set_wire(home, device_uid, port, None, idx=idx)


def disconnect_endpoint(home: Dict[str, Any], ep: Dict[str, str]) -> None:
    w = ensure_wiring(home)
    if ep.get("type") == "dev" and "idx" not in ep:
        ep = {**ep, "idx": "0"}
    _clear_endpoint(w, ep)


def add_device(
    home: Dict[str, Any],
    model: str = "CBE2000 Pro",
    model_meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    model = str(model or MODELS[0]).strip() or MODELS[0]
    if not model:
        model = MODELS[0]
    n = len(home.get("devices") or []) + 1
    uid = f"dut{n}"
    while any(d.get("uid") == uid for d in home.get("devices") or []):
        n += 1
        uid = f"dut{n}"
    device = {"uid": uid, "name": uid.upper(), "model": model}
    stamp_device_port_counts(device, model_meta)
    home.setdefault("devices", []).append(device)
    ensure_wiring(home)
    return home


def add_bus(home: Dict[str, Any], kind: str = "pv", label: Optional[str] = None) -> Dict[str, Any]:
    w = ensure_wiring(home)
    meta = next((k for k in BUS_KINDS if k["kind"] == kind), None) or BUS_KINDS[0]
    kind = meta["kind"]
    same = [b for b in w["buses"] if b.get("kind") == kind]
    n = len(same) + 1
    bus_id = f"bus_{kind}_{int(time.time() * 1000) % 100000000}"
    while any(b.get("id") == bus_id for b in w["buses"]):
        bus_id = f"bus_{kind}_{int(time.time() * 1000) % 100000000}_{n}"
    w["buses"].append(
        {
            "id": bus_id,
            "kind": kind,
            "label": str(label or (f"{meta['label']} {n}" if n > 1 else meta["label"])),
            "x": None,
            "y": None,
        }
    )
    home["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return home


def remove_bus(home: Dict[str, Any], bus_id: str) -> bool:
    w = ensure_wiring(home)
    if len(w["buses"]) <= 1:
        return False
    before = len(w["buses"])
    w["buses"] = [b for b in w["buses"] if b.get("id") != bus_id]
    if len(w["buses"]) == before:
        return False
    for ports in w["devices"].values():
        for kind, idx, val in list(_iter_device_slots(ports)):
            ep = parse_ref(val)
            if ep and ep["type"] == "bus" and ep["id"] == bus_id:
                _set_slot(ports, kind, idx, "")
    links = w.get("bus_links") or {}
    other = links.pop(bus_id, None)
    if other and links.get(other) == bus_id:
        links.pop(other, None)
    w["bus_links"] = links
    return True


def remove_device(home: Dict[str, Any], uid: str) -> bool:
    """Remove a device and clear all wiring refs that pointed to it."""
    uid = str(uid or "").strip()
    if not uid:
        return False
    devices = home.get("devices") or []
    before = len(devices)
    home["devices"] = [d for d in devices if str(d.get("uid") or "") != uid]
    if len(home["devices"]) == before:
        return False
    w = ensure_wiring(home)
    w["devices"].pop(uid, None)
    for ports in w["devices"].values():
        for kind, idx, val in list(_iter_device_slots(ports)):
            ep = parse_ref(val)
            if ep and ep["type"] == "dev" and ep["uid"] == uid:
                _set_slot(ports, kind, idx, "")
    home["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return True


def set_bus_label(home: Dict[str, Any], bus_id: str, label: str) -> bool:
    w = ensure_wiring(home)
    label = str(label or "").strip()
    if not label:
        return False
    for b in w["buses"]:
        if b["id"] == bus_id:
            b["label"] = label[:64]
            home["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            return True
    return False


def set_bus_position(home: Dict[str, Any], bus_id: str, x: float, y: float) -> bool:
    w = ensure_wiring(home)
    for b in w["buses"]:
        if b["id"] == bus_id:
            b["x"] = round(x)
            b["y"] = round(y)
            return True
    return False


def save_home(data_dir: Path, home: Dict[str, Any]) -> Path:
    data_dir.mkdir(parents=True, exist_ok=True)
    try:
        from caseLib.knowledge.models import load_models

        catalog = load_models(Path(__file__).resolve().parent.parent / "knowledge")
    except Exception:
        catalog = None
    # Drop ephemeral UI fields if any
    home.pop("_saved_path", None)
    home.pop("_saved_file", None)
    ensure_wiring(home, catalog)
    hid = str(home.get("id") or f"lab_{int(time.time())}")
    home["id"] = hid
    home["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    out = data_dir / f"{hid}.json"
    out.write_text(json.dumps(home, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def load_home(data_dir: Path, home_id: str) -> Optional[Dict[str, Any]]:
    p = data_dir / f"{home_id}.json"
    if not p.is_file():
        return None
    home = json.loads(p.read_text(encoding="utf-8"))
    try:
        from caseLib.knowledge.models import load_models

        catalog = load_models(Path(__file__).resolve().parent.parent / "knowledge")
    except Exception:
        catalog = None
    ensure_wiring(home, catalog)
    return home

def delete_home(data_dir: Path, home_id: str) -> bool:
    """Delete a saved lab_*.json by id. Guards against path traversal."""
    hid = str(home_id or "").strip()
    if hid.endswith(".json"):
        hid = hid[:-5]
    if not hid or "/" in hid or "\\" in hid or ".." in hid or not hid.startswith("lab_"):
        raise ValueError("非法家庭ID")
    p = (data_dir / f"{hid}.json").resolve()
    if p.parent != data_dir.resolve() or not p.name.startswith("lab_"):
        raise ValueError("非法家庭ID")
    if not p.is_file():
        return False
    p.unlink()
    return True


def list_saved(data_dir: Path) -> List[Dict[str, Any]]:
    data_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for p in data_dir.glob("lab_*.json"):
        try:
            h = json.loads(p.read_text(encoding="utf-8"))
            if not isinstance(h, dict) or "wiring" not in h:
                continue
            items.append(
                {
                    "id": h.get("id") or p.stem,
                    "name": h.get("name"),
                    "device_n": len(h.get("devices") or []),
                    "updated_at": h.get("updated_at"),
                    "file": p.name,
                    "path": str(p),
                }
            )
        except Exception:
            continue
    # Newest first so UI / boot can pick the latest save.
    items.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
    return items


def wiring_rules_public() -> Dict[str, Any]:
    return {
        "rules": [
            "PV 端子仅接设备 PV",
            "Grid 端子仅接设备 Grid",
            "Bypass 负载仅接设备离网口",
            "家庭负载仅接电网端子",
            "设备 Grid 可接另一台 Grid / 离网",
            "设备离网可接另一台离网或 Bypass 端子",
        ]
    }
