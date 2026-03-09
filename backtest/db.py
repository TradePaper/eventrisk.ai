import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_backtest_tables(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS snapshots (
            snapshot_id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL,
            source TEXT NOT NULL,
            title TEXT NOT NULL,
            outcomes_json TEXT NOT NULL,
            price REAL NOT NULL,
            implied_prob REAL NOT NULL,
            volume REAL,
            liquidity REAL,
            captured_at_utc TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS outcomes (
            event_id TEXT PRIMARY KEY,
            resolved_outcome TEXT NOT NULL,
            resolved_at_utc TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS backtest_run (
            run_id TEXT PRIMARY KEY,
            strategy TEXT NOT NULL,
            params_json TEXT NOT NULL,
            date_from_utc TEXT,
            date_to_utc TEXT,
            source_filter TEXT,
            status TEXT NOT NULL,
            summary_json TEXT,
            created_at_utc TEXT NOT NULL,
            updated_at_utc TEXT NOT NULL
        )
        """
    )


def insert_snapshot(conn, snapshot: Dict[str, Any]) -> str:
    snapshot_id = snapshot.get("snapshot_id") or str(uuid.uuid4())
    conn.execute(
        """
        INSERT OR REPLACE INTO snapshots
        (snapshot_id, event_id, source, title, outcomes_json, price, implied_prob, volume, liquidity, captured_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            snapshot_id,
            snapshot["event_id"],
            snapshot.get("source", "unknown"),
            snapshot.get("title", ""),
            snapshot.get("outcomes_json", "[]"),
            float(snapshot.get("price", 0.0)),
            float(snapshot.get("implied_prob", snapshot.get("price", 0.0))),
            snapshot.get("volume"),
            snapshot.get("liquidity"),
            snapshot.get("captured_at_utc") or _utc_now_iso(),
        ),
    )
    return snapshot_id


def get_snapshots(
    conn,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    source: Optional[str] = None,
    event_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    where = []
    args: List[Any] = []
    if date_from:
        where.append("captured_at_utc >= ?")
        args.append(date_from)
    if date_to:
        where.append("captured_at_utc <= ?")
        args.append(date_to)
    if source:
        where.append("source = ?")
        args.append(source)
    if event_id:
        where.append("event_id = ?")
        args.append(event_id)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = conn.execute(
        f"""
        SELECT snapshot_id, event_id, source, title, outcomes_json, price, implied_prob, volume, liquidity, captured_at_utc
        FROM snapshots
        {clause}
        ORDER BY captured_at_utc ASC
        """,
        args,
    ).fetchall()
    return [dict(r) for r in rows]


def resolve_outcome(conn, event_id: str, resolved_outcome: str, resolved_at_utc: str) -> None:
    conn.execute(
        """
        INSERT INTO outcomes(event_id, resolved_outcome, resolved_at_utc)
        VALUES (?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
            resolved_outcome = excluded.resolved_outcome,
            resolved_at_utc = excluded.resolved_at_utc
        """,
        (event_id, resolved_outcome.upper(), resolved_at_utc),
    )


def get_outcomes(conn) -> Dict[str, Dict[str, Any]]:
    rows = conn.execute(
        "SELECT event_id, resolved_outcome, resolved_at_utc FROM outcomes"
    ).fetchall()
    return {r["event_id"]: dict(r) for r in rows}


def create_run(
    conn,
    strategy: str,
    params: Dict[str, Any],
    date_from: Optional[str],
    date_to: Optional[str],
    source_filter: Optional[str] = None,
) -> str:
    run_id = str(uuid.uuid4())
    now = _utc_now_iso()
    conn.execute(
        """
        INSERT INTO backtest_run
        (run_id, strategy, params_json, date_from_utc, date_to_utc, source_filter, status, summary_json, created_at_utc, updated_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            run_id,
            strategy,
            json.dumps(params or {}),
            date_from,
            date_to,
            source_filter,
            "running",
            None,
            now,
            now,
        ),
    )
    return run_id


def update_run(conn, run_id: str, status: str, summary: Optional[Dict[str, Any]]) -> None:
    conn.execute(
        """
        UPDATE backtest_run
        SET status = ?, summary_json = ?, updated_at_utc = ?
        WHERE run_id = ?
        """,
        (status, json.dumps(summary or {}), _utc_now_iso(), run_id),
    )


def get_run(conn, run_id: str) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        """
        SELECT run_id, strategy, params_json, date_from_utc, date_to_utc, source_filter, status, summary_json, created_at_utc, updated_at_utc
        FROM backtest_run
        WHERE run_id = ?
        """,
        (run_id,),
    ).fetchone()
    return dict(row) if row else None


def list_runs(conn, limit: int = 20) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT run_id, strategy, params_json, date_from_utc, date_to_utc, source_filter, status, summary_json, created_at_utc, updated_at_utc
        FROM backtest_run
        ORDER BY created_at_utc DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def snapshot_count(conn) -> int:
    row = conn.execute("SELECT COUNT(*) AS n FROM snapshots").fetchone()
    return int(row["n"] if row else 0)

