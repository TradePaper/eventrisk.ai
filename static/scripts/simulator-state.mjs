// @ts-check

export const SCHEMA_VERSION = "1";

export const SIMULATOR_DEFAULTS = Object.freeze({
  liability: 100_000_000,
  liquidity: 20_000_000,
  hedgeFraction: 0.6,
});

export const SIMULATOR_LIMITS = Object.freeze({
  liability: { min: 1_000_000, max: 250_000_000 },
  liquidity: { min: 1_000_000, max: 100_000_000 },
  hedgeFraction: { min: 0, max: 1 },
});

/**
 * @typedef {{
 *   liability: number;
 *   liquidity: number;
 *   hedgeFraction: number;
 * }} SimulatorState
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {number} value
 */
function roundLiability(value) {
  return Math.round(value);
}

/**
 * @param {number} value
 */
function roundLiquidity(value) {
  return Math.round(value);
}

/**
 * @param {number} value
 */
function roundHedgeFraction(value) {
  return Number(value.toFixed(2));
}

/**
 * @param {URLSearchParams | URL} input
 * @returns {SimulatorState}
 */
export function parseSimulatorState(input) {
  const params = input instanceof URL ? input.searchParams : input;
  if (params.get("v") !== SCHEMA_VERSION) {
    return { ...SIMULATOR_DEFAULTS };
  }

  const liability = toFiniteNumber(params.get("lb"));
  const liquidity = toFiniteNumber(params.get("liq"));
  const hedgeFraction = toFiniteNumber(params.get("hf"));

  return {
    liability:
      liability === null
        ? SIMULATOR_DEFAULTS.liability
        : roundLiability(clamp(liability, SIMULATOR_LIMITS.liability.min, SIMULATOR_LIMITS.liability.max)),
    liquidity:
      liquidity === null
        ? SIMULATOR_DEFAULTS.liquidity
        : roundLiquidity(clamp(liquidity, SIMULATOR_LIMITS.liquidity.min, SIMULATOR_LIMITS.liquidity.max)),
    hedgeFraction:
      hedgeFraction === null
        ? SIMULATOR_DEFAULTS.hedgeFraction
        : roundHedgeFraction(clamp(hedgeFraction, SIMULATOR_LIMITS.hedgeFraction.min, SIMULATOR_LIMITS.hedgeFraction.max)),
  };
}

/**
 * @param {SimulatorState} state
 * @returns {string}
 */
export function serializeSimulatorState(state) {
  const params = new URLSearchParams();
  params.set("v", SCHEMA_VERSION);
  params.set(
    "lb",
    String(roundLiability(clamp(state.liability, SIMULATOR_LIMITS.liability.min, SIMULATOR_LIMITS.liability.max))),
  );
  params.set(
    "liq",
    String(roundLiquidity(clamp(state.liquidity, SIMULATOR_LIMITS.liquidity.min, SIMULATOR_LIMITS.liquidity.max))),
  );
  params.set(
    "hf",
    String(roundHedgeFraction(clamp(state.hedgeFraction, SIMULATOR_LIMITS.hedgeFraction.min, SIMULATOR_LIMITS.hedgeFraction.max))),
  );
  return params.toString();
}

/**
 * @param {number} liquidity
 * @returns {number}
 */
export function liquidityToLogValue(liquidity) {
  const clamped = clamp(liquidity, SIMULATOR_LIMITS.liquidity.min, SIMULATOR_LIMITS.liquidity.max);
  return Number(Math.log10(clamped).toFixed(4));
}

/**
 * @param {number} logValue
 * @returns {number}
 */
export function logValueToLiquidity(logValue) {
  const clamped = clamp(logValue, 6, 8);
  return roundLiquidity(10 ** clamped);
}
