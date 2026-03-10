from fastapi.testclient import TestClient

from catalog_app import app


client = TestClient(app)


class TestSimulatorRuntimeRoute:
    def test_simulator_page_contains_live_controls_and_chart_shells(self):
        resp = client.get("/simulator")
        assert resp.status_code == 200
        text = resp.text

        assert "EventRisk.ai Stress Test" in text
        assert "Scenario Controls" in text
        assert "Run Simulation" in text
        assert "Copy Share Link" in text
        assert "EventRisk" in text
        assert "Read the paper" in text
        assert "Sportsbook Loss Distribution" in text
        assert "Liquidity-Constrained Risk Transfer Curve" in text
        assert "Hedging Efficiency Frontier" in text
        assert "Simulation unavailable. Retry?" in text
        assert "/runtime-config.js" in text
        assert "/static/scripts/simulator-app.mjs" in text
        assert "/simulator?v=1&amp;lb={liability}&amp;liq={liquidity}&amp;hf={hedgeFraction}" in text

    def test_runtime_config_defaults_to_same_origin_when_env_missing(self):
        resp = client.get("/runtime-config.js")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/javascript")
        assert 'apiBaseUrl": ""' in resp.text
        assert 'paperUrl": "https://eventrisk.ai/paper"' in resp.text

    def test_paper_link_hides_when_paper_url_empty(self, monkeypatch):
        monkeypatch.setenv("PAPER_URL", "   ")
        text = client.get("/simulator").text
        assert "Read the paper" in text
        assert 'href=""' not in text
        assert "<span" in text
        assert "aria-disabled=\"true\"" in text

    def test_simulator_assets_are_served(self):
        for route, content_type in (
            ("/static/styles/simulator.css", "text/css"),
            ("/static/scripts/simulator-app.mjs", "application/javascript"),
            ("/static/scripts/api-client.mjs", "application/javascript"),
            ("/static/scripts/simulator-state.mjs", "application/javascript"),
        ):
            resp = client.get(route)
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith(content_type)

    def test_simulator_state_url_serialization_keys_are_stable(self):
        text = client.get("/static/scripts/simulator-state.mjs").text
        assert 'params.get("v")' in text
        assert 'params.get("lb")' in text
        assert 'params.get("liq")' in text
        assert 'params.get("hf")' in text
        assert 'params.set("v", SCHEMA_VERSION)' in text
        assert 'params.set(\n    "lb"' in text
        assert 'params.set(\n    "liq"' in text
        assert 'params.set(\n    "hf"' in text

    def test_simulator_app_uses_url_state_round_trip_contract(self):
        text = client.get("/static/scripts/simulator-app.mjs").text
        assert "parseSimulatorState(new URL(window.location.href))" in text
        assert "const query = serializeSimulatorState(state);" in text
        assert 'window.history.replaceState({}, "", `/simulator?${query}`);' in text
        assert "const shareUrl = `${window.location.origin}/simulator?${serializeSimulatorState(state)}`;" in text

    def test_simulator_run_contract_endpoints_return_chart_data(self):
        distribution = client.post(
            "/api/risk-transfer/distribution",
            json={
                "strategy": "external_hedge",
                "liability": 100_000_000,
                "hedge_fraction": 0.6,
                "base_input": {
                    "stake": 100_000_000,
                    "american_odds": -108,
                    "true_win_prob": 0.55,
                    "fill_probability": 1.0,
                    "slippage_bps": 20,
                    "fee_bps": 10,
                    "latency_bps": 5,
                    "n_paths": 500,
                    "seed": "sim-runtime-test",
                    "liquidity": {
                        "available_liquidity": 20_000_000,
                        "participation_rate": 1.0,
                        "impact_factor": 0.02,
                        "depth_exponent": 1.0,
                    },
                },
            },
        )
        assert distribution.status_code == 200
        distribution_payload = distribution.json()
        assert distribution_payload["strategy"] == "external_hedge"
        assert len(distribution_payload["unhedged"]["bin_mids"]) > 0
        assert len(distribution_payload["hedged"]["bin_mids"]) > 0

        curve = client.post(
            "/api/risk-transfer/interactive",
            json={
                "liability_min": 25_000_000,
                "liability_max": 175_000_000,
                "n_points": 7,
                "true_probability": 0.55,
                "prediction_market_price": 0.52,
                "fill_probability": 1.0,
                "objective": "min_cvar",
                "strategy": "external_hedge",
                "seed": "sim-runtime-test",
                "n_paths": 500,
                "liquidity": {
                    "available_liquidity": 20_000_000,
                    "participation_rate": 1.0,
                    "impact_factor": 0.02,
                    "depth_exponent": 1.0,
                },
            },
        )
        assert curve.status_code == 200
        curve_payload = curve.json()
        assert len(curve_payload["curve_points"]) == 7

        frontier = client.post(
            "/api/tier2/frontier",
            json={
                "liability": 100_000_000,
                "liquidity": 20_000_000,
                "true_probability": 0.55,
                "market_price": 0.52,
                "target_hedge_ratio": 0.6,
                "simulation_count": 6000,
            },
        )
        assert frontier.status_code == 200
        frontier_payload = frontier.json()
        assert "frontiers" in frontier_payload
        assert len(frontier_payload["frontiers"]["shallow"]) == 21
        assert len(frontier_payload["frontiers"]["deep"]) == 21

    def test_status_contract_remains_ok(self):
        resp = client.get("/status")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
