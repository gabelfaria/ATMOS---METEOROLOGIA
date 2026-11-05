"""Cliente HTTP compartilhado com cache TTL em memória e fallback para dado antigo.

Objetivos:
- respeitar limites das APIs públicas (Open-Meteo, Nominatim etc.) evitando chamadas repetidas;
- manter o app funcionando quando uma API cai (stale-if-error), sempre informando a idade do dado.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import httpx

from . import config


class SourceError(Exception):
    """Falha ao obter dados de uma fonte. A mensagem é exibível ao usuário."""

    def __init__(self, source: str, message: str):
        super().__init__(f"{source}: {message}")
        self.source = source
        self.message = message


@dataclass
class CacheEntry:
    value: Any
    stored_at: float
    ttl: float


@dataclass
class Fetched:
    """Resultado de uma busca com metadados de rastreabilidade."""

    value: Any
    fetched_at: float  # epoch (s) em que o dado foi obtido do provedor
    from_cache: bool
    stale: bool  # True se a fonte falhou e estamos servindo cópia antiga


class HttpCache:
    def __init__(self, max_entries: int = 2000):
        self._data: dict[str, CacheEntry] = {}
        self._max = max_entries
        self._locks: dict[str, asyncio.Lock] = {}

    def lock(self, key: str) -> asyncio.Lock:
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    def get(self, key: str) -> CacheEntry | None:
        return self._data.get(key)

    def set(self, key: str, value: Any, ttl: float) -> None:
        if len(self._data) >= self._max:
            # remove as entradas mais antigas
            for k in sorted(self._data, key=lambda k: self._data[k].stored_at)[: self._max // 10]:
                self._data.pop(k, None)
        self._data[key] = CacheEntry(value, time.time(), ttl)

    def clear(self) -> None:
        self._data.clear()


cache = HttpCache()
_client: httpx.AsyncClient | None = None
_transport: httpx.AsyncBaseTransport | None = None  # permite injetar MockTransport nos testes


def set_transport(transport: httpx.AsyncBaseTransport | None) -> None:
    global _client, _transport
    _transport = transport
    _client = None
    cache.clear()


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=config.HTTP_TIMEOUT,
            headers={"User-Agent": config.USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9"},
            follow_redirects=True,
            transport=_transport,
        )
    return _client


async def fetch(
    source: str,
    url: str,
    params: dict[str, Any] | None = None,
    ttl: float = 600,
    kind: str = "json",
    max_stale: float = 6 * 3600,
) -> Fetched:
    """Busca com cache. `kind` = json | bytes | text."""
    key = url + "?" + "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
    now = time.time()
    entry = cache.get(key)
    if entry and now - entry.stored_at < entry.ttl:
        return Fetched(entry.value, entry.stored_at, True, False)

    async with cache.lock(key):
        entry = cache.get(key)
        if entry and time.time() - entry.stored_at < entry.ttl:
            return Fetched(entry.value, entry.stored_at, True, False)
        try:
            resp = await client().get(url, params=params)
            if resp.status_code == 429:
                raise SourceError(source, "limite de requisições atingido (HTTP 429)")
            if resp.status_code >= 400:
                reason = ""
                try:
                    reason = resp.json().get("reason", "")
                except Exception:  # noqa: BLE001
                    pass
                raise SourceError(source, f"HTTP {resp.status_code} {reason}".strip())
            if kind == "json":
                value = resp.json()
                if isinstance(value, dict) and value.get("error"):
                    raise SourceError(source, str(value.get("reason", "erro desconhecido")))
            elif kind == "bytes":
                value = resp.content
            else:
                value = resp.text
        except SourceError as exc:
            if entry and time.time() - entry.stored_at < max_stale:
                return Fetched(entry.value, entry.stored_at, True, True)
            raise exc
        except (httpx.HTTPError, ValueError) as exc:
            if entry and time.time() - entry.stored_at < max_stale:
                return Fetched(entry.value, entry.stored_at, True, True)
            raise SourceError(source, f"indisponível ({type(exc).__name__})") from exc
        cache.set(key, value, ttl)
        return Fetched(value, time.time(), False, False)
