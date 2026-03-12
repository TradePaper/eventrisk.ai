// @ts-check

/**
 * @typedef {{
 *   apiBaseUrl?: string;
 * }} RuntimeConfig
 */

const DEFAULT_API_BASE_URL = "https://market-hedge-simulator.replit.app";

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
   * @param {"timeout" | "network" | "http" | "validation" | "parse"} kind
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
  return resolveApiBaseUrls(options)[0] ?? DEFAULT_API_BASE_URL;
}

/**
 * @param {ApiClientOptions} [options]
 */
export function resolveApiBaseUrls(options = {}) {
  const locationOrigin =
    normalizeBaseUrl(options.locationOrigin) ||
    (typeof window !== "undefined" ? normalizeBaseUrl(window.location?.origin) : "");
  const runtimeConfig =
    options.runtimeConfig ??
    (typeof window !== "undefined"
      ? window.__EVENTRISK_CONFIG ?? window.__EVENTRISK_RUNTIME_CONFIG__ ?? window.__RUNTIME_CONFIG__ ?? {}
      : {});
  const explicitBase = normalizeBaseUrl(options.baseUrl, locationOrigin);
  const runtimeBase = normalizeBaseUrl(runtimeConfig.apiBaseUrl, locationOrigin);
  const sameOriginBase = normalizeBaseUrl(locationOrigin, locationOrigin);
  const fallbackBase = normalizeBaseUrl(options.fallbackBaseUrl, locationOrigin) || DEFAULT_API_BASE_URL;

  const primaryBase = explicitBase || runtimeBase || sameOriginBase || fallbackBase;
  const candidates = [];
  for (const candidate of [primaryBase, sameOriginBase, runtimeBase, fallbackBase]) {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }
  return candidates.slice(0, 2);
}

/**
 * @param {ApiClientOptions} [options]
 */
export function createApiClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const locationOrigin =
    normalizeBaseUrl(options.locationOrigin) ||
    (typeof window !== "undefined" ? normalizeBaseUrl(window.location?.origin) : "");
  const baseUrls = resolveApiBaseUrls({
    baseUrl: options.baseUrl,
    fallbackBaseUrl: normalizeBaseUrl(options.fallbackBaseUrl, locationOrigin) || DEFAULT_API_BASE_URL,
    runtimeConfig: options.runtimeConfig,
    locationOrigin,
  });
  const baseUrl = baseUrls[0] ?? DEFAULT_API_BASE_URL;

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is required.");
  }

  /**
   * @param {string} path
   * @param {RequestInit} [init]
   */
  async function fetchJson(path, init = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < baseUrls.length; attempt += 1) {
      try {
        return await fetchJsonFromBase(baseUrls[attempt], path, init, fetchImpl, timeoutMs);
      } catch (error) {
        lastError = normalizeFetchError(error, timeoutMs);
        if (!shouldRetryRequest(lastError, attempt, baseUrls.length)) {
          throw lastError;
        }
      }
    }
    throw lastError ?? new ApiError("Unable to reach the simulation API.", "network");
  }

  return {
    baseUrl,
    baseUrls,
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
          requested_hedge_fraction: params.hedgeFraction,
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
 * @param {string | undefined | null} value
 */
function normalizeBaseUrl(value, locationOrigin = "") {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const normalized = locationOrigin ? new URL(trimmed, `${locationOrigin}/`) : new URL(trimmed);
    if (!/^https?:$/.test(normalized.protocol)) {
      return "";
    }
    return normalized.toString().replace(/\/$/, "");
  } catch (_error) {
    return "";
  }
}

/**
 * @param {string} baseUrl
 * @param {string} path
 * @param {RequestInit} init
 * @param {typeof fetch} fetchImpl
 * @param {number} timeoutMs
 */
async function fetchJsonFromBase(baseUrl, path, init, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  let response;

  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    throw normalizeFetchError(error, timeoutMs);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const payload = text ? tryParseJson(text) : null;

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string"
        ? payload.detail
        : `HTTP ${response.status}`;
    throw new ApiError(detail, response.status >= 400 && response.status < 500 ? "validation" : "http", {
      status: response.status,
    });
  }

  return payload;
}

/**
 * @param {unknown} error
 * @param {number} timeoutMs
 */
function normalizeFetchError(error, timeoutMs) {
  if (error instanceof ApiError) {
    return error;
  }
  if (isAbortError(error)) {
    return new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`, "timeout", { cause: error });
  }
  return new ApiError("Unable to reach the simulation API.", "network", { cause: error });
}

/**
 * @param {ApiError} error
 * @param {number} attempt
 * @param {number} totalAttempts
 */
function shouldRetryRequest(error, attempt, totalAttempts) {
  return attempt === 0 && totalAttempts > 1 && (error.kind === "timeout" || error.kind === "network");
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
