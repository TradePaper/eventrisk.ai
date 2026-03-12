// @ts-check

export const FEASIBILITY_THRESHOLDS = {
  noEffectiveMax: 0.10,
  partialMax: 0.40,
};

export const LIQUIDITY_REGIME_FACTORS = {
  low: 0.5,
  medium: 1,
  high: 3,
};

/**
 * @param {number} liability
 * @param {number} requestedHedgeFraction
 * @param {number} availableLiquidity
 * @param {number} [participationRate]
 */
export function buildCapacityPoint(liability, requestedHedgeFraction, availableLiquidity, participationRate = 1) {
  const requestedFraction = clamp01(requestedHedgeFraction);
  const maxNotional = Math.max(0, availableLiquidity) * Math.max(0, participationRate);
  const requestedNotional = liability * requestedFraction;
  const effectiveNotional = Math.min(requestedNotional, maxNotional);
  const effectiveFraction = liability > 0 ? effectiveNotional / liability : 0;
  return {
    liability,
    requested_hedge_fraction: requestedFraction,
    effective_hedge_fraction: effectiveFraction,
    requested_hedge_notional: requestedNotional,
    effective_hedge_notional: effectiveNotional,
    liquidity_binding: effectiveFraction + 1e-9 < requestedFraction,
  };
}

/**
 * @param {number[]} liabilities
 * @param {number} requestedHedgeFraction
 * @param {number} mediumLiquidity
 */
export function buildRegimeCurves(liabilities, requestedHedgeFraction, mediumLiquidity) {
  return [
    { id: "low", label: "Low Liquidity", availableLiquidity: mediumLiquidity * LIQUIDITY_REGIME_FACTORS.low },
    { id: "medium", label: "Medium Liquidity", availableLiquidity: mediumLiquidity * LIQUIDITY_REGIME_FACTORS.medium },
    { id: "high", label: "High Liquidity", availableLiquidity: mediumLiquidity * LIQUIDITY_REGIME_FACTORS.high },
  ].map((regime) => ({
    ...regime,
    curve_points: liabilities.map((liability) =>
      buildCapacityPoint(liability, requestedHedgeFraction, regime.availableLiquidity),
    ),
  }));
}

/**
 * @param {number} effectiveFraction
 */
export function classifyFeasibility(effectiveFraction) {
  if (effectiveFraction < FEASIBILITY_THRESHOLDS.noEffectiveMax) {
    return "no_effective";
  }
  if (effectiveFraction < FEASIBILITY_THRESHOLDS.partialMax) {
    return "partial";
  }
  return "meaningful";
}

/**
 * @param {number} value
 */
function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}
