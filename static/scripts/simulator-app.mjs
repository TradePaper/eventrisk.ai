// @ts-check

import { createApiClient, ApiError } from "/static/scripts/api-client.mjs";
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

const client = createApiClient();

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
    loadPanel("distribution", requestId, () => client.fetchDistribution(requestState), renderDistribution),
    loadPanel("curve", requestId, () => client.fetchInteractiveCurve(requestState), renderCurve),
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
  window.Plotly.newPlot(
    refs.panels.distribution.plot,
    [
      {
        x: data.unhedged.bin_mids,
        y: data.unhedged.counts,
        type: "bar",
        name: "Unhedged",
        marker: { color: "#d35d47", opacity: 0.62 },
      },
      {
        x: data.hedged.bin_mids,
        y: data.hedged.counts,
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
  const regimes = data.liquidity_regimes ?? [];
  const requested = data.curve_points.map((point) => point.requested_hedge_fraction * 100);
  const liabilities = data.curve_points.map((point) => point.liability);
  const mediumPoint = data.curve_points.find((point) => Math.abs(point.liability - state.liability) < 1) ?? data.curve_points[0];

  refs.effectiveFractionValue.textContent = formatFraction(mediumPoint?.effective_hedge_fraction ?? 0);
  refs.liquidityBindingValue.textContent = mediumPoint?.liquidity_binding ? "Yes" : "No";

  window.Plotly.newPlot(
    refs.panels.curve.plot,
    [{
      x: liabilities,
      y: requested,
      type: "scatter",
      mode: "lines",
      name: "Requested Hedge %",
      line: { color: "#11232b", width: 2, dash: "dash" },
    },
    ...regimes.map((regime) => ({
      x: regime.curve_points.map((point) => point.liability),
      y: regime.curve_points.map((point) => point.effective_hedge_fraction * 100),
      type: "scatter",
      mode: "lines+markers",
      name: regime.label,
      line: {
        color: regime.id === "low" ? "#b65a35" : regime.id === "medium" ? "#0d5c63" : "#126b52",
        width: regime.id === "medium" ? 3 : 2,
      },
      marker: { size: regime.id === "medium" ? 8 : 7 },
    }))],
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
  window.Plotly.newPlot(
    refs.panels.frontier.plot,
    [
      frontierTrace(data.frontiers.shallow, "Shallow Market", "#b65a35"),
      frontierTrace(data.frontiers.deep, "Deep Market", "#0f6b5e"),
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
      return "The live API timed out after 15 seconds.";
    }
    if (error.kind === "validation") {
      return "The simulation request was rejected by the API.";
    }
    if (error.kind === "http" && error.status) {
      return `The simulation API returned HTTP ${error.status}.`;
    }
  }
  return "The live API could not be reached.";
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
  return value.toFixed(2);
}

init();
