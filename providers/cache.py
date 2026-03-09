import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from .base import MarketProvider, MarketData, ProviderHealth

_STALE_SECONDS = 300
_CIRCUIT_THRESHOLD = 3      # errors before opening circuit
_BACKOFF_BASE = 10          # seconds for first backoff window
_BACKOFF_CAP = 120          # max backoff seconds


def _backoff_seconds(consecutive_errors: int) -> float:
    """Exponential backoff capped at _BACKOFF_CAP."""
    exponent = max(0, consecutive_errors - _CIRCUIT_THRESHOLD)
    return min(_BACKOFF_CAP, _BACKOFF_BASE * (2 ** exponent))


class CachedProvider(MarketProvider):
    """
    Wraps any MarketProvider with a simple in-memory TTL cache.
    Tracks health: ok | degraded | down.
    Serves stale cache data when the inner provider raises.
    Implements a circuit-breaker: after CIRCUIT_THRESHOLD consecutive errors
    the provider is skipped for an exponentially increasing backoff window,
    preventing thrashing against a failing upstream.
    """

    def __init__(self, inner: MarketProvider, ttl: int = 30):
        self._inner = inner
        self._ttl = ttl
        self._markets_cache: Tuple[float, List[MarketData]] = (0.0, [])
        self._prices_cache: Dict[str, Tuple[float, Optional[MarketData]]] = {}
        self._timestamp: str = ""
        self._last_ok_mono: Optional[float] = None
        self._last_ok_wall: Optional[str] = None
        self._consecutive_errors: int = 0
        self._circuit_open_until: float = 0.0

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _markets_stale(self) -> bool:
        cached_at, cached_markets = self._markets_cache
        if not cached_markets:
            return True
        return time.monotonic() - cached_at > self._ttl

    def _prices_stale(self, event_id: str) -> bool:
        entry = self._prices_cache.get(event_id)
        if entry is None:
            return True
        cached_at, _ = entry
        return time.monotonic() - cached_at > self._ttl

    def _circuit_is_open(self) -> bool:
        return (
            self._consecutive_errors >= _CIRCUIT_THRESHOLD
            and time.monotonic() < self._circuit_open_until
        )

    def _record_ok(self) -> None:
        self._consecutive_errors = 0
        self._circuit_open_until = 0.0
        self._last_ok_mono = time.monotonic()
        self._last_ok_wall = datetime.now(timezone.utc).isoformat()

    def _record_error(self) -> None:
        self._consecutive_errors += 1
        if self._consecutive_errors >= _CIRCUIT_THRESHOLD:
            self._circuit_open_until = (
                time.monotonic() + _backoff_seconds(self._consecutive_errors)
            )

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    @property
    def health(self) -> ProviderHealth:
        stale = False
        if self._last_ok_mono is not None:
            stale = (time.monotonic() - self._last_ok_mono) > _STALE_SECONDS

        _, cached_markets = self._markets_cache
        has_data = bool(cached_markets)

        if self._consecutive_errors == 0:
            status = "ok"
        elif has_data and self._consecutive_errors <= 2:
            status = "degraded"
        else:
            status = "down"

        return ProviderHealth(
            status=status,
            last_ok_at=self._last_ok_wall,
            consecutive_errors=self._consecutive_errors,
            stale=stale,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_markets(self, limit: int = 20) -> List[MarketData]:
        if not self._markets_stale():
            _, cached = self._markets_cache
            return cached[:limit]

        if self._circuit_is_open():
            _, stale = self._markets_cache
            if stale:
                return stale[:limit]
            raise RuntimeError("circuit open and no cached data")

        try:
            fresh = self._inner.get_markets(limit)
            self._markets_cache = (time.monotonic(), fresh)
            self._timestamp = self._inner.get_timestamp()
            self._record_ok()
            return fresh
        except Exception:
            self._record_error()
            _, stale = self._markets_cache
            if stale:
                return stale[:limit]
            raise

    def get_prices(self, event_id: str) -> Optional[MarketData]:
        if not self._prices_stale(event_id):
            _, cached = self._prices_cache[event_id]
            return cached

        if self._circuit_is_open():
            entry = self._prices_cache.get(event_id)
            if entry:
                _, stale = entry
                return stale
            raise RuntimeError("circuit open and no cached data")

        try:
            fresh = self._inner.get_prices(event_id)
            self._prices_cache[event_id] = (time.monotonic(), fresh)
            self._timestamp = self._inner.get_timestamp()
            self._record_ok()
            return fresh
        except Exception:
            self._record_error()
            entry = self._prices_cache.get(event_id)
            if entry:
                _, stale = entry
                return stale
            raise

    def get_timestamp(self) -> str:
        return self._timestamp or self._inner.get_timestamp()

    def invalidate(self) -> None:
        self._markets_cache = (0.0, [])
        self._prices_cache = {}
