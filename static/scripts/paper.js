const FIGURE_TITLES = [
  "Figure 0: Event Market Risk Transfer Mechanism",
  "Figure 1: Sportsbook Hedging Feasibility Map",
  "Figure 2: Liquidity-Constrained Risk Transfer Curve",
  "Figure 3: Sportsbook Risk Profile Under Hedging",
  "Figure 4: Tail-Risk Compression",
  "Figure 5: Hedging Efficiency Frontier"
];

const PRESETS = {
  superbowl: "/lib/presets/superbowl.json",
  election: "/lib/presets/election.json",
  weather: "/lib/presets/weather.json"
};

let presetButtons = [];
let listEl = null;
let stickyTitle = null;
let stickyCaption = null;

let activePreset = "superbowl";
let currentObserver = null;

const FIGURE_DESCRIPTIONS = [
  "Mechanism view of how sportsbook exposure interacts with event-market depth and residual downside.",
  "Canonical feasibility zoning for sportsbook hedge capacity under preset liquidity constraints.",
  "Transfer curve showing how hedging effectiveness changes as liability scales through finite depth.",
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
    cardMarkup(index, title, FIGURE_DESCRIPTIONS[index], `${title} summary`)
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

function renderFigures(data) {
  renderFigure0(data);
  renderFigure1(data);
  renderFigure2(data);
  renderFigure3(data);
  renderFigure4(data);
  renderFigure5(data);
}

async function loadPreset(presetKey) {
  const res = await fetch(PRESETS[presetKey]);
  const data = await res.json();

  activePreset = presetKey;
  presetButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.preset === presetKey));

  stickyTitle.textContent = FIGURE_TITLES[0];
  stickyCaption.textContent = `Preset: ${data.name} · Static figure set`;
  buildCards(data);
  requestAnimationFrame(() => renderFigures(data));
}

function bootPaper() {
  presetButtons = Array.from(document.querySelectorAll(".preset-btn"));
  listEl = document.getElementById("figureList");
  stickyTitle = document.getElementById("currentFigure");
  stickyCaption = document.getElementById("currentCaption");

  if (!listEl || !stickyTitle || !stickyCaption || typeof window.Plotly?.react !== "function") {
    console.error("[paper] chart runtime unavailable");
    return;
  }

  presetButtons.forEach((btn) => btn.addEventListener("click", () => loadPreset(btn.dataset.preset)));
  void loadPreset(activePreset);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootPaper, { once: true });
} else {
  bootPaper();
}

function renderFigure0(data) {
  const plotEl = document.getElementById("paperFigure1");
  const lastPoint = data.step3.points[data.step3.points.length - 1];
  // FLAG: the bundled preset data does not include the paper's original Figure 0 graphic,
  // so this renders a qualitative mechanism diagram using only shipped preset metadata.
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
        <strong>${formatUsdMillions(lastPoint.tail_risk_hedged_m)}</strong>
        <small>${Math.round(lastPoint.hedge_utilization * 100)}% utilization at the largest liability point</small>
      </div>
    </div>
  `;

  setSummary(1, [
    metric("Event market", data.meta.event, `Seed ${data.meta.seed}`),
    metric("Book liability", formatMillions(data.meta.stake_usd / 1_000_000), `${formatCount(data.meta.simulation_count)} static simulations`),
    metric("Depth available", formatMillions(data.meta.liquidity_usd / 1_000_000), `${Math.round(data.meta.target_hedge_ratio * 100)}% hedge target`),
    metric("Residual tail", formatUsdMillions(lastPoint.tail_risk_hedged_m), `${Math.round(lastPoint.hedge_utilization * 100)}% utilization at scale`),
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
      hovertemplate: "Utilization %{y}%<br>Liability %{x}M<br>%{text}<extra></extra>",
      text: heatmap.labels,
    }],
    {
      ...baseLayout("Liability (USD, millions)", "Hedge utilization (%)"),
      margin: { l: 64, r: 26, t: 26, b: 56 },
      annotations: heatmap.annotations,
    },
    PLOT_CONFIG,
  );

  setSummary(2, [
    metric("Meaningful cells", String(heatmap.counts.green), "Green-zone feasibility"),
    metric("Partial cells", String(heatmap.counts.yellow), "Yellow-zone feasibility"),
    metric("Constrained cells", String(heatmap.counts.red), "Red-zone feasibility"),
    metric("Thresholds", `${Math.round(data.step3.zones.green_max_utilization * 100)}% / ${Math.round(data.step3.zones.yellow_max_utilization * 100)}%`, "Green / yellow cutoffs"),
  ]);
  setCallout(2, "Figure 1 uses the bundled liability ladder and utilization cutoffs to show where sportsbook hedging remains meaningful, partial, or fully constrained.");
}

function renderFigure2(data) {
  const plotEl = document.getElementById("paperFigure3");
  const points = data.step3.points;

  window.Plotly.react(
    plotEl,
    [
      {
        x: points.map((point) => point.liability_m),
        y: points.map((point) => point.tail_risk_unhedged_m),
        type: "scatter",
        mode: "lines+markers",
        name: "Unhedged EWCL",
        line: { color: PAPER_COLORS.amber, width: 3 },
        marker: { size: 8 },
      },
      {
        x: points.map((point) => point.liability_m),
        y: points.map((point) => point.tail_risk_hedged_m),
        type: "scatter",
        mode: "lines+markers",
        name: "Hedged EWCL",
        line: { color: PAPER_COLORS.teal, width: 3 },
        marker: { size: 8 },
      },
      {
        x: points.map((point) => point.liability_m),
        y: points.map((point) => point.hedge_utilization * 100),
        type: "scatter",
        mode: "lines+markers",
        name: "Utilization",
        yaxis: "y2",
        line: { color: PAPER_COLORS.inkSoft, width: 2, dash: "dot" },
        marker: { size: 7 },
      },
    ],
    {
      ...baseLayout("Liability (USD, millions)", "EWCL (USD, millions)"),
      legend: legendLayout(),
      yaxis2: {
        title: "Utilization (%)",
        overlaying: "y",
        side: "right",
        gridcolor: "rgba(0,0,0,0)",
        color: PAPER_COLORS.inkSoft,
        ticksuffix: "%",
      },
    },
    PLOT_CONFIG,
  );

  const maxReduction = Math.max(...points.map((point) => point.tail_risk_unhedged_m - point.tail_risk_hedged_m));
  setSummary(3, [
    metric("Curve points", String(points.length), `${points[0].liability_m}M to ${points[points.length - 1].liability_m}M liability`),
    metric("Peak reduction", formatUsdMillions(maxReduction), "Best static point improvement"),
    metric("Zone ceiling", `${Math.round(data.step3.zones.yellow_max_utilization * 100)}%`, "Upper partial-feasibility threshold"),
    metric("Max utilization", `${Math.round(points[points.length - 1].hedge_utilization * 100)}%`, "Final liability point"),
  ]);
  setCallout(3, "Figure 2 keeps the canonical risk-transfer curve in static form so each preset shows how liability growth pushes the hedge toward liquidity bounds.");
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

function renderFigure5(data) {
  const plotEl = document.getElementById("paperFigure6");
  const frontier = buildFrontierSeries(data);
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
    metric("Shallow peak", formatUsdMillions(shallowPeak.tailReduction), "Higher slippage, lower depth"),
    metric("Deep peak", formatUsdMillions(deepPeak.tailReduction), "More transfer before saturation"),
    metric("Frontier sweep", `${frontier.shallow.length} ratios`, "0% to 100% hedge ratio"),
    metric("Base penalty", formatUsdMillions(Math.abs(data.step2.ev_hedged_m - data.step2.ev_unhedged_m)), "Used for static EV-cost scaling"),
  ]);
  setCallout(6, "Figure 5 preserves the existing static frontier construction so the paper view still shows the EV-versus-tail tradeoff without any new backend contract.");
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

function buildFrontierSeries(data) {
  const basePenalty = Math.abs(data.step2.ev_hedged_m - data.step2.ev_unhedged_m);
  const baseReduction = Math.abs(data.step2.cvar95_unhedged_m - data.step2.cvar95_hedged_m);
  const ratios = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];

  return {
    shallow: ratios.map((ratio) => ({
      evSacrifice: round1(basePenalty * (0.52 + ratio * 1.06) * ratio),
      tailReduction: round1(baseReduction * Math.pow(ratio, 0.78) * 0.82),
    })),
    deep: ratios.map((ratio) => ({
      evSacrifice: round1(basePenalty * (0.34 + ratio * 0.82) * ratio),
      tailReduction: round1(baseReduction * (1 - Math.pow(1 - ratio, 1.45)) * 1.06),
    })),
  };
}

function buildFeasibilityHeatmap(data) {
  const liabilities = data.step3.points.map((point) => point.liability_m);
  const utilizationLevels = [20, 35, 50, 65, 80, 95];
  const greenMax = Math.round(data.step3.zones.green_max_utilization * 100);
  const yellowMax = Math.round(data.step3.zones.yellow_max_utilization * 100);
  const z = [];
  const labels = [];
  const counts = { green: 0, yellow: 0, red: 0 };

  utilizationLevels.forEach((level) => {
    const row = [];
    const labelRow = [];
    liabilities.forEach((liability, index) => {
      const point = data.step3.points[index];
      const buffer = level - Math.round(point.hedge_utilization * 100);
      let zone = "red";
      let value = 0;
      if (level <= greenMax && buffer <= 10) {
        zone = "green";
        value = 2;
      } else if (level <= yellowMax && buffer <= 18) {
        zone = "yellow";
        value = 1;
      }
      row.push(value);
      labelRow.push(zone === "green" ? "Meaningful Hedging" : zone === "yellow" ? "Partial Hedging" : "Constrained");
      counts[zone] += 1;
    });
    z.push(row);
    labels.push(labelRow);
  });

  return {
    x: liabilities,
    y: utilizationLevels,
    z,
    labels,
    counts,
    annotations: [
      axisNote(`Green <= ${greenMax}%`, 0.05),
      axisNote(`Partial <= ${yellowMax}%`, 0.18),
    ],
  };
}

function buildSnapshotSeries(data) {
  return {
    labels: ["Stake", "Liquidity", "Hedge Target", "Tail Reduction"],
    values: [
      normalizePct(data.meta.stake_usd / 2_000_000),
      normalizePct(data.meta.liquidity_usd / 300_000),
      round1(data.meta.target_hedge_ratio * 100),
      round1(data.step2.tail_reduction_pct),
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

function normalizePct(value) {
  return Math.max(8, Math.min(100, round1(value)));
}

function round1(value) {
  return Number(value.toFixed(1));
}
