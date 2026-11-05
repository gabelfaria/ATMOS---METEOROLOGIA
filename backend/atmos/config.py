"""Configuração via variáveis de ambiente (nenhuma chave privada vai para o frontend)."""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

USER_AGENT = os.getenv(
    "ATMOS_USER_AGENT",
    "ATMOS-Weather/0.1 (+https://github.com/gabelfaria/ATMOS---METEOROLOGIA)",
)

# Banco SQLite do histórico/auditoria. Guarda apenas células de ~0,1° (≈11 km), nunca o ponto exato.
DB_PATH = Path(os.getenv("ATMOS_DB_PATH", str(BASE_DIR.parent / "atmos.sqlite3")))

# Diretório com o build do frontend (servido pelo FastAPI em produção).
STATIC_DIR = Path(os.getenv("ATMOS_STATIC_DIR", str(BASE_DIR.parent.parent / "web" / "dist")))

# Endpoints públicos documentados
OPEN_METEO_FORECAST = os.getenv("OPEN_METEO_FORECAST", "https://api.open-meteo.com/v1/forecast")
OPEN_METEO_ENSEMBLE = os.getenv("OPEN_METEO_ENSEMBLE", "https://ensemble-api.open-meteo.com/v1/ensemble")
OPEN_METEO_PREVIOUS = os.getenv("OPEN_METEO_PREVIOUS", "https://previous-runs-api.open-meteo.com/v1/forecast")
OPEN_METEO_GEOCODING = os.getenv("OPEN_METEO_GEOCODING", "https://geocoding-api.open-meteo.com/v1/search")
# Chave opcional para o plano comercial da Open-Meteo (nunca exposta ao cliente)
OPEN_METEO_API_KEY = os.getenv("OPEN_METEO_API_KEY", "")

RAINVIEWER_MAPS = "https://api.rainviewer.com/public/weather-maps.json"
AVIATIONWEATHER_METAR = "https://aviationweather.gov/api/data/metar"
INMET_AVISOS = "https://apiprevmet3.inmet.gov.br/avisos/ativos"
NOMINATIM = "https://nominatim.openstreetmap.org"
GIBS_WMTS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"

HTTP_TIMEOUT = float(os.getenv("ATMOS_HTTP_TIMEOUT", "20"))
