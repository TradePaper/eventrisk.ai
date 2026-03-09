from typing import Dict, List


def classify_feasibility(h_eff: float) -> str:
    if h_eff < 0.10:
        return "no_effective"
    if h_eff < 0.40:
        return "partial"
    return "meaningful"


def build_feasibility_map(target_hedge_ratio: float) -> Dict[str, List]:
    liabilities = [20_000_000.0 + i * (180_000_000.0 / 19.0) for i in range(20)]
    liquidities = [1_000_000.0 + i * (99_000_000.0 / 19.0) for i in range(20)]

    region_grid: List[List[int]] = []
    h_eff_grid: List[List[float]] = []
    label_grid: List[List[str]] = []

    for q in liquidities:
        region_row: List[int] = []
        h_eff_row: List[float] = []
        label_row: List[str] = []
        for l in liabilities:
            h_eff = min(target_hedge_ratio, q / l)
            region = classify_feasibility(h_eff)
            region_code = 0 if region == "no_effective" else (1 if region == "partial" else 2)
            region_row.append(region_code)
            h_eff_row.append(float(h_eff))
            label_row.append(region)
        region_grid.append(region_row)
        h_eff_grid.append(h_eff_row)
        label_grid.append(label_row)

    return {
        "liabilities": liabilities,
        "liquidities": liquidities,
        "region_grid": region_grid,
        "h_eff_grid": h_eff_grid,
        "label_grid": label_grid,
        "labels": {
            "no_effective": "No Effective Hedging",
            "partial": "Partial Hedging",
            "meaningful": "Meaningful Hedging",
        },
    }
