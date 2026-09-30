# Project Toaster write-up — repo guide

This repo holds the source material and the output for a written series about
**Project Toaster**: an OSINT-based experiment that used agentic AI to monitor and
predict the 2026 Johor State Election (JSE, polling day 11 July 2026, 56 DUN seats,
29 for a majority).

## What is in the repo

| File | What it is | How it is used |
|---|---|---|
| `Outline for Write-up #1-- What we did.docx` | The author's outline for Part 1. Contains the narrative skeleton, reviewer comments (from "tester" and "liane"), and three embedded slide images (the A–D grading rubric and two "Where each indicator comes from" tables, tiers 1–4). | Source of truth for structure, voice and section content. Read it with the docx skill or by unzipping `word/document.xml`; comments are in `word/comments.xml`; images in `word/media/`. |
| `prediction_engine_explainer.md` | Methodology report for the first-principles seat-level prediction engine (three-stage OLS, effective composition, residual carry-forward, backtests 2013→2018 and 2018→2022, limitations). | Source for the "Predicting" and under-the-hood sections. |
| `how-the-prediction-is-made.html` (13 MB) | Static "observability" page: the end-to-end pipeline diagram (sources → extraction → store → aggregation → judgment → calibration → output) plus 536 real logged model calls across 12 call types (prompts + outputs), including 47 daily briefings. All data is inline in one `const SNAPSHOT = {...}` JSON. | Source for the agent workflow description, real prompt/output examples, and the "Daily Toast" briefing text. The outline calls this file `observability_logs.html`. |
| `JSE_dashboard_replay.html` (17 MB) | Offline replay of the live dashboard: 25 dashboard versions ("eras", each a full HTML app stored in `DATA.eras[hash].html`), 74 AI cycles (8 Jun–11 Jul 2026) with the full parameter payload per cycle in `DATA.payloads[i]`, and a frozen final week of feeds. The shell loads an era into an iframe via `srcdoc` and calls `applyParameters(payload)`. `window.__replayGoto(i)` jumps to cycle i. | Source for dashboard screenshots and the forecast-over-time data. Prediction mode is only rendered after clicking the `.mode-btn` labelled "Prediction"; the BN seat count is in `#ms-bn-val`, the seat table body in `#tbl-body`. |
| `writeup.html` | **The deliverable**: Part 1 of the series, a single self-contained HTML article (about 1.9 MB with images embedded). | Edit this directly. See conventions below. |
| `assets/` | The source images for the article (JPEG element screenshots of the dashboard and explainer), `hist_raw.json` (BN seat count per AI cycle, read off the replay), `hist.json` (the merged timeline data the article embeds), `seats_final.json` (the final-cycle seat table, 56 rows, for the results scatter later). | Edit or replace an image here, then re-run the embed script. |
| `tools/embed_assets.py` | Embeds `assets/*.jpg` into the `<img data-asset="...">` tags and `assets/hist.json` into the `#hist-data` script tag of `writeup.html`. Idempotent. `--hist` rebuilds `hist.json` from `hist_raw.json` plus the replay payloads. | Run `python3 tools/embed_assets.py` after touching assets. |

Parsing tip: both big HTML files embed their data as one JSON literal after
`const DATA = ` / `const SNAPSHOT = `; `json.JSONDecoder().raw_decode(text, offset)`
in Python reads it without loading the page.

## Key facts about the project (for consistency)

- Timeline: commissioned ~2 months before polling day; dashboard cycles run 8 Jun–11 Jul 2026; nomination day 1 Jul (engine switched to a "contest-aware" version that models each seat's real 2026 line-up).
- Three interfaces: **Monitoring** (extract info), **Predicting** (make assessments), **Updating** (summarise info, twice-daily ~400-word briefing, a.k.a. the "Daily Toast").
- Monitoring indicators: voter preference by race (polls), voter sentiment from news comments (Malay / Chinese / English), campaign activity, key leader presence in Johor, royal signals, foreign (Singapore) mentions.
- Prediction engine: BN% per seat ≈ BM×Malay_eff + BC×Chinese_eff + seat residual (2022 baseline BM 60.7%, BC 12.8%). Six parameters: ΔMalay, ΔChinese, turnout target, Malay–Chinese turnout gap, Malay opposition alignment rural / urban; plus per-seat overrides. Backtests: 52/56 seats correct and exact statewide BN seat count on both 2013→2018 and 2018→2022.
- AI layer: five specialist "analysts" (voter-preference, voter-response, campaign, leader-interest, royal-signals) plus a rules-based synthesiser. Rule: "code computes; the AI only classifies and judges direction". Agents emit direction + size band + confidence band, never numbers; calibration turns bands into parameter moves via fixed published weights.
- **Voter preference is not an LLM judgment**: an agent runs a daily web search for new polls and extracts support levels; the deltas are plain poll arithmetic. **Singapore mentions are display-only** and feed no parameter.
- Final frozen forecast (11 Jul 17:36 SGT): BN 38 of 56, 20 seats in play. Actual results are NOT in the repo yet.
- Models used in the shipped pipeline (from logs): GPT-5.5 for judgment/extraction/briefing, GPT-4.1 / GPT-4o / GPT-4o-mini for classification. Design partner during the framework phase: Claude Opus 4.8 Max (as named in the outline).

## Decisions made by the author (do not relitigate)

1. **Tone**: professional overall with a bit of playfulness; keep the toaster metaphor and the naming used in the outline ("Project Toaster", "Daily Toast", "OG problem" etc.).
2. **Series**: this is **Part 1** ("What we did"). A Part 2 (post-mortem, results analysis) will follow. Do not call this "part two" even though the outline's intro paragraph says so.
3. **Placeholders** rather than invented content for: the title, the "main questions" the project set out to answer, the assumptions list (marked WIP by the author), the actual JSE results, and the results scatter plot. Placeholders are amber dashed boxes with the class `placeholder` and an HTML comment `<!-- PLACEHOLDER: ... -->` so they are easy to grep.
4. **Where the outline and the explainer disagree, follow the explainer** (it reflects what shipped). Frame the voter-preference agent as the daily poll search + extraction step, not as a judgment agent.
5. **Rubric critique notes**: the italic footnotes on the tier 3–4 slide ("the framework starts manufacturing its own measurements", "Chinese-press sentiment is filed in two places at once") and the undefined "+/−" row are shown in a keep-or-drop placeholder pending the author's decision.
6. **Technical depth**: plain-language main narrative (target 2,500–3,500 words) with collapsible "Under the hood" panels carrying the equations, parameter tables, backtest results and the agent weight matrix.
7. **Format**: one self-contained `writeup.html` that works with no internet: no CDN scripts, no web fonts, all images inline as base64 JPEG/PNG, charts as hand-written inline SVG. Must read well on a phone.

## Conventions for editing writeup.html

- Keep everything inline. Do not add `<script src>` or `<link href>` to remote hosts.
- Images are base64 data URIs generated from Playwright element screenshots (see below). Keep the total file under ~8 MB.
- Placeholders: keep the `placeholder` class and the `<!-- PLACEHOLDER -->` comments until the author fills them.
- Colour conventions match the dashboard: BN blue, PH red, PN green, "other/gov" amber/grey.

## Regenerating assets

Playwright is installed globally (`/opt/node22/lib/node_modules/playwright`) with Chromium
under `/opt/pw-browsers`. Screenshots of dashboard panels were taken with element
screenshots inside the replay iframe at the final cycle (`window.__replayGoto(73)`),
after clicking the Prediction mode button where needed. The forecast history was
produced by stepping through all 74 cycles and reading `#ms-bn-val`.
Scripts used live in the session scratchpad, not the repo; they are small and easy to
recreate from the notes above.

## Status and what is still open (as of the first draft)

Placeholders in `writeup.html` (grep `PLACEHOLDER`), all waiting on the author:

1. Title (three candidates offered in the placeholder box).
2. Byline.
3. The "main questions" the project set out to answer (section 04).
4. The assumptions list: transcribed from the outline and grouped, but marked WIP there.
5. Keep-or-drop decision on the three critique notes from the tier 3–4 rubric slide (section 06).
6. Daily Toast: real Telegram screenshots, if wanted, next to the typeset briefing (section 09).
7. Results: actual JSE seat count and seat-level shares, plus the predicted-vs-actual scatter
   (section 11). `assets/seats_final.json` has the final-cycle predictions for all 56 seats if the
   scatter is to be rebuilt in-page.

Things a future agent should know:

- The forecast timeline reads seat counts the dashboard displayed at the time (from `#ms-bn-val`
  in later versions, `#c-bn` in early ones). The daily briefings sometimes quote a different
  seat count for the same day because they were generated at a different cycle.
- Word count of the main narrative is about 3,500 (excluding tables, placeholders, the briefing
  text and figure captions). The author's target was 2,500–3,500.
- Rendering check: open the file with Playwright (no network), confirm zero `pageerror`s, zero
  non-`file:`/`data:` requests, and `document.documentElement.scrollWidth === 390` at a 390 px
  viewport. Set `html{scroll-behavior:auto}` before taking scrolled screenshots, otherwise the
  page's smooth scrolling produces half-scrolled captures.

## Git

Work on branch `claude/happy-ptolemy-wnrsxg`. Commit messages should say what changed
in the article. Never push to a different branch without being asked.
