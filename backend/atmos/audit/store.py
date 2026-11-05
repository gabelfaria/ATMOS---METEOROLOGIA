"""Armazenamento SQLite das previsões emitidas pelo próprio ATMOS.

Privacidade: apenas a célula de 0,1° (~11 km) é registrada — nunca a coordenada exata,
nenhum identificador de usuário. Os registros podem ser apagados por célula (DELETE /api/privacy).
"""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

from .. import config
from ..geo import round_cell

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None
_path: Path | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS issued (
    cell_lat REAL NOT NULL,
    cell_lon REAL NOT NULL,
    issued_at INTEGER NOT NULL,
    valid_at INTEGER NOT NULL,
    lead_h INTEGER NOT NULL,
    variable TEXT NOT NULL,
    source TEXT NOT NULL,
    value REAL,
    PRIMARY KEY (cell_lat, cell_lon, issued_at, valid_at, variable, source)
);
CREATE INDEX IF NOT EXISTS issued_cell_valid ON issued(cell_lat, cell_lon, valid_at);
CREATE TABLE IF NOT EXISTS summary (
    cell_lat REAL NOT NULL,
    cell_lon REAL NOT NULL,
    issued_at INTEGER NOT NULL,
    rain24h REAL,
    maxprob24h REAL,
    maxgust24h REAL,
    PRIMARY KEY (cell_lat, cell_lon, issued_at)
);
"""


def connect(path: Path | None = None) -> sqlite3.Connection:
    global _conn, _path
    path = path or config.DB_PATH
    with _lock:
        if _conn is None or _path != path:
            path.parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(str(path), check_same_thread=False)
            _conn.executescript(SCHEMA)
            _path = path
        return _conn


def last_issue_time(lat: float, lon: float) -> int | None:
    c = connect()
    cl, cn = round_cell(lat, lon)
    row = c.execute(
        "SELECT MAX(issued_at) FROM summary WHERE cell_lat=? AND cell_lon=?", (cl, cn)
    ).fetchone()
    return row[0] if row and row[0] else None


def previous_summary(lat: float, lon: float, before: int) -> dict[str, Any] | None:
    c = connect()
    cl, cn = round_cell(lat, lon)
    row = c.execute(
        "SELECT issued_at, rain24h, maxprob24h, maxgust24h FROM summary "
        "WHERE cell_lat=? AND cell_lon=? AND issued_at<=? ORDER BY issued_at DESC LIMIT 1",
        (cl, cn, before),
    ).fetchone()
    if not row:
        return None
    return {"issuedAt": row[0], "rain24h": row[1], "maxProb24h": row[2], "maxGust24h": row[3]}


def record_issue(
    lat: float,
    lon: float,
    issued_at: int,
    rows: Iterable[tuple[int, int, str, str, float | None]],
    summary: dict[str, float | None],
    min_interval_s: int = 3600,
) -> bool:
    """Grava no máximo uma emissão por célula por hora. rows = (valid_at, lead_h, variable, source, value)."""
    last = last_issue_time(lat, lon)
    if last and issued_at - last < min_interval_s:
        return False
    c = connect()
    cl, cn = round_cell(lat, lon)
    with _lock:
        c.executemany(
            "INSERT OR REPLACE INTO issued VALUES (?,?,?,?,?,?,?,?)",
            [(cl, cn, issued_at, v, lead, var, src, val) for v, lead, var, src, val in rows],
        )
        c.execute(
            "INSERT OR REPLACE INTO summary VALUES (?,?,?,?,?,?)",
            (cl, cn, issued_at, summary.get("rain24h"), summary.get("maxProb24h"), summary.get("maxGust24h")),
        )
        c.commit()
    return True


def issued_for_verification(lat: float, lon: float, until: int, variable: str) -> list[dict[str, Any]]:
    c = connect()
    cl, cn = round_cell(lat, lon)
    rows = c.execute(
        "SELECT issued_at, valid_at, lead_h, source, value FROM issued "
        "WHERE cell_lat=? AND cell_lon=? AND variable=? AND valid_at<=? AND value IS NOT NULL",
        (cl, cn, variable, until),
    ).fetchall()
    return [
        {"issuedAt": r[0], "validAt": r[1], "leadH": r[2], "source": r[3], "value": r[4]} for r in rows
    ]


def delete_cell(lat: float, lon: float) -> int:
    c = connect()
    cl, cn = round_cell(lat, lon)
    with _lock:
        n = c.execute("DELETE FROM issued WHERE cell_lat=? AND cell_lon=?", (cl, cn)).rowcount
        c.execute("DELETE FROM summary WHERE cell_lat=? AND cell_lon=?", (cl, cn))
        c.commit()
    return n


def stats() -> dict[str, Any]:
    c = connect()
    n = c.execute("SELECT COUNT(*), COUNT(DISTINCT issued_at) FROM issued").fetchone()
    return {"rows": n[0], "issuances": n[1], "since": time.time()}
