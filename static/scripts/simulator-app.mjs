// @ts-check

import { createApiClient, ApiError } from "/static/scripts/api-client.mjs";
import {
  SIMULATOR_DEFAULTS,
  liquidityToLogValue,
  logValueToLiquidity,
  parseSimulatorState,
  serializeSimulatorState,
} from "/static/scripts/simulator-state.mjs";

const PRESETS = {
  superbowl: { label: "Super Bowl", liability: 120_000_000, liquidity: 20_000_000, hedgeFraction: 0.6 },
  election: { label: "Election", liability: 180_000_000, liquidity: 35_000_000, hedgeFraction: 0.45 },
  weather: { label: "Weather", liability: 60_000_000, liquidity: 8_000_000, hedgeFraction: 0.7 },
};

const client = createApiClient();

const state = {
  ...SIMULATOR_DEFAULTS,
  ...parseSimulatorState(new URL(window.location.href)),
};

const refs = {
  liabilityInput: /** @type {HTMLInputElement} */ (document.getElementById("liabilityInput")),
  liquidityInput: /** @type {HTMLInputElement} */ (document.getElementById("liquidityInput")),
  hedgeInput: /** @type {HTMLInputElement} */ (document.getElementById("hedgeInput")),
  liabilityValue: document.getElementById("liabilityValue"),
  liquidityValue: document.getElementById("liquidityValue"),
  hedgeValue: document.getElementById("hedgeValue"),
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
  refs.runButton.disabled = true;
  refs.chartStatus.textContent = "Running live simulation";
  setPanelsState("loading");

  try {
    const [distribution, curve, frontier] = await Promise.all([
      client.fetchDistribution(state),
      client.fetchInteractiveCurve(state),
      client.fetchFrontier(state),
    ]);

    renderDistribution(distribution);
    renderCurve(curve);
    renderFrontier(frontier);
    refs.chartStatus.textContent = "Live API results";
    setPanelsState("ready");
  } catch (error) {
    console.error(error);
    setPanelsState("error", normalizeError(error));
    refs.chartStatus.textContent = "Simulation unavailable";
  } finally {
    refs.runButton.disabled = false;
    updateUrl();
  }
}

/**
 * @param {"loading" | "ready" | "error"} status
 * @param {string} [message]
 */
function setPanelsState(status, message = "") {
  Object.values(refs.panels).forEach((panel) => {
    panel.skeleton.hidden = status !== "loading";
    panel.error.hidden = status !== "error";
    panel.plot.hidden = status !== "ready";
    panel.shell.dataset.loading = status === "loading" ? "true" : "false";
    const detail = panel.error.querySelector(".chart-error-detail");
    if (detail && status === "error") {
      detail.textContent = message;
    }
  });
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
    baseLayout("Sportsbook Loss Distribution", "P&L outcome", "Path count"),
    { displayModeBar: false, responsive: true },
  );
}

/**
 * @param {any} data
 */
function renderCurve(data) {
  const liabilities = data.curve_points.map((point) => point.liability);
  const cvar = data.curve_points.map((point) => Math.abs(point.cvar));
  const hedgeRatio = data.curve_points.map((point) => point.hedge_ratio * 100);

  window.Plotly.newPlot(
    refs.panels.curve.plot,
    [
      {
        x: liabilities,
        y: cvar,
        type: "scatter",
        mode: "lines+markers",
        name: "EWCL",
        line: { color: "#0d5c63", width: 3 },
        marker: { size: 8 },
      },
      {
        x: liabilities,
        y: hedgeRatio,
        type: "scatter",
        mode: "lines+markers",
        name: "Optimal Hedge %",
        yaxis: "y2",
        line: { color: "#b07a00", width: 2, dash: "dot" },
        marker: { size: 7 },
      },
    ],
    {
      ...baseLayout("Liquidity-Constrained Risk Transfer Curve", "Liability", "EWCL"),
      yaxis2: {
        title: "Optimal Hedge %",
        overlaying: "y",
        side: "right",
        rangemode: "tozero",
        ticksuffix: "%",
        gridcolor: "rgba(0,0,0,0)",
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
    baseLayout("Hedging Efficiency Frontier", "EV Sacrificed", "Tail Reduction"),
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
 * @param {string} title
 * @param {string} xTitle
 * @param {string} yTitle
 */
function baseLayout(title, xTitle, yTitle) {
  return {
    title: { text: title, x: 0.02, xanchor: "left", font: { size: 18, family: "IBM Plex Sans, sans-serif" } },
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
    if (error.kind === "http" && error.status) {
      return `The simulation API returned HTTP ${error.status}.`;
    }
  }
  return "The live API could not be reached.";
}

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

init();
