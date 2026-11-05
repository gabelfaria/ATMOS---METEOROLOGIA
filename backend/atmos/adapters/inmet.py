"""Avisos meteorológicos OFICIAIS do INMET (https://avisos.inmet.gov.br/).

Endpoint JSON público usado pelo próprio portal de avisos (apiprevmet3.inmet.gov.br/avisos/ativos),
com CORS liberado. Os avisos são emitidos pelo INMET — o app apenas os exibe e filtra pela localização.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from .. import config
from ..geo import point_in_geometry
from ..http import fetch

ATTRIBUTION = "Avisos: INMET — Instituto Nacional de Meteorologia"
BRT = timezone(timedelta(hours=-3))

SEVERITY_LEVEL = {"Perigo Potencial": 1, "Perigo": 2, "Grande Perigo": 3}


def _parse_dt(s: str | None) -> int | None:
    """'2026-11-05 00:01' (horário de Brasília) → epoch UTC."""
    if not s:
        return None
    try:
        return int(datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=BRT).timestamp())
    except ValueError:
        return None


def _parse_list(s: str | list | None) -> list[str]:
    if not s:
        return []
    if isinstance(s, list):
        return [str(x) for x in s]
    s = str(s).strip()
    if s.startswith("["):
        try:
            import ast

            return [str(x) for x in ast.literal_eval(s)]
        except (ValueError, SyntaxError):
            pass
    return [s]


def normalize(a: dict[str, Any], period: str) -> dict[str, Any]:
    geom = None
    try:
        geom = json.loads(a.get("poligono") or "null")
    except json.JSONDecodeError:
        geom = None
    sev = a.get("severidade") or ""
    return {
        "id": f"inmet-{a.get('id_aviso')}-{a.get('id_sequencia')}",
        "kind": "official",
        "authority": "INMET",
        "event": a.get("descricao"),
        "severity": sev,
        "level": SEVERITY_LEVEL.get(sev, 0),
        "color": a.get("aviso_cor"),
        "start": _parse_dt(a.get("inicio")),
        "end": _parse_dt(a.get("fim")),
        "risks": _parse_list(a.get("riscos")),
        "instructions": _parse_list(a.get("instrucoes")),
        "states": a.get("estados"),
        "period": period,
        "geometry": geom,
        "url": "https://avisos.inmet.gov.br/",
        "source": ATTRIBUTION,
    }


async def fetch_active() -> dict[str, Any]:
    res = await fetch("inmet", config.INMET_AVISOS, ttl=600)
    alerts = []
    for period in ("hoje", "futuro"):
        for a in res.value.get(period, []) or []:
            alerts.append(normalize(a, period))
    return {"alerts": alerts, "fetchedAt": res.fetched_at, "stale": res.stale}


def alerts_for_point(alerts: list[dict[str, Any]], lat: float, lon: float, now: float | None = None) -> list[dict]:
    now = now or time.time()
    out = []
    for a in alerts:
        if not a.get("geometry") or not point_in_geometry(lon, lat, a["geometry"]):
            continue
        if a.get("end") and a["end"] < now:
            continue
        item = {k: v for k, v in a.items() if k != "geometry"}
        item["inForce"] = bool(a.get("start") and a["start"] <= now)
        out.append(item)
    out.sort(key=lambda x: (-x["level"], x.get("start") or 0))
    return out


def to_geojson(alerts: list[dict[str, Any]]) -> dict[str, Any]:
    feats = []
    for a in alerts:
        if not a.get("geometry"):
            continue
        props = {k: a[k] for k in ("id", "event", "severity", "level", "color", "start", "end", "period")}
        feats.append({"type": "Feature", "geometry": a["geometry"], "properties": props})
    return {"type": "FeatureCollection", "features": feats}
