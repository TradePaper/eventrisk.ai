import dataclasses
from typing import List, Optional

import numpy as np

from core.types_v12 import (
    SimulationInputV12,
    StrategyMetrics,
    StrategyMode,
    RiskTransferCurve,
    RiskTransferPoint,
)
from core.strategies import simulate_strategy


def _objective_score(metrics: StrategyMetrics, objective: str) -> float:
    """Returns a scalar where higher is better."""
    if objective == "min_cvar":
        return metrics.cvar_95
    if objective == "min_max_loss":
        return metrics.max_loss
    if objective == "max_ev":
        return metrics.ev
    if objective == "max_sharpe":
        spread = max(metrics.p95 - metrics.p5, 1e-9)
        return metrics.ev / spread
    if objective == "target_ev_min_risk":
        if metrics.ev < 0:
            return float("-inf")
        return metrics.cvar_95
    if objective == "max_ev":
        return metrics.ev
    return metrics.cvar_95


def optimize_hedge_ratio(
    inp: SimulationInputV12,
    grid: Optional[np.ndarray] = None,
) -> StrategyMetrics:
    """
    Grid search hedge_fraction in [0, 1] (step 0.02 by default).
    Returns StrategyMetrics for the hedge_fraction that best satisfies inp.objective.
    """
    if grid is None:
        grid = np.arange(0.0, 1.01, 0.02)

    best_score = float("-inf")
    best_metrics: Optional[StrategyMetrics] = None

    for hf in grid:
        candidate = dataclasses.replace(inp, hedge_fraction=float(hf))
        metrics = simulate_strategy(candidate)
        score = _objective_score(metrics, inp.objective)
        if score > best_score:
            best_score = score
            best_metrics = dataclasses.replace(metrics, optimal_hedge_ratio=float(hf))

    assert best_metrics is not None
    return best_metrics


def build_risk_transfer_curve(
    base_input: SimulationInputV12,
    liabilities: List[float],
    strategy: StrategyMode,
) -> RiskTransferCurve:
    """
    For each liability, run optimize_hedge_ratio and collect a RiskTransferPoint.
    Returns the full RiskTransferCurve for the given strategy.
    """
    points: List[RiskTransferPoint] = []
    for liability in liabilities:
        inp = dataclasses.replace(base_input, liability=liability, strategy=strategy)
        metrics = optimize_hedge_ratio(inp)
        points.append(
            RiskTransferPoint(
                liability=liability,
                optimal_hedge_ratio=metrics.optimal_hedge_ratio,
                ev=metrics.ev,
                cvar_95=metrics.cvar_95,
                max_loss=metrics.max_loss,
            )
        )
    return RiskTransferCurve(strategy=strategy, points=points)
