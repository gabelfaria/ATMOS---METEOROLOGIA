"""Motor de AVISOS ESTIMADOS (calculados pelo app). Nunca confundir com ALERTA OFICIAL.

Regras conservadoras e com justificativa explícita. Não afirma risco de inundação/deslizamento.
Cada aviso tem `dedupeKey` estável (tipo + janela) para o cliente não repetir notificações.
"""

from __future__ import annotations

from typing import Any

from .consensus import CAPE_STORM, GUST_STRONG, P_HEAVY_3H
from .verdict import hhmm, pct


def estimated_alerts(
    *,
    now: float,
    tz_offset: int,
    nowcast: dict[str, Any] | None,
    observation: dict[str, Any] | None,
    blocks: list[dict[str, Any]],
    previous: dict[str, Any] | None,
    current_summary: dict[str, Any],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def add(type_: str, title: str, detail: str, severity: str, reasons: list[str], start=None, end=None, basis=""):
        bucket = int((start or now) // 3600)
        out.append(
            {
                "id": f"est-{type_}-{bucket}",
                "dedupeKey": f"{type_}:{bucket}",
                "kind": "estimated",
                "type": type_,
                "title": title,
                "detail": detail,
                "severity": severity,  # info | attention | high
                "reasons": reasons,
                "start": start,
                "end": end,
                "basis": basis,
                "issuedAt": int(now),
            }
        )

    nc_ok = bool(nowcast and nowcast.get("available"))
    if nc_ok and nowcast.get("arrival") and nowcast["arrival"]["centralMinutes"] <= 60:
        a = nowcast["arrival"]
        sev = "attention" if a["maxClass"] in ("forte", "muito forte") else "info"
        add(
            "rain_imminent",
            "Possível chuva iminente",
            f"Chuva {a['maxClass'] or 'fraca'} se aproximando pelo {a['from']}; chegada estimada em ~{a['centralMinutes']} min.",
            sev,
            nowcast.get("confidenceReasons", []) + [f"Confiança: {nowcast['confidence']}"],
            start=now + a["earliestMinutes"] * 60,
            basis="Extrapolação de radar (RainViewer)",
        )
    if nc_ok and nowcast["current"].get("class") in ("forte", "muito forte"):
        add(
            "heavy_rain_now",
            "Chuva forte detectada",
            f"Radar indica chuva {nowcast['current']['class']} sobre o local (~{nowcast['current']['rateMmH']} mm/h estimados).",
            "attention",
            ["Refletividade convertida por Marshall–Palmer (estimativa, não pluviômetro)"],
            start=nowcast["current"]["time"],
            basis="Radar (RainViewer)",
        )
    if observation and (observation["weather"]["thunder"] or observation["weather"]["thunderVicinity"]):
        add(
            "thunder_observed",
            "Trovoada observada",
            f"A estação {observation['station']} ({observation['distanceKm']:.0f} km) reportou trovoada às {hhmm(observation['observedAt'], tz_offset)}.",
            "attention",
            [observation.get("raw") or ""],
            start=observation["observedAt"],
            basis="METAR",
        )

    horizon = now + 48 * 3600
    future = [b for b in blocks if b["end"] > now and b["start"] < horizon]

    heavy = [b for b in future if (b.get("heavyProbability") or 0) >= 0.2 or _heavy_by_models(b)]
    if heavy:
        b = heavy[0]
        reasons = []
        if b.get("heavyProbability") is not None:
            reasons.append(f"{pct(b['heavyProbability'])} dos membros de ensemble com ≥{P_HEAVY_3H:g} mm em 3 h")
        if _heavy_by_models(b):
            reasons.append("Ao menos 40% dos modelos determinísticos preveem ≥30 mm em 3 h")
        add(
            "heavy_rain_forecast",
            "Previsão de chuva forte",
            f"Possibilidade de chuva forte entre {hhmm(b['start'], tz_offset)} e {hhmm(b['end'], tz_offset)}.",
            "attention",
            reasons,
            start=b["start"],
            end=b["end"],
            basis="Ensembles e modelos (Open-Meteo)",
        )

    gusty = [
        b
        for b in future
        if (b.get("gustStrongProbability") or 0) >= 0.3 or (b.get("gustMedian") or 0) >= GUST_STRONG
    ]
    if gusty:
        b = gusty[0]
        reasons = []
        if b.get("gustStrongProbability") is not None:
            reasons.append(f"{pct(b['gustStrongProbability'])} dos membros com rajadas ≥{GUST_STRONG:g} km/h")
        if b.get("gustMedian") is not None:
            reasons.append(f"Rajada mediana entre modelos: {b['gustMedian']} km/h")
        add(
            "strong_gusts",
            "Rajadas intensas possíveis",
            f"Rajadas de {GUST_STRONG:g} km/h ou mais possíveis entre {hhmm(b['start'], tz_offset)} e {hhmm(b['end'], tz_offset)}.",
            "attention",
            reasons,
            start=b["start"],
            end=b["end"],
            basis="Ensembles e modelos (Open-Meteo)",
        )

    storms = [
        b
        for b in future
        if (b.get("capeMedian") or 0) >= CAPE_STORM and (b.get("modelAgreementWet") or 0) >= 0.5
    ]
    if storms:
        b = storms[0]
        add(
            "storm_potential",
            "Potencial para tempestades",
            f"Instabilidade elevada com chuva prevista entre {hhmm(b['start'], tz_offset)} e {hhmm(b['end'], tz_offset)}.",
            "info",
            [
                f"CAPE mediano de {b['capeMedian']} J/kg (≥{CAPE_STORM:g})",
                f"{round(b['modelAgreementWet'] * 100)}% do peso dos modelos com chuva",
                "Potencial não significa ocorrência: tempestades são localizadas",
            ],
            start=b["start"],
            end=b["end"],
            basis="Modelos (Open-Meteo)",
        )

    if previous and now - previous["issuedAt"] <= 12 * 3600:
        changes = []
        r0, r1 = previous.get("rain24h"), current_summary.get("rain24h")
        if r0 is not None and r1 is not None and abs(r1 - r0) >= 10:
            changes.append(f"chuva em 24 h: {r0:.0f} → {r1:.0f} mm")
        p0, p1 = previous.get("maxProb24h"), current_summary.get("maxProb24h")
        if p0 is not None and p1 is not None and abs(p1 - p0) >= 0.3:
            changes.append(f"chance máxima de chuva: {pct(p0)} → {pct(p1)}")
        if changes:
            add(
                "forecast_change",
                "Mudança importante na previsão",
                "Comparado à emissão de " + hhmm(previous["issuedAt"], tz_offset) + ": " + "; ".join(changes) + ".",
                "info",
                ["Comparação com a previsão consolidada anterior armazenada para esta área"],
                basis="Histórico ATMOS",
            )
    return out


def _heavy_by_models(b: dict[str, Any]) -> bool:
    vals = [v for v in b["precipByModel"].values() if v is not None]
    if len(vals) < 2:
        return False
    return sum(1 for v in vals if v >= P_HEAVY_3H) / len(vals) >= 0.4
