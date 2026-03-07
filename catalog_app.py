import sqlite3
import os
import dataclasses
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from simulator import SimInput, run_simulation
from providers import MockProvider, PolymarketProvider, KalshiProvider, CachedProvider
from core.types_v12 import SimulationInputV12, LiquidityModel, InternalRepriceModel
from core.strategies import simulate_strategy, simulate_strategy_paths
from core.optimizer import optimize_hedge_ratio, build_risk_transfer_curve
from core.analytics import capture as analytics_capture


os.makedirs("tmp", exist_ok=True)
DB_PATH = "tmp/contracts.db"
SIMULATOR_VERSION = "v1.2.0"


def _scenario_meta(inp: SimulationInputV12, source: str = "interactive") -> dict:
    return {
        "seed": inp.seed,
        "n_paths": inp.n_paths,
        "fill_probability": inp.fill_probability,
        "liquidity": dataclasses.asdict(inp.liquidity) if inp.liquidity else None,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "simulator_version": SIMULATOR_VERSION,
        "source": source,
    }


def _collapsed(ev: float, cvar_95: float, max_loss: float) -> bool:
    return abs(ev - cvar_95) < 1e-4 and abs(cvar_95 - max_loss) < 1e-4


def _build_collapsed_bins(value: float, count: int) -> dict:
    return {"bins": [value], "weights": [count]}


def _make_sim_input(params: "SimulateV12In") -> SimulationInputV12:
    liq = LiquidityModel(**params.liquidity.dict()) if params.liquidity else None
    reprice = InternalRepriceModel(**params.internal_reprice.dict()) if params.internal_reprice else None
    return SimulationInputV12(
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


def _enforce_monotonic_if_needed(points: list[dict], objective: str) -> list[dict]:
    if objective != "min_cvar":
        return points
    running = 0.0
    out = []
    for p in points:
        p2 = dict(p)
        running = max(running, float(p2["hedge_ratio"]))
        p2["hedge_ratio"] = running
        out.append(p2)
    return out


def _liquidity_cap_ratio(inp: SimulationInputV12, liability: float) -> Optional[float]:
    if not inp.liquidity or liability <= 0:
        return None
    max_hedge = max(0.0, inp.liquidity.available_liquidity * inp.liquidity.participation_rate)
    return min(1.0, max_hedge / liability)


app = FastAPI(title="ProbEdge Research")
app.mount("/static", StaticFiles(directory="static"), name="static")


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
    return RedirectResponse(url="/event-markets")


@app.get("/event-markets", response_class=HTMLResponse)
def event_markets():
    with open("static/event-markets.html") as f:
        return f.read()


@app.get("/hedging-simulator", response_class=HTMLResponse)
def hedging_simulator():
    with open("static/index.html") as f:
        return f.read()


@app.get("/probability-gap", response_class=HTMLResponse)
def probability_gap():
    with open("static/probability-gap.html") as f:
        return f.read()


@app.get("/contract-library", response_class=HTMLResponse)
def contract_library():
    with open("static/catalog.html") as f:
        return f.read()


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


class InteractiveRiskTransferIn(BaseModel):
    liability_range: list[float]
    true_probability: float
    prediction_market_price: float
    liquidity: float
    fill_probability: float
    n_paths: int
    seed: str
    stake: float = 120_000_000.0
    cvar_alpha: float = 0.90
    objective: str = "min_cvar"
    strategy: str = "external_hedge"
    strategy_modes: Optional[list[str]] = None


@app.post("/simulate/v12")
def simulate_v12(params: SimulateV12In):
    inp = _make_sim_input(params)
    metrics = optimize_hedge_ratio(inp) if params.optimize else simulate_strategy(inp)

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
    inp = _make_sim_input(params.base)
    sorted_liabilities = sorted(float(x) for x in params.liabilities)
    curve = build_risk_transfer_curve(inp, sorted_liabilities, params.strategy)
    assert len(curve.points) == len(sorted_liabilities)
    return {
        "strategy": curve.strategy,
        "liabilities_requested": len(sorted_liabilities),
        "points": [dataclasses.asdict(pt) for pt in curve.points],
    }


@app.post("/api/risk-transfer/interactive")
def risk_transfer_interactive(params: InteractiveRiskTransferIn):
    strategies = params.strategy_modes or [params.strategy]
    strategies = [s for s in strategies if s in ("external_hedge", "internal_reprice", "hybrid")]
    if not strategies:
        raise HTTPException(status_code=422, detail="No valid strategy modes provided")

    liabilities = sorted(float(x) for x in params.liability_range if float(x) > 0)
    if not liabilities:
        raise HTTPException(status_code=422, detail="liability_range must include positive values")

    # Convert market price to equivalent american odds for compatibility with existing engine.
    p = min(max(params.prediction_market_price, 0.001), 0.999)
    american_odds = int(-100 * p / (1 - p)) if p >= 0.5 else int(100 * (1 - p) / p)

    base = SimulationInputV12(
        stake=params.stake,
        american_odds=american_odds,
        true_win_prob=params.true_probability,
        hedge_fraction=0.0,
        fill_probability=params.fill_probability,
        slippage_bps=20.0,
        fee_bps=10.0,
        latency_bps=5.0,
        n_paths=params.n_paths,
        seed=params.seed,
        liability=0.0,
        strategy=params.strategy,
        objective=params.objective,
        liquidity=LiquidityModel(
            available_liquidity=params.liquidity,
            participation_rate=1.0,
            impact_factor=0.0,
            depth_exponent=1.0,
        ),
        cvar_alpha=params.cvar_alpha,
        internal_reprice=InternalRepriceModel(
            enabled=True,
            odds_move_sensitivity=0.000002,
            handle_retention_decay=0.25,
            min_prob=0.01,
            max_prob=0.99,
        ),
    )

    selected_points = []
    curve_series = []
    for strategy in strategies:
        curve = build_risk_transfer_curve(base, liabilities, strategy)
        rows = []
        for pt in curve.points:
            cap = _liquidity_cap_ratio(base, pt.liability)
            ratio = float(pt.optimal_hedge_ratio)
            effective_ratio = min(ratio, cap) if cap is not None else ratio
            rows.append({
                "liability": float(pt.liability),
                "hedge_ratio": float(effective_ratio),
                "requested_hedge_ratio": float(ratio),
                "ev": float(pt.ev),
                "cvar": float(pt.cvar_95),
                "max_loss": float(pt.max_loss),
                "liquidity_binding": bool(cap is not None and ratio >= cap - 1e-9),
            })
        rows = _enforce_monotonic_if_needed(rows, base.objective)
        if strategy == params.strategy:
            selected_points = rows
        curve_series.append({"strategy": strategy, "points": rows})

    if not selected_points:
        selected_points = curve_series[0]["points"]

    ref_liability = liabilities[-1]
    optimal_at_ref = selected_points[-1]["hedge_ratio"]
    selected_strategy = params.strategy if params.strategy in strategies else strategies[0]

    unhedged_inp = dataclasses.replace(base, strategy=selected_strategy, liability=ref_liability, hedge_fraction=0.0)
    hedged_inp = dataclasses.replace(base, strategy=selected_strategy, liability=ref_liability, hedge_fraction=optimal_at_ref)

    unhedged_paths = simulate_strategy_paths(unhedged_inp)
    hedged_paths = simulate_strategy_paths(hedged_inp)

    unhedged_collapsed = float(unhedged_paths.min()) == float(unhedged_paths.max())
    hedged_collapsed = float(hedged_paths.min()) == float(hedged_paths.max())

    scenario = _scenario_meta(base, source="superbowl_preset" if params.seed == "superbowl-v1" else "interactive")

    analytics_capture("risk_transfer_curve_requested", {
        "strategy": selected_strategy,
        "objective": base.objective,
        "n_liabilities": len(liabilities),
        "n_paths": base.n_paths,
    })

    return {
        "scenario_metadata": scenario,
        "curve_points": selected_points,
        "curve_series": curve_series,
        "liquidity_cap": {
            "inputs": {
                "available_liquidity": params.liquidity,
                "participation_rate": 1.0,
            },
            "max_hedge_ratio_by_liability": [
                {
                    "liability": liab,
                    "max_hedge_ratio": _liquidity_cap_ratio(base, liab),
                }
                for liab in liabilities
            ],
        },
        "distributions": {
            "reference_liability": ref_liability,
            "unhedged_paths": unhedged_paths.tolist(),
            "hedged_paths": hedged_paths.tolist(),
        },
        "collapse_flags": {
            "unhedged_collapsed": unhedged_collapsed,
            "hedged_collapsed": hedged_collapsed,
            "unhedged_bins": _build_collapsed_bins(float(unhedged_paths[0]), len(unhedged_paths)) if unhedged_collapsed else None,
            "hedged_bins": _build_collapsed_bins(float(hedged_paths[0]), len(hedged_paths)) if hedged_collapsed else None,
        },
    }


@app.get("/api/risk-transfer")
def get_risk_transfer(
    strategy: str = Query("external_hedge", pattern="^(external_hedge|internal_reprice|hybrid)$"),
    objective: str = Query("min_cvar", pattern="^(min_cvar|min_max_loss|max_sharpe|target_ev_min_risk|max_ev)$"),
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


# ---------------------------------------------------------------------------
# Market providers
# ---------------------------------------------------------------------------

_PROVIDERS = {
    "mock": CachedProvider(MockProvider(), ttl=30),
    "polymarket": CachedProvider(PolymarketProvider(), ttl=30),
    "kalshi": CachedProvider(KalshiProvider(), ttl=30),
}


@app.get("/api/markets")
def list_markets(
    source: str = Query("mock", pattern="^(mock|polymarket|kalshi)$"),
    limit: int = Query(20, ge=1, le=100),
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
    health = {
        name: dataclasses.asdict(provider.health)
        for name, provider in _PROVIDERS.items()
    }
    overall = "ok"
    for h in health.values():
        if h["status"] == "down":
            overall = "down"
            break
        if h["status"] == "degraded":
            overall = "degraded"
    return {
        "status": overall,
        "providers": health,
        "analytics": bool(os.environ.get("POSTHOG_KEY")),
        "version": SIMULATOR_VERSION,
    }


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

init_db()

if __name__ == "__main__":
    uvicorn.run("catalog_app:app", host="0.0.0.0", port=5000, reload=False)
