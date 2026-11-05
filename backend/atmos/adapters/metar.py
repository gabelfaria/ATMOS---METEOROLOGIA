"""Observações de superfície METAR via NOAA Aviation Weather Center (aviationweather.gov Data API).

São MEDIÇÕES reais de estações de aeroportos (DECEA no Brasil), atualizadas tipicamente de hora em hora.
Dados de domínio público (governo dos EUA). Conversões: nós→km/h, milhas→km.
"""

from __future__ import annotations

import re
from typing import Any

from .. import config
from ..geo import bearing_deg, compass8, haversine_km
from ..http import fetch

ATTRIBUTION = "METAR: NOAA Aviation Weather Center / DECEA"
KT_TO_KMH = 1.852
MI_TO_KM = 1.609344

_WX_DESC = {
    "TS": "trovoada",
    "SH": "pancadas",
    "RA": "chuva",
    "DZ": "garoa",
    "GR": "granizo",
    "GS": "granizo pequeno",
    "BR": "névoa úmida",
    "FG": "nevoeiro",
    "HZ": "névoa seca",
    "FU": "fumaça",
    "SQ": "rajadas (tempestade)",
}


def parse_wx(wx: str | None) -> dict[str, Any]:
    """Interpreta o grupo de tempo presente do METAR.

    Retorna precipitação no local (não conta `VC`, que é vizinhança de 8–16 km).
    """
    result = {
        "raw": wx or "",
        "precipAtStation": False,
        "precipVicinity": False,
        "thunder": False,
        "thunderVicinity": False,
        "intensity": None,  # fraca | moderada | forte
        "description": [],
    }
    if not wx:
        return result
    for tok in wx.split():
        vicinity = tok.startswith("VC")
        core = tok[2:] if vicinity else tok
        intensity = None
        if core.startswith("-"):
            intensity, core = "fraca", core[1:]
        elif core.startswith("+"):
            intensity, core = "forte", core[1:]
        codes = re.findall(r"[A-Z]{2}", core)
        precip = any(c in ("RA", "DZ", "GR", "GS") for c in codes)
        thunder = "TS" in codes
        if vicinity:
            result["precipVicinity"] |= precip or "SH" in codes
            result["thunderVicinity"] |= thunder
        else:
            result["precipAtStation"] |= precip
            result["thunder"] |= thunder
            if precip:
                result["intensity"] = intensity or "moderada"
        words = [_WX_DESC.get(c, c) for c in codes if c != "SH" or len(codes) == 1]
        if "SH" in codes and "RA" in codes:
            words = [w if w != "chuva" else "pancadas de chuva" for w in words]
        if thunder and len(words) > 1:
            desc = "trovoada com " + " e ".join(w for w in words if w != "trovoada")
        else:
            desc = " ".join(words)
        if precip and not vicinity:
            desc += f" {intensity or 'moderada'}"
        if vicinity:
            desc += " nas proximidades"
        result["description"].append(desc.strip())
    return result


def normalize(m: dict[str, Any], lat: float | None = None, lon: float | None = None) -> dict[str, Any]:
    wspd = m.get("wspd")
    wgst = m.get("wgst")
    visib = m.get("visib")
    vis_km = None
    if isinstance(visib, (int, float)):
        vis_km = round(visib * MI_TO_KM, 1)
    elif isinstance(visib, str) and visib.endswith("+"):
        vis_km = 10.0  # "10+" milhas → ≥10 km (limite inferior)
    out = {
        "station": m.get("icaoId"),
        "name": m.get("name"),
        "lat": m.get("lat"),
        "lon": m.get("lon"),
        "observedAt": m.get("obsTime"),
        "temperature": m.get("temp"),
        "dewpoint": m.get("dewp"),
        "windSpeed": round(wspd * KT_TO_KMH) if isinstance(wspd, (int, float)) else None,
        "windGust": round(wgst * KT_TO_KMH) if isinstance(wgst, (int, float)) else None,
        "windDirection": m.get("wdir") if isinstance(m.get("wdir"), (int, float)) else None,
        "pressure": m.get("altim"),
        "visibilityKm": vis_km,
        "weather": parse_wx(m.get("wxString")),
        "raw": m.get("rawOb"),
        "kind": "observation",
        "source": ATTRIBUTION,
    }
    t, td = out["temperature"], out["dewpoint"]
    if isinstance(t, (int, float)) and isinstance(td, (int, float)):
        # Umidade relativa pela fórmula de Magnus
        import math

        a, b = 17.625, 243.04
        rh = 100 * math.exp(a * td / (b + td) - a * t / (b + t))
        out["humidity"] = round(min(rh, 100))
    else:
        out["humidity"] = None
    if lat is not None and lon is not None and out["lat"] is not None:
        out["distanceKm"] = round(haversine_km(lat, lon, out["lat"], out["lon"]), 1)
        out["bearing"] = compass8(bearing_deg(lat, lon, out["lat"], out["lon"]))
    return out


async def fetch_nearby(lat: float, lon: float, radius_deg: float = 1.0, hours: int = 3) -> dict[str, Any]:
    """Todas as observações das últimas `hours` horas numa caixa ao redor do ponto."""
    # Caixa ancorada em grade de 0,5° para compartilhar cache entre usuários próximos.
    clat, clon = round(lat * 2) / 2, round(lon * 2) / 2
    bbox = f"{clat - radius_deg - 0.5},{clon - radius_deg - 0.5},{clat + radius_deg + 0.5},{clon + radius_deg + 0.5}"
    res = await fetch(
        "aviationweather",
        config.AVIATIONWEATHER_METAR,
        {"bbox": bbox, "format": "json", "hours": hours},
        ttl=600,
    )
    raw = res.value if isinstance(res.value, list) else []
    obs = [normalize(m, lat, lon) for m in raw]
    obs.sort(key=lambda o: (o.get("distanceKm", 9e9), -(o.get("observedAt") or 0)))
    latest: dict[str, dict] = {}
    history: dict[str, list] = {}
    for o in obs:
        sid = o["station"]
        history.setdefault(sid, []).append(o)
        if sid not in latest or (o["observedAt"] or 0) > (latest[sid]["observedAt"] or 0):
            latest[sid] = o
    stations = sorted(latest.values(), key=lambda o: o.get("distanceKm", 9e9))
    for s in stations:
        hist = sorted(history[s["station"]], key=lambda o: o["observedAt"] or 0)
        s["recentPrecip"] = any(h["weather"]["precipAtStation"] for h in hist)
        s["historyHours"] = hours
    return {"stations": stations, "fetchedAt": res.fetched_at, "stale": res.stale}


async def fetch_station_history(station: str, hours: int = 120) -> list[dict[str, Any]]:
    res = await fetch(
        "aviationweather",
        config.AVIATIONWEATHER_METAR,
        {"ids": station, "format": "json", "hours": hours},
        ttl=3600,
    )
    raw = res.value if isinstance(res.value, list) else []
    return sorted((normalize(m) for m in raw), key=lambda o: o["observedAt"] or 0)
