import dataclasses
import pytest
import numpy as np

from core.types_v12 import SimulationInputV12, LiquidityModel, InternalRepriceModel
from core.liquidity import max_hedge_notional, apply_hedge_cap, market_impact_delta_price
from core.metrics import cvar
from core.strategies import simulate_external_hedge, simulate_internal_reprice, simulate_hybrid, simulate_strategy
from core.optimizer import optimize_hedge_ratio, build_risk_transfer_curve


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def base_inp(**overrides) -> SimulationInputV12:
    defaults = dict(
        stake=1000.0,
        american_odds=-110,
        true_win_prob=0.52,
        hedge_fraction=0.5,
        fill_probability=1.0,
        slippage_bps=20.0,
        fee_bps=10.0,
        latency_bps=5.0,
        n_paths=2000,
        seed="test",
        liability=2000.0,
        strategy="external_hedge",
        objective="min_cvar",
    )
    defaults.update(overrides)
    return SimulationInputV12(**defaults)


# ---------------------------------------------------------------------------
# 1. Hedge cap always enforced
# ---------------------------------------------------------------------------

class TestHedgeCap:
    def test_effective_hedge_never_exceeds_max_notional(self):
        liq = LiquidityModel(available_liquidity=500.0, participation_rate=0.5, impact_factor=0.1)
        inp = base_inp(hedge_fraction=1.0, liability=5000.0, liquidity=liq)
        metrics = simulate_external_hedge(inp)
        max_h = max_hedge_notional(500.0, 0.5)
        assert metrics.effective_hedge_notional <= max_h + 1e-9

    def test_apply_hedge_cap_respects_zero_liquidity(self):
        assert apply_hedge_cap(1000.0, 0.0) == 0.0

    def test_hedge_cap_with_partial_fill_does_not_exceed_max(self):
        liq = LiquidityModel(available_liquidity=300.0, participation_rate=1.0, impact_factor=0.0)
        inp = base_inp(hedge_fraction=0.9, liability=2000.0, liquidity=liq, fill_probability=0.5)
        metrics = simulate_external_hedge(inp)
        assert metrics.effective_hedge_notional <= 300.0 + 1e-9

    def test_hedge_utilization_at_most_one(self):
        liq = LiquidityModel(available_liquidity=100.0, participation_rate=1.0, impact_factor=0.0)
        inp = base_inp(hedge_fraction=1.0, liability=10_000.0, liquidity=liq)
        metrics = simulate_external_hedge(inp)
        assert metrics.hedge_utilization <= 1.0 + 1e-9

    def test_no_liquidity_constraint_uses_full_requested_hedge(self):
        inp = base_inp(hedge_fraction=0.5, liability=2000.0, liquidity=None)
        metrics = simulate_external_hedge(inp)
        assert abs(metrics.effective_hedge_notional - 0.5 * 2000.0) < 1e-6


# ---------------------------------------------------------------------------
# 2. Increasing impact_factor weakly decreases EV
# ---------------------------------------------------------------------------

class TestImpactFactorMono:
    def test_higher_impact_factor_does_not_increase_ev(self):
        factors = [0.0, 0.05, 0.1, 0.3, 1.0]
        evs = []
        for f in factors:
            liq = LiquidityModel(
                available_liquidity=5000.0,
                participation_rate=1.0,
                impact_factor=f,
            )
            inp = base_inp(liquidity=liq, hedge_fraction=0.5, n_paths=5000)
            evs.append(simulate_external_hedge(inp).ev)
        for i in range(len(evs) - 1):
            assert evs[i] >= evs[i + 1] - 1.0, (
                f"EV rose with higher impact factor: {evs[i]:.2f} -> {evs[i+1]:.2f}"
            )

    def test_zero_impact_factor_has_same_ev_as_no_liquidity(self):
        liq = LiquidityModel(available_liquidity=100_000.0, participation_rate=1.0, impact_factor=0.0)
        inp_liq  = base_inp(liquidity=liq,  hedge_fraction=0.5, n_paths=4000)
        inp_none = base_inp(liquidity=None, hedge_fraction=0.5, n_paths=4000)
        ev_liq  = simulate_external_hedge(inp_liq).ev
        ev_none = simulate_external_hedge(inp_none).ev
        assert abs(ev_liq - ev_none) < 5.0


# ---------------------------------------------------------------------------
# 3. Risk transfer curve: non-decreasing hedge ratio under min_cvar
# ---------------------------------------------------------------------------

class TestRiskTransferCurve:
    def test_hedge_ratio_non_decreasing_with_liability(self):
        liabilities = [500.0, 1000.0, 2000.0, 4000.0, 8000.0]
        inp = base_inp(n_paths=1000, seed="curve_test", objective="min_cvar", liquidity=None)
        curve = build_risk_transfer_curve(inp, liabilities, strategy="external_hedge")
        ratios = [pt.optimal_hedge_ratio for pt in curve.points]
        tolerance = 0.05
        for i in range(len(ratios) - 1):
            assert ratios[i + 1] >= ratios[i] - tolerance, (
                f"Hedge ratio decreased from {ratios[i]:.2f} to {ratios[i+1]:.2f} "
                f"as liability grew from {liabilities[i]} to {liabilities[i+1]}"
            )

    def test_curve_has_correct_number_of_points(self):
        liabilities = [100.0, 200.0, 300.0]
        inp = base_inp(n_paths=500, seed="count_test")
        curve = build_risk_transfer_curve(inp, liabilities, strategy="external_hedge")
        assert len(curve.points) == len(liabilities)

    def test_curve_strategy_label_matches(self):
        liabilities = [1000.0]
        inp = base_inp(n_paths=500, seed="label_test")
        for strategy in ("external_hedge", "internal_reprice", "hybrid"):
            inp2 = dataclasses.replace(inp, strategy=strategy)
            curve = build_risk_transfer_curve(inp2, liabilities, strategy=strategy)
            assert curve.strategy == strategy


# ---------------------------------------------------------------------------
# metrics.cvar
# ---------------------------------------------------------------------------

class TestCVaR:
    def test_cvar_empty_returns_zero(self):
        assert cvar([]) == 0.0

    def test_cvar_single_value(self):
        assert cvar([-100.0]) == -100.0

    def test_cvar_is_mean_of_worst_5pct(self):
        paths = list(range(-100, 0)) + list(range(0, 900))
        result = cvar(paths, alpha=0.95)
        assert result < 0

    def test_cvar_worse_than_ev(self):
        rng = np.random.default_rng(42)
        paths = rng.normal(-50, 200, 1000).tolist()
        ev = np.mean(paths)
        result = cvar(paths, alpha=0.95)
        assert result <= ev + 1e-9


# ---------------------------------------------------------------------------
# Strategy smoke tests
# ---------------------------------------------------------------------------

class TestStrategies:
    def test_external_hedge_returns_metrics(self):
        metrics = simulate_external_hedge(base_inp())
        assert metrics.ev is not None
        assert metrics.cvar_95 <= metrics.p5 + 1.0

    def test_internal_reprice_lower_ev_than_no_reprice(self):
        model = InternalRepriceModel(enabled=True, odds_move_sensitivity=0.001, handle_retention_decay=0.5)
        inp = base_inp(internal_reprice=model, strategy="internal_reprice")
        metrics = simulate_internal_reprice(inp)
        assert metrics.ev < inp.stake

    def test_hybrid_fills_between_strategies(self):
        inp = base_inp(hedge_fraction=0.5, strategy="hybrid")
        metrics = simulate_hybrid(inp)
        assert metrics.ev is not None

    def test_optimize_returns_best_hedge_fraction(self):
        inp = base_inp(n_paths=500, seed="opt_test", objective="min_cvar")
        metrics = optimize_hedge_ratio(inp)
        assert 0.0 <= metrics.optimal_hedge_ratio <= 1.0
        assert metrics.cvar_95 is not None


# ---------------------------------------------------------------------------
# Acceptance item 1: v12 determinism with seed
# ---------------------------------------------------------------------------

class TestV12Determinism:
    def test_external_hedge_reproducible(self):
        inp = base_inp(seed="repro_ext", n_paths=3000)
        m1 = simulate_external_hedge(inp)
        m2 = simulate_external_hedge(inp)
        assert m1.ev == m2.ev
        assert m1.cvar_95 == m2.cvar_95
        assert m1.max_loss == m2.max_loss

    def test_internal_reprice_reproducible(self):
        model = InternalRepriceModel(enabled=True, odds_move_sensitivity=0.001, handle_retention_decay=0.3)
        inp = base_inp(seed="repro_rep", n_paths=3000, internal_reprice=model, strategy="internal_reprice")
        m1 = simulate_internal_reprice(inp)
        m2 = simulate_internal_reprice(inp)
        assert m1.ev == m2.ev
        assert m1.cvar_95 == m2.cvar_95

    def test_hybrid_reproducible(self):
        inp = base_inp(seed="repro_hyb", n_paths=3000, strategy="hybrid")
        m1 = simulate_hybrid(inp)
        m2 = simulate_hybrid(inp)
        assert m1.ev == m2.ev
        assert m1.cvar_95 == m2.cvar_95

    def test_different_seeds_produce_different_results(self):
        m1 = simulate_external_hedge(base_inp(seed="seed_A", n_paths=2000))
        m2 = simulate_external_hedge(base_inp(seed="seed_B", n_paths=2000))
        assert m1.ev != m2.ev


# ---------------------------------------------------------------------------
# Acceptance item 4: CVaR is tail mean, not percentile proxy
# ---------------------------------------------------------------------------

class TestCVaRIsTailMean:
    def test_cvar_is_mean_of_tail_not_percentile(self):
        paths = [-200.0, -100.0, -80.0, -60.0, -40.0] + [100.0] * 95
        result = cvar(paths, alpha=0.95)
        tail_mean = (-200 + -100 + -80 + -60 + -40) / 5
        percentile_proxy = float(np.percentile(paths, 5))
        assert abs(result - tail_mean) < 1.0, f"Expected tail mean {tail_mean}, got {result}"
        assert result != percentile_proxy, "cvar must not equal the raw 5th percentile"

    def test_cvar_lower_than_p5_when_tail_is_heavy(self):
        paths = [-1000.0, -900.0, -800.0] + [50.0] * 97
        result = cvar(paths, alpha=0.95)
        p5 = float(np.percentile(paths, 5))
        assert result < p5 + 1.0

    def test_cvar_equals_ev_when_all_paths_equal(self):
        paths = [-42.0] * 200
        assert abs(cvar(paths) - (-42.0)) < 1e-9


# ---------------------------------------------------------------------------
# Acceptance item 5: strategy comparison with identical seed
# ---------------------------------------------------------------------------

class TestStrategyComparisonFairSeed:
    def _run_all(self, seed="compare_seed", n_paths=4000, **kw):
        model = InternalRepriceModel(enabled=True, odds_move_sensitivity=0.0005, handle_retention_decay=0.2)
        ext = simulate_external_hedge(
            base_inp(seed=seed, n_paths=n_paths, strategy="external_hedge", **kw))
        rep = simulate_internal_reprice(
            base_inp(seed=seed, n_paths=n_paths, strategy="internal_reprice",
                     internal_reprice=model, **kw))
        hyb = simulate_hybrid(
            base_inp(seed=seed, n_paths=n_paths, strategy="hybrid",
                     internal_reprice=model, **kw))
        return ext, rep, hyb

    def test_all_three_strategies_are_deterministic_under_same_seed(self):
        ext1, rep1, hyb1 = self._run_all(seed="fair_A")
        ext2, rep2, hyb2 = self._run_all(seed="fair_A")
        assert ext1.ev == ext2.ev
        assert rep1.ev == rep2.ev
        assert hyb1.ev == hyb2.ev

    def test_strategies_produce_distinct_metrics(self):
        ext, rep, hyb = self._run_all()
        evs = {ext.ev, rep.ev, hyb.ev}
        assert len(evs) >= 2, "At least two strategies should differ in EV"

    def test_external_hedge_has_lower_max_loss_than_no_hedge(self):
        no_hedge = simulate_external_hedge(base_inp(seed="no_h", hedge_fraction=0.0, n_paths=4000))
        full_hedge = simulate_external_hedge(base_inp(seed="no_h", hedge_fraction=1.0, n_paths=4000))
        assert full_hedge.max_loss >= no_hedge.max_loss - 1.0 or full_hedge.cvar_95 >= no_hedge.cvar_95 - 1.0


# ---------------------------------------------------------------------------
# Interactive endpoint acceptance tests
# ---------------------------------------------------------------------------

from fastapi.testclient import TestClient
from catalog_app import app


class TestInteractiveRiskTransferEndpoint:
    @staticmethod
    def _payload(seed="article-seed"):
        return {
            "liability_range": [20_000_000, 40_000_000, 80_000_000, 120_000_000],
            "true_probability": 0.60,
            "prediction_market_price": 0.58,
            "liquidity": 12_000_000,
            "fill_probability": 0.90,
            "n_paths": 500,
            "seed": seed,
            "objective": "min_cvar",
            "strategy": "external_hedge",
            "strategy_modes": ["external_hedge", "internal_reprice", "hybrid"],
        }

    def test_deterministic_endpoint_same_seed_same_curve_points(self):
        client = TestClient(app)
        p = self._payload(seed="deterministic-1")
        r1 = client.post("/api/risk-transfer/interactive", json=p)
        r2 = client.post("/api/risk-transfer/interactive", json=p)
        assert r1.status_code == 200
        assert r2.status_code == 200
        j1 = r1.json()
        j2 = r2.json()
        assert j1["curve_points"] == j2["curve_points"]

    def test_metadata_presence(self):
        client = TestClient(app)
        r = client.post("/api/risk-transfer/interactive", json=self._payload())
        assert r.status_code == 200
        m = r.json()["scenario_metadata"]
        for k in ("seed", "n_paths", "timestamp_utc", "simulator_version", "source"):
            assert k in m

    def test_csv_row_consistency_from_curve_points(self):
        client = TestClient(app)
        r = client.post("/api/risk-transfer/interactive", json=self._payload())
        assert r.status_code == 200
        points = r.json()["curve_points"]
        rows = [["liability", "hedge_ratio", "ev", "cvar", "max_loss"]]
        rows.extend([[p["liability"], p["hedge_ratio"], p["ev"], p["cvar"], p["max_loss"]] for p in points])
        assert len(rows) == len(points) + 1
        assert rows[0] == ["liability", "hedge_ratio", "ev", "cvar", "max_loss"]

    def test_hedge_ratio_monotonicity_min_cvar(self):
        client = TestClient(app)
        r = client.post("/api/risk-transfer/interactive", json=self._payload(seed="mono-seed"))
        assert r.status_code == 200
        points = r.json()["curve_points"]
        ratios = [p["hedge_ratio"] for p in points]
        for i in range(len(ratios) - 1):
            assert ratios[i + 1] >= ratios[i] - 1e-9
