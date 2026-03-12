from fastapi.testclient import TestClient

from catalog_app import app


client = TestClient(app)


class TestSimulatorRuntimeRoute:
    def test_distribution_preflight_allows_eventrisk_origin(self):
        resp = client.options(
            "/api/risk-transfer/distribution",
            headers={
                "Origin": "https://eventrisk.ai",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "https://eventrisk.ai"
        assert "POST" in resp.headers["access-control-allow-methods"]

    def test_interactive_preflight_allows_eventrisk_origin(self):
        resp = client.options(
            "/api/risk-transfer/interactive",
            headers={
                "Origin": "https://eventrisk.ai",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "https://eventrisk.ai"
        assert "POST" in resp.headers["access-control-allow-methods"]

    def test_distribution_endpoint_allows_localhost_dev_origin(self):
        resp = client.post(
            "/api/risk-transfer/distribution",
            headers={"Origin": "http://localhost:3000"},
            json={
                "strategy": "external_hedge",
                "liability": 2000.0,
                "hedge_fraction": 0.0,
                "base_input": {
                    "stake": 100,
                    "american_odds": -110,
                    "true_win_prob": 0.54,
                    "fill_probability": 0.85,
                    "n_paths": 500,
                    "seed": "superbowl_v1",
                    "slippage_bps": 8,
                    "fee_bps": 2,
                    "latency_bps": 3,
                    "liquidity": {
                        "available_liquidity": 1_000_000,
                        "participation_rate": 0.2,
                        "impact_factor": 0.6,
                        "depth_exponent": 1.0,
                    },
                },
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "http://localhost:3000"

    def test_interactive_endpoint_allows_local_dev_origin(self):
        resp = client.post(
            "/api/risk-transfer/interactive",
            headers={"Origin": "http://127.0.0.1:3000"},
            json={
                "liability_min": 500.0,
                "liability_max": 2000.0,
                "n_points": 3,
                "true_probability": 0.55,
                "prediction_market_price": 0.52,
                "fill_probability": 1.0,
                "objective": "min_cvar",
                "strategy": "external_hedge",
                "seed": "cors-interactive-test",
                "n_paths": 200,
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"

    def test_status_allows_www_eventrisk_origin(self):
        resp = client.get("/status", headers={"Origin": "https://www.eventrisk.ai"})
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "https://www.eventrisk.ai"

    def test_distribution_preflight_allows_local_vite_origin(self):
        resp = client.options(
            "/api/risk-transfer/distribution",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert "POST" in resp.headers["access-control-allow-methods"]

    def test_simulator_page_contains_live_controls_and_chart_shells(self):
        resp = client.get("/simulator")
        assert resp.status_code == 200
        text = resp.text

        assert "EventRisk.ai Stress Test" in text
        assert "Scenario Controls" in text
        assert "Run Simulation" in text
        assert "Copy Share Link" in text
        assert "EventRisk" in text
        assert "Read the Paper" in text
        assert "Sportsbook Loss Distribution" in text
        assert "Deterministic Hedge Capacity Curve" in text
        assert "Hedgeable fraction of exposure versus liability under low, medium, and high liquidity constraints." in text
        assert "Requested" in text
        assert "Effective" in text
        assert "Hedging Efficiency Frontier" in text
        assert "Simulation unavailable. Retry?" in text
        assert "/runtime-config.js?v=" in text
        assert "/static/scripts/simulator-app.mjs?v=" in text
        assert text.index("/runtime-config.js") < text.index("/static/scripts/simulator-app.mjs")
        assert "/simulator?v=1&amp;lb={liability}&amp;liq={liquidity}&amp;hf={hedgeFraction}" in text
        assert "rev " in text

    def test_runtime_config_defaults_api_base_to_same_origin_when_env_missing(self):
        resp = client.get("/runtime-config.js")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/javascript")
        assert "window.__EVENTRISK_CONFIG" in resp.text
        assert "window.__EVENTRISK_RUNTIME_CONFIG__ = window.__EVENTRISK_CONFIG" in resp.text
        assert "window.__RUNTIME_CONFIG__ = window.__EVENTRISK_CONFIG" in resp.text
        assert 'apiBaseUrl": "http://testserver"' in resp.text
        assert 'paperUrl": "https://eventrisk.ai/paper.pdf"' in resp.text
        assert '"buildId": "' in resp.text
        assert '"debugApi": false' in resp.text

    def test_runtime_config_ignores_blank_api_base_env_and_keeps_same_origin(self, monkeypatch):
        monkeypatch.setenv("API_BASE_URL", "   ")
        resp = client.get("/runtime-config.js")
        assert resp.status_code == 200
        assert 'apiBaseUrl": "http://testserver"' in resp.text

    def test_runtime_config_emits_configured_external_api_base(self, monkeypatch):
        monkeypatch.setenv("API_BASE_URL", "https://api.eventrisk.ai/")
        resp = client.get("/runtime-config.js")
        assert resp.status_code == 200
        assert 'apiBaseUrl": "https://api.eventrisk.ai"' in resp.text

    def test_runtime_config_emits_configured_external_paper_url(self, monkeypatch):
        monkeypatch.setenv("PAPER_URL", "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1234567")
        resp = client.get("/runtime-config.js")
        assert resp.status_code == 200
        assert 'paperUrl": "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1234567"' in resp.text

    def test_blank_paper_url_env_falls_back_to_default_external_link(self, monkeypatch):
        monkeypatch.setenv("PAPER_URL", "   ")
        text = client.get("/simulator").text
        assert "Read the Paper" in text
        assert 'href="https://eventrisk.ai/paper.pdf"' in text

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

    def test_legacy_nav_pages_load_runtime_config_before_nav(self):
        for route in ("/event-markets", "/hedging-simulator", "/probability-gap", "/backtest", "/reports"):
            text = client.get(route).text
            assert "/runtime-config.js" in text
            assert "/static/nav.js" in text

    def test_version_endpoint_exposes_build_and_api_origin(self):
        resp = client.get("/version.json")
        assert resp.status_code == 200
        payload = resp.json()
        assert "buildId" in payload
        assert "gitSha" in payload
        assert payload["apiBaseUrl"] == "http://testserver"

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
        assert "refs.requestedFractionValue.textContent" in text
        assert "refs.effectiveFractionValue.textContent" in text

    def test_simulator_app_does_not_render_duplicate_plot_titles(self):
        text = client.get("/static/scripts/simulator-app.mjs").text
        assert 'title: { text: title' not in text
        assert 'baseLayout("Sportsbook Loss Distribution"' not in text
        assert 'baseLayout("Liquidity-Constrained Risk Transfer Curve"' not in text
        assert 'baseLayout("Hedging Efficiency Frontier"' not in text

    def test_api_client_accepts_runtime_config_key_emitted_by_server(self):
        text = client.get("/static/scripts/api-client.mjs").text
        assert "window.__EVENTRISK_CONFIG" in text
        assert "window.__RUNTIME_CONFIG__" in text

    def test_api_client_uses_bounded_attempt_sequence_and_separates_validation_errors(self):
        text = client.get("/static/scripts/api-client.mjs").text
        assert 'const DEFAULT_API_BASE_URL = "";' in text
        assert "export function resolveApiBaseUrls" in text
        assert "export function shouldEnableApiDebug" in text
        assert "return candidates.slice(0, 2);" in text
        assert 'response.status >= 400 && response.status < 500 ? "validation" : "http"' in text
        assert 'return attempt === 0 && totalAttempts > 1 && (error.kind === "timeout" || error.kind === "network");' in text
        assert "responseText: text.slice(0, 400)" in text
        assert "url = `${baseUrl}${path}`;" in text

    def test_simulator_ui_respects_hidden_state_for_panels(self):
        css = client.get("/static/styles/simulator.css").text
        script = client.get("/static/scripts/simulator-app.mjs").text
        view_state = client.get("/static/scripts/view-state.mjs").text
        assert "[hidden]" in css
        assert "display: none !important;" in css
        assert 'function setPanelsState(status, message = "")' in script
        assert 'const requestId = ++state.requestId;' in script
        assert 'applyViewState(refs.panels[panelKey], "ready");' in script
        assert 'applyViewState(refs.panels[panelKey], "error", normalizeError(error));' in script
        assert "export function applyViewState" in view_state
        assert ".sim-footer" in css
        assert 'console.info("[simulator] resolved API base:", client.baseUrl, client.baseUrls);' in script
        assert "normalizeCurveResponse" in script
        assert "normalizeHistogram" in script
        assert "buildFallbackLiquidityRegimes" in script
        assert '"requested_hedge_fraction"' in script
        assert '"optimal_hedge_ratio"' in script
        assert "formatErrorDetail" in script

    def test_simulator_route_does_not_register_service_workers(self):
        html = client.get("/simulator").text
        script = client.get("/static/scripts/simulator-app.mjs").text
        assert "serviceWorker" not in html
        assert "serviceWorker" not in script

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
        assert distribution_payload["requested_hedge_fraction"] == 0.6
        assert distribution_payload["effective_hedge_fraction"] <= distribution_payload["requested_hedge_fraction"]
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
        assert len(curve_payload["liquidity_regimes"]) == 3

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

    def test_interactive_error_schema_is_clear_for_frontend_diagnostics(self):
        resp = client.post(
            "/api/risk-transfer/interactive",
            json={
                "liability_min": 25_000_000,
                "liability_max": 175_000_000,
                "n_points": 7,
                "objective": "not_a_real_objective",
                "strategy": "external_hedge",
            },
        )
        assert resp.status_code == 400
        assert resp.json()["detail"].startswith("Unknown objective")

    def test_status_contract_remains_ok(self):
        resp = client.get("/status")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
