from typing import Dict, Iterable, List

from backtest.engine import Trade


def _resolved(trades: Iterable[Trade]) -> List[Trade]:
    return [t for t in trades if t.realized_pnl is not None]


def realized_pnl(trades: Iterable[Trade]) -> float:
    return float(sum((t.realized_pnl or 0.0) for t in trades if t.realized_pnl is not None))


def max_drawdown(equity_values: List[float]) -> float:
    peak = None
    worst = 0.0
    for value in equity_values:
        if peak is None or value > peak:
            peak = value
        drawdown = (peak - value) if peak is not None else 0.0
        if drawdown > worst:
            worst = drawdown
    return float(worst)


def hit_rate(trades: Iterable[Trade]) -> float:
    resolved = _resolved(trades)
    if not resolved:
        return 0.0
    wins = sum(1 for t in resolved if (t.realized_pnl or 0.0) > 0)
    return wins / len(resolved)


def turnover(trades: Iterable[Trade]) -> float:
    return float(sum(abs(t.effective_hedge) for t in trades))


def ev_error(trades: Iterable[Trade]) -> float:
    resolved = _resolved(trades)
    if not resolved:
        return 0.0
    return float(sum(abs((t.predicted_ev or 0.0) - (t.realized_pnl or 0.0)) for t in resolved) / len(resolved))


def brier_score(trades: Iterable[Trade]) -> float:
    resolved = [t for t in trades if t.outcome_yes is not None]
    if not resolved:
        return 0.0
    total = 0.0
    for t in resolved:
        y = 1.0 if t.outcome_yes else 0.0
        total += (t.implied_prob - y) ** 2
    return float(total / len(resolved))


def calibration_buckets(trades: Iterable[Trade], bucket_size: float = 0.1) -> List[Dict]:
    buckets: Dict[int, Dict] = {}
    for t in trades:
        if t.outcome_yes is None:
            continue
        idx = min(9, max(0, int(t.implied_prob / bucket_size)))
        if idx not in buckets:
            lo = idx * bucket_size
            hi = lo + bucket_size
            buckets[idx] = {
                "bucket": f"{lo:.1f}-{hi:.1f}",
                "n_samples": 0,
                "avg_pred": 0.0,
                "empirical_yes": 0.0,
            }
        b = buckets[idx]
        b["n_samples"] += 1
        b["avg_pred"] += t.implied_prob
        b["empirical_yes"] += 1.0 if t.outcome_yes else 0.0

    out = []
    for idx in sorted(buckets):
        b = buckets[idx]
        n = b["n_samples"]
        b["avg_pred"] = b["avg_pred"] / n if n else 0.0
        b["empirical_yes"] = b["empirical_yes"] / n if n else 0.0
        out.append(b)
    return out


def equity_curve(trades: Iterable[Trade]) -> List[Dict]:
    points: List[Dict] = []
    running = 0.0
    for t in trades:
        running += float(t.realized_pnl or 0.0)
        points.append({"captured_at_utc": t.captured_at_utc, "equity": running})
    return points


def drawdown_curve(equity_points: List[Dict]) -> List[Dict]:
    peak = None
    out: List[Dict] = []
    for pt in equity_points:
        equity = float(pt["equity"])
        if peak is None or equity > peak:
            peak = equity
        out.append(
            {
                "captured_at_utc": pt["captured_at_utc"],
                "equity": equity,
                "drawdown": float((peak - equity) if peak is not None else 0.0),
            }
        )
    return out


def full_report(trades: List[Trade]) -> Dict:
    eq = equity_curve(trades)
    dd = drawdown_curve(eq)
    resolved = _resolved(trades)
    return {
        "realized_pnl": realized_pnl(trades),
        "max_drawdown": max_drawdown([p["equity"] for p in eq]),
        "hit_rate": hit_rate(trades),
        "turnover": turnover(trades),
        "ev_error": ev_error(trades),
        "brier_score": brier_score(trades),
        "n_trades": len(trades),
        "n_resolved": len(resolved),
        "equity_curve": eq,
        "drawdown_curve": dd,
        "calibration_buckets": calibration_buckets(trades),
    }

