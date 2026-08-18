"""
@file kg_store.py
@brief Knowledge-graph tab local data (点位信息 table / 工况判定 markdown doc).
@note Feishu sources are login-walled; the user exports data and we persist it locally.
"""

from __future__ import annotations

import csv
import io
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ALLOWED_KEYS = ("points", "conditions")

_IMG_STEM = "kg_hardware"
_IMG_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
             ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml"}


def _path(data_dir: Path, key: str) -> Path:
    return data_dir / f"kg_{key}.json"


def hardware_image_path(data_dir: Path) -> Optional[Path]:
    for p in sorted(data_dir.glob(_IMG_STEM + ".*")):
        if p.suffix.lower() in _IMG_MIME:
            return p
    return None


def hardware_image_mime(path: Path) -> str:
    return _IMG_MIME.get(path.suffix.lower(), "application/octet-stream")


def save_hardware_image(data_dir: Path, filename: str, raw: bytes) -> Path:
    ext = Path(str(filename or "")).suffix.lower()
    if ext not in _IMG_MIME:
        raise ValueError("仅支持 png / jpg / webp / gif / svg")
    data_dir.mkdir(parents=True, exist_ok=True)
    for p in data_dir.glob(_IMG_STEM + ".*"):
        try:
            p.unlink()
        except OSError:
            pass
    out = data_dir / (_IMG_STEM + ext)
    out.write_bytes(raw)
    return out


def load(data_dir: Path, key: str) -> Dict[str, Any]:
    if key not in ALLOWED_KEYS:
        raise ValueError("unknown kg key")
    p = _path(data_dir, key)
    if not p.is_file():
        return {}
    try:
        rec = json.loads(p.read_text(encoding="utf-8"))
        return rec if isinstance(rec, dict) else {}
    except Exception:
        return {}


def save(data_dir: Path, key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if key not in ALLOWED_KEYS:
        raise ValueError("unknown kg key")
    data_dir.mkdir(parents=True, exist_ok=True)
    rec = dict(payload or {})
    rec["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _path(data_dir, key).write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    return rec


def parse_delimited(text: str) -> Tuple[List[str], List[List[str]]]:
    """CSV/TSV → (columns, rows). Auto-sniffs comma vs tab."""
    text = (text or "").lstrip("﻿").strip("\n\r ")
    if not text:
        return [], []
    sample = text[:4000]
    delim = "\t" if sample.count("\t") > sample.count(",") else ","
    raw = [r for r in csv.reader(io.StringIO(text), delimiter=delim) if any((c or "").strip() for c in r)]
    if not raw:
        return [], []
    cols = [str(c or "").strip() for c in raw[0]]
    n = len(cols)
    body: List[List[str]] = []
    for r in raw[1:]:
        cells = [str(c or "").strip() for c in r]
        body.append((cells + [""] * n)[:n])
    return cols, body
