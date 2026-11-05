"""Nowcasting por extrapolação de radar (advecção por translação).

Método (transparente e conservador):
1. Decodifica os últimos quadros de refletividade (dBZ) do RainViewer centrados no ponto (≈1,1 km/px).
2. Estima o vetor de deslocamento entre quadros consecutivos por correlação de fase (FFT, Optical
   Flow global). Pares idênticos (mosaico não atualizado) ou com poucos ecos são descartados.
3. Combina os vetores pela mediana e mede a consistência (dispersão entre pares).
4. Extrapola o último quadro (semi-Lagrangiano, translação pura) em passos de 10 min até 120 min,
   que é a resolução temporal real dos dados — sem interpolação para passos menores.
5. Janela de chegada = chegada com velocidade +25% (cedo) e −25% (tarde).

Limitações declaradas ao usuário: não prevê nascimento/dissipação de células, nem rotação; a
confiança é limitada a "moderada" e decai com o prazo. Uma evolução natural é usar `pysteps`
(Lucas–Kanade denso + S-PROG), mantendo esta mesma interface.
"""

from __future__ import annotations

import asyncio
import math
import time
from typing import Any

import numpy as np

from ..adapters import rainviewer as rv
from ..geo import compass8
from ..http import SourceError

ECHO_DBZ = 20.0  # ≈0,65 mm/h (Marshall–Palmer): limiar de "chuva" no radar
MOTION_DBZ = 15.0
MIN_ECHO_FRACTION = 0.002
MAX_SHIFT_PX_PER_10MIN = 30  # ≈200 km/h a 1,1 km/px — acima disso é artefato
LEADS_MIN = list(range(10, 121, 10))


def phase_correlation(a: np.ndarray, b: np.ndarray) -> tuple[float, float, float]:
    """Deslocamento (dy, dx) que leva `a` em `b`, e a nitidez do pico (qualidade)."""
    h, w = a.shape
    win = np.outer(np.hanning(h), np.hanning(w))
    fa = np.fft.fft2(a * win)
    fb = np.fft.fft2(b * win)
    r = fb * np.conj(fa)
    r /= np.abs(r) + 1e-9
    corr = np.fft.ifft2(r).real
    peak = np.unravel_index(np.argmax(corr), corr.shape)
    py, px = int(peak[0]), int(peak[1])

    def sub(c_m: float, c_0: float, c_p: float) -> float:
        den = c_m - 2 * c_0 + c_p
        return 0.0 if abs(den) < 1e-12 else 0.5 * (c_m - c_p) / den

    dy = py + sub(corr[(py - 1) % h, px], corr[py, px], corr[(py + 1) % h, px])
    dx = px + sub(corr[py, (px - 1) % w], corr[py, px], corr[py, (px + 1) % w])
    if dy > h / 2:
        dy -= h
    if dx > w / 2:
        dx -= w
    quality = float(corr[py, px] / (np.abs(corr).mean() + 1e-9))
    return float(dy), float(dx), quality


def _motion_field(img: np.ndarray) -> np.ndarray:
    f = np.where(img >= MOTION_DBZ, img - MOTION_DBZ, 0.0)
    return f.astype(np.float64)


def estimate_motion(frames: list[np.ndarray], times: list[int]) -> dict[str, Any]:
    """Vetor de movimento em px/10 min (linha, coluna) a partir de quadros consecutivos."""
    vectors, rejected = [], []
    for i in range(1, len(frames)):
        a, b = frames[i - 1], frames[i]
        dt = times[i] - times[i - 1]
        if dt <= 0:
            continue
        if np.array_equal(a, b):
            rejected.append("quadro repetido")
            continue
        fa, fb = (a >= MOTION_DBZ).mean(), (b >= MOTION_DBZ).mean()
        if min(fa, fb) < MIN_ECHO_FRACTION:
            rejected.append("poucos ecos")
            continue
        dy, dx, q = phase_correlation(_motion_field(a), _motion_field(b))
        scale = 600.0 / dt
        vy, vx = dy * scale, dx * scale
        if math.hypot(vy, vx) > MAX_SHIFT_PX_PER_10MIN or q < 5:
            rejected.append("correlação fraca")
            continue
        vectors.append((vy, vx))
    if not vectors:
        return {"valid": False, "pairs": 0, "rejected": rejected}
    arr = np.array(vectors)
    vy, vx = float(np.median(arr[:, 0])), float(np.median(arr[:, 1]))
    spread = float(np.sqrt(((arr - [vy, vx]) ** 2).sum(axis=1).mean())) if len(arr) > 1 else None
    return {"valid": True, "vy": vy, "vx": vx, "pairs": len(vectors), "spreadPx": spread, "rejected": rejected}


def _disk_max(img: np.ndarray, r0: float, c0: float, radius: float) -> float:
    h, w = img.shape
    ri, ci = int(round(r0)), int(round(c0))
    rad = int(math.ceil(radius))
    if ri + rad < 0 or ci + rad < 0 or ri - rad >= h or ci - rad >= w:
        return rv.NO_DATA
    r1, r2 = max(ri - rad, 0), min(ri + rad + 1, h)
    c1, c2 = max(ci - rad, 0), min(ci + rad + 1, w)
    sub = img[r1:r2, c1:c2]
    yy, xx = np.ogrid[r1:r2, c1:c2]
    mask = (yy - r0) ** 2 + (xx - c0) ** 2 <= radius**2
    vals = sub[mask]
    return float(vals.max()) if vals.size else rv.NO_DATA


def _inside(img: np.ndarray, r: float, c: float) -> bool:
    h, w = img.shape
    return 0 <= r < h and 0 <= c < w


def extrapolate_at_point(
    last: np.ndarray, row: float, col: float, vy: float, vx: float, factor: float = 1.0, radius_px: float = 2.0
) -> list[dict[str, Any]]:
    """Para cada prazo, amostra o último quadro no ponto a montante (translação pura)."""
    out = []
    for lead in LEADS_MIN:
        steps = lead / 10.0 * factor
        sr, sc = row - vy * steps, col - vx * steps
        inside = _inside(last, sr, sc)
        dbz = _disk_max(last, sr, sc, radius_px) if inside else None
        out.append({"lead": lead, "dbz": None if dbz is None or dbz <= rv.NO_DATA else dbz, "inDomain": inside})
    return out


def first_arrival(series: list[dict[str, Any]]) -> int | None:
    for s in series:
        if s["dbz"] is not None and s["dbz"] >= ECHO_DBZ:
            return s["lead"]
    return None


def nearest_echo(img: rv.RadarImage, row: float, col: float) -> dict[str, Any] | None:
    mask = img.dbz >= ECHO_DBZ
    if not mask.any():
        return None
    ys, xs = np.nonzero(mask)
    d2 = (ys - row) ** 2 + (xs - col) ** 2
    k = int(d2.argmin())
    dist = math.sqrt(float(d2[k])) * img.km_per_px
    # azimute do ponto até o eco (linha cresce para o sul)
    bearing = (math.degrees(math.atan2(xs[k] - col, -(ys[k] - row))) + 360) % 360
    return {"distanceKm": round(dist, 1), "direction": compass8(bearing), "bearing": round(bearing)}


def analyze(frames: list[rv.RadarImage], lat: float, lon: float, now: float | None = None) -> dict[str, Any]:
    """Análise completa a partir de quadros já decodificados (função pura, testável)."""
    now = now or time.time()
    last = frames[-1]
    row, col = last.pixel_of(lat, lon)
    km_px = last.km_per_px
    radius_km = round(last.size / 2 * km_px)
    age_min = (now - last.time) / 60.0

    # Passado observado no ponto (cada quadro real, 10 min)
    observed = []
    for f in frames:
        r, c = f.pixel_of(lat, lon)
        dbz = _disk_max(f.dbz, r, c, 2.0)
        dbz = None if dbz <= rv.NO_DATA else dbz
        rate = float(rv.dbz_to_rain_rate(dbz)) if dbz is not None and dbz >= ECHO_DBZ else 0.0
        observed.append({"time": f.time, "dbz": dbz, "rateMmH": round(rate, 1), "class": rv.rain_class(rate)})

    current = observed[-1]
    echo_fraction = float((last.dbz >= ECHO_DBZ).mean())
    nearest = nearest_echo(last, row, col)

    motion = estimate_motion([f.dbz for f in frames[-7:]], [f.time for f in frames[-7:]])
    result: dict[str, Any] = {
        "method": "Extrapolação por translação (correlação de fase) sobre mosaico RainViewer",
        "resolutionKm": round(km_px, 2),
        "domainRadiusKm": radius_km,
        "stepMinutes": 10,
        "latestFrameTime": last.time,
        "dataAgeMinutes": round(age_min),
        "observed": observed,
        "current": current,
        "echoFraction": round(echo_fraction, 4),
        "nearestEcho": nearest,
        "motion": None,
        "forecast": [],
        "arrival": None,
        "limitations": [
            "Não prevê formação ou dissipação de novas células de chuva.",
            "Assume deslocamento uniforme (translação) em todo o domínio.",
            "O horário dos quadros RainViewer é o de geração do mosaico.",
        ],
    }

    if motion["valid"]:
        vy, vx = motion["vy"], motion["vx"]
        speed_kmh = math.hypot(vy, vx) * km_px * 6
        toward = (math.degrees(math.atan2(vx, -vy)) + 360) % 360
        result["motion"] = {
            "speedKmh": round(speed_kmh),
            "towardDeg": round(toward),
            "toward": compass8(toward),
            "from": compass8(toward + 180),
            "pairs": motion["pairs"],
            "spreadKmh": round(motion["spreadPx"] * km_px * 6) if motion["spreadPx"] is not None else None,
            "rejected": motion["rejected"],
        }
        central = extrapolate_at_point(last.dbz, row, col, vy, vx, 1.0)
        fast = extrapolate_at_point(last.dbz, row, col, vy, vx, 1.25)
        slow = extrapolate_at_point(last.dbz, row, col, vy, vx, 0.75)
        for s in central:
            rate = float(rv.dbz_to_rain_rate(s["dbz"])) if s["dbz"] is not None and s["dbz"] >= ECHO_DBZ else 0.0
            result["forecast"].append(
                {
                    "lead": s["lead"],
                    "time": last.time + s["lead"] * 60,
                    "dbz": s["dbz"],
                    "rateMmH": round(rate, 1),
                    "class": rv.rain_class(rate),
                    "inDomain": s["inDomain"],
                }
            )
        a_c, a_f, a_s = first_arrival(central), first_arrival(fast), first_arrival(slow)
        # tempo de chegada contado a partir de agora (desconta a idade do último quadro)
        if a_c is not None and current["dbz"] is not None and current["dbz"] >= ECHO_DBZ:
            a_c = None  # já está chovendo — não há "chegada"
        if a_c is not None:
            wet = [s for s in result["forecast"] if s["lead"] >= a_c and s["class"]]
            duration = 0
            for s in result["forecast"]:
                if s["lead"] < a_c:
                    continue
                if not s["class"]:
                    break
                duration += 10
            early = min(x for x in (a_f, a_c) if x is not None)
            late = a_s if a_s is not None and a_s >= a_c else None
            result["arrival"] = {
                "centralMinutes": max(round(a_c - age_min), 0),
                "earliestMinutes": max(round(early - age_min), 0),
                "latestMinutes": max(round(late - age_min), 0) if late is not None else None,
                "durationMinutes": duration,
                "durationTruncated": a_c + duration > LEADS_MIN[-1],
                "maxClass": max(
                    (s["class"] for s in wet),
                    key=["fraca", "moderada", "forte", "muito forte"].index,
                    default=None,
                ),
                "from": result["motion"]["from"],
            }
    result["confidence"], result["confidenceReasons"] = _confidence(result, motion, age_min)
    return result


def _confidence(r: dict[str, Any], motion: dict[str, Any], age_min: float) -> tuple[str, list[str]]:
    reasons = []
    if age_min > 40:
        reasons.append(f"Último quadro de radar tem {round(age_min)} min")
        return "low", reasons
    if r["current"]["class"]:
        reasons.append("Chuva detectada pelo radar sobre o ponto agora")
    if r["echoFraction"] < MIN_ECHO_FRACTION:
        reasons.append(f"Sem ecos de chuva relevantes num raio de ~{r['domainRadiusKm']} km")
        reasons.append("Radar não antecipa células que ainda vão se formar")
        return "moderate", reasons
    if not motion["valid"]:
        reasons.append("Não foi possível estimar o deslocamento das células")
        return "low", reasons
    spread = r["motion"]["spreadKmh"]
    speed = r["motion"]["speedKmh"]
    if motion["pairs"] >= 3 and spread is not None and spread <= max(10, 0.5 * speed):
        reasons.append(f"Deslocamento consistente em {motion['pairs']} pares de quadros")
        level = "moderate"
    else:
        reasons.append("Deslocamento pouco consistente entre quadros")
        level = "low"
    if r["arrival"] and r["arrival"]["centralMinutes"] > 60:
        reasons.append("Chegada estimada além de 60 min: incerteza maior")
        level = "low"
    return level, reasons


async def nowcast(lat: float, lon: float) -> dict[str, Any]:
    """Orquestra: cobertura → quadros → análise. Nunca inventa quadros futuros."""
    try:
        maps = await rv.fetch_maps()
    except SourceError as exc:
        return {"available": False, "reason": f"RainViewer indisponível: {exc.message}"}
    if not maps["frames"]:
        return {"available": False, "reason": "RainViewer não retornou quadros de radar"}
    try:
        cov = await rv.coverage_at(lat, lon, maps["host"])
    except SourceError as exc:
        return {"available": False, "reason": f"Não foi possível verificar a cobertura: {exc.message}"}
    if not cov["covered"]:
        return {
            "available": False,
            "coverage": cov,
            "reason": "Sem cobertura de radar no RainViewer para esta localização",
        }
    # Centro ancorado em 0,25° (cache compartilhado); o ponto real é localizado por pixel.
    clat, clon = round(lat * 4) / 4, round(lon * 4) / 4
    fetched = await asyncio.gather(
        *(rv.fetch_frame(maps["host"], f, clat, clon) for f in maps["frames"]), return_exceptions=True
    )
    frames = [f for f in fetched if isinstance(f, rv.RadarImage)]
    if len(frames) < 2:
        return {"available": False, "coverage": cov, "reason": "Quadros de radar insuficientes"}
    result = analyze(frames, lat, lon)
    result["available"] = True
    result["coverage"] = cov
    result["source"] = rv.ATTRIBUTION
    result["stale"] = maps["stale"]
    if cov["areaFraction"] < 0.8:
        result["confidence"] = "low"
        result["confidenceReasons"].append("Cobertura de radar parcial no entorno")
    return result
