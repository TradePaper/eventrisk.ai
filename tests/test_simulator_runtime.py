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

    def test_status_contract_remains_ok(self):
        resp = client.get("/status")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
