import hashlib
import numpy as np

from core.types_v12 import SimulationInputV12, StrategyMetrics
from core.liquidity import (
    max_hedge_notional,
    apply_hedge_cap,
    market_impact_delta_price,
    effective_cost_rate,
)
from core.metrics import cvar as _cvar


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_rng(seed) -> np.random.Generator:
    if seed is None:
        return np.random.default_rng()
    seed_int = int(hashlib.md5(str(seed).encode()).hexdigest(), 16) % (2 ** 32)
    return np.random.default_rng(seed_int)


def _american_to_prob(odds: int) -> float:
    if odds < 0:
        return -odds / (-odds + 100.0)
    return 100.0 / (odds + 100.0)


def _derive_liability(stake: float, odds: int) -> float:
    if odds < 0:
        winnings = stake * (100.0 / -odds)
    else:
        winnings = stake * odds / 100.0
    return stake + winnings


def _liquidity_params(inp: SimulationInputV12, requested_hedge: float):
    """Returns (effective_hedge, cost_rate, utilization, max_hedge)."""
    base_cost = (inp.slippage_bps + inp.fee_bps + inp.latency_bps) / 10_000.0
    if inp.liquidity:
        liq = inp.liquidity
        max_h = max_hedge_notional(liq.available_liquidity, liq.participation_rate)
        eff_h = apply_hedge_cap(requested_hedge, max_h)
        impact = market_impact_delta_price(
            eff_h,
            liq.available_liquidity,
            liq.impact_factor,
            liq.depth_exponent,
        )
        utilization = eff_h / max(max_h, 1e-9)
    else:
        max_h = float("inf")
        eff_h = requested_hedge
        impact = 0.0
        utilization = 1.0 if requested_hedge > 0 else 0.0
    cost_rate = effective_cost_rate(base_cost, impact)
    return eff_h, cost_rate, utilization, max_h


def _build_metrics(
    pnl: np.ndarray,
    hedge_fraction: float,
    eff_h: float,
    utilization: float,
    cvar_alpha: float,
) -> StrategyMetrics:
    return StrategyMetrics(
        ev=float(pnl.mean()),
        p5=float(np.percentile(pnl, 5)),
        p50=float(np.percentile(pnl, 50)),
        p95=float(np.percentile(pnl, 95)),
        max_loss=float(pnl.min()),
        cvar_95=_cvar(pnl.tolist(), alpha=cvar_alpha),
        optimal_hedge_ratio=hedge_fraction,
        effective_hedge_notional=eff_h,
        hedge_utilization=utilization,
    )


# ---------------------------------------------------------------------------
# External hedge
# ---------------------------------------------------------------------------

def _external_hedge_paths(inp: SimulationInputV12) -> tuple[np.ndarray, float, float]:
    """Returns (pnl_paths, effective_hedge_notional, hedge_utilization)."""
    rng = _make_rng(inp.seed)
    p_market = _american_to_prob(inp.american_odds)
    liability = inp.liability if inp.liability > 0 else _derive_liability(inp.stake, inp.american_odds)

    requested_hedge = inp.hedge_fraction * liability
    eff_h, cost_rate, utilization, _ = _liquidity_params(inp, requested_hedge)
    hedge_premium_rate = p_market * (1.0 + cost_rate)

    n = inp.n_paths
    fills = rng.random(n) < inp.fill_probability
    yes = rng.random(n) < inp.true_win_prob

    eff_hedges = np.where(fills, eff_h, 0.0)
    premiums = eff_hedges * hedge_premium_rate

    pnl = np.where(
        yes,
        (inp.stake - liability) + eff_hedges - premiums,
        inp.stake - premiums,
    )
    return pnl, eff_h, utilization


def simulate_external_hedge(inp: SimulationInputV12) -> StrategyMetrics:
    """
    Sportsbook buys YES contracts on the prediction market to offset liability.

    Per path:
      requested_hedge = hedge_fraction * liability
      effective_hedge = min(requested_hedge, max_hedge_notional) * fill
      If YES: P/L = (stake - liability) + effective_hedge - effective_hedge * p * (1 + cost_rate)
      If NO:  P/L = stake               - effective_hedge * p * (1 + cost_rate)
    """
    pnl, eff_h, utilization = _external_hedge_paths(inp)
    return _build_metrics(pnl, inp.hedge_fraction, eff_h, utilization, inp.cvar_alpha)


# ---------------------------------------------------------------------------
# Internal reprice
# ---------------------------------------------------------------------------

def _internal_reprice_paths(inp: SimulationInputV12) -> np.ndarray:
    rng = _make_rng(inp.seed)
    liability = inp.liability if inp.liability > 0 else _derive_liability(inp.stake, inp.american_odds)

    n = inp.n_paths
    yes = rng.random(n) < inp.true_win_prob

    if inp.internal_reprice and inp.internal_reprice.enabled:
        model = inp.internal_reprice
        prob_move = model.odds_move_sensitivity * liability
        handle_factor = max(0.0, 1.0 - model.handle_retention_decay * prob_move)
        effective_handle = inp.stake * handle_factor
    else:
        effective_handle = inp.stake

    pnl = np.where(yes, effective_handle - liability, effective_handle)
    return pnl


def simulate_internal_reprice(inp: SimulationInputV12) -> StrategyMetrics:
    """
    Sportsbook moves its offered odds to discourage further liability buildup.

    prob_move = odds_move_sensitivity * liability
    handle_factor = 1 - handle_retention_decay * prob_move  (handle lost due to worse odds)
    effective_handle = stake * handle_factor

    Per path:
      If YES: P/L = effective_handle - liability
      If NO:  P/L = effective_handle
    """
    pnl = _internal_reprice_paths(inp)
    return _build_metrics(pnl, inp.hedge_fraction, 0.0, 0.0, inp.cvar_alpha)


# ---------------------------------------------------------------------------
# Hybrid
# ---------------------------------------------------------------------------

def _hybrid_paths(inp: SimulationInputV12) -> tuple[np.ndarray, float, float]:
    rng = _make_rng(inp.seed)
    p_market = _american_to_prob(inp.american_odds)
    liability = inp.liability if inp.liability > 0 else _derive_liability(inp.stake, inp.american_odds)

    reprice_liability = (1.0 - inp.hedge_fraction) * liability
    hedge_liability = inp.hedge_fraction * liability

    if inp.internal_reprice and inp.internal_reprice.enabled:
        model = inp.internal_reprice
        prob_move = model.odds_move_sensitivity * reprice_liability
        handle_factor = max(0.0, 1.0 - model.handle_retention_decay * prob_move)
        effective_handle = inp.stake * handle_factor
    else:
        effective_handle = inp.stake

    requested_hedge = hedge_liability
    eff_h, cost_rate, utilization, _ = _liquidity_params(inp, requested_hedge)
    hedge_premium_rate = p_market * (1.0 + cost_rate)

    n = inp.n_paths
    fills = rng.random(n) < inp.fill_probability
    yes = rng.random(n) < inp.true_win_prob

    eff_hedges = np.where(fills, eff_h, 0.0)
    premiums = eff_hedges * hedge_premium_rate

    pnl = np.where(
        yes,
        effective_handle - liability + eff_hedges - premiums,
        effective_handle - premiums,
    )
    return pnl, eff_h, utilization


def simulate_hybrid(inp: SimulationInputV12) -> StrategyMetrics:
    """
    Partial internal reprice first, then external hedge on residual liability.

    reprice covers (1 - hedge_fraction) share of liability.
    external hedge covers hedge_fraction * liability.
    """
    pnl, eff_h, utilization = _hybrid_paths(inp)
    return _build_metrics(pnl, inp.hedge_fraction, eff_h, utilization, inp.cvar_alpha)


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

def simulate_strategy(inp: SimulationInputV12) -> StrategyMetrics:
    if inp.strategy == "external_hedge":
        return simulate_external_hedge(inp)
    if inp.strategy == "internal_reprice":
        return simulate_internal_reprice(inp)
    return simulate_hybrid(inp)


def simulate_strategy_paths(inp: SimulationInputV12) -> np.ndarray:
    """Returns deterministic P/L path array for the selected strategy."""
    if inp.strategy == "external_hedge":
        pnl, _, _ = _external_hedge_paths(inp)
        return pnl
    if inp.strategy == "internal_reprice":
        return _internal_reprice_paths(inp)
    pnl, _, _ = _hybrid_paths(inp)
    return pnl
