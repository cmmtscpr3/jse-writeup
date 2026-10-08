# Project Toaster write-up — repo guide for agents

This repo holds the source material and the output for a written series about **Project Toaster**:
an OSINT-based experiment in which two people (an analyst and a data scientist) used agentic AI to
monitor and predict the 2026 Johor State Election (JSE: polling day 11 July 2026, 56 state seats,
29 for a majority). The deliverable so far is **Part 1, "What we did"**, as `writeup.html`.
A Part 2 (the post-mortem, with the actual results) is planned.

Read this file before touching anything. It records what the author decided, what has been verified
against the sources, what reviewers found, and what is still open.

## 1. What is in the repo

| Path | What it is | How it is used |
|---|---|---|
| `Outline for Write-up #1-- What we did.docx` | The author's outline for Part 1: narrative skeleton, nine reviewer comments (authors "tester" and "liane"), and three embedded slide images (the A–D grading rubric, and "Where each indicator comes from" tiers 1–2 and 3–4). | Source of truth for structure, voice and section content. Read by unzipping: text in `word/document.xml`, comments in `word/comments.xml`, images in `word/media/image1-3.png`. (`pandoc` is not installed.) |
| `prediction_engine_explainer.md` | Methodology report for the first-principles seat-level engine: three-stage OLS, effective composition, residual carry-forward, backtests 2013→2018 and 2018→2022, limitations. | Source for section 07 and its "Under the hood" panel. Every number there was checked against this file. |
| `how-the-prediction-is-made.html` (13 MB) | Static "observability" page: the pipeline diagram (sources → extraction → store → aggregation → judgment → calibration → output) plus 536 real logged model calls across 12 call types (system prompt, user message, response, model, created_at), including 47 daily briefings. Data is one JSON literal after `const SNAPSHOT = `. The outline calls this file `observability_logs.html`. | Source for the agent workflow, model names, prompt/output examples and the Daily Toast text. |
| `JSE_dashboard_replay.html` (17 MB) | Offline replay of the live dashboard: 25 dashboard versions ("eras", each a full HTML app in `DATA.eras[hash].html`), 74 AI cycles (8 Jun–11 Jul 2026) with a full payload per cycle in `DATA.payloads[i]` (parameters, seat_overrides, confidence, agents, news_sentiment, campaign_activity, leader_presence, royal_signals_feed, foreign_mentions, voter_preference), and a frozen final week of feeds. Data is one JSON literal after `const DATA = `. | Source for all dashboard screenshots and the forecast-over-time data. |
| `writeup.html` | **The deliverable.** Single self-contained HTML article, ~2.3 MB with images embedded, works offline. | Edit directly; see section 4. |
| `assets/` | `*.jpg` screenshots the article embeds (see section 6 for what each is); `hist_raw.json` (BN seat count + seats-in-play per cycle, read off the replay); `hist.json` (merged timeline data the article embeds: per cycle `i, ts, sgt, bn, inplay, contest, p{six parameters}, conf, ov`); `seats_final.json` (the final-cycle seat table, 56 rows, headers + rows, for the future results scatter). `mon_campaign_digital.jpg` is captured but no longer referenced by the page. | Replace an image or the data here, then run the embed script. |
| `tools/embed_assets.py` | Embeds `assets/*.jpg` into every `<img data-asset="NAME">` and `assets/hist.json` into `<script id="hist-data">`. Idempotent. `--hist` rebuilds `hist.json` from `hist_raw.json` + the replay payloads first. | `python3 tools/embed_assets.py [--hist]` after any asset change. |
| `tools/check_render.js` | Playwright check: no script errors, no non-file/data requests, no horizontal scroll at 1280/820/390 px, no heading-order jumps, lightbox keyboard flow, sticky table header. Optional screenshot dump. | `node tools/check_render.js writeup.html [outdir]` before every commit. |
| `tools/capture_dashboard.js` | Re-captures the screenshots (`shots`) or the per-cycle seat history (`history`) from the reference pages. | `node tools/capture_dashboard.js shots` / `history`, then `python3 tools/embed_assets.py --hist`. |
| `writeup.editable.html` | **Generated**: `writeup.html` plus an in-page text editor (see section 10). Never edit by hand. | `python3 tools/make_editable.py` after every change to `writeup.html`. |
| `writeup.shared.html` | **Generated**: the article prepared for publishing as a claude.ai page with a shared multi-editor (section 11). Not standalone: no html/head/body wrapper, needs `window.claude`. Published at https://claude.ai/artifact/KcKj2GkKtg4BvTiW33Xygm | `python3 tools/make_shared.py`, then republish with the Artifact tool (same file path keeps the URL). |
| `tools/bake_ids.py` | Bakes the editable-block ids into `writeup.html` (see section 5). Idempotent. | Run after adding text-bearing elements to the source. |
| `tools/make_editable.py`, `tools/editor/`, `tools/test_editor.js` | The build script, the editor's source (`pre.js`, `editor.js`, `editor.css`, `toolbar.html`) inlined into the editable copy, and its end-to-end test. | Edit the editor here, rebuild, run `node tools/test_editor.js` (section 10). |

Parsing tip for the two big HTML files: find the offset of `const DATA = ` / `const SNAPSHOT = ` and
call `json.JSONDecoder().raw_decode(text, offset)` in Python. Never open them whole in the model context.

## 2. Verified facts the article relies on

All of these were checked against the sources by review agents; keep them consistent.

- Timeline: commissioned about two months before polling day; cycles 8 Jun–11 Jul 2026 (34 days, 74 cycles, up to 7 in a day while the pipeline was being built); nomination day 1 Jul, when the engine switched to a contest-aware version using each seat's real line-up. 25 dashboard versions shipped during the run.
- Three interfaces: **Monitoring** (AI extracts), **Predicting** (AI judges), **Updating: the Daily Toast** (AI summarises; ~400 words, every morning and, from 1 Jul, most evenings; 47 briefings, 28 mornings, 16 evenings, three other).
- Six monitoring indicators: voter preference by race (polls), voter sentiment from news comments (Malay/Chinese/English), campaign activity, key leader presence in Johor, royal signals, foreign (Singapore) mentions. Leader presence and Singapore mentions never appeared on the graded rubric list; on 6 Oct 2026 the author asked (via a comment on the shared page) for leader presence to carry grade C in the "what we used" table, so the table now shows C while the row still says "Not on the graded list". Singapore mentions are display-only.
- Engine: BN% per seat ≈ B_M×Malay_eff + B_C×Chinese_eff + seat residual; 2022 baseline B_M 60.7%, B_C 12.8%, T_M 66.2%, T_C 45.8%. Six dials: ΔMalay, ΔChinese, turnout target, Malay–Chinese turnout gap, non-BN Malay lean rural / urban (stored as the share to PH; the dashboard and the article show them as shifts from the 2022 split, rural 26% / urban 49%). Plus per-seat overrides (the dashboard's word; "nudge" only as a verb). Backtests: 52/56 correct and exact BN seat total on both 2013→2018 and 2018→2022. After nomination day: PN absent in 23 seats, Bersama in 15, two incumbents switched coalitions (Endau, Layang-Layang).
- Manual override sidebar (Prediction view, collapsed behind a blue "Click to manually override AI assessment" handle): every engine parameter as a slider with an "AI" badge on agent-set values; two pinned buttons ("Reset to AI assessed parameters", "Set to 2022 baselines"); after nomination day three contest settings the agents never set (PH→Bersama split 15%, absent-PN→BN share 60%, incumbency toggle on; the payloads carry only the six dials + seat_overrides); a seat-override form and list.
- AI layer: five "analysts" (voter-preference, voter-response, campaign, leader-interest, royal-signals) plus a rules-based editor (the dashboard calls it the Synthesising Agent). Rule: "code computes; the AI only classifies and judges direction". Signals are direction + size band + confidence band, never numbers; calibration uses fixed published weights (the weight matrix in the article matches the dashboard's methodology modal verbatim).
- Voter-preference is poll arithmetic, not judgment: a web search at every update finds polls; deltas are subtraction from the 2022 baselines. The poll term (`conf_poll_*`) was 0.00 in all 74 cycles because no Johor poll appeared; the support deltas ran on "drift" (analysts' judgment). The dashboard shows the same Sungai Bakap poll twice because de-duplication keyed on the pollster's name, which varied.
- Leader-interest: the AI judges only the PH–PN split; the same presence data feeds ΔMalay (Zahid drag), turnout and the turnout gap by formula (per the leader_interest prompt), hence five rows in the weight table.
- The briefing system prompt hard-codes "PN not on the ballot in 29 seats"; the engine's line-up data says 23. The article quotes the briefing verbatim and explains this in the note beneath it.
- Comment counts: 113,735 labelled comments is the trailing 14-day window at the final cycle (ms 65,827 / zh 37,756 / en 10,152), not a campaign total. Community mood floors −0.68 / −0.69 / −0.63.
- Final frozen forecast (11 Jul 17:36 Singapore time, freeze 18:00): BN 38 of 56, opposition 18 (11 PH, 6 PN, 1 MUDA), 20 seats in play at 10 pp, 5 BN wins inside ±5 pp, 19 seat overrides, confidence 0.269, 5 of 6 dials moved. Forecast path: 40 on 8 Jun, min 34 on 30 Jun, 43 on 2, 3 and 7 Jul, 38 at close. Cycle 70 (10 Jul 08:20) is an anomalous reset to baseline.
- Models in the shipped pipeline: GPT-5.5 (judgment agents, news extractor, royal reader, poll search with web search, briefing), GPT-4.1 (campaign post classifier), GPT-4o (comment labeller), GPT-4o-mini (politics gate, Singapore filter). Design partner during the framework phase: Claude Opus 4.8 Max (as named in the outline).
- Political framing (from the comment_label and briefing prompts): BN (UMNO-led) runs the Johor state government under MB Onn Hafiz; PH under PM Anwar leads the national unity government, of which BN is a member; PN is Bersatu + PAS. Sultan Ibrahim of Johor is also the King; Tunku Ismail is Regent. MUDA was founded by Syed Saddiq and is now led by Amira Aisya; it defended Puteri Wangsa in 2026 with Rashifa Aljunied.
- Actual JSE results are **not** in the repo.

## 3. Decisions made by the author (do not relitigate)

1. **Tone**: professional with a bit of playfulness; keep the outline's naming ("Project Toaster", "Daily Toast", "OG problem"). Reviewers trimmed the cutest lines; do not add jokes to the technical panels.
2. **Series**: this is Part 1; say "the first in a series", never "part two".
3. **Placeholders, not invention**, for anything the outline marks WIP or that the repo lacks (see section 7). Placeholder boxes use class `ph` (small variant `ph small`), inline ones `ph-inline`, and every box has an HTML comment `<!-- PLACEHOLDER: ... -->` so `grep PLACEHOLDER` finds them.
4. **Where the outline and the explainer disagree, follow the explainer** (it reflects what shipped).
5. **Rubric critique notes** from the tier 3–4 slide stay in a keep-or-drop placeholder until the author decides.
6. **Technical depth**: plain-language main track, with `details.hood` "Under the hood" panels for equations, parameter tables, backtests and the weight matrix. Author's word target was 2,500–3,500; the page is now ~4,450 words on the main track after reviewer-requested additions (glossary, chain strip, cards). Trimming is the author's call; sections 05–06 are the densest.
7. **Format**: one self-contained `writeup.html`, no internet needed: no CDN scripts, no web fonts, images as base64 data URIs, charts as inline SVG built by inline JS. Must read well at 390 px.
8. The H1 carries a working title ("One analyst, an army of agents") so the page does not open on placeholder text; the title placeholder box sits above it.

## 4. Anatomy of writeup.html

Sections (ids `s1`–`s11`, kickers in `h2 .num`):
01 How it all started (pull quote, three cards, political-context paragraph, `.who` card with who's-who and "Terms we use") ·
02 What really happened (`.toaster` graphic, `.chain` six-step strip) ·
03 Design (`.proc` design/build lanes, `.funnel`, yardstick cards, `.assump` list, `.fw` framework with click-to-reveal `#fw-out`) ·
04 The three interfaces (`.ifaces`) ·
05 What we fed it (rubric table, "what we used" table, hood panel with the 22-row `#ind-table` filterable by grade; the tier grouping and the +/− grade suffixes were removed at the author's request on 6 Oct 2026, so grades are plain A–D; keep-or-drop placeholder) ·
06 Monitoring (methodology table, six figures, rejected-data table, two "not explored" cards) ·
07 Predicting (engine, hood panel with equations/backtests, six analyst cards, `.kinds` legend, `#pipe` diagram + `#pipe-out`, two figures, hood panel with the weight matrix) ·
(On 6 Oct 2026 the author swapped the order of the next two: the machine now comes first as 08 and the Daily Toast is 09; the section ids `s8` = Toast and `s9` = machine were kept, only the kickers, the contents list and the cross-references changed.)
08 The Daily Toast (`.phone .bubble` verbatim briefing + note) ·
09 The machine (the `.stats` tiles were removed at the author's request on 6 Oct 2026; tabbed dashboard screenshots, two paragraphs + figure on the manual override sidebar, `#tl-box` forecast timeline with scrubber, readout tiles and table view) ·
10 Results (placeholder) · 11 Next steps (the `.next` "three threads" box was removed at the author's request on 6 Oct 2026).

Design system (all tokens in `:root`): cool neutral paper `#f2f3f1`, ink `#16181d`, serif body (Charter/Georgia stack) at 18 px on a 680 px measure, heavy sans headings, amber accent `#b1500a` used only for markers, selection states and placeholders. Grade chips A green / B slate / C ochre / D grey; pipeline kinds extraction teal / judgment violet / deterministic grey with 🤖🧠⚙️ glyphs (aria-hidden) so kind is never colour-only. Party colours (BN blue, PH red, PN green) appear only as dots beside names. Wide elements use `.wide` inside `.wrap` (breaks out to 1040 px). Prose tables carry `tbl stack` + `data-l` cell labels so they stack on phones; numeric hood tables scroll with a fade (`.tblwrap.scrolls`) and a hint.

Interactive components (inline script, no dependencies): progress bar; "open all technical panels"; lightbox (`img.shot` are focusable buttons; header/main/footer become `inert`; Tab cycles pan ↔ Close; Escape closes; caption scrollable); tabs (`aria-pressed` + `hidden` panels); framework reveal (first item pre-selected); indicator filters (tier headers hide when empty, `aria-pressed`, `role=group`); pipeline (`N` map of name → [kind, description, reads, writes], `PL` plain-English sublabels, `COLS` layout, click highlights `rel-in`/`rel-out`, "Example" prefix until first click; names break at underscores via `<wbr>`); timeline (`draw()` rebuilds the SVG at container width on resize, crosshair hover with clamped tooltip, halo label, nomination marker with measured label, `CELLS` array drives both the readout tiles and the table view, Play/Pause with reduced-motion speed, scrub stops playback, `aria-valuetext` on the range). Print: panels open, tabs shown, pipeline in 7 columns.

## 5. Working on the file

- **Block ids are baked into the source** since 6 Oct 2026: every editable block carries `data-ed="bN"` (from `tools/bake_ids.py`, which replays pre.js's rules over the source text). Keep them: they are what ties the shared draft's per-block edits to the text. Deleting an element removes only its own id; a new text-bearing element gets a fresh id above the highest existing one (`python3 tools/bake_ids.py` bakes it; pre.js also assigns one at runtime if you forget). Exports strip the attributes.
- Edit `writeup.html` directly. Images are embedded, so the file is 2.3 MB; to read the source comfortably, strip data URIs into a scratch copy (`re.sub(r'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+','DATAURI',s)`). Do not strip the repo copy in place (the permission classifier blocks that as destructive, and it is unnecessary: the embed script re-embeds).
- For large rewrites, write the whole file with empty `src=""` on the `data-asset` images and run `python3 tools/embed_assets.py`. The Write tool requires a fresh Read of the file first.
- For small edits, Python exact-string replacement works well. The prose uses straight apostrophes (') throughout and real curly double quotes (U+201C/U+201D); match those exactly.
- Before committing: `node tools/check_render.js writeup.html` must print OK for all three widths. Then screenshot the changed regions and look at them; inject `html{scroll-behavior:auto !important}` before scrolled screenshots or captures land mid-scroll.
- Never `pkill -f <script name>` from a shell whose own command line contains that name; it kills the shell. Foreground `sleep` is blocked; run long Playwright jobs with `nohup ... &` and poll a log file.
- Keep negative numbers as true minus signs (U+2212) in the timeline readout and table (`sgn()` does this).
- Colour changes: re-run the dataviz validator (`node /tmp/claude-0/bundled-skills/*/dataviz/scripts/validate_palette.js "<hex,...>" --mode light` if that skill is present). The grey slots (grade D, deterministic) fail the chroma floor by design; letters and glyphs are the secondary encoding.

## 6. Assets and how they were captured

All dashboard screenshots are from the replay at the final cycle (`window.__replayGoto(73)`), 1280 px viewport, device scale 2, JPEG q82, via `tools/capture_dashboard.js shots`:
`mon_polls` (baseline banner + legend + Malay/Chinese poll charts), `mon_sentiment_ms` / `mon_sentiment_zh` (the two `.ns-panel` cards), `mon_campaign_events` (used) and `mon_campaign_digital` (unused), `mon_leaders` (heatmap), `mon_royal` (royal card, clipped to 560 px; the card itself is 5,000+ px tall, so never element-screenshot it whole), `dash_monitoring` / `dash_prediction` (the whole iframe), `pred_ai` (the reasoning panel, clipped to 600 px), `pred_sidebar` (the manual override sidebar opened via `#sb-handle`, grown to full height, split at the "Turnout scenario" title and composed as two columns), `dash_seats` (the seat table from its header, clipped to 560 px), `explainer_extractor` (first call card on the explainer page, 1.5x).
The forecast history (`assets/hist_raw.json`) comes from `tools/capture_dashboard.js history`: it steps through all 74 cycles, clicks Prediction mode in the frame, and reads `#ms-bn-val` (later versions) or `#c-bn` (early versions) plus the "N of 56 seats in play" text. Seat counts are what the dashboard displayed at the time; briefings sometimes quote a different count for the same day because they ran at a different cycle.

## 7. Open items for the author (as of revision 4)

Placeholders in `writeup.html` (`grep PLACEHOLDER`; the byline and toaster notes are inline `ph-inline`):
1. Title (working H1; three candidates in the box).
2. Byline.
3. What the fourth toaster slice and "the little button" stand for (section 02; current graphic guesses "Dashboard" and the manual-override dial).
4. The "main questions" the project set out to answer (section 03).
5. The assumptions list: transcribed from the outline, grouped, marked WIP there; one query on assumption 06 (Syed Saddiq / Puteri Wangsa).
6. Keep-or-drop on the two rubric critique notes (section 05).
7. Optional Telegram screenshots of the Daily Toast (section 08).
8. Results (section 10): what the 5% yardstick applies to (seats or seat-level vote share), the actual JSE seat count and seat-by-seat shares, and the predicted-vs-actual scatter. `assets/seats_final.json` has the final-cycle predictions for all 56 seats if the scatter is to be rebuilt in-page.

Material for Part 2 already in the repo: the 47 briefings in the SNAPSHOT (they narrate every move), the per-cycle payloads (agent findings, risk flags, overrides), `assets/hist.json`, `assets/seats_final.json`, and the three threads the article ends on (poll term never fired; 29-vs-23 seat count; how the 20 in-play seats resolved).

## 8. Review process used (and worth repeating)

Each round ran independent subagents in parallel, all instructed not to edit files and to return prioritised, evidence-backed findings with concrete fixes:
- **Editorial / accuracy**: checks every number, name and claim against the outline, the explainer, the SNAPSHOT and the replay payloads; flags invented claims; proposes sentence rewrites.
- **Visual design**: renders at 1280 / 820 / 390 px with Playwright, screenshots every slice and every interaction, checks typography, contrast (computed from `:root`), spacing, image legibility, keyboard focus.
- **Dataviz / accessibility**: audits the chart and diagram against the dataviz skill's rubric and validator, ARIA names/roles/states, live regions, heading order, table semantics.
- **Cold reader**: a non-technical persona with no Malaysia knowledge reads the stripped copy in order and reports where it got lost, unexplained terms, drag, tone lurches and the placeholders' effect.
- **Evaluator**: after fixes, verifies each earlier finding RESOLVED / PARTLY / NOT with evidence, checks cross-references after any renumbering, and scores.

Score history: rev 1: 6 / 6 / 5 → rev 2: 8 / 8 / 7 (cold reader 6) → rev 3: 7 / 7 / 7 (cold reader 6; three factual slips found) → rev 4: 9 / 8.5 / 9. The recurring lesson: every round found one or two confident sentences that no source supported; check each new claim against the logs before keeping it.

## 9. Git

Branch: `claude/happy-ptolemy-wnrsxg`. Commit messages describe what changed in the article. Never push to a different branch without being asked. `git` identity used so far: `cmmtscpr3 <cmmtscrpr3@gmail.com>` via `-c` flags.

## 10. The editable copy (writeup.editable.html)

The author asked for a way to edit the text without opening the HTML. `writeup.editable.html` is
`writeup.html` with an editor layered on top; the article file itself is never modified by it.

How it works:
- `tools/editor/pre.js` runs before the article's own script. It gives every text-bearing block in
  header/main/footer a stable id (`data-ed="bN"`, document order) and marks the editable ones with
  `data-ed-leaf`. Inline runs (b, i, a, span...) are edited as part of their block; buttons, the
  contents list, the lightbox, `.tabs`, `#tl-box`, `#pipe`, `#pipe-out`, `#fw-out`, `summary` and
  anything the page generates at runtime are never editable. Placeholder boxes (`.ph`) get an id but
  no leaf flag; they carry actions instead. It then keeps a pristine clone of the document.
- `tools/editor/editor.js` (end of body) records an ordered op log (`add`, `rm`, `unph`, `reph`) plus a
  map of per-block innerHTML edits, autosaves them to `localStorage` under `toaster-edit:<build>`, and
  replays them onto the live page on load. Both exports replay the log onto a fresh copy of the pristine
  clone, so runtime-generated markup can never leak into a file. The article's main `<script>` is parsed
  after the snapshot, so editor.js grafts the later script elements into the clone at startup.
- Readers see a "✎ Edit this draft" pill. Edit mode: click a block and type; Enter splits p/li; Backspace
  in an empty p/li deletes it; paste is plain text; links and buttons inside editable text are inert.
  `.ph` boxes show Replace with text / Add image (file -> data URI figure with `img.shot`) / Delete box;
  `.ph-inline` gets a "✓ final" button that drops the class. Removing a box also removes its
  `<!-- PLACEHOLDER -->` comment (lookup skips blocks inserted in front of the box).
- **Export final** downloads `writeup.html` with all editor markup and `data-ed*` attributes stripped;
  a no-edit export differs from the source only by `hidden=""` and head/body line breaks, so git diffs
  stay readable. **Save working copy** downloads `writeup.editable.html` with the edits baked in, a new
  build stamp (so it does not share the browser draft of the file it came from) and a `#ed-orig` JSON
  block recording originals / added / removed / marked-final so its Changes panel still lists them.
- Round trip to the repo: the author sends either file; replace `writeup.html` with an exported final
  (or export one from a working copy), run `node tools/check_render.js writeup.html`, rebuild the
  editable copy, commit both.

Testing: `node tools/test_editor.js` is the end-to-end Playwright test (edit, Enter split, placeholder replace / image / delete, mark final, reload, export final
and verify no editor markup + comments dropped, save working copy, reopen, export again and compare
byte-for-byte, revert a baked removal, discard, 390 px toolbar). It must print ALL OK after any change to
the editor; `node tools/check_render.js writeup.editable.html` must also pass. Known limits: no
structural edits (new tables, reordering, new figures outside placeholders), framework item buttons are
not editable, and a draft with embedded images can exceed the browser's localStorage quota (the editor
warns and the user should Save working copy).

## 11. The shared copy on claude.ai (writeup.shared.html)

A draft of option 2 from the collaboration discussion: two or more people editing the same draft in
place on a claude.ai page. Built by `tools/make_shared.py` from `writeup.html` + `tools/editor/pre.js`,
`editor.css`, `shared.css`, `toolbar_shared.html`, `shared.js`. Published once at
https://claude.ai/artifact/KcKj2GkKtg4BvTiW33Xygm with capabilities
`{db:{}, user:{scopes:["profile"]}, room:{}, comments:{composer_only:true}, downloads:true, assets:{}}`
(the `assets` declaration makes it organization-internal: no public link). Republish by publishing the
same file path from this session, or `url` from another. The team is actively editing there (38 block
edits by two people as of 6 Oct 2026), and the block ids are baked into the source (section 5), so structural edits to `writeup.html` are safe as
long as the existing `data-ed` attributes are kept; after a change, compare the id -> element map of the old
and new file (pre.js on both) to be sure only the intended ids appeared or disappeared.
Comments on the page sent to Claude arrive in this session; answer in the thread with ArtifactComments.

Model (same block ids as the local editor, from pre.js):
- `blocks/<id>` = `{html, by, at}`: one document per edited block, last writer wins; deleting the doc
  restores the pristine text. Written 700 ms after the last keystroke and on blur.
- `ops/<autoId>` = `{t, id, ref, pos, tag, cls, html, leaf, by, at}`: append-only log of structural
  changes, ordered by `at`. Kinds: `add`, `rm`, `restore` (re-insert a pristine block), `unph`
  (mark an inline placeholder final), `reph` (undo that). Reverts write inverse entries; nothing is
  ever deleted by the page. Both exports replay the log onto the pristine snapshot.
- Images: `assets.upload(file)` -> `/_blob/<id>` url in the figure's `add` op; Export final fetches
  them and inlines data URIs so the downloaded `writeup.html` stays self-contained.
- The original `<head>` is carried verbatim in `<script type="text/plain" id="ed-head">`; Export
  final rebuilds the full document from it (the artifact body carries `<title>` + `<style data-fromhead>`,
  which the export skips). A no-edit export differs from `writeup.html` only in whitespace and `hidden=""`.
- Live behaviour: both collections are subscribed once (`onSnapshot`); a remote edit to the block you are
  typing in is not applied (toast instead; your version wins on blur). `room.presence({editing, uid})`
  puts a name tag (`data-ed-peer`, colour `--peer`) on the block another person is in. `user.can
  ("data.write") === false` or a rejected write -> "View only" (shared edits still shown). Comment button
  -> `comments.openComposer({element: lastLeaf})`. Export -> `downloads.save` (html is on the allowlist).
- **Download offline copy** (added 8 Oct 2026): builds `writeup.editable.html` in the browser from the current
  shared state (pristine + ops + edits, baked ids kept, `/_blob/` images inlined) plus the local editor, which
  `make_shared.py` embeds as inert `<script type="text/plain" id="ed-local-toolbar|pre|js">` blocks. It is a
  hand-off: edits made in that file never return to the page by themselves; merging them back is a manual
  step by block id (the working copy's `#ed-orig` lists the changed ids).
- Claude can read or reset the draft with the ArtifactData tool (`list` on `ops` / `blocks`; deleting
  an op makes open pages show a "reset outside this page, reload" notice). To commit the team's edits:
  export from the page, or replay the two collections onto `writeup.html` with the same logic.

Testing: `node tools/test_shared.js` runs the page under a mock `window.claude` (in-memory db with
snapshot callbacks, user, room, downloads, assets, comments; mock store persisted in localStorage so
reload is covered) inside the Artifact skeleton. It must print ALL OK. It cannot exercise the real
runtime; after a publish do one `ArtifactData list` of `ops` and `blocks`. Known limits: block-level
last-writer-wins (no character merging), no structural edits outside placeholders, the `ops`
collection grows without bound (fine for one article; prune via ArtifactData if it ever matters),
and the second editor must be given Contributor or Editor access from the page's Share menu.

