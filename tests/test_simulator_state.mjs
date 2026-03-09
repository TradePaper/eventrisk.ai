import test from "node:test";
import assert from "node:assert/strict";

import {
  SIMULATOR_DEFAULTS,
  logValueToLiquidity,
  liquidityToLogValue,
  parseSimulatorState,
  serializeSimulatorState,
} from "../static/scripts/simulator-state.mjs";

test("parseSimulatorState uses defaults unless schema version is v=1", () => {
  const params = new URLSearchParams("lb=9000000&liq=12000000&hf=0.4");
  assert.deepEqual(parseSimulatorState(params), SIMULATOR_DEFAULTS);
});

test("parseSimulatorState validates and clamps the simulator URL state", () => {
  const params = new URLSearchParams("v=1&lb=-50&liq=999999999&hf=2");
  const state = parseSimulatorState(params);

  assert.equal(state.liability, 1_000_000);
  assert.equal(state.liquidity, 100_000_000);
  assert.equal(state.hedgeFraction, 1);
});

test("serializeSimulatorState keeps the v=1 share-link format", () => {
  const query = serializeSimulatorState({
    liability: 125_000_000,
    liquidity: 18_500_000,
    hedgeFraction: 0.55,
  });

  assert.equal(query, "v=1&lb=125000000&liq=18500000&hf=0.55");
});

test("liquidity log-scale conversions round-trip near the original value", () => {
  const value = 20_000_000;
  const logValue = liquidityToLogValue(value);
  const roundTrip = logValueToLiquidity(logValue);

  assert.ok(Math.abs(roundTrip - value) < 500_000);
});
