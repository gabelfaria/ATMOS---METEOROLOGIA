"""Fixtures: respostas REAIS gravadas das APIs (05/11/2026, Rio de Janeiro) para testes offline."""

from __future__ import annotations

import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FIX = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def to_unix(payload: dict) -> dict:
    """Converte horários ISO locais (timezone=auto) em epoch, como pedimos em produção (timeformat=unixtime)."""
    off = payload.get("utc_offset_seconds", 0)

    def conv(s):
        if isinstance(s, (int, float)):
            return s
        fmt = "%Y-%m-%dT%H:%M" if "T" in s else "%Y-%m-%d"
        return int(datetime.strptime(s, fmt).replace(tzinfo=timezone.utc).timestamp()) - off

    out = json.loads(json.dumps(payload))
    for block in ("hourly", "daily", "minutely_15"):
        if block in out and "time" in out[block]:
            out[block]["time"] = [conv(t) for t in out[block]["time"]]
    if "current" in out and "time" in out["current"]:
        out["current"]["time"] = conv(out["current"]["time"])
    return out


@pytest.fixture
def multi():
    return to_unix(load("multi.json"))


@pytest.fixture
def ens_hourly():
    return to_unix(load("ensh.json"))


@pytest.fixture
def ens_daily():
    return to_unix(load("ens_daily.json"))


@pytest.fixture
def current():
    return to_unix(load("current.json"))


@pytest.fixture
def metar_raw():
    return load("metar.json")


@pytest.fixture
def inmet_raw():
    return load("inmet_avisos.json")


@pytest.fixture
def radar_png() -> bytes:
    return (FIX / "radar_z7_512.png").read_bytes()


def transparent_png(size: int = 256) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", (size, size), (0, 0, 0, 0)).save(buf, "PNG")
    return buf.getvalue()


def black_png(size: int = 256) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", (size, size), (0, 0, 0, 255)).save(buf, "PNG")
    return buf.getvalue()
