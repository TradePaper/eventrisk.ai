import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Dict

from backtest.db import init_backtest_tables, insert_snapshot


class SnapshotScheduler:
    def __init__(self, providers: Dict, db_path: str, interval_seconds: int = 300):
        self._providers = providers
        self._db_path = db_path
        self._interval_seconds = max(1, int(interval_seconds))
        self._stop = threading.Event()
        self._thread = None

    def _conn(self):
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def poll_now(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        with self._conn() as conn:
            init_backtest_tables(conn)
            for name, provider in self._providers.items():
                inserted = 0
                try:
                    markets = provider.get_markets(limit=50)
                    ts = datetime.now(timezone.utc).isoformat()
                    for m in markets:
                        outcomes = [o.name for o in getattr(m, "outcomes", [])]
                        insert_snapshot(
                            conn,
                            {
                                "snapshot_id": str(uuid.uuid4()),
                                "event_id": m.event_id,
                                "source": name,
                                "title": m.title,
                                "outcomes_json": str(outcomes),
                                "price": m.price,
                                "implied_prob": m.price,
                                "volume": getattr(m, "volume", None),
                                "liquidity": getattr(m, "liquidity", None),
                                "captured_at_utc": ts,
                            },
                        )
                        inserted += 1
                except Exception:
                    inserted = 0
                counts[name] = inserted
            conn.commit()
        return counts

    def _run(self):
        while not self._stop.is_set():
            self._stop.wait(self._interval_seconds)
            if self._stop.is_set():
                break
            self.poll_now()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)

