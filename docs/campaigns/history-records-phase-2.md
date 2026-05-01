# HISTORY-RECORDS Phase 2 — Retrospective

**Campaign:** HISTORY-RECORDS Phase 2
**PR:** #313
**Branch:** `claude/history-records-phase-2`
**Duration:** Multi-week iteration cycle, ~50+ commits across the branch lifetime
**Status:** ✅ Merged

---

## Why this campaign earned a retrospective

Most completed campaigns slot into `docs/completed-work.md` as a one-line summary and that's enough. Phase 2 is different. The campaign produced a substantial visual and architectural payload, but more importantly, it surfaced patterns about how iteration works in this development setup that are worth capturing for future campaigns.

This retrospective is meant to be useful, not exhaustive. It focuses on what was learned about *the process*, not just what was built.

---

## What shipped

The full payload is documented in `completed-work.md` PR #313 entry. At a high level:

- Subtab routing infrastructure (HistorySubNav, RecordBadge, resolveHistoryHref)
- Full History Overview redesign — five sections in a 2-row dashboard composition with multi-line block treatments throughout
- All-time standings table extended from 5 to 9 columns plus a 5-cell "Recent Finish" trend chip column with gold/silver/bronze podium tier outlines
- DESIGN.md formalized with three new general-pattern sections (multi-line rows, list row width discipline, responsive column degradation) plus reconciliation of two existing rules
- AGENTS.md formalized with two convention bullets (scoped-suite verification, visual-reference commits)
- Reference mockups committed to `mockups/` directory establishing the convention
- Phase 3 follow-up tasks filed in `next-tasks.md`

Test count grew from 87 to 128 across the campaign.

---

## The arc the closeout entry doesn't capture

The completed-work entry presents Phase 2 as a clean shipment of features. The reality was messier and worth recording.

### V1 misstep, V2 misstep, Path B correction

Phase 2 went through three major composition designs before landing.

**V1** (early Phase 2, never shipped to production): committed during a previous Claude session before this thread started. Per the transition prompt, V1 was critiqued as "disjointed elements, not telling a story." V1 wasn't preserved in screenshots and the critique drove subsequent direction without the V1 design being directly examined in this campaign.

**V2** (committed but unmerged): EraSummary + TitleTimeline + Storylines + 18-card Record Book grid. Designed in response to V1's critique. The thinking was that History should "tell the league's whole story" rather than echo the main Overview. V2 was substantially thinner than the production state of History at that time — it removed sections (Most Improved climbs/drops, Dynasty & Drought) that production had.

**The misstep behind V2:** the campaign's earlier work assumed the production History page was the problem to be solved. In fact, production was already doing most of the work — Championships banner, all-time standings, top rivalries, climbs/drops, dynasty/drought, season archive. V2 *removed* working content and replaced it with new content that tried harder narratively but landed thinner functionally. The V1 → V2 trajectory was solving the wrong problem.

**Path B** (eventually shipped): treats production composition as the foundation, modifies it surgically rather than wholesale. Multi-line block restructure for sections that had drift problems, restored 7-column standings table, dashboard layout reorganization, no inventing new compositional concepts.

**The lesson:** when iterating on existing work, take production seriously as a baseline. Don't assume the existing design is the problem; sometimes the problem is in the perception of it. The V2 → Path B correction took multiple rounds because the V1/V2 framing had to be unwound before the Path B work could begin.

### Color tuning hell

The trend chip column went through ~10 distinct color tuning iterations before locking. The arc:

1. Started with three-tier color encoding (champion / podium / mid / bottom)
2. Tried gold/silver/bronze with distinct hues — silver too weak in light mode
3. Tried gradient (amber at varying opacity) — bronze too close to dim text
4. Tried different bronze hues — gold/bronze blended in light mode
5. Tried inverted treatment (saturated backgrounds, light text) — fixed legibility but added too much visual weight
6. Tried outlined squares — visual weight problem solved, but gold/bronze too similar in light mode
7. Tried bronze as true brown (orange-900) — separation finally works
8. Tried various gold variations to make it pop more in light mode
9. Settled on yellow-500 border / yellow-600 text for gold — works
10. Final tweak: gold text needed to be brighter to differentiate from bronze; landed on yellow-600 / yellow-500

Each iteration was a single message-level cycle, several minutes of iteration, screenshot evaluation, and revision. The cumulative time spent on chip color tuning was substantial — probably several hours of conversation across all iterations.

**The lesson:** color decisions on small UI elements (12px chips on dark/light dual-mode pages) are inherently iterative because color theory and rendered reality often disagree at small sizes. The cost of getting it right was paid in iteration; mocking up several variants in parallel from the start might have saved time, but might also have led to picking a clearly-wrong-on-rendering option without the iteration to discover it.

### Layout-width tug-of-war

Layout went through several width-related iterations:

- Original `max-w-6xl` cap inherited from earlier work
- Cap lifted in `dc37763` to match main Overview's no-cap pattern
- Lifting created new whitespace problems (sections felt scattered across oversized canvas)
- Re-introduced `max-w-7xl` cap to constrain the page back
- Within the page, multiple attempts to fix the standings table truncation/floating problem
- Settled on `table-auto` + content-driven cell widths + `1fr / 280px` row 2 split
- Trend chip column added to consume some leftover space, but didn't fully solve it
- Records column dropped to 4 items + inline eyebrow to balance row 3 column heights

**The lesson:** layout is a system. Changes that fix one section often create or expose problems in another. The wrapper cap decision (lift it) was made on the principle of "match main Overview" but didn't account for History's content profile being different. Better diagnostics earlier (the layout diagnostic prompt that measured actual container widths and content widths) would have surfaced these constraints sooner.

The diagnostic-before-fix pattern that emerged late in the campaign should be the default for future layout work.

### Codex review caught real bugs

Two functional regressions almost shipped:

1. **Insight deep-link routing dead-ending** — `resolveHistoryHref` was updated to point at Phase 3 subtab routes that don't have content yet. Visual review missed this because it tested the History page in isolation, not the click-through from Insights. Codex review caught it.

2. **`activeOwners` empty when current-season CSV missing** — silent failure mode that would affect leagues in pre-upload, post-reset, or storage-miss states. Codex review identified this and the fix (archive-derived owner fallback).

**The lesson:** visual review is necessary but not sufficient. Codex review on cumulative architectural PRs catches functional regressions that visual review can't see. The campaign's existing convention of running Codex review on architectural/foundational PRs paid off here.

---

## Patterns worth keeping

### Mockup-first for UI iteration

The trend chip color iterations all happened in HTML mockup before landing in code. Each color tuning was a tweak to the mockup file, screenshot evaluation, and the next tweak — entirely outside the implementation surface. Once colors were locked, the implementation prompt referenced the mockup as the visual source of truth.

This worked. Implementation went smoothly because the design was already settled. The mockups committed to `mockups/` make these decisions reproducible and inspectable for future reference.

### Diagnostic prompts before fix prompts

Late in Phase 2, the layout diagnostic prompt (`P7-HISTORY-RECORDS-PHASE-2-LAYOUT-DIAGNOSTIC-v1`) ran before the layout remediation. The diagnostic measured actual container widths, identified the `max-w-6xl` wrapper as the dominant cause of edge-margin issues, and surfaced specific concerns that informed the remediation prompt.

Compared to earlier in the campaign where layout fixes were guesses informed by reading screenshots, the diagnostic-first approach produced a tighter remediation. Worth making this the default for future layout work.

### Scoped-suite test verification

Codified in AGENTS.md during this campaign: don't run full `npm test` (it hangs on Overview-related tests pending TEST-SUITE-BASELINE-CLEANUP); run scoped suites covering the relevant component and selector surface. This convention worked through Phase 2's many sub-phases without producing false signals.

The convention should propagate to future campaigns until the underlying test-suite hang is fixed.

### Markdown-block dispatch instructions

Mid-campaign request from the user: dispatch instructions should be in markdown code blocks for one-click copy-paste. This sped up the dispatch cycle noticeably and reduced the friction of going from "we agreed on the fix" to "Codex is working on it." Worth being default behavior for any prompts going forward.

### Cross-model review on architectural PRs

The Codex review on Phase 2 caught two functional regressions that visual review missed. The cost of the review was small (one prompt, structured output); the value was high (caught merge-blockers). Should remain the default for any campaign with non-trivial architectural surface.

---

## Patterns worth examining

### Iteration density on a single thread

This campaign accumulated a long conversation thread with many small iterations. Some observations:

- The thread became a useful artifact in itself — context for design decisions stayed accessible
- Iteration speed was high — each cycle was quick to dispatch and evaluate
- BUT: the cumulative cost was significant in terms of time spent on small visual tweaks
- AND: the thread density made it hard to step back and ask "are we solving the right problem"

Better balance might be: rapid iteration when the design intent is clear and only execution needs tuning; deliberate pause-and-step-back when the design intent itself feels uncertain.

### Mockup file naming drift

The first reference mockup was committed as `mockups/history-redesign-pathC.html` — the file content was actually Path B per the design exploration, but the filename was preserved for traceability with the implementation prompt that referenced it. This created internal inconsistency that future readers will have to decode.

A small lesson: when a file's identity drifts during exploration, rename it before committing. The retroactive comment-in-file fix worked but isn't as clean as renaming would have been.

### "Don't let perfect be the enemy of good"

Late in the campaign, the user explicitly invoked this principle to stop iterating on layout and ship Path 1 (max-width cap) rather than chase Path 2 (dynamic tiling exploration). This was the right call given the iteration fatigue accumulated, but it's worth noting that the principle gets invoked when iteration has already been substantial. Earlier invocation might have shipped Phase 2 sooner with less polish; the question is whether the polish was worth the time.

No clear lesson here — sometimes more iteration produces a better result, sometimes it just produces a different result. The judgment call is timing.

---

## Open threads carried into Phase 3

Filed in `docs/next-tasks.md` under `## Planned backlog (from HISTORY-RECORDS campaign)`:

- **`RECORDS-SCORING`** — auto-scored marquee record selection (replaces current implicit category-priority rule)
- **`SPARSE-DATA-LAYOUT-v1`** — responsive treatment for under-populated sections in young leagues
- **`HISTORY-DYNAMIC-TILING`** — alternative layout exploration that uses 2D space instead of vertical stacking
- **`INSIGHT-ROUTING-PHASE-3-RETARGET-v1`** — re-point insight deep-links to Stats / Rivalries subtabs once those have content

These should inform Phase 3 scoping decisions. Specifically, `RECORDS-SCORING` and `INSIGHT-ROUTING-PHASE-3-RETARGET-v1` directly tie to Phase 3 subtab content shipping.

---

## Recommended Phase 3 starting points

1. **Discovery before implementation.** Phase 3's three subtabs (Stats, Rivalries, Archive) are not equally well-defined. A discovery prompt that investigates each subtab's content shape, data dependencies, and design questions should precede implementation prompts. This avoids the V1/V2 misstep pattern from Phase 2.

2. **Stats first.** Stats is the natural next step because it absorbs the full record book that Phase 2's marquee selection sketches at, and it can house the auto-scored records work filed as `RECORDS-SCORING`. Rivalries and Archive can be designed after Stats lands.

3. **Reuse the multi-line row pattern from DESIGN.md.** Phase 3's content shapes (record listings, rivalry detail pages, season archives) all fit the multi-line pattern formalized in this campaign. The pattern should be the default treatment for new list/table sections, not re-derived per surface.

4. **Lean on the layout diagnostic pattern.** Any structural layout decisions in Phase 3 (per-subtab page composition, navigation between subtabs and detail pages) should start with diagnostic measurement, not visual estimation.

5. **Run Codex review on Phase 3 architectural PRs.** The Phase 2 Codex review caught two real bugs. The convention earned its place; should continue.

---

## Closing observation

Phase 2 is a campaign where the campaign itself was a learning opportunity. The features shipped are solid. The patterns formalized in DESIGN.md and AGENTS.md will shape future work. But the most valuable output might be the iteration discipline that emerged — diagnostic-first, mockup-first, Codex review on architectural PRs, scoped-suite verification, markdown-block dispatch instructions.

These should be the new default. Phase 3 should benefit from them from the start.
