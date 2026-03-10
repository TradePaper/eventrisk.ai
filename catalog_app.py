import sqlite3
import os
import dataclasses
import json
import threading
from contextlib import contextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
import uvicorn

from datetime import datetime, timezone, timedelta

from simulator import SimInput, run_simulation
from providers import MockProvider, PolymarketProvider, KalshiProvider, CachedProvider
from core.types_v12 import SimulationInputV12, LiquidityModel, InternalRepriceModel
from core.strategies import simulate_strategy, simulate_strategy_raw
from core.optimizer import optimize_hedge_ratio, build_risk_transfer_curve
from core.frontier import build_efficiency_frontier
from core.feasibility import build_feasibility_map
from core.analytics import capture as analytics_capture
from backtest.db import (
    init_backtest_tables, get_snapshots, get_outcomes,
    create_run, update_run, get_run, list_runs, resolve_outcome, snapshot_count,
)
from backtest.engine import run_backtest
from backtest.metrics import full_report
from backtest.scheduler import SnapshotScheduler
from backtest.report import (
    list_reports, generate_weekly_report, save_report,
    current_week_label,
)
from core.divergence import compute_divergences, divergence_history_from_snapshots, infer_sport


def _scenario_meta(inp: SimulationInputV12) -> dict:
    return {
        "seed": inp.seed,
        "n_paths": inp.n_paths,
        "fill_probability": inp.fill_probability,
        "liquidity": dataclasses.asdict(inp.liquidity) if inp.liquidity else None,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    }


def _collapsed(ev: float, cvar_95: float, max_loss: float) -> bool:
    return abs(ev - cvar_95) < 1e-4 and abs(cvar_95 - max_loss) < 1e-4

os.makedirs("tmp", exist_ok=True)
DB_PATH = "tmp/contracts.db"

app = FastAPI(title="ProbEdge Research")
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/lib", StaticFiles(directory="lib"), name="lib")


def _serve_page(path: str) -> str:
    with open(path) as f:
        return f.read()


def _runtime_config_payload() -> dict:
    return {
        "apiBaseUrl": os.environ.get("EVENTRISK_API_BASE_URL", "").strip(),
    }


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        init_backtest_tables(conn)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS contracts (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                event_name       TEXT    NOT NULL,
                market_type      TEXT    NOT NULL CHECK(market_type IN ('binary','categorical')),
                oracle_source    TEXT    NOT NULL,
                settlement_rule  TEXT    NOT NULL,
                manipulation_risk TEXT  NOT NULL CHECK(manipulation_risk IN ('low','medium','high')),
                notes            TEXT,
                created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        existing = conn.execute("SELECT COUNT(*) FROM contracts").fetchone()[0]
        if existing == 0:
            seed = [
                (
                    "Super Bowl Winner", "categorical",
                    "NFL official results (NFL.com)",
                    "Resolves YES for the team that wins Super Bowl LIX per official NFL records. "
                    "Categorical: one outcome per team. Settlement within 24 hours of final whistle.",
                    "low",
                    "Outcome determined by on-field play with thousands of independent observers. "
                    "Extremely difficult to manipulate. Major liquidity on Polymarket and Kalshi.",
                ),
                (
                    "US Presidential Election Winner", "categorical",
                    "Associated Press & major network calls; certified state results",
                    "Resolves to the candidate who receives a majority of Electoral College votes "
                    "as certified by Congress on Jan 6.",
                    "medium",
                    "High-profile event with robust oracle sources. Medium risk due to potential "
                    "certification disputes and litigation delays.",
                ),
                (
                    "Federal Reserve Rate Decision", "binary",
                    "FOMC official statement (federalreserve.gov)",
                    "Resolves YES if the federal funds target rate is raised by ≥25 bps at the "
                    "scheduled FOMC meeting. Resolves NO otherwise.",
                    "low",
                    "Binary contract with unambiguous settlement criteria. Oracle is the Fed itself.",
                ),
                (
                    "Best Picture — Academy Awards", "categorical",
                    "Academy of Motion Picture Arts and Sciences official announcement",
                    "Resolves to the film named Best Picture at the Academy Awards ceremony.",
                    "high",
                    "High manipulation risk. Voting body is ~10,000 members — small enough that "
                    "coordinated campaigns can shift probabilities.",
                ),
            ]
            conn.executemany(
                "INSERT INTO contracts (event_name, market_type, oracle_source, settlement_rule, manipulation_risk, notes) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                seed,
            )


# ---------------------------------------------------------------------------
# Contract model
# ---------------------------------------------------------------------------

class ContractIn(BaseModel):
    event_name: str
    market_type: str
    oracle_source: str
    settlement_rule: str
    manipulation_risk: str
    notes: Optional[str] = ""


# ---------------------------------------------------------------------------
# Page routes
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def index():
    return RedirectResponse(url="/explainer")


@app.get("/explainer", response_class=HTMLResponse)
def explainer_page():
    return _serve_page("static/explainer.html")


@app.get("/paper", response_class=HTMLResponse)
def paper_page():
    return _serve_page("static/paper.html")


@app.get("/simulator", response_class=HTMLResponse)
def simulator_page():
    return _serve_page("static/simulator.html")


@app.get("/runtime-config.js")
def runtime_config():
    payload = json.dumps(_runtime_config_payload())
    return Response(
        content=f"window.__EVENTRISK_RUNTIME_CONFIG__ = Object.freeze({payload});",
        media_type="application/javascript",
    )


@app.get("/event-markets", response_class=HTMLResponse)
def event_markets():
    return _serve_page("static/event-markets.html")


@app.get("/hedging-simulator", response_class=HTMLResponse)
def hedging_simulator():
    return _serve_page("static/index.html")


@app.get("/probability-gap", response_class=HTMLResponse)
def probability_gap():
    return _serve_page("static/probability-gap.html")


@app.get("/contract-library", response_class=HTMLResponse)
def contract_library():
    return _serve_page("static/catalog.html")


@app.get("/backtest", response_class=HTMLResponse)
def backtest_page():
    return _serve_page("static/backtest.html")


@app.get("/reports", response_class=HTMLResponse)
def reports_page():
    return _serve_page("static/reports.html")


# ---------------------------------------------------------------------------
# API — contracts
# ---------------------------------------------------------------------------

@app.get("/api/contracts")
def list_contracts(q: Optional[str] = Query(None)):
    with get_db() as conn:
        if q and q.strip():
            like = f"%{q.strip()}%"
            rows = conn.execute(
                """SELECT id, event_name, market_type, oracle_source, manipulation_risk, created_at
                   FROM contracts
                   WHERE event_name LIKE ? OR oracle_source LIKE ? OR notes LIKE ? OR settlement_rule LIKE ?
                   ORDER BY id DESC""",
                (like, like, like, like),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, event_name, market_type, oracle_source, manipulation_risk, created_at "
                "FROM contracts ORDER BY id DESC"
            ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/contracts/{contract_id}")
def get_contract(contract_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM contracts WHERE id = ?", (contract_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Contract not found")
    return dict(row)


@app.post("/api/contracts", status_code=201)
def create_contract(contract: ContractIn):
    if contract.market_type not in ("binary", "categorical"):
        raise HTTPException(status_code=422, detail="market_type must be binary or categorical")
    if contract.manipulation_risk not in ("low", "medium", "high"):
        raise HTTPException(status_code=422, detail="manipulation_risk must be low, medium, or high")
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO contracts (event_name, market_type, oracle_source, settlement_rule, manipulation_risk, notes) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                contract.event_name.strip(), contract.market_type,
                contract.oracle_source.strip(), contract.settlement_rule.strip(),
                contract.manipulation_risk, (contract.notes or "").strip(),
            ),
        )
        new_id = cur.lastrowid
    return {"id": new_id, "message": "Contract created"}


@app.delete("/api/contracts/{contract_id}", status_code=204)
def delete_contract(contract_id: int):
    with get_db() as conn:
        result = conn.execute("DELETE FROM contracts WHERE id = ?", (contract_id,))
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Contract not found")


# ---------------------------------------------------------------------------
# API — simulation
# ---------------------------------------------------------------------------

@app.post("/simulate")
def simulate(params: SimInput):
    return run_simulation(params)


class LiquidityModelIn(BaseModel):
    available_liquidity: float
    participation_rate: float
    impact_factor: float
    depth_exponent: float = 1.0


class InternalRepriceModelIn(BaseModel):
    enabled: bool
    odds_move_sensitivity: float
    handle_retention_decay: float
    min_prob: float = 0.01
    max_prob: float = 0.99


class SimulateV12In(BaseModel):
    stake: float
    american_odds: int
    true_win_prob: float
    hedge_fraction: float = 0.5
    fill_probability: float = 1.0
    slippage_bps: float = 20.0
    fee_bps: float = 10.0
    latency_bps: float = 5.0
    n_paths: int = 5000
    seed: Optional[str] = None
    liability: float = 0.0
    strategy: str = "external_hedge"
    objective: str = "min_cvar"
    optimize: bool = False
    liquidity: Optional[LiquidityModelIn] = None
    internal_reprice: Optional[InternalRepriceModelIn] = None

    class Config:
        extra = "ignore"


class RiskCurveIn(BaseModel):
    base: SimulateV12In
    liabilities: list
    strategy: str = "external_hedge"


class Tier2ScenarioIn(BaseModel):
    liability: float
    liquidity: float
    true_probability: float
    market_price: float
    target_hedge_ratio: float
    simulation_count: int


@app.post("/simulate/v12")
def simulate_v12(params: SimulateV12In):
    liq = (
        LiquidityModel(**params.liquidity.dict())
        if params.liquidity else None
    )
    reprice = (
        InternalRepriceModel(**params.internal_reprice.dict())
        if params.internal_reprice else None
    )
    inp = SimulationInputV12(
        stake=params.stake,
        american_odds=params.american_odds,
        true_win_prob=params.true_win_prob,
        hedge_fraction=params.hedge_fraction,
        fill_probability=params.fill_probability,
        slippage_bps=params.slippage_bps,
        fee_bps=params.fee_bps,
        latency_bps=params.latency_bps,
        n_paths=params.n_paths,
        seed=params.seed,
        liability=params.liability,
        strategy=params.strategy,
        objective=params.objective,
        liquidity=liq,
        internal_reprice=reprice,
    )
    if params.optimize:
        metrics = optimize_hedge_ratio(inp)
    else:
        metrics = simulate_strategy(inp)

    collapsed = _collapsed(metrics.ev, metrics.cvar_95, metrics.max_loss)
    analytics_capture("v12_simulation_run", {
        "strategy": inp.strategy,
        "objective": inp.objective,
        "n_paths": inp.n_paths,
        "optimize": params.optimize,
        "distribution_collapsed": collapsed,
    })
    result = dataclasses.asdict(metrics)
    result["distribution_collapsed"] = collapsed
    result["collapse_reason"] = (
        "fill_probability=1.0 with full hedge eliminates all outcome variance; "
        "tail metrics equal by construction." if collapsed else None
    )
    result["scenario"] = _scenario_meta(inp)
    return result


@app.post("/simulate/v12/curve")
def simulate_v12_curve(params: RiskCurveIn):
    base = params.base
    liq = LiquidityModel(**base.liquidity.dict()) if base.liquidity else None
    reprice = InternalRepriceModel(**base.internal_reprice.dict()) if base.internal_reprice else None
    inp = SimulationInputV12(
        stake=base.stake,
        american_odds=base.american_odds,
        true_win_prob=base.true_win_prob,
        hedge_fraction=base.hedge_fraction,
        fill_probability=base.fill_probability,
        slippage_bps=base.slippage_bps,
        fee_bps=base.fee_bps,
        latency_bps=base.latency_bps,
        n_paths=base.n_paths,
        seed=base.seed,
        liability=base.liability,
        strategy=base.strategy,
        objective=base.objective,
        liquidity=liq,
        internal_reprice=reprice,
    )
    sorted_liabilities = sorted(float(x) for x in params.liabilities)
    curve = build_risk_transfer_curve(inp, sorted_liabilities, params.strategy)
    assert len(curve.points) == len(sorted_liabilities)
    return {
        "strategy": curve.strategy,
        "liabilities_requested": len(sorted_liabilities),
        "points": [dataclasses.asdict(pt) for pt in curve.points],
    }


@app.get("/api/risk-transfer")
def get_risk_transfer(
    strategy: str  = Query("external_hedge", pattern="^(external_hedge|internal_reprice|hybrid)$"),
    objective: str = Query("min_cvar",       pattern="^(min_cvar|min_max_loss|max_sharpe|target_ev_min_risk)$"),
    liabilities: str = Query("500,1000,2000,4000,8000"),
    stake: float = Query(1000.0, gt=0),
    american_odds: int = Query(-110),
    true_win_prob: float = Query(0.52, gt=0, lt=1),
    fill_probability: float = Query(0.85, gt=0, le=1),
    slippage_bps: float = Query(20.0, ge=0),
    fee_bps: float = Query(10.0, ge=0),
    latency_bps: float = Query(5.0, ge=0),
    n_paths: int = Query(3000, ge=100, le=50000),
    seed: Optional[str] = Query(None),
):
    try:
        sorted_liabilities = sorted(float(x.strip()) for x in liabilities.split(",") if x.strip())
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="liabilities must be a comma-separated list of numbers")

    inp = SimulationInputV12(
        stake=stake,
        american_odds=american_odds,
        true_win_prob=true_win_prob,
        hedge_fraction=0.5,
        fill_probability=fill_probability,
        slippage_bps=slippage_bps,
        fee_bps=fee_bps,
        latency_bps=latency_bps,
        n_paths=n_paths,
        seed=seed,
        liability=0.0,
        strategy=strategy,
        objective=objective,
    )
    curve = build_risk_transfer_curve(inp, sorted_liabilities, strategy)
    points_out = []
    any_collapsed = False
    for pt in curve.points:
        d = dataclasses.asdict(pt)
        col = _collapsed(pt.ev, pt.cvar_95, pt.max_loss)
        if col:
            any_collapsed = True
        d["distribution_collapsed"] = col
        points_out.append(d)

    analytics_capture("risk_transfer_curve_requested", {
        "strategy": strategy,
        "objective": objective,
        "n_liabilities": len(sorted_liabilities),
        "any_collapsed": any_collapsed,
    })
    return {
        "strategy": curve.strategy,
        "objective": objective,
        "liabilities_requested": len(sorted_liabilities),
        "any_distribution_collapsed": any_collapsed,
        "collapse_reason": (
            "One or more points have fill_probability=1.0 with full hedge; "
            "tail metrics equal EV by construction." if any_collapsed else None
        ),
        "scenario": _scenario_meta(inp),
        "points": points_out,
    }


def _tier2_base_input(params: Tier2ScenarioIn) -> SimulationInputV12:
    p = min(max(params.market_price, 0.001), 0.999)
    american_odds = int(-100 * p / (1 - p)) if p >= 0.5 else int(100 * (1 - p) / p)
    return SimulationInputV12(
        stake=max(params.liability, 1.0),
        american_odds=american_odds,
        true_win_prob=params.true_probability,
        hedge_fraction=params.target_hedge_ratio,
        fill_probability=1.0,
        slippage_bps=20.0,
        fee_bps=10.0,
        latency_bps=5.0,
        n_paths=params.simulation_count,
        seed="tier2-frontier",
        liability=params.liability,
        strategy="external_hedge",
        objective="max_ev",
        liquidity=LiquidityModel(
            available_liquidity=params.liquidity,
            participation_rate=1.0,
            impact_factor=0.0,
            depth_exponent=1.0,
        ),
        cvar_alpha=0.95,
    )


@app.post("/api/tier2/frontier")
def tier2_frontier(params: Tier2ScenarioIn):
    return {
        "title": "Figure 4 — Hedging Efficiency Frontier",
        "frontiers": build_efficiency_frontier(_tier2_base_input(params)),
    }


@app.post("/api/tier2/feasibility")
def tier2_feasibility(params: Tier2ScenarioIn):
    return {
        "title": "Figure 5 — Sportsbook Hedging Feasibility Map",
        "current": {
            "liability": params.liability,
            "liquidity": params.liquidity,
        },
        **build_feasibility_map(params.target_hedge_ratio),
    }


# ---------------------------------------------------------------------------
# Market providers
# ---------------------------------------------------------------------------

_PROVIDERS = {
    "mock":       CachedProvider(MockProvider(),        ttl=30),
    "polymarket": CachedProvider(PolymarketProvider(),  ttl=30),
    "kalshi":     CachedProvider(KalshiProvider(),      ttl=30),
}

_SNAPSHOT_INTERVAL = int(os.environ.get("SNAPSHOT_INTERVAL_SECONDS", "300"))
_scheduler = SnapshotScheduler(_PROVIDERS, DB_PATH, interval_seconds=_SNAPSHOT_INTERVAL)
_scheduler.start()


@app.get("/api/markets")
def list_markets(
    source: str = Query("mock", pattern="^(mock|polymarket|kalshi)$"),
    limit: int  = Query(20, ge=1, le=100),
):
    provider = _PROVIDERS[source]
    try:
        markets = provider.get_markets(limit=limit)
    except Exception as exc:
        fallback = _PROVIDERS["mock"].get_markets(limit=limit)
        return {
            "source": "mock",
            "fallback": True,
            "error": str(exc),
            "updated_at": _PROVIDERS["mock"].get_timestamp(),
            "markets": [dataclasses.asdict(m) for m in fallback],
        }
    return {
        "source": source,
        "fallback": False,
        "error": None,
        "updated_at": provider.get_timestamp(),
        "markets": [dataclasses.asdict(m) for m in markets],
    }


@app.get("/api/markets/{event_id}")
def get_market(
    event_id: str,
    source: str = Query("mock", pattern="^(mock|polymarket|kalshi)$"),
):
    provider = _PROVIDERS[source]
    try:
        market = provider.get_prices(event_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Provider error: {exc}")
    if market is None:
        raise HTTPException(status_code=404, detail="Market not found")
    return dataclasses.asdict(market)


@app.get("/api/providers/health")
def providers_health():
    return {
        name: dataclasses.asdict(provider.health)
        for name, provider in _PROVIDERS.items()
    }


@app.get("/api/config")
def app_config():
    return {
        "posthogKey": os.environ.get("POSTHOG_KEY", ""),
    }


@app.get("/status")
def status():
    return {"ok": True}


# ---------------------------------------------------------------------------
# API — backtest
# ---------------------------------------------------------------------------

class BacktestRunIn(BaseModel):
    strategy: str = "external_hedge"
    date_from_utc: str
    date_to_utc: str
    source_filter: Optional[str] = None
    stake: float = 100.0
    hedge_fraction: float = 0.5
    fill_probability: float = 0.85
    true_win_prob: float = 0.5
    slippage_bps: float = 20.0
    fee_bps: float = 10.0
    latency_bps: float = 5.0
    n_paths: int = 500
    seed: Optional[str] = None


class OutcomeIn(BaseModel):
    event_id: str
    resolved_outcome: str
    resolved_at_utc: str


@app.post("/api/backtest/run", status_code=202)
def start_backtest_run(params: BacktestRunIn):
    params_dict = {
        "stake": params.stake,
        "hedge_fraction": params.hedge_fraction,
        "fill_probability": params.fill_probability,
        "true_win_prob": params.true_win_prob,
        "slippage_bps": params.slippage_bps,
        "fee_bps": params.fee_bps,
        "latency_bps": params.latency_bps,
        "n_paths": params.n_paths,
        "seed": params.seed,
    }
    with get_db() as conn:
        run_id = create_run(
            conn,
            strategy=params.strategy,
            params=params_dict,
            date_from=params.date_from_utc,
            date_to=params.date_to_utc,
            source_filter=params.source_filter,
        )

    def _run():
        try:
            with get_db() as conn:
                snapshots = get_snapshots(
                    conn,
                    date_from=params.date_from_utc,
                    date_to=params.date_to_utc,
                    source=params.source_filter,
                )
                outcomes = get_outcomes(conn)
            trades = run_backtest(
                snapshots=snapshots,
                outcomes=outcomes,
                strategy=params.strategy,
                params=params_dict,
                seed=params.seed,
            )
            report = full_report(trades)
            with get_db() as conn:
                update_run(conn, run_id, "complete", report)
        except Exception as exc:
            with get_db() as conn:
                update_run(conn, run_id, "failed", {"error": str(exc)})

    threading.Thread(target=_run, daemon=True).start()
    analytics_capture("backtest_run_started", {"strategy": params.strategy, "run_id": run_id})
    return {"run_id": run_id, "status": "running"}


@app.get("/api/backtest/snapshots/count")
def backtest_snapshot_count():
    with get_db() as conn:
        count = snapshot_count(conn)
    return {"count": count}


@app.post("/api/backtest/snapshot/poll")
def force_snapshot_poll():
    counts = _scheduler.poll_now()
    return {"counts": counts}


@app.post("/api/backtest/outcomes")
def add_outcome(body: OutcomeIn):
    with get_db() as conn:
        resolve_outcome(conn, body.event_id, body.resolved_outcome, body.resolved_at_utc)
    return {"event_id": body.event_id, "resolved_outcome": body.resolved_outcome.upper()}


@app.get("/api/backtest/{run_id}")
def get_backtest_run(run_id: str):
    with get_db() as conn:
        run = get_run(conn, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    run["summary"]  = json.loads(run["summary_json"])  if run.get("summary_json")  else None
    run["params"]   = json.loads(run["params_json"])   if run.get("params_json")   else None
    return run


@app.get("/api/backtest")
def list_backtest_runs(limit: int = Query(20, ge=1, le=100)):
    with get_db() as conn:
        runs = list_runs(conn, limit=limit)
    for r in runs:
        r["summary"] = json.loads(r["summary_json"]) if r.get("summary_json") else None
    return {"runs": runs}


# ---------------------------------------------------------------------------
# API — divergence
# ---------------------------------------------------------------------------

_ALL_SOURCES = list(_PROVIDERS.keys())   # ["mock", "polymarket", "kalshi"]


@app.get("/api/divergence/top")
def divergence_top(
    source:          Optional[str] = Query(None, pattern="^(mock|polymarket|kalshi)$"),
    source1:         Optional[str] = Query(None, pattern="^(mock|polymarket|kalshi)$"),
    source2:         Optional[str] = Query(None, pattern="^(mock|polymarket|kalshi)$"),
    limit:           int   = Query(10,    ge=1,  le=100),
    min_gap:         float = Query(0.005, ge=0.0, le=1.0),
    min_confidence:  float = Query(0.0,   ge=0.0, le=1.0),
    sport:           Optional[str] = Query(None),
):
    """
    Return cross-source divergences sorted by gap descending.

    - `source`         — anchor source; compares against all other providers
    - `source1/source2` — explicit pair (backward compat; ignored when `source` is set)
    - `min_confidence` — filter by confidence score (0–1)
    - `sport`          — filter by inferred sport tag (nfl, nba, mlb, nhl, soccer, …)
    """
    all_divs: list = []
    sources_compared: list = []

    if source:
        # Fan out: compare anchor source against every other provider
        others = [s for s in _ALL_SOURCES if s != source]
        anchor_markets = _PROVIDERS[source].get_markets(limit=200)
        for other in others:
            other_markets = _PROVIDERS[other].get_markets(limit=200)
            divs = compute_divergences(
                anchor_markets, other_markets, source, other, min_gap=min_gap
            )
            all_divs.extend(divs)
            sources_compared.append(f"{source}↔{other}")

        # Deduplicate by event_id_1: keep highest-confidence match per anchor event
        seen: dict = {}
        for d in all_divs:
            if d.event_id_1 not in seen or d.confidence > seen[d.event_id_1].confidence:
                seen[d.event_id_1] = d
        all_divs = list(seen.values())
    else:
        s1 = source1 or "mock"
        s2 = source2 or "polymarket"
        m1 = _PROVIDERS[s1].get_markets(limit=200)
        m2 = _PROVIDERS[s2].get_markets(limit=200)
        all_divs = compute_divergences(m1, m2, s1, s2, min_gap=min_gap)
        sources_compared = [f"{s1}↔{s2}"]

    # Apply post-filters
    if min_confidence > 0.0:
        all_divs = [d for d in all_divs if d.confidence >= min_confidence]
    if sport:
        sport_lower = sport.lower()
        all_divs = [d for d in all_divs if (d.sport or "") == sport_lower]

    all_divs.sort(key=lambda d: d.gap, reverse=True)

    return {
        "source":           source,
        "sources_compared": sources_compared,
        "sport_filter":     sport,
        "min_confidence":   min_confidence,
        "n_matched":        len(all_divs),
        "divergences":      [dataclasses.asdict(d) for d in all_divs[:limit]],
        "timestamp_utc":    datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/divergence/history")
def divergence_history(
    source1:  str          = Query("mock",       pattern="^(mock|polymarket|kalshi)$"),
    source2:  str          = Query("polymarket", pattern="^(mock|polymarket|kalshi)$"),
    event_id: Optional[str]= Query(None),
    hours:    Optional[int]= Query(None, ge=1, le=8760),
    limit:    int          = Query(500, ge=1, le=5000),
):
    """
    Return historical gap time-series from stored snapshots.

    - `event_id` — restrict to a single event (exact match)
    - `hours`    — look-back window in hours (e.g. 168 = 7 days); default: all history
    - `limit`    — max points returned (applied after windowing)
    """
    since_utc = None
    if hours is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        since_utc = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")

    with get_db() as conn:
        snaps = get_snapshots(conn, date_from=since_utc, event_id=event_id)

    points = divergence_history_from_snapshots(snaps, source1, source2)
    window = points[-limit:]

    # Single-event response: slimmed schema matching the per-event contract
    if event_id is not None:
        title = window[0]["title"] if window else None
        sport = window[0].get("sport") if window else None
        return {
            "event_id": event_id,
            "title":    title,
            "sport":    sport,
            "source1":  source1,
            "source2":  source2,
            "hours":    hours,
            "since_utc": since_utc,
            "n_points": len(window),
            "points": [
                {
                    "timestamp_utc":   p["timestamp_utc"],
                    "sportsbook_prob": p["sportsbook_prob"],
                    "prediction_prob": p["prediction_prob"],
                    "gap_bps":         p["gap_bps"],
                }
                for p in window
            ],
        }

    # Multi-event response: full schema with all fields
    events_seen: dict = {}
    for p in points:
        if p["event_id"] not in events_seen:
            events_seen[p["event_id"]] = {
                "event_id": p["event_id"],
                "title":    p["title"],
                "sport":    p.get("sport"),
            }

    return {
        "source1":    source1,
        "source2":    source2,
        "hours":      hours,
        "since_utc":  since_utc,
        "n_points":   len(points),
        "events":     list(events_seen.values()),
        "points":     window,
    }


# ---------------------------------------------------------------------------
# API — interactive risk transfer curve (v2: multi-strategy, multi-liability)
# ---------------------------------------------------------------------------

class _LiquidityIn(BaseModel):
    available_liquidity: float = 1_000_000.0
    participation_rate: float = 0.2
    impact_factor: float = 0.6
    depth_exponent: float = 1.0


class _InternalRepriceIn(BaseModel):
    enabled: bool = True
    odds_move_sensitivity: float = 0.000002
    handle_retention_decay: float = 0.25
    min_prob: float = 0.01
    max_prob: float = 0.99


class _BaseInputIn(BaseModel):
    stake: float = 100.0
    american_odds: int = -110
    true_win_prob: float = 0.54
    fill_probability: float = 0.85
    slippage_bps: float = 8.0
    fee_bps: float = 2.0
    latency_bps: float = 3.0
    n_paths: int = 300
    seed: Optional[str] = None
    liquidity: Optional[_LiquidityIn] = None
    internal_reprice: Optional[_InternalRepriceIn] = None


_VALID_STRATEGIES = {"external_hedge", "internal_reprice", "hybrid"}
_VALID_OBJECTIVES = {"min_cvar", "min_max_loss", "max_ev", "max_sharpe", "target_ev_min_risk"}


class InteractiveCurveInV2(BaseModel):
    strategy_modes: List[str] = ["external_hedge"]
    objective: str = "min_cvar"
    liabilities: List[float] = [1000.0]
    base_input: _BaseInputIn = _BaseInputIn()


def _build_sim(base: _BaseInputIn, strategy: str, objective: str,
               liability: float, hedge_fraction: float, n_paths: int) -> SimulationInputV12:
    liq = None
    if base.liquidity:
        liq = LiquidityModel(
            available_liquidity=base.liquidity.available_liquidity,
            participation_rate=base.liquidity.participation_rate,
            impact_factor=base.liquidity.impact_factor,
            depth_exponent=base.liquidity.depth_exponent,
        )
    irp = None
    if base.internal_reprice:
        irp = InternalRepriceModel(
            enabled=base.internal_reprice.enabled,
            odds_move_sensitivity=base.internal_reprice.odds_move_sensitivity,
            handle_retention_decay=base.internal_reprice.handle_retention_decay,
            min_prob=base.internal_reprice.min_prob,
            max_prob=base.internal_reprice.max_prob,
        )
    return SimulationInputV12(
        stake=base.stake,
        american_odds=base.american_odds,
        true_win_prob=base.true_win_prob,
        hedge_fraction=hedge_fraction,
        fill_probability=base.fill_probability,
        slippage_bps=base.slippage_bps,
        fee_bps=base.fee_bps,
        latency_bps=base.latency_bps,
        n_paths=n_paths,
        seed=base.seed,
        liability=liability,
        strategy=strategy,
        objective=objective,
        liquidity=liq,
        internal_reprice=irp,
    )


@app.post("/api/risk-transfer/interactive/v2")
def interactive_risk_transfer(inp: InteractiveCurveInV2):
    """
    Multi-dimensional sweep: for each (strategy, liability) pair sweep
    hedge_fraction 0→1 at step 0.05 and find the optimal point per objective.
    """
    import numpy as np
    from core.optimizer import _objective_score

    # Validate
    bad_strats = [s for s in inp.strategy_modes if s not in _VALID_STRATEGIES]
    if bad_strats:
        raise HTTPException(400, f"Unknown strategy_modes: {bad_strats}")
    if inp.objective not in _VALID_OBJECTIVES:
        raise HTTPException(400, f"Unknown objective: {inp.objective}")
    if not inp.liabilities:
        raise HTTPException(400, "liabilities must be a non-empty list")
    if len(inp.strategy_modes) * len(inp.liabilities) > 50:
        raise HTTPException(400, "Too many combinations (max 50).")

    n_paths = min(inp.base_input.n_paths, 500)
    grid = np.arange(0.0, 1.01, 0.05)

    def _collapsed(m) -> bool:
        return (abs(m.ev - m.max_loss) < 0.01 and abs(m.p5 - m.p95) < 0.01)

    # Build series grouped by strategy; each point = one liability (optimal only)
    series = []
    for strategy in inp.strategy_modes:
        points = []
        for liability in inp.liabilities:
            best_score = float("-inf")
            best_hf = 0.0
            best_m = None

            for hf in grid:
                sim = _build_sim(
                    inp.base_input, strategy, inp.objective,
                    float(liability), float(hf), n_paths,
                )
                m = simulate_strategy(sim)
                score = _objective_score(m, inp.objective)
                if score > best_score:
                    best_score = score
                    best_hf = float(hf)
                    best_m = m

            # Collect raw paths for histogram overlay (unhedged hf=0, hedged=best_hf)
            sim_unhedged = _build_sim(inp.base_input, strategy, inp.objective, float(liability), 0.0, n_paths)
            sim_hedged   = _build_sim(inp.base_input, strategy, inp.objective, float(liability), best_hf, n_paths)
            unhedged_paths = simulate_strategy_raw(sim_unhedged).round(4).tolist()
            hedged_paths   = simulate_strategy_raw(sim_hedged).round(4).tolist()

            points.append({
                "liability":              float(liability),
                "optimal_hedge_ratio":    round(best_hf, 2),
                "ev":                     round(best_m.ev, 4),
                "cvar_95":                round(best_m.cvar_95, 4),
                "max_loss":               round(best_m.max_loss, 4),
                "distribution_collapsed": _collapsed(best_m),
                "unhedged_paths":         unhedged_paths,
                "hedged_paths":           hedged_paths,
            })

        series.append({"strategy": strategy, "points": points})

    return {
        "scenario": {
            "seed":             inp.base_input.seed,
            "n_paths":          n_paths,
            "fill_probability": inp.base_input.fill_probability,
            "timestamp_utc":    datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "objective": inp.objective,
        "series":    series,
    }


# ---------------------------------------------------------------------------
# API — interactive risk transfer curve (v3: article-first, flat request)
# ---------------------------------------------------------------------------

def _prob_to_american(prob: float) -> int:
    """Convert a win probability (0–1) to nearest-integer American odds."""
    prob = max(0.001, min(0.999, prob))
    if prob >= 0.5:
        return int(round(-prob / (1.0 - prob) * 100))
    return int(round((1.0 - prob) / prob * 100))


def _histogram(pnl_arr, bins=30):
    """Return a compact histogram dict from a numpy array."""
    import numpy as np
    lo, hi = float(pnl_arr.min()), float(pnl_arr.max())
    if abs(hi - lo) < 1e-9:
        hi = lo + 1.0
    edges = np.linspace(lo, hi, bins + 1)
    counts, _ = np.histogram(pnl_arr, bins=edges)
    mids = ((edges[:-1] + edges[1:]) / 2).round(4).tolist()
    sorted_pnl = np.sort(pnl_arr)
    tail_n = max(1, int(len(sorted_pnl) * 0.05))
    cvar = float(sorted_pnl[:tail_n].mean())
    return {
        "bin_mids":  mids,
        "bin_edges": edges.round(4).tolist(),
        "counts":    counts.tolist(),
        "ev":        round(float(pnl_arr.mean()), 4),
        "cvar":      round(cvar, 4),
        "max_loss":  round(float(pnl_arr.min()), 4),
    }


_MAX_INLINE_PATHS = 250


class InteractiveCurveV3In(BaseModel):
    liability_min: float = 500.0
    liability_max: float = 8000.0
    n_points: int = 5
    true_probability: float = 0.54
    prediction_market_price: float = 0.48
    liquidity: Optional[_LiquidityIn] = None
    fill_probability: float = 0.85
    objective: str = "max_ev"
    strategy: str = "external_hedge"
    seed: Optional[str] = "superbowl_v1"
    n_paths: int = 500


@app.post("/api/risk-transfer/interactive")
def interactive_risk_transfer_v3(inp: InteractiveCurveV3In):
    """
    Article-first interactive risk-transfer curve.

    Returns scenario_metadata, sorted curve_points with liquidity_binding flags,
    liquidity_cap info, mid-curve distributions (raw or binned), and collapse_flags.
    """
    import numpy as np
    from core.optimizer import _objective_score
    from core.liquidity import max_hedge_notional

    if inp.strategy not in _VALID_STRATEGIES:
        raise HTTPException(400, f"Unknown strategy: {inp.strategy}. Valid: {sorted(_VALID_STRATEGIES)}")
    if inp.objective not in _VALID_OBJECTIVES:
        raise HTTPException(400, f"Unknown objective: {inp.objective}. Valid: {sorted(_VALID_OBJECTIVES)}")
    n_pts = max(2, min(inp.n_points, 20))
    n_paths = min(inp.n_paths, 500)

    american_odds = _prob_to_american(inp.prediction_market_price)
    liabilities = np.linspace(inp.liability_min, inp.liability_max, n_pts).tolist()

    # Build a fake base_input from the flat fields
    base = _BaseInputIn(
        stake=100.0,
        american_odds=american_odds,
        true_win_prob=inp.true_probability,
        fill_probability=inp.fill_probability,
        slippage_bps=0.0,
        fee_bps=0.0,
        latency_bps=0.0,
        n_paths=n_paths,
        seed=inp.seed,
        liquidity=inp.liquidity,
    )

    grid = np.arange(0.0, 1.01, 0.05)

    curve_points = []
    for liability in liabilities:
        best_score = float("-inf")
        best_hf = 0.0
        best_m = None
        best_utilization = 0.0

        for hf in grid:
            sim = _build_sim(base, inp.strategy, inp.objective, float(liability), float(hf), n_paths)
            m = simulate_strategy(sim)
            score = _objective_score(m, inp.objective)
            if score > best_score:
                best_score = score
                best_hf = float(hf)
                best_m = m
                best_utilization = m.hedge_utilization

        curve_points.append({
            "liability":         round(float(liability), 4),
            "hedge_ratio":       round(best_hf, 2),
            "ev":                round(best_m.ev, 4),
            "cvar":              round(best_m.cvar_95, 4),
            "max_loss":          round(best_m.max_loss, 4),
            "liquidity_binding": best_utilization >= 0.99,
        })

    # curve_points already in ascending liability order (linspace)
    curve_points.sort(key=lambda p: p["liability"])

    # Liquidity cap info
    liq_cap = None
    if inp.liquidity:
        liq = inp.liquidity
        max_notional = max_hedge_notional(liq.available_liquidity, liq.participation_rate)
        liq_cap = {
            "available_liquidity": liq.available_liquidity,
            "participation_rate":  liq.participation_rate,
            "max_notional":        round(max_notional, 2),
            "cap_liability":       round(max_notional, 2),
        }

    # Distributions at mid-curve point
    mid_idx = len(curve_points) // 2
    mid_pt  = curve_points[mid_idx]
    mid_liability  = mid_pt["liability"]
    mid_hf         = mid_pt["hedge_ratio"]

    sim_uh = _build_sim(base, inp.strategy, inp.objective, mid_liability, 0.0,   n_paths)
    sim_h  = _build_sim(base, inp.strategy, inp.objective, mid_liability, mid_hf, n_paths)
    pnl_uh = simulate_strategy_raw(sim_uh)
    pnl_h  = simulate_strategy_raw(sim_h)

    collapsed = n_paths > _MAX_INLINE_PATHS
    if collapsed:
        distributions = {
            "liability":   mid_liability,
            "hedge_ratio": mid_hf,
            "unhedged":    _histogram(pnl_uh),
            "hedged":      _histogram(pnl_h),
            "collapsed":   True,
        }
    else:
        distributions = {
            "liability":      mid_liability,
            "hedge_ratio":    mid_hf,
            "unhedged_paths": pnl_uh.round(4).tolist(),
            "hedged_paths":   pnl_h.round(4).tolist(),
            "collapsed":      False,
        }

    collapse_flags = {
        "distributions_collapsed": collapsed,
        "collapse_reason":         f"n_paths ({n_paths}) > {_MAX_INLINE_PATHS}" if collapsed else None,
    }

    return {
        "scenario_metadata": {
            "seed":                   inp.seed,
            "requested_n_paths":      inp.n_paths,
            "n_paths":                n_paths,
            "timestamp_utc":          datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "simulator_version":      "v1.2",
            "source":                 "probedge_mc",
            "distribution_liability": round(mid_liability, 4),
        },
        "curve_points":         curve_points,
        "liquidity_cap":        liq_cap,
        "distribution_liability": round(mid_liability, 4),
        "distributions":        distributions,
        "collapse_flags":       collapse_flags,
    }


# ---------------------------------------------------------------------------
# API — distribution overlay for tail-risk chart
# ---------------------------------------------------------------------------

class _DistributionIn(BaseModel):
    strategy: str = "external_hedge"
    liability: float = 2000.0
    hedge_fraction: float = 0.5
    base_input: _BaseInputIn = _BaseInputIn()


@app.post("/api/risk-transfer/distribution")
def risk_transfer_distribution(inp: _DistributionIn):
    """
    Returns unhedged (hf=0) and hedged (hf=hedge_fraction) P&L distributions
    as histogram arrays suitable for a tail-risk overlay chart.
    """
    import numpy as np
    from core.metrics import cvar as _cvar

    if inp.strategy not in _VALID_STRATEGIES:
        raise HTTPException(400, f"Unknown strategy: {inp.strategy}")

    n_paths = min(inp.base_input.n_paths, 2000)

    def _run(hf: float) -> np.ndarray:
        sim = _build_sim(
            inp.base_input, inp.strategy, "min_cvar",
            inp.liability, hf, n_paths,
        )
        return simulate_strategy_raw(sim)

    pnl_unhedged = _run(0.0)
    pnl_hedged   = _run(inp.hedge_fraction)

    all_vals = np.concatenate([pnl_unhedged, pnl_hedged])
    lo, hi = float(all_vals.min()), float(all_vals.max())
    if abs(hi - lo) < 1e-9:
        hi = lo + 1.0
    bins = np.linspace(lo, hi, 31)
    mids = ((bins[:-1] + bins[1:]) / 2).round(4).tolist()
    bin_edges = bins.round(4).tolist()

    def _hist(pnl):
        counts, _ = np.histogram(pnl, bins=bins)
        return {
            "bin_mids":  mids,
            "bin_edges": bin_edges,
            "counts":    counts.tolist(),
            "ev":        round(float(pnl.mean()), 4),
            "cvar_95":   round(_cvar(pnl.tolist(), alpha=0.95), 4),
            "max_loss":  round(float(pnl.min()), 4),
        }

    return {
        "strategy":    inp.strategy,
        "liability":   inp.liability,
        "hedge_fraction": inp.hedge_fraction,
        "n_paths":     n_paths,
        "unhedged":    _hist(pnl_unhedged),
        "hedged":      _hist(pnl_hedged),
    }


# ---------------------------------------------------------------------------
# API — weekly reports
# ---------------------------------------------------------------------------

@app.get("/api/reports")
def list_weekly_reports():
    return {"reports": list_reports()}


@app.get("/api/reports/{filename}")
def get_report(filename: str):
    import pathlib
    safe = pathlib.Path("reports") / pathlib.Path(filename).name
    if not safe.suffix == ".md" or not safe.exists():
        raise HTTPException(status_code=404, detail="report not found")
    return {"filename": filename, "content": safe.read_text()}


@app.post("/api/reports/generate")
def generate_report_now():
    week = current_week_label()
    with get_db() as conn:
        runs  = list_runs(conn, limit=200)
        count = snapshot_count(conn)
    content = generate_weekly_report(runs, count, week)
    path = save_report(content, week)
    return {"week": week, "path": path, "bytes": len(content)}


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("catalog_app:app", host="0.0.0.0", port=port, reload=False)
