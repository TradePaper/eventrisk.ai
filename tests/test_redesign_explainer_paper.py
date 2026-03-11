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
        assert "Event Markets Intelligence" not in text
        assert "Sportsbook Hedge Simulator" not in text

    def test_redesign_routes_use_same_paper_link_source(self):
        expected = "https://eventrisk.ai/paper"
        for route in ("/explainer", "/paper", "/simulator"):
            text = client.get(route).text
            links = PAPER_LINK_PATTERN.findall(text)
            assert links, f"expected paper links on {route}"
            assert all(href == expected for href, _ in links)
            secure_links = SECURE_LINK_PATTERN.findall(text)
            assert len(secure_links) == len(links)
            assert 'href=""' not in text
