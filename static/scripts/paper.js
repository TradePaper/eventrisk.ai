const FIGURE_TITLES = [
  "Figure 1 — Unhedged Liability Distribution",
  "Figure 2 — Hedged vs Unhedged Distribution Overlay",
  "Figure 3 — Liquidity-Constrained Risk Transfer Curve",
  "Figure 4 — Hedging Efficiency Frontier",
  "Figure 5 — Hedging Feasibility Map",
  "Figure 6 — Preset Stress-Test Snapshot"
];

const PRESETS = {
  superbowl: "/lib/presets/superbowl.json",
  election: "/lib/presets/election.json",
  weather: "/lib/presets/weather.json"
};

const presetButtons = Array.from(document.querySelectorAll(".preset-btn"));
const listEl = document.getElementById("figureList");
const stickyTitle = document.getElementById("currentFigure");
const stickyCaption = document.getElementById("currentCaption");

let activePreset = "superbowl";

function cardMarkup(title, description, notes) {
  return `
    <article class="figure-card" data-figure-title="${title}">
      <h3>${title}</h3>
      <p>${description}</p>
      <ul class="figure-notes">
        ${notes.map((n) => `<li>${n}</li>`).join("")}
      </ul>
    </article>
  `;
}

function buildCards(data) {
  const p3 = data.step3.points;
  const maxReduction = Math.max(...p3.map((p) => p.tail_risk_unhedged_m - p.tail_risk_hedged_m));
  const redCount = p3.filter((p) => p.feasibility === "red").length;
  const yellowCount = p3.filter((p) => p.feasibility === "yellow").length;
  const greenCount = p3.filter((p) => p.feasibility === "green").length;

  const cards = [
    {
      title: FIGURE_TITLES[0],
      description: "Full liability-outcome profile before hedge placement.",
      notes: [
        `Event: ${data.meta.event}`,
        `EV: ${data.step1.ev_m.toFixed(1)}M USD`,
        `CVaR(95): ${data.step1.cvar95_m.toFixed(1)}M USD`
      ]
    },
    {
      title: FIGURE_TITLES[1],
      description: "Overlay view shows left-tail compression after hedge execution.",
      notes: [
        `Tail reduction: ${data.step2.tail_reduction_pct.toFixed(1)}%`,
        `Hedged CVaR(95): ${data.step2.cvar95_hedged_m.toFixed(1)}M USD`,
        `Unhedged CVaR(95): ${data.step2.cvar95_unhedged_m.toFixed(1)}M USD`
      ]
    },
    {
      title: FIGURE_TITLES[2],
      description: "Risk-transfer curve under finite liquidity and feasibility zoning.",
      notes: [
        `Curve points: ${p3.length}`,
        `Peak tail-risk reduction: ${maxReduction.toFixed(1)}M USD`,
        `Max utilization: ${(p3[p3.length - 1].hedge_utilization * 100).toFixed(0)}%`
      ]
    },
    {
      title: FIGURE_TITLES[3],
      description: "Efficiency frontier emphasizing EV sacrificed versus tail-risk reduction.",
      notes: [
        "Shallow and deep liquidity frontier representations",
        "Hedge ratio sweep from 0% to 100%",
        "Static/precomputed rendering for narrative stability"
      ]
    },
    {
      title: FIGURE_TITLES[4],
      description: "Feasibility map grouped into red/yellow/green operating zones.",
      notes: [
        `Green cells: ${greenCount}`,
        `Yellow cells: ${yellowCount}`,
        `Red cells: ${redCount}`
      ]
    },
    {
      title: FIGURE_TITLES[5],
      description: "Cross-preset static snapshot for scenario comparison.",
      notes: [
        `Stake: ${(data.meta.stake_usd / 1000000).toFixed(0)}M USD`,
        `Market price: ${data.meta.market_price.toFixed(2)}`,
        `Scenario tag: ${data.id}`
      ]
    }
  ];

  listEl.innerHTML = cards.map((c) => cardMarkup(c.title, c.description, c.notes)).join("");

  const cardsEls = Array.from(document.querySelectorAll(".figure-card"));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        stickyTitle.textContent = entry.target.dataset.figureTitle;
        stickyCaption.textContent = `Preset: ${data.name} · Static figure set`;
      }
    });
  }, { rootMargin: "-35% 0px -55% 0px", threshold: 0.01 });

  cardsEls.forEach((el) => observer.observe(el));
}

async function loadPreset(presetKey) {
  const res = await fetch(PRESETS[presetKey]);
  const data = await res.json();

  activePreset = presetKey;
  presetButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.preset === presetKey));

  stickyTitle.textContent = FIGURE_TITLES[0];
  stickyCaption.textContent = `Preset: ${data.name} · Static figure set`;
  buildCards(data);
}

presetButtons.forEach((btn) => btn.addEventListener("click", () => loadPreset(btn.dataset.preset)));
loadPreset(activePreset);
