"""Adaptador Open-Meteo (https://open-meteo.com/en/docs).

- Forecast API com múltiplos modelos determinísticos (ECMWF IFS, GFS, ICON, UKMO, ARPEGE, GEM).
- Ensemble API (ECMWF ENS, NCEP GEFS, ICON-EPS) para probabilidades reais por membros.
- Previous Runs API para auditoria (previsões emitidas 1–2 dias antes).

Todos os horários são solicitados em `unixtime` (UTC). Unidades padrão: °C, mm, km/h, hPa.
Licença dos dados: CC BY 4.0 — atribuição "Weather data by Open-Meteo.com".

ATENÇÃO: no Brasil as séries `minutely_15` da Open-Meteo são interpoladas a partir de dados horários.
Este adaptador NÃO as utiliza como observação nem como nowcasting.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .. import config
from ..http import fetch

ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"


@dataclass(frozen=True)
class ModelInfo:
    id: str
    name: str
    provider: str
    resolution_km: float  # resolução aproximada sobre o Brasil
    horizon_days: int
    family: str  # modelos da mesma família compartilham análise/física → dependência


DETERMINISTIC_MODELS: list[ModelInfo] = [
    ModelInfo("ecmwf_ifs", "ECMWF IFS", "ECMWF (Europa)", 9, 15, "ecmwf"),
    ModelInfo("gfs_seamless", "NOAA GFS", "NOAA/NCEP (EUA)", 13, 16, "ncep"),
    ModelInfo("icon_seamless", "DWD ICON", "DWD (Alemanha)", 13, 7, "dwd"),
    ModelInfo("ukmo_seamless", "UKMO Global", "Met Office (Reino Unido)", 10, 7, "ukmo"),
    ModelInfo("meteofrance_seamless", "Météo-France ARPEGE", "Météo-France", 25, 4, "meteofrance"),
    ModelInfo("gem_seamless", "ECCC GEM", "ECCC (Canadá)", 15, 10, "eccc"),
]
MODEL_BY_ID = {m.id: m for m in DETERMINISTIC_MODELS}


@dataclass(frozen=True)
class EnsembleInfo:
    id: str
    name: str
    members: int
    resolution_km: float
    time_step_h: int  # passo temporal efetivo dos membros nos primeiros dias
    family: str


ENSEMBLE_MODELS: list[EnsembleInfo] = [
    EnsembleInfo("ecmwf_ifs025", "ECMWF ENS", 51, 25, 3, "ecmwf"),
    EnsembleInfo("gfs025", "NCEP GEFS", 31, 25, 3, "ncep"),
    EnsembleInfo("icon_seamless", "DWD ICON-EPS", 40, 26, 1, "dwd"),
]
ENSEMBLE_BY_ID = {m.id: m for m in ENSEMBLE_MODELS}

HOURLY_VARS = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "precipitation",
    "weather_code",
    "cloud_cover",
    "visibility",
    "pressure_msl",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "cape",
]

CURRENT_VARS = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "precipitation",
    "weather_code",
    "cloud_cover",
    "pressure_msl",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "uv_index",
    "is_day",
]


def _base_params(lat: float, lon: float) -> dict[str, Any]:
    p: dict[str, Any] = {
        "latitude": round(lat, 3),
        "longitude": round(lon, 3),
        "timezone": "auto",
        "timeformat": "unixtime",
        "wind_speed_unit": "kmh",
        "temperature_unit": "celsius",
        "precipitation_unit": "mm",
    }
    if config.OPEN_METEO_API_KEY:
        p["apikey"] = config.OPEN_METEO_API_KEY
    return p


def split_by_model(block: dict[str, list], variables: list[str], models: list[str]) -> dict[str, dict[str, list]]:
    """Separa chaves `temperature_2m_ecmwf_ifs` → {model: {var: série}}.

    Com um único modelo a Open-Meteo não acrescenta sufixo; tratamos esse caso também.
    """
    out: dict[str, dict[str, list]] = {m: {} for m in models}
    for var in variables:
        if len(models) == 1 and var in block:
            out[models[0]][var] = block[var]
            continue
        for m in models:
            key = f"{var}_{m}"
            if key in block:
                out[m][var] = block[key]
    return out


def has_data(series: list | None) -> bool:
    return bool(series) and any(v is not None for v in series)


async def fetch_multimodel(lat: float, lon: float, forecast_days: int = 3) -> dict[str, Any]:
    """Determinísticos só até 72 h (médio prazo): o longo prazo vem dos ensembles. Reduz a cota usada."""
    models = [m.id for m in DETERMINISTIC_MODELS]
    params = _base_params(lat, lon) | {
        "hourly": ",".join(HOURLY_VARS),
        "models": ",".join(models),
        "forecast_days": forecast_days,
        "past_hours": 3,
    }
    res = await fetch("open-meteo", config.OPEN_METEO_FORECAST, params, ttl=1800)
    data = res.value
    hourly = data.get("hourly", {})
    by_model = split_by_model(hourly, HOURLY_VARS, models)
    return {
        "times": hourly.get("time", []),
        "models": by_model,
        "timezone": data.get("timezone", "UTC"),
        "utcOffsetSeconds": data.get("utc_offset_seconds", 0),
        "gridLat": data.get("latitude"),
        "gridLon": data.get("longitude"),
        "elevation": data.get("elevation"),
        "fetchedAt": res.fetched_at,
        "stale": res.stale,
    }


async def fetch_current(lat: float, lon: float) -> dict[str, Any]:
    """Condição atual estimada pelo modelo `best_match` (não é medição)."""
    params = _base_params(lat, lon) | {
        "current": ",".join(CURRENT_VARS),
        "hourly": "uv_index,precipitation_probability",
        "forecast_days": 1,
    }
    res = await fetch("open-meteo", config.OPEN_METEO_FORECAST, params, ttl=900)
    d = res.value
    return {
        "current": d.get("current", {}),
        "hourly": d.get("hourly", {}),
        "timezone": d.get("timezone", "UTC"),
        "utcOffsetSeconds": d.get("utc_offset_seconds", 0),
        "fetchedAt": res.fetched_at,
        "stale": res.stale,
    }


def parse_ensemble(block: dict[str, list], variables: list[str]) -> dict[str, dict[str, list[list]]]:
    """Retorna {suffix_do_modelo: {var: [série_membro0, série_membro1, ...]}}.

    O controle (sem `_memberNN`) é tratado como membro 0. O sufixo retornado pela API
    difere do id solicitado (ex.: `gfs025` → `ncep_gefs025`), por isso agrupamos pelo sufixo.
    """
    out: dict[str, dict[str, dict[int, list]]] = {}
    for key, series in block.items():
        if key == "time":
            continue
        var = next((v for v in sorted(variables, key=len, reverse=True) if key.startswith(v + "_")), None)
        if var is None:
            continue
        rest = key[len(var) + 1 :]
        m = re.match(r"^member(\d+)_(.+)$", rest)
        if m:
            n, suffix = int(m.group(1)), m.group(2)
        else:
            n, suffix = 0, rest
        out.setdefault(suffix, {}).setdefault(var, {})[n] = series
    return {
        s: {v: [mem[k] for k in sorted(mem)] for v, mem in vars_.items()} for s, vars_ in out.items()
    }


SUFFIX_TO_ENSEMBLE = {
    "ecmwf_ifs025_ensemble": "ecmwf_ifs025",
    "ncep_gefs025": "gfs025",
    "icon_seamless_eps": "icon_seamless",
}


def ensemble_id_for_suffix(suffix: str) -> str:
    if suffix in SUFFIX_TO_ENSEMBLE:
        return SUFFIX_TO_ENSEMBLE[suffix]
    for mid in ENSEMBLE_BY_ID:
        if mid in suffix:
            return mid
    return suffix


async def fetch_ensemble_hourly(lat: float, lon: float, forecast_days: int = 3) -> dict[str, Any]:
    variables = ["precipitation", "wind_gusts_10m", "temperature_2m"]
    params = _base_params(lat, lon) | {
        "hourly": ",".join(variables),
        "models": ",".join(m.id for m in ENSEMBLE_MODELS),
        "forecast_days": forecast_days,
    }
    res = await fetch("open-meteo-ensemble", config.OPEN_METEO_ENSEMBLE, params, ttl=3600)
    d = res.value
    block = d.get("hourly", {})
    parsed = parse_ensemble(block, variables)
    return {
        "times": block.get("time", []),
        "ensembles": {ensemble_id_for_suffix(s): v for s, v in parsed.items()},
        "timezone": d.get("timezone", "UTC"),
        "fetchedAt": res.fetched_at,
        "stale": res.stale,
    }


async def fetch_ensemble_daily(lat: float, lon: float, forecast_days: int = 16) -> dict[str, Any]:
    variables = ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "wind_gusts_10m_max"]
    params = _base_params(lat, lon) | {
        "daily": ",".join(variables),
        "models": ",".join(m.id for m in ENSEMBLE_MODELS),
        "forecast_days": forecast_days,
    }
    res = await fetch("open-meteo-ensemble", config.OPEN_METEO_ENSEMBLE, params, ttl=3 * 3600)
    d = res.value
    block = d.get("daily", {})
    parsed = parse_ensemble(block, variables)
    return {
        "times": block.get("time", []),
        "ensembles": {ensemble_id_for_suffix(s): v for s, v in parsed.items()},
        "timezone": d.get("timezone", "UTC"),
        "fetchedAt": res.fetched_at,
        "stale": res.stale,
    }


AUDIT_MODELS = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless", "ukmo_seamless", "gem_seamless"]


async def fetch_previous_runs(lat: float, lon: float, past_days: int = 5) -> dict[str, Any]:
    """Previsões arquivadas: `_previous_dayN` = emitida N dias antes do horário válido."""
    variables = [
        "temperature_2m",
        "temperature_2m_previous_day1",
        "temperature_2m_previous_day2",
        "precipitation_previous_day1",
        "precipitation_previous_day2",
    ]
    params = _base_params(lat, lon) | {
        "hourly": ",".join(variables),
        "models": ",".join(AUDIT_MODELS),
        "past_days": past_days,
        "forecast_days": 1,
    }
    res = await fetch("open-meteo-previous-runs", config.OPEN_METEO_PREVIOUS, params, ttl=6 * 3600)
    d = res.value
    block = d.get("hourly", {})
    return {
        "times": block.get("time", []),
        "models": split_by_model(block, variables, AUDIT_MODELS),
        "fetchedAt": res.fetched_at,
    }


GRID_VARS = [
    "temperature_2m",
    "precipitation",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "pressure_msl",
    "cloud_cover",
]
GRID_MODEL = "ecmwf_ifs025"  # grade regular de 0,25° → células desenhadas na resolução real
GRID_STEP = 0.25


async def fetch_grid(lat0: float, lon0: float, half: int = 3, hours: int = 48) -> dict[str, Any]:
    """Campo espacial real: consulta os pontos da grade 0,25° do ECMWF ao redor (7×7 = 49 pontos).

    Não há interpolação espacial — cada célula representa um ponto de grade do modelo.
    Cada ponto conta como uma chamada na cota da Open-Meteo; o centro é ancorado em 0,5° para
    que usuários próximos compartilhem o cache.
    """
    clat = round(lat0 * 2) / 2
    clon = round(lon0 * 2) / 2
    lats, lons = [], []
    for i in range(-half, half + 1):
        for j in range(-half, half + 1):
            lats.append(round(clat + i * GRID_STEP, 3))
            lons.append(round(clon + j * GRID_STEP, 3))
    params = {
        "latitude": ",".join(map(str, lats)),
        "longitude": ",".join(map(str, lons)),
        "hourly": ",".join(GRID_VARS),
        "models": GRID_MODEL,
        "forecast_hours": hours,
        "timeformat": "unixtime",
        "timezone": "GMT",
        "wind_speed_unit": "kmh",
    }
    if config.OPEN_METEO_API_KEY:
        params["apikey"] = config.OPEN_METEO_API_KEY
    res = await fetch("open-meteo-grid", config.OPEN_METEO_FORECAST, params, ttl=3 * 3600)
    data = res.value if isinstance(res.value, list) else [res.value]
    points = []
    times: list[int] = []
    for d in data:
        h = d.get("hourly", {})
        times = h.get("time", times)
        points.append(
            {
                "lat": d.get("latitude"),
                "lon": d.get("longitude"),
                "values": {v: h.get(v, []) for v in GRID_VARS},
            }
        )
    return {
        "model": GRID_MODEL,
        "step": GRID_STEP,
        "times": times,
        "points": points,
        "fetchedAt": res.fetched_at,
        "stale": res.stale,
    }


async def geocode(name: str, count: int = 8) -> list[dict[str, Any]]:
    params = {"name": name, "count": count, "language": "pt", "format": "json"}
    res = await fetch("open-meteo-geocoding", config.OPEN_METEO_GEOCODING, params, ttl=86400)
    out = []
    for r in res.value.get("results", []) or []:
        label = ", ".join(x for x in [r.get("name"), r.get("admin2"), r.get("admin1"), r.get("country")] if x)
        out.append(
            {
                "name": r.get("name"),
                "label": label,
                "lat": r.get("latitude"),
                "lon": r.get("longitude"),
                "timezone": r.get("timezone"),
                "source": "Open-Meteo Geocoding (GeoNames)",
            }
        )
    return out
