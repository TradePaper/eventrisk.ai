"""
Divergence engine: cross-match markets from two sources by title similarity,
compute probability gap, confidence score, and action signal.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from providers.base import MarketData


@dataclass
class DivergencePoint:
    event_id_1: str
    event_id_2: str
    title: str
    source1: str
    source2: str
    prob1: float
    prob2: float
    gap: float          # abs(prob1 - prob2)
    gap_pct: float      # gap * 100
    confidence: float   # 0–1, higher = more liquid / larger gap
    action: str         # "buy_<source>" | "watch"
    volume1: Optional[float]
    volume2: Optional[float]
    sport: Optional[str] = None


# ---------------------------------------------------------------------------
# Sport inference
# ---------------------------------------------------------------------------

_SPORT_PATTERNS: List[Tuple[str, re.Pattern]] = [
    ("nfl",      re.compile(
        r"\bnfl\b|super[\s_-]?bowl|quarterback|touchdowns?|"
        r"patriots|cowboys|chiefs|giants|ravens|49ers|bears|bengals|"
        r"browns|broncos|texans|colts|jaguars|raiders|chargers|dolphins|"
        r"bills|jets|steelers|eagles|rams|seahawks|cardinals|falcons|"
        r"saints|buccaneers|panthers|vikings|packers|lions",
        re.I,
    )),
    ("nba",      re.compile(
        r"\bnba\b|basketball|playoffs\b|lakers|celtics|warriors|nets|"
        r"knicks|bulls|heat|bucks|sixers|raptors|suns|nuggets|clippers|"
        r"rockets|jazz|hornets|magic|pistons|hawks|grizzlies|pelicans|"
        r"kings|spurs|thunder|timberwolves|cavaliers|mavericks",
        re.I,
    )),
    ("mlb",      re.compile(
        r"\bmlb\b|baseball|world[\s_-]?series|yankees|dodgers|red sox|"
        r"cubs|astros|braves|mets|cardinals|phillies|giants|padres|"
        r"mariners|tigers|twins|white sox|athletics|blue jays|brewers|"
        r"pirates|rangers|reds|rockies|royals|angels|orioles|nationals|marlins",
        re.I,
    )),
    ("nhl",      re.compile(
        r"\bnhl\b|hockey|stanley[\s_-]?cup|penguins|capitals|"
        r"bruins|maple leafs|blackhawks|rangers|lightning|avalanche|"
        r"golden knights|oilers|flames|canucks|jets|senators|canadiens",
        re.I,
    )),
    ("soccer",   re.compile(
        r"\bsoccer\b|\bfootball\b(?!\s*(league|team).*nfl)|"
        r"premier[\s_-]?league|la[\s_-]?liga|champions[\s_-]?league|"
        r"world[\s_-]?cup|copa|bundesliga|serie[\s_-]?a|ligue[\s_-]?1|"
        r"man city|man utd|manchester|liverpool|arsenal|chelsea|barcelona|"
        r"real madrid|psg|juventus|inter milan|ac milan|bayern",
        re.I,
    )),
    ("ufc",      re.compile(
        r"\bufc\b|\bmma\b|octagon|fight night|conor|mcgregor|"
        r"adesanya|ngannou|jones|stipe|poirier|khabib",
        re.I,
    )),
    ("politics", re.compile(
        r"\bpresident\b|\belection\b|\belect\b|congressional|senate|"
        r"house seat|primary|democrat|republican|trump|biden|harris|"
        r"white[\s_-]?house|ballot|midterm|caucus|gop",
        re.I,
    )),
    ("crypto",   re.compile(
        r"\bbitcoin\b|\bbtc\b|\beth\b|\bethereum\b|\bcrypto\b|"
        r"\bblockchain\b|\bdefi\b|\bnft\b|\bsolana\b|\bcoinbase\b|"
        r"\bdoge\b|\bxrp\b|\bcardano\b",
        re.I,
    )),
    ("finance",  re.compile(
        r"\bfed\b|\bfomc\b|interest[\s_-]?rate|inflation|gdp|"
        r"\brecession\b|\bs&p\b|nasdaq|dow jones|treasury|yield curve",
        re.I,
    )),
    ("tennis",   re.compile(
        r"\btennis\b|wimbledon|us open|french open|australian open|"
        r"grand slam|djokovic|federer|nadal|serena|swiatek",
        re.I,
    )),
    ("golf",     re.compile(
        r"\bgolf\b|\bpga\b|masters|ryder cup|tiger woods|mcilroy|"
        r"scottie scheffler|jon rahm",
        re.I,
    )),
]


def infer_sport(title: str) -> Optional[str]:
    """Return the best sport tag for a market title, or None if unclassified."""
    for sport, pattern in _SPORT_PATTERNS:
        if pattern.search(title):
            return sport
    return None


# ---------------------------------------------------------------------------
# Title matching
# ---------------------------------------------------------------------------

_NON_ALNUM = re.compile(r"[^a-z0-9 ]")
_STOP = {"will", "the", "a", "an", "of", "in", "on", "to", "at", "by",
         "for", "be", "is", "or", "and", "who", "what", "win", "which"}


def _tokens(title: str) -> frozenset:
    words = _NON_ALNUM.sub("", title.lower()).split()
    return frozenset(w for w in words if w not in _STOP and len(w) > 1)


def _jaccard(t1: str, t2: str) -> float:
    s1, s2 = _tokens(t1), _tokens(t2)
    if not s1 or not s2:
        return 0.0
    return len(s1 & s2) / len(s1 | s2)


# ---------------------------------------------------------------------------
# Confidence
# ---------------------------------------------------------------------------

def _confidence(gap: float, vol1: Optional[float], vol2: Optional[float]) -> float:
    """
    Combines gap size and liquidity into a 0–1 score.
    Larger gap + higher volume → higher confidence.
    """
    vol = min(vol1 or 0.0, vol2 or 0.0) or 1.0
    vol_factor = math.log1p(vol) / math.log1p(1_000_000)   # 0–1 log scale
    raw = (gap / 0.20) * 0.6 + vol_factor * 0.4            # weighted blend
    return round(min(1.0, raw), 4)


# ---------------------------------------------------------------------------
# Main API
# ---------------------------------------------------------------------------

def compute_divergences(
    markets1: List[MarketData],
    markets2: List[MarketData],
    source1: str,
    source2: str,
    min_similarity: float = 0.30,
    min_gap: float = 0.005,
) -> List[DivergencePoint]:
    """
    Cross-match by title Jaccard similarity; return points sorted by gap desc.
    """
    results: List[DivergencePoint] = []

    for m1 in markets1:
        best_sim = 0.0
        best_m2: Optional[MarketData] = None
        for m2 in markets2:
            sim = _jaccard(m1.title, m2.title)
            if sim > best_sim:
                best_sim = sim
                best_m2 = m2

        if best_m2 is None or best_sim < min_similarity:
            continue

        gap = abs(m1.implied_prob - best_m2.implied_prob)
        if gap < min_gap:
            continue

        if m1.implied_prob > best_m2.implied_prob:
            action = f"buy_{source2}"
        else:
            action = f"buy_{source1}"

        v1 = getattr(m1, "volume", None)
        v2 = getattr(best_m2, "volume", None)

        results.append(DivergencePoint(
            event_id_1=m1.event_id,
            event_id_2=best_m2.event_id,
            title=m1.title,
            source1=source1,
            source2=source2,
            prob1=round(float(m1.implied_prob), 4),
            prob2=round(float(best_m2.implied_prob), 4),
            gap=round(gap, 4),
            gap_pct=round(gap * 100, 2),
            confidence=_confidence(gap, v1, v2),
            action=action,
            volume1=float(v1) if v1 is not None else None,
            volume2=float(v2) if v2 is not None else None,
            sport=infer_sport(m1.title),
        ))

    results.sort(key=lambda d: d.gap, reverse=True)
    return results


def divergence_history_from_snapshots(
    snapshots: List[Dict],
    source1: str,
    source2: str,
) -> List[Dict]:
    """
    Given a list of snapshot rows (from backtest.db.get_snapshots),
    pair up same-event rows from source1 vs source2 by nearest timestamp.
    Returns points sorted by time, each with gap_bps, abs_gap_bps, and sport.
    """
    from collections import defaultdict

    by_event_source: Dict[str, Dict[str, List]] = defaultdict(lambda: defaultdict(list))
    for s in snapshots:
        by_event_source[s["event_id"]][s["source"]].append(s)

    points: List[Dict] = []
    for eid, by_src in by_event_source.items():
        snaps1 = sorted(by_src.get(source1, []), key=lambda r: r["captured_at_utc"])
        snaps2 = sorted(by_src.get(source2, []), key=lambda r: r["captured_at_utc"])
        if not snaps1 or not snaps2:
            continue
        for s1, s2 in zip(snaps1, snaps2):
            gap     = s1["implied_prob"] - s2["implied_prob"]   # signed
            gap_bps = round(gap * 10_000)
            points.append({
                "timestamp_utc":    s1["captured_at_utc"],
                "event_id":         eid,
                "title":            s1["title"],
                "source1":          source1,
                "source2":          source2,
                "sportsbook_prob":  round(s1["implied_prob"], 4),
                "prediction_prob":  round(s2["implied_prob"], 4),
                "gap":              round(gap, 4),
                "gap_bps":          gap_bps,
                "abs_gap_bps":      abs(gap_bps),
                "sport":            infer_sport(s1["title"]),
            })

    points.sort(key=lambda p: p["timestamp_utc"])
    return points
