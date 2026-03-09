from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class Outcome:
    name: str
    price: float
    implied_prob: float


@dataclass
class MarketData:
    event_id: str
    title: str
    outcomes: List[Outcome]
    price: float
    implied_prob: float
    source: str
    updated_at: str
    volume: Optional[float] = None
    end_date: Optional[str] = None
    sport: Optional[str] = None


@dataclass
class ProviderHealth:
    status: str
    last_ok_at: Optional[str]
    consecutive_errors: int
    stale: bool


class MarketProvider(ABC):
    @abstractmethod
    def get_markets(self, limit: int = 20) -> List[MarketData]:
        """Return a list of normalized market records."""

    @abstractmethod
    def get_prices(self, event_id: str) -> Optional[MarketData]:
        """Return a single market by event_id, or None if not found."""

    @abstractmethod
    def get_timestamp(self) -> str:
        """Return an ISO-8601 timestamp representing when data was last fetched."""
