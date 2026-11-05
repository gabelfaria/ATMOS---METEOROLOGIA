"""Teste de ponta a ponta da API, totalmente offline (MockTransport servindo respostas reais gravadas)."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from atmos import http as atmos_http
from atmos.audit import store

from .conftest import FIX, load, to_unix, transparent_png


def _om_unix(name):
    return to_unix(load(name))


def handler(request: httpx.Request) -> httpx.Response:
    url = request.url
    host = url.host
    q = dict(url.params)
    if host == "api.open-meteo.com":
        if "current" in q:
            return httpx.Response(200, json=_om_unix("current.json"))
        data = _om_unix("multi.json")
        # renomeia ecmwf_ifs025 → ecmwf_ifs (o fixture é anterior à troca de modelo)
        data["hourly"] = {k.replace("_ecmwf_ifs025", "_ecmwf_ifs"): v for k, v in data["hourly"].items()}
        return httpx.Response(200, json=data)
    if host == "ensemble-api.open-meteo.com":
        return httpx.Response(200, json=_om_unix("ensh.json" if "hourly" in q else "ens_daily.json"))
    if host == "previous-runs-api.open-meteo.com":
        return httpx.Response(200, json=_om_unix("prev.json"))
    if host == "aviationweather.gov":
        return httpx.Response(200, json=load("metar.json"))
    if host == "apiprevmet3.inmet.gov.br":
        return httpx.Response(200, content=(FIX / "inmet_avisos.json").read_bytes())
    if host == "api.rainviewer.com":
        return httpx.Response(200, json={"version": "2.0", "host": "https://tilecache.rainviewer.com",
                                         "radar": {"past": [{"time": 1793853000, "path": "/v2/radar/a"},
                                                            {"time": 1793853600, "path": "/v2/radar/b"}],
                                                   "nowcast": []}})
    if host == "tilecache.rainviewer.com":
        if "/coverage/" in url.path:
            return httpx.Response(200, content=transparent_png())  # transparente = coberto
        return httpx.Response(200, content=(FIX / "radar_z7_512.png").read_bytes())
    if host == "geocoding-api.open-meteo.com":
        return httpx.Response(200, json={"results": [{"name": "Niterói", "latitude": -22.88, "longitude": -43.10,
                                                      "admin1": "Rio de Janeiro", "country": "Brasil",
                                                      "timezone": "America/Sao_Paulo"}]})
    return httpx.Response(404)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store.config, "DB_PATH", tmp_path / "api.sqlite3")
    atmos_http.set_transport(httpx.MockTransport(handler))
    from atmos.main import app

    with TestClient(app) as c:
        yield c
    atmos_http.set_transport(None)


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_forecast_end_to_end(client):
    r = client.get("/api/forecast", params={"lat": -22.9, "lon": -43.2})
    assert r.status_code == 200
    d = r.json()
    for key in ("location", "verdict", "scoreboard", "shortTerm", "mediumTerm", "longTerm", "alerts", "sources"):
        assert key in d
    assert d["location"]["timezone"] == "America/Sao_Paulo"
    assert d["shortTerm"]["available"] is True  # radar real decodificado do fixture
    assert d["shortTerm"]["stepMinutes"] == 10
    assert d["verdict"]["confidence"] in ("low", "moderate", "high")
    assert all(s["status"] in ("ok", "stale", "unavailable", "error") for s in d["sources"])
    json.dumps(d)  # serializável


def test_geocode_coordinates_and_names(client):
    r = client.get("/api/geocode", params={"q": "-22,9; -43,2"}).json()
    assert r["results"][0]["lat"] == -22.9 and r["results"][0]["lon"] == -43.2
    r = client.get("/api/geocode", params={"q": "Niterói"}).json()
    assert r["results"][0]["name"] == "Niterói"


def test_sources_catalog(client):
    d = client.get("/api/sources").json()
    status = {s["id"]: s["status"] for s in d["sources"]}
    assert status["inea"] == "blocked" and status["cemaden"] == "blocked"
    assert status["rainviewer"] == "integrated"


def test_validation(client):
    assert client.get("/api/forecast", params={"lat": 200, "lon": 0}).status_code == 422


def test_upstream_failure_still_answers(client):
    atmos_http.set_transport(httpx.MockTransport(lambda req: httpx.Response(503)))
    r = client.get("/api/forecast", params={"lat": -10.0, "lon": -50.0})
    assert r.status_code == 200
    d = r.json()
    assert any(s["status"] == "error" for s in d["sources"])
    assert d["verdict"]["estimatedArrivalMinutes"] is None
