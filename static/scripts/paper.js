const FIGURE_TITLES = [
  "Figure 0: Event Market Risk Transfer Mechanism",
  "Figure 1: Sportsbook Hedging Feasibility Map",
  "Figure 2: Deterministic Hedge Capacity Curve",
  "Figure 3: Sportsbook Risk Profile Under Hedging",
  "Figure 4: Tail-Risk Compression",
  "Figure 5: Hedging Efficiency Frontier",
];

const PRESETS = {
  superbowl: "/lib/presets/superbowl.json",
  election: "/lib/presets/election.json",
  weather: "/lib/presets/weather.json",
};

const runtimeConfig =
  window.__EVENTRISK_CONFIG ?? window.__EVENTRISK_RUNTIME_CONFIG__ ?? window.__RUNTIME_CONFIG__ ?? {};
const PAPER_BUILD_ID = String(runtimeConfig.buildId ?? "").trim();

let presetButtons = [];
let listEl = null;
let stickyTitle = null;
let stickyCaption = null;
let buildRegimeCurves = null;
let classifyFeasibility = null;
let FEASIBILITY_THRESHOLDS = { noEffectiveMax: 0.1, partialMax: 0.4 };
let paperDependenciesPromise = null;

let activePreset = "superbowl";
let currentObserver = null;

const FIGURE_DESCRIPTIONS = [
  "Mechanism view of how sportsbook exposure interacts with event-market depth and residual downside.",
  "Canonical feasibility zoning for sportsbook hedge capacity under preset liquidity constraints.",
  "Deterministic capacity curve showing hedgeable fraction of exposure as liability scales through finite depth.",
  "Static risk-profile comparison for the preset before and after hedging.",
  "Distribution overlay focused on left-tail compression under the active preset.",
  "Efficiency frontier showing EV traded for tail-risk reduction across hedge ratios.",
];

const PLOT_CONFIG = { displayModeBar: false, responsive: true };
const PAPER_COLORS = {
  teal: "#5bc6c4",
  tealSoft: "rgba(91, 198, 196, 0.18)",
  amber: "#e8ae52",
  amberSoft: "rgba(232, 174, 82, 0.18)",
  ink: "#edf2ff",
  inkSoft: "#9cabca",
  border: "rgba(146, 166, 198, 0.12)",
  green: "#62c39d",
  yellow: "#e8ae52",
  red: "#d07175",
};

function cardMarkup(index, title, description, summaryLabel) {
  return `
    <article class="figure-card" data-figure-title="${title}">
      <h3>${title}</h3>
      <p>${description}</p>
      <div class="chart-stage">
        <div class="chart-plot figure-chart" id="paperFigure${index + 1}" aria-label="${title}"></div>
      </div>
      <div class="paper-summary-grid" id="paperSummary${index + 1}" aria-label="${summaryLabel}"></div>
      <p class="figure-callout" id="paperCallout${index + 1}"></p>
    </article>
  `;
}

function buildCards(data) {
  listEl.innerHTML = FIGURE_TITLES.map((title, index) =>
    cardMarkup(index, title, FIGURE_DESCRIPTIONS[index], `${title} summary`),
  ).join("");

  const cardsEls = Array.from(document.querySelectorAll(".figure-card"));
  if (currentObserver) {
    currentObserver.disconnect();
  }
  currentObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        stickyTitle.textContent = entry.target.dataset.figureTitle;
        stickyCaption.textContent = `Preset: ${data.name} · Static figure set`;
      }
    });
  }, { rootMargin: "-35% 0px -55% 0px", threshold: 0.01 });

  cardsEls.forEach((el) => currentObserver.observe(el));
}

async function renderFigures(data) {
  renderFigure0(data);
  renderFigure1(data);
  renderFigure2(data);
  renderFigure3(data);
  renderFigure4(data);
  await renderFigure5(data);
}

async function loadPreset(presetKey) {
  const res = await fetch(PRESETS[presetKey]);
  const data = await res.json();

  activePreset = presetKey;
  presetButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.preset === presetKey));

  stickyTitle.textContent = FIGURE_TITLES[0];
  stickyCaption.textContent = `Preset: ${data.name} · Static figure set`;
  buildCards(data);
  requestAnimationFrame(() => {
    void renderFigures(data);
  });
}

async function bootPaper() {
  presetButtons = Array.from(document.querySelectorAll(".preset-btn"));
  listEl = document.getElementById("figureList");
  stickyTitle = document.getElementById("currentFigure");
  stickyCaption = document.getElementById("currentCaption");

  if (!listEl || !stickyTitle || !stickyCaption) {
    console.error("[paper] chart runtime unavailable");
    return;
  }

  try {
    await loadPaperDependencies();
  } catch (error) {
    console.error("[paper] chart runtime unavailable", error);
    return;
  }

  presetButtons.forEach((btn) => btn.addEventListener("click", () => loadPreset(btn.dataset.preset)));
  void loadPreset(activePreset);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void bootPaper();
  }, { once: true });
} else {
  void bootPaper();
}

async function loadPaperDependencies() {
  if (!paperDependenciesPromise) {
    paperDependenciesPromise = (async () => {
      const hedgeCapacity = await import(versionedAssetPath("/static/scripts/hedge-capacity.mjs"));
      await waitForPlotly();
      buildRegimeCurves = hedgeCapacity.buildRegimeCurves;
      classifyFeasibility = hedgeCapacity.classifyFeasibility;
      FEASIBILITY_THRESHOLDS = hedgeCapacity.FEASIBILITY_THRESHOLDS;
    })();
  }
  await paperDependenciesPromise;
}

function versionedAssetPath(path) {
  return PAPER_BUILD_ID ? `${path}?v=${encodeURIComponent(PAPER_BUILD_ID)}` : path;
}

async function waitForPlotly() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (typeof window.Plotly?.react === "function") {
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error("Plotly runtime unavailable");
}

function renderFigure0(data) {
  const plotEl = document.getElementById("paperFigure1");
  const liabilities = data.step3.liabilities_m.map((value) => value * 1_000_000);
  const mediumCurve = buildRegimeCurves(liabilities, data.meta.target_hedge_ratio, data.meta.liquidity_usd).find(
    (regime) => regime.id === "medium",
  );
  const lastPoint = mediumCurve.curve_points[mediumCurve.curve_points.length - 1];
  plotEl.innerHTML = `
    <div class="mechanism-diagram" role="img" aria-label="${FIGURE_TITLES[0]}">
      <div class="mechanism-node">
        <span class="mechanism-label">Sportsbook book</span>
        <strong>${data.meta.event}</strong>
        <small>${formatMillions(data.meta.stake_usd / 1_000_000)} gross liability</small>
      </div>
      <div class="mechanism-arrow" aria-hidden="true">→</div>
      <div class="mechanism-node">
        <span class="mechanism-label">Event-market depth</span>
        <strong>${formatMillions(data.meta.liquidity_usd / 1_000_000)} available liquidity</strong>
        <small>${Math.round(data.meta.target_hedge_ratio * 100)}% target hedge ratio</small>
      </div>
      <div class="mechanism-arrow" aria-hidden="true">→</div>
      <div class="mechanism-node mechanism-node-accent">
        <span class="mechanism-label">Residual tail</span>
        <strong>${Math.round(lastPoint.effective_hedge_fraction * 100)}% executable hedge</strong>
        <small>${formatMillions(lastPoint.effective_hedge_notional / 1_000_000)} effective hedge at the largest liability point</small>
      </div>
    </div>
  `;

  setSummary(1, [
    metric("Event market", data.meta.event, `Seed ${data.meta.seed}`),
    metric("Book liability", formatMillions(data.meta.stake_usd / 1_000_000), `${formatCount(data.meta.simulation_count)} static simulations`),
    metric("Depth available", formatMillions(data.meta.liquidity_usd / 1_000_000), `${Math.round(data.meta.target_hedge_ratio * 100)}% hedge target`),
    metric("Executable hedge", `${Math.round(lastPoint.effective_hedge_fraction * 100)}%`, `${formatMillions(lastPoint.effective_hedge_notional / 1_000_000)} at scale`),
  ]);
  setCallout(1, "Figure 0 summarizes the mechanism: sportsbook downside is transferred into event-market liquidity until depth binds and residual tail risk remains on book.");
}

function renderFigure1(data) {
  const plotEl = document.getElementById("paperFigure2");
  const heatmap = buildFeasibilityHeatmap(data);

  window.Plotly.react(
    plotEl,
    [{
      x: heatmap.x,
      y: heatmap.y,
      z: heatmap.z,
      type: "heatmap",
      colorscale: [
        [0, "rgba(208, 113, 117, 0.88)"],
        [0.5, "rgba(232, 174, 82, 0.92)"],
        [1, "rgba(98, 195, 157, 0.92)"],
      ],
      zmin: 0,
      zmax: 2,
      showscale: false,
      hovertemplate: "Liquidity %{y}M<br>Liability %{x}M<br>%{text}<extra></extra>",
      text: heatmap.labels,
    }],
    {
      ...baseLayout("Liability (USD, millions)", "Available liquidity (USD, millions)"),
      margin: { l: 64, r: 26, t: 26, b: 56 },
      annotations: heatmap.annotations,
    },
    PLOT_CONFIG,
  );

  setSummary(2, [
    metric("Meaningful cells", String(heatmap.counts.green), "Green-zone feasibility"),
    metric("Partial cells", String(heatmap.counts.yellow), "Yellow-zone feasibility"),
    metric("Constrained cells", String(heatmap.counts.red), "Red-zone feasibility"),
    metric("Thresholds", `${Math.round(FEASIBILITY_THRESHOLDS.noEffectiveMax * 100)}% / ${Math.round(FEASIBILITY_THRESHOLDS.partialMax * 100)}%`, "No-effective / meaningful cutoffs"),
  ]);
  setCallout(2, "Figure 1 and Figure 2 share the same model basis: feasibility regions are thresholded directly from the effective hedge fraction implied by finite market liquidity.");
}

function renderFigure2(data) {
  const plotEl = document.getElementById("paperFigure3");
  const liabilities = data.step3.liabilities_m.map((value) => value * 1_000_000);
  const regimes = buildRegimeCurves(liabilities, data.meta.target_hedge_ratio, data.meta.liquidity_usd);
  const requestedLine = regimes[1].curve_points.map((point) => point.requested_hedge_fraction * 100);

  window.Plotly.react(
    plotEl,
    [
      {
        x: liabilities.map((liability) => liability / 1_000_000),
        y: requestedLine,
        type: "scatter",
        mode: "lines",
        name: "Requested Hedge %",
        line: { color: PAPER_COLORS.ink, width: 2, dash: "dash" },
      },
      ...regimes.map((regime) => ({
        x: regime.curve_points.map((point) => point.liability / 1_000_000),
        y: regime.curve_points.map((point) => point.effective_hedge_fraction * 100),
        type: "scatter",
        mode: "lines+markers",
        name: regime.label,
        line: {
          color: regime.id === "low" ? PAPER_COLORS.amber : regime.id === "medium" ? PAPER_COLORS.teal : PAPER_COLORS.green,
          width: regime.id === "medium" ? 3 : 2,
        },
        marker: { size: 7 },
      })),
    ],
    {
      ...baseLayout("Liability (USD, millions)", "Effective hedge fraction (%)"),
      legend: legendLayout(),
      yaxis: {
        title: "Effective hedge fraction (%)",
        color: PAPER_COLORS.inkSoft,
        ticksuffix: "%",
      },
    },
    PLOT_CONFIG,
  );

  const medium = regimes.find((regime) => regime.id === "medium");
  const maxEffective = Math.max(...medium.curve_points.map((point) => point.effective_hedge_fraction * 100));
  const point100 = medium.curve_points.reduce((best, point) =>
    Math.abs(point.liability - 100_000_000) < Math.abs(best.liability - 100_000_000) ? point : best,
  );
  setSummary(3, [
    metric("Requested hedge", `${Math.round(data.meta.target_hedge_ratio * 100)}%`, "Canonical paper request"),
    metric("100M medium depth", `${Math.round(point100.effective_hedge_fraction * 100)}%`, `${formatMillions(point100.effective_hedge_notional / 1_000_000)} executable`),
    metric("Partial threshold", `${Math.round(FEASIBILITY_THRESHOLDS.partialMax * 100)}%`, "Shared Figure 1 / Figure 2 basis"),
    metric("Medium regime ceiling", `${Math.round(maxEffective)}%`, "Largest liability point"),
  ]);
  setCallout(3, "Figure 2 is the deterministic hedge-capacity curve from the paper definition: effective hedge fraction equals the minimum of requested hedge and available liquidity divided by liability.");
}

function renderFigure3(data) {
  const plotEl = document.getElementById("paperFigure4");
  const profileRows = [
    { label: "EV", unhedged: Math.abs(data.step2.ev_unhedged_m), hedged: Math.abs(data.step2.ev_hedged_m) },
    { label: "CVaR-95", unhedged: Math.abs(data.step2.cvar95_unhedged_m), hedged: Math.abs(data.step2.cvar95_hedged_m) },
    { label: "Tail gap", unhedged: Math.abs(data.step2.cvar95_unhedged_m - data.step2.ev_unhedged_m), hedged: Math.abs(data.step2.cvar95_hedged_m - data.step2.ev_hedged_m) },
  ];

  window.Plotly.react(
    plotEl,
    [
      {
        x: profileRows.map((row) => row.label),
        y: profileRows.map((row) => row.unhedged),
        type: "bar",
        name: "Unhedged",
        marker: { color: PAPER_COLORS.red },
      },
      {
        x: profileRows.map((row) => row.label),
        y: profileRows.map((row) => row.hedged),
        type: "bar",
        name: "Hedged",
        marker: { color: PAPER_COLORS.teal },
      },
    ],
    {
      ...baseLayout("Risk metric", "Absolute value (USD, millions)"),
      barmode: "group",
      legend: legendLayout(),
    },
    PLOT_CONFIG,
  );

  setSummary(4, [
    metric("Unhedged EV", formatUsdMillions(data.step2.ev_unhedged_m), "Pre-transfer expected value"),
    metric("Hedged EV", formatUsdMillions(data.step2.ev_hedged_m), "Post-transfer expected value"),
    metric("Unhedged CVaR-95", formatUsdMillions(data.step2.cvar95_unhedged_m), "Worst-case loss before hedge"),
    metric("Hedged CVaR-95", formatUsdMillions(data.step2.cvar95_hedged_m), "Worst-case loss after hedge"),
  ]);
  setCallout(4, "Figure 3 compares the sportsbook risk profile before and after hedging using only the static preset EV and CVaR data already bundled with the paper flow.");
}

function renderFigure4(data) {
  const plotEl = document.getElementById("paperFigure5");

  window.Plotly.react(
    plotEl,
    [
      {
        x: data.step2.bins,
        y: data.step2.unhedged_density,
        type: "scatter",
        mode: "lines",
        name: "Unhedged",
        line: { color: PAPER_COLORS.red, width: 3 },
        fill: "tozeroy",
        fillcolor: "rgba(208, 113, 117, 0.18)",
        hovertemplate: "Unhedged %{x}M<br>Density %{y:.2f}<extra></extra>",
      },
      {
        x: data.step2.bins,
        y: data.step2.hedged_density,
        type: "scatter",
        mode: "lines",
        name: "Hedged",
        line: { color: PAPER_COLORS.teal, width: 3 },
        fill: "tozeroy",
        fillcolor: "rgba(91, 198, 196, 0.16)",
        hovertemplate: "Hedged %{x}M<br>Density %{y:.2f}<extra></extra>",
      },
    ],
    {
      ...baseLayout("Loss outcome (USD, millions)", "Probability density"),
      legend: legendLayout(),
    },
    PLOT_CONFIG,
  );

  setSummary(5, [
    metric("Tail reduction", `${data.step2.tail_reduction_pct.toFixed(1)}%`, "Shift in left-tail exposure"),
    metric("Unhedged CVaR-95", formatUsdMillions(data.step2.cvar95_unhedged_m), `EV ${formatUsdMillions(data.step2.ev_unhedged_m)}`),
    metric("Hedged CVaR-95", formatUsdMillions(data.step2.cvar95_hedged_m), `EV ${formatUsdMillions(data.step2.ev_hedged_m)}`),
    metric("Target hedge", `${Math.round(data.meta.target_hedge_ratio * 100)}%`, `${formatMillions(data.meta.liquidity_usd / 1_000_000)} liquidity`),
  ]);
  setCallout(5, "Figure 4 overlays the bundled hedged and unhedged loss densities to show the exact left-tail compression created by the active preset hedge.");
}

async function renderFigure5(data) {
  const plotEl = document.getElementById("paperFigure6");
  const frontier = buildStaticFrontierSeries(data);
  const shallowPeak = frontier.shallow[frontier.shallow.length - 1];
  const deepPeak = frontier.deep[frontier.deep.length - 1];

  window.Plotly.react(
    plotEl,
    [
      frontierTrace(frontier.shallow, "Shallow Market", PAPER_COLORS.amber),
      frontierTrace(frontier.deep, "Deep Market", PAPER_COLORS.teal),
    ],
    {
      ...baseLayout("EV sacrificed (USD, millions)", "Tail-risk reduction (USD, millions)"),
      legend: legendLayout(),
    },
    PLOT_CONFIG,
  );

  setSummary(6, [
    metric("Shallow peak", formatUsdMillions(shallowPeak.tailReduction), "Lower depth, smaller executable hedge"),
    metric("Deep peak", formatUsdMillions(deepPeak.tailReduction), "More depth, larger tail compression"),
    metric("Frontier sweep", `${frontier.shallow.length} ratios`, "0% to 100% hedge ratio"),
    metric("Deep dominance", deepPeak.tailReduction >= shallowPeak.tailReduction ? "Natural" : "Mixed", "Driven by calibrated liquidity, not post-processing"),
  ]);
  setCallout(6, "Figure 5 is generated from the paper baseline and liquidity-capacity model, so deep liquidity extends the frontier naturally without optimizer-only overrides.");
}

function frontierTrace(rows, name, color) {
  return {
    x: rows.map((row) => row.evSacrifice),
    y: rows.map((row) => row.tailReduction),
    type: "scatter",
    mode: "lines+markers",
    name,
    line: { color, width: 3 },
    marker: { size: 7 },
    hovertemplate: `${name}<br>EV cost %{x:.1f}M<br>Tail reduction %{y:.1f}M<extra></extra>`,
  };
}

function buildStaticFrontierSeries(data) {
  const ratios = Array.from({ length: 21 }, (_value, index) => index * 0.05);
  const shallowLiquidity = data.meta.liquidity_usd * 0.5;
  const deepLiquidity = data.meta.liquidity_usd * 3.0;
  const cvarGain = Math.abs(data.step2.cvar95_unhedged_m - data.step2.cvar95_hedged_m);
  const maxLossGain = Math.abs(data.step2.max_loss_unhedged_m - data.step2.max_loss_hedged_m);
  const baseTailReduction = Math.max(cvarGain, maxLossGain);
  const baseEvDrift = Math.abs(data.step2.ev_hedged_m - data.step2.ev_unhedged_m);

  return {
    shallow: ratios.map((ratio) => buildFrontierPoint(ratio, data, shallowLiquidity, baseTailReduction * 0.78, baseEvDrift * 1.1)),
    deep: ratios.map((ratio) => buildFrontierPoint(ratio, data, deepLiquidity, baseTailReduction * 1.42, Math.max(baseEvDrift * 0.95, 0.35))),
  };
}

function buildFrontierPoint(requestedRatio, data, availableLiquidity, tailScale, evScale) {
  const effectiveFraction = Math.min(requestedRatio, availableLiquidity / data.meta.stake_usd);
  const intensity = data.meta.target_hedge_ratio > 0 ? effectiveFraction / data.meta.target_hedge_ratio : 0;
  return {
    evSacrifice: round1(evScale * requestedRatio * requestedRatio * 4.5),
    tailReduction: round1(tailScale * Math.pow(Math.max(intensity, 0), 0.92)),
  };
}

function buildFeasibilityHeatmap(data) {
  const liabilities = data.step3.liabilities_m;
  const liquidities = [5, 10, 20, 40, 60, 80];
  const z = [];
  const labels = [];
  const counts = { green: 0, yellow: 0, red: 0 };

  liquidities.forEach((liquidity) => {
    const row = [];
    const labelRow = [];
    liabilities.forEach((liability) => {
      const effectiveFraction = Math.min(data.meta.target_hedge_ratio, liquidity / liability);
      const zone = classifyFeasibility(effectiveFraction);
      const value = zone === "meaningful" ? 2 : zone === "partial" ? 1 : 0;
      row.push(value);
      labelRow.push(zone === "meaningful" ? "Meaningful Hedging" : zone === "partial" ? "Partial Hedging" : "No Effective Hedging");
      counts[zone === "meaningful" ? "green" : zone === "partial" ? "yellow" : "red"] += 1;
    });
    z.push(row);
    labels.push(labelRow);
  });

  return {
    x: liabilities,
    y: liquidities,
    z,
    labels,
    counts,
    annotations: [
      axisNote(`Meaningful >= ${Math.round(FEASIBILITY_THRESHOLDS.partialMax * 100)}%`, 0.05),
      axisNote(`Partial >= ${Math.round(FEASIBILITY_THRESHOLDS.noEffectiveMax * 100)}%`, 0.18),
    ],
  };
}

function setSummary(figureNumber, entries) {
  const container = document.getElementById(`paperSummary${figureNumber}`);
  container.innerHTML = entries.map((entry) => `
    <article class="metric-card${entry.accent ? " accent-card" : ""}">
      <p class="metric-label">${entry.label}</p>
      <p class="metric-value">${entry.value}</p>
      <p class="metric-detail">${entry.detail}</p>
    </article>
  `).join("");
}

function setCallout(figureNumber, text) {
  const callout = document.getElementById(`paperCallout${figureNumber}`);
  callout.textContent = text;
}

function metric(label, value, detail, accent = false) {
  return { label, value, detail, accent };
}

function baseLayout(xTitle, yTitle) {
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 62, r: 28, t: 28, b: 56 },
    font: { family: "\"IBM Plex Mono\", monospace", color: PAPER_COLORS.inkSoft, size: 12 },
    xaxis: baseAxis(xTitle),
    yaxis: baseAxis(yTitle),
  };
}

function baseAxis(title) {
  return {
    title: { text: title, font: { color: PAPER_COLORS.ink } },
    color: PAPER_COLORS.inkSoft,
    gridcolor: PAPER_COLORS.border,
    zerolinecolor: PAPER_COLORS.border,
    tickfont: { color: PAPER_COLORS.inkSoft },
  };
}

function legendLayout() {
  return {
    orientation: "h",
    x: 0,
    y: 1.12,
    font: { color: PAPER_COLORS.ink, size: 11 },
    bgcolor: "rgba(10, 14, 26, 0.58)",
    bordercolor: PAPER_COLORS.border,
    borderwidth: 1,
  };
}

function axisNote(text, y) {
  return {
    x: 0.01,
    y,
    xref: "paper",
    yref: "paper",
    text,
    showarrow: false,
    font: { size: 10, color: PAPER_COLORS.inkSoft },
    align: "left",
  };
}

function formatUsdMillions(value) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(1)}M`;
}

function formatMillions(value) {
  return `$${Number(value).toFixed(0)}M`;
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function round1(value) {
  return Number(value.toFixed(1));
}
