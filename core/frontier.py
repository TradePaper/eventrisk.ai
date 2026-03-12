import dataclasses
from typing import Dict, List

from core.strategies import simulate_external_hedge
from core.types_v12 import LiquidityModel, SimulationInputV12


HEDGE_RATIO_GRID: List[float] = [round(x * 0.05, 2) for x in range(0, 21)]


def _ewcl(metrics) -> float:
    # EWCL is represented as a positive loss magnitude.
    return max(0.0, -float(metrics.cvar_95))


def _frontier_for_liquidity(base_input: SimulationInputV12, liquidity: LiquidityModel) -> List[Dict[str, float]]:
    unhedged = dataclasses.replace(base_input, hedge_fraction=0.0, liquidity=liquidity)
    unhedged_metrics = simulate_external_hedge(unhedged)
    ewcl_unhedged = _ewcl(unhedged_metrics)

    rows: List[Dict[str, float]] = []
    for hedge_ratio in HEDGE_RATIO_GRID:
        hedged_inp = dataclasses.replace(base_input, hedge_fraction=hedge_ratio, liquidity=liquidity)
        hedged_metrics = simulate_external_hedge(hedged_inp)
        ewcl_hedged = _ewcl(hedged_metrics)
        rows.append(
            {
                "requested_hedge_fraction": float(hedge_ratio),
                "effective_hedge_fraction": float(hedged_metrics.effective_hedge_fraction),
                "requested_hedge_notional": float(hedge_ratio * base_input.liability),
                "effective_hedge_notional": float(hedged_metrics.effective_hedge_notional),
                "liquidity_binding": bool(hedged_metrics.liquidity_binding),
                "ev_sacrificed": float(unhedged_metrics.ev - hedged_metrics.ev),
                "tail_reduction": float(ewcl_unhedged - ewcl_hedged),
            }
        )
    return rows


def build_efficiency_frontier(base_input: SimulationInputV12) -> Dict[str, List[Dict[str, float]]]:
    shallow = LiquidityModel(
        available_liquidity=base_input.liquidity.available_liquidity * 0.5,
        participation_rate=1.0,
        impact_factor=0.18,
        depth_exponent=1.25,
    )
    deep = LiquidityModel(
        available_liquidity=base_input.liquidity.available_liquidity * 3.0,
        participation_rate=1.0,
        impact_factor=0.02,
        depth_exponent=1.0,
    )

    shallow_rows = _frontier_for_liquidity(base_input, shallow)
    deep_rows = _frontier_for_liquidity(base_input, deep)
    return {"shallow": shallow_rows, "deep": deep_rows}
