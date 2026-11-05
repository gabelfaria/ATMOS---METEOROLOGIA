"""Utilidades geográficas puras (sem dependências pesadas)."""

from __future__ import annotations

import math

EARTH_RADIUS_KM = 6371.0088

COMPASS_PT = [
    "norte", "nor-nordeste", "nordeste", "leste-nordeste",
    "leste", "leste-sudeste", "sudeste", "sul-sudeste",
    "sul", "sul-sudoeste", "sudoeste", "oés-sudoeste",
    "oeste", "oés-noroeste", "noroeste", "nor-noroeste",
]
COMPASS_8 = ["norte", "nordeste", "leste", "sudeste", "sul", "sudoeste", "oeste", "noroeste"]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Azimute de (1) para (2), em graus a partir do norte, sentido horário."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def compass8(deg: float) -> str:
    return COMPASS_8[int(((deg % 360) + 22.5) // 45) % 8]


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    """Ray casting. `ring` em [lon, lat]."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
            if lon < x_cross:
                inside = not inside
        j = i
    return inside


def point_in_geometry(lon: float, lat: float, geom: dict) -> bool:
    """Suporta Polygon e MultiPolygon GeoJSON (com buracos)."""
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    polys = [coords] if gtype == "Polygon" else coords if gtype == "MultiPolygon" else []
    for poly in polys:
        if not poly:
            continue
        if point_in_ring(lon, lat, poly[0]) and not any(point_in_ring(lon, lat, h) for h in poly[1:]):
            return True
    return False


# --- Web Mercator ---------------------------------------------------------

def lonlat_to_world_px(lon: float, lat: float, zoom: int, tile_size: int = 256) -> tuple[float, float]:
    scale = tile_size * (2**zoom)
    x = (lon + 180.0) / 360.0 * scale
    s = math.sin(math.radians(max(min(lat, 85.0511), -85.0511)))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * scale
    return x, y


def world_px_to_lonlat(x: float, y: float, zoom: int, tile_size: int = 256) -> tuple[float, float]:
    scale = tile_size * (2**zoom)
    lon = x / scale * 360.0 - 180.0
    n = math.pi - 2 * math.pi * y / scale
    lat = math.degrees(math.atan(math.sinh(n)))
    return lon, lat


def meters_per_px(lat: float, zoom: int, tile_size: int = 256) -> float:
    return math.cos(math.radians(lat)) * 2 * math.pi * 6378137 / (tile_size * 2**zoom)


def round_cell(lat: float, lon: float, step: float = 0.1) -> tuple[float, float]:
    """Arredonda para uma célula (privacidade + compartilhamento de cache)."""
    return round(round(lat / step) * step, 4), round(round(lon / step) * step, 4)
