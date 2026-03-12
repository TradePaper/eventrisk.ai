// @ts-check

const STEP_BINS = [-140, -130, -120, -110, -100, -90, -80, -70, -60, -50, -40, -30, -20, -10, 0];
const UNHEDGED_DENSITY = [0.02, 0.05, 0.08, 0.12, 0.14, 0.14, 0.13, 0.1, 0.08, 0.06, 0.04, 0.02, 0.01, 0.01, 0];
const EXTERNAL_HEDGED_DENSITY = [0, 0.01, 0.03, 0.06, 0.1, 0.14, 0.16, 0.15, 0.12, 0.09, 0.06, 0.04, 0.02, 0.01, 0.01];
const HYBRID_HEDGED_DENSITY = [0, 0.01, 0.04, 0.07, 0.11, 0.14, 0.15, 0.14, 0.11, 0.09, 0.06, 0.04, 0.02, 0.01, 0.01];
const INTERNAL_HEDGED_DENSITY = [0.01, 0.03, 0.05, 0.09, 0.12, 0.14, 0.15, 0.13, 0.1, 0.08, 0.05, 0.03, 0.01, 0.01, 0];

const BASE_META = {
  event: "Super Bowl LIX Winner",
  stake_usd: 136_000_000,
  true_probability: 0.55,
  market_price: 0.55,
  liquidity_usd: 20_000_000,
  target_hedge_ratio: 0.6,
  simulation_count: 10_000,
  seed: "superbowl_v1",
};

function makeScenario(name, step2) {
  return {
    id: name.toLowerCase().replace(/\s+/g, "_"),
    name,
    meta: BASE_META,
    step1: {
      title: "Figure 1 — Unhedged Liability Distribution",
      bins: STEP_BINS,
      unhedged_density: UNHEDGED_DENSITY,
      ev_m: -66.3,
      cvar95_m: -120.0,
      max_loss_m: -128.0,
    },
    step2: {
      title: "Figure 2 — Hedged vs Unhedged Distribution Overlay",
      bins: STEP_BINS,
      unhedged_density: UNHEDGED_DENSITY,
      ...step2,
    },
    step3: {
      title: "Figure 3 — Deterministic Hedge Capacity Curve",
      liabilities_m: [20, 40, 60, 80, 100, 120, 140],
    },
  };
}

export const EXPLAINER_STATIC_DATA = {
  external_hedge: makeScenario("External Hedge", {
    hedged_density: EXTERNAL_HEDGED_DENSITY,
    ev_unhedged_m: -66.3,
    ev_hedged_m: -66.5,
    cvar95_unhedged_m: -120.0,
    cvar95_hedged_m: -101.0,
    max_loss_unhedged_m: -128.0,
    max_loss_hedged_m: -101.0,
    tail_reduction_pct: 15.8,
  }),
  hybrid: makeScenario("Hybrid", {
    hedged_density: HYBRID_HEDGED_DENSITY,
    ev_unhedged_m: -66.3,
    ev_hedged_m: -66.9,
    cvar95_unhedged_m: -120.0,
    cvar95_hedged_m: -105.0,
    max_loss_unhedged_m: -128.0,
    max_loss_hedged_m: -108.0,
    tail_reduction_pct: 12.5,
  }),
  internal_reprice: makeScenario("Internal Reprice", {
    hedged_density: INTERNAL_HEDGED_DENSITY,
    ev_unhedged_m: -66.3,
    ev_hedged_m: -67.7,
    cvar95_unhedged_m: -120.0,
    cvar95_hedged_m: -110.0,
    max_loss_unhedged_m: -128.0,
    max_loss_hedged_m: -118.0,
    tail_reduction_pct: 8.3,
  }),
};

export const CANONICAL_EXPLAINER_SCENARIO = EXPLAINER_STATIC_DATA.external_hedge;
