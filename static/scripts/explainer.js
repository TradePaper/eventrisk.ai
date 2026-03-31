const COLORS = {
  low: "#4e79a7",
  medium: "#f28e2b",
  high: "#59a14f",
};

const LIABILITY_STEPS_F1 = Array.from({ length: 10 }, (_, index) => (index + 1) * 20);
const LIABILITY_STEPS_F2 = Array.from({ length: 41 }, (_, index) => index * 5);
const LIABILITY_STEPS_F3 = Array.from({ length: 17 }, (_, index) => 40 + index * 10);
const BINS_F4 = Array.from({ length: 31 }, (_, index) => -150 + index * 10);
const EVS_F5 = Array.from({ length: 21 }, (_, index) => index);

document.addEventListener("DOMContentLoaded", () => {
  const refs = buildRefs();
  const charts = initializeCharts(refs);
  bindControls(refs, charts);
  syncAll(refs, charts);
});

function buildRefs() {
  return {
    scaleSlider: document.getElementById("scaleSlider"),
    scaleVal: document.getElementById("scaleVal"),
    kLowSlider: document.getElementById("kLowSlider"),
    kLowVal: document.getElementById("kLowVal"),
    kMedSlider: document.getElementById("kMedSlider"),
    kMedVal: document.getElementById("kMedVal"),
    kHighSlider: document.getElementById("kHighSlider"),
    kHighVal: document.getElementById("kHighVal"),
    hedgeSlider: document.getElementById("hedgeSlider"),
    hedgeVal: document.getElementById("hedgeVal"),
    liquiditySelect: document.getElementById("liquiditySelect"),
    depthSlider: document.getElementById("depthSlider"),
    depthVal: document.getElementById("depthVal"),
    tableUnhedgedEv: document.getElementById("tableUnhedgedEv"),
    tableUnhedgedWcl: document.getElementById("tableUnhedgedWcl"),
    tableUnhedgedMax: document.getElementById("tableUnhedgedMax"),
    tableShallowEv: document.getElementById("tableShallowEv"),
    tableShallowWcl: document.getElementById("tableShallowWcl"),
    tableShallowMax: document.getElementById("tableShallowMax"),
    tableDeepEv: document.getElementById("tableDeepEv"),
    tableDeepWcl: document.getElementById("tableDeepWcl"),
    tableDeepMax: document.getElementById("tableDeepMax"),
  };
}

function initializeCharts() {
  return {
    chart1: createFigure1Chart(),
    chart2: createFigure2Chart(),
    chart3: createFigure3Chart(),
    chart4: createFigure4Chart(),
    chart5: createFigure5Chart(),
  };
}

function bindControls(refs, charts) {
  refs.scaleSlider.addEventListener("input", () => syncFigure1(refs, charts.chart1));
  refs.kLowSlider.addEventListener("input", () => syncFigure2(refs, charts.chart2));
  refs.kMedSlider.addEventListener("input", () => syncFigure2(refs, charts.chart2));
  refs.kHighSlider.addEventListener("input", () => syncFigure2(refs, charts.chart2));
  refs.hedgeSlider.addEventListener("input", () => syncFigure3(refs, charts.chart3));
  refs.liquiditySelect.addEventListener("change", () => syncFigure4(refs, charts.chart4));
  refs.depthSlider.addEventListener("input", () => syncFigure5(refs, charts.chart5));
}

function syncAll(refs, charts) {
  syncFigure1(refs, charts.chart1);
  syncFigure2(refs, charts.chart2);
  syncFigure3(refs, charts.chart3);
  syncFigure4(refs, charts.chart4);
  syncFigure5(refs, charts.chart5);
}

// Figure 1 — Sportsbook Hedging Feasibility Map
// The map is built from three deterministic boundaries. As liability grows,
// the minimum liquidity needed to move from "no effective hedging" to
// "partial" and then "meaningful" hedging scales upward proportionally.
// The slider multiplies those boundaries to show how overall market depth
// shifts the zone cutoffs without changing the basic geometry.
function createFigure1Chart() {
  return new Chart(document.getElementById("chart1"), {
    type: "line",
    data: {
      labels: LIABILITY_STEPS_F1,
      datasets: [
        {
          label: "No effective hedging",
          data: [],
          borderColor: "rgba(220,80,80,0)",
          backgroundColor: "rgba(220,80,80,0.25)",
          pointRadius: 0,
          borderWidth: 0,
          fill: "origin",
          tension: 0.2,
        },
        {
          label: "Partial hedging",
          data: [],
          borderColor: "rgba(251,180,43,0)",
          backgroundColor: "rgba(251,180,43,0.25)",
          pointRadius: 0,
          borderWidth: 0,
          fill: "-1",
          tension: 0.2,
        },
        {
          label: "Meaningful hedging",
          data: [],
          borderColor: "rgba(89,161,79,0)",
          backgroundColor: "rgba(89,161,79,0.25)",
          pointRadius: 0,
          borderWidth: 0,
          fill: "-1",
          tension: 0.2,
        },
      ],
    },
    options: lineOptions("Sportsbook Liability ($M)", "Event-Market Liquidity ($M)", {
      scales: {
        x: {
          title: { display: true, text: "Sportsbook Liability ($M)" },
        },
        y: {
          min: 0,
          max: 120,
          title: { display: true, text: "Event-Market Liquidity ($M)" },
        },
      },
    }),
  });
}

function syncFigure1(refs, chart) {
  const scale = Number(refs.scaleSlider.value);
  refs.scaleVal.textContent = scale.toFixed(1);
  chart.data.datasets[0].data = LIABILITY_STEPS_F1.map((x) => round2(0.08 * scale * x));
  chart.data.datasets[1].data = LIABILITY_STEPS_F1.map((x) => round2(0.5 * scale * x));
  chart.data.datasets[2].data = LIABILITY_STEPS_F1.map(() => 120);
  chart.update();
}

// Figure 2 — LCERT Curve
// Each curve uses exponential decay: h(L) = exp(-L/k)
// k is the "liquidity depth" parameter. Higher k = slower decay = more of the
// exposure remains hedgeable at larger liability sizes.
// The sliders let the user shift each k independently to see how market depth
// changes each curve's slope and persistence.
function createFigure2Chart() {
  return new Chart(document.getElementById("chart2"), {
    type: "line",
    data: {
      labels: LIABILITY_STEPS_F2,
      datasets: [
        curveDataset("Low liquidity", COLORS.low),
        curveDataset("Medium liquidity", COLORS.medium),
        curveDataset("High liquidity", COLORS.high),
      ],
    },
    options: lineOptions("Sportsbook Liability ($M)", "Hedgeable Fraction of Exposure", {
      scales: {
        x: {
          title: { display: true, text: "Sportsbook Liability ($M)" },
        },
        y: {
          min: 0,
          max: 1,
          title: { display: true, text: "Hedgeable Fraction of Exposure" },
        },
      },
    }),
  });
}

function syncFigure2(refs, chart) {
  const kLow = Number(refs.kLowSlider.value);
  const kMed = Number(refs.kMedSlider.value);
  const kHigh = Number(refs.kHighSlider.value);

  refs.kLowVal.textContent = String(kLow);
  refs.kMedVal.textContent = String(kMed);
  refs.kHighVal.textContent = String(kHigh);

  chart.data.datasets[0].data = LIABILITY_STEPS_F2.map((liability) => round4(Math.exp(-liability / kLow)));
  chart.data.datasets[1].data = LIABILITY_STEPS_F2.map((liability) => round4(Math.exp(-liability / kMed)));
  chart.data.datasets[2].data = LIABILITY_STEPS_F2.map((liability) => round4(Math.exp(-liability / kHigh)));
  chart.update();
}

// Figure 3 — Sportsbook Risk Profile Under Hedging
// Each line starts from the same unhedged sportsbook loss slope and then
// applies a deterministic hedge-efficiency multiplier. Shallow liquidity
// only trims a small portion of downside, while deep liquidity produces a
// materially larger compression as the hedge ratio increases.
// The table below converts the same hedge ratio into fixed summary metrics at
// a representative liability level of $100M.
function createFigure3Chart() {
  return new Chart(document.getElementById("chart3"), {
    type: "line",
    data: {
      labels: LIABILITY_STEPS_F3,
      datasets: [
        curveDataset("Unhedged", COLORS.low),
        curveDataset("Shallow hedge", COLORS.medium),
        curveDataset("Deep hedge", COLORS.high),
      ],
    },
    options: lineOptions("Sportsbook Liability ($M)", "Profit / Loss ($M)", {
      scales: {
        x: {
          title: { display: true, text: "Sportsbook Liability ($M)" },
        },
        y: {
          min: -130,
          max: 0,
          title: { display: true, text: "Profit / Loss ($M)" },
        },
      },
    }),
  });
}

function syncFigure3(refs, chart) {
  const hedgeRatio = Number(refs.hedgeSlider.value);
  refs.hedgeVal.textContent = hedgeRatio.toFixed(2);

  chart.data.datasets[0].data = LIABILITY_STEPS_F3.map((liability) => round2(-0.66 * liability));
  chart.data.datasets[1].data = LIABILITY_STEPS_F3.map((liability) => round2(-0.66 * liability * (1 - 0.05 * hedgeRatio)));
  chart.data.datasets[2].data = LIABILITY_STEPS_F3.map((liability) => round2(-0.66 * liability * (1 - 0.27 * hedgeRatio)));
  chart.update();

  refs.tableUnhedgedEv.textContent = formatSignedMillions(-66);
  refs.tableUnhedgedWcl.textContent = formatSignedMillions(-120);
  refs.tableUnhedgedMax.textContent = formatSignedMillions(-130);

  refs.tableShallowEv.textContent = formatSignedMillions(-66 * (1 - 0.05 * hedgeRatio));
  refs.tableShallowWcl.textContent = formatSignedMillions(-120 * (1 - 0.02 * hedgeRatio));
  refs.tableShallowMax.textContent = formatSignedMillions(-130 * (1 - 0.08 * hedgeRatio));

  refs.tableDeepEv.textContent = formatSignedMillions(-66 * (1 - 0.10 * hedgeRatio));
  refs.tableDeepWcl.textContent = formatSignedMillions(-120 * (1 - 0.23 * hedgeRatio));
  refs.tableDeepMax.textContent = formatSignedMillions(-130 * (1 - 0.32 * hedgeRatio));
}

// Figure 4 — Tail-Risk Compression from Event-Market Hedging
// The two distributions are deterministic normal PDFs evaluated at fixed
// bin midpoints. The unhedged distribution stays fixed, while the hedged
// distribution narrows as the selected liquidity regime improves.
// Lower standard deviation means the left tail is pulled inward and extreme
// loss outcomes become less dense.
function createFigure4Chart() {
  return new Chart(document.getElementById("chart4"), {
    type: "bar",
    data: {
      labels: BINS_F4,
      datasets: [
        {
          label: "Unhedged",
          data: BINS_F4.map((bin) => round6(normalPdf(bin, -20, 60))),
          backgroundColor: "rgba(78,121,167,0.6)",
          barPercentage: 1,
          categoryPercentage: 1,
        },
        {
          label: "Hedged",
          data: [],
          backgroundColor: "rgba(89,161,79,0.6)",
          barPercentage: 1,
          categoryPercentage: 1,
        },
      ],
    },
    options: barOptions("P&L Bin ($M)", "Density"),
  });
}

function syncFigure4(refs, chart) {
  const adjustedStd = Number(refs.liquiditySelect.value);
  chart.data.datasets[1].data = BINS_F4.map((bin) => round6(normalPdf(bin, -18, adjustedStd)));
  chart.update();
}

// Figure 5 — Hedging Efficiency Frontier
// The frontier is a simple linear tradeoff between expected value sacrificed
// and tail-risk reduction. The shallow frontier improves at a lower rate,
// while the deep frontier gains more tail protection per unit of EV cost.
// The market-depth multiplier scales both frontiers together so users can see
// how stronger depth pushes the efficient boundary outward.
function createFigure5Chart() {
  return new Chart(document.getElementById("chart5"), {
    type: "line",
    data: {
      labels: EVS_F5,
      datasets: [
        curveDataset("Shallow", COLORS.medium),
        curveDataset("Deep", COLORS.high),
      ],
    },
    options: lineOptions("Expected Value Sacrificed (M)", "Tail-Risk Reduction (M)", {
      scales: {
        x: {
          min: 0,
          max: 20,
          title: { display: true, text: "Expected Value Sacrificed (M)" },
        },
        y: {
          min: 0,
          max: 25,
          title: { display: true, text: "Tail-Risk Reduction (M)" },
        },
      },
    }),
  });
}

function syncFigure5(refs, chart) {
  const multiplier = Number(refs.depthSlider.value);
  refs.depthVal.textContent = multiplier.toFixed(1);
  chart.data.datasets[0].data = EVS_F5.map((evs) => round2(0.5 * multiplier * evs));
  chart.data.datasets[1].data = EVS_F5.map((evs) => round2(1.25 * multiplier * evs));
  chart.update();
}

function curveDataset(label, color) {
  return {
    label,
    data: [],
    borderColor: color,
    backgroundColor: color,
    borderWidth: 3,
    pointRadius: 0,
    tension: 0.25,
  };
}

function lineOptions(xLabel, yLabel, overrides = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: {
        labels: {
          color: getTextColor(),
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: xLabel, color: getTextColor() },
        ticks: { color: getMutedColor() },
        grid: { color: getGridColor() },
      },
      y: {
        title: { display: true, text: yLabel, color: getTextColor() },
        ticks: { color: getMutedColor() },
        grid: { color: getGridColor() },
      },
    },
    ...overrides,
  };
}

function barOptions(xLabel, yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: getTextColor(),
        },
      },
    },
    scales: {
      x: {
        stacked: false,
        title: { display: true, text: xLabel, color: getTextColor() },
        ticks: { color: getMutedColor() },
        grid: { color: getGridColor() },
      },
      y: {
        title: { display: true, text: yLabel, color: getTextColor() },
        ticks: { color: getMutedColor() },
        grid: { color: getGridColor() },
      },
    },
  };
}

function normalPdf(x, mean, std) {
  const coefficient = 1 / (std * Math.sqrt(2 * Math.PI));
  const exponent = -0.5 * Math.pow((x - mean) / std, 2);
  return coefficient * Math.exp(exponent);
}

function formatSignedMillions(value) {
  const rounded = Math.round(value * 100) / 100;
  if (rounded < 0) {
    return `-$${Math.abs(rounded)}M`;
  }
  return `$${rounded}M`;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function round6(value) {
  return Math.round(value * 1000000) / 1000000;
}

function getTextColor() {
  return document.body.classList.contains("light") ? "#1f2937" : "#edf2ff";
}

function getMutedColor() {
  return document.body.classList.contains("light") ? "rgba(31,41,55,0.72)" : "rgba(237,242,255,0.72)";
}

function getGridColor() {
  return document.body.classList.contains("light") ? "rgba(15,23,42,0.1)" : "rgba(255,255,255,0.08)";
}
