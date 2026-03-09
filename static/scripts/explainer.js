const PAPER_URL = "https://eventrisk.ai/paper";
const PRESETS = {
  superbowl: "/lib/presets/superbowl.json",
  election: "/lib/presets/election.json",
  weather: "/lib/presets/weather.json"
};

const deck = document.getElementById("snapDeck");
const dots = Array.from(document.querySelectorAll(".dot"));
const stepEls = Array.from(document.querySelectorAll(".snap-step"));
const backBtn = document.getElementById("btnBack");
const nextBtn = document.getElementById("btnNext");
const presetButtons = Array.from(document.querySelectorAll(".preset-btn"));
const metaLine = document.getElementById("metaLine");
const ctaPaper = document.getElementById("ctaPaper");

let activeStep = 0;
let activePreset = "superbowl";
let activeData = null;

function readVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function fmtMoneyMillions(v) {
  return `$${Number(v).toFixed(1)}M`;
}

function updateStepUi() {
  dots.forEach((dot, idx) => dot.classList.toggle("active", idx === activeStep));
  backBtn.disabled = activeStep === 0;
  nextBtn.disabled = activeStep === stepEls.length - 1;
}

function goToStep(index) {
  activeStep = Math.max(0, Math.min(index, stepEls.length - 1));
  stepEls[activeStep].scrollIntoView({ behavior: "smooth", block: "start" });
  updateStepUi();
}

function pathFromSeries(xVals, yVals, width, height, maxY) {
  const left = 42;
  const right = width - 18;
  const top = 16;
  const bottom = height - 26;
  const innerW = right - left;
  const innerH = bottom - top;
  return xVals.map((x, i) => {
    const px = left + (i / Math.max(1, xVals.length - 1)) * innerW;
    const py = bottom - (yVals[i] / maxY) * innerH;
    return `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`;
  }).join(" ");
}

function renderDistribution(containerId, bins, firstSeries, secondSeries) {
  const host = document.getElementById(containerId);
  const width = host.clientWidth || 860;
  const height = 340;
  const maxY = Math.max(...firstSeries, ...(secondSeries || [0])) * 1.1;
  const axisColor = readVar("--color-border");
  const unhedgedColor = readVar("--color-alert-red");
  const hedgedColor = readVar("--color-alert-green");

  const unhedgedPath = pathFromSeries(bins, firstSeries, width, height, maxY);
  const hedgedPath = secondSeries ? pathFromSeries(bins, secondSeries, width, height, maxY) : "";

  host.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="Distribution chart">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      <line x1="42" y1="16" x2="42" y2="314" stroke="${axisColor}" stroke-width="1"></line>
      <line x1="42" y1="314" x2="${width - 18}" y2="314" stroke="${axisColor}" stroke-width="1"></line>
      <path d="${unhedgedPath}" fill="none" stroke="${unhedgedColor}" stroke-width="3"></path>
      ${secondSeries ? `<path d="${hedgedPath}" fill="none" stroke="${hedgedColor}" stroke-width="3"></path>` : ""}
      <text x="48" y="26" font-size="12" fill="${readVar("--color-ink-soft")}">P&amp;L density</text>
      <text x="${width - 130}" y="330" font-size="12" fill="${readVar("--color-ink-soft")}">Outcome bin (USD M)</text>
      <text x="46" y="48" font-size="11" fill="${unhedgedColor}">Unhedged</text>
      ${secondSeries ? `<text x="130" y="48" font-size="11" fill="${hedgedColor}">Hedged</text>` : ""}
    </svg>
  `;
}

function renderRiskTransfer(points) {
  const host = document.getElementById("step3Chart");
  const width = host.clientWidth || 860;
  const height = 360;
  const axisColor = readVar("--color-border");
  const inkSoft = readVar("--color-ink-soft");
  const greenSoft = readVar("--color-alert-green-soft");
  const yellowSoft = readVar("--color-alert-yellow-soft");
  const redSoft = readVar("--color-alert-red-soft");
  const red = readVar("--color-alert-red");
  const green = readVar("--color-alert-green");

  const left = 52;
  const right = width - 22;
  const top = 20;
  const bottom = height - 34;
  const innerW = right - left;
  const innerH = bottom - top;

  const maxL = Math.max(...points.map(p => p.liability_m));
  const maxR = Math.max(...points.map(p => p.tail_risk_unhedged_m)) * 1.08;

  function px(liability) {
    return left + (liability / maxL) * innerW;
  }
  function py(risk) {
    return bottom - (risk / maxR) * innerH;
  }

  const unhedged = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.liability_m)},${py(p.tail_risk_unhedged_m)}`).join(" ");
  const hedged = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.liability_m)},${py(p.tail_risk_hedged_m)}`).join(" ");

  const circles = points.map((p) => {
    const color = p.feasibility === "green" ? readVar("--color-alert-green") : p.feasibility === "yellow" ? readVar("--color-alert-yellow") : readVar("--color-alert-red");
    return `<circle cx="${px(p.liability_m)}" cy="${py(p.tail_risk_hedged_m)}" r="4.5" fill="${color}"></circle>`;
  }).join("");

  host.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="Risk transfer curve">
      <rect x="${left}" y="${top}" width="${innerW}" height="${innerH / 3}" fill="${greenSoft}"></rect>
      <rect x="${left}" y="${top + innerH / 3}" width="${innerW}" height="${innerH / 3}" fill="${yellowSoft}"></rect>
      <rect x="${left}" y="${top + (innerH * 2) / 3}" width="${innerW}" height="${innerH / 3}" fill="${redSoft}"></rect>
      <line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="${axisColor}" stroke-width="1"></line>
      <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${axisColor}" stroke-width="1"></line>
      <path d="${unhedged}" fill="none" stroke="${red}" stroke-width="3"></path>
      <path d="${hedged}" fill="none" stroke="${green}" stroke-width="3"></path>
      ${circles}
      <text x="${left + 8}" y="${top + 16}" font-size="11" fill="${inkSoft}">Green zone: meaningful hedge transfer</text>
      <text x="${left + 8}" y="${top + innerH / 3 + 16}" font-size="11" fill="${inkSoft}">Yellow zone: partial hedge transfer</text>
      <text x="${left + 8}" y="${top + (innerH * 2) / 3 + 16}" font-size="11" fill="${inkSoft}">Red zone: liquidity constrained</text>
      <text x="${right - 152}" y="${height - 10}" font-size="12" fill="${inkSoft}">Liability (USD M)</text>
      <text x="${left + 6}" y="${top + 28}" font-size="11" fill="${red}">Unhedged tail risk</text>
      <text x="${left + 130}" y="${top + 28}" font-size="11" fill="${green}">Hedged tail risk</text>
    </svg>
  `;
}

function renderMetrics(stepData, prefix) {
  document.getElementById(`${prefix}M1`).textContent = fmtMoneyMillions(stepData.ev_m ?? stepData.ev_unhedged_m);
  const cvar = stepData.cvar95_m ?? stepData.cvar95_unhedged_m;
  document.getElementById(`${prefix}M2`).textContent = fmtMoneyMillions(cvar);
  const max = stepData.max_loss_m ?? stepData.cvar95_hedged_m ?? cvar;
  document.getElementById(`${prefix}M3`).textContent = fmtMoneyMillions(max);
}

async function loadPreset(presetKey) {
  const res = await fetch(PRESETS[presetKey]);
  activeData = await res.json();
  activePreset = presetKey;

  presetButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.preset === presetKey));
  metaLine.textContent = `${activeData.meta.event} · Stake ${activeData.meta.stake_usd.toLocaleString()} · Sim count ${activeData.meta.simulation_count.toLocaleString()}`;
  ctaPaper.href = activeData.paper_url || PAPER_URL;

  renderDistribution("step1Chart", activeData.step1.bins, activeData.step1.unhedged_density);
  renderDistribution("step2Chart", activeData.step2.bins, activeData.step2.unhedged_density, activeData.step2.hedged_density);
  renderRiskTransfer(activeData.step3.points);

  renderMetrics(activeData.step1, "s1");
  renderMetrics(activeData.step2, "s2");
  document.getElementById("s2Tail").textContent = `${activeData.step2.tail_reduction_pct.toFixed(1)}%`;

  const maxPoint = activeData.step3.points[activeData.step3.points.length - 1];
  document.getElementById("s3M1").textContent = fmtMoneyMillions(maxPoint.tail_risk_unhedged_m);
  document.getElementById("s3M2").textContent = fmtMoneyMillions(maxPoint.tail_risk_hedged_m);
  document.getElementById("s3M3").textContent = `${(maxPoint.hedge_utilization * 100).toFixed(0)}%`;
}

presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => loadPreset(btn.dataset.preset));
});

backBtn.addEventListener("click", () => goToStep(activeStep - 1));
nextBtn.addEventListener("click", () => goToStep(activeStep + 1));

deck.addEventListener("scroll", () => {
  const top = deck.scrollTop;
  let idx = 0;
  for (let i = 0; i < stepEls.length; i += 1) {
    if (top >= stepEls[i].offsetTop - 120) idx = i;
  }
  if (idx !== activeStep) {
    activeStep = idx;
    updateStepUi();
  }
});

window.addEventListener("resize", () => {
  if (!activeData) return;
  renderDistribution("step1Chart", activeData.step1.bins, activeData.step1.unhedged_density);
  renderDistribution("step2Chart", activeData.step2.bins, activeData.step2.unhedged_density, activeData.step2.hedged_density);
  renderRiskTransfer(activeData.step3.points);
});

loadPreset(activePreset);
updateStepUi();
