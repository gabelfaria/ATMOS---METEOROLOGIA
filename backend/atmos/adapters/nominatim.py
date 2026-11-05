"""Geocodificação de endereços/bairros e geocodificação reversa via Nominatim (OpenStreetMap).

Política de uso respeitada: User-Agent identificável, no máximo 1 requisição/s, cache agressivo,
nenhuma busca a cada tecla (só ao confirmar a busca). Dados © OpenStreetMap contributors (ODbL).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from .. import config
from ..http import fetch

ATTRIBUTION = "© OpenStreetMap contributors (Nominatim)"
_lock = asyncio.Lock()
_last = 0.0


async def _throttle() -> None:
    global _last
    async with _lock:
        wait = 1.05 - (time.time() - _last)
        if wait > 0:
            await asyncio.sleep(wait)
        _last = time.time()


async def search(q: str, limit: int = 6) -> list[dict[str, Any]]:
    await _throttle()
    res = await fetch(
        "nominatim",
        f"{config.NOMINATIM}/search",
        {"q": q, "format": "jsonv2", "limit": limit, "accept-language": "pt-BR", "addressdetails": 1},
        ttl=7 * 86400,
    )
    out = []
    for r in res.value or []:
        out.append(
            {
                "name": r.get("name") or r.get("display_name", "").split(",")[0],
                "label": r.get("display_name"),
                "lat": float(r["lat"]),
                "lon": float(r["lon"]),
                "timezone": None,
                "source": ATTRIBUTION,
            }
        )
    return out


async def reverse(lat: float, lon: float) -> dict[str, Any] | None:
    # arredonda (~1 km) para privacidade e para reaproveitar cache
    lat_r, lon_r = round(lat, 2), round(lon, 2)
    await _throttle()
    res = await fetch(
        "nominatim",
        f"{config.NOMINATIM}/reverse",
        {"lat": lat_r, "lon": lon_r, "format": "jsonv2", "zoom": 14, "accept-language": "pt-BR"},
        ttl=30 * 86400,
    )
    d = res.value or {}
    a = d.get("address", {}) or {}
    locality = a.get("suburb") or a.get("neighbourhood") or a.get("city_district") or a.get("village")
    city = a.get("city") or a.get("town") or a.get("municipality")
    state = a.get("state")
    parts = [p for p in (locality, city, state) if p]
    if not parts:
        return None
    return {"label": ", ".join(dict.fromkeys(parts)), "city": city, "state": state, "source": ATTRIBUTION}
