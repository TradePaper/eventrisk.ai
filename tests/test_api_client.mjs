/**
 * tests/test_api_client.mjs
 * Live HTTP integration tests for the ProbEdge API.
 * Run with: node tests/test_api_client.mjs
 */

const BASE = "http://127.0.0.1:5000";

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
    failures.push(label);
  }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const ct  = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, body };
}

async function post(path, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Suite helpers
// ---------------------------------------------------------------------------

function suite(name, fn) {
  return async () => {
    console.log(`\n${name}`);
    await fn();
  };
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

const suites = [

  suite("GET /status", async () => {
    const { status, body } = await get("/status");
    assert(status === 200,    "status 200");
    assert(body.ok === true,  "body.ok is true");
  }),

  suite("GET /api/config", async () => {
    const { status, body } = await get("/api/config");
    assert(status === 200,                        "status 200");
    assert(typeof body === "object",              "body is object");
    assert("providers" in body || Object.keys(body).length > 0, "body is non-empty");
  }),

  suite("Cache-Control headers on page routes", async () => {
    const pages = ["/event-markets", "/explainer", "/paper", "/simulator"];
    for (const page of pages) {
      const { status, headers } = await get(page);
      const cc = headers.get("cache-control") ?? "";
      assert(status === 200,           `${page} → 200`);
      assert(cc.includes("no-store"),  `${page} → Cache-Control: no-store`);
    }
  }),

  suite("GET /lib/presets — superbowl, election, weather", async () => {
    const presets = ["superbowl", "election", "weather"];
    for (const id of presets) {
      const { status, body } = await get(`/lib/presets/${id}.json`);
      assert(status === 200,                      `${id}.json → 200`);
      assert(body.id === id,                      `${id}.json → id field matches`);
      assert(typeof body.meta === "object",       `${id}.json → meta object present`);
      assert("stake_usd" in body.meta,            `${id}.json → meta.stake_usd present`);
      assert(typeof body.step1 === "object",      `${id}.json → step1 present`);
      assert(typeof body.step2 === "object",      `${id}.json → step2 present`);
      assert(typeof body.step3 === "object",      `${id}.json → step3 present`);
      assert(Array.isArray(body.step3.points),    `${id}.json → step3.points array`);
    }
  }),

  suite("POST /api/tier2/frontier", async () => {
    const { status, body } = await post("/api/tier2/frontier", {
      liability:          100_000_000,
      liquidity:          20_000_000,
      true_probability:   0.55,
      market_price:       0.52,
      target_hedge_ratio: 0.60,
      simulation_count:   500,
    });
    assert(status === 200,                              "status 200");
    assert(body.title === "Figure 5 — Hedging Efficiency Frontier", "title correct");
    assert(typeof body.frontiers === "object",          "frontiers object present");
    assert(Array.isArray(body.frontiers.shallow),       "frontiers.shallow is array");
    assert(Array.isArray(body.frontiers.deep),          "frontiers.deep is array");
    assert(body.frontiers.shallow.length === 21,        "shallow has 21 points (0..1 step 0.05)");
    const row = body.frontiers.shallow[0];
    assert("requested_hedge_fraction" in row,           "row has requested hedge fraction");
    assert("effective_hedge_fraction" in row,           "row has effective hedge fraction");
    assert("ev_sacrificed" in row,                      "row has ev_sacrificed");
    assert("tail_reduction" in row,                     "row has tail_reduction");
  }),

  suite("POST /api/tier2/feasibility", async () => {
    const { status, body } = await post("/api/tier2/feasibility", {
      liability:          100_000_000,
      liquidity:          20_000_000,
      true_probability:   0.55,
      market_price:       0.52,
      target_hedge_ratio: 0.60,
      simulation_count:   500,
    });
    assert(status === 200,                                                   "status 200");
    assert(body.title === "Figure 1 — Sportsbook Hedging Feasibility Map",   "title correct");
    assert(Array.isArray(body.liabilities),                      "liabilities array present");
    assert(Array.isArray(body.liquidities),                      "liquidities array present");
    assert(Array.isArray(body.region_grid),                      "region_grid array present");
    assert(body.liabilities.length === 20,                       "liabilities has 20 entries");
    assert(body.liquidities.length === 20,                       "liquidities has 20 entries");
    assert(body.labels.no_effective === "No Effective Hedging",  "label no_effective correct");
    assert(body.labels.partial      === "Partial Hedging",       "label partial correct");
    assert(body.labels.meaningful   === "Meaningful Hedging",    "label meaningful correct");
  }),

  suite("POST /api/risk-transfer/interactive/v2 — structure", async () => {
    const { status, body } = await post("/api/risk-transfer/interactive/v2", {
      strategy_modes: ["external_hedge"],
      objective:      "min_cvar",
      liabilities:    [1000, 2000],
      base_input: {
        stake: 100, american_odds: -110, true_win_prob: 0.54,
        fill_probability: 0.85, slippage_bps: 8, fee_bps: 2,
        latency_bps: 3, n_paths: 100, seed: "api_client_test",
        liquidity: {
          available_liquidity: 500_000, participation_rate: 0.2,
          impact_factor: 0.5, depth_exponent: 1.0,
        },
      },
    });
    assert(status === 200,                      "status 200");
    assert(Array.isArray(body.series),          "body.series is array");
    assert(body.series.length === 1,            "one strategy series");
    assert(body.series[0].points.length === 2,  "two liability points");
    assert("scenario" in body,                  "body.scenario present");
    assert("n_paths" in body.scenario,          "scenario.n_paths present");
    assert("requested_n_paths" in body.scenario,"scenario.requested_n_paths present");
  }),

  suite("POST /api/risk-transfer/interactive/v2 — determinism", async () => {
    const payload = {
      strategy_modes: ["external_hedge"],
      objective:      "min_cvar",
      liabilities:    [1000],
      base_input: {
        stake: 100, american_odds: -110, true_win_prob: 0.54,
        fill_probability: 1.0, slippage_bps: 5, fee_bps: 1,
        latency_bps: 1, n_paths: 100, seed: "det_test",
        liquidity: {
          available_liquidity: 500_000, participation_rate: 0.3,
          impact_factor: 0.2, depth_exponent: 1.0,
        },
      },
    };
    const r1 = await post("/api/risk-transfer/interactive/v2", payload);
    const r2 = await post("/api/risk-transfer/interactive/v2", payload);
    const ev1 = r1.body.series[0].points[0].ev;
    const ev2 = r2.body.series[0].points[0].ev;
    assert(ev1 === ev2, `same seed → same EV (${ev1.toFixed(4)})`);
    const cvar1 = r1.body.series[0].points[0].cvar_95;
    const cvar2 = r2.body.series[0].points[0].cvar_95;
    assert(cvar1 === cvar2, `same seed → same CVaR-95`);
  }),

  suite("POST /api/risk-transfer/interactive (v3 flat-field)", async () => {
    const { status, body } = await post("/api/risk-transfer/interactive", {
      liability_min: 500, liability_max: 4000, n_points: 4,
      true_probability: 0.54, prediction_market_price: 0.48,
      fill_probability: 0.85, objective: "max_ev",
      strategy: "external_hedge", seed: "v3_api_test", n_paths: 100,
    });
    assert(status === 200,                      "status 200");
    assert("scenario_metadata" in body,         "scenario_metadata present");
    assert("curve_points" in body,              "curve_points present");
    assert("liquidity_regimes" in body,         "liquidity_regimes present");
    assert("liquidity_cap" in body,             "liquidity_cap present");
    assert("distributions" in body,             "distributions present");
    assert("collapse_flags" in body,            "collapse_flags present");
    assert(body.curve_points.length === 4,      "4 curve points");
    assert(body.liquidity_regimes.length === 3, "3 liquidity regimes");
    const sm = body.scenario_metadata;
    assert(sm.simulator_version === "v1.2",     "simulator_version is v1.2");
    assert(sm.source === "probedge_mc",         "source is probedge_mc");
  }),

];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

console.log("=== test_api_client.mjs ===");
for (const s of suites) await s();

console.log(`\n${"=".repeat(42)}`);
if (failed === 0) {
  console.log(`PASSED  ${passed}/${passed + failed} assertions`);
} else {
  console.log(`FAILED  ${failed} / ${passed + failed} assertions`);
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
}
