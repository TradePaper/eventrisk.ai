import hashlib
import random
from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass
class Trade:
    event_id: str
    captured_at_utc: str
    strategy: str
    implied_prob: float
    predicted_ev: float
    stake: float
    liability: float
    effective_hedge: float
    fill: bool
    outcome_yes: Optional[bool]
    realized_pnl: Optional[float]


def _seed_to_int(seed: Optional[str]) -> int:
    digest = hashlib.sha256((seed or "default").encode("utf-8")).hexdigest()
    return int(digest[:16], 16)


def run_backtest(
    snapshots: List[Dict],
    outcomes: Dict[str, Dict],
    strategy: str,
    params: Dict,
    seed: Optional[str] = None,
) -> List[Trade]:
    rng = random.Random(_seed_to_int(seed))
    trades: List[Trade] = []

    stake = float(params.get("stake", 100.0))
    hedge_fraction = float(params.get("hedge_fraction", 0.5))
    fill_probability = float(params.get("fill_probability", 1.0))
    true_win_prob = float(params.get("true_win_prob", 0.5))

    ordered = sorted(snapshots, key=lambda s: s.get("captured_at_utc", ""))
    for snap in ordered:
        event_id = str(snap.get("event_id", ""))
        implied_prob = float(snap.get("implied_prob", snap.get("price", 0.5)))
        fill = rng.random() < max(0.0, min(1.0, fill_probability))

        edge = (true_win_prob - implied_prob) * stake
        noise = rng.uniform(-0.05, 0.05) * stake
        predicted_ev = edge + noise

        if strategy == "internal_reprice":
            effective_hedge = 0.0
        elif strategy == "hybrid":
            effective_hedge = stake * hedge_fraction * 0.5
        else:
            effective_hedge = stake * hedge_fraction

        outcome = outcomes.get(event_id)
        outcome_yes: Optional[bool] = None
        realized: Optional[float] = None
        if outcome is not None:
            outcome_yes = str(outcome.get("resolved_outcome", "")).upper() == "YES"
            if fill:
                direction_yes = implied_prob <= 0.5
                won = direction_yes == outcome_yes
                realized = stake if won else -stake
            else:
                realized = 0.0

        trades.append(
            Trade(
                event_id=event_id,
                captured_at_utc=str(snap.get("captured_at_utc", "")),
                strategy=strategy,
                implied_prob=implied_prob,
                predicted_ev=predicted_ev,
                stake=stake,
                liability=stake * 1.9,
                effective_hedge=effective_hedge,
                fill=fill,
                outcome_yes=outcome_yes,
                realized_pnl=realized,
            )
        )

    return trades

