# ProbEdge Research — Multi-tool Prediction Market Suite

Four integrated tools for prediction market research, accessible via a shared navigation bar.

## Stack
- **Backend**: Python 3.11 + FastAPI + SQLite (`sqlite3`)
- **Frontend**: Vanilla HTML/CSS/JS served by FastAPI
- **Entry point**: `catalog_app.py`
- **Database**: `tmp/contracts.db` (SQLite, auto-created, WAL mode)
- **Simulation engine**: `simulator.py` (Monte Carlo, seeded RNG)
- **Provider layer**: `providers/` package (MockProvider, PolymarketProvider, KalshiProvider, CachedProvider)

## Workflow
```
uvicorn catalog_app:app --host 0.0.0.0 --port 5000
```

## Pages
| Route | File | Description |
|---|---|---|
| `/` | — | Redirects to `/event-markets` |
| `/event-markets` | `static/event-markets.html` | Contract card grid with risk/type filters and stats bar |
| `/hedging-simulator` | `static/index.html` | Monte Carlo hedge simulator with presets, validation, URL sharing |
| `/probability-gap` | `static/probability-gap.html` | Odds→prob gap analysis with live market feed (Mock/Polymarket/Kalshi) |
| `/contract-library` | `static/catalog.html` | Full contract catalog with search, detail view, add/delete |
| `/backtest` | `static/backtest.html` | Historical backtesting: equity curve, drawdown, strategy comparison, calibration |
| `/reports` | `static/reports.html` | Weekly markdown reports rendered in-browser |

## Shared Navigation
`static/nav.js` — injected into every page. Renders a sticky top nav, highlights the active route.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/contracts` | List contracts (optional `?q=` search) |
| GET | `/api/contracts/{id}` | Single contract details |
| POST | `/api/contracts` | Create contract |
| DELETE | `/api/contracts/{id}` | Delete contract |
| POST | `/simulate` | Run Monte Carlo hedge simulation |
| POST | `/simulate/v12` | v1.2 liquidity-aware simulation (strategy + objective) |
| POST | `/simulate/v12/curve` | v1.2 risk transfer curve over hedge_fraction grid |
| GET | `/api/risk-transfer` | Risk transfer curve over liability range |
| GET | `/api/markets` | List markets (`?source=mock\|polymarket\|kalshi&limit=N`) |
| GET | `/api/markets/{event_id}` | Single market by ID (`?source=...`) |
| GET | `/api/providers/health` | Circuit breaker state for all providers |
| POST | `/api/backtest/run` | Submit a backtest run (async, returns run_id) |
| GET | `/api/backtest/{run_id}` | Poll run status + fetch completed results |
| GET | `/api/backtest` | List recent runs (default 20) |
| POST | `/api/backtest/outcomes` | Register a resolved event outcome |
| GET | `/api/backtest/snapshots/count` | Total snapshots stored |
| POST | `/api/backtest/snapshot/poll` | Force immediate snapshot poll across all providers |
| GET | `/api/divergence/top` | Top divergences between two sources (`?source1=&source2=&limit=&min_gap=`) |
| GET | `/api/divergence/history` | Historical gap time-series from stored snapshots (`?source1=&source2=`) |
| POST | `/api/risk-transfer/interactive` | Sweep hedge_fraction 0→1, return all metric points (fast, n_paths≤500) |
| GET | `/api/reports` | List all weekly report files |
| GET | `/api/reports/{filename}` | Fetch a specific report's markdown content |
| POST | `/api/reports/generate` | Force-generate this week's report now |

## Provider Layer (`providers/`)
| File | Class | Description |
|------|-------|-------------|
| `base.py` | `MarketProvider` | Abstract interface: `get_markets()`, `get_prices()`, `get_timestamp()` |
| `base.py` | `MarketData`, `Outcome` | Normalized schema shared by all providers |
| `mock.py` | `MockProvider` | Five static sample markets; always available |
| `polymarket.py` | `PolymarketProvider` | Polymarket CLOB public API (no auth required); 2-retry + timeout |
| `kalshi.py` | `KalshiProvider` | Kalshi trading API; reads `KALSHI_API_KEY` env var if present |
| `cache.py` | `CachedProvider` | In-memory TTL wrapper (default 30s); serves stale data on provider error |

**Normalized schema fields:** `event_id`, `title`, `outcomes`, `price`, `implied_prob`, `source`, `updated_at`, `volume`, `end_date`

## Database Schema
```sql
contracts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name       TEXT NOT NULL,
    market_type      TEXT NOT NULL,   -- 'binary' | 'categorical'
    oracle_source    TEXT NOT NULL,
    settlement_rule  TEXT NOT NULL,
    manipulation_risk TEXT NOT NULL,  -- 'low' | 'medium' | 'high'
    notes            TEXT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

## Simulator Inputs (`simulator.py`)
`stake`, `americanOdds`, `trueWinProb`, `hedgeFraction`, `fillProbability`, `slippageBps`, `feeBps`, `latencyBps`, `nPaths`, `seed`

## Backtest Module (`backtest/`)
| File | Description |
|------|-------------|
| `db.py` | Table creation, snapshot insert, outcome resolver, run management |
| `engine.py` | Snapshot replay engine — one trade per event_id, deterministic fill |
| `metrics.py` | realized_pnl, max_drawdown, hit_rate, turnover, ev_error, brier_score, calibration_buckets |
| `scheduler.py` | Background daemon thread polling all providers every N seconds (default 300s, override via `SNAPSHOT_INTERVAL_SECONDS`) |

### Backtest DB Tables
- `snapshots` — normalized MarketData rows with `captured_at_utc`
- `outcomes` — resolved event outcomes (`YES`/`NO`)
- `backtest_run` — run metadata + `summary_json` with full metrics

## Divergence Engine (`core/divergence.py`)
- Cross-matches markets from two providers by Jaccard title similarity (stop-word filtered)
- Gap = `abs(prob1 - prob2)`; confidence = blended log-volume + gap-size score (0–1)
- History queries the `snapshots` table and pairs same-event, same-period rows
- Min similarity: 0.30; min gap: 0.005 (both configurable per request)

## Weekly Reports (`backtest/report.py`)
- Generated automatically by scheduler each ISO week (`reports/YYYY-WW.md`)
- Content: overview table, per-run P&L/hit-rate/Brier table, strategy summary, failures
- Idempotent: skips if file already exists for current week
- `POST /api/reports/generate` forces regeneration at any time

## Interactive Risk Transfer Curve
- `POST /api/risk-transfer/interactive` sweeps hedge_fraction 0→1 at step 0.05 (21 points)
- Returns EV, CVaR-95, Max Loss, P5, P95 per point
- UI on `/hedging-simulator` auto-shows curve after each successful simulation run
- Debounced re-fetch (800ms) as form sliders move

## Tests
```
tests/test_simulator.py     — 24 tests: EV, determinism, slippage, v1.2 engine
tests/test_providers.py     — 17 tests: schema, fallback, cache TTL, circuit breaker
tests/test_simulator_v12.py — 39 tests: strategies, CVaR, risk-transfer curve, interactive endpoint determinism, distribution endpoint, export row consistency, superbowl preset stability
tests/test_backtest.py      — 40 tests: DB schema, engine replay, metrics, run management
```
Total: **113/113 passing**. Run with: `python3 -m pytest tests/ -v`

### Article-launch features (added March 2026)
- `static/event-markets.html` — transformed into full article landing page:
  - Article banner with canonical URL hint (`?scenario=superbowl_v1`)
  - Interactive curve section: sliders for all book/liquidity/cost params, strategy checkboxes, objective selector, seed input
  - Super Bowl preset button (loads `superbowl_v1` deterministic params)
  - Reproduce scenario panel (seed, n_paths, fill probability, objective, timestamp after each run)
  - Primary Plotly chart: liability vs EV / CVaR-95 / Max Loss / Hedge Ratio, one line per strategy
  - Tail-risk overlay chart: unhedged vs hedged P&L histogram with CVaR annotations
  - Export PNG (Plotly `toImage`), Export CSV (all strategies × liabilities), Copy share URL (hash-encoded params)
  - `?scenario=superbowl_v1` and `#curve?...` query param auto-load and auto-run
  - Original contract card grid preserved below
- `POST /api/risk-transfer/distribution` — single-scenario unhedged + hedged histogram endpoint; 30-bin numpy histograms, EV/CVaR-95/MaxLoss per side
- `core/strategies.py` — added `simulate_strategy_raw()` exposing raw PnL arrays for distribution analysis
- `static/nav.js` — added ↳ Curve direct link to `#curve` anchor
- `README.md` — added Article Reproduction section with curl examples, sample response, chart interpretation, and limitations

## Deployment
VM target. Production command:
```
gunicorn --bind=0.0.0.0:5000 --reuse-port --worker-class=uvicorn.workers.UvicornWorker --workers=2 catalog_app:app
```

## Notes
- `tmp/contracts.db` is gitignored; auto-seeded with 4 contracts on first run
- Polymarket CLOB base URL overridable via `POLYMARKET_API_BASE` env var
- Kalshi API base overridable via `KALSHI_API_BASE`; auth via `KALSHI_API_KEY`
- Snapshot scheduler starts immediately on boot; first poll runs synchronously before yielding
- `SNAPSHOT_INTERVAL_SECONDS` env var controls poll frequency (default 300)
- Backtests with no snapshots in range return n_trades=0, not an error
