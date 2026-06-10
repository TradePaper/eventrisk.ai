from fastapi.testclient import TestClient

from catalog_app import app


client = TestClient(app)


class TestRuleScreenRoute:
    def test_rule_screen_serves(self):
        resp = client.get("/rule-screen")
        assert resp.status_code == 200
        text = resp.text
        assert "40.11" in text
        assert "RIN 3038-AF65" in text
        assert "not legal advice" in text

    def test_rule_screen_tokens_resolved(self):
        text = client.get("/rule-screen").text
        assert "__ASSET_VERSION__" not in text
        assert "__RUNTIME_CONFIG_SRC__" not in text
        assert "__PAPER_LINK_PAPER_NAV__" not in text
        assert "__VERSION_STAMP__" not in text

    def test_rule_screen_module_wired(self):
        text = client.get("/rule-screen").text
        assert "/static/scripts/rule-screen.mjs" in text

    def test_rule_screen_covers_proposed_framework(self):
        text = client.get("/rule-screen").text
        # Step structure
        assert "Step 1" in text and "Step 2" in text and "Step 3" in text
        # Both proposed gaming definitions
        assert "recreation or to entertain others" in text
        assert "created by its rules" in text
        # Gaming-specific factor anchors
        assert "aggregate" in text.lower()
        assert "collegiate" in text.lower()
        # Hedging-utility factor language
        assert "reasonable potential" in text

    def test_nav_links_added_to_existing_pages(self):
        for route in ("/explainer", "/paper", "/simulator"):
            text = client.get(route).text
            assert 'href="/rule-screen"' in text, f"missing rule-screen link on {route}"
