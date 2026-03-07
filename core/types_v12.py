from dataclasses import dataclass
from typing import Literal, List, Dict, Optional


StrategyMode = Literal["external_hedge", "internal_reprice", "hybrid"]
ObjectiveMode = Literal["min_cvar", "min_max_loss", "max_sharpe", "target_ev_min_risk"]


@dataclass
class LiquidityModel:
    available_liquidity: float      # dollars
    participation_rate: float       # 0..1
    impact_factor: float            # >=0, scales price impact
    depth_exponent: float = 1.0     # linear=1, convex>1


@dataclass
class InternalRepriceModel:
    enabled: bool
    odds_move_sensitivity: float    # probability pts moved per $1 liability
    handle_retention_decay: float   # demand loss per probability pt move
    min_prob: float = 0.01
    max_prob: float = 0.99


@dataclass
class SimulationInputV12:
    # existing
    stake: float
    american_odds: int
    true_win_prob: float
    hedge_fraction: float
    fill_probability: float
    slippage_bps: float
    fee_bps: float
    latency_bps: float
    n_paths: int
    seed: Optional[str] = None

    # new
    liability: float = 0.0
    strategy: StrategyMode = "external_hedge"
    objective: ObjectiveMode = "min_cvar"
    liquidity: Optional[LiquidityModel] = None
    internal_reprice: Optional[InternalRepriceModel] = None
    cvar_alpha: float = 0.95


@dataclass
class StrategyMetrics:
    ev: float
    p5: float
    p50: float
    p95: float
    max_loss: float
    cvar_95: float
    optimal_hedge_ratio: float
    effective_hedge_notional: float
    hedge_utilization: float        # effective/max_hedge


@dataclass
class RiskTransferPoint:
    liability: float
    optimal_hedge_ratio: float
    ev: float
    cvar_95: float
    max_loss: float


@dataclass
class RiskTransferCurve:
    strategy: StrategyMode
    points: List[RiskTransferPoint]
