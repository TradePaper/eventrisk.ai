from fastapi.testclient import TestClient

from catalog_app import app


client = TestClient(app)


FORBIDDEN_LEGACY = [
    "strategy",
    "objective",
    "seed",
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
        assert "data-preset=\"superbowl\"" in text
        assert "data-preset=\"election\"" in text
        assert "data-preset=\"weather\"" in text
        assert "id=\"btnBack\"" in text
        assert "id=\"btnNext\"" in text
        assert "id=\"snapDeck\"" in text

    def test_paper_gallery_figure_titles(self):
        resp = client.get("/static/scripts/paper.js")
        assert resp.status_code == 200
        text = resp.text

        assert "Figure 1 — Unhedged Liability Distribution" in text
        assert "Figure 2 — Hedged vs Unhedged Distribution Overlay" in text
        assert "Figure 3 — Liquidity-Constrained Risk Transfer Curve" in text
        assert "Figure 4 — Hedging Efficiency Frontier" in text
        assert "Figure 5 — Sportsbook Hedging Feasibility Map" in text
        assert "Figure 6 — Preset Stress-Test Snapshot" in text

    def test_redesigned_routes_hide_legacy_controls(self):
        for route in ("/explainer", "/paper", "/simulator"):
            text = client.get(route).text.lower()
            for forbidden in FORBIDDEN_LEGACY:
                assert forbidden not in text

    def test_shared_nav_asset_uses_redesign_destinations(self):
        text = client.get("/static/nav.js").text
        assert "EventRisk" in text
        assert "Read the paper" in text
        assert 'href="/explainer"' in text
        assert 'href="/paper"' in text
        assert 'href="/simulator"' in text
        assert "Event Markets Intelligence" not in text
        assert "Sportsbook Hedge Simulator" not in text
