// @ts-check

import { ApiError, createApiClient } from "/static/scripts/api-client.mjs";
import { buildRegimeCurves } from "/static/scripts/hedge-capacity.mjs";
import { applyViewState } from "/static/scripts/view-state.mjs";

const LIVE_API_BASE_URL = "https://market-hedge-simulator.replit.app";
const STRATEGY_LABELS = {
  external_hedge: "External Hedge",
  internal_reprice: "Internal Reprice",
  hybrid: "Hybrid",
};
const CURVE_METRICS = {
  effective_fraction: {
    label: "Effective Hedge %",
    accessor: (point) => point.effective_hedge_fraction * 100,
    axis: "Effective hedge fraction (%)",
    hover: ".1f",
  },
  effective_notional: {
    label: "Effective Hedge Notional",
    accessor: (point) => point.effective_hedge_notional,
    axis: "Effective hedge notional ($)",
    hover: "$,.0f",
  },
  hedge_gap: {
    label: "Unfilled Hedge Gap",
    accessor: (point) => point.requested_hedge_notional - point.effective_hedge_notional,
    axis: "Requested minus effective hedge ($)",
    hover: "$,.0f",
  },
};
const BASE_DISTRIBUTION_INPUT = {
  liability: 136_000_000,
  base_input: {
    stake: 8_000_000,
    american_odds: -122,
    true_win_prob: 0.55,
    fill_probability: 1,
    n_paths: 500,
    seed: "superbowl_v1",
    slippage_bps: 5,
    fee_bps: 2,
    latency_bps: 1,
    liquidity: {
      available_liquidity: 20_000_000,
      participation_rate: 1,
      impact_factor: 0.01,
      depth_exponent: 1.0,
    },
    internal_reprice: {
      enabled: true,
      odds_move_sensitivity: 0.000002,
      handle_retention_decay: 0.25,
      min_prob: 0.01,
      max_prob: 0.99,
    },
  },
};
const CURVE_PAYLOAD = {
  liability_min: 20_000_000,
  liability_max: 140_000_000,
  n_points: 7,
  true_probability: 0.55,
  prediction_market_price: 0.55,
  requested_hedge_fraction: 0.60,
  fill_probability: 1.0,
  objective: "min_cvar",
  seed: "superbowl_v1",
  n_paths: 500,
  liquidity: {
    available_liquidity: 20_000_000,
    participation_rate: 1.0,
    impact_factor: 0.01,
    depth_exponent: 1.0,
  },
};
const EXPLAINER_FALLBACK_PRESET = "/lib/presets/superbowl.json";

const client = createApiClient({ fallbackBaseUrl: LIVE_API_BASE_URL });
const shouldDebugApiBase = new URL(window.location.href).searchParams.get("debugApi") === "1";
const state = {
  activeStep: 0,
  strategy: "external_hedge",
  curveMetric: "effective_fraction",
  cache: new Map(),
  hasStaticFallback: false,
  baselineRequestId: 0,
  strategyRequestId: 0,
};

const refs = {
  deck: /** @type {HTMLElement} */ (document.getElementById("snapDeck")),
  back: /** @type {HTMLButtonElement} */ (document.getElementById("btnBack")),
  next: /** @type {HTMLButtonElement} */ (document.getElementById("btnNext")),
  seedNote: document.getElementById("seedNote"),
  metricSelect: /** @type {HTMLSelectElement} */ (document.getElementById("curveMetricSelect")),
  stepDots: Array.from(document.querySelectorAll("[data-step-target]")),
  strategyButtons: Array.from(document.querySelectorAll("[data-strategy]")),
  steps: Array.from(document.querySelectorAll("[data-step-index]")),
  plots: {
    step1: /** @type {HTMLElement} */ (document.querySelector('[data-plot="step1"]')),
    step2: /** @type {HTMLElement} */ (document.querySelector('[data-plot="step2"]')),
    step3: /** @type {HTMLElement} */ (document.querySelector('[data-plot="step3"]')),
  },
  skeletons: {
    step1: /** @type {HTMLElement} */ (document.querySelector('[data-skeleton="step1"]')),
    step2: /** @type {HTMLElement} */ (document.querySelector('[data-skeleton="step2"]')),
    step3: /** @type {HTMLElement} */ (document.querySelector('[data-skeleton="step3"]')),
  },
  errors: {
    step1: /** @type {HTMLElement} */ (document.querySelector('[data-error="step1"]')),
    step2: /** @type {HTMLElement} */ (document.querySelector('[data-error="step2"]')),
    step3: /** @type {HTMLElement} */ (document.querySelector('[data-error="step3"]')),
  },
  metrics: {
    step1Ev: document.getElementById("step1Ev"),
    step1Cvar: document.getElementById("step1Cvar"),
    step1Max: document.getElementById("step1Max"),
    step2UnhedgedCvar: document.getElementById("step2UnhedgedCvar"),
    step2HedgedCvar: document.getElementById("step2HedgedCvar"),
    step2UnhedgedMax: document.getElementById("step2UnhedgedMax"),
    step2HedgedMax: document.getElementById("step2HedgedMax"),
    step2TailReduction: document.getElementById("step2TailReduction"),
    step3MetricValue: document.getElementById("step3MetricValue"),
    step3HedgeRatio: document.getElementById("step3HedgeRatio"),
    step3BindingCount: document.getElementById("step3BindingCount"),
  },
};

init().catch((error) => {
  console.error(error);
});

async function init() {
  if (shouldDebugApiBase) {
    console.info("[explainer] resolved API base:", client.baseUrl);
  }
  bindEvents();
  updateControlUi();
  resetMetricText();
  await hydrateStaticFallback();
  await hydrateExplainer();
}

function bindEvents() {
  refs.back.addEventListener("click", () => goToStep(state.activeStep - 1));
  refs.next.addEventListener("click", () => goToStep(state.activeStep + 1));

  refs.metricSelect.addEventListener("change", () => {
    state.curveMetric = refs.metricSelect.value;
    if (!updateCurveCardFromCache()) {
      void hydrateStrategyViews(state.strategy, { forceRefresh: true });
    }
  });

  refs.stepDots.forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-step-target"));
      goToStep(index);
    });
  });

  refs.strategyButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const strategy = button.getAttribute("data-strategy");
      if (!strategy || strategy === state.strategy) {
        return;
      }

      state.strategy = strategy;
      updateControlUi();
      resetStepTwoThreeMetrics();
      await hydrateStrategyViews(strategy, { forceRefresh: true });
    });
  });

  refs.deck.addEventListener("scroll", syncStepFromScroll, { passive: true });

  let touchStartY = 0;
  refs.deck.addEventListener(
    "touchstart",
    (event) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    },
    { passive: true },
  );
  refs.deck.addEventListener(
    "touchend",
    (event) => {
      const touchEndY = event.changedTouches[0]?.clientY ?? touchStartY;
      const delta = touchStartY - touchEndY;
      if (Math.abs(delta) < 50) {
        return;
      }
      goToStep(state.activeStep + (delta > 0 ? 1 : -1));
    },
    { passive: true },
  );

  window.addEventListener("resize", debounce(() => updateAllChartsFromCache(), 120));
}

async function hydrateExplainer() {
  if (!state.hasStaticFallback) {
    setStepState("step1", "loading");
    setStepState("step2", "loading");
    setStepState("step3", "loading");
  }

  await Promise.allSettled([hydrateBaseline(), hydrateStrategyViews(state.strategy, { forceRefresh: true })]);
  updateControlUi();
}

async function hydrateStaticFallback() {
  try {
    const response = await fetch(EXPLAINER_FALLBACK_PRESET, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`fallback preset HTTP ${response.status}`);
    }
    const preset = await response.json();
    renderStaticStep1(preset);
    renderStaticStep2(preset);
    renderStaticStep3(preset);
    state.hasStaticFallback = true;
  } catch (error) {
    console.warn("[explainer] static fallback unavailable", error);
  }
}

async function hydrateBaseline() {
  const requestId = ++state.baselineRequestId;
  const cached = state.cache.get("step1:baseline");
  if (cached) {
    renderStep1(cached);
    return cached;
  }

  try {
    const payload = await fetchDistribution(0, "external_hedge");
    if (requestId !== state.baselineRequestId) {
      return null;
    }
    const step1Data = payload.unhedged;
    state.cache.set("step1:baseline", step1Data);
    renderStep1(step1Data);
    return step1Data;
  } catch (error) {
    if (requestId === state.baselineRequestId) {
      setStepState("step1", "error");
    }
    throw error;
  }
}

function getStep2CacheKey(strategy) {
  return `step2:${strategy}:${CURVE_PAYLOAD.seed}:${BASE_DISTRIBUTION_INPUT.liability}`;
}

function getStep3CacheKey(strategy) {
  return `step3:${strategy}:${CURVE_PAYLOAD.seed}:${CURVE_PAYLOAD.liability_min}:${CURVE_PAYLOAD.liability_max}:${CURVE_PAYLOAD.n_points}`;
}

async function hydrateStrategyViews(strategy, options = {}) {
  const requestId = ++state.strategyRequestId;
  const forceRefresh = Boolean(options.forceRefresh);
  const step2Key = getStep2CacheKey(strategy);
  const step3Key = getStep3CacheKey(strategy);
  const hasStep2Cache = state.cache.has(step2Key);
  const hasStep3Cache = state.cache.has(step3Key);

  if (hasStep2Cache) {
    renderStep2(/** @type {any} */ (state.cache.get(step2Key)));
  } else {
    setStepState("step2", "loading");
  }

  if (hasStep3Cache) {
    renderStep3(/** @type {any} */ (state.cache.get(step3Key)));
  } else {
    setStepState("step3", "loading");
  }

  const [step2Result, step3Result] = await Promise.allSettled([
    !forceRefresh && hasStep2Cache ? Promise.resolve(state.cache.get(step2Key)) : fetchStep2(strategy),
    !forceRefresh && hasStep3Cache ? Promise.resolve(state.cache.get(step3Key)) : fetchStep3(strategy),
  ]);

  if (requestId !== state.strategyRequestId || strategy !== state.strategy) {
    return;
  }

  if (step2Result.status === "fulfilled") {
    state.cache.set(step2Key, step2Result.value);
    renderStep2(step2Result.value);
  } else {
    console.error(step2Result.reason);
    if (!hasStep2Cache) {
      setStepState("step2", "error");
    }
  }

  if (step3Result.status === "fulfilled") {
    state.cache.set(step3Key, step3Result.value);
    renderStep3(step3Result.value);
  } else {
    console.error(step3Result.reason);
    if (!hasStep3Cache) {
      setStepState("step3", "error");
    }
  }
}

async function fetchStep2(strategy) {
  const [unhedgedPayload, hedgedPayload] = await Promise.all([
    fetchDistribution(0, strategy),
    fetchDistribution(0.5, strategy),
  ]);

  return {
    strategy,
    unhedged: unhedgedPayload.unhedged,
    hedged: hedgedPayload.hedged,
    requested_hedge_fraction: hedgedPayload.requested_hedge_fraction,
  };
}

async function fetchStep3(strategy) {
  return client.fetchJson("/api/risk-transfer/interactive", {
    method: "POST",
    body: JSON.stringify({
      ...CURVE_PAYLOAD,
      strategy,
    }),
  });
}

async function fetchDistribution(hedgeFraction, strategy) {
  return client.fetchJson("/api/risk-transfer/distribution", {
    method: "POST",
    body: JSON.stringify({
      strategy,
      liability: BASE_DISTRIBUTION_INPUT.liability,
      hedge_fraction: hedgeFraction,
      base_input: BASE_DISTRIBUTION_INPUT.base_input,
    }),
  });
}

function renderStep1(data) {
  renderHistogram({
    host: refs.plots.step1,
    title: "Unhedged P&L Distribution",
    primaryName: "Unhedged",
    primaryColor: "#e8ae52",
    primary: data,
    annotationLabel: "Tail exposure",
    annotationValue: data.cvar_95,
  });

  refs.metrics.step1Ev.textContent = formatCurrency(data.ev);
  refs.metrics.step1Cvar.textContent = formatCurrency(data.cvar_95);
  refs.metrics.step1Max.textContent = formatCurrency(data.max_loss);
  setStepState("step1", "ready");
}

function renderStep2(data) {
  renderHistogram({
    host: refs.plots.step2,
    title: "Hedged vs. Unhedged Overlay",
    primaryName: "Unhedged",
    primaryColor: "#e8ae52",
    primary: data.unhedged,
    secondaryName: "Hedged",
    secondaryColor: "#5bc6c4",
    secondary: data.hedged,
    annotationLabel: "CVaR-95 shift",
    annotationValue: data.hedged.cvar_95,
  });

  const tailReduction =
    ((data.unhedged.cvar_95 - data.hedged.cvar_95) / Math.max(Math.abs(data.unhedged.cvar_95), 1e-6)) * 100;

  refs.metrics.step2UnhedgedCvar.textContent = formatCurrency(data.unhedged.cvar_95);
  refs.metrics.step2HedgedCvar.textContent = formatCurrency(data.hedged.cvar_95);
  refs.metrics.step2UnhedgedMax.textContent = formatCurrency(data.unhedged.max_loss);
  refs.metrics.step2HedgedMax.textContent = formatCurrency(data.hedged.max_loss);
  refs.metrics.step2TailReduction.textContent = `${tailReduction.toFixed(1)}%`;
  setStepState("step2", "ready");
}

function renderStep3(data) {
  const metric = CURVE_METRICS[state.curveMetric];
  const regimes = data.liquidity_regimes ?? [];
  const medium = regimes.find((regime) => regime.id === "medium") ?? { curve_points: data.curve_points };
  const points = medium.curve_points;
  const lastPoint = points[points.length - 1];
  const bindingCount = points.filter((point) => point.liquidity_binding).length;

  refs.metrics.step3MetricValue.textContent = formatMetricValue(metric, metric.accessor(lastPoint));
  refs.metrics.step3HedgeRatio.textContent = `${(lastPoint.requested_hedge_fraction * 100).toFixed(0)}%`;
  refs.metrics.step3BindingCount.textContent = `${bindingCount}/${points.length}`;

  window.Plotly.react(
    refs.plots.step3,
    regimes.map((regime) => ({
        x: regime.curve_points.map((point) => point.liability),
        y: regime.curve_points.map((point) => metric.accessor(point)),
        type: "scatter",
        mode: "lines+markers",
        name: regime.label,
        line: {
          color: regime.id === "low" ? "#e8ae52" : regime.id === "medium" ? "#5bc6c4" : "#8ab4ff",
          width: regime.id === "medium" ? 3 : 2,
        },
        marker: {
          size: regime.id === "medium" ? 9 : 7,
          color: regime.curve_points.map((point) => (point.liquidity_binding ? "#e8ae52" : "#5bc6c4")),
          line: { width: 1, color: "#0a0e1a" },
        },
        hovertemplate:
          "Liability: %{x:$,.0f}<br>" +
          `${metric.label}: %{y:${metric.hover}}<br>` +
          "Requested hedge: %{customdata:.0%}<extra></extra>",
        customdata: regime.curve_points.map((point) => point.requested_hedge_fraction),
      })),
    {
      ...baseLayout("Deterministic Hedge Capacity Curve", "Sportsbook liability", metric.axis),
      annotations: [
        zoneLabel("Meaningful hedging", 0.16),
        zoneLabel("Partial hedging", 0.5),
        zoneLabel("No effective hedging", 0.84),
      ],
      yaxis: {
        title: metric.axis,
        tickformat: state.curveMetric === "effective_fraction" ? ",.0f" : "$,.0f",
        gridcolor: "rgba(156, 171, 205, 0.1)",
        zeroline: false,
      },
      xaxis: {
        title: "Sportsbook liability ($)",
        tickformat: "$,.0f",
        gridcolor: "rgba(156, 171, 205, 0.08)",
        zeroline: false,
      },
    },
    { displayModeBar: false, responsive: true },
  );

  setStepState("step3", "ready");
}

function renderHistogram({ host, title, primaryName, primaryColor, primary, secondaryName, secondaryColor, secondary, annotationLabel, annotationValue }) {
  const traces = [
    {
      x: primary.bin_mids,
      y: primary.counts,
      type: "bar",
      name: primaryName,
      marker: { color: primaryColor, opacity: 0.62 },
      hovertemplate: `${primaryName}<br>P&L: %{x:$,.2f}<br>Paths: %{y}<extra></extra>`,
    },
  ];

  if (secondary) {
    traces.push({
      x: secondary.bin_mids,
      y: secondary.counts,
      type: "bar",
      name: secondaryName,
      marker: { color: secondaryColor, opacity: 0.58 },
      hovertemplate: `${secondaryName}<br>P&L: %{x:$,.2f}<br>Paths: %{y}<extra></extra>`,
    });
  }

  const maxCount = Math.max(...primary.counts, ...(secondary?.counts ?? [0]));
  const annotations = [
    {
      x: annotationValue,
      y: maxCount * 0.9,
      text: annotationLabel,
      showarrow: true,
      arrowhead: 4,
      ax: 24,
      ay: -38,
      font: { color: "#edf2ff", family: "IBM Plex Mono, monospace", size: 11 },
      arrowcolor: primaryColor,
      bgcolor: "rgba(10, 14, 26, 0.78)",
      bordercolor: "rgba(146, 166, 198, 0.22)",
    },
  ];

  if (secondary) {
    annotations.push({
      x: secondary.cvar_95,
      y: maxCount * 0.66,
      text: `${secondaryName} CVaR-95`,
      showarrow: true,
      arrowhead: 4,
      ax: -24,
      ay: -28,
      font: { color: "#edf2ff", family: "IBM Plex Mono, monospace", size: 11 },
      arrowcolor: secondaryColor,
      bgcolor: "rgba(10, 14, 26, 0.78)",
      bordercolor: "rgba(146, 166, 198, 0.22)",
    });
  }

  window.Plotly.react(
    host,
    traces,
    {
      ...baseLayout(title, "P&L outcome", "Path count"),
      barmode: secondary ? "overlay" : "relative",
      xaxis: {
        title: "P&L outcome ($)",
        tickformat: "$,.0f",
        gridcolor: "rgba(156, 171, 205, 0.08)",
        zeroline: false,
      },
      yaxis: {
        title: "Path count",
        gridcolor: "rgba(156, 171, 205, 0.08)",
        zeroline: false,
      },
      annotations,
    },
    { displayModeBar: false, responsive: true },
  );
}

function renderStaticStep1(preset) {
  renderStaticDistribution({
    host: refs.plots.step1,
    title: "Unhedged P&L Distribution",
    bins: preset.step1.bins,
    primaryName: "Unhedged",
    primaryValues: preset.step1.unhedged_density,
    primaryColor: "#e8ae52",
    annotationValue: preset.step1.cvar95_m,
    annotationLabel: "Tail exposure",
  });

  refs.metrics.step1Ev.textContent = formatCurrencyMillions(preset.step1.ev_m);
  refs.metrics.step1Cvar.textContent = formatCurrencyMillions(preset.step1.cvar95_m);
  refs.metrics.step1Max.textContent = formatCurrencyMillions(preset.step1.max_loss_m);
  setStepState("step1", "ready");
}

function renderStaticStep2(preset) {
  renderStaticDistribution({
    host: refs.plots.step2,
    title: "Hedged vs. Unhedged Overlay",
    bins: preset.step2.bins,
    primaryName: "Unhedged",
    primaryValues: preset.step2.unhedged_density,
    primaryColor: "#e8ae52",
    secondaryName: "Hedged",
    secondaryValues: preset.step2.hedged_density,
    secondaryColor: "#5bc6c4",
    annotationValue: preset.step2.cvar95_hedged_m,
    annotationLabel: "CVaR-95 shift",
  });

  refs.metrics.step2UnhedgedCvar.textContent = formatCurrencyMillions(preset.step2.cvar95_unhedged_m);
  refs.metrics.step2HedgedCvar.textContent = formatCurrencyMillions(preset.step2.cvar95_hedged_m);
  refs.metrics.step2UnhedgedMax.textContent = formatCurrencyMillions(preset.step2.max_loss_unhedged_m);
  refs.metrics.step2HedgedMax.textContent = formatCurrencyMillions(preset.step2.max_loss_hedged_m);
  refs.metrics.step2TailReduction.textContent = `${preset.step2.tail_reduction_pct.toFixed(1)}%`;
  setStepState("step2", "ready");
}

function renderStaticStep3(preset) {
  const metric = CURVE_METRICS[state.curveMetric];
  const liabilities = preset.step3.liabilities_m.map((value) => value * 1_000_000);
  const regimes = buildRegimeCurves(liabilities, preset.meta.target_hedge_ratio, preset.meta.liquidity_usd);
  renderPresetCurve(regimes, metric);
  const medium = regimes.find((regime) => regime.id === "medium");
  const points = medium ? medium.curve_points : [];
  const lastPoint = points[points.length - 1];
  refs.metrics.step3MetricValue.textContent = formatMetricValue(metric, metric.accessor(lastPoint));
  refs.metrics.step3HedgeRatio.textContent = `${Math.round(lastPoint.requested_hedge_fraction * 100)}%`;
  refs.metrics.step3BindingCount.textContent = `${points.filter((point) => point.liquidity_binding).length}/${points.length}`;
  setStepState("step3", "ready");
}

function renderStaticDistribution({ host, title, bins, primaryName, primaryValues, primaryColor, secondaryName, secondaryValues, secondaryColor, annotationValue, annotationLabel }) {
  const traces = [
    {
      x: bins,
      y: primaryValues,
      type: "scatter",
      mode: "lines",
      name: primaryName,
      line: { color: primaryColor, width: 3 },
      fill: "tozeroy",
      fillcolor: `${primaryColor}33`,
      hovertemplate: `${primaryName}<br>P&L: %{x:.0f}M<br>Density: %{y:.2f}<extra></extra>`,
    },
  ];

  if (secondaryValues && secondaryName && secondaryColor) {
    traces.push({
      x: bins,
      y: secondaryValues,
      type: "scatter",
      mode: "lines",
      name: secondaryName,
      line: { color: secondaryColor, width: 3 },
      fill: "tozeroy",
      fillcolor: `${secondaryColor}29`,
      hovertemplate: `${secondaryName}<br>P&L: %{x:.0f}M<br>Density: %{y:.2f}<extra></extra>`,
    });
  }

  window.Plotly.react(
    host,
    traces,
    {
      ...baseLayout(title, "P&L outcome (USD, millions)", "Density"),
      annotations: [
        {
          x: annotationValue,
          y: Math.max(...primaryValues) * 0.9,
          text: annotationLabel,
          showarrow: true,
          arrowhead: 4,
          ax: 24,
          ay: -38,
          font: { color: "#edf2ff", family: "IBM Plex Mono, monospace", size: 11 },
          arrowcolor: primaryColor,
          bgcolor: "rgba(10, 14, 26, 0.78)",
          bordercolor: "rgba(146, 166, 198, 0.22)",
        },
      ],
    },
    { displayModeBar: false, responsive: true },
  );
}

function renderPresetCurve(regimes, metric) {
  window.Plotly.react(
    refs.plots.step3,
    regimes.map((regime) => ({
        x: regime.curve_points.map((point) => point.liability / 1_000_000),
        y: regime.curve_points.map((point) =>
          state.curveMetric === "effective_fraction" ? metric.accessor(point) : metric.accessor(point) / 1_000_000),
        type: "scatter",
        mode: "lines+markers",
        name: regime.label,
        line: {
          color: regime.id === "low" ? "#e8ae52" : regime.id === "medium" ? "#5bc6c4" : "#8ab4ff",
          width: regime.id === "medium" ? 3 : 2,
        },
        marker: {
          size: 9,
          color: regime.curve_points.map((point) => (point.liquidity_binding ? "#e8ae52" : "#5bc6c4")),
          line: { width: 1, color: "#0a0e1a" },
        },
        hovertemplate:
          "Liability: %{x:.0f}M<br>" +
          `${metric.label}: %{y:${state.curveMetric === "effective_fraction" ? ".1f" : ".1f"}}${state.curveMetric === "effective_fraction" ? "%" : "M"}<br>` +
          "Requested hedge: %{customdata:.0%}<extra></extra>",
        customdata: regime.curve_points.map((point) => point.requested_hedge_fraction),
      })),
    {
      ...baseLayout("Deterministic Hedge Capacity Curve", "Sportsbook liability (USD, millions)", state.curveMetric === "effective_fraction" ? "Effective hedge fraction (%)" : `${metric.label} (USD, millions)`),
      annotations: [
        zoneLabel("Meaningful hedging", 0.16),
        zoneLabel("Partial hedging", 0.5),
        zoneLabel("No effective hedging", 0.84),
      ],
      yaxis: {
        title: state.curveMetric === "effective_fraction" ? "Effective hedge fraction (%)" : `${metric.label} (USD, millions)`,
        tickformat: state.curveMetric === "effective_fraction" ? ",.0f" : ",.1f",
        gridcolor: "rgba(156, 171, 205, 0.1)",
        zeroline: false,
      },
      xaxis: {
        title: "Sportsbook liability (USD, millions)",
        tickformat: ",.0f",
        gridcolor: "rgba(156, 171, 205, 0.08)",
        zeroline: false,
      },
    },
    { displayModeBar: false, responsive: true },
  );
}

function baseLayout(title, xTitle, yTitle) {
  return {
    title: { text: title, font: { family: "DM Serif Display, serif", size: 24, color: "#edf2ff" } },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 56, r: 24, t: 54, b: 52 },
    font: { family: "IBM Plex Mono, monospace", color: "#edf2ff", size: 12 },
    legend: {
      orientation: "h",
      x: 0,
      y: 1.12,
      bgcolor: "rgba(0,0,0,0)",
      font: { family: "IBM Plex Mono, monospace", color: "#9cabca", size: 11 },
    },
    xaxis: {
      title: xTitle,
      color: "#9cabca",
      tickcolor: "rgba(146, 166, 198, 0.22)",
      titlefont: { family: "IBM Plex Mono, monospace", size: 12, color: "#9cabca" },
    },
    yaxis: {
      title: yTitle,
      color: "#9cabca",
      tickcolor: "rgba(146, 166, 198, 0.22)",
      titlefont: { family: "IBM Plex Mono, monospace", size: 12, color: "#9cabca" },
    },
  };
}

function updateCurveCardFromCache() {
  const data = state.cache.get(getStep3CacheKey(state.strategy));
  if (data) {
    renderStep3(data);
    return true;
  }
  return false;
}

function updateAllChartsFromCache() {
  const baseline = state.cache.get("step1:baseline");
  const step2 = state.cache.get(getStep2CacheKey(state.strategy));
  const step3 = state.cache.get(getStep3CacheKey(state.strategy));

  if (baseline) renderStep1(baseline);
  if (step2) renderStep2(step2);
  if (step3) renderStep3(step3);
}

function setStepState(step, status) {
  const plot = refs.plots[step];
  const skeleton = refs.skeletons[step];
  const error = refs.errors[step];
  if (!plot || !skeleton || !error) {
    return;
  }

  applyViewState({ plot, skeleton, error }, status);
}

function goToStep(index) {
  const nextIndex = Math.max(0, Math.min(index, refs.steps.length - 1));
  state.activeStep = nextIndex;
  refs.deck.scrollTo({ top: refs.steps[nextIndex].offsetTop, behavior: "smooth" });
  updateControlUi();
}

function syncStepFromScroll() {
  const deckRect = refs.deck.getBoundingClientRect();
  const deckMidpoint = deckRect.top + deckRect.height / 2;
  let candidate = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  refs.steps.forEach((step, index) => {
    const rect = step.getBoundingClientRect();
    const midpointDistance = Math.abs(rect.top + rect.height / 2 - deckMidpoint);
    if (midpointDistance < bestDistance) {
      candidate = index;
      bestDistance = midpointDistance;
    }
  });

  if (candidate !== state.activeStep) {
    state.activeStep = candidate;
    updateControlUi();
  }
}

function updateControlUi() {
  refs.back.disabled = state.activeStep === 0;
  refs.next.disabled = state.activeStep === refs.steps.length - 1;
  refs.metricSelect.value = state.curveMetric;
  refs.seedNote.textContent = `Seed superbowl_v1 · 500 paths · Strategy ${STRATEGY_LABELS[state.strategy]}`;

  refs.stepDots.forEach((button, index) => {
    button.classList.toggle("active", index === state.activeStep);
  });

  refs.strategyButtons.forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-strategy") === state.strategy);
  });
}

function buildZoneShapes(values) {
  const maxValue = Math.max(...values, 1);
  return [
    zoneRect(0, maxValue / 3, "rgba(50, 143, 114, 0.18)"),
    zoneRect(maxValue / 3, (maxValue * 2) / 3, "rgba(214, 170, 79, 0.16)"),
    zoneRect((maxValue * 2) / 3, maxValue, "rgba(156, 69, 76, 0.16)"),
  ];
}

function zoneRect(y0, y1, color) {
  return {
    type: "rect",
    xref: "paper",
    yref: "y",
    x0: 0,
    x1: 1,
    y0,
    y1,
    fillcolor: color,
    line: { width: 0 },
    layer: "below",
  };
}

function zoneLabel(text, yPosition) {
  return {
    xref: "paper",
    yref: "paper",
    x: 0.02,
    y: 1 - yPosition,
    text,
    showarrow: false,
    font: { family: "IBM Plex Mono, monospace", size: 11, color: "#9cabca" },
    bgcolor: "rgba(10, 14, 26, 0.35)",
  };
}

function resetMetricText() {
  Object.values(refs.metrics).forEach((node) => {
    if (node) {
      node.textContent = "—";
    }
  });
}

function resetStepTwoThreeMetrics() {
  for (const key of [
    "step2UnhedgedCvar",
    "step2HedgedCvar",
    "step2UnhedgedMax",
    "step2HedgedMax",
    "step2TailReduction",
    "step3MetricValue",
    "step3HedgeRatio",
    "step3BindingCount",
  ]) {
    refs.metrics[key].textContent = "—";
  }
}

function formatCurrency(value) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  });
  return formatter.format(value);
}

function formatCurrencyMillions(value) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(1)}M`;
}

function debounce(fn, waitMs) {
  let timer = 0;
  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(), waitMs);
  };
}

function normalizeError(error) {
  if (error instanceof ApiError) {
    if (error.kind === "validation") {
      return `Simulation request rejected: ${error.message}`;
    }
    return error.message;
  }
  return "Unable to load live simulation data.";
}

function formatMetricValue(metric, value) {
  if (metric === CURVE_METRICS.effective_fraction) {
    return `${value.toFixed(0)}%`;
  }
  return formatCurrency(value);
}
