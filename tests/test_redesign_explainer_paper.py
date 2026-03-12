import re

from fastapi.testclient import TestClient

from catalog_app import app


client = TestClient(app)
PAPER_LINK_PATTERN = re.compile(r'<a[^>]*href="([^"]+)"[^>]*>(Read the Paper|Open Paper|Paper link)</a>')
SECURE_LINK_PATTERN = re.compile(
    r'<a[^>]*href="([^"]+)"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>(Read the Paper|Open Paper|Paper link)</a>'
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
        assert "The Mechanism" in text
        assert "The Analysis" in text
        assert "Stress Test" in text
        assert "Read the Paper" in text
        assert "Three figures" not in text
        assert "Six figures" in text
        assert "External Hedge" in text
        assert "Internal Reprice" in text
        assert "Hybrid" in text
        assert "Paper-calibrated Super Bowl baseline" in text
        assert "Requested Hedge Fraction" in text
        assert "Effective Hedge Fraction" in text
        assert "Liquidity Binding" in text
        assert "Selected Metric" not in text
        assert "Liquidity Binding Points" not in text
        assert "Step 3 metric" not in text
        assert "Requested Hedge Fraction" in text
        assert "superbowl_v1" in text
        assert "id=\"btnBack\"" in text
        assert "id=\"btnNext\"" in text
        assert "id=\"snapDeck\"" in text
        assert "/runtime-config.js?v=" in text
        assert "/static/scripts/explainer.js?v=" in text
        assert "Simulation unavailable" in text
        assert "data-step-target=\"0\"" in text
        assert "data-step-target=\"1\"" in text
        assert "data-step-target=\"2\"" in text
        assert "rev " in text

    def test_paper_gallery_figure_titles(self):
        resp = client.get("/static/scripts/paper.js")
        assert resp.status_code == 200
        text = resp.text

        expected_titles = [
            "Figure 0: Event Market Risk Transfer Mechanism",
            "Figure 1: Sportsbook Hedging Feasibility Map",
            "Figure 2: Deterministic Hedge Capacity Curve",
            "Figure 3: Sportsbook Risk Profile Under Hedging",
            "Figure 4: Tail-Risk Compression",
            "Figure 5: Hedging Efficiency Frontier",
        ]
        positions = [text.index(title) for title in expected_titles]
        assert positions == sorted(positions)
        assert "Figure 6" not in text

    def test_paper_route_uses_chart_rendering_script_not_text_only_cards(self):
        html = client.get("/paper").text
        js = client.get("/static/scripts/paper.js").text
        assert "/runtime-config.js?v=" in html
        assert "https://cdn.plot.ly/plotly-2.35.2.min.js" in html
        assert "renderFigure0" in js
        assert 'class="mechanism-diagram"' in js
        assert "window.Plotly.react(" in js
        assert 'id="paperFigure${index + 1}"' in js
        assert "renderFigure5" in js
        assert "figure-notes" not in js
        assert js.count("window.Plotly.react(") == 5
        assert 'const PRESETS = {' in js
        assert 'const PAPER_BUILD_ID = String(runtimeConfig.buildId ?? "").trim();' in js
        assert 'import(versionedAssetPath("/static/scripts/hedge-capacity.mjs"))' in js
        assert "await loadPaperDependencies();" in js
        assert "await waitForPlotly();" in js
        assert 'console.error("[paper] chart runtime unavailable", error);' in js
        assert "void renderFigures(data);" in js
        assert "buildStaticFrontierSeries" in js
        assert 'fetch("/api/tier2/frontier"' not in js

    def test_paper_route_includes_plotly_and_figure_mounts(self):
        resp = client.get("/paper")
        assert resp.status_code == 200
        text = resp.text
        assert "https://cdn.plot.ly/plotly-2.35.2.min.js" in text
        assert 'id="figureList"' in text
        assert "Figure 0: Event Market Risk Transfer Mechanism" in text
        assert "/static/scripts/paper.js?v=" in text
        assert text.index("/runtime-config.js?v=") < text.index('plotly-2.35.2.min.js" defer') < text.index("/static/scripts/paper.js?v=")

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
        assert "Read the Paper" in text
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

    def test_redesign_routes_fall_back_to_default_external_paper_link_when_missing(self, monkeypatch):
        monkeypatch.delenv("PAPER_URL", raising=False)
        expected = "https://eventrisk.ai/paper.pdf"
        for route in ("/explainer", "/paper", "/simulator"):
            text = client.get(route).text
            assert "Read the Paper" in text
            assert 'href=""' not in text
            links = PAPER_LINK_PATTERN.findall(text)
            assert links
            assert all(href == expected for href, _ in links)

    def test_paper_pdf_route_serves_hosted_pdf(self):
        resp = client.get("/paper.pdf")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/pdf")

    def test_explainer_controls_trigger_live_refresh_paths(self):
        text = client.get("/static/scripts/explainer.js").text
        static_data = client.get("/static/scripts/explainer-static-data.mjs").text
        assert 'import { CANONICAL_EXPLAINER_SCENARIO, EXPLAINER_STATIC_DATA } from "/static/scripts/explainer-static-data.mjs";' in text
        assert "const CAPACITY_METRIC = {" in text
        assert "renderStaticScenario(state.strategy);" in text
        assert "renderStaticScenario(strategy);" in text
        assert "fetch(EXPLAINER_FALLBACK_PRESET" not in text
        assert 'client.fetchJson("/api/risk-transfer/interactive"' not in text
        assert 'client.fetchJson("/api/risk-transfer/distribution"' not in text
        assert 'refs.deck.scrollTo({ top: refs.steps[nextIndex].offsetTop, behavior: "smooth" });' in text
        assert "const deckMidpoint = deckRect.top + deckRect.height / 2;" in text
        assert "renderStaticStep1(scenario);" in text
        assert "renderStaticStep2(scenario);" in text
        assert "renderStaticStep3(scenario);" in text
        assert 'applyViewState({ plot, skeleton, error }, status);' in text
        assert "Selected Metric" not in text
        assert "Optimal Hedge Ratio" not in text
        assert "Liquidity Binding Points" not in text
        assert "external_hedge" in static_data
        assert "internal_reprice" in static_data
        assert "hybrid" in static_data
        assert '"seed": "superbowl_v1"' not in static_data

    def test_explainer_step_scroller_css_avoids_chrome_height_traps(self):
        css = client.get("/static/styles/eventrisk.css").text
        assert ".snap-deck {" in css
        assert "max-height: calc(100svh - var(--nav-height) - var(--footer-height) - 252px);" in css
        assert "min-height: clamp(640px, calc(100svh - var(--nav-height) - var(--footer-height) - 252px), 920px);" in css
        assert "overflow-y: auto;" in css
        assert "overflow-x: visible;" in css
        assert "scroll-snap-type: y proximity;" in css
        assert "scroll-padding-top: 1rem;" in css
        assert ".snap-step {" in css
        assert "overflow: visible;" in css
