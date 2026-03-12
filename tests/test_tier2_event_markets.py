import dataclasses

from fastapi.testclient import TestClient

from catalog_app import app
from core.frontier import HEDGE_RATIO_GRID, build_efficiency_frontier
from core.feasibility import build_feasibility_map, classify_feasibility
from core.paper_math import build_capacity_point
from core.strategies import simulate_external_hedge
from core.types_v12 import LiquidityModel, SimulationInputV12


class TestTier2FrontierCore:
    @staticmethod
    def _base_input() -> SimulationInputV12:
        return SimulationInputV12(
            stake=100_000_000.0,
            american_odds=-108,
            true_win_prob=0.55,
            hedge_fraction=0.6,
            fill_probability=1.0,
            slippage_bps=20.0,
            fee_bps=10.0,
            latency_bps=5.0,
            n_paths=5000,
            seed="tier2-test",
            liability=100_000_000.0,
            strategy="external_hedge",
            objective="max_ev",
            liquidity=LiquidityModel(
                available_liquidity=20_000_000.0,
                participation_rate=1.0,
                impact_factor=0.0,
                depth_exponent=1.0,
            ),
            cvar_alpha=0.95,
        )

    def test_grid_is_0_to_1_step_005(self):
        assert len(HEDGE_RATIO_GRID) == 21
        assert HEDGE_RATIO_GRID[0] == 0.0
        assert HEDGE_RATIO_GRID[-1] == 1.0
        assert HEDGE_RATIO_GRID[1] - HEDGE_RATIO_GRID[0] == 0.05

    def test_frontier_uses_requested_formula_fields(self):
        base = self._base_input()
        out = build_efficiency_frontier(base)
        shallow = out["shallow"]

        row = shallow[5]
        requested_fraction = row["requested_hedge_fraction"]

        shallow_liq = LiquidityModel(
            available_liquidity=base.liquidity.available_liquidity * 0.5,
            participation_rate=1.0,
            impact_factor=0.18,
            depth_exponent=1.25,
        )
        unhedged = simulate_external_hedge(dataclasses.replace(base, hedge_fraction=0.0, liquidity=shallow_liq))
        hedged = simulate_external_hedge(dataclasses.replace(base, hedge_fraction=requested_fraction, liquidity=shallow_liq))

        ev_sacrificed = unhedged.ev - hedged.ev
        tail_reduction = max(0.0, -unhedged.cvar_95) - max(0.0, -hedged.cvar_95)

        assert abs(row["ev_sacrificed"] - ev_sacrificed) < 1e-6
        assert abs(row["tail_reduction"] - tail_reduction) < 1e-6
        assert row["effective_hedge_notional"] <= row["requested_hedge_notional"] + 1e-6

    def test_deep_frontier_is_on_or_above_shallow(self):
        out = build_efficiency_frontier(self._base_input())
        for s, d in zip(out["shallow"], out["deep"]):
            assert d["tail_reduction"] >= s["tail_reduction"] - 1e-9

    def test_deep_scenario_materially_improves_tail_with_similar_ev(self):
        base = SimulationInputV12(
            stake=8_000_000.0,
            american_odds=-122,
            true_win_prob=0.55,
            hedge_fraction=0.60,
            fill_probability=1.0,
            slippage_bps=5.0,
            fee_bps=2.0,
            latency_bps=1.0,
            n_paths=5000,
            seed="paper_superbowl",
            liability=136_000_000.0,
            strategy="external_hedge",
            objective="min_cvar",
            liquidity=LiquidityModel(
                available_liquidity=20_000_000.0,
                participation_rate=1.0,
                impact_factor=0.01,
                depth_exponent=1.0,
            ),
        )
        unhedged = simulate_external_hedge(dataclasses.replace(base, hedge_fraction=0.0, liquidity=base.liquidity))
        shallow = simulate_external_hedge(
            dataclasses.replace(
                base,
                liquidity=LiquidityModel(available_liquidity=10_000_000.0, participation_rate=1.0, impact_factor=0.18, depth_exponent=1.25),
            )
        )
        deep = simulate_external_hedge(
            dataclasses.replace(
                base,
                liquidity=LiquidityModel(available_liquidity=60_000_000.0, participation_rate=1.0, impact_factor=0.02, depth_exponent=1.0),
            )
        )
        shallow_improvement = shallow.cvar_95 - unhedged.cvar_95
        deep_improvement = deep.cvar_95 - unhedged.cvar_95
        assert deep_improvement > shallow_improvement * 2
        assert abs(deep.ev - unhedged.ev) < 2_000_000


class TestTier2FeasibilityCore:
    def test_capacity_formula_matches_acceptance_case(self):
        point = build_capacity_point(
            liability=100_000_000.0,
            requested_hedge_fraction=0.60,
            available_liquidity=20_000_000.0,
            participation_rate=1.0,
        )
        assert abs(point["requested_hedge_fraction"] - 0.60) < 1e-9
        assert abs(point["effective_hedge_fraction"] - 0.20) < 1e-9
        assert point["liquidity_binding"] is True

    def test_grid_dimensions_and_ranges(self):
        fmap = build_feasibility_map(0.6)
        assert len(fmap["liabilities"]) == 20
        assert len(fmap["liquidities"]) == 20
        assert abs(fmap["liabilities"][0] - 20_000_000.0) < 1e-6
        assert abs(fmap["liabilities"][-1] - 200_000_000.0) < 1e-6
        assert abs(fmap["liquidities"][0] - 1_000_000.0) < 1e-6
        assert abs(fmap["liquidities"][-1] - 100_000_000.0) < 1e-6
        assert len(fmap["region_grid"]) == 20
        assert len(fmap["region_grid"][0]) == 20

    def test_region_threshold_rules(self):
        assert classify_feasibility(0.09) == "no_effective"
        assert classify_feasibility(0.10) == "partial"
        assert classify_feasibility(0.39) == "partial"
        assert classify_feasibility(0.40) == "meaningful"

    def test_medium_regime_at_100m_and_20m_is_partial(self):
        fmap = build_feasibility_map(0.6)
        liability_idx = min(range(len(fmap["liabilities"])), key=lambda i: abs(fmap["liabilities"][i] - 100_000_000.0))
        liquidity_idx = min(range(len(fmap["liquidities"])), key=lambda i: abs(fmap["liquidities"][i] - 20_000_000.0))
        effective_fraction = fmap["h_eff_grid"][liquidity_idx][liability_idx]
        assert abs(effective_fraction - 0.20) < 0.03
        assert fmap["label_grid"][liquidity_idx][liability_idx] == "partial"


class TestTier2EndpointsAndPage:
    def test_frontier_endpoint_contract(self):
        client = TestClient(app)
        r = client.post(
            "/api/tier2/frontier",
            json={
                "liability": 100_000_000,
                "liquidity": 20_000_000,
                "true_probability": 0.55,
                "market_price": 0.52,
                "target_hedge_ratio": 0.60,
                "simulation_count": 10000,
            },
        )
        assert r.status_code == 200
        payload = r.json()
        assert payload["title"] == "Figure 5 — Hedging Efficiency Frontier"
        assert set(payload["frontiers"].keys()) == {"shallow", "deep"}
        assert len(payload["frontiers"]["shallow"]) == 21

    def test_feasibility_endpoint_contract(self):
        client = TestClient(app)
        r = client.post(
            "/api/tier2/feasibility",
            json={
                "liability": 100_000_000,
                "liquidity": 20_000_000,
                "true_probability": 0.55,
                "market_price": 0.52,
                "target_hedge_ratio": 0.60,
                "simulation_count": 10000,
            },
        )
        assert r.status_code == 200
        payload = r.json()
        assert payload["title"] == "Figure 1 — Sportsbook Hedging Feasibility Map"
        assert payload["labels"]["no_effective"] == "No Effective Hedging"
        assert payload["labels"]["partial"] == "Partial Hedging"
        assert payload["labels"]["meaningful"] == "Meaningful Hedging"

    def test_event_markets_page_remains_directly_available(self):
        client = TestClient(app)
        r = client.get("/event-markets")
        assert r.status_code == 200
        text = r.text

        assert "Event Markets Intelligence" in text
        assert "Risk Transfer Curve" in text
        assert "loadContracts()" in text
        assert '/static/nav.js' in text
