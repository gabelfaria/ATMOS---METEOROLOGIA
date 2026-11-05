"""Avaliação de precisão contra OBSERVAÇÕES reais (METAR da estação mais próxima).

1. Previsões arquivadas dos modelos (Open-Meteo Previous Runs API): avaliação imediata, sem esperar
   o app acumular histórico. `previous_dayN` = previsão emitida N dias antes (prazo ≈ N×24 a N×24+23 h).
2. Previsões emitidas pelo próprio ATMOS (SQLite): EAM da temperatura consolidada e Brier Score
   da probabilidade de chuva em blocos de 3 h, assim que houver amostra.

Regras: não declarar "melhor modelo" sem amostra mínima e margem; sempre mostrar o tamanho da amostra.
"""

from __future__ import annotations

import time
from typing import Any

from ..adapters import metar, openmeteo
from ..adapters.openmeteo import MODEL_BY_ID
from ..engine.stats import brier, mae
from ..http import SourceError
from . import store

MIN_SAMPLE_BEST = 72
MIN_MARGIN_C = 0.3
AUDIT_TO_DETERMINISTIC = {"ecmwf_ifs025": "ecmwf_ifs"}  # mesma rodada HRES, saída regradeada a 0,25°

MODEL_NAMES = {
    "ecmwf_ifs025": "ECMWF IFS (0,25°)",
    "gfs_seamless": "NOAA GFS",
    "icon_seamless": "DWD ICON",
    "ukmo_seamless": "UKMO Global",
    "gem_seamless": "ECCC GEM",
}


def _hour(t: int) -> int:
    return (t // 3600) * 3600


def obs_by_hour(history: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Uma observação por hora (a mais próxima do topo da hora, até ±15 min)."""
    out: dict[int, dict[str, Any]] = {}
    for o in history:
        t = o.get("observedAt")
        if not t:
            continue
        h = round(t / 3600) * 3600
        if abs(t - h) > 900:
            continue
        if h not in out or abs(t - h) < abs(out[h]["observedAt"] - h):
            out[h] = o
    return out


def wet_windows(history: list[dict[str, Any]]) -> dict[int, bool]:
    """Bloco de 3 h (UTC) → houve precipitação reportada na estação."""
    out: dict[int, bool] = {}
    for o in history:
        t = o.get("observedAt")
        if not t:
            continue
        b = (t // 10800) * 10800
        out[b] = out.get(b, False) or bool(o["weather"]["precipAtStation"])
    return out


def contingency(pairs: list[tuple[bool, bool]]) -> dict[str, Any]:
    hits = sum(1 for f, o in pairs if f and o)
    misses = sum(1 for f, o in pairs if not f and o)
    fa = sum(1 for f, o in pairs if f and not o)
    cn = sum(1 for f, o in pairs if not f and not o)
    pod = hits / (hits + misses) if hits + misses else None
    far = fa / (hits + fa) if hits + fa else None
    csi = hits / (hits + misses + fa) if hits + misses + fa else None
    return {
        "hits": hits,
        "misses": misses,
        "falseAlarms": fa,
        "correctNegatives": cn,
        "n": len(pairs),
        "pod": None if pod is None else round(pod, 2),
        "far": None if far is None else round(far, 2),
        "csi": None if csi is None else round(csi, 2),
    }


def evaluate_archive(prev: dict[str, Any], history: list[dict[str, Any]], now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    obs_h = obs_by_hour(history)
    wet = wet_windows(history)
    times = prev["times"]
    leads = {"day1": ("temperature_2m_previous_day1", "precipitation_previous_day1"),
             "day2": ("temperature_2m_previous_day2", "precipitation_previous_day2")}
    models_out = []
    for mid, vars_ in prev["models"].items():
        per_lead = {}
        for lead, (tvar, pvar) in leads.items():
            tser = vars_.get(tvar) or []
            pser = vars_.get(pvar) or []
            errs = []
            for i, t in enumerate(times):
                if t > now or i >= len(tser) or tser[i] is None:
                    continue
                o = obs_h.get(_hour(t))
                if o and isinstance(o.get("temperature"), (int, float)):
                    errs.append(tser[i] - o["temperature"])
            # precipitação em blocos de 3 h
            blocks: dict[int, list] = {}
            for i, t in enumerate(times):
                if t > now or i >= len(pser):
                    continue
                b = ((t - 3600) // 10800) * 10800
                blocks.setdefault(b, []).append(pser[i])
            pairs = []
            for b, vs in blocks.items():
                if len(vs) != 3 or any(v is None for v in vs) or b not in wet:
                    continue
                pairs.append((sum(vs) >= 0.5, wet[b]))
            per_lead[lead] = {
                "temperature": {
                    "mae": None if not errs else round(mae(errs), 2),
                    "bias": None if not errs else round(sum(errs) / len(errs), 2),
                    "n": len(errs),
                },
                "precipitation": contingency(pairs),
            }
        if not any(v["temperature"]["n"] for v in per_lead.values()):
            continue
        models_out.append({"model": mid, "name": MODEL_NAMES.get(mid, mid), "leads": per_lead})

    verdict = best_model(models_out, "day1")
    return {"models": models_out, "best": verdict}


def best_model(models: list[dict[str, Any]], lead: str) -> dict[str, Any]:
    ranked = sorted(
        (m for m in models if m["leads"][lead]["temperature"]["mae"] is not None),
        key=lambda m: m["leads"][lead]["temperature"]["mae"],
    )
    if len(ranked) < 2:
        return {"declared": False, "reason": "Modelos insuficientes para comparação"}
    a, b = ranked[0], ranked[1]
    na = a["leads"][lead]["temperature"]["n"]
    margin = b["leads"][lead]["temperature"]["mae"] - a["leads"][lead]["temperature"]["mae"]
    if na < MIN_SAMPLE_BEST:
        return {
            "declared": False,
            "reason": f"Amostra de {na} h é pequena (mínimo {MIN_SAMPLE_BEST} h) para apontar um melhor modelo",
            "leader": a["model"],
        }
    if margin < MIN_MARGIN_C:
        return {
            "declared": False,
            "reason": f"Diferença entre os dois primeiros ({margin:.2f} °C) é pequena demais",
            "leader": a["model"],
        }
    return {
        "declared": True,
        "model": a["model"],
        "name": a["name"],
        "reason": f"Menor erro médio de temperatura (prazo 24–47 h) com margem de {margin:.2f} °C, n={na}",
    }


def evaluate_own(lat: float, lon: float, history: list[dict[str, Any]], now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    obs_h = obs_by_hour(history)
    wet = wet_windows(history)
    temps = store.issued_for_verification(lat, lon, int(now), "temperature")
    by_lead: dict[str, list[float]] = {}
    for r in temps:
        if r["source"] != "atmos":
            continue
        o = obs_h.get(_hour(r["validAt"]))
        if not o or not isinstance(o.get("temperature"), (int, float)):
            continue
        bucket = "0-6h" if r["leadH"] <= 6 else "7-24h" if r["leadH"] <= 24 else "25-48h"
        by_lead.setdefault(bucket, []).append(r["value"] - o["temperature"])
    probs = store.issued_for_verification(lat, lon, int(now), "rain_prob_3h")
    bpairs = []
    for r in probs:
        b = r["validAt"]
        if b + 10800 > now or b not in wet:
            continue
        bpairs.append((r["value"], 1 if wet[b] else 0))
    clim = sum(o for _, o in bpairs) / len(bpairs) if bpairs else None
    bs = brier(bpairs)
    bs_ref = brier([(clim, o) for _, o in bpairs]) if clim is not None else None
    return {
        "temperature": {k: {"mae": round(mae(v), 2), "n": len(v)} for k, v in sorted(by_lead.items())},
        "rainProbability": {
            "brier": None if bs is None else round(bs, 3),
            "brierSkillVsSampleClimatology": None
            if not bs_ref or bs is None
            else round(1 - bs / bs_ref, 2),
            "n": len(bpairs),
        },
    }


async def audit_for_point(lat: float, lon: float, max_km: float = 60) -> dict[str, Any]:
    try:
        near = await metar.fetch_nearby(lat, lon)
    except SourceError as exc:
        return {"available": False, "reason": f"Observações indisponíveis: {exc.message}"}
    stations = [s for s in near["stations"] if s.get("distanceKm", 1e9) <= max_km]
    if not stations:
        return {"available": False, "reason": f"Nenhuma estação METAR a até {max_km:g} km para verificação"}
    st = stations[0]
    try:
        history = await metar.fetch_station_history(st["station"], hours=120)
        prev = await openmeteo.fetch_previous_runs(st["lat"], st["lon"], past_days=5)
    except SourceError as exc:
        return {"available": False, "reason": f"Dados de verificação indisponíveis: {exc.message}"}
    archive = evaluate_archive(prev, history)
    own = evaluate_own(lat, lon, history)
    return {
        "available": True,
        "station": {k: st[k] for k in ("station", "name", "lat", "lon", "distanceKm")},
        "observationsUsed": len(history),
        "periodStart": history[0]["observedAt"] if history else None,
        "periodEnd": history[-1]["observedAt"] if history else None,
        "archive": archive,
        "own": own,
        "notes": [
            "Observação: METAR (medição horária de aeroporto); previsão: ponto de grade mais próximo da estação.",
            "Chuva verificada em blocos de 3 h: METAR registra fenômeno presente, não acumulado em mm.",
            "Amostras curtas (dias) não representam desempenho climatológico.",
        ],
    }


def skill_for_weights(audit: dict[str, Any]) -> dict[str, dict]:
    """Converte a auditoria em fatores de peso por modelo determinístico."""
    out = {}
    if not audit.get("available"):
        return out
    for m in audit["archive"]["models"]:
        t = m["leads"]["day1"]["temperature"]
        det = AUDIT_TO_DETERMINISTIC.get(m["model"], m["model"])
        if det in MODEL_BY_ID and t["mae"] is not None:
            out[det] = {"temperatureMae": t["mae"], "n": t["n"]}
    return out
