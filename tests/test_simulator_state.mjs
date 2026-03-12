/**
 * tests/test_simulator_state.mjs
 * Tests simulator state contracts: preset UI, URL-param handling,
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

  suite("event-markets.html — superbowl_v1 preset UI", async () => {
    const { body: html } = await get("/event-markets");
    assert(html.includes("superbowl_v1"),                   "superbowl_v1 preset key present");
    assert(html.includes("?scenario=superbowl_v1"),         "?scenario= URL pattern present");
    assert(html.includes("loadPreset"),                     "loadPreset function present");
    assert(html.includes("PRESETS"),                        "PRESETS object defined");
    assert(html.includes("Load Super Bowl Preset"),         "Super Bowl preset button label present");
  }),

  suite("event-markets.html — scenario URL param handling", async () => {
    const { body: html } = await get("/event-markets");
    assert(html.includes("URLSearchParams"),                "URLSearchParams used");
    assert(html.includes("qs.get('scenario')"),             "reads ?scenario from URL");
    assert(html.includes("location.search"),                "reads location.search");
  }),

  suite("event-markets.html — reproducibility panel elements", async () => {
    const { body: html } = await get("/event-markets");
    assert(html.includes("rReqPaths"),           "rReqPaths element present (Requested n_paths)");
    assert(html.includes("rNPaths"),             "rNPaths element present (Executed n_paths)");
    assert(html.includes("requested_n_paths"),   "requested_n_paths key referenced in JS");
    assert(html.includes("Requested n_paths"),   "Label 'Requested n_paths' visible in panel");
    assert(html.includes("Executed n_paths"),    "Label 'Executed n_paths' visible in panel");
  }),

  suite("event-markets.html — superbowl_v1 preset interaction", async () => {
    const { body: html } = await get("/event-markets");
    assert(html.includes("superbowl_v1"),                        "superbowl_v1 seed/preset referenced");
    assert(html.includes("loadPreset"),                          "loadPreset function referenced");
    assert(html.includes("Super Bowl"),                          "Super Bowl label present");
    assert(html.includes("scenario_metadata"),                   "scenario_metadata key referenced in JS");
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

  suite("Superbowl preset JSON is served and matches seed in page", async () => {
    const preset = JSON.parse(readFileSync("lib/presets/superbowl.json", "utf8"));
    const { body: html } = await get("/event-markets");
    const { status, body: json } = await get("/lib/presets/superbowl.json");

    assert(status === 200,                            "superbowl.json served at /lib/presets/");
    assert(json.meta.seed === "superbowl_v1",         `preset seed = superbowl_v1`);
    assert(html.includes(preset.meta.seed),           `page references seed '${preset.meta.seed}'`);
    assert(preset.meta.true_probability === 0.55,     "preset true_probability = 0.55");
    assert(preset.meta.market_price === 0.52,         "preset market_price = 0.52");
    assert(preset.meta.target_hedge_ratio === 0.60,   "preset target_hedge_ratio = 0.60");
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
    assert("requested_hedge_fraction" in pt, "curve_point has requested hedge fraction");
    assert("effective_hedge_fraction" in pt, "curve_point has effective hedge fraction");
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
