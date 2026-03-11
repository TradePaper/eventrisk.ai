// @ts-check

/**
 * @typedef {{
 *   apiBaseUrl?: string;
 * }} RuntimeConfig
 */

/**
 * @typedef {{
 *   baseUrl?: string;
 *   fallbackBaseUrl?: string;
 *   timeoutMs?: number;
 *   fetchImpl?: typeof fetch;
 *   runtimeConfig?: RuntimeConfig;
 *   locationOrigin?: string;
 * }} ApiClientOptions
 */

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {"timeout" | "network" | "http" | "parse"} kind
   * @param {{ status?: number; cause?: unknown }} [options]
   */
  constructor(message, kind, options = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.cause = options.cause;
  }
}

/**
 * @param {ApiClientOptions} [options]
 */
export function resolveApiBaseUrl(options = {}) {
  const explicitBase = options.baseUrl?.trim();
  if (explicitBase) {
    return explicitBase.replace(/\/$/, "");
  }

  const runtimeConfig =
    options.runtimeConfig ??
    (typeof window !== "undefined"
      ? window.__EVENTRISK_RUNTIME_CONFIG__ ?? window.__RUNTIME_CONFIG__ ?? {}
      : {});

  const runtimeBase = runtimeConfig.apiBaseUrl?.trim();
  if (runtimeBase) {
    return runtimeBase.replace(/\/$/, "");
  }

  if (options.locationOrigin) {
    return options.locationOrigin.replace(/\/$/, "");
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }

  return options.fallbackBaseUrl?.trim()?.replace(/\/$/, "") ?? "";
}

/**
 * @param {ApiClientOptions} [options]
 */
export function createApiClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const baseUrl = resolveApiBaseUrl({
    baseUrl: options.baseUrl,
    fallbackBaseUrl: options.fallbackBaseUrl,
    runtimeConfig: options.runtimeConfig,
    locationOrigin: options.locationOrigin,
  });

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is required.");
  }

  /**
   * @param {string} path
   * @param {RequestInit} [init]
   */
  async function fetchJson(path, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });

      const text = await response.text();
      const payload = text ? tryParseJson(text) : null;

      if (!response.ok) {
        const detail =
          payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string"
            ? payload.detail
            : `HTTP ${response.status}`;
        throw new ApiError(detail, "http", { status: response.status });
      }

      return payload;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new ApiError("Request timed out after 15 seconds.", "timeout", { cause: error });
      }
      throw new ApiError("Unable to reach the simulation API.", "network", { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    baseUrl,
    fetchJson,

    /**
     * @param {{
     *   liability: number;
     *   liquidity: number;
     *   hedgeFraction: number;
     *   trueProbability?: number;
     *   marketPrice?: number;
     *   simulationCount?: number;
     * }} params
     */
    fetchDistribution(params) {
      return fetchJson("/api/risk-transfer/distribution", {
        method: "POST",
        body: JSON.stringify({
          strategy: "external_hedge",
          liability: params.liability,
          hedge_fraction: params.hedgeFraction,
          base_input: {
            stake: Math.max(params.liability, 1),
            american_odds: probabilityToAmericanOdds(params.marketPrice ?? 0.52),
            true_win_prob: params.trueProbability ?? 0.55,
            fill_probability: 1,
            slippage_bps: 20,
            fee_bps: 10,
            latency_bps: 5,
            n_paths: params.simulationCount ?? 800,
            seed: "simulator-v1",
            liquidity: {
              available_liquidity: params.liquidity,
              participation_rate: 1,
              impact_factor: 0.02,
              depth_exponent: 1,
            },
          },
        }),
      });
    },

    /**
     * @param {{
     *   liability: number;
     *   liquidity: number;
     *   trueProbability?: number;
     *   marketPrice?: number;
     * }} params
     */
    fetchInteractiveCurve(params) {
      return fetchJson("/api/risk-transfer/interactive", {
        method: "POST",
        body: JSON.stringify({
          liability_min: Math.max(1_000_000, Math.round(params.liability * 0.25)),
          liability_max: Math.round(params.liability * 1.75),
          n_points: 7,
          true_probability: params.trueProbability ?? 0.55,
          prediction_market_price: params.marketPrice ?? 0.52,
          liquidity: {
            available_liquidity: params.liquidity,
            participation_rate: 1,
            impact_factor: 0.02,
            depth_exponent: 1,
          },
          fill_probability: 1,
          objective: "min_cvar",
          strategy: "external_hedge",
          seed: "simulator-v1",
          n_paths: 500,
        }),
      });
    },

    /**
     * @param {{
     *   liability: number;
     *   liquidity: number;
     *   hedgeFraction: number;
     *   trueProbability?: number;
     *   marketPrice?: number;
     *   simulationCount?: number;
     * }} params
     */
    fetchFrontier(params) {
      return fetchJson("/api/tier2/frontier", {
        method: "POST",
        body: JSON.stringify({
          liability: params.liability,
          liquidity: params.liquidity,
          true_probability: params.trueProbability ?? 0.55,
          market_price: params.marketPrice ?? 0.52,
          target_hedge_ratio: params.hedgeFraction,
          simulation_count: params.simulationCount ?? 6000,
        }),
      });
    },
  };
}

/**
 * @param {string} text
 */
function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ApiError("Received an invalid JSON response.", "parse", { cause: error });
  }
}

/**
 * @param {unknown} error
 */
function isAbortError(error) {
  return (
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && (error.name === "AbortError" || error.message === "timeout"))
  );
}

/**
 * @param {number} probability
 */
function probabilityToAmericanOdds(probability) {
  const p = Math.min(Math.max(probability, 0.001), 0.999);
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}
