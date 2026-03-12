// @ts-check

import { buildRegimeCurves } from "/static/scripts/hedge-capacity.mjs";
import { applyViewState } from "/static/scripts/view-state.mjs";
import { CANONICAL_EXPLAINER_SCENARIO, EXPLAINER_STATIC_DATA } from "/static/scripts/explainer-static-data.mjs";

const STRATEGY_LABELS = {
  external_hedge: "External Hedge",
  internal_reprice: "Internal Reprice",
  hybrid: "Hybrid",
};
const CAPACITY_METRIC = {
  label: "Effective Hedge Fraction",
  accessor: (point) => point.effective_hedge_fraction * 100,
  axis: "Hedgeable fraction of exposure (%)",
  hover: ".1f",
};
const state = {
  activeStep: 0,
  strategy: "external_hedge",
};

const refs = {
  deck: /** @type {HTMLElement} */ (document.getElementById("snapDeck")),
  back: /** @type {HTMLButtonElement} */ (document.getElementById("btnBack")),
  next: /** @type {HTMLButtonElement} */ (document.getElementById("btnNext")),
  seedNote: document.getElementById("seedNote"),
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
  bindEvents();
  updateControlUi();
  resetMetricText();
  renderStaticScenario(state.strategy);
}

function bindEvents() {
  refs.back.addEventListener("click", () => goToStep(state.activeStep - 1));
  refs.next.addEventListener("click", () => goToStep(state.activeStep + 1));

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
      renderStaticScenario(strategy);
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

function renderStaticScenario(strategy) {
  const scenario = EXPLAINER_STATIC_DATA[strategy] ?? CANONICAL_EXPLAINER_SCENARIO;
  renderStaticStep1(scenario);
  renderStaticStep2(scenario);
  renderStaticStep3(scenario);
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
  const liabilities = preset.step3.liabilities_m.map((value) => value * 1_000_000);
  const regimes = buildRegimeCurves(liabilities, preset.meta.target_hedge_ratio, preset.meta.liquidity_usd);
  renderPresetCurve(regimes);
  const medium = regimes.find((regime) => regime.id === "medium");
  const points = medium ? medium.curve_points : [];
  const lastPoint = points[points.length - 1];
  const bindingCount = points.filter((point) => point.liquidity_binding).length;
  refs.metrics.step3MetricValue.textContent = `${Math.round(lastPoint.requested_hedge_fraction * 100)}%`;
  refs.metrics.step3HedgeRatio.textContent = `${Math.round(lastPoint.effective_hedge_fraction * 100)}%`;
  refs.metrics.step3BindingCount.textContent = bindingCount > 0 ? `Yes (${bindingCount}/${points.length})` : "No";
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

function renderPresetCurve(regimes) {
  window.Plotly.react(
    refs.plots.step3,
    regimes.map((regime) => ({
        x: regime.curve_points.map((point) => point.liability / 1_000_000),
        y: regime.curve_points.map((point) => CAPACITY_METRIC.accessor(point)),
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
          `${CAPACITY_METRIC.label}: %{y:.1f}%<br>` +
          "Requested hedge: %{customdata[0]:.0%}<br>" +
          "Effective hedge: %{customdata[1]:.0%}<extra></extra>",
        customdata: regime.curve_points.map((point) => [point.requested_hedge_fraction, point.effective_hedge_fraction]),
      })),
    {
      ...baseLayout("Deterministic Hedge Capacity Curve", "Sportsbook liability (USD, millions)", "Hedgeable fraction of exposure (%)"),
      annotations: [
        zoneLabel("Meaningful hedging", 0.16),
        zoneLabel("Partial hedging", 0.5),
        zoneLabel("No effective hedging", 0.84),
      ],
      yaxis: {
        title: "Hedgeable fraction of exposure (%)",
        tickformat: ",.0f",
        gridcolor: "rgba(156, 171, 205, 0.1)",
        zeroline: false,
        range: [0, 100],
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

function updateAllChartsFromCache() {
  renderStaticScenario(state.strategy);
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
  refs.seedNote.textContent = `Seed superbowl_v1 · Paper-calibrated liability $136M · Strategy ${STRATEGY_LABELS[state.strategy]}`;

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
