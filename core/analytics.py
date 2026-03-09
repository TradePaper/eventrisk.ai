from typing import Optional
"""
Server-side PostHog analytics.
Falls back to a no-op when POSTHOG_KEY is not set.
Uses a background thread so network latency never blocks the API response.
"""
import os
import logging
import threading
import requests

_KEY = os.environ.get("POSTHOG_KEY", "")
_HOST = "https://app.posthog.com"
_log = logging.getLogger("analytics")


def _fire(event: str, properties: dict, distinct_id: str) -> None:
    try:
        requests.post(
            f"{_HOST}/capture/",
            json={"api_key": _KEY, "event": event,
                  "distinct_id": distinct_id, "properties": properties},
            timeout=2,
        )
    except Exception as exc:
        _log.debug("posthog capture failed: %s", exc)


def capture(event: str, properties: Optional[dict] = None, distinct_id: str = "server") -> None:
    """Fire a PostHog event asynchronously. No-op when POSTHOG_KEY is absent."""
    if not _KEY:
        _log.debug("[analytics no-op] %s %s", event, properties)
        return
    threading.Thread(
        target=_fire,
        args=(event, properties or {}, distinct_id),
        daemon=True,
    ).start()
