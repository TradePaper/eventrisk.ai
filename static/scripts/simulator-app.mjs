// @ts-check

import { createApiClient, ApiError, readRuntimeConfig, shouldEnableApiDebug } from "/static/scripts/api-client.mjs";
import { applyViewState } from "/static/scripts/view-state.mjs";
import {
  SIMULATOR_DEFAULTS,
  liquidityToLogValue,
  logValueToLiquidity,
  parseSimulatorState,
  serializeSimulatorState,
} from "/static/scripts/simulator-state.mjs";

const PRESETS = {
  superbowl: { label: "Super Bowl", liability: 136_000_000, liquidity: 20_000_000, hedgeFraction: 0.6 },
  election: { label: "Election", liability: 180_000_000, liquidity: 35_000_000, hedgeFraction: 0.45 },
  weather: { label: "Weather", liability: 60_000_000, liquidity: 8_000_000, hedgeFraction: 0.7 },
};

const runtimeConfig = readRuntimeConfig();
const client = createApiClient({ runtimeConfig });
const shouldDebugApi = shouldEnableApiDebug(runtimeConfig);

const state = {
  ...SIMULATOR_DEFAULTS,
  ...parseSimulatorState(new URL(window.location.href)),
  requestId: 0,
};

const refs = {
  liabilityInput: /** @type {HTMLInputElement} */ (document.getElementById("liabilityInput")),
  liquidityInput: /** @type {HTMLInputElement} */ (document.getElementById("liquidityInput")),
  hedgeInput: /** @type {HTMLInputElement} */ (document.getElementById("hedgeInput")),
  liabilityValue: document.getElementById("liabilityValue"),
  liquidityValue: document.getElementById("liquidityValue"),
  hedgeValue: document.getElementById("hedgeValue"),
  requestedFractionValue: document.getElementById("requestedFractionValue"),
  effectiveFractionValue: document.getElementById("effectiveFractionValue"),
  liquidityBindingValue: document.getElementById("liquidityBindingValue"),
  chartStatus: document.getElementById("chartStatus"),
  copyButton: /** @type {HTMLButtonElement} */ (document.getElementById("copyShareLink")),
  runButton: /** @type {HTMLButtonElement} */ (document.getElementById("runSimulation")),
  presetButtons: Array.from(document.querySelectorAll("[data-preset]")),
  panels: ["distribution", "curve", "frontier"].reduce((acc, key) => {
    acc[key] = {
      shell: /** @type {HTMLElement} */ (document.querySelector(`[data-chart-shell="${key}"]`)),
      skeleton: /** @type {HTMLElement} */ (document.querySelector(`[data-chart-skeleton="${key}"]`)),
      error: /** @type {HTMLElement} */ (document.querySelector(`[data-chart-error="${key}"]`)),
      plot: /** @type {HTMLElement} */ (document.querySelector(`[data-chart-plot="${key}"]`)),
      retry: /** @type {HTMLButtonElement} */ (document.querySelector(`[data-chart-retry="${key}"]`)),
    };
    return acc;
  }, /** @type {Record<string, any>} */ ({})),
};

function init() {
  if (shouldDebugApi) {
    console.info("[simulator] resolved API base:", client.baseUrl, client.baseUrls);
  }
  refs.liabilityInput.value = String(state.liability);
  refs.liquidityInput.value = String(liquidityToLogValue(state.liquidity));
  refs.hedgeInput.value = String(state.hedgeFraction);

  refs.presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const presetKey = button.getAttribute("data-preset");
      if (!presetKey || !(presetKey in PRESETS)) {
        return;
      }
      Object.assign(state, PRESETS[presetKey]);
      syncInputs();
      updateActivePreset();
      updateUrl();
    });
  });

  refs.liabilityInput.addEventListener("input", () => {
    state.liability = Math.round(Number(refs.liabilityInput.value) || SIMULATOR_DEFAULTS.liability);
    updateActivePreset();
    updateDisplay();
    updateUrl();
  });
  refs.liquidityInput.addEventListener("input", () => {
    state.liquidity = logValueToLiquidity(Number(refs.liquidityInput.value));
    updateActivePreset();
    updateDisplay();
    updateUrl();
  });
  refs.hedgeInput.addEventListener("input", () => {
    state.hedgeFraction = Number((Number(refs.hedgeInput.value) || 0).toFixed(2));
    updateActivePreset();
    updateDisplay();
    updateUrl();
  });

  refs.copyButton.addEventListener("click", copyShareLink);
  refs.runButton.addEventListener("click", () => runSimulation());
  Object.values(refs.panels).forEach((panel) => {
    panel.retry.addEventListener("click", () => runSimulation());
  });

  syncInputs();
  updateActivePreset();
  runSimulation();
}

function syncInputs() {
  refs.liabilityInput.value = String(state.liability);
  refs.liquidityInput.value = String(liquidityToLogValue(state.liquidity));
  refs.hedgeInput.value = String(state.hedgeFraction);
  updateDisplay();
}

function updateDisplay() {
  refs.liabilityValue.textContent = formatCurrency(state.liability);
  refs.liquidityValue.textContent = formatCurrency(state.liquidity);
  refs.hedgeValue.textContent = `${Math.round(state.hedgeFraction * 100)}%`;
  refs.requestedFractionValue.textContent = formatFraction(state.hedgeFraction);
}

function updateActivePreset() {
  refs.presetButtons.forEach((button) => {
    const key = button.getAttribute("data-preset");
    const preset = key ? PRESETS[key] : null;
    const active = Boolean(
      preset &&
        preset.liability === state.liability &&
        preset.liquidity === state.liquidity &&
        Math.abs(preset.hedgeFraction - state.hedgeFraction) < 0.001,
    );
    button.classList.toggle("active", active);
  });
}

function updateUrl() {
  const query = serializeSimulatorState(state);
  window.history.replaceState({}, "", `/simulator?${query}`);
}

async function copyShareLink() {
  const shareUrl = `${window.location.origin}/simulator?${serializeSimulatorState(state)}`;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
    } else {
      throw new Error("Clipboard API unavailable.");
    }
    const original = refs.copyButton.textContent;
    refs.copyButton.textContent = "Copied";
    window.setTimeout(() => {
      refs.copyButton.textContent = original;
    }, 1200);
  } catch (_error) {
    window.prompt("Copy this share link:", shareUrl);
  }
}

async function runSimulation() {
  const requestId = ++state.requestId;
  const requestState = {
    liability: state.liability,
    liquidity: state.liquidity,
    hedgeFraction: state.hedgeFraction,
  };
  refs.runButton.disabled = true;
  refs.chartStatus.textContent = "Running live simulation";
  setPanelsState("loading");

  const results = await Promise.all([
    loadPanel(
      "distribution",
      requestId,
      () => client.fetchDistribution(requestState).then(normalizeDistributionResponse),
      renderDistribution,
    ),
    loadPanel("curve", requestId, () => client.fetchInteractiveCurve(requestState).then(normalizeCurveResponse), renderCurve),
    loadPanel("frontier", requestId, () => client.fetchFrontier(requestState), renderFrontier),
  ]);

  if (requestId !== state.requestId) {
    return;
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length === 0) {
    refs.chartStatus.textContent = "Live API results";
  } else {
    failures.forEach((result) => console.error(result.error));
    refs.chartStatus.textContent = "Simulation unavailable";
  }

  refs.runButton.disabled = false;
  updateUrl();
}

/**
 * @param {"loading" | "ready" | "error"} status
 * @param {string} [message]
 */
function setPanelsState(status, message = "") {
  Object.values(refs.panels).forEach((panel) => {
    panel.shell.dataset.loading = status === "loading" ? "true" : "false";
    applyViewState(panel, status, message);
  });
}

/**
 * @param {"distribution" | "curve" | "frontier"} panelKey
 * @param {number} requestId
 * @param {() => Promise<any>} load
 * @param {(data: any) => void} render
 */
async function loadPanel(panelKey, requestId, load, render) {
  try {
    const data = await load();
    if (requestId !== state.requestId) {
      return { ok: false, stale: true };
    }
    render(data);
    refs.panels[panelKey].shell.dataset.loading = "false";
    applyViewState(refs.panels[panelKey], "ready");
    return { ok: true };
  } catch (error) {
    if (requestId !== state.requestId) {
      return { ok: false, stale: true };
    }
    refs.panels[panelKey].shell.dataset.loading = "false";
    applyViewState(refs.panels[panelKey], "error", normalizeError(error));
    return { ok: false, error };
  }
}

/**
 * @param {any} data
 */
function renderDistribution(data) {
  const unhedged = data?.unhedged ?? { bin_mids: [], counts: [] };
  const hedged = data?.hedged ?? { bin_mids: [], counts: [] };

  window.Plotly.newPlot(
    refs.panels.distribution.plot,
    [
      {
        x: unhedged.bin_mids,
        y: unhedged.counts,
        type: "bar",
        name: "Unhedged",
        marker: { color: "#d35d47", opacity: 0.62 },
      },
      {
        x: hedged.bin_mids,
        y: hedged.counts,
        type: "bar",
        name: "Hedged",
        marker: { color: "#126b52", opacity: 0.68 },
      },
    ],
    baseLayout("P&L outcome", "Path count"),
    { displayModeBar: false, responsive: true },
  );
}

/**
 * @param {any} data
 */
function renderCurve(data) {
  const curvePoints = Array.isArray(data?.curve_points) ? data.curve_points : [];
  const regimes = Array.isArray(data?.liquidity_regimes) ? data.liquidity_regimes : [];
  const requested = curvePoints.map((point) => point.requestedHedgeFraction * 100);
  const liabilities = curvePoints.map((point) => point.liability);
  const mediumPoint =
    curvePoints.find((point) => Math.abs(point.liability - state.liability) < 1) ??
    curvePoints[Math.floor(curvePoints.length / 2)] ??
    null;

  refs.requestedFractionValue.textContent = formatFraction(mediumPoint?.requestedHedgeFraction ?? state.hedgeFraction);
  refs.effectiveFractionValue.textContent = formatFraction(mediumPoint?.effectiveHedgeFraction ?? 0);
  refs.liquidityBindingValue.textContent = mediumPoint?.liquidityBinding ? "Yes" : "No";
  if (shouldDebugApi && mediumPoint) {
    console.info("[simulator] capacity snapshot", {
      liability: mediumPoint.liability,
      liquidity: state.liquidity,
      requestedHedgeFraction: mediumPoint.requestedHedgeFraction,
      effectiveHedgeFraction: mediumPoint.effectiveHedgeFraction,
      liquidityBinding: mediumPoint.liquidityBinding,
    });
  }

  window.Plotly.newPlot(
    refs.panels.curve.plot,
    [
      {
        x: liabilities,
        y: requested,
        type: "scatter",
        mode: "lines",
        name: "Requested Hedge %",
        line: { color: "#11232b", width: 2, dash: "dash" },
      },
      ...regimes
        .filter((regime) => Array.isArray(regime.curve_points) && regime.curve_points.length > 0)
        .map((regime) => ({
          x: regime.curve_points.map((point) => point.liability),
          y: regime.curve_points.map((point) => point.effectiveHedgeFraction * 100),
          type: "scatter",
          mode: "lines+markers",
          name: regime.label,
          line: {
            color: regime.id === "low" ? "#b65a35" : regime.id === "medium" ? "#0d5c63" : "#126b52",
            width: regime.id === "medium" ? 3 : 2,
          },
          marker: { size: regime.id === "medium" ? 8 : 7 },
        })),
    ],
    {
      ...baseLayout("Sportsbook Liability", "Effective Hedge Fraction"),
      yaxis: {
        title: "Effective Hedge Fraction (%)",
        rangemode: "tozero",
        ticksuffix: "%",
        gridcolor: "rgba(17,35,43,0.08)",
      },
    },
    { displayModeBar: false, responsive: true },
  );
}

/**
 * @param {any} data
 */
function renderFrontier(data) {
  const shallow = Array.isArray(data?.frontiers?.shallow) ? data.frontiers.shallow : [];
  const deep = Array.isArray(data?.frontiers?.deep) ? data.frontiers.deep : [];

  window.Plotly.newPlot(
    refs.panels.frontier.plot,
    [
      frontierTrace(shallow, "Shallow Market", "#b65a35"),
      frontierTrace(deep, "Deep Market", "#0f6b5e"),
    ],
    baseLayout("EV Sacrificed", "Tail Reduction"),
    { displayModeBar: false, responsive: true },
  );
}

/**
 * @param {Array<any>} rows
 * @param {string} name
 * @param {string} color
 */
function frontierTrace(rows, name, color) {
  return {
    x: rows.map((row) => row.ev_sacrificed),
    y: rows.map((row) => row.tail_reduction),
    type: "scatter",
    mode: "lines+markers",
    name,
    line: { color, width: 3 },
    marker: { size: 7 },
  };
}

/**
 * @param {string} xTitle
 * @param {string} yTitle
 */
function baseLayout(xTitle, yTitle) {
  return {
    paper_bgcolor: "rgba(255,255,255,0)",
    plot_bgcolor: "#f8f5ef",
    margin: { l: 56, r: 36, t: 56, b: 48 },
    font: { family: "IBM Plex Sans, sans-serif", color: "#11232b" },
    xaxis: { title: xTitle, gridcolor: "rgba(17,35,43,0.08)", zerolinecolor: "rgba(17,35,43,0.14)" },
    yaxis: { title: yTitle, gridcolor: "rgba(17,35,43,0.08)", zerolinecolor: "rgba(17,35,43,0.14)" },
    legend: { orientation: "h", x: 0, y: 1.12 },
  };
}

/**
 * @param {unknown} error
 */
function normalizeError(error) {
  if (error instanceof ApiError) {
    if (error.kind === "timeout") {
      return formatErrorDetail(error, "The live API timed out after 15 seconds.");
    }
    if (error.kind === "validation") {
      return formatErrorDetail(error, "The simulation request was rejected by the API.");
    }
    if (error.kind === "http" && error.status) {
      return formatErrorDetail(error, `The simulation API returned HTTP ${error.status}.`);
    }
  }
  return error instanceof ApiError ? formatErrorDetail(error, error.message) : "The live API could not be reached.";
}

refs.effectiveFractionValue.textContent = "—";
refs.liquidityBindingValue.textContent = "—";

/**
 * @param {number} value
 */
function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * @param {number} value
 */
function formatFraction(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function normalizeDistributionResponse(payload) {
  return {
    ...payload,
    requestedHedgeFraction: readFractionField(payload, "requestedHedgeFraction", "requested_hedge_fraction", "hedge_fraction"),
    effectiveHedgeFraction: readFractionField(
      payload,
      "effectiveHedgeFraction",
      "effective_hedge_fraction",
      "requested_hedge_fraction",
      "hedge_fraction",
    ),
    liquidityBinding: readBooleanField(payload, "liquidityBinding", "liquidity_binding"),
    unhedged: normalizeHistogram(payload?.unhedged),
    hedged: normalizeHistogram(payload?.hedged),
  };
}

function normalizeCurveResponse(payload) {
  const curvePoints = Array.isArray(payload.curve_points)
    ? payload.curve_points.map((point) => normalizeCurvePoint(point))
    : [];
  const liquidityRegimes = Array.isArray(payload.liquidity_regimes)
    ? payload.liquidity_regimes.map((regime) => ({
        ...regime,
        curve_points: Array.isArray(regime.curve_points) ? regime.curve_points.map((point) => normalizeCurvePoint(point)) : [],
      }))
    : [];
  const normalizedRegimes = liquidityRegimes.length > 0 ? liquidityRegimes : buildFallbackLiquidityRegimes(curvePoints, payload);
  return {
    ...payload,
    curve_points: curvePoints,
    liquidity_regimes: normalizedRegimes,
  };
}

function normalizeCurvePoint(point) {
  const requestedHedgeFraction = readFractionField(
    point,
    "requestedHedgeFraction",
    "requested_hedge_fraction",
    "optimalHedgeRatio",
    "optimal_hedge_ratio",
    "hedgeRatio",
    "hedge_ratio",
  );
  const effectiveHedgeFraction = readFractionField(
    point,
    "effectiveHedgeFraction",
    "effective_hedge_fraction",
    "optimalHedgeRatio",
    "optimal_hedge_ratio",
    "hedgeRatio",
    "hedge_ratio",
    "requested_hedge_fraction",
  );

  return {
    ...point,
    liability: readNumberField(point, "liability"),
    requestedHedgeFraction,
    effectiveHedgeFraction,
    liquidityBinding: readBooleanField(point, "liquidityBinding", "liquidity_binding"),
  };
}

function normalizeHistogram(histogram) {
  const counts = Array.isArray(histogram?.counts) ? histogram.counts.map((value) => Number(value) || 0) : [];
  let binMids = Array.isArray(histogram?.bin_mids) ? histogram.bin_mids.map((value) => Number(value) || 0) : [];
  const binEdges = Array.isArray(histogram?.bin_edges) ? histogram.bin_edges.map((value) => Number(value) || 0) : [];

  if (binMids.length === 0 && binEdges.length > 1) {
    binMids = binEdges.slice(0, -1).map((edge, index) => (edge + binEdges[index + 1]) / 2);
  }

  const length = Math.min(binMids.length, counts.length);
  return {
    ...histogram,
    bin_mids: binMids.slice(0, length),
    counts: counts.slice(0, length),
  };
}

function buildFallbackLiquidityRegimes(curvePoints, payload) {
  if (!curvePoints.length) {
    return [];
  }
  return [
    {
      id: "medium",
      label: "Effective Hedge %",
      available_liquidity: payload?.liquidity_cap?.available_liquidity ?? null,
      curve_points: curvePoints,
    },
  ];
}

function readFractionField(source, ...keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function readNumberField(source, ...keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function readBooleanField(source, ...keys) {
  for (const key of keys) {
    if (key in (source ?? {})) {
      return Boolean(source?.[key]);
    }
  }
  return false;
}

function formatErrorDetail(error, fallback) {
  const location = error.url ? `POST ${error.url}` : "API request";
  const status = error.status ? ` [${error.status}]` : "";
  const body = error.responseText ? ` ${error.responseText}` : "";
  return `${fallback} ${location}${status}.${body}`.trim();
}

init();
