"""Veredito em linguagem natural por REGRAS DETERMINÍSTICAS.

Cada frase é derivada de um campo calculado; nenhuma quantidade é escrita sem dado que a sustente.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

CONF_PT = {"high": "alta", "moderate": "moderada", "low": "baixa"}


def hhmm(ts: int | float, offset_s: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone(timedelta(seconds=offset_s))).strftime("%H:%M")


def pct(p: float | None) -> str:
    return "—" if p is None else f"{round(p * 100)}%"


def _next_blocks(blocks: list[dict[str, Any]], now: float, n: int = 2) -> list[dict[str, Any]]:
    return [b for b in blocks if b["end"] > now][:n]


def build_verdict(
    *,
    now: float,
    tz_offset: int,
    nowcast: dict[str, Any] | None,
    observation: dict[str, Any] | None,
    blocks: list[dict[str, Any]],
    official: list[dict[str, Any]],
) -> dict[str, Any]:
    parts: list[str] = []
    reasons: list[str] = []
    sources: list[str] = []
    confidence = "low"
    main_source = None
    data_time = None
    arrival = None
    rain_prob = None

    in_force = [a for a in official if a.get("inForce")]
    if in_force:
        a = in_force[0]
        parts.append(f"Aviso oficial do INMET em vigor: {a['event']} ({a['severity']}).")
        sources.append("INMET")

    nb = _next_blocks(blocks, now)
    if nb and nb[0].get("rainProbability") is not None:
        rain_prob = nb[0]["rainProbability"]

    nc_ok = bool(nowcast and nowcast.get("available"))
    if nc_ok:
        cur = nowcast["current"]
        motion = nowcast.get("motion")
        data_time = nowcast["latestFrameTime"]
        main_source = "Radar (RainViewer)"
        sources.append("RainViewer")
        confidence = nowcast["confidence"]
        reasons.extend(nowcast.get("confidenceReasons", []))
        if cur.get("class"):
            parts.append(f"Chuva {cur['class']} sobre o local agora, segundo o radar.")
            if motion:
                parts.append(f"As células se deslocam para {motion['toward']} a cerca de {motion['speedKmh']} km/h.")
            fc = nowcast.get("forecast") or []
            order = ["fraca", "moderada", "forte", "muito forte"]
            next_hour = [s["class"] for s in fc if s["lead"] <= 60 and s["class"]]
            worst = max(next_hour, key=order.index) if next_hour else None
            if worst and order.index(worst) > order.index(cur["class"]):
                parts.append(f"A extrapolação do radar indica possível intensificação para chuva {worst} na próxima hora.")
            dry = [s for s in fc if not s["class"] and s["inDomain"]]
            if fc and len(dry) >= 2 and fc[0]["class"]:
                first_dry = next(s["lead"] for s in fc if not s["class"])
                parts.append(f"A extrapolação indica possível diminuição em cerca de {first_dry} min.")
        elif nowcast.get("arrival"):
            arrival = nowcast["arrival"]
            cls = arrival["maxClass"] or "fraca"
            e, l = arrival["earliestMinutes"], arrival["latestMinutes"]
            window = f"{e}–{l} minutos" if l is not None and l > e else f"cerca de {arrival['centralMinutes']} minutos"
            parts.append(
                f"Chuva {cls} se aproxima pelo {arrival['from']}. Há possibilidade de atingir sua região nos próximos {window}."
            )
        elif nowcast.get("nearestEcho") and nowcast["nearestEcho"]["distanceKm"] <= 60:
            ne = nowcast["nearestEcho"]
            parts.append(
                f"Há chuva a {ne['distanceKm']:.0f} km, a {ne['direction']}, sem trajetória estimada em direção ao seu local nas próximas 2 h."
            )
        elif nowcast["echoFraction"] < 0.002:
            parts.append(f"Sem chuva no radar num raio de ~{nowcast['domainRadiusKm']} km.")
        else:
            parts.append("Sem chuva no radar nas proximidades imediatas.")
    else:
        reason = (nowcast or {}).get("reason", "radar indisponível")
        parts.append(f"Previsão imediata por radar indisponível ({reason}).")
        reasons.append(reason)

    # Observação de superfície (medição) — confirma ou contradiz o radar
    if observation:
        wx = observation["weather"]
        when = hhmm(observation["observedAt"], tz_offset)
        name = observation["station"]
        if wx["precipAtStation"] or wx["thunder"]:
            desc = ", ".join(d for d in wx["description"] if d)
            parts.append(f"A estação {name} ({observation['distanceKm']:.0f} km) registrou {desc} às {when}.")
            sources.append(f"METAR {name}")
            if nc_ok and not nowcast["current"].get("class") and observation["distanceKm"] <= 15:
                reasons.append("Estação próxima reporta chuva não vista pelo radar no ponto")
                confidence = "low"
        elif wx["thunderVicinity"]:
            parts.append(f"A estação {name} registrou trovoada nas proximidades às {when}.")
            sources.append(f"METAR {name}")

    # Perspectiva dos modelos/ensembles para as próximas horas (complementa o radar)
    if nb:
        b = nb[0]
        rp = b.get("rainProbability")
        span = f"entre {hhmm(b['start'], tz_offset)} e {hhmm(b['end'], tz_offset)}"
        if rp is not None:
            if not nc_ok or (not nowcast["current"].get("class") and not nowcast.get("arrival")):
                if rp >= 0.5:
                    parts.append(f"Os ensembles indicam {pct(rp)} de chance de chuva {span}.")
                elif rp >= 0.2:
                    parts.append(f"Chance de chuva de {pct(rp)} {span}, segundo os ensembles.")
                else:
                    parts.append(f"Ensembles indicam baixa chance de chuva ({pct(rp)}) {span}.")
            sources.append("Ensembles Open-Meteo")
            if not main_source:
                main_source = "Ensembles (ECMWF/GEFS/ICON via Open-Meteo)"
                data_time = None
        elif b.get("modelAgreementWet") is not None and not nc_ok:
            parts.append(
                f"{round(b['modelAgreementWet'] * 100)}% do peso dos modelos prevê chuva {span} (concordância, não probabilidade)."
            )
            main_source = main_source or "Modelos determinísticos (Open-Meteo)"

    if not nc_ok:
        confidence = "low" if rain_prob is None or 0.25 < rain_prob < 0.75 else "moderate"
        reasons.append("Sem radar: veredito baseado em modelos numéricos")

    summary = parts[0] if parts else "Dados insuficientes para um veredito."
    return {
        "horizon": "0-2h",
        "summary": summary,
        "text": " ".join(parts),
        "rainProbability": rain_prob,
        "rainProbabilityKind": "ensemble_member_fraction_uncalibrated" if rain_prob is not None else None,
        "estimatedArrivalMinutes": arrival["centralMinutes"] if arrival else None,
        "arrivalWindowMinutes": [arrival["earliestMinutes"], arrival["latestMinutes"]] if arrival else None,
        "confidence": confidence,
        "confidenceLabel": CONF_PT[confidence],
        "confidenceReason": "; ".join(dict.fromkeys(reasons)) or None,
        "mainSource": main_source,
        "sources": list(dict.fromkeys(sources)),
        "dataTime": data_time,
        "lastUpdated": int(now),
    }
