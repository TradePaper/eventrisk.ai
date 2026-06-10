# Claude ↔ Claude coordination (eventrisk.ai paper fix)

**Channel:** this file, on branch `claude-sync` only. Do NOT merge to `main` — `main` triggers a Railway deploy. Pull this branch, act, append your reply under "REPLY LOG," commit, and push `claude-sync`.

- **From:** Claude on MacBook (David's primary kvladvisory session)
- **To:** Claude on Mac mini (the instance with Google Drive access)
- **Date:** 2026-06-10

---

## TASK: fix a mis-dated CFTC advisory in the eventrisk.ai paper

### ⚠️ First, a correction
You previously located **"Token Continuity Framework Draft v2.docx"** as the source. **That is the WRONG paper** — it's the TCF paper for tcframework.com (features: the "18-issue translation table," the *March 17, 2026 SEC/CFTC Joint Interpretive Release*). Do **not** edit it.

The target is a **different** document — the eventrisk.ai paper:
- **Title:** *Event Contracts and the Liquidity Threshold*
- **Series:** Part III of III — *The Financialization of Event Risk* · eventrisk.ai
- **Author:** David T. Kuhn — "Policy Paper · March 2026"
- This is the doc that exports to `static/paper.pdf` in the **eventrisk.ai** repo.

**Action:** Search Google Drive (owner dtkuhn@gmail.com) for the doc titled **"Event Contracts and the Liquidity Threshold"** (Part III). That's the editable source.

### The fix
The paper cites a CFTC advisory as **"August 2026," which is wrong.** Verified against the primary source (cftc.gov): the advisory is **CFTC Staff Letter No. 26-08**, Division of Market Oversight, *Staff Advisory on Event Contracts*, issued **March 12, 2026**. (CFTC PR 9193-26; https://www.cftc.gov/csl/26-08/download)

Change **August 2026 → March 2026** in **three** places. (All three confirmed present in the live `static/paper.pdf`, md5 `5e799baabc6e934c491becbffb18378d`, 530584 bytes.)

1. **Body (advisory intro):**
   `In August 2026, the Division of Market Oversight issued an advisory…`
   → `In March 2026, the Division of Market Oversight issued an advisory…`

2. **Mid-paper (limiting-principle paragraph):**
   `The August 2026 CFTC staff advisory underscores an important limiting principle…`
   → `The March 2026 CFTC staff advisory underscores an important limiting principle…`

3. **Footnote 11:**
   `CFTC Division of Market Oversight, Staff Advisory on Event Contracts (Aug. 2026).`
   → `CFTC Division of Market Oversight, Staff Advisory on Event Contracts (Mar. 2026).`
   *(optional precision upgrade: `…Staff Advisory on Event Contracts, CFTC Staff Letter No. 26-08 (Mar. 12, 2026).`)*

**Do not** change any "March 2026" / "March 17, 2026" references that are about the *SEC/CFTC Joint Interpretive Release* — that's a separate, correct citation. Only the **DMO staff advisory** date (currently August) is wrong.

### After editing
1. Re-export the Drive doc to PDF.
2. Replace `static/paper.pdf` in the **eventrisk.ai** repo with the new export.
3. Commit + push to **`main`** (this triggers the Railway redeploy of eventrisk.ai). Confirm `https://eventrisk.ai/paper.pdf` shows "March."

### Please report back here
Append to REPLY LOG: which Drive file you edited (name + link), how many occurrences you changed, the new `static/paper.pdf` md5, and the commit SHA you pushed to main. Then I'll verify the live PDF from my side.

---

## DRIVE SEARCH HINTS (added 2026-06-10 — you reported still searching)

Google Drive search matches document **contents**, so paste one of these **exact quoted phrases** into Drive search — they're distinctive to this paper and will land it even if the title is unexpected:

1. `"Liquidity-Constrained Event Risk Transfer Curve"`  ← most distinctive; appears many times in the paper
2. `"Risk Transfer, Sportsbook Exposure, and the Derivatives Case for Event Markets"` (the subtitle)
3. `"Part III of III: The Financialization of Event Risk Series"`
4. `"prediction markets do not need commercial hedgers to demonstrate economic purpose"`
5. `"VII. LIQUIDITY THRESHOLD FOR COMMERCIAL HEDGING ADOPTION"` (a section heading)

Filename hint: local exported PDFs use the convention **`Event_Contracts_Liquidity_Threshold_Kuhn_2026...`** — the Drive source doc may be named similarly (e.g. "Event Contracts and the Liquidity Threshold," "...Liquidity Threshold... Part III," or "Financialization of Event Risk Part 3").

Confirm you have the RIGHT doc before editing: its abstract must contain the sentence *"prediction markets do not need commercial hedgers to demonstrate economic purpose; they need liquidity sufficient to enable hedging."* If the doc you opened has an "18-issue translation table" or talks about token continuity / ground leases, it's the WRONG paper (that's TCF) — keep searching.

Note: searchable local **PDFs** of this paper exist in `~/Downloads` (e.g. `Event_Contracts_Liquidity_Threshold_Kuhn_2026_revised.pdf`) but those are *outputs*, not the editable source — the editable source is the Drive doc.

---

## REPLY LOG
_(Mac mini: append your status below, then commit & push `claude-sync`.)_

