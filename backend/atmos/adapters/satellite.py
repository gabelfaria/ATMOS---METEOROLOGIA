"""Imagens do GOES-19 (posição GOES-East) via NASA GIBS (WMTS, Web Mercator).

O GOES-19 assumiu a posição operacional GOES-East em 2025; o GIBS publica as bandas ABI dessa posição
como camadas `GOES-East_*`, com passo de 10 min. Usamos DescribeDomains para obter apenas horários
EXISTENTES (há lacunas), sem inferir quadros.

Alternativa nacional (INPE/CPTEC, data.inpe.br/dados/goes e DSAT): os arquivos são disponibilizados
como imagens/NetCDF em diretórios, sem serviço de tiles documentado para mapas; fica como integração
futura via backend (conversão para tiles) — ver docs/FONTES.md.
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from .. import config
from ..http import fetch

ATTRIBUTION = "GOES-19 ABI (NOAA) via NASA GIBS/Worldview"

LAYERS = {
    "satellite_visible": {
        "layer": "GOES-East_ABI_Band2_Red_Visible_1km",
        "matrix": "GoogleMapsCompatible_Level7",
        "maxZoom": 7,
        "name": "Satélite visível (GOES-19, banda 2)",
        "unit": "refletância",
        "resolution": "1 km (nadir)",
        "note": "Só tem informação durante o dia.",
    },
    "satellite_infrared": {
        "layer": "GOES-East_ABI_Band13_Clean_Infrared",
        "matrix": "GoogleMapsCompatible_Level6",
        "maxZoom": 6,
        "name": "Satélite infravermelho (GOES-19, banda 13)",
        "unit": "temperatura de brilho",
        "resolution": "2 km (nadir)",
        "note": "Topos de nuvens mais frios (claros) indicam nuvens mais altas/convectivas.",
    },
    "satellite_geocolor": {
        "layer": "GOES-East_ABI_GeoColor",
        "matrix": "GoogleMapsCompatible_Level7",
        "maxZoom": 7,
        "name": "Nuvens — GeoColor (GOES-19)",
        "unit": "composição colorida",
        "resolution": "1–2 km",
        "note": "Composição dia/noite para visualizar a nebulosidade.",
    },
}

_DOMAIN_RE = re.compile(r"<Domain>(.*?)</Domain>", re.S)


def _parse_iso(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def expand_domain(domain: str, start: datetime, end: datetime) -> list[int]:
    """'a/b/PT10M,c/d/PT10M' → lista de epochs dentro de [start, end]."""
    out = []
    for part in domain.split(","):
        part = part.strip()
        if not part:
            continue
        pieces = part.split("/")
        if len(pieces) == 1:
            t = _parse_iso(pieces[0])
            if start <= t <= end:
                out.append(int(t.timestamp()))
            continue
        a, b = _parse_iso(pieces[0]), _parse_iso(pieces[1])
        m = re.match(r"PT(\d+)M", pieces[2] if len(pieces) > 2 else "PT10M")
        step = timedelta(minutes=int(m.group(1)) if m else 10)
        t = a
        while t <= b:
            if start <= t <= end:
                out.append(int(t.timestamp()))
            t += step
    return sorted(set(out))


async def available_times(layer_id: str, hours: int = 3) -> dict[str, Any]:
    meta = LAYERS[layer_id]
    end = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = end - timedelta(hours=hours)
    # granularidade de 10 min no URL para reaproveitar cache
    end_q = end - timedelta(minutes=end.minute % 10)
    url = (
        f"{config.GIBS_WMTS}/1.0.0/{meta['layer']}/default/{meta['matrix']}/all/"
        f"{start.strftime('%Y-%m-%dT%H:%M:00Z')}--{end_q.strftime('%Y-%m-%dT%H:%M:00Z')}.xml"
    )
    res = await fetch("gibs", url, ttl=300, kind="text")
    m = _DOMAIN_RE.search(res.value or "")
    times = expand_domain(m.group(1), start, end) if m else []
    return {
        "id": layer_id,
        **meta,
        "times": times,
        "tileTemplate": f"{config.GIBS_WMTS}/{meta['layer']}/default/{{time}}/{meta['matrix']}/{{z}}/{{y}}/{{x}}.png",
        "attribution": ATTRIBUTION,
        "fetchedAt": res.fetched_at,
        "checkedAt": int(time.time()),
    }
