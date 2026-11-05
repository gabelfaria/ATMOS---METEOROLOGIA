import numpy as np

from atmos.adapters import rainviewer as rv
from atmos.nowcast import radar

SIZE = 256


def blob(cy: float, cx: float, peak: float = 45.0, sigma: float = 8.0) -> np.ndarray:
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    d = peak * np.exp(-((yy - cy) ** 2 + (xx - cx) ** 2) / (2 * sigma**2))
    img = np.full((SIZE, SIZE), rv.NO_DATA, dtype=np.float32)
    img[d >= 10] = d[d >= 10]
    return img


def frames_moving_east(start_col: float, step: float, n: int = 7, t0: int = 1_000_000):
    out = []
    for i in range(n):
        img = blob(SIZE / 2, start_col + i * step)
        out.append(rv.RadarImage(img, -22.9, -43.2, 6, t0 + i * 600))
    return out


def test_decode_real_tile(radar_png):
    dbz = rv.decode_dbz(radar_png)
    assert dbz.shape == (512, 512)
    valid = dbz[dbz > rv.NO_DATA]
    assert valid.size > 0
    assert valid.min() >= -32 and valid.max() <= 95


def test_color_table_is_rain_only():
    colors, dbz = rv.color_table()
    assert len(colors) == len(dbz) and len(set(dbz.tolist())) == len(dbz)


def test_marshall_palmer():
    assert abs(float(rv.dbz_to_rain_rate(20)) - 0.65) < 0.05
    assert rv.rain_class(1.0) == "fraca" and rv.rain_class(5) == "moderada" and rv.rain_class(20) == "forte"
    assert rv.rain_class(0.1) is None


def test_phase_correlation_recovers_shift():
    a = radar._motion_field(blob(100, 100))
    b = radar._motion_field(blob(103, 106))
    dy, dx, q = radar.phase_correlation(a, b)
    assert abs(dy - 3) < 0.6 and abs(dx - 6) < 0.6 and q > 5


def test_motion_east_and_arrival_from_west():
    frames = frames_moving_east(start_col=70, step=4)  # 4 px / 10 min para leste
    now = frames[-1].time
    r = radar.analyze(frames, -22.9, -43.2, now=now)
    assert r["motion"]["toward"] == "leste" and r["motion"]["from"] == "oeste"
    assert r["arrival"] is not None
    assert r["arrival"]["from"] == "oeste"
    # último quadro: centro na coluna 94; ponto na 128; borda ≥20 dBZ a ~8 px → ~26 px ≈ 65 min
    assert 50 <= r["arrival"]["centralMinutes"] <= 90
    assert r["arrival"]["earliestMinutes"] <= r["arrival"]["centralMinutes"]
    assert r["confidence"] in ("low", "moderate")
    assert all(s["lead"] % 10 == 0 for s in r["forecast"])  # resolução real de 10 min


def test_no_echoes_means_no_arrival_and_explicit_reason():
    empty = np.full((SIZE, SIZE), rv.NO_DATA, dtype=np.float32)
    frames = [rv.RadarImage(empty.copy(), -22.9, -43.2, 6, 1_000_000 + i * 600) for i in range(5)]
    r = radar.analyze(frames, -22.9, -43.2, now=frames[-1].time)
    assert r["arrival"] is None and r["motion"] is None
    assert r["current"]["class"] is None
    assert any("Sem ecos" in x for x in r["confidenceReasons"])
    assert any("não antecipa" in x for x in r["confidenceReasons"])


def test_identical_frames_are_rejected():
    img = blob(128, 60)
    m = radar.estimate_motion([img, img.copy(), img.copy()], [0, 600, 1200])
    assert not m["valid"] and "quadro repetido" in m["rejected"]


def test_rain_over_point_is_not_an_arrival():
    frames = [rv.RadarImage(blob(SIZE / 2, SIZE / 2 + i), -22.9, -43.2, 6, 1_000_000 + i * 600) for i in range(6)]
    r = radar.analyze(frames, -22.9, -43.2, now=frames[-1].time)
    assert r["current"]["class"] is not None
    assert r["arrival"] is None


def test_old_data_lowers_confidence():
    frames = frames_moving_east(start_col=40, step=4)
    r = radar.analyze(frames, -22.9, -43.2, now=frames[-1].time + 3600)
    assert r["confidence"] == "low"
