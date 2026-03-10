/**
 * tests/test_simulator_state.mjs
 * Tests simulator state contracts: PAPER_DEFAULTS, URL-param keys,
 * reproducibility panel fields, n_paths cap, and preset schema integrity.
 * Run with: node tests/test_simulator_state.mjs
 */

import { readFileSync } from "fs";

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
  const res  = await fetch(`${BASE}${path}`);
  const ct   = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  return { status: res.status, body };
}

async function post(path, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

function suite(name, fn) {
  return async () => { console.log(`\n${name}`); await fn(); };
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

const suites = [

  suite("event-markets.html — PAPER_DEFAULTS values", async () => {
    const { body: html } = await get("/event-markets");
    assert(html.includes("PAPER_DEFAULTS"),             "PAPER_DEFAULTS defined");
    assert(html.includes("liability: 100000000"),        "liability default = 100M");
    assert(html.includes("liquidity: 20000000"),         "liquidity default = 20M");
    assert(html.includes("true_probability: 0.55"),      "true_probability default = 0.55");
    assert(html.includes("market_price: 0.52"),          "market_price default = 0.52");
    assert(html.includes("target_hedge_ratio: 0.60"),    "target_hedge_ratio default = 0.60");
    assert(html.includes("simulation_count: 10000"),     "simulation_count default = 10000");
  }),

  suite("event-markets.html — URL query-param serialization keys", async () => {
    const { body: html } = await get("/event-markets");
    assert(html.includes('q.get("liability")'),  'reads ?liability from URL');
    assert(html.includes('q.get("liquidity")'),  'reads ?liquidity from URL');
    assert(html.includes('q.get("p")'),          'reads ?p (true_probability) from URL');
    assert(html.includes('q.get("price")'),      'reads ?price (market_price) from URL');
    assert(html.includes('q.get("hedge")'),      'reads ?hedge (target_hedge_ratio) from URL');
    assert(html.includes('q.get("n")'),          'reads ?n (simulation_count) from URL');
  }),

  suite("event-markets.html — reproducibility panel elements", async () => {
    const { body: html } = await get("/event-markets");
    assert(html.includes("rReqPaths"),           "rReqPaths element present (Requested n_paths)");
    assert(html.includes("rNPaths"),             "rNPaths element present (Executed n_paths)");
    assert(html.includes("requested_n_paths"),   "requested_n_paths key referenced in JS");
    assert(html.includes("Requested n_paths"),   "Label 'Requested n_paths' visible in panel");
    assert(html.includes("Executed n_paths"),    "Label 'Executed n_paths' visible in panel");
  }),

  suite("event-markets.html — Paper Mode and superbowl_v1 preset", async () => {
    const { body: html } = await get("/event-markets");
    assert(html.includes("Paper"),               "Paper label present");
    assert(html.includes("Explore"),             "Explore button present");
    assert(html.includes("superbowl_v1"),        "superbowl_v1 seed/preset referenced");
    assert(html.includes("loadPreset"),          "loadPreset function referenced");
  }),

  suite("n_paths cap — requested_n_paths vs n_paths in API response", async () => {
    const LARGE = 20000;
    const { status, body } = await post("/api/risk-transfer/interactive", {
      liability_min: 1000, liability_max: 2000, n_points: 2,
      true_probability: 0.55, prediction_market_price: 0.52,
      fill_probability: 1.0, objective: "min_cvar",
      strategy: "external_hedge", seed: "cap_test", n_paths: LARGE,
    });
    assert(status === 200, "status 200");
    const sm = body.scenario_metadata;
    assert(sm.requested_n_paths === LARGE, `requested_n_paths echoes raw input (${LARGE})`);
    assert(sm.n_paths < LARGE,             `n_paths (${sm.n_paths}) is capped below ${LARGE}`);
    assert(sm.n_paths <= 500,              `n_paths (${sm.n_paths}) ≤ 500 (server cap)`);
  }),

  suite("n_paths cap — v2 endpoint also splits requested vs executed", async () => {
    const LARGE = 15000;
    const { status, body } = await post("/api/risk-transfer/interactive/v2", {
      strategy_modes: ["external_hedge"],
      objective:      "min_cvar",
      liabilities:    [1000],
      base_input: {
        stake: 100, american_odds: -110, true_win_prob: 0.54,
        fill_probability: 1.0, slippage_bps: 5, fee_bps: 1,
        latency_bps: 1, n_paths: LARGE, seed: "cap_v2_test",
        liquidity: {
          available_liquidity: 500_000, participation_rate: 0.3,
          impact_factor: 0.2, depth_exponent: 1.0,
        },
      },
    });
    assert(status === 200, "status 200");
    const sc = body.scenario;
    assert(sc.requested_n_paths === LARGE, `v2: requested_n_paths = ${LARGE}`);
    assert(sc.n_paths <= 500,              `v2: n_paths (${sc.n_paths}) ≤ 500`);
    assert(sc.n_paths !== sc.requested_n_paths, "v2: n_paths differs from requested when capped");
  }),

  suite("Preset JSON schema — superbowl, election, weather", async () => {
    const presets = ["superbowl", "election", "weather"];
    const REQUIRED_META  = ["event", "stake_usd", "true_probability", "market_price",
                            "liquidity_usd", "target_hedge_ratio", "simulation_count", "seed"];
    const REQUIRED_STEPS = ["title", "bins"];

    for (const id of presets) {
      const raw  = readFileSync(`lib/presets/${id}.json`, "utf8");
      const data = JSON.parse(raw);

      assert(data.id === id,                    `${id}: id field matches filename`);
      assert(typeof data.name === "string",     `${id}: name is string`);
      assert(typeof data.step1 === "object",    `${id}: step1 present`);
      assert(typeof data.step2 === "object",    `${id}: step2 present`);
      assert(typeof data.step3 === "object",    `${id}: step3 present`);

      for (const field of REQUIRED_META) {
        assert(field in data.meta, `${id}.meta.${field} present`);
      }
      for (const step of ["step1", "step2"]) {
        for (const field of REQUIRED_STEPS) {
          assert(field in data[step], `${id}.${step}.${field} present`);
        }
      }

      assert(Array.isArray(data.step3.points),      `${id}.step3.points is array`);
      assert(data.step3.points.length > 0,          `${id}.step3.points non-empty`);
      const pt = data.step3.points[0];
      assert("liability_m"        in pt,            `${id}.step3.points[0].liability_m present`);
      assert("hedge_utilization"  in pt,            `${id}.step3.points[0].hedge_utilization present`);
      assert("feasibility"        in pt,            `${id}.step3.points[0].feasibility present`);
    }
  }),

  suite("Superbowl preset meta matches PAPER_DEFAULTS", async () => {
    const preset = JSON.parse(readFileSync("lib/presets/superbowl.json", "utf8"));
    const { body: html } = await get("/event-markets");

    assert(
      html.includes(`true_probability: ${preset.meta.true_probability}`),
      `PAPER_DEFAULTS.true_probability matches preset (${preset.meta.true_probability})`
    );
    assert(
      html.includes(`market_price: ${preset.meta.market_price}`),
      `PAPER_DEFAULTS.market_price matches preset (${preset.meta.market_price})`
    );
    assert(
      html.includes(`target_hedge_ratio: ${preset.meta.target_hedge_ratio.toFixed(2)}`),
      `PAPER_DEFAULTS.target_hedge_ratio matches preset (${preset.meta.target_hedge_ratio})`
    );
  }),

  suite("v3 endpoint — liquidity_cap and collapse_flags state", async () => {
    const { status, body } = await post("/api/risk-transfer/interactive", {
      liability_min: 500, liability_max: 8000, n_points: 5,
      true_probability: 0.55, prediction_market_price: 0.52,
      fill_probability: 1.0, objective: "min_cvar",
      strategy: "external_hedge", seed: "state_test", n_paths: 200,
    });
    assert(status === 200,                            "status 200");
    assert("liquidity_cap" in body,                  "liquidity_cap present in response");
    assert("collapse_flags" in body,                 "collapse_flags present in response");
    assert("curve_points" in body,                   "curve_points present in response");
    assert(body.curve_points.length === 5,           "5 curve points returned");

    const pt = body.curve_points[0];
    assert("liability"        in pt,   "curve_point has liability");
    assert("hedge_ratio"      in pt,   "curve_point has hedge_ratio");
    assert("ev"               in pt,   "curve_point has ev");
    assert("cvar"             in pt,   "curve_point has cvar");
    assert("max_loss"         in pt,   "curve_point has max_loss");
    assert("liquidity_binding" in pt,  "curve_point has liquidity_binding");

    const cf = body.collapse_flags;
    assert(typeof cf === "object",                    "collapse_flags is object");
    assert("distributions_collapsed" in cf,           "collapse_flags has distributions_collapsed");
    assert("collapse_reason"         in cf,           "collapse_flags has collapse_reason");
  }),

];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

console.log("=== test_simulator_state.mjs ===");
for (const s of suites) await s();

console.log(`\n${"=".repeat(42)}`);
if (failed === 0) {
  console.log(`PASSED  ${passed}/${passed + failed} assertions`);
} else {
  console.log(`FAILED  ${failed} / ${passed + failed} assertions`);
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
}
