"""Radar RainViewer (https://www.rainviewer.com/api/weather-maps-api.html).

- Apenas quadros PASSADOS (últimas ~2 h, passo de 10 min). Quadros futuros (nowcast) não fazem mais
  parte da API pública e não são usados nem simulados.
- O `time` de cada quadro é o horário de GERAÇÃO do mosaico, não necessariamente da varredura.
- Zoom máximo 7. Único esquema de cores disponível: 2 (Universal Blue). Decodificamos dBZ pela
  tabela oficial de cores (data/rainviewer_colors.csv).
- Máscara de cobertura: áreas pretas = sem radar.
"""

from __future__ import annotations

import csv
import io
from functools import lru_cache
from typing import Any

import numpy as np
from PIL import Image

from .. import config
from ..geo import lonlat_to_world_px, meters_per_px, world_px_to_lonlat
from ..http import fetch

ATTRIBUTION = "Radar: RainViewer.com"
COLOR_SCHEME = 2
NO_DATA = -99.0


async def fetch_maps() -> dict[str, Any]:
    res = await fetch("rainviewer", config.RAINVIEWER_MAPS, ttl=120)
    d = res.value
    frames = [
        {"time": f["time"], "path": f["path"]} for f in (d.get("radar", {}) or {}).get("past", []) or []
    ]
    return {
        "host": d.get("host", "https://tilecache.rainviewer.com"),
        "generated": d.get("generated"),
        "frames": frames,
        "nowcastFrames": len((d.get("radar", {}) or {}).get("nowcast", []) or []),
        "fetchedAt": res.fetched_at,
        "stale": res.stale,
    }


@lru_cache(maxsize=1)
def color_table() -> tuple[np.ndarray, np.ndarray]:
    """(cores RGBA Nx4, dBZ N) do esquema Universal Blue, apenas chuva (sem neve)."""
    path = config.DATA_DIR / "rainviewer_colors.csv"
    colors, dbz = [], []
    seen: set[int] = set()
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        col = header.index("Universal Blue")
        for row in reader:
            value = int(row[0])
            if value in seen:  # a segunda metade da tabela é a paleta de neve
                break
            seen.add(value)
            hexv = row[col].lstrip("#")
            rgba = [int(hexv[i : i + 2], 16) for i in (0, 2, 4, 6)]
            if rgba[3] == 0:
                continue
            colors.append(rgba)
            dbz.append(value)
    return np.array(colors, dtype=np.int32), np.array(dbz, dtype=np.float32)


def decode_dbz(png: bytes) -> np.ndarray:
    """PNG RGBA → matriz de dBZ (NO_DATA onde transparente)."""
    img = np.asarray(Image.open(io.BytesIO(png)).convert("RGBA"), dtype=np.int32)
    h, w, _ = img.shape
    flat = img.reshape(-1, 4)
    out = np.full(flat.shape[0], NO_DATA, dtype=np.float32)
    opaque = flat[:, 3] > 0
    if not opaque.any():
        return out.reshape(h, w)
    colors, dbz = color_table()
    uniq, inverse = np.unique(flat[opaque], axis=0, return_inverse=True)
    # cor mais próxima na tabela (exata na prática, pois pedimos sem suavização)
    d2 = ((uniq[:, None, :] - colors[None, :, :]) ** 2).sum(axis=2)
    nearest = d2.argmin(axis=1)
    out[opaque] = dbz[nearest][inverse.ravel()]
    return out.reshape(h, w)


def dbz_to_rain_rate(dbz: float | np.ndarray) -> float | np.ndarray:
    """Marshall–Palmer (Z = 200 R^1.6). Estimativa — não é medição pluviométrica."""
    z = np.power(10.0, np.asarray(dbz, dtype=float) / 10.0)
    return np.power(z / 200.0, 1 / 1.6)


def rain_class(rate_mm_h: float | None) -> str | None:
    if rate_mm_h is None or rate_mm_h < 0.5:
        return None
    if rate_mm_h < 2.5:
        return "fraca"
    if rate_mm_h < 10:
        return "moderada"
    if rate_mm_h < 50:
        return "forte"
    return "muito forte"


class RadarImage:
    """Quadro centrado numa coordenada, com geometria Web Mercator conhecida."""

    def __init__(self, dbz: np.ndarray, center_lat: float, center_lon: float, zoom: int, time: int):
        self.dbz = dbz
        self.center_lat = center_lat
        self.center_lon = center_lon
        self.zoom = zoom
        self.time = time
        self.size = dbz.shape[0]
        # um quadro de 512 px no zoom z cobre a mesma área de um de 256 px (2× resolução)
        self.tile_size = self.size
        self.km_per_px = meters_per_px(center_lat, zoom, self.tile_size) / 1000.0

    def pixel_of(self, lat: float, lon: float) -> tuple[float, float]:
        cx, cy = lonlat_to_world_px(self.center_lon, self.center_lat, self.zoom, self.tile_size)
        x, y = lonlat_to_world_px(lon, lat, self.zoom, self.tile_size)
        return (y - cy) + self.size / 2, (x - cx) + self.size / 2  # (linha, coluna)

    def lonlat_of(self, row: float, col: float) -> tuple[float, float]:
        cx, cy = lonlat_to_world_px(self.center_lon, self.center_lat, self.zoom, self.tile_size)
        return world_px_to_lonlat(cx + col - self.size / 2, cy + row - self.size / 2, self.zoom, self.tile_size)


async def coverage_at(lat: float, lon: float, host: str = "https://tilecache.rainviewer.com") -> dict[str, Any]:
    """Consulta a máscara de cobertura no ponto (pixel central de um tile centrado na coordenada)."""
    url = f"{host}/v2/coverage/0/256/7/{lat:.4f}/{lon:.4f}/0/0_0.png"
    res = await fetch("rainviewer-coverage", url, ttl=7 * 86400, kind="bytes")
    img = np.asarray(Image.open(io.BytesIO(res.value)).convert("RGBA"))
    c = img.shape[0] // 2
    win = img[c - 2 : c + 3, c - 2 : c + 3]
    covered_fraction = float((win[..., 3] < 128).mean())
    # Fração coberta num raio maior (≈100 km) informa se o entorno tem radar
    r = 40
    big = img[max(c - r, 0) : c + r, max(c - r, 0) : c + r]
    return {
        "covered": covered_fraction >= 0.5,
        "pointFraction": covered_fraction,
        "areaFraction": float((big[..., 3] < 128).mean()),
        "source": ATTRIBUTION,
    }


async def fetch_frame(host: str, frame: dict, lat: float, lon: float, zoom: int = 6, size: int = 512) -> RadarImage:
    url = f"{host}{frame['path']}/{size}/{zoom}/{lat:.4f}/{lon:.4f}/{COLOR_SCHEME}/0_0.png"
    res = await fetch("rainviewer-tiles", url, ttl=3 * 3600, kind="bytes")
    return RadarImage(decode_dbz(res.value), lat, lon, zoom, frame["time"])
