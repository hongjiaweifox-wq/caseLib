"""
@file remote_data.py
@brief Pull a real household's historical PV/load curves from the Tuya energy RPC gateway.
@note Auth cookie is supplied per-request by the caller (never stored here). Read-only.
"""

from __future__ import annotations

import datetime as _dt
import json
import re
import time as _time
import urllib.request
from typing import Any, Dict, List

DEFAULT_HOST = "pie-eu.tuya-inc.com:7799"
DEFAULT_METRICS = "home_total_photovoltaic_power, home_total_load_power"
_RPC_PATH = "/api/eves/v1/rpc/invoke"

_FUSION_CONTEXT: Dict[str, Any] = {
    "apiInfo": {"apiName": "", "apiVersion": ""},
    "clientInfo": {"apiKeyType": "", "appId": 0, "bizType": 0, "clientId": ""},
    "developerInfo": {"iotUid": "", "projectCode": "", "tenantCode": ""},
    "deviceInfo": {"deviceId": ""},
    "requestInfo": {"bizData": {"": ""}, "lang": "", "neutralDomain": False},
    "userInfo": {"bizType": 659027, "guestUser": False, "isChild": 0,
                 "parentUid": "", "spaceId": 0, "uid": ""},
}


def _build_payload(home_id: str, start: str, end: str, granularity: str, metrics: str) -> Dict[str, Any]:
    return {
        "types": "dubbo",
        "serviceName": "com.tuya.smartenergy.atop.home.IHomeCommonAtopService",
        "group": "",
        "version": "",
        "method": "getMultiDataDateConvertUnitToW",
        "paramsTypes": ["java.lang.String"] * 13 + ["com.tuya.fusion.client.basic.FusionContext"],
        "params": [
            home_id, metrics, "hour", start, end, "", "", granularity,
            "", "", "1", "{\"scale\":2}", "", _FUSION_CONTEXT,
        ],
        "attachments": {},
        "registry": "zookeeper-dubbo",
    }


def _minutes_from(date_yyyymmdd: str, point_date: str) -> int:
    d0 = _dt.datetime.strptime(date_yyyymmdd, "%Y%m%d")
    dp = _dt.datetime.strptime(point_date[:12], "%Y%m%d%H%M")
    return int((dp - d0).total_seconds() // 60)


def _classify(indicator: str) -> str:
    name = indicator.strip().lower()
    if "photovoltaic" in name or name == "pv":
        return "pv"
    if "load" in name:
        return "load"
    return name


def fetch_home_curves(
    home_id: str,
    date: str,
    cookie: str,
    host: str = DEFAULT_HOST,
    granularity: str = "15m",
    metrics: str = DEFAULT_METRICS,
    timeout: int = 25,
) -> Dict[str, Any]:
    """Return {channels: {pv:[{t_min,w}], load:[...]}, indicators:[...]} for one day."""
    date = re.sub(r"\D", "", str(date or ""))
    if len(date) != 8:
        raise ValueError("日期需为 YYYYMMDD")
    host = (host or DEFAULT_HOST).strip().rstrip("/")
    payload = _build_payload(home_id, date + "00", date + "23", granularity or "15m", metrics)

    req = urllib.request.Request(
        f"https://{host}{_RPC_PATH}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json;charset=UTF-8",
            "accept": "application/json, text/plain, */*",
            "auth-app": "smartenergy",
            "origin": f"https://{host}",
            "referer": f"https://{host}/",
            "cookie": cookie,
        },
        method="POST",
    )

    # The Dubbo gateway occasionally returns a transient downstream i/o timeout; retry those only.
    outer: Dict[str, Any] = {}
    last_err: Any = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                outer = json.loads(resp.read().decode("utf-8"))
            msg = str(outer.get("msg") or outer.get("errorMsg") or "")
            if "timeout" in msg.lower():
                last_err = RuntimeError(msg)  # transient → retry
            else:
                last_err = None
                break  # definitive response (success or real error) → stop
        except Exception as exc:  # noqa: BLE001 — network hiccup → retry
            last_err = exc
        if attempt < 2:
            _time.sleep(1.2)
    if last_err is not None:
        raise last_err

    if outer.get("code") not in (0, None):
        raise RuntimeError(outer.get("msg") or outer.get("errorMsg") or f"网关返回 code={outer.get('code')}")
    raw = outer.get("result")
    inner = json.loads(raw) if isinstance(raw, str) else (raw or {})
    if inner.get("errorMsg"):
        raise RuntimeError(str(inner["errorMsg"]))
    arr = inner.get("result") or []

    channels: Dict[str, List[Dict[str, int]]] = {}
    indicators: List[str] = []
    for it in arr:
        ind = str(it.get("indicator") or "").strip()
        indicators.append(ind)
        dedup: Dict[int, int] = {}
        for p in it.get("list") or []:
            ds = str(p.get("date") or p.get("timeStr") or "")
            if len(ds) < 12:
                continue
            try:
                t = _minutes_from(date, ds)
            except ValueError:
                continue
            if t < 0 or t > 1440:
                continue
            try:
                w = float(p.get("value") if p.get("value") not in (None, "") else 0)
            except (TypeError, ValueError):
                w = 0.0
            dedup[t] = max(0, int(round(w)))
        pts = [{"t_min": t, "w": dedup[t]} for t in sorted(dedup)]
        channels[_classify(ind)] = pts

    return {"channels": channels, "indicators": indicators, "home_id": home_id, "date": date}
