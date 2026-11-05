"""Consenso entre modelos determinísticos + probabilidades de ensembles.

Princípios:
- Nada de média aritmética simples: usamos MEDIANA PONDERADA (robusta a um modelo discrepante),
  com pesos explícitos por resolução, dependência entre modelos (família) e desempenho local medido.
- "Concordância entre modelos" NÃO é probabilidade. Probabilidades vêm apenas dos ensembles
  (fração de membros), identificadas como brutas/não calibradas.
- A precipitação é agregada em blocos de 3 h porque ECMWF ENS/GEFS têm passo de 3 h; mostrar
  valores horários desses sistemas seria apresentar desagregação como dado.
"""

from __future__ import annotations

import math
from typing import Any

from ..adapters.openmeteo import DETERMINISTIC_MODELS, ENSEMBLE_BY_ID, MODEL_BY_ID
from .stats import circular_mean_deg, weighted_median, weighted_quantile, weighted_std

BLOCK_S = 3 * 3600

# Limiares de precipitação (classes usuais: fraca <2,5 mm/h; moderada 2,5–10; forte 10–50)
P_ANY_3H = 0.5  # mm/3 h  → "chuva"
P_MOD_3H = 7.5  # mm/3 h  ≈ 2,5 mm/h médio
P_HEAVY_3H = 30.0  # mm/3 h ≈ 10 mm/h médio
GUST_STRONG = 60.0  # km/h
CAPE_STORM = 1000.0  # J/kg


# ---------------------------------------------------------------------------
# Pesos


def model_weights(available: list[str], skill: dict[str, dict] | None = None) -> dict[str, dict[str, Any]]:
    """Peso = prior de resolução × fator de dependência × fator de desempenho local (se houver amostra)."""
    fam_count: dict[str, int] = {}
    for mid in available:
        fam_count[MODEL_BY_ID[mid].family] = fam_count.get(MODEL_BY_ID[mid].family, 0) + 1

    skill = skill or {}
    maes = [s["temperatureMae"] for s in skill.values() if s.get("temperatureMae") is not None and s.get("n", 0) >= 48]
    ref_mae = sorted(maes)[len(maes) // 2] if maes else None

    out: dict[str, dict[str, Any]] = {}
    for mid in available:
        info = MODEL_BY_ID[mid]
        reasons = []
        if info.resolution_km <= 13:
            prior = 1.0
        elif info.resolution_km <= 16:
            prior = 0.85
        else:
            prior = 0.65
        reasons.append(f"resolução ~{info.resolution_km:g} km → {prior:.2f}")
        dep = 1.0 / fam_count[info.family]
        if dep < 1:
            reasons.append(f"mesma família de outro modelo ({info.family}) → ×{dep:.2f}")
        perf = 1.0
        s = skill.get(mid)
        if s and ref_mae and s.get("temperatureMae") and s.get("n", 0) >= 48:
            perf = max(0.5, min(1.5, ref_mae / s["temperatureMae"]))
            reasons.append(f"desempenho local (EAM {s['temperatureMae']:.1f} °C, n={s['n']}) → ×{perf:.2f}")
        else:
            reasons.append("sem amostra local suficiente → desempenho neutro")
        out[mid] = {"weight": round(prior * dep * perf, 3), "reasons": reasons}
    total = sum(v["weight"] for v in out.values()) or 1
    for v in out.values():
        v["normalized"] = round(v["weight"] / total, 3)
    return out


# ---------------------------------------------------------------------------
# Utilidades de séries


def _index(times: list[int]) -> dict[int, int]:
    return {t: i for i, t in enumerate(times)}


def _val(series: list | None, i: int | None):
    if series is None or i is None or i >= len(series):
        return None
    return series[i]


def available_models(mm: dict[str, Any]) -> list[str]:
    out = []
    for m in DETERMINISTIC_MODELS:
        s = mm["models"].get(m.id, {}).get("temperature_2m")
        if s and any(v is not None for v in s):
            out.append(m.id)
    return out


def block_start(stamp: int) -> int:
    """Hora rotulada `stamp` acumula a hora anterior → bloco de 3 h (UTC) correspondente."""
    return ((stamp - 3600) // BLOCK_S) * BLOCK_S


# ---------------------------------------------------------------------------
# Consenso horário


HOURLY_FIELDS = {
    "temperature": "temperature_2m",
    "apparentTemperature": "apparent_temperature",
    "humidity": "relative_humidity_2m",
    "cloudCover": "cloud_cover",
    "visibility": "visibility",
    "pressure": "pressure_msl",
    "windSpeed": "wind_speed_10m",
    "windGust": "wind_gusts_10m",
    "cape": "cape",
}


def hourly_consensus(mm: dict[str, Any], weights: dict[str, dict], start: int, end: int) -> list[dict[str, Any]]:
    idx = _index(mm["times"])
    out = []
    for t in mm["times"]:
        if t < start or t > end:
            continue
        i = idx[t]
        row: dict[str, Any] = {"time": t}
        for field, var in HOURLY_FIELDS.items():
            vals, ws = [], []
            for mid, w in weights.items():
                v = _val(mm["models"].get(mid, {}).get(var), i)
                if v is not None:
                    vals.append(float(v))
                    ws.append(w["weight"])
            if not vals:
                row[field] = None
                continue
            med = weighted_median(vals, ws)
            row[field] = {
                "value": None if med is None else round(med, 1),
                "min": round(min(vals), 1),
                "max": round(max(vals), 1),
                "spread": None if len(vals) < 2 else round(weighted_std(vals, ws) or 0, 1),
                "n": len(vals),
            }
            if field == "visibility" and row[field]["value"] is not None:
                for k in ("value", "min", "max", "spread"):
                    if row[field][k] is not None:
                        row[field][k] = round(row[field][k] / 1000, 1)  # m → km
        dirs, ws = [], []
        for mid, w in weights.items():
            v = _val(mm["models"].get(mid, {}).get("wind_direction_10m"), i)
            if v is not None:
                dirs.append(float(v))
                ws.append(w["weight"])
        d = circular_mean_deg(dirs, ws)
        row["windDirection"] = None if d is None else round(d)
        out.append(row)
    return out


# ---------------------------------------------------------------------------
# Precipitação em blocos de 3 h: determinísticos + ensembles


def _block_sums(times: list[int], series: list | None, start: int, end: int) -> dict[int, float | None]:
    sums: dict[int, list] = {}
    if not series:
        return {}
    for i, t in enumerate(times):
        if t <= start or t > end + BLOCK_S:
            continue
        b = block_start(t)
        sums.setdefault(b, []).append(series[i] if i < len(series) else None)
    out = {}
    for b, vs in sums.items():
        if len(vs) == 3 and all(v is not None for v in vs):
            out[b] = round(sum(vs), 2)
        else:
            out[b] = None  # bloco incompleto: não inventamos o restante
    return out


def _block_max(times: list[int], series: list | None, start: int, end: int) -> dict[int, float | None]:
    vals: dict[int, list] = {}
    if not series:
        return {}
    for i, t in enumerate(times):
        if t <= start or t > end + BLOCK_S:
            continue
        v = series[i] if i < len(series) else None
        if v is not None:
            vals.setdefault(block_start(t), []).append(v)
    return {b: max(vs) for b, vs in vals.items()}


def precip_blocks(
    mm: dict[str, Any], ens: dict[str, Any] | None, weights: dict[str, dict], start: int, end: int
) -> list[dict[str, Any]]:
    det = {mid: _block_sums(mm["times"], mm["models"][mid].get("precipitation"), start, end) for mid in weights}
    cape = {mid: _block_max(mm["times"], mm["models"][mid].get("cape"), start, end) for mid in weights}
    gust = {mid: _block_max(mm["times"], mm["models"][mid].get("wind_gusts_10m"), start, end) for mid in weights}

    ens_blocks: dict[str, dict[str, list[dict[int, float | None]]]] = {}
    if ens:
        for eid, vars_ in ens["ensembles"].items():
            ens_blocks[eid] = {
                "precip": [_block_sums(ens["times"], m, start, end) for m in vars_.get("precipitation", [])],
                "gust": [_block_max(ens["times"], m, start, end) for m in vars_.get("wind_gusts_10m", [])],
            }

    starts = sorted({b for d in det.values() for b in d} | {b for e in ens_blocks.values() for m in e["precip"] for b in m})
    out = []
    for b in starts:
        if b + BLOCK_S <= start or b > end:
            continue
        by_model = {mid: det[mid].get(b) for mid in weights}
        vals = [(v, weights[m]["weight"]) for m, v in by_model.items() if v is not None]
        wet_weight = sum(w for v, w in vals if v >= P_ANY_3H)
        tot_weight = sum(w for _, w in vals)
        cape_vals = [(cape[m].get(b), weights[m]["weight"]) for m in weights if cape[m].get(b) is not None]
        gust_vals = [(gust[m].get(b), weights[m]["weight"]) for m in weights if gust[m].get(b) is not None]
        block: dict[str, Any] = {
            "start": b,
            "end": b + BLOCK_S,
            "precipByModel": by_model,
            "precipMedian": None if not vals else round(weighted_median([v for v, _ in vals], [w for _, w in vals]), 1),
            "precipMax": None if not vals else round(max(v for v, _ in vals), 1),
            "modelAgreementWet": None if not tot_weight else round(wet_weight / tot_weight, 2),
            "modelsCount": len(vals),
            "capeMedian": None
            if not cape_vals
            else round(weighted_median([v for v, _ in cape_vals], [w for _, w in cape_vals])),
            "gustMedian": None
            if not gust_vals
            else round(weighted_median([v for v, _ in gust_vals], [w for _, w in gust_vals])),
            "gustMax": None if not gust_vals else round(max(v for v, _ in gust_vals)),
        }
        # Probabilidades dos ensembles: fração de membros por sistema; média com peso igual por sistema
        probs: dict[str, dict[str, Any]] = {}
        for eid, e in ens_blocks.items():
            members = [m.get(b) for m in e["precip"]]
            members = [v for v in members if v is not None]
            gmembers = [m.get(b) for m in e["gust"]]
            gmembers = [v for v in gmembers if v is not None]
            if len(members) < 10:
                continue
            n = len(members)
            probs[eid] = {
                "members": n,
                "pAny": round(sum(v >= P_ANY_3H for v in members) / n, 2),
                "pModerate": round(sum(v >= P_MOD_3H for v in members) / n, 2),
                "pHeavy": round(sum(v >= P_HEAVY_3H for v in members) / n, 2),
                "p50": round(weighted_quantile(members, [1] * n, 0.5) or 0, 1),
                "p90": round(weighted_quantile(members, [1] * n, 0.9) or 0, 1),
                "pGustStrong": None
                if len(gmembers) < 10
                else round(sum(v >= GUST_STRONG for v in gmembers) / len(gmembers), 2),
            }
        block["ensemble"] = probs
        if probs:
            k = len(probs)
            block["rainProbability"] = round(sum(p["pAny"] for p in probs.values()) / k, 2)
            block["moderateProbability"] = round(sum(p["pModerate"] for p in probs.values()) / k, 2)
            block["heavyProbability"] = round(sum(p["pHeavy"] for p in probs.values()) / k, 2)
            g = [p["pGustStrong"] for p in probs.values() if p["pGustStrong"] is not None]
            block["gustStrongProbability"] = round(sum(g) / len(g), 2) if g else None
            block["probabilitySpread"] = round(
                max(p["pAny"] for p in probs.values()) - min(p["pAny"] for p in probs.values()), 2
            )
        else:
            block["rainProbability"] = None
            block["moderateProbability"] = None
            block["heavyProbability"] = None
            block["gustStrongProbability"] = None
            block["probabilitySpread"] = None
        out.append(block)
    return out


# ---------------------------------------------------------------------------
# Concordância por modelo (painel MODELO | PREVISÃO | CONCORDÂNCIA)


def model_agreement(
    mm: dict[str, Any], hours: list[dict[str, Any]], blocks: list[dict[str, Any]], weights: dict[str, dict]
) -> list[dict[str, Any]]:
    idx = _index(mm["times"])
    rows = []
    cons_total = sum(b["precipMedian"] or 0 for b in blocks if b["precipMedian"] is not None)
    for mid, w in weights.items():
        info = MODEL_BY_ID[mid]
        temps, diffs, gusts = [], [], []
        for h in hours:
            i = idx.get(h["time"])
            v = _val(mm["models"][mid].get("temperature_2m"), i)
            g = _val(mm["models"][mid].get("wind_gusts_10m"), i)
            if v is not None:
                temps.append(v)
                if h["temperature"] and h["temperature"]["value"] is not None:
                    diffs.append(abs(v - h["temperature"]["value"]))
            if g is not None:
                gusts.append(g)
        pvals = [b["precipByModel"].get(mid) for b in blocks]
        complete = [v for v in pvals if v is not None]
        total = round(sum(complete), 1) if complete else None
        coverage_h = len(temps)
        if not temps:
            rows.append(
                {"model": mid, "name": info.name, "provider": info.provider, "available": False, "agreement": None}
            )
            continue
        tdiff = sum(diffs) / len(diffs) if diffs else None
        both_dry = total is not None and total < 1 and cons_total < 1
        p_ok = total is not None and (both_dry or abs(total - cons_total) <= max(5, 0.5 * max(total, cons_total)))
        if tdiff is not None and tdiff <= 1.0 and p_ok:
            agreement = "concorda"
        elif (tdiff is not None and tdiff <= 2.0) or p_ok:
            agreement = "parcial"
        else:
            agreement = "diverge"
        rows.append(
            {
                "model": mid,
                "name": info.name,
                "provider": info.provider,
                "resolutionKm": info.resolution_km,
                "available": True,
                "hoursCovered": coverage_h,
                "tempMax": round(max(temps), 1),
                "tempMin": round(min(temps), 1),
                "precipTotal": total,
                "gustMax": round(max(gusts)) if gusts else None,
                "meanAbsDiffFromConsensus": None if tdiff is None else round(tdiff, 1),
                "agreement": agreement,
                "weight": w["normalized"],
                "weightReasons": w["reasons"],
            }
        )
    return rows


def risk_windows(blocks: list[dict[str, Any]], tz_offset: int = 0) -> list[dict[str, Any]]:
    """Janelas de maior risco de chuva forte / rajadas / tempestade, sempre com justificativa."""
    out = []
    for b in blocks:
        reasons = []
        kind = None
        hp = b.get("heavyProbability")
        mp = b.get("moderateProbability")
        wet = b.get("modelAgreementWet")
        if hp is not None and hp >= 0.2:
            kind = "chuva forte"
            reasons.append(f"{round(hp * 100)}% dos membros de ensemble com ≥{P_HEAVY_3H:g} mm/3 h")
        elif mp is not None and mp >= 0.3:
            kind = "chuva moderada"
            reasons.append(f"{round(mp * 100)}% dos membros de ensemble com ≥{P_MOD_3H:g} mm/3 h")
        if b.get("capeMedian") is not None and b["capeMedian"] >= CAPE_STORM and wet is not None and wet >= 0.5:
            kind = kind or "tempestade"
            reasons.append(f"CAPE mediano {b['capeMedian']} J/kg com chuva na maioria dos modelos")
        gp = b.get("gustStrongProbability")
        if gp is not None and gp >= 0.3:
            kind = kind or "rajadas"
            reasons.append(f"{round(gp * 100)}% dos membros com rajadas ≥{GUST_STRONG:g} km/h")
        if kind:
            out.append({"start": b["start"], "end": b["end"], "kind": kind, "reasons": reasons})
    return out


# ---------------------------------------------------------------------------
# Longo prazo (ensembles diários)


def daily_ensemble(ens_daily: dict[str, Any], today_start: int) -> list[dict[str, Any]]:
    times = ens_daily["times"]
    systems = ens_daily["ensembles"]
    days = []
    for i, t in enumerate(times):
        lead_days = round((t - today_start) / 86400)
        per_system = {}
        pooled: dict[str, tuple[list[float], list[float]]] = {}
        for eid, vars_ in systems.items():
            sysd = {}
            for var in ("temperature_2m_max", "temperature_2m_min", "precipitation_sum", "wind_gusts_10m_max"):
                mem = [m[i] for m in vars_.get(var, []) if i < len(m) and m[i] is not None]
                if len(mem) < 10:
                    continue
                n = len(mem)
                sysd[var] = mem
                vs, ws = pooled.setdefault(var, ([], []))
                vs.extend(mem)
                ws.extend([1.0 / n] * n)  # peso igual por sistema, não por membro
            if sysd:
                pr = sysd.get("precipitation_sum")
                tx = sysd.get("temperature_2m_max")
                per_system[eid] = {
                    "name": ENSEMBLE_BY_ID.get(eid).name if eid in ENSEMBLE_BY_ID else eid,
                    "members": max(len(v) for v in sysd.values()),
                    "tmaxMedian": None if not tx else round(weighted_median(tx, [1] * len(tx)), 1),
                    "precipMedian": None if not pr else round(weighted_median(pr, [1] * len(pr)), 1),
                    "pRain": None if not pr else round(sum(v >= 1 for v in pr) / len(pr), 2),
                }
        if not pooled:
            continue

        def q(var: str, p: float, nd: int = 1):
            if var not in pooled:
                return None
            v = weighted_quantile(pooled[var][0], pooled[var][1], p)
            return None if v is None else round(v, nd)

        def prob(var: str, thr: float):
            if var not in pooled:
                return None
            vs, ws = pooled[var]
            return round(sum(w for v, w in zip(vs, ws) if v >= thr) / sum(ws), 2)

        p_rain_sys = [s["pRain"] for s in per_system.values() if s["pRain"] is not None]
        div_rain = round(max(p_rain_sys) - min(p_rain_sys), 2) if len(p_rain_sys) > 1 else None
        tmax_sys = [s["tmaxMedian"] for s in per_system.values() if s["tmaxMedian"] is not None]
        div_t = round(max(tmax_sys) - min(tmax_sys), 1) if len(tmax_sys) > 1 else None
        day = {
            "date": t,
            "leadDays": lead_days,
            "tmax": {"p10": q("temperature_2m_max", 0.1), "p50": q("temperature_2m_max", 0.5), "p90": q("temperature_2m_max", 0.9)},
            "tmin": {"p10": q("temperature_2m_min", 0.1), "p50": q("temperature_2m_min", 0.5), "p90": q("temperature_2m_min", 0.9)},
            "precip": {
                "p10": q("precipitation_sum", 0.1),
                "p50": q("precipitation_sum", 0.5),
                "p90": q("precipitation_sum", 0.9),
                "pAny": prob("precipitation_sum", 1.0),
                "p10mm": prob("precipitation_sum", 10.0),
                "p30mm": prob("precipitation_sum", 30.0),
            },
            "gust": {"p50": q("wind_gusts_10m_max", 0.5, 0), "p90": q("wind_gusts_10m_max", 0.9, 0)},
            "systems": per_system,
            "divergence": {"rainProbability": div_rain, "tmaxMedian": div_t},
        }
        day["confidence"], day["confidenceReasons"] = long_range_confidence(day)
        days.append(day)
    return days


def long_range_confidence(day: dict[str, Any]) -> tuple[str, list[str]]:
    lead = day["leadDays"]
    reasons = [f"Prazo de {lead} dia(s)"]
    # teto pelo horizonte: a confiança diminui com o prazo
    level = 2 if lead <= 2 else 1 if lead <= 7 else 0
    tx = day["tmax"]
    if tx["p90"] is not None and tx["p10"] is not None:
        width = tx["p90"] - tx["p10"]
        reasons.append(f"Faixa P10–P90 da máxima: {width:.1f} °C")
        if width > 5:
            level -= 1
    d = day["divergence"]["rainProbability"]
    if d is not None:
        reasons.append(f"Divergência entre sistemas na chance de chuva: {round(d * 100)} p.p.")
        if d > 0.4:
            level -= 1
    if len(day["systems"]) < 2:
        reasons.append("Apenas um sistema de ensemble disponível")
        level -= 1
    level = max(0, min(level, 2))
    return ["low", "moderate", "high"][level], reasons


def medium_confidence(
    lead_h: float, temp_spread: float | None, wet_agreement: float | None, prob_spread: float | None
) -> tuple[str, list[str]]:
    reasons = []
    level = 2 if lead_h <= 24 else 1
    reasons.append(f"Prazo de {round(lead_h)} h")
    if temp_spread is not None:
        reasons.append(f"Dispersão de temperatura entre modelos: {temp_spread:.1f} °C")
        if temp_spread > 2:
            level -= 1
    if wet_agreement is not None and 0.3 <= wet_agreement <= 0.7:
        reasons.append("Modelos divididos sobre a ocorrência de chuva")
        level -= 1
    if prob_spread is not None and prob_spread > 0.4:
        reasons.append("Ensembles discordam sobre a chance de chuva")
        level -= 1
    level = max(0, min(level, 2))
    return ["low", "moderate", "high"][level], reasons


def nan_to_none(x: Any) -> Any:
    if isinstance(x, float) and math.isnan(x):
        return None
    return x
