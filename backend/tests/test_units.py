import math

from atmos import geo
from atmos.adapters import inmet, metar, openmeteo
from atmos.audit import verify
from atmos.engine import stats


def test_haversine_rio_niteroi():
    d = geo.haversine_km(-22.9068, -43.1729, -22.8832, -43.1034)
    assert 7 < d < 8


def test_bearing_and_compass():
    assert geo.compass8(geo.bearing_deg(0, 0, 1, 0)) == "norte"
    assert geo.compass8(geo.bearing_deg(0, 0, 0, 1)) == "leste"
    assert geo.compass8(225) == "sudoeste"


def test_point_in_polygon_with_hole():
    square = {"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
                                                 [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]}
    assert geo.point_in_geometry(2, 2, square)
    assert not geo.point_in_geometry(5, 5, square)  # buraco
    assert not geo.point_in_geometry(11, 5, square)


def test_mercator_roundtrip():
    x, y = geo.lonlat_to_world_px(-43.2, -22.9, 6, 512)
    lon, lat = geo.world_px_to_lonlat(x, y, 6, 512)
    assert abs(lon + 43.2) < 1e-9 and abs(lat + 22.9) < 1e-9


def test_weighted_median_is_robust_to_outlier():
    vals = [24.0, 24.5, 25.0, 40.0]
    assert stats.weighted_median(vals, [1, 1, 1, 1]) < 26
    # média simples seria puxada pelo valor discrepante
    assert sum(vals) / 4 > 28


def test_weighted_quantile_bounds():
    assert stats.weighted_quantile([1, 2, 3], [1, 1, 1], 0.0) == 1
    assert stats.weighted_quantile([1, 2, 3], [1, 1, 1], 1.0) == 3
    assert stats.weighted_quantile([1, 2, 3], [1, 1, 1], 0.5) == 2


def test_circular_mean():
    assert round(stats.circular_mean_deg([350, 10], [1, 1])) % 360 == 0


def test_split_by_model(multi):
    models = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless", "ukmo_seamless", "jma_seamless"]
    out = openmeteo.split_by_model(multi["hourly"], openmeteo.HOURLY_VARS, models)
    assert len(out["gfs_seamless"]["temperature_2m"]) == len(multi["hourly"]["time"])
    assert "precipitation" in out["icon_seamless"]


def test_split_single_model_has_no_suffix():
    out = openmeteo.split_by_model({"time": [1], "temperature_2m": [20]}, ["temperature_2m"], ["ecmwf_ifs"])
    assert out["ecmwf_ifs"]["temperature_2m"] == [20]


def test_parse_ensemble_members(ens_hourly):
    parsed = openmeteo.parse_ensemble(ens_hourly["hourly"], ["precipitation", "wind_gusts_10m"])
    ids = {openmeteo.ensemble_id_for_suffix(s): v for s, v in parsed.items()}
    assert set(ids) == {"ecmwf_ifs025", "gfs025", "icon_seamless"}
    assert len(ids["ecmwf_ifs025"]["precipitation"]) == 51  # controle + 50
    assert len(ids["gfs025"]["precipitation"]) == 31
    assert len(ids["icon_seamless"]["precipitation"]) == 40


def test_metar_weather_parsing():
    w = metar.parse_wx("-RA VCTS")
    assert w["precipAtStation"] and w["intensity"] == "fraca"
    assert w["thunderVicinity"] and not w["thunder"]
    w = metar.parse_wx("TSRA")
    assert w["thunder"] and w["precipAtStation"] and w["intensity"] == "moderada"
    assert w["description"] == ["trovoada com chuva moderada"]
    w = metar.parse_wx("+SHRA")
    assert w["intensity"] == "forte"
    w = metar.parse_wx("VCSH")
    assert not w["precipAtStation"] and w["precipVicinity"]
    assert not metar.parse_wx("BR")["precipAtStation"]
    assert not metar.parse_wx(None)["precipAtStation"]


def test_metar_normalize_units(metar_raw):
    o = metar.normalize(metar_raw[0], -22.9, -43.2)
    raw = metar_raw[0]
    if isinstance(raw.get("wspd"), (int, float)):
        assert o["windSpeed"] == round(raw["wspd"] * 1.852)
    assert o["kind"] == "observation"
    assert 0 <= o["humidity"] <= 100
    assert o["distanceKm"] < 120


def test_inmet_normalize_and_filter(inmet_raw):
    alerts = [inmet.normalize(a, "hoje") for a in inmet_raw["hoje"]]
    assert all(a["kind"] == "official" and a["authority"] == "INMET" for a in alerts)
    a = alerts[0]
    ring = a["geometry"]["coordinates"][0] if a["geometry"]["type"] == "Polygon" else a["geometry"]["coordinates"][0][0]
    # um ponto no meio do polígono (média dos vértices pode cair fora; testamos fora com certeza)
    far = inmet.alerts_for_point(alerts, 60.0, 10.0, now=a["start"] + 1)
    assert far == []
    assert len(ring) > 3


def test_inmet_risks_accepts_list_or_string():
    assert inmet._parse_list(["a", "b"]) == ["a", "b"]
    assert inmet._parse_list("['x']") == ["x"]


def test_contingency_scores():
    c = verify.contingency([(True, True), (True, False), (False, True), (False, False)])
    assert c["hits"] == 1 and c["misses"] == 1 and c["falseAlarms"] == 1
    assert c["pod"] == 0.5 and c["far"] == 0.5 and math.isclose(c["csi"], 0.33, abs_tol=0.01)


def test_best_model_requires_sample_and_margin():
    def m(name, mae_, n):
        return {"model": name, "name": name, "leads": {"day1": {"temperature": {"mae": mae_, "n": n}}}}

    assert not verify.best_model([m("a", 1.0, 30), m("b", 2.0, 30)], "day1")["declared"]
    assert not verify.best_model([m("a", 1.0, 100), m("b", 1.1, 100)], "day1")["declared"]
    assert verify.best_model([m("a", 1.0, 100), m("b", 1.6, 100)], "day1")["declared"]


def test_brier():
    assert stats.brier([(1.0, 1), (0.0, 0)]) == 0
    assert stats.brier([(0.5, 1)]) == 0.25
