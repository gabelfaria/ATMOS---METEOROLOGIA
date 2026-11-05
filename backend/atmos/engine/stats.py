"""Estatísticas robustas e ponderadas usadas pelo motor."""

from __future__ import annotations

import math
from typing import Iterable, Sequence


def clean(values: Iterable[float | None]) -> list[float]:
    return [float(v) for v in values if v is not None and not (isinstance(v, float) and math.isnan(v))]


def weighted_quantile(values: Sequence[float], weights: Sequence[float], q: float) -> float | None:
    pairs = sorted((v, w) for v, w in zip(values, weights) if v is not None and w > 0)
    if not pairs:
        return None
    total = sum(w for _, w in pairs)
    # interpolação nos pontos médios das massas acumuladas
    cum = 0.0
    centers = []
    for v, w in pairs:
        centers.append(((cum + w / 2) / total, v))
        cum += w
    if q <= centers[0][0]:
        return centers[0][1]
    if q >= centers[-1][0]:
        return centers[-1][1]
    for (p0, v0), (p1, v1) in zip(centers, centers[1:]):
        if p0 <= q <= p1:
            t = 0 if p1 == p0 else (q - p0) / (p1 - p0)
            return v0 + t * (v1 - v0)
    return centers[-1][1]


def weighted_median(values: Sequence[float], weights: Sequence[float]) -> float | None:
    return weighted_quantile(values, weights, 0.5)


def weighted_std(values: Sequence[float], weights: Sequence[float]) -> float | None:
    pairs = [(v, w) for v, w in zip(values, weights) if v is not None and w > 0]
    if len(pairs) < 2:
        return None
    total = sum(w for _, w in pairs)
    mean = sum(v * w for v, w in pairs) / total
    return math.sqrt(sum(w * (v - mean) ** 2 for v, w in pairs) / total)


def circular_mean_deg(values: Sequence[float], weights: Sequence[float]) -> float | None:
    pairs = [(v, w) for v, w in zip(values, weights) if v is not None and w > 0]
    if not pairs:
        return None
    s = sum(w * math.sin(math.radians(v)) for v, w in pairs)
    c = sum(w * math.cos(math.radians(v)) for v, w in pairs)
    if abs(s) < 1e-9 and abs(c) < 1e-9:
        return None
    return (math.degrees(math.atan2(s, c)) + 360) % 360


def mae(errors: Sequence[float]) -> float | None:
    return sum(abs(e) for e in errors) / len(errors) if errors else None


def brier(pairs: Sequence[tuple[float, int]]) -> float | None:
    """pairs = (probabilidade 0–1, ocorreu 0/1)."""
    return sum((p - o) ** 2 for p, o in pairs) / len(pairs) if pairs else None
