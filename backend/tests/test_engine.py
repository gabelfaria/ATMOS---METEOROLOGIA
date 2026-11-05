"""Testes do Weather Intelligence Engine com respostas reais gravadas."""

import pytest

from atmos.adapters import inmet, metar, openmeteo
from atmos.audit import store
from atmos.engine import consensus, service

LAT, LON = -22.9, -43.2


def adapt_multi(raw):
    models = [m.id for m in openmeteo.DETERMINISTIC_MODELS]
    # o fixture foi gravado com ecmwf_ifs025/jma; mapeamos para a lista atual quando possível
    hourly = dict(raw["hourly"])
    for k in list(hourly):
        if k.endswith("_ecmwf_ifs025"):
            hourly[k.replace("_ecmwf_ifs025", "_ecmwf_ifs")] = hourly[k]
    return {
        "times": hourly["time"],
        "models": openmeteo.split_by_model(hourly, openmeteo.HOURLY_VARS, models),
        "timezone": raw["timezone"],
        "utcOffsetSeconds": raw["utc_offset_seconds"],
        "gridLat": raw["latitude"],
        "gridLon": raw["longitude"],
        "elevation": raw["elevation"],
        "fetchedAt": 0,
        "stale": False,
    }


def adapt_ens(raw, block):
    variables = ["precipitation", "wind_gusts_10m", "temperature_2m"] if block == "hourly" else [
        "temperature_2m_max", "temperature_2m_min", "precipitation_sum", "wind_gusts_10m_max"]
    parsed = openmeteo.parse_ensemble(raw[block], variables)
    return {
        "times": raw[block]["time"],
        "ensembles": {openmeteo.ensemble_id_for_suffix(s): v for s, v in parsed.items()},
        "timezone": raw["timezone"],
        "fetchedAt": 0,
        "stale": False,
    }


@pytest.fixture
def raw(multi, ens_hourly, ens_daily, current, metar_raw, inmet_raw, tmp_path, monkeypatch):
    monkeypatch.setattr(store.config, "DB_PATH", tmp_path / "t.sqlite3")
    obs = [metar.normalize(m, LAT, LON) for m in metar_raw]
    for o in obs:
        o["recentPrecip"] = o["weather"]["precipAtStation"]
    obs.sort(key=lambda o: o["distanceKm"])
    return {
        "multi": adapt_multi(multi),
        "current": {"current": current["current"], "hourly": {}, "timezone": current["timezone"],
                    "utcOffsetSeconds": current["utc_offset_seconds"], "fetchedAt": 0, "stale": False},
        "ensH": adapt_ens(ens_hourly, "hourly"),
        "ensD": adapt_ens(ens_daily, "daily"),
        "nowcast": {"available": False, "reason": "Sem cobertura de radar (teste)"},
        "metar": {"stations": obs, "fetchedAt": 0, "stale": False},
        "inmet": {"alerts": [inmet.normalize(a, "hoje") for a in inmet_raw["hoje"]], "fetchedAt": 0, "stale": False},
        "audit": {"available": False, "reason": "teste"},
    }


def now_of(raw):
    return raw["multi"]["times"][6]


def test_build_without_radar_never_invents_arrival(raw):
    r = service.build(LAT, LON, raw, now=now_of(raw), persist=False)
    v = r["verdict"]
    assert v["estimatedArrivalMinutes"] is None and v["arrivalWindowMinutes"] is None
    assert "indisponível" in v["text"]
    assert v["confidence"] in ("low", "moderate")
    assert v["horizon"] == "0-2h" and v["lastUpdated"] == int(now_of(raw))
    radar_src = next(s for s in r["sources"] if s["id"] == "radar:rainviewer")
    assert radar_src["status"] == "unavailable"


def test_probabilities_are_bounded_and_labeled(raw):
    r = service.build(LAT, LON, raw, now=now_of(raw), persist=False)
    blocks = r["mediumTerm"]["blocks"]
    assert blocks
    for b in blocks:
        assert b["end"] - b["start"] == 3 * 3600
        for k in ("rainProbability", "moderateProbability", "heavyProbability"):
            if b[k] is not None:
                assert 0 <= b[k] <= 1
    if r["verdict"]["rainProbability"] is not None:
        assert r["verdict"]["rainProbabilityKind"] == "ensemble_member_fraction_uncalibrated"


def test_weights_and_consensus_median(raw):
    mm = raw["multi"]
    avail = consensus.available_models(mm)
    assert len(avail) >= 3
    w = consensus.model_weights(avail)
    assert abs(sum(v["normalized"] for v in w.values()) - 1) < 0.01
    hours = consensus.hourly_consensus(mm, w, mm["times"][0], mm["times"][24])
    h = hours[5]
    assert h["temperature"]["min"] <= h["temperature"]["value"] <= h["temperature"]["max"]
    assert h["temperature"]["n"] == len(avail)


def test_skill_changes_weights():
    w0 = consensus.model_weights(["ecmwf_ifs", "gfs_seamless"])
    w1 = consensus.model_weights(
        ["ecmwf_ifs", "gfs_seamless"],
        {"ecmwf_ifs": {"temperatureMae": 1.0, "n": 100}, "gfs_seamless": {"temperatureMae": 2.0, "n": 100}},
    )
    assert w1["ecmwf_ifs"]["normalized"] > w0["ecmwf_ifs"]["normalized"]
    w2 = consensus.model_weights(
        ["ecmwf_ifs", "gfs_seamless"],
        {"ecmwf_ifs": {"temperatureMae": 1.0, "n": 10}, "gfs_seamless": {"temperatureMae": 2.0, "n": 10}},
    )
    assert w2["ecmwf_ifs"]["normalized"] == w0["ecmwf_ifs"]["normalized"]  # amostra pequena: neutro


def test_long_range_confidence_decreases(raw):
    r = service.build(LAT, LON, raw, now=now_of(raw), persist=False)
    days = r["longTerm"]["days"]
    assert len(days) >= 10
    for d in days:
        if d["leadDays"] > 7:
            assert d["confidence"] == "low"
        assert d["tmax"]["p10"] <= d["tmax"]["p50"] <= d["tmax"]["p90"]
    assert r["longTerm"]["beyond16Days"]["available"] is False


def test_model_agreement_rows(raw):
    r = service.build(LAT, LON, raw, now=now_of(raw), persist=False)
    rows = [x for x in r["mediumTerm"]["models"] if x["available"]]
    assert rows and all(x["agreement"] in ("concorda", "parcial", "diverge") for x in rows)


def test_scoreboard_labels_kind(raw):
    r = service.build(LAT, LON, raw, now=now_of(raw), persist=False)
    ids = [t["id"] for t in r["scoreboard"]]
    assert ids[:2] == ["now", "next1h"]
    for t in r["scoreboard"]:
        assert t["kind"] in ("observation", "model", "nowcast", "ensemble", "consensus", "unavailable")


def test_source_failure_is_isolated(raw):
    from atmos.http import SourceError

    now = now_of(raw)
    raw["multi"] = SourceError("open-meteo", "HTTP 429")
    raw["ensH"] = SourceError("open-meteo-ensemble", "HTTP 429")
    r = service.build(LAT, LON, raw, now=now, persist=False)
    assert r["verdict"]["summary"]
    assert any(s["status"] == "error" for s in r["sources"])
    assert r["alerts"]["official"] is not None


def test_estimated_alerts_are_marked(raw):
    r = service.build(LAT, LON, raw, now=now_of(raw), persist=False)
    for a in r["alerts"]["estimated"]:
        assert a["kind"] == "estimated" and a["dedupeKey"] and a["reasons"]
        assert "inunda" not in a["detail"].lower() and "desliza" not in a["detail"].lower()
    for a in r["alerts"]["official"]:
        assert a["kind"] == "official"


def test_persist_and_delete(raw):
    service.build(LAT, LON, raw, now=now_of(raw), persist=True)
    assert store.last_issue_time(LAT, LON) == int(now_of(raw))
    # segunda emissão na mesma hora não é gravada
    assert not store.record_issue(LAT, LON, int(now_of(raw)) + 60, [], {})
    assert store.delete_cell(LAT, LON) > 0
    assert store.last_issue_time(LAT, LON) is None
