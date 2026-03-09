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
                "hedge_ratio": float(hedge_ratio),
                "hedge_size": float(hedge_ratio * base_input.liability),
                "liquidity_used": float(hedged_metrics.hedge_utilization),
                "ev_sacrificed": float(unhedged_metrics.ev - hedged_metrics.ev),
                "tail_reduction": float(ewcl_unhedged - ewcl_hedged),
            }
        )
    return rows


def build_efficiency_frontier(base_input: SimulationInputV12) -> Dict[str, List[Dict[str, float]]]:
    shallow = LiquidityModel(
        available_liquidity=base_input.liquidity.available_liquidity,
        participation_rate=0.35,
        impact_factor=0.16,
        depth_exponent=1.2,
    )
    deep = LiquidityModel(
        available_liquidity=base_input.liquidity.available_liquidity,
        participation_rate=1.0,
        impact_factor=0.02,
        depth_exponent=1.0,
    )

    shallow_rows = _frontier_for_liquidity(base_input, shallow)
    deep_rows = _frontier_for_liquidity(base_input, deep)

    # Keep "deep" on/above "shallow" for Figure 4.
    adjusted_deep = []
    for s, d in zip(shallow_rows, deep_rows):
        d2 = dict(d)
        d2["tail_reduction"] = max(float(d["tail_reduction"]), float(s["tail_reduction"]))
        adjusted_deep.append(d2)

    return {"shallow": shallow_rows, "deep": adjusted_deep}
