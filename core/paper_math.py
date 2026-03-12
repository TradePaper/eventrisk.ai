from typing import Dict, Iterable, List, Optional

from core.liquidity import max_hedge_notional


LOW_LIQUIDITY_FACTOR = 0.5
MEDIUM_LIQUIDITY_FACTOR = 1.0
HIGH_LIQUIDITY_FACTOR = 3.0
DEFAULT_FEASIBILITY_THRESHOLDS = {
    "no_effective_max": 0.10,
    "partial_max": 0.40,
}


def requested_hedge_notional(liability: float, requested_hedge_fraction: float) -> float:
    return max(0.0, liability) * max(0.0, requested_hedge_fraction)


def effective_hedge_fraction(
    liability: float,
    requested_hedge_fraction: float,
    available_liquidity: float,
    participation_rate: float = 1.0,
) -> float:
    if liability <= 0:
        return 0.0
    requested = max(0.0, requested_hedge_fraction)
    max_fraction = max_hedge_notional(available_liquidity, participation_rate) / liability
    return max(0.0, min(requested, max_fraction))


def build_capacity_point(
    liability: float,
    requested_hedge_fraction: float,
    available_liquidity: float,
    participation_rate: float = 1.0,
) -> Dict[str, float]:
    requested_notional = requested_hedge_notional(liability, requested_hedge_fraction)
    effective_fraction = effective_hedge_fraction(
        liability=liability,
        requested_hedge_fraction=requested_hedge_fraction,
        available_liquidity=available_liquidity,
        participation_rate=participation_rate,
    )
    effective_notional = liability * effective_fraction
    return {
        "liability": float(liability),
        "requested_hedge_fraction": float(max(0.0, requested_hedge_fraction)),
        "effective_hedge_fraction": float(effective_fraction),
        "requested_hedge_notional": float(requested_notional),
        "effective_hedge_notional": float(effective_notional),
        "liquidity_binding": bool(effective_fraction + 1e-9 < max(0.0, requested_hedge_fraction)),
    }


def build_capacity_curve(
    liabilities: Iterable[float],
    requested_hedge_fraction: float,
    available_liquidity: float,
    participation_rate: float = 1.0,
) -> List[Dict[str, float]]:
    return [
        build_capacity_point(
            liability=float(liability),
            requested_hedge_fraction=requested_hedge_fraction,
            available_liquidity=available_liquidity,
            participation_rate=participation_rate,
        )
        for liability in liabilities
    ]


def classify_feasibility(effective_fraction_value: float, thresholds: Optional[Dict[str, float]] = None) -> str:
    active = thresholds or DEFAULT_FEASIBILITY_THRESHOLDS
    if effective_fraction_value < active["no_effective_max"]:
        return "no_effective"
    if effective_fraction_value < active["partial_max"]:
        return "partial"
    return "meaningful"


def build_liquidity_regime_curves(
    liabilities: Iterable[float],
    requested_hedge_fraction: float,
    medium_available_liquidity: float,
    participation_rate: float = 1.0,
) -> List[Dict[str, object]]:
    regimes = [
        ("low", "Low Liquidity", medium_available_liquidity * LOW_LIQUIDITY_FACTOR),
        ("medium", "Medium Liquidity", medium_available_liquidity * MEDIUM_LIQUIDITY_FACTOR),
        ("high", "High Liquidity", medium_available_liquidity * HIGH_LIQUIDITY_FACTOR),
    ]
    return [
        {
            "id": regime_id,
            "label": label,
            "available_liquidity": float(available_liquidity),
            "curve_points": build_capacity_curve(
                liabilities=liabilities,
                requested_hedge_fraction=requested_hedge_fraction,
                available_liquidity=available_liquidity,
                participation_rate=participation_rate,
            ),
        }
        for regime_id, label, available_liquidity in regimes
    ]
