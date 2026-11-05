"""Weather Intelligence Engine — orquestração.

Fluxo: coordenadas → descoberta de fontes → validação (idade/qualidade) → normalização →
múltiplos modelos → comparação → observações locais → consolidação → confiança → veredito.
Cada fonte falha de forma isolada: o resultado continua útil e informa o que está indisponível.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from ..adapters import inmet, metar, openmeteo
from ..audit import store, verify
from ..http import SourceError
from ..nowcast import radar
from . import consensus, wmo
from .alerts import estimated_alerts
from .verdict import CONF_PT, build_verdict

OBS_MAX_KM = 25
OBS_MAX_AGE_S = 90 * 60


def _source(id_: str, name: str, kind: str, status: str, message: str | None = None, **kw) -> dict[str, Any]:
    return {"id": id_, "name": name, "kind": kind, "status": status, "message": message, **kw}


async def _safe(coro):
    try:
        return await coro
    except SourceError as exc:
        return exc
    except Exception as exc:  # noqa: BLE001 — uma fonte nunca derruba a resposta
        return SourceError("interno", f"{type(exc).__name__}: {exc}")


async def gather_sources(lat: float, lon: float) -> dict[str, Any]:
    names = ["multi", "current", "ensH", "ensD", "nowcast", "metar", "inmet", "audit"]
    results = await asyncio.gather(
        _safe(openmeteo.fetch_multimodel(lat, lon)),
        _safe(openmeteo.fetch_current(lat, lon)),
        _safe(openmeteo.fetch_ensemble_hourly(lat, lon)),
        _safe(openmeteo.fetch_ensemble_daily(lat, lon)),
        _safe(radar.nowcast(lat, lon)),
        _safe(metar.fetch_nearby(lat, lon)),
        _safe(inmet.fetch_active()),
        _safe(verify.audit_for_point(lat, lon)),
    )
    return dict(zip(names, results))


def build(lat: float, lon: float, raw: dict[str, Any], now: float | None = None, persist: bool = True) -> dict[str, Any]:
    """Montagem pura a partir das respostas brutas (testável com fixtures)."""
    now = now or time.time()
    sources: list[dict[str, Any]] = []

    def ok(x) -> bool:
        return x is not None and not isinstance(x, Exception)

    mm, cur, ens_h, ens_d = raw.get("multi"), raw.get("current"), raw.get("ensH"), raw.get("ensD")
    nc, obs_raw, alerts_raw, audit = raw.get("nowcast"), raw.get("metar"), raw.get("inmet"), raw.get("audit")

    tz = "UTC"
    tz_offset = 0
    for x in (cur, mm):
        if ok(x):
            tz, tz_offset = x["timezone"], x["utcOffsetSeconds"]
            break

    # --- Modelos determinísticos
    weights: dict[str, dict] = {}
    hours: list[dict] = []
    blocks: list[dict] = []
    agreement: list[dict] = []
    skill = verify.skill_for_weights(audit) if ok(audit) else {}
    if ok(mm):
        avail = consensus.available_models(mm)
        weights = consensus.model_weights(avail, skill)
        for m in openmeteo.DETERMINISTIC_MODELS:
            st = "ok" if m.id in avail else "unavailable"
            sources.append(
                _source(
                    f"model:{m.id}",
                    m.name,
                    "model",
                    "stale" if mm["stale"] and st == "ok" else st,
                    None if st == "ok" else "Sem dados para este ponto/horizonte",
                    fetchedAt=mm["fetchedAt"],
                    resolutionKm=m.resolution_km,
                    attribution=openmeteo.ATTRIBUTION,
                )
            )
        hours = consensus.hourly_consensus(mm, weights, int(now) - 3600, int(now) + 48 * 3600)
        blocks = consensus.precip_blocks(mm, ens_h if ok(ens_h) else None, weights, int(now) - 3 * 3600, int(now) + 48 * 3600)
        agreement = consensus.model_agreement(mm, [h for h in hours if h["time"] >= now], blocks, weights)
    else:
        sources.append(_source("models", "Modelos numéricos (Open-Meteo)", "model", "error", getattr(mm, "message", None)))
        if ok(ens_h):  # sem determinísticos, ainda há probabilidades reais dos ensembles
            blocks = consensus.precip_blocks({"times": [], "models": {}}, ens_h, {}, int(now) - 3 * 3600, int(now) + 48 * 3600)

    if ok(ens_h):
        names = ", ".join(openmeteo.ENSEMBLE_BY_ID[e].name for e in ens_h["ensembles"] if e in openmeteo.ENSEMBLE_BY_ID)
        sources.append(
            _source("ensemble:hourly", f"Ensembles 0–72 h ({names})", "ensemble", "stale" if ens_h["stale"] else "ok",
                    fetchedAt=ens_h["fetchedAt"], attribution=openmeteo.ATTRIBUTION)
        )
    else:
        sources.append(_source("ensemble:hourly", "Ensembles 0–72 h", "ensemble", "error", getattr(ens_h, "message", None)))

    # --- Observação local (medição)
    observation = None
    stations = []
    if ok(obs_raw):
        stations = obs_raw["stations"]
        near = [s for s in stations if s.get("distanceKm", 1e9) <= OBS_MAX_KM]
        if near:
            s = near[0]
            age = now - (s["observedAt"] or 0)
            if age <= OBS_MAX_AGE_S:
                observation = s
                sources.append(_source("obs:metar", f"METAR {s['station']} ({s['distanceKm']:.0f} km)", "observation", "ok",
                                       dataTime=s["observedAt"], attribution=metar.ATTRIBUTION))
            else:
                sources.append(_source("obs:metar", f"METAR {s['station']}", "observation", "stale",
                                       f"Última observação há {round(age / 60)} min", dataTime=s["observedAt"]))
        else:
            sources.append(_source("obs:metar", "Estações METAR", "observation", "unavailable",
                                   f"Nenhuma estação a até {OBS_MAX_KM} km"))
    else:
        sources.append(_source("obs:metar", "Estações METAR", "observation", "error", getattr(obs_raw, "message", None)))

    # --- Radar / nowcasting
    if ok(nc):
        if nc.get("available"):
            sources.append(_source("radar:rainviewer", "Radar RainViewer", "radar", "stale" if nc.get("stale") else "ok",
                                   dataTime=nc["latestFrameTime"], attribution="RainViewer.com"))
        else:
            sources.append(_source("radar:rainviewer", "Radar RainViewer", "radar", "unavailable", nc.get("reason")))
    else:
        sources.append(_source("radar:rainviewer", "Radar RainViewer", "radar", "error", getattr(nc, "message", None)))
        nc = {"available": False, "reason": getattr(nc, "message", "erro")}

    # --- Alertas oficiais
    official: list[dict] = []
    if ok(alerts_raw):
        official = inmet.alerts_for_point(alerts_raw["alerts"], lat, lon, now)
        sources.append(_source("alerts:inmet", "Avisos INMET", "official", "stale" if alerts_raw["stale"] else "ok",
                               fetchedAt=alerts_raw["fetchedAt"], attribution=inmet.ATTRIBUTION))
    else:
        sources.append(_source("alerts:inmet", "Avisos INMET", "official", "error", getattr(alerts_raw, "message", None)))

    if ok(ens_d):
        sources.append(_source("ensemble:daily", "Ensembles 16 dias", "ensemble", "stale" if ens_d["stale"] else "ok",
                               fetchedAt=ens_d["fetchedAt"], attribution=openmeteo.ATTRIBUTION))
    else:
        sources.append(_source("ensemble:daily", "Ensembles 16 dias", "ensemble", "error", getattr(ens_d, "message", None)))

    # --- Condição atual
    model_now = None
    if ok(cur):
        c = cur["current"]
        model_now = {
            "kind": "model",
            "source": "Open-Meteo (melhor modelo disponível)",
            "time": c.get("time"),
            "temperature": c.get("temperature_2m"),
            "apparentTemperature": c.get("apparent_temperature"),
            "humidity": c.get("relative_humidity_2m"),
            "precipitation": c.get("precipitation"),
            "weatherCode": c.get("weather_code"),
            "condition": wmo.label(c.get("weather_code")),
            "icon": wmo.icon(c.get("weather_code")),
            "cloudCover": c.get("cloud_cover"),
            "pressure": c.get("pressure_msl"),
            "windSpeed": c.get("wind_speed_10m"),
            "windDirection": c.get("wind_direction_10m"),
            "windGust": c.get("wind_gusts_10m"),
            "uvIndex": c.get("uv_index"),
            "isDay": c.get("is_day"),
        }
        sources.append(_source("model:current", "Condição atual (modelo)", "model", "stale" if cur["stale"] else "ok",
                               dataTime=c.get("time"), attribution=openmeteo.ATTRIBUTION))

    # --- Veredito e avisos
    verdict = build_verdict(now=now, tz_offset=tz_offset, nowcast=nc, observation=observation, blocks=blocks, official=official)

    next24 = [h for h in hours if now <= h["time"] <= now + 24 * 3600]
    b24 = [b for b in blocks if b["end"] > now and b["start"] < now + 24 * 3600]
    temps24 = [h["temperature"]["value"] for h in next24 if h.get("temperature") and h["temperature"]["value"] is not None]
    rain24 = [b["precipMedian"] for b in b24 if b["precipMedian"] is not None]
    probs24 = [b["rainProbability"] for b in b24 if b.get("rainProbability") is not None]
    gust24 = [h["windGust"]["value"] for h in next24 if h.get("windGust") and h["windGust"]["value"] is not None]
    summary24 = {
        "tmax": max(temps24) if temps24 else None,
        "tmin": min(temps24) if temps24 else None,
        "rain24h": round(sum(rain24), 1) if rain24 else None,
        "maxProb24h": max(probs24) if probs24 else None,
        "maxGust24h": max(gust24) if gust24 else None,
    }

    previous = store.previous_summary(lat, lon, int(now) - 1800) if persist else None
    est = estimated_alerts(now=now, tz_offset=tz_offset, nowcast=nc, observation=observation, blocks=blocks,
                           previous=previous, current_summary=summary24)

    scoreboard = _scoreboard(now, model_now, observation, nc, blocks, summary24)

    # --- Médio prazo: confiança por bloco de 6 h
    medium_conf = []
    for b in blocks:
        if b["start"] < now:
            continue
        hs = [h for h in hours if b["start"] < h["time"] <= b["end"]]
        spreads = [h["temperature"]["spread"] for h in hs if h.get("temperature") and h["temperature"]["spread"] is not None]
        lvl, rs = consensus.medium_confidence((b["start"] - now) / 3600 + 1.5, max(spreads) if spreads else None,
                                              b["modelAgreementWet"], b.get("probabilitySpread"))
        medium_conf.append({"start": b["start"], "end": b["end"], "confidence": lvl, "reasons": rs})

    today_start = None
    days = []
    if ok(ens_d) and ens_d["times"]:
        today_start = ens_d["times"][0]
        days = consensus.daily_ensemble(ens_d, today_start)

    result = {
        "location": {
            "lat": lat,
            "lon": lon,
            "timezone": tz,
            "utcOffsetSeconds": tz_offset,
            "elevation": mm.get("elevation") if ok(mm) else None,
            "gridLat": mm.get("gridLat") if ok(mm) else None,
            "gridLon": mm.get("gridLon") if ok(mm) else None,
        },
        "generatedAt": int(now),
        "current": {"model": model_now, "observation": observation, "radar": nc.get("current") if nc.get("available") else None},
        "scoreboard": scoreboard,
        "verdict": verdict,
        "shortTerm": nc,
        "mediumTerm": {
            "hours": hours,
            "blocks": blocks,
            "models": agreement,
            "riskWindows": consensus.risk_windows(blocks, tz_offset),
            "confidence": medium_conf,
            "notes": [
                "Valores consolidados = mediana ponderada entre modelos (não média simples).",
                "Precipitação em blocos de 3 h (passo real dos ensembles ECMWF/GEFS).",
                "Probabilidade = fração de membros dos ensembles (bruta, não calibrada), média entre sistemas.",
                "Concordância entre modelos não é probabilidade.",
            ],
        },
        "longTerm": {
            "days": [d for d in days if d["leadDays"] >= 0],
            "beyond16Days": {
                "available": False,
                "reason": "Tendências além de 16 dias exigem previsão sazonal/subsazonal; integração futura.",
            },
            "notes": [
                "Faixas P10–P90 combinam ECMWF ENS, NCEP GEFS e ICON-EPS com peso igual por sistema.",
                "A confiança é limitada pelo prazo: alta só até 2 dias, baixa após 7 dias.",
            ],
        },
        "alerts": {"official": official, "estimated": est},
        "stations": stations[:8],
        "weights": weights,
        "audit": audit if ok(audit) else {"available": False, "reason": getattr(audit, "message", "indisponível")},
        "sources": sources,
        "attribution": [
            openmeteo.ATTRIBUTION,
            "Radar: RainViewer.com",
            metar.ATTRIBUTION,
            inmet.ATTRIBUTION,
        ],
    }

    if persist and hours:
        _persist(lat, lon, int(now), hours, blocks, summary24)
    return result


def _scoreboard(now, model_now, observation, nc, blocks, s24) -> list[dict[str, Any]]:
    tiles = []
    # AGORA
    if observation and isinstance(observation.get("temperature"), (int, float)):
        cond = ", ".join(d for d in observation["weather"]["description"] if d) or None
        tiles.append({
            "id": "now", "label": "AGORA", "value": observation["temperature"], "unit": "°C",
            "caption": cond or (model_now or {}).get("condition"),
            "kind": "observation", "source": f"METAR {observation['station']}", "time": observation["observedAt"],
        })
    elif model_now:
        tiles.append({
            "id": "now", "label": "AGORA", "value": model_now["temperature"], "unit": "°C",
            "caption": model_now["condition"], "kind": "model", "source": model_now["source"], "time": model_now["time"],
        })
    if nc and nc.get("available") and nc["current"].get("class") and tiles:
        tiles[0]["caption"] = f"Chuva {nc['current']['class']} (radar)"

    # PRÓXIMA HORA
    if nc and nc.get("available") and nc.get("forecast"):
        first = [s for s in nc["forecast"] if s["lead"] <= 60]
        classes = [s["class"] for s in first if s["class"]]
        order = ["fraca", "moderada", "forte", "muito forte"]
        worst = max(classes, key=order.index) if classes else None
        if nc.get("arrival"):
            tiles.append({"id": "next1h", "label": "PRÓXIMA HORA", "value": nc["arrival"]["centralMinutes"], "unit": "min",
                          "caption": f"Chuva {nc['arrival']['maxClass'] or 'fraca'} chegando", "kind": "nowcast",
                          "source": "Radar RainViewer (extrapolação)", "time": nc["latestFrameTime"],
                          "confidence": nc["confidence"]})
        else:
            tiles.append({"id": "next1h", "label": "PRÓXIMA HORA", "value": None, "unit": None,
                          "text": f"CHUVA {worst.upper()}" if worst else "SEM CHUVA",
                          "caption": "Extrapolação do radar", "kind": "nowcast",
                          "source": "Radar RainViewer (extrapolação)", "time": nc["latestFrameTime"],
                          "confidence": nc["confidence"]})
    else:
        b = next((b for b in blocks if b["end"] > now + 1800), None)
        if b and b.get("rainProbability") is not None:
            tiles.append({"id": "next1h", "label": "PRÓXIMA HORA", "value": round(b["rainProbability"] * 100), "unit": "%",
                          "caption": "Chance de chuva (ensemble, bloco 3 h)", "kind": "ensemble",
                          "source": "Ensembles Open-Meteo", "time": b["start"]})
        else:
            tiles.append({"id": "next1h", "label": "PRÓXIMA HORA", "value": None, "unit": None, "text": "INDISPONÍVEL",
                          "caption": "Sem radar nem ensemble", "kind": "unavailable", "source": None, "time": None})

    # PRÓXIMAS 24H
    if s24["tmax"] is not None:
        rain = s24["rain24h"]
        prob = s24["maxProb24h"]
        cap = []
        if rain is not None:
            cap.append(f"Chuva {rain:.0f} mm")
        if prob is not None:
            cap.append(f"chance máx. {round(prob * 100)}%")
        tiles.append({"id": "next24h", "label": "PRÓXIMAS 24H", "value": round(s24["tmax"]), "value2": round(s24["tmin"]),
                      "unit": "°C", "caption": " · ".join(cap) or None, "kind": "consensus",
                      "source": "Consenso de modelos + ensembles", "time": None})
    return tiles


def _persist(lat, lon, now, hours, blocks, s24) -> None:
    rows = []
    for h in hours:
        lead = round((h["time"] - now) / 3600)
        if lead < 1 or lead > 48:
            continue
        t = h.get("temperature")
        if t and t["value"] is not None:
            rows.append((h["time"], lead, "temperature", "atmos", t["value"]))
    for b in blocks:
        lead = round((b["start"] - now) / 3600)
        if b["start"] < now or b.get("rainProbability") is None:
            continue
        rows.append((b["start"], max(lead, 0), "rain_prob_3h", "atmos", b["rainProbability"]))
    try:
        store.record_issue(lat, lon, now, rows, s24)
    except Exception:  # noqa: BLE001 — persistência nunca derruba a previsão
        pass


async def forecast(lat: float, lon: float) -> dict[str, Any]:
    raw = await gather_sources(lat, lon)
    return build(lat, lon, raw)


__all__ = ["forecast", "build", "gather_sources", "CONF_PT"]
