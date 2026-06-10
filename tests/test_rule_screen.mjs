/**
 * tests/test_rule_screen.mjs
 * Unit tests for the § 40.11 screen assessment logic (no DOM, no server).
 * Run with: node tests/test_rule_screen.mjs
 */

import { assessContract, depthFromSlider, PRESETS, SAFE_LIST_CATEGORIES } from "../static/scripts/rule-screen.mjs";

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.error(`  ✗ ${label}`);
    failures.push(label);
    failed += 1;
  }
}

function baseState(overrides = {}) {
  return {
    refCategory: "sports",
    involveTest: true,
    gamingPrimary: [true, true, true],
    gamingAlternative: [true, true],
    enumUnlawful: false,
    enumTAW: false,
    posCount: 5,
    negCount: 0,
    concernCount: 0,
    hedgerClass: "identified",
    liability: 100e6,
    depthNow: 5e6,
    depthMature: 60e6,
    hedgeFraction: 0.6,
    ...overrides,
  };
}

console.log("safe list");
for (const cat of SAFE_LIST_CATEGORIES) {
  const r = assessContract(baseState({ refCategory: cat }));
  assert(r.scope === "safe_list" && r.overall === "outside", `${cat} -> outside the Special Rule`);
}

console.log("enumerated activity");
{
  const r = assessContract(baseState());
  assert(r.involvesGamingPrimary && r.involvesGamingAlternative, "sports satisfy both gaming definitions");
  assert(r.triggered, "gaming triggers public interest review");
}
{
  const r = assessContract(baseState({ involveTest: false }));
  assert(r.overall === "outside", "no settlement link to the activity -> outside");
}
{
  const r = assessContract(
    baseState({ gamingPrimary: [false, true, false], gamingAlternative: [false, false] }),
  );
  assert(!r.triggered && r.overall === "outside", "non-game activity -> not triggered");
}
{
  const r = assessContract(
    baseState({ gamingPrimary: [true, true, true], gamingAlternative: [true, false] }),
  );
  assert(
    r.triggered && r.notes.some((n) => n.includes("boundary case")),
    "definitional divergence flagged as boundary case",
  );
}

console.log("verdict tiers");
{
  const r = assessContract(baseState());
  assert(r.overall === "lower", "moneyline-style profile -> lower risk");
  assert(
    r.hedgingMature.classification !== "no_effective",
    "deep foreseeable liquidity supports hedge capacity",
  );
}
{
  const r = assessContract(baseState({ negCount: 2, posCount: 2, hedgerClass: "none" }));
  assert(r.overall === "high", "microbet-style profile -> high risk");
}
{
  const r = assessContract(baseState({ posCount: 3, concernCount: 2 }));
  assert(r.overall === "elevated", "mixed profile -> elevated");
}

console.log("liquidity threshold behavior");
{
  const shallow = assessContract(baseState({ depthMature: 2e6 }));
  assert(
    shallow.hedgingMature.classification === "no_effective",
    "shallow mature depth -> no effective hedging",
  );
  assert(shallow.overall !== "lower", "no hedge capacity blocks lower-risk tier");
}
{
  const r = assessContract(baseState());
  assert(
    r.hedgingNow.classification === "no_effective" &&
      r.notes.some((n) => n.includes("market-formation")),
    "listing-day shallowness flagged as expected sequencing, not incapacity",
  );
}

console.log("depth slider mapping");
assert(Math.abs(depthFromSlider(0) - 0.5e6) < 1, "slider 0 -> $0.5M");
assert(Math.abs(depthFromSlider(100) - 250e6) < 1000, "slider 100 -> $250M");
assert(depthFromSlider(50) > depthFromSlider(49), "monotonic");

console.log("presets");
assert(PRESETS.moneyline && PRESETS.microbet && PRESETS.cpi, "three presets defined");
{
  const p = PRESETS.microbet;
  const r = assessContract({
    refCategory: p.refCategory,
    involveTest: p.involveTest,
    gamingPrimary: p.gamingPrimary,
    gamingAlternative: p.gamingAlternative,
    enumUnlawful: p.enumUnlawful,
    enumTAW: p.enumTAW,
    posCount: p.pos.filter(Boolean).length,
    negCount: p.neg.filter(Boolean).length,
    concernCount: p.concerns.filter(Boolean).length,
    hedgerClass: p.hedgerClass,
    liability: p.liabilityM * 1e6,
    depthNow: depthFromSlider(p.depthNowSlider),
    depthMature: depthFromSlider(p.depthMatureSlider),
    hedgeFraction: p.hedgeFracPct / 100,
  });
  assert(r.overall === "high", "microbet preset evaluates high-risk");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("FAILURES:", failures);
  process.exit(1);
}
