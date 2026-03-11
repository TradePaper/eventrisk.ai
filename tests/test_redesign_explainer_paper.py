import re

from fastapi.testclient import TestClient

from catalog_app import app


client = TestClient(app)
PAPER_LINK_PATTERN = re.compile(r'<a[^>]*href="([^"]+)"[^>]*>(Read the paper|Open Paper|Paper link)</a>')
SECURE_LINK_PATTERN = re.compile(
    r'<a[^>]*href="([^"]+)"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>(Read the paper|Open Paper|Paper link)</a>'
)


FORBIDDEN_LEGACY = [
    "objective",
    "n_paths",
    "provider",
    "export",
    "catalog",
    "probability-gap",
]


class TestRedesignRoutes:
    def test_root_redirects_to_explainer(self):
        resp = client.get("/", follow_redirects=False)
        assert resp.status_code in (302, 307)
        assert resp.headers["location"] == "/explainer"

    def test_status_contract(self):
        resp = client.get("/status")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_explainer_shell_and_controls(self):
        resp = client.get("/explainer")
        assert resp.status_code == 200
        text = resp.text

        assert "EventRisk" in text
        assert "Explainer" in text
        assert "Paper Figures" in text
        assert "Stress Test" in text
        assert "Read the paper" in text
        assert "External Hedge" in text
        assert "Internal Reprice" in text
        assert "Hybrid" in text
        assert "CVaR-95" in text
        assert "Optimal Hedge Ratio" in text
        assert "superbowl_v1" in text
        assert "id=\"btnBack\"" in text
        assert "id=\"btnNext\"" in text
        assert "id=\"snapDeck\"" in text
        assert "/runtime-config.js" in text
        assert "/static/scripts/explainer.js" in text
        assert "Simulation unavailable" in text
        assert "data-step-target=\"0\"" in text
        assert "data-step-target=\"1\"" in text
        assert "data-step-target=\"2\"" in text

    def test_paper_gallery_figure_titles(self):
        resp = client.get("/static/scripts/paper.js")
        assert resp.status_code == 200
        text = resp.text

        assert "Figure 1 — Unhedged Liability Distribution" in text
        assert "Figure 2 — Hedged vs Unhedged Distribution Overlay" in text
        assert "Figure 3 — Liquidity-Constrained Risk Transfer Curve" in text
        assert "Figure 4 — Hedging Efficiency Frontier" in text
        assert "Figure 5 — Hedging Feasibility Map" in text
        assert "Figure 5 — Sportsbook Hedging Feasibility Map" not in text
        assert "Figure 6 — Preset Stress-Test Snapshot" in text
        assert text.count("window.Plotly.react(") == 6
        assert 'id="paperFigure${index + 1}"' in text
        assert 'const PRESETS = {' in text

    def test_paper_route_includes_plotly_and_figure_mounts(self):
        resp = client.get("/paper")
        assert resp.status_code == 200
        text = resp.text
        assert "https://cdn.plot.ly/plotly-2.35.2.min.js" in text
        assert 'id="figureList"' in text
        assert "/static/scripts/paper.js" in text

    def test_redesigned_routes_hide_legacy_controls(self):
        for route in ("/explainer", "/paper", "/simulator"):
            text = client.get(route).text.lower()
            for forbidden in FORBIDDEN_LEGACY:
                assert forbidden not in text
        explainer = client.get("/explainer").text.lower()
        assert "data-preset" not in explainer

    def test_shared_nav_asset_uses_redesign_destinations(self):
        text = client.get("/static/nav.js").text
        assert "EventRisk" in text
        assert "Read the paper" in text
        assert 'href="/explainer"' in text
        assert 'href="/paper"' in text
        assert 'href="/simulator"' in text
        assert "window.__EVENTRISK_CONFIG" in text
        assert "window.__RUNTIME_CONFIG__" in text
        assert 'target="_blank"' in text
        assert 'rel="noopener noreferrer"' in text
        assert "Event Markets Intelligence" not in text
        assert "Sportsbook Hedge Simulator" not in text

    def test_redesign_routes_use_same_configured_external_paper_link(self, monkeypatch):
        expected = "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1234567"
        monkeypatch.setenv("PAPER_URL", expected)
        for route in ("/explainer", "/paper", "/simulator"):
            text = client.get(route).text
            links = PAPER_LINK_PATTERN.findall(text)
            assert links, f"expected paper links on {route}"
            assert all(href == expected for href, _ in links)
            secure_links = SECURE_LINK_PATTERN.findall(text)
            assert len(secure_links) == len(links)
            assert 'href=""' not in text

    def test_redesign_routes_disable_paper_link_when_missing(self, monkeypatch):
        monkeypatch.delenv("PAPER_URL", raising=False)
        for route in ("/explainer", "/paper", "/simulator"):
            text = client.get(route).text
            assert "Read the paper" in text
            assert 'href=""' not in text
            assert "aria-disabled=\"true\"" in text

    def test_explainer_controls_trigger_live_refresh_paths(self):
        text = client.get("/static/scripts/explainer.js").text
        assert 'const shouldDebugApiBase = new URL(window.location.href).searchParams.get("debugApi") === "1";' in text
        assert 'console.info("[explainer] resolved API base:", client.baseUrl);' in text
        assert 'await hydrateStrategyViews(strategy, { forceRefresh: true });' in text
        assert "if (!updateCurveCardFromCache()) {" in text
        assert 'void hydrateStrategyViews(state.strategy, { forceRefresh: true });' in text
        assert "const step2Key = getStep2CacheKey(strategy);" in text
        assert "const step3Key = getStep3CacheKey(strategy);" in text
        assert "!forceRefresh && hasStep2Cache ? Promise.resolve(state.cache.get(step2Key)) : fetchStep2(strategy)" in text
        assert "!forceRefresh && hasStep3Cache ? Promise.resolve(state.cache.get(step3Key)) : fetchStep3(strategy)" in text
        assert 'seed: "superbowl_v1"' in text
