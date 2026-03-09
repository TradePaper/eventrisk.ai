"""
Ticket 5 — Backtest tests: deterministic replay + metric correctness.
Uses in-memory SQLite fixtures; no real providers or network calls.
"""
import json
import sqlite3

import pytest

from backtest.db import (
    init_backtest_tables,
    insert_snapshot,
    resolve_outcome,
    create_run,
    update_run,
    get_snapshots,
    get_outcomes,
    get_run,
    list_runs,
    snapshot_count,
)
from backtest.engine import Trade, run_backtest
from backtest.metrics import (
    realized_pnl,
    max_drawdown,
    hit_rate,
    turnover,
    ev_error,
    brier_score,
    calibration_buckets,
    equity_curve,
    drawdown_curve,
    full_report,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SNAPSHOTS = [
    {
        "snapshot_id": "s1",
        "event_id": "evt_001",
        "source": "mock",
        "title": "Test Event A",
        "outcomes_json": '["YES","NO"]',
        "price": 0.60,
        "implied_prob": 0.60,
        "volume": 1000.0,
        "liquidity": None,
        "captured_at_utc": "2026-01-01T00:00:00+00:00",
    },
    {
        "snapshot_id": "s2",
        "event_id": "evt_002",
        "source": "mock",
        "title": "Test Event B",
        "outcomes_json": '["YES","NO"]',
        "price": 0.40,
        "implied_prob": 0.40,
        "volume": 2000.0,
        "liquidity": None,
        "captured_at_utc": "2026-01-02T00:00:00+00:00",
    },
]

OUTCOMES = {
    "evt_001": {
        "event_id": "evt_001",
        "resolved_outcome": "YES",
        "resolved_at_utc": "2026-01-10T00:00:00+00:00",
    },
    "evt_002": {
        "event_id": "evt_002",
        "resolved_outcome": "NO",
        "resolved_at_utc": "2026-01-11T00:00:00+00:00",
    },
}

PARAMS = {
    "stake": 100.0,
    "american_odds": -110,
    "true_win_prob": 0.5,
    "hedge_fraction": 0.5,
    "fill_probability": 1.0,
    "slippage_bps": 20.0,
    "fee_bps": 10.0,
    "latency_bps": 5.0,
    "n_paths": 200,
}


def _trade(pnl: float, predicted_ev: float = 10.0,
           prob: float = 0.6, outcome_yes: bool = True) -> Trade:
    return Trade(
        event_id="e", captured_at_utc="2026-01-01T00:00:00+00:00",
        strategy="external_hedge", implied_prob=prob,
        predicted_ev=predicted_ev, stake=100.0, liability=190.0,
        effective_hedge=50.0, fill=True,
        outcome_yes=outcome_yes, realized_pnl=pnl,
    )


# ---------------------------------------------------------------------------
# Ticket 1: DB — snapshot schema + insertion
# ---------------------------------------------------------------------------

class TestSnapshotDB:
    def _conn(self, tmp_path):
        conn = sqlite3.connect(str(tmp_path / "t.db"))
        conn.row_factory = sqlite3.Row
        init_backtest_tables(conn)
        return conn

    def test_tables_created(self, tmp_path):
        conn = self._conn(tmp_path)
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        assert {"snapshots", "outcomes", "backtest_run"} <= tables
        conn.close()

    def test_get_snapshots_empty(self, tmp_path):
        conn = self._conn(tmp_path)
        assert get_snapshots(conn) == []
        conn.close()

    def test_insert_and_retrieve_snapshot(self, tmp_path):
        conn = self._conn(tmp_path)
        conn.execute(
            "INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("sid1","evt1","mock","Title","[]",0.5,0.5,None,None,"2026-01-01T00:00:00+00:00"),
        )
        conn.commit()
        rows = get_snapshots(conn)
        conn.close()
        assert len(rows) == 1
        assert rows[0]["event_id"] == "evt1"
        assert rows[0]["implied_prob"] == 0.5

    def test_date_filter(self, tmp_path):
        conn = self._conn(tmp_path)
        for i, ts in enumerate(["2026-01-01T00:00:00+00:00", "2026-02-01T00:00:00+00:00"]):
            conn.execute(
                "INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?)",
                (f"s{i}", f"e{i}", "mock", "T", "[]", 0.5, 0.5, None, None, ts),
            )
        conn.commit()
        rows = get_snapshots(conn, date_from="2026-01-15T00:00:00+00:00")
        conn.close()
        assert len(rows) == 1
        assert rows[0]["event_id"] == "e1"

    def test_source_filter(self, tmp_path):
        conn = self._conn(tmp_path)
        for src in ("mock", "polymarket"):
            conn.execute(
                "INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?)",
                (src, f"e_{src}", src, "T", "[]", 0.5, 0.5, None, None, "2026-01-01T00:00:00+00:00"),
            )
        conn.commit()
        rows = get_snapshots(conn, source="polymarket")
        conn.close()
        assert len(rows) == 1
        assert rows[0]["source"] == "polymarket"


# ---------------------------------------------------------------------------
# Ticket 2: outcome resolver
# ---------------------------------------------------------------------------

class TestOutcomeResolver:
    def _conn(self, tmp_path):
        conn = sqlite3.connect(str(tmp_path / "t.db"))
        conn.row_factory = sqlite3.Row
        init_backtest_tables(conn)
        return conn

    def test_resolve_and_retrieve(self, tmp_path):
        conn = self._conn(tmp_path)
        resolve_outcome(conn, "evt1", "YES", "2026-01-10T00:00:00+00:00")
        conn.commit()
        outcomes = get_outcomes(conn)
        conn.close()
        assert outcomes["evt1"]["resolved_outcome"] == "YES"

    def test_resolve_upserts(self, tmp_path):
        conn = self._conn(tmp_path)
        resolve_outcome(conn, "evt1", "YES", "2026-01-10T00:00:00+00:00")
        resolve_outcome(conn, "evt1", "NO",  "2026-01-10T00:00:00+00:00")
        conn.commit()
        outcomes = get_outcomes(conn)
        conn.close()
        assert outcomes["evt1"]["resolved_outcome"] == "NO"

    def test_resolved_outcome_uppercased(self, tmp_path):
        conn = self._conn(tmp_path)
        resolve_outcome(conn, "evt1", "yes", "2026-01-01T00:00:00+00:00")
        conn.commit()
        outcomes = get_outcomes(conn)
        conn.close()
        assert outcomes["evt1"]["resolved_outcome"] == "YES"


# ---------------------------------------------------------------------------
# Ticket 3: backtest engine — determinism + trade structure
# ---------------------------------------------------------------------------

class TestBacktestEngine:
    def test_one_trade_per_event(self):
        trades = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="t")
        assert len(trades) == 2

    def test_deterministic_with_seed(self):
        t1 = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="repro")
        t2 = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="repro")
        for a, b in zip(t1, t2):
            assert a.realized_pnl == b.realized_pnl
            assert a.predicted_ev == b.predicted_ev

    def test_different_seeds_can_differ(self):
        t1 = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="A")
        t2 = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="B")
        evs1 = [t.predicted_ev for t in t1]
        evs2 = [t.predicted_ev for t in t2]
        assert evs1 != evs2

    def test_resolved_trades_have_pnl(self):
        trades = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="t")
        assert all(t.realized_pnl is not None for t in trades)

    def test_unresolved_trades_have_no_pnl(self):
        trades = run_backtest(SNAPSHOTS, {}, "external_hedge", PARAMS, seed="t")
        assert all(t.realized_pnl is None for t in trades)

    def test_all_strategies_run(self):
        for strat in ("external_hedge", "internal_reprice", "hybrid"):
            trades = run_backtest(SNAPSHOTS, OUTCOMES, strat, PARAMS, seed="s")
            assert len(trades) == 2

    def test_trades_ordered_by_time(self):
        trades = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="t")
        timestamps = [t.captured_at_utc for t in trades]
        assert timestamps == sorted(timestamps)

    def test_fill_prob_1_always_fills(self):
        params = dict(PARAMS, fill_probability=1.0)
        trades = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", params, seed="t")
        assert all(t.fill for t in trades)

    def test_fill_prob_0_never_fills(self):
        params = dict(PARAMS, fill_probability=0.0)
        trades = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", params, seed="t")
        assert not any(t.fill for t in trades)


# ---------------------------------------------------------------------------
# Ticket 4: metrics module
# ---------------------------------------------------------------------------

class TestMetrics:
    def test_realized_pnl_sums_resolved(self):
        trades = [_trade(10.0), _trade(-5.0), _trade(None)]
        assert abs(realized_pnl(trades) - 5.0) < 1e-9

    def test_realized_pnl_ignores_unresolved(self):
        t = Trade("e","t","s",0.5,0.0,100,190,50,False,None,None)
        assert realized_pnl([t]) == 0.0

    def test_max_drawdown_flat(self):
        assert max_drawdown([0.0, 0.0, 0.0]) == 0.0

    def test_max_drawdown_known(self):
        assert abs(max_drawdown([0.0, 100.0, 50.0, 80.0, 20.0]) - 80.0) < 1e-6

    def test_max_drawdown_monotone_up(self):
        assert max_drawdown([1.0, 2.0, 3.0]) == 0.0

    def test_hit_rate_all_positive(self):
        assert hit_rate([_trade(5.0), _trade(3.0)]) == 1.0

    def test_hit_rate_mixed(self):
        assert abs(hit_rate([_trade(5.0), _trade(-1.0)]) - 0.5) < 1e-9

    def test_hit_rate_no_resolved(self):
        t = Trade("e","t","s",0.5,0.0,100,190,50,False,None,None)
        assert hit_rate([t]) == 0.0

    def test_ev_error_perfect(self):
        t = _trade(pnl=42.0, predicted_ev=42.0)
        assert abs(ev_error([t]) - 0.0) < 1e-9

    def test_ev_error_known(self):
        trades = [_trade(pnl=10.0, predicted_ev=20.0), _trade(pnl=30.0, predicted_ev=20.0)]
        assert abs(ev_error(trades) - 10.0) < 1e-9

    def test_brier_score_perfect(self):
        t = _trade(pnl=1.0, prob=1.0, outcome_yes=True)
        assert abs(brier_score([t]) - 0.0) < 1e-9

    def test_brier_score_worst(self):
        t = _trade(pnl=1.0, prob=1.0, outcome_yes=False)
        assert abs(brier_score([t]) - 1.0) < 1e-9

    def test_brier_score_midpoint(self):
        t = _trade(pnl=1.0, prob=0.5, outcome_yes=True)
        assert abs(brier_score([t]) - 0.25) < 1e-9

    def test_equity_curve_length(self):
        trades = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="m")
        eq = equity_curve(trades)
        assert len(eq) == len(trades)

    def test_equity_curve_cumulative(self):
        trades = [_trade(10.0), _trade(5.0)]
        eq = equity_curve(trades)
        assert abs(eq[-1]["equity"] - 15.0) < 1e-6

    def test_drawdown_nonnegative(self):
        trades = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="m")
        dd = drawdown_curve(equity_curve(trades))
        assert all(pt["drawdown"] >= 0 for pt in dd)

    def test_full_report_required_keys(self):
        trades = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="m")
        report = full_report(trades)
        for key in ("realized_pnl", "max_drawdown", "hit_rate", "turnover",
                    "ev_error", "brier_score", "n_trades", "n_resolved",
                    "equity_curve", "drawdown_curve", "calibration_buckets"):
            assert key in report, f"missing key: {key}"

    def test_full_report_n_resolved_matches(self):
        trades = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="m")
        report = full_report(trades)
        assert report["n_resolved"] == 2
        assert report["n_trades"] == 2

    def test_full_report_no_outcomes(self):
        trades = run_backtest(SNAPSHOTS, {}, "external_hedge", PARAMS, seed="m")
        report = full_report(trades)
        assert report["n_resolved"] == 0
        assert report["realized_pnl"] == 0.0

    def test_calibration_buckets_sum_to_n_resolved(self):
        trades = run_backtest(SNAPSHOTS, OUTCOMES, "external_hedge", PARAMS, seed="m")
        buckets = calibration_buckets(trades)
        total = sum(b["n_samples"] for b in buckets)
        resolved = sum(1 for t in trades if t.outcome_yes is not None)
        assert total == resolved


# ---------------------------------------------------------------------------
# Run management
# ---------------------------------------------------------------------------

class TestRunManagement:
    def _conn(self, tmp_path):
        conn = sqlite3.connect(str(tmp_path / "t.db"))
        conn.row_factory = sqlite3.Row
        init_backtest_tables(conn)
        return conn

    def test_create_and_get_run(self, tmp_path):
        conn = self._conn(tmp_path)
        run_id = create_run(conn, "external_hedge", {"stake": 100}, "2026-01-01", "2026-02-01")
        conn.commit()
        run = get_run(conn, run_id)
        conn.close()
        assert run is not None
        assert run["strategy"] == "external_hedge"
        assert run["status"] == "running"

    def test_update_run_to_complete(self, tmp_path):
        conn = self._conn(tmp_path)
        run_id = create_run(conn, "external_hedge", {}, "2026-01-01", "2026-02-01")
        conn.commit()
        update_run(conn, run_id, "complete", {"realized_pnl": 42.0})
        conn.commit()
        run = get_run(conn, run_id)
        conn.close()
        assert run["status"] == "complete"
        assert json.loads(run["summary_json"])["realized_pnl"] == 42.0

    def test_list_runs_ordered_by_recency(self, tmp_path):
        conn = self._conn(tmp_path)
        ids = [create_run(conn, "external_hedge", {}, "2026-01-01", "2026-02-01") for _ in range(3)]
        conn.commit()
        runs = list_runs(conn)
        conn.close()
        assert runs[0]["run_id"] == ids[-1]
