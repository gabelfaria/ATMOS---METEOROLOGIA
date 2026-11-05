"""API HTTP do ATMOS (FastAPI). Em produção também serve o PWA compilado (web/dist)."""

from __future__ import annotations

import re
import time

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, config
from .adapters import inmet, metar, nominatim, openmeteo, rainviewer, registry, satellite
from .audit import store, verify
from .engine import service
from .http import SourceError
from .nowcast import radar

app = FastAPI(title="ATMOS — Inteligência Meteorológica Local", version=__version__)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "DELETE"], allow_headers=["*"])

Lat = Query(..., ge=-90, le=90)
Lon = Query(..., ge=-180, le=180)


def _err(exc: SourceError) -> HTTPException:
    return HTTPException(status_code=502, detail={"source": exc.source, "message": exc.message})


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": __version__, "time": int(time.time())}


@app.get("/api/forecast")
async def forecast(lat: float = Lat, lon: float = Lon):
    """Previsão consolidada completa (os três horizontes + veredito + alertas + fontes)."""
    return await service.forecast(round(lat, 3), round(lon, 3))


@app.get("/api/nowcast")
async def nowcast(lat: float = Lat, lon: float = Lon):
    return await radar.nowcast(round(lat, 3), round(lon, 3))


@app.get("/api/observations")
async def observations(lat: float = Lat, lon: float = Lon):
    try:
        return await metar.fetch_nearby(lat, lon, radius_deg=1.5)
    except SourceError as exc:
        raise _err(exc) from exc


@app.get("/api/alerts")
async def alerts(lat: float = Lat, lon: float = Lon):
    try:
        data = await inmet.fetch_active()
    except SourceError as exc:
        raise _err(exc) from exc
    return {"official": inmet.alerts_for_point(data["alerts"], lat, lon), "fetchedAt": data["fetchedAt"]}


@app.get("/api/alerts/geojson")
async def alerts_geojson():
    try:
        data = await inmet.fetch_active()
    except SourceError as exc:
        raise _err(exc) from exc
    return inmet.to_geojson(data["alerts"])


@app.get("/api/radar/frames")
async def radar_frames():
    try:
        return await rainviewer.fetch_maps()
    except SourceError as exc:
        raise _err(exc) from exc


@app.get("/api/radar/coverage")
async def radar_coverage(lat: float = Lat, lon: float = Lon):
    try:
        return await rainviewer.coverage_at(lat, lon)
    except SourceError as exc:
        raise _err(exc) from exc


@app.get("/api/satellite/{layer_id}")
async def satellite_times(layer_id: str):
    if layer_id not in satellite.LAYERS:
        raise HTTPException(404, "camada desconhecida")
    try:
        return await satellite.available_times(layer_id)
    except SourceError as exc:
        raise _err(exc) from exc


@app.get("/api/grid")
async def grid(lat: float = Lat, lon: float = Lon):
    """Campo espacial real de modelo (pontos de grade ECMWF 0,25°) para as camadas do mapa."""
    try:
        return await openmeteo.fetch_grid(lat, lon)
    except SourceError as exc:
        raise _err(exc) from exc


_COORD = re.compile(r"^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$")


@app.get("/api/geocode")
async def geocode(q: str = Query(..., min_length=2, max_length=200)):
    m = _COORD.match(q)
    if m:
        lat, lon = float(m.group(1).replace(",", ".")), float(m.group(2).replace(",", "."))
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            return {"results": [{"name": "Coordenadas", "label": f"{lat:.4f}, {lon:.4f}", "lat": lat, "lon": lon,
                                 "source": "entrada manual"}]}
    results: list[dict] = []
    errors = []
    try:
        results = await openmeteo.geocode(q)
    except SourceError as exc:
        errors.append(exc.message)
    # Endereços e bairros: Nominatim (só quando a busca por cidade não resolve ou parece endereço)
    looks_like_address = any(ch.isdigit() for ch in q) or "," in q or len(results) == 0
    if looks_like_address:
        try:
            results = (await nominatim.search(q)) + results
        except SourceError as exc:
            errors.append(exc.message)
    return {"results": results[:10], "errors": errors}


@app.get("/api/reverse")
async def reverse(lat: float = Lat, lon: float = Lon):
    try:
        return await nominatim.reverse(lat, lon) or {"label": None}
    except SourceError:
        return {"label": None}


@app.get("/api/audit")
async def audit(lat: float = Lat, lon: float = Lon):
    return await verify.audit_for_point(lat, lon)


@app.get("/api/sources")
async def sources():
    return {"sources": registry.SOURCES, "models": [m.__dict__ for m in openmeteo.DETERMINISTIC_MODELS],
            "ensembles": [m.__dict__ for m in openmeteo.ENSEMBLE_MODELS]}


@app.delete("/api/privacy")
async def delete_data(lat: float = Lat, lon: float = Lon):
    """Remove o histórico armazenado para a célula (~11 km) da coordenada."""
    n = store.delete_cell(lat, lon)
    return {"deletedRows": n}


# --- PWA estático ------------------------------------------------------------
if config.STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=config.STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse({"detail": "não encontrado"}, status_code=404)
        f = (config.STATIC_DIR / path).resolve()
        if path and f.is_file() and config.STATIC_DIR.resolve() in f.parents:
            headers = {"Cache-Control": "no-cache"} if path in ("sw.js", "manifest.webmanifest") else None
            return FileResponse(f, headers=headers)
        return FileResponse(config.STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})
