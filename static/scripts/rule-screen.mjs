// @ts-check
// Screening logic for the proposed § 40.11 framework (RIN 3038-AF65, June 10, 2026).
// Pure functions are exported for testing; DOM wiring is at the bottom.

import { buildCapacityPoint, classifyFeasibility } from "./hedge-capacity.mjs";

export const SAFE_LIST_CATEGORIES = ["econ", "fin", "fx", "election", "awards"];

const SAFE_LIST_LABELS = {
  econ: "economic indicators",
  fin: "financial indicators",
  fx: "foreign exchange rates or currencies",
  election: "election results and political activities",
  awards: "honor and award contests",
};

/**
 * Log-scale depth slider: 0–100 maps to $0.5M–$250M.
 * @param {number} sliderValue
 */
export function depthFromSlider(sliderValue) {
  const minM = 0.5;
  const maxM = 250;
  const t = Math.min(100, Math.max(0, sliderValue)) / 100;
  return minM * Math.pow(maxM / minM, t) * 1e6;
}

/**
 * @param {object} state
 * @param {string} state.refCategory
 * @param {boolean} state.involveTest
 * @param {boolean[]} state.gamingPrimary   three elements of proposed § 40.11(b)
 * @param {boolean[]} state.gamingAlternative two elements of the alternative definition
 * @param {boolean} state.enumUnlawful
 * @param {boolean} state.enumTAW
 * @param {number} state.posCount
 * @param {number} state.negCount
 * @param {number} state.concernCount
 * @param {string} state.hedgerClass        identified | plausible | none
 * @param {number} state.liability          dollars
 * @param {number} state.depthNow           dollars
 * @param {number} state.depthMature        dollars
 * @param {number} state.hedgeFraction      0..1
 */
export function assessContract(state) {
  const result = {
    scope: "in_scope",
    safeListLabel: "",
    involvesGamingPrimary: false,
    involvesGamingAlternative: false,
    involvesOther: false,
    triggered: false,
    hedgingNow: null,
    hedgingMature: null,
    overall: "outside",
    notes: [],
  };

  if (SAFE_LIST_CATEGORIES.includes(state.refCategory)) {
    result.scope = "safe_list";
    result.safeListLabel = SAFE_LIST_LABELS[state.refCategory] || state.refCategory;
    result.overall = "outside";
    result.notes.push(
      `Reference category (${result.safeListLabel}) appears on the proposal's illustrative list of contracts generally outside the Special Rule.`,
      "Generally applicable listing standards still apply, including that the contract not be readily susceptible to manipulation.",
    );
    return result;
  }

  const gamingPrimary = state.involveTest && state.gamingPrimary.every(Boolean);
  const gamingAlternative = state.involveTest && state.gamingAlternative.every(Boolean);
  const other = state.involveTest && (state.enumUnlawful || state.enumTAW);

  result.involvesGamingPrimary = gamingPrimary;
  result.involvesGamingAlternative = gamingAlternative;
  result.involvesOther = other;
  result.triggered = gamingPrimary || gamingAlternative || other;

  if (!state.involveTest) {
    result.overall = "outside";
    result.notes.push(
      "Settlement is not determined by an occurrence or contingency in an enumerated activity, so the contract does not “involve” an enumerated activity under proposed § 40.11(a)(3).",
    );
    return result;
  }

  if (!result.triggered) {
    result.overall = "outside";
    result.notes.push(
      "The underlying activity does not satisfy either proposed definition of gaming and no other enumerated activity applies; the Special Rule's public interest review is not triggered.",
    );
    return result;
  }

  if (gamingPrimary !== gamingAlternative) {
    result.notes.push(
      gamingPrimary
        ? "The activity is gaming under the primary definition but not the alternative structural definition — a definitional boundary case worth flagging in any submission."
        : "The activity is gaming under the alternative structural definition but not the primary definition — a definitional boundary case worth flagging in any submission.",
    );
  }

  const now = buildCapacityPoint(state.liability, state.hedgeFraction, state.depthNow);
  const mature = buildCapacityPoint(state.liability, state.hedgeFraction, state.depthMature);
  result.hedgingNow = { ...now, classification: classifyFeasibility(now.effective_hedge_fraction) };
  result.hedgingMature = { ...mature, classification: classifyFeasibility(mature.effective_hedge_fraction) };

  const hedgingSupportive =
    state.hedgerClass !== "none" && result.hedgingMature.classification !== "no_effective";

  if (hedgingSupportive) {
    result.notes.push(
      state.hedgerClass === "identified"
        ? "An identified commercial hedger class with non-trivial hedge capacity at foreseeable depth supports a “reasonable potential for a hedging function” — a significant factor against an adverse public interest finding under proposed § 40.11(a)(5)(i)."
        : "A plausible hedger class with non-trivial capacity at foreseeable depth lends some support under § 40.11(a)(5)(i); identifying the class with specificity would strengthen the file.",
    );
    if (result.hedgingNow.classification === "no_effective") {
      result.notes.push(
        "Hedge capacity is liquidity-bound at listing-day depth. Under the paper's market-formation analysis (speculators → market makers → institutions → hedgers), early absence of observed hedging is expected and is not evidence of structural incapacity.",
      );
    }
  } else if (state.hedgerClass === "none") {
    result.notes.push(
      "No identifiable hedger class: the contract creates rather than transfers risk, so the hedging-utility factor provides no support; the public interest case must rest on information value and market-integrity architecture.",
    );
  } else {
    result.notes.push(
      "Hedge capacity remains below the effectiveness threshold even at foreseeable mature depth; the hedging-utility factor provides little support at this liability/depth profile.",
    );
  }

  if (state.posCount > 0) {
    result.notes.push(
      `${state.posCount} of 6 gaming-specific positive factors present (§ 40.11(a)(6)(iii)(A)).`,
    );
  }
  if (state.negCount > 0) {
    result.notes.push(
      `${state.negCount} of 6 gaming-specific negative factors present (§ 40.11(a)(6)(iii)(B)) — each weighs in favor of a contrary-to-public-interest finding.`,
    );
  }
  if (state.concernCount > 0) {
    result.notes.push(
      `${state.concernCount} general concern(s) flagged under § 40.11(a)(5)(ii)–(iii).`,
    );
  }

  const weakProfile = state.negCount >= 2 || (state.negCount >= 1 && state.posCount <= 2);
  const strongProfile =
    state.negCount === 0 && state.posCount >= 4 && hedgingSupportive && state.concernCount <= 1;

  if (weakProfile || (!hedgingSupportive && state.posCount <= 2)) {
    result.overall = "high";
  } else if (strongProfile) {
    result.overall = "lower";
  } else {
    result.overall = "elevated";
  }

  return result;
}

export const PRESETS = {
  moneyline: {
    refCategory: "sports",
    involveTest: true,
    gamingPrimary: [true, true, true],
    gamingAlternative: [true, true],
    enumUnlawful: false,
    enumTAW: false,
    pos: [true, false, true, true, true, true],
    neg: [false, false, false, false, false, false],
    concerns: [false, false, false, false],
    hedgerClass: "identified",
    liabilityM: 100,
    depthNowSlider: 35,
    depthMatureSlider: 76,
    hedgeFracPct: 60,
  },
  microbet: {
    refCategory: "sports",
    involveTest: true,
    gamingPrimary: [true, true, true],
    gamingAlternative: [true, true],
    enumUnlawful: false,
    enumTAW: false,
    pos: [false, false, false, true, false, true],
    neg: [false, true, false, true, false, false],
    concerns: [true, false, true, false],
    hedgerClass: "none",
    liabilityM: 5,
    depthNowSlider: 20,
    depthMatureSlider: 45,
    hedgeFracPct: 60,
  },
  cpi: {
    refCategory: "econ",
    involveTest: true,
    gamingPrimary: [false, true, false],
    gamingAlternative: [false, false],
    enumUnlawful: false,
    enumTAW: false,
    pos: [false, false, false, false, false, false],
    neg: [false, false, false, false, false, false],
    concerns: [false, false, false, false],
    hedgerClass: "identified",
    liabilityM: 50,
    depthNowSlider: 50,
    depthMatureSlider: 80,
    hedgeFracPct: 60,
  },
};

const HEADLINES = {
  outside: { text: "Outside the Special Rule", cls: "outside" },
  lower: { text: "Lower-risk profile under the proposed factors", cls: "lower" },
  elevated: { text: "Elevated-risk profile under the proposed factors", cls: "elevated" },
  high: { text: "High-risk profile under the proposed factors", cls: "high" },
};

const SUBLINES = {
  outside: "The Special Rule's contract-by-contract public interest review is not implicated on these inputs.",
  lower: "Profile matches the proposal's positive-factor archetype; document the factors and the hedging analysis in the submission file.",
  elevated: "Mixed profile — review is plausible; the file should anticipate the flagged factors and concerns.",
  high: "Profile matches the proposal's negative factors or lacks supporting economic function; expect a § 40.11(c) review if listed.",
};

function fmtMoney(v) {
  if (v >= 1e6) {
    return `$${Math.round(v / 1e6)}M`;
  }
  return `$${Math.round(v / 1e3)}K`;
}

function fmtPct(v) {
  return `${Math.round(v * 100)}%`;
}

const CLASS_LABELS = {
  meaningful: "Meaningful",
  partial: "Partial",
  no_effective: "No effective hedging",
};

function readState() {
  const get = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
  const checked = (id) => get(id).checked;
  const pos = ["p1", "p2", "p3", "p4", "p5", "p6"].map(checked);
  const neg = ["n1", "n2", "n3", "n4", "n5", "n6"].map(checked);
  const concerns = ["c1", "c2", "c3", "c4"].map(checked);
  return {
    refCategory: /** @type {HTMLSelectElement} */ (document.getElementById("refCategory")).value,
    involveTest: checked("involveTest"),
    gamingPrimary: ["g1", "g2", "g3"].map(checked),
    gamingAlternative: ["a1", "a2"].map(checked),
    enumUnlawful: checked("enumUnlawful"),
    enumTAW: checked("enumTAW"),
    posCount: pos.filter(Boolean).length,
    negCount: neg.filter(Boolean).length,
    concernCount: concerns.filter(Boolean).length,
    hedgerClass: /** @type {HTMLSelectElement} */ (document.getElementById("hedgerClass")).value,
    liability: Number(get("liabilitySlider").value) * 1e6,
    depthNow: depthFromSlider(Number(get("depthNowSlider").value)),
    depthMature: depthFromSlider(Number(get("depthMatureSlider").value)),
    hedgeFraction: Number(get("hedgeFracSlider").value) / 100,
  };
}

function buildSummary(state, result) {
  const lines = [];
  lines.push("§ 40.11 SCREEN SUMMARY (proposed rule, RIN 3038-AF65 — educational, not legal advice)");
  lines.push(`Reference category: ${state.refCategory}`);
  lines.push(`Scope: ${result.scope === "safe_list" ? "outside Special Rule (illustrative safe list)" : "within potential scope"}`);
  if (result.scope !== "safe_list") {
    lines.push(`Involves gaming — primary definition: ${result.involvesGamingPrimary ? "yes" : "no"}; alternative definition: ${result.involvesGamingAlternative ? "yes" : "no"}; other enumerated: ${result.involvesOther ? "yes" : "no"}`);
    if (result.triggered) {
      lines.push(`Gaming-specific factors: ${state.posCount}/6 positive, ${state.negCount}/6 negative; general concerns: ${state.concernCount}/4`);
      lines.push(`Hedger class: ${state.hedgerClass}; liability ${fmtMoney(state.liability)}; depth ${fmtMoney(state.depthNow)} at listing / ${fmtMoney(state.depthMature)} foreseeable`);
      lines.push(`Effective hedge fraction: ${fmtPct(result.hedgingNow.effective_hedge_fraction)} at listing (${CLASS_LABELS[result.hedgingNow.classification]}); ${fmtPct(result.hedgingMature.effective_hedge_fraction)} at foreseeable depth (${CLASS_LABELS[result.hedgingMature.classification]})`);
    }
  }
  lines.push(`Screen result: ${HEADLINES[result.overall].text}`);
  lines.push("Notes:");
  for (const n of result.notes) {
    lines.push(`  - ${n}`);
  }
  return lines.join("\n");
}

function render() {
  const state = readState();
  const result = assessContract(state);

  const step2 = document.getElementById("step2");
  const step3 = document.getElementById("step3");
  step2.classList.toggle("hidden-step", result.scope === "safe_list");
  step3.classList.toggle("hidden-step", result.scope === "safe_list" || !result.triggered);

  const effNow = document.getElementById("effNow");
  const effMature = document.getElementById("effMature");
  const classNow = document.getElementById("classNow");
  const classMature = document.getElementById("classMature");
  if (result.hedgingNow) {
    effNow.textContent = fmtPct(result.hedgingNow.effective_hedge_fraction);
    effMature.textContent = fmtPct(result.hedgingMature.effective_hedge_fraction);
    classNow.textContent = CLASS_LABELS[result.hedgingNow.classification];
    classNow.className = `badge ${result.hedgingNow.classification}`;
    classMature.textContent = CLASS_LABELS[result.hedgingMature.classification];
    classMature.className = `badge ${result.hedgingMature.classification}`;
  } else {
    effNow.textContent = "—";
    effMature.textContent = "—";
    classNow.textContent = "—";
    classNow.className = "badge neutral";
    classMature.textContent = "—";
    classMature.className = "badge neutral";
  }

  const headline = document.getElementById("verdictHeadline");
  headline.textContent = HEADLINES[result.overall].text;
  headline.className = `verdict-headline ${HEADLINES[result.overall].cls}`;
  document.getElementById("verdictSub").textContent = SUBLINES[result.overall];

  const notesEl = document.getElementById("verdictNotes");
  notesEl.innerHTML = "";
  for (const note of result.notes) {
    const li = document.createElement("li");
    li.textContent = note;
    notesEl.appendChild(li);
  }

  document.getElementById("summaryPre").textContent = buildSummary(state, result);
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  const set = (id, v) => {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
    if (el.type === "checkbox") el.checked = Boolean(v);
    else el.value = String(v);
  };
  /** @type {HTMLSelectElement} */ (document.getElementById("refCategory")).value = p.refCategory;
  set("involveTest", p.involveTest);
  ["g1", "g2", "g3"].forEach((id, i) => set(id, p.gamingPrimary[i]));
  ["a1", "a2"].forEach((id, i) => set(id, p.gamingAlternative[i]));
  set("enumUnlawful", p.enumUnlawful);
  set("enumTAW", p.enumTAW);
  ["p1", "p2", "p3", "p4", "p5", "p6"].forEach((id, i) => set(id, p.pos[i]));
  ["n1", "n2", "n3", "n4", "n5", "n6"].forEach((id, i) => set(id, p.neg[i]));
  ["c1", "c2", "c3", "c4"].forEach((id, i) => set(id, p.concerns[i]));
  /** @type {HTMLSelectElement} */ (document.getElementById("hedgerClass")).value = p.hedgerClass;
  set("liabilitySlider", p.liabilityM);
  set("depthNowSlider", p.depthNowSlider);
  set("depthMatureSlider", p.depthMatureSlider);
  set("hedgeFracSlider", p.hedgeFracPct);
  syncSliderLabels();
  render();
}

function syncSliderLabels() {
  const liability = Number(/** @type {HTMLInputElement} */ (document.getElementById("liabilitySlider")).value);
  document.getElementById("liabilityVal").textContent = `$${liability}M`;
  document.getElementById("depthNowVal").textContent = fmtMoney(depthFromSlider(Number(/** @type {HTMLInputElement} */ (document.getElementById("depthNowSlider")).value)));
  document.getElementById("depthMatureVal").textContent = fmtMoney(depthFromSlider(Number(/** @type {HTMLInputElement} */ (document.getElementById("depthMatureSlider")).value)));
  document.getElementById("hedgeFracVal").textContent = `${/** @type {HTMLInputElement} */ (document.getElementById("hedgeFracSlider")).value}%`;
}

function init() {
  document.querySelectorAll("#presetRow .preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(/** @type {HTMLElement} */ (btn).dataset.preset));
  });
  document.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("input", () => {
      syncSliderLabels();
      render();
    });
  });
  document.getElementById("copySummary").addEventListener("click", () => {
    const text = document.getElementById("summaryPre").textContent || "";
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  });
  applyPreset("moneyline");
}

if (typeof document !== "undefined" && document.getElementById("verdictPanel")) {
  init();
}
