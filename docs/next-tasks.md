# Next Tasks (Active Queue)

Status: Current
Last verified: 2026-09-07
Owner: Project documentation
Canonical for: current execution order, planned/parked work, blockers, and the one canonical list of
unresolved decisions and known deferrals
Supersedes: (none)

## Purpose / how to use this document

- This file contains only work that is still open, parked, blocked, conditional, or awaiting a
  decision. Merged/shipped outcomes belong in `docs/completed-work.md`; prompt execution history
  belongs in `docs/prompt-registry.md`.
- Only this file may designate work `NEXT` or `CURRENT`.
- Legacy item numbers are stable cross-reference handles. Gaps mean the completed item was moved to
  `docs/completed-work.md`; do not renumber the remaining entries merely to close a gap.
- Keep task context to what a future implementation needs: the unresolved behavior, governing
  decision, dependency, trigger, and acceptance boundary. Do not add review transcripts, commit
  lists, test totals, or shipped implementation narratives.
- Backlog slugs are provisional planning labels, not formal prompt IDs. Assign a formal
  `<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>` ID only when work is activated, after checking
  `docs/prompt-registry.md`.

## Current execution order

`CURRENT`: **Item 102** — polling planner. (Item 88 is superseded in full by **Item 132**; both
attempts at it were reverted.)
`NEXT`: **Item 115** — Overview section expansion.

Owner-selected run order (2026-09-03), replacing the 2026-09-02 order. Ordering values, stated by the
owner: **user-facing improvements, data correction, and bug fixes first; prerequisites persisted in
place rather than deferred.** The Item 87 follow-on inputs (`docs/campaigns/item-87-followon-*.md`,
committed `c9f76081`) surfaced four new items and one split; the remaining open work is placed below.

1. **Item 102** — polling planner. Held at the top of the large work because it is a
   **data-correction** item as much as a cost one: the manual pause it retires can strand a game's
   final permanently at the `kickoff + 24h` boundary.

   **Item 88 no longer pairs with it.** That pairing existed because
   `schedulerDeliveryHealth.ts:82,88` hardcodes the cadence, so a narrowed cron makes both jobs read
   `late` forever — but Item 88 is superseded by **Item 132**, whose scope is partition-scoped
   FRESHNESS, not delivery cadence. The coupling is internal to Item 102 and is already stated as its
   own **collision 2**. Slice 1 (window derivation) merged 2026-09-05 and is live; **slices 2–4 are
   defined in the Item 102 entry** — synthesis, durable record, activation, in that order.

   **The ~1.1h projection is ANNUAL, not the binding month.** Measured 2026-09-05: October runs 74%
   armed under today's `kickoff + 24h` tail, so the planner alone lands near ~2.25h. **Item 130** is
   what reaches the target in-season — see its entry and
   [`docs/campaigns/vercel-active-cpu.md`](campaigns/vercel-active-cpu.md).

2. **Item 126** — schedule-refresh forensics. Placed immediately after Item 102 because it is the
   **same code layer, not merely adjacent**: `schedulerDeliveryHealth.ts` (which Item 102's collision
   2 must change) imports `schedulerExecutionStatus.ts` (Item 126's core file, home of
   `scheduleYearsTarget`), and `systemHealthIssues.ts` consumes both. Running 126 concurrently with
   102 means two agents editing one receipt contract.
   **Operationally independent, though:** 126's incident is the weekly `schedule-refresh` job, while
   102 narrows `live-scores` and `game-stats`. Neither blocks the other; the conflict is in files.
   Observation-only by its own acceptance boundary, so it is the lower-risk half of the pair.
3. **Item 115** — Overview section expansion. Recent finals is documented as complete and truncates
   at six today; this reuses the disclosure pattern slice 5 settles rather than inventing one.
   **Cross-reference Item 134:** caps are counts, not rows, so at three columns a cap produces a
   ragged final row (seven live games renders 3 + 3 + 1). That interaction belongs to THIS item's cap
   work, not to the tier.
   **Design:** `docs/campaigns/item-87-followon-section-ordering-resolutions.md` §5 (counts, which
   that document explicitly defers to this item); `docs/campaigns/item-87-followon-section-ordering.md`.
4. **Item 119** — **restore the team-colour accent, removed in slice 5**, as a solid **8px muted bar
   at ~72%** at the line start of each team row, on the existing HSL normaliser. No accent for teams
   with no catalog colour — which also removes the green `#059669` fallback every FCS row carried.
   OKLCH only if measured.
   **Reframed 2026-09-06: this is a RESTORATION, not a widening.** `§A` of the design doc opens "the
   incumbent renders 2–3px", and there is no longer an incumbent — `GameScoreboard.tsx` carried that
   line-start accent and went with the orphaned legacy tile in slice 5, leaving `teamColors.ts` with
   **zero production consumers**. The `§A` DECISION is unchanged; only the framing of the work is
   stale.
   **Covers Overview, Matchups AND Schedule** — the treatment belongs to the shared row, not to one
   consumer.
   **Prerequisite delivered by slice 5b / PR #575.** Its `isolation: isolate` on a tinted participant
   row lets an absolutely-positioned bar coexist with the card-owner tint; Item 119 must still supply
   its own containing block on every row rather than rely on slice 5b's conditional `relative`.
   **Blocks Item 134** — it changes row anatomy at the line-start slot, which is what Item 134's
   breakpoint is derived from. See that entry for the arithmetic.
   **Design:** `docs/campaigns/item-87-followon-team-colour-regression.md` (read first — it corrects
   the framing); `docs/campaigns/item-87-followon-team-colour.md` §A;
   `docs/campaigns/item-87-followon-presentation-decisions.md`;
   `docs/campaigns/item-87-live-watchlist-scoreboard.md`;
   `mockups/live-scoreboard-mockup.html` and `mockups/matchups-schedule-mockup.html` (both now carry
   the bar).
5. **Item 134** — Overview three-column tier. **Must run AFTER Item 119**, which consumes its
   headroom. See the Item 134 entry.
6. **Item 118** — Schedule status filter with counts. Purely additive; after the rework it filters.
   **Design:** none written, so its prompt needs an owner design pass first rather than a paraphrase
   of this entry.
7. **Item 100b** — internal slate marker. Date gate removed 2026-09-03; its 2026 consequence
   (Featured empty through 2026-09-07) closes on its own, but the recap and look-ahead targeting it
   exists for recur next August. Cheap: the clustering code is recoverable from `d6184c28`.
8. **Item 113** — Featured as insight-selected, state-agnostic. Largest, and gated on a decision
   about `INSIGHTS-017-PALETTE` (a prose bullet today, not an item).
   **Design:** `docs/campaigns/item-87-followon-featured-intent.md` — it supplies the product
   intent and states that THIS item owns the reconciliation. Do not re-derive what it settles.
9. **Item 101** — season-boundary finals gap. Re-derive the empty window against the floating cutoff
    first; fix before late November.

**Abandoned branches — dispositions recorded 2026-09-05.** `platform/browser-poll-cadence` and
`docs/browser-poll-cadence-closeout` shipped as PR #567/#568 and are merged; their worktrees and the
closeout branch are deleted. **`platform/browser-poll-interval-v2` (`fafe4074`, 2 commits, 516
insertions) is SUPERSEDED and will not merge** — it was a parallel implementation of the same browser
cadence tiering that #567 shipped instead. Its worktree is removed; **the branch ref is deliberately
retained** because it holds a client-side poll-plan abstraction that `main` does not:
`selectLiveScorePollPlan`, `LiveScorePollPlan`, `LiveScorePollTier` and
`LIVE_SCORE_FULL_WINDOW_POLL_INTERVAL_MS`. That is prior art for the tiering question in **Item 102**
and **Item 95 portion 2** — read it before designing a poll-plan shape, rather than re-deriving one.
Delete the ref only once that decision is made.

**Interstitial, no dedicated slot:** **Item 111** (~5-minute Observability check, any time this
week). **Item 108** is CLOSED — verified 2026-09-04, live scores do tick for FBS-vs-FCS games.

**Postseason, before December:** **Item 121** (CFP first-round `eventKey` collision — dormant until
the 2026 first round is ingested, then live on the surface it breaks). Measured while verifying
Item 87's postseason grouping input; it does not block that work. **Item 120** closed at its scoping
gate, no action. **Item 122** (the historical-cache button cannot re-cache) and **Item 123**
(retire the dead postseason template) are both undated; 123 is small and adjacent to 121.

**Overview ordering:** **Item 125** portions 1 and 2 are DONE — POLISH-023, merged via PR #563
(`1546bbc8`). Schedule's final-time half shipped in PR #572; Matchups
(`MatchupsWeekPanel.tsx`) is the only remaining portion 2 surface that prints a kickoff on final rows,
which the shipped rule forbids. Small and user-facing. **Item 124** (retire the dead `sectionOrder`)
is DONE — POLISH-024, merged via PR #564 (`cac6dab9`).

**Decision parked, with the item that consumes it:** normalisation target `#0A0A0A` vs `#161616`
→ Item 119.

**Parallel tracks (added 2026-09-04).** File surfaces verified, not inferred. The server track and
the UI spine do not touch each other, so they can run concurrently:

- **Server track, strictly serial with itself:** Item 102 + 88, then Item 126. All three converge on
  `schedulerExecutionStatus.ts` / `schedulerDeliveryHealth.ts` / `systemHealthIssues.ts`.
- **UI spine, strictly serial with itself:** 115 → 119 → **134** → 118. The shared component
  widening, Schedule transition, and card-owner row modifier merged via PRs #570, #572, and #575.
  The remaining load-bearing constraint is **119 before 134**, because 119 changes the row anatomy
  134's breakpoint is derived from.
- **Independent, parallel-safe against both:** Item 122 (`admin/HistoricalCachePanel.tsx`), Item 121
  (`schedule/cfbdSchedule.ts`, `schedule.ts`, `schedulePostseasonHelpers.ts` — pipeline, not
  components), and Items 84, 86, 111. **Item 123 shipped 2026-09-04** via PR #565.

### DISPATCH ORDER — AUDIT-FIRST, owner decision 2026-09-09

**Evidence:** [`docs/archive/audits/codebase-audit-existing-plans-2026-09-08.md`](archive/audits/codebase-audit-existing-plans-2026-09-08.md)
— the single dated record. **Queue entries stay concise and link there; the narrative is not duplicated
into this file.**

**This is the one authoritative execution order.** Anything below that schedules work differently is
historical reasoning, not an instruction.

**THE LANES RUN IN PARALLEL, NOT SERIAL — owner decision 2026-09-09, amending the audit plan.** The plan
as written took the audit items across BOTH lanes before any further presentation work. **The audit does
not ask for that:** under **Valuable but deferrable** it says **"Continue presentation work with its
existing dependencies."** The plan hardened "deferrable" into "stop", and that change arrived without
evidence behind it.

**Two reasons the strict form costs more than it buys.** **No P0 was established** — 110A is the only
item with demonstrated wrong data in production, and even that is stale statistics, not wrong results.
And **Item 143 has just landed**, building the seam that unblocks Items 173, 170, 179 and the recap
adoption; stopping now banks that investment and lets the Item 87 context go cold, which is a day of
re-reading nobody has budgeted. **Two lanes exist so correctness and presentation need not queue behind
each other.**

#### Platform lane — `cfb-app-claude` — the audit spine

| # | item | what |
| --- | --- | --- |
| ✅ | ~~110A~~ | bounded recovery — **merged and applied 2026-09-09** |
| ✅ | ~~110B~~ | recurring correction reconciliation — **merged `9b150eb0`, PR #590** |
| ✅ | ~~199~~ | the catalog read `altColor`; the provider sends `alternateColor` — **merged `1cfa9df1`, PR #591** |
| **1** | **204** | **empty-body guard on the catalog refresh — BLOCKS the Item 199 resync click** |
| 2 | **188** | provider deadlines carried through body consumption |
| 3 | **20** | bounded database waits |
| 4 | **47** | admin authorization for the Insights diagnostic bypass |

> **199 CHANGES NOTHING VISIBLE — and I got this wrong in both directions before the lane measured it.**
> I first wrote that 199 only makes the colour available; the owner asked whether it changes the Item 119
> picture, and I answered that it changes rendering immediately, because `resolveTeamColorCandidate`
> rejects a primary below **0.015 raw luminance** and falls through to the alternate. **The rejection is
> real; the rendering claim was not.** `getSafeScoreboardTeamColor` has **zero production consumers** —
> the Item 199 lane proved it by renaming the export and getting one compiler error, from its own test
> file. `AGENTS.md` already said the module was "orphaned by slice 5, retained for Item 119."
>
> **The real constraint is ordering, and it is simple: 199 must merge before Item 119.** Then no team
> ever changes colour twice. Merge 119 first and ten teams show fallback green until the catalog is
> resynced, then visibly flip.
>
> **Measured over all 138 provider rows by executing the function:** 13 fall back today, **3 after** —
> Georgia Southern, Penn State, UConn, each a navy primary whose alternate is `#ffffff`, rejected by the
> extreme-neutral guard. **Ten gain a colour, including all six pure blacks.** Item 198's "six teams
> OKLCH cannot help" was never an OKLCH limitation; it was this field name.
>
> **Two measured facts moved to Item 198.** Alternates do not render at their raw ratios — California's
> `#ffc72c` emits `#98781F` at **4.75:1**, not 12.69:1, so every raw figure I quoted overstated by up to
> 2.7×. And Nevada's silver `#8a8d8f` emits **a blue**, `#6894B1`: `liftForDarkThemeContrast` inventing a
> hue for a near-neutral. That is piece 2's to answer, with the `< 0.015` floor.
>
> **199 MERGED `1cfa9df1` (PR #591), 2026-09-09. Both reviewers found nothing.** Two production lines,
> +4 tests. The evidence that carried it was two mutations: the negative test fails pre-fix BECAUSE the
> retired name was being read, pinning both directions; and renaming the STORED field produced 19 errors
> across 8 files against 4 in 1 for the provider rename, which is the scope boundary shown rather than
> asserted. `/code-review` added that `normalizeCfbdTeamRecord` is the only path from a raw CFBD teams
> payload to colours, so no second ingest needed the same fix.
>
> **The resync click is BLOCKED on Item 204.** Nothing on screen changed and the live catalog stays
> colourless until it runs; the witness when it does is `With alternate color: 0 → 138`.

**199 IS NEXT — owner decision 2026-09-09, ahead of the remaining audit items.** It is a one-word
mapping fix with a confirmed diagnosis and a measured payoff, and **it unblocks a UI item that is live
on preview right now**: Item 119's bars fall back to green on California and Nevada, and the alternate
colour that fixes both is in the provider response being discarded at ingest. **The audit items are all
latent; this one gates a UI merge.**

**It also has to precede Item 198's OKLCH port.** Fixing the mapping changes the port's input — 138
teams gain a second colour, and all six the port cannot help are rescued by their alternate without any
lift. **Building piece 2 first would be designing against a catalog known to be incomplete.**

**Scope it carefully:** the fix is the field name, plus re-running the catalog refresh so the durable
store actually gains the alternates. **The fallback RULE already exists** in
`resolveTeamColorCandidate` and fires on the alternate as soon as one is present; **tuning it — the
`< 0.015` floor, the hue a near-neutral gets lifted to — is Item 198's.**

**110A first and unconditionally.** It is the only item with measured wrong data in production, and it
is bounded — five named provider IDs, not a sweep. **188, 20 and 47 follow because they are cheap,
self-contained, and the kind of defect that costs a weekend when it eventually fires.** 110B sits last
in this lane because it is prevention rather than repair, it carries an open cadence decision, and it is
a multi-round slice.

#### UI lane — `cfb-app-codex` — convert the seam Item 143 just built

| # | item | what |
| --- | --- | --- |
| 1 | **173** | tags on Live, Recent finals and Featured — three sections render none |
| 2 | **170** | the owner name truncating, in the file 143 just finished with |
| 3 | **179** | the awaiting anchor's em dash |

**Roughly two slices.** All three were blocked on 143's status-row seam and are unblocked by it. **Do
this now rather than later** — the seam exists, the campaign context is warm, and 170 and 179 are in the
file that lane has just been working in.

#### Then both lanes converge

**189** truthful planner settings failures, **190** observable and replayable invalidation, then the
near-term integrity sequence below. **181** — the Matchups and Schedule audit — takes whichever lane
frees first, and its exclusions can drop now that 143 has merged.

**Then the immediate validation gates**, which authorize no configuration or data change on their own:
verify the effective preview database endpoint, Neon branch and role; compare deployed cached standings
against a fresh canonical rebuild using an authorized session (link the result to **190**); and obtain
actual cost evidence rather than labelling projections as realized savings.

**Then near-term integrity and readiness**, in dependency order rather than as a list: identity
collisions (**83/85**) before historical repair; **191** targeted schedule convergence; **CFP identity
gates first-round ingestion**; **archive completeness gates rollover** (**68**); partition-scoped health
(**132**) and invocation correlation (**126A**); **expected-position validation gates expanded draft
participation**.

**Remaining presentation work continues beneath all of the above, with its existing dependencies
intact — notably 119 before 134.** What the UI lane takes now (173, 170, 179) is the subset Item 143
unblocked; the rest of the Item 87 queue — 115, 119, 134, 118, the recap adoption — is sequenced after
the audit spine, not cancelled.

**No P0 was established.** Most findings are P2. **Immediate scheduling priority does not make a finding
P1**, and the queue should not be read as though it did.

#### Deliberately kept open

These are decisions, not omissions. **Do not invent values for them:**

- **Reconciliation cadence** for 110B.
- **Database timeout values** for Item 20 — the bound must fit the invocation budget, and the numbers
  are unset.
- **Historical repair policy** — what is corrected, and with what before/after evidence.
- **Preview isolation**, the deployed-standings comparison, and actual-cost validation.

#### Boundaries the audit fixed, which the queue must not blur

- **Item 140 stays score-observation measurement.** It measures when a SCORE first reads final and is
  **not** a prerequisite for statistics correction.
- **Item 131 stays a collection/cadence decision**, separate from correction.
- **"Repeatable reconciliation" permits legitimate observation-timestamp updates without duplicate
  statistics.** Repeatability is not "zero database writes".
- **Stale statistics are not score disagreement.** All 454 comparable finals agreed.
- **`NoClaim` duplication is not two competing real owners.**
- **A shared environment-variable template is not proof of effective preview database identity** — in
  either direction.

### Two-lane assignment (2026-09-05) — measured, not inferred

> **Sequences below are SUPERSEDED by the dispatch order above (2026-09-08).** The lane split and its
> reasoning still hold; the item sequences in the table are spent — 102, 129 and 126 have shipped.

Two implementation worktrees run concurrently (`CLAUDE.md` → **Worktrees and session roles**). The UI
spine is strictly serial with itself, so it occupies ONE lane entirely; the other lane takes work that
touches no component file.

| lane | worktree | what it takes |
| --- | --- | --- |
| **UI spine** | `cfb-app-codex` | work that touches component files, strictly serial with itself |
| **Platform** | `cfb-app-claude` | work that touches no component file |

> **The item sequences that used to sit in this table are REMOVED, not superseded** — every entry in
> them has shipped (102 slices 2-4, 129, 126B), and a spent sequence reads as an instruction to
> whoever scans the table. **The current order is the audit-first dispatch above.** The lane SPLIT and
> its reasoning stand; only the queue contents moved.

**Kickoffs are named `<item>-<agent>-v<n>.md`** so the target lane is legible from the filename.

**Fillers, safe against both lanes, any order:** Item 136 and Item 138 (both `matchups.ts`, worth
pairing — same file, same `NoClaim` root), Item 137 (the red-`main` time bombs, test-only), Item 133a
(below), 122, 121, 84, 86, 111. Item 139 is complete and merge-approved below.

> **Known-failure baseline:** `npm test` on clean `main` exits 1 with exactly two failures in
> `src/app/api/odds/__tests__/writer-convergence.test.ts` — see **Item 137**. This is the baseline
> `CLAUDE.md`'s merge condition 3 binds to. Exactly these two, or stop and report. **Item 135 shipped 2026-09-05** — PR #571, merged
> `ee68246c`. Both reviewers converged on the content now at `521e79d0`; the pre-rebase `a7f4dead` is
> unreachable.

**Item 135 shipped 2026-09-05.** It surfaced **Item 136** (slate aggregates double-count a self game),
which inherits its place as the first filler — same file, same 39 affected games.

**Three collisions, measured 2026-09-05. Two were not previously recorded:**

1. ~~**Item 129 collides with Item 102 slice 2.**~~ **RESOLVED — both shipped.** Retained only so
   the numbering below is stable; it schedules nothing.

**Item 135 was NOT selector-only — that claim was disproved by the build.** This entry previously read
"selector-only, verified: `MatchupsWeekPanel` consumes `opponentSummaryEntries` for `.length` alone,
so re-keying needs no panel edit." True of the original keying design; false of what shipped. The
model changed mid-branch to counting distinct games, and the panel was edited to render deduped games
and honour `isExpanded`. Recorded because a disproved claim sitting in the canonical queue is worse
than no claim: it was the basis for calling the item parallel-safe against the UI spine.

- **Dated, and it beats a deadline:** **Item 127** (retain the CFBD usage already probed) supersedes
  Item 94's manual 2026-09-30 read if it ships first. As shipped it is a STANDALONE cron route: it
  touches `game-stats/route.ts` with a comment only and does not touch `season-transition` at all, so
  it is parallel-safe against the server track. An earlier plan had it riding those two crons, which
  is where the "take it before 102" warning came from; that conflict no longer exists.

**Two collision risks are NOT in source.** `preview` is Claude's alone (`AGENTS.md` → Preview branch),
so a parallel agent must never push it — that decision exists because parallel worktrees made a single
force-pushed branch ambiguous. And **this file** is touched by every closeout: a concurrent write
already happened on 2026-09-04, when Item 126 landed on `main` mid-edit. Sequence closeouts or expect
to rebase.

Runnable at any point, no dependency on the above: **Item 42 portion 1** (notable-result
scoreboards, now unblocked by POLISH-017's final variant), **Item 84** (provider-classification
diagnostic), and **Item 86** (archive audit integrity check).

Gated: **Item 85** after 86, which is how the repair gets verified.
**Item 94** (CFBD burn-rate measurement) must be READ ON 2026-09-30, not in October — `/info`
reports the current period only and the counter resets 1 October, so a later read loses September
entirely; it is the accumulated observation **Item 63** and **Item 95 portion 2** are waiting
on.
**Item 100b** (slate marker) is **no longer date-gated** — its gate was removed 2026-09-03 after
production showed a live 2026 consequence: Featured games renders nothing from 2026-08-27 through
2026-09-07, because CFBD buckets week 0 into a 455-game, twelve-day week 1. **Item 101** matters at
the 2026-11-29 to 2026-12-12 gap, so fix it before late November. **Item 108** is a dated
OBSERVATION, not development work — read one provider-status row on 2026-09-04, the morning after the
first FBS-vs-FCS slate, and either close it or promote it.
**Item 96** is now an **offseason** item — pause the in-season QStash schedules so Neon can suspend,
worth ~$114/year with no coverage tradeoff. Its preview-retention half is DONE (2026-08-31). It is
NOT gated on Item 94: cadence is not a Neon cost.
**INSIGHTS-017-PALETTE** before precedence-reason hues matter; Item 87 renders them neutral until
then.

Offseason-gated, not now: **Item 83** (identity collision) and **Item 80** (Next 16) — both touch
systems that are live.

The 2026-08-26 roadmap audit recommends this season-reliability sequence; it is proposed ordering,
not an owner-selected `NEXT` designation. Its reassessment gate (after Item 87 slice 2) has passed —
POLISH-019 shipped slice 3 — and the 2026-09-02 order above supersedes it. Weigh this sequence again
once Item 102 retires the manual schedule switch; **Item 63 and Item 95 portion 2 additionally wait on
Item 94's 2026-09-30 measurement**:

1. Item 64(c) — align abandonment handling in resolved-week selection.
2. Item 63 — design delete-and-recreate reschedule reconciliation; also the main lever on
   score-repair latency.
3. Item 20 — bound database pool, lock, and statement waits.
4. Item 46 — prevent past-season adoption from endangering a genuine archive.
5. Items 76 and 55 — expose catalog freshness read-only and preserve structured schedule errors.
6. Item 68 — settle archive behavior when cumulative score coverage is incomplete.

## Open season-operations and provider reliability work

### Item 63 — delete-and-recreate reschedules need canonical reconciliation, and gate score-repair latency

**MIGRATED to [#630](https://github.com/znpruitt/cfb-app/issues/630) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 64 — remaining week-resolution residue

**MIGRATED to [#649](https://github.com/znpruitt/cfb-app/issues/649) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 68 — archive integrity with incomplete cumulative coverage

**MIGRATED to [#650](https://github.com/znpruitt/cfb-app/issues/650) on 2026-09-10, labelled `needs-decision`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 76 — team-catalog freshness has no read-only surface

**SUPERSEDED — closed 2026-09-10 by triage, not migrated.** `src/app/api/teams/route.ts:79-80`
now returns **both** `source: catalog.source` and `updatedAt: catalog.updatedAt`, which is the
`/api/teams` meta half of the either/or this item asked for. The admin route keeps only `POST`,
which is the sync control staying on Data Maintenance as the item also required. **The third of 57
triaged items to come back superseded.**

### Item 55 — schedule load errors lose the information required for retry

**MIGRATED to [#639](https://github.com/znpruitt/cfb-app/issues/639) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 60 — rankings recovery remains incomplete

**MIGRATED to [#601](https://github.com/znpruitt/cfb-app/issues/601) on 2026-09-10, labelled `needs-decision`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.** Triage record:
[`docs/archive/audits/queue-triage-2026-09-10.md`](archive/audits/queue-triage-2026-09-10.md).

### Item 79 — vanished-schedule observability follow-ups are evidence-gated

**MIGRATED to [#611](https://github.com/znpruitt/cfb-app/issues/611) on 2026-09-10, labelled `parked`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.**

### Item 81 — score-gap diagnostic follow-ups are evidence-gated

**MIGRATED to [#603](https://github.com/znpruitt/cfb-app/issues/603) on 2026-09-10, labelled `parked`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.** Triage record:
[`docs/archive/audits/queue-triage-2026-09-10.md`](archive/audits/queue-triage-2026-09-10.md).

### Item 95 — remaining live-score cadence work

**MIGRATED to [#604](https://github.com/znpruitt/cfb-app/issues/604) on 2026-09-10, labelled `actionable`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.** Triage record:
[`docs/archive/audits/queue-triage-2026-09-10.md`](archive/audits/queue-triage-2026-09-10.md).

### Item 96 — pause the in-season QStash schedules through the offseason

**MIGRATED to [#656](https://github.com/znpruitt/cfb-app/issues/656) on 2026-09-10, labelled `needs-decision`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 128 — every browser poll refetches the whole team catalog it already has

**SHIPPED 2026-09-04** (`PLATFORM-128-LIVE-POLL-TEAM-CATALOG-v1`). Retained below as the record of
what was found and why it was sequenced with Item 95 portion 1.

**Filed 2026-09-04, found by Codex while implementing Item 95 portion 1. Verified independently.**

**The path.** `useLiveRefresh.ts:321` calls `await fetchTeamsCatalog()` unconditionally on every
tick. That hits `/api/teams`, which defaults to `level=ALL`, reads one durable `app_state` record
holding the entire catalog, normalizes every item, applies aliases, maps and sorts every item, and
serializes the full array — which the browser then parses. 138 teams today, every tick, per visible
tab.

**The catalog is already in memory.** `CFBScheduleApp.tsx:474` loads and retains it during schedule
bootstrap, and `fetchScoresByGame` already accepts a supplied catalog (`scores.ts:429`,
`teams: providedTeams`). Passing the existing array into `useLiveRefresh` removes **one whole function
invocation, durable read, serialization and client parse per tick** — no new endpoint, no new cache.

**A team-ID-filtered endpoint is the worse fix**, and worth recording so it is not reached for: it
shrinks transfer but still decodes the full durable record server-side, which is the expensive half.

**Sequencing satisfied.** Item 95 portion 1's 90-second fast tier doubles browser ticks relative to
the 180-second baseline while armed. Item 128 merged first, so the faster tier never shipped with the
redundant `/api/teams` invocation: during the fast window, one scores call every 90 seconds matches
the pre-128 total rate of two calls every 180 seconds while improving expected display staleness by
about 25%.

**Two adjacent inefficiencies found in the same pass, not part of this item's fix:**

- `loadReconciledWeekScores` (`server/scoreCacheReader.ts:246`) narrowed its HTTP response to one
  week, but still reads every `${year}-` score entry and reconciles the whole season type before
  filtering. The comment at `:255` states this deliberately — provider-week and canonical-week alias
  children must both contribute — so it is a known trade, not an oversight. Recorded so a future
  reader does not re-derive it.
- Game-stats canonical context also loads the full team catalog.

**Acceptance boundary:** an auto-poll tick issues no `/api/teams` request, and the catalog used for
score attachment is the same array the bootstrap already resolved. A test proves the tick makes one
request rather than two.

- Backlog slug: `PLATFORM-POLL-REUSE-TEAM-CATALOG-v1`

### Item 127 — sample CFBD usage on its own schedule and retain a daily series

**Filed 2026-09-04. Supersedes Item 94's manual read if it ships before 2026-09-30.** Owner question:
"why not just daily logging? it's a free call." `/info` is unbilled — confirmed by CFBD's developer 2026-09-04, so the sampling costs no
CFBD quota — but it is a dedicated route on its own six-hourly QStash schedule, not a free ride on an
existing job. Retaining the observation the game-stats probe already makes was built and removed: one
durable row with two writers cost more than the resolution it bought.

**The observation is already being made and discarded.** `src/app/api/cron/game-stats/route.ts:284`
calls `fetchCfbdUsage({ fresh: true })` — the `/info` quota probe, explicitly not a billed provider
call — reads `remaining` and `limit` for the quota-reserve gate, and keeps nothing.
`systemHealth.ts:208` and `/api/admin/usage` normalize quota too, but on demand for display, not as a
record. This is Item 126's shape in a different place: an observation made, not retained.

**The probe is gated, so it is not a daily source.** It sits behind three early returns
(`route.ts:240-262`), the decisive one being `resolution.target === null`, commented "No exact target
→ no scoped attempt, **no usage check**, no provider call". It fires only when a polling target
exists inside the window, so a quiet Tuesday produces no sample — which is precisely the day the
series needs in order to say what a Saturday costs by comparison.

**Why a dedicated route rather than an existing cron.** `season-transition` is the only cron that
runs unconditionally every day, but it holds a deliberate guarantee that a refused run makes ZERO
outbound provider requests, pinned by its own tests. Carrying an unconditional probe there would
weaken a lifecycle route's guarantee to serve another concern's bookkeeping. A route whose only
contract is "one unbilled probe per run" violates nothing, and can also sample more often than daily
— which bounds the month-boundary tail loss that daily sampling cannot.

**Acceptance boundary:** after a month of running, the store alone answers "what did we burn in
September, and on which days" without a manual read, and its size is bounded by a stated rule rather
than growing per probe. Observation-only — it must not affect the quota gate, the refusal path, or
any provider outcome.

- Backlog slug: `PLATFORM-RETAIN-PROVIDER-USAGE-SERIES-v1`

### Item 126 — schedule-refresh incident evidence is not durable enough to explain the failure

**SPLIT 2026-09-07, and the split is MANDATORY, not preference.** `AGENTS.md` → **Scope and sizing**
requires a planning split when work crosses separate automation jobs. Tier A crosses **seven**; Tier B
crosses **two**. They cannot ship as one PR.

- **Tier B is COMPLETE.** Execution record:
  [`docs/prompt-registry.md`](prompt-registry.md) → `PLATFORM-126B-INCIDENT-EVIDENCE-CLAUDE-v1`.
  **SCOPE APPROVED 2026-09-07 by the owner**, per `AGENTS.md` → Scope and sizing, which requires the
  approval and the diffstat be recorded here. Approved at **+2,693/−96**, and the figure moved once
  more when the owner authorized a second remediation round; the shipped measurement is **31 files
  under `src/`, +2,817/−96 — 16 production files (+739/−57) against 15 test files (+2,078/−39)**.
  Both stop-and-reassess signals are crossed. Approved because production is well inside the 1,500
  threshold and the test bulk is the same document's "every surface a PR touches must carry its own
  tests" applied across two automation jobs; splitting a cohesive production change because its
  tests are thorough would set the rule against itself. A further split was also rejected on the
  implementer's argument that it breaks the item's own contract — one shared vocabulary across both
  jobs, and route coverage for both in the same PR.
  (An earlier +2,709/−112 was recorded from a relayed message rather than a `git diff --shortstat`
  and corrected 2026-09-07. Every figure above is measured at the shipped commit.)
  Two findings deliberately scoped out and filed instead: **Item 145** (debug logger) and
  **Item 146** (secret-scan population). **Item 147 closed inside this slice** — the owner ruled it
  in rather than leave the two jobs' response-body pins asymmetric. Kickoff
  [`docs/prompts/platform-126b-incident-evidence-claude-v1.md`](prompts/platform-126b-incident-evidence-claude-v1.md).
  Taken first because it is the tier that would have explained the September 1 failure. Tier A's value
  is capped anyway: it correlates runtime logs that expire.
- **Tier A remains open** — `invocationId` on every structured cron runtime event. **0 of NINE
  modules carry it**, corrected 2026-09-07: my "0 of 7" came from `find -name cronExecutionLog.ts`,
  which misses `lifecycleCronExecutionLog.ts` and `pollingPlannerCronLog.ts` — both real cron logs
  with different filenames. `EXTERNAL_SCHEDULER_JOBS` is **ten** jobs. The direction held; the count
  did not, and **Tier A is sized off that count.**

**Layer 3 is no longer a prediction — production has realised it.** Read 2026-09-07, 153 hours after
the incident: `provider-refresh-status` for `schedule:year:2026` now holds
`lastError: null, lastSuccessAt: 2026-09-07T14:03:14.993Z`. A later success **overwrote the failed
attempt whose details the postmortem needed**, exactly as this item predicted. The September 1
evidence is unrecoverable; the entire surviving record is `failure / year-results` over
`years: [{ year: 2026, operation: "ordinary-maintenance" }]`.

**And the loss at layer 1 is two problems, not one** — verified at `schedulerExecutionStatus.ts:380`.
`scheduleYearsTarget` RECEIVES `scoreRepairs`, `scoreDifferenceCount`, `scoreSweepFailedPartitions`,
`scoreSweepCannotTellCount` and `kickoffsChanged` per entry and discards them to run level at `:396`;
it never receives `result`, `reason`, `providerCallAttempted`, `rowsReceived`, `rowsCommitted` or
`dataChanged` at all. The fixes differ.

**And `failedSeasonTypes` is a THIRD case, one layer earlier — found 2026-09-07.** This entry listed
it with the never-received group, which is wrong: it is not on `ScheduleRefreshCronYearExecution`
either, so widening the target builder cannot reach it. The authorities already compute it
(`fullSeasonScheduleRefreshResult.ts:69`, `refreshAuthority.ts:443`); the ROUTE drops it when
building its year entry. Reaching it changes the runtime event too.

**Filed 2026-09-03 from `SCHEDULE-REFRESH-FAILURE-DIAG`.** The September 1, 2026 12:00 UTC weekly
schedule refresh is the production proof of the gap. QStash successfully delivered the request and
received HTTP 200, while TurfWar durably recorded invocation
`d563a545-3204-4cd2-8530-55de43149c46` as `failure / year-results`, with
`providerCallAttempted: true`, target `2026 / ordinary-maintenance`, and `durationMs: 37124`.
Controlled application failures intentionally return 200; do not collapse scheduler delivery and
application execution into one success/failure bit or change that contract incidentally.

The detailed incident record and evidence classification live in
`docs/operations/diagnostics.md`. Its high-confidence—but not definitive—diagnosis is a transient
CFBD schedule-partition timeout exhausting the current three 12-second attempts. The 37.1-second
duration and a same-day explicit rankings provider failure after 36,917 ms support that conclusion;
a later 4,249 ms manual schedule success through the unchanged shared authority argues against a
deterministic schedule, normalization, credential, or persistence defect. The exact failed season
type and timeout/network/HTTP/parse category are no longer provable. The September 3 QStash manual
run's `401 invalid cron authorization` is a separate pre-authentication configuration issue, not an
explanation for this authenticated provider-attempting invocation.

The loss occurs at four layers:

1. `scheduleYearsTarget` persists only year/operation per target. It drops the per-year `result`,
   `reason`, `providerCallAttempted`, `failedSeasonTypes`, `rowsReceived`, `rowsCommitted`, and
   `dataChanged` that could distinguish provider, completeness, commit, and score-sweep paths.
2. `schedule-refresh-cron` carries more per-year detail but lacks `invocationId` and failed season
   types, and Vercel runtime logs expire too quickly to serve as incident history.
3. `provider-refresh-status` is latest-only; a successful manual repair can replace the failed
   attempt whose details are needed for the postmortem.
4. `fetchFullSeasonSchedulePartition` reduces timeout, network, HTTP, and JSON-parse exceptions to
   `fetch-failed`, so even the provider status does not retain the underlying safe transport class.

Implementation boundary, in two tiers. **The tiers are deliberate and must not be collapsed** —
one is platform infrastructure, the other is multi-year diagnostics, and they have different
blast radii.

**Tier A — universal, all seven cron jobs.**

- Add the application-generated `invocationId` to every structured cron runtime event, so a runtime
  log correlates directly with its durable receipt. This is `schedule`, `rankings`, `odds`,
  `liveScores`, `gameStats`, `teamRecords` and `lifecycle` — seven separate `cronExecutionLog`
  modules, none of which carries the field today. Done once here rather than six more times later.

**Tier B — `schedule-refresh` and `rankings` only. These are the two multi-year jobs.**

- Extend each durable receipt year entry with the exact allowlisted per-year `result`, `reason`,
  `failedSeasonTypes`, `providerCallAttempted`, `rowsReceived`, `rowsCommitted` and `dataChanged`
  values the authority already produces. A run-level result cannot say _which year_ failed when a
  run spans several.
- Preserve a closed, secret-safe upstream class (`timeout`, `network`, `http` with numeric status,
  or `parse`) in place of the `fetch-failed` collapse — never raw errors, response bodies, URLs,
  headers, or payloads. The collapse exists identically in both jobs
  (`schedule/fullSeasonScheduleFetch.ts:67`, `rankings/refreshAuthority.ts:111`).
- Let System Health expose the retained stable reason/partition evidence instead of only the generic
  "execution failed" copy, without treating observability metadata as canonical data truth.

**Explicitly NOT in scope: do not generalise per-target outcome structures into the single-unit
jobs.** `live-scores`, `game-stats`, `odds` and `team-records` process one unit per run, so the
run-level `result`/`reason` already identifies what failed. Their targets record only what was
attempted (`targetGames`, `eligibleGames`, `week`) and that is sufficient for a single-unit run.
Widening them for symmetry would grow the receipt contract for every job to solve a problem two jobs
have. Owner decision 2026-09-04.

**Split out of this item: `provider-refresh-status` is latest-only.** That is a real and _universal_
observability limitation — one shared store keyed by dataset scope, where a successful manual repair
replaces the failed attempt whose details the postmortem needs, for any dataset. It is recorded here
as a future recommendation and is **not** part of this item's boundary. A small bounded
provider-attempt history per canonical target is the candidate fix, with defined count/age bounds and
retained attempt/commit ordering. **Condition to fold it back in:** planning shows the bounded history
can be added without materially expanding storage or retention scope. Until that is shown, it stays
separate — retention is a different kind of change from a receipt field, and pulling it in silently is
how an observability item becomes a storage item.

**Scope note added 2026-09-04 — the gap is not schedule-only, and the shape matters for how this is
built.** Owner observation, then checked per layer against all seven cron jobs:

| Loss layer                                            | Actually scoped to                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Per-unit `result`/`reason` dropped from the target | **schedule-refresh AND rankings.** Both carry `years: Array<{ year, operation }>` and drop the rest. The single-target jobs (`live-scores`, `game-stats`, `odds`, `team-records`) have one unit per run, so the run-level `result`/`reason` covers them — but their targets record only what was ATTEMPTED (`targetGames`, `eligibleGames`, `week`), never an outcome. |
| 2. Runtime event lacks `invocationId`                 | **All seven.** There are seven separate `cronExecutionLog` modules (`schedule`, `rankings`, `odds`, `liveScores`, `gameStats`, `teamRecords`, `lifecycle`) and `invocationId` appears in none of them. The receipt carries it (`schedulerExecutionStatus.ts:289`); the event does not, so no job's runtime log can be correlated with its durable receipt.             |
| 3. `provider-refresh-status` is latest-only           | **Universal.** One shared store keyed by dataset scope. A successful manual repair replaces the failed attempt for any dataset, not just schedule.                                                                                                                                                                                                                     |
| 4. Upstream class collapsed to `fetch-failed`         | **schedule AND rankings**, identically: `schedule/fullSeasonScheduleFetch.ts:67` and `rankings/refreshAuthority.ts:111`. Both discard timeout vs network vs HTTP-status vs parse.                                                                                                                                                                                      |

**Resolved by the owner 2026-09-04, and reflected in the boundary above.** Layer 2 goes platform-wide
because it is a one-field change repeated across seven modules — cheap once, expensive seven times.
Layers 1 and 4 cover schedule and rankings, the two multi-year jobs, which share both the
`years: Array<{ year, operation }>` target shape and the `fetch-failed` collapse. Layer 3 leaves this
item. The single-unit jobs get nothing beyond Tier A.

Keep timeout reliability separate in Item 93. This item must not change the provider timeout/retry
policy, scheduler HTTP semantics, QStash configuration, or canonical schedule behavior.

Acceptance boundary. **Tiered to match the implementation boundary — a criterion in one tier must
not be read as a requirement on the other.**

**Universal (Tier A), verified against all seven jobs:**

- For every cron job, the runtime event and the durable receipt share the same invocation id, and no
  scheduler- or provider-supplied identifier is trusted as that identity. A test names the jobs it
  covers; "the schedule job correlates" does not satisfy this.
- The id is observability-only: failing to generate one skips the receipt without any behaviour
  change, as today.

**Multi-year diagnostics (Tier B), `schedule-refresh` and `rankings` only:**

- Given an authenticated invocation that reaches provider work and fails at each controlled
  post-provider boundary, its durable receipt _alone_ identifies the per-year result, stable reason,
  attempted/failed season types, provider-attempt flag, row counts and data-change state — after
  runtime logs expire, and after a later manual refresh succeeds.
- A timeout can be distinguished from network, HTTP-status and parse failure without persisting
  credentials or arbitrary provider/error content.
- The single-unit jobs are unchanged by this tier. A diff touching `live-scores`, `game-stats`,
  `odds` or `team-records` targets is out of scope and should be reported rather than shipped.

**Both tiers:**

- Everything added is observation-only and cannot affect response status, provider outcome, canonical
  data, or the best-effort receipt contract.
- HTTP 200 remains the response for controlled operational failures unless a separate task
  intentionally redesigns QStash retries, quota consequences, and idempotency together.

- Backlog slug: `PLATFORM-SCHEDULE-REFRESH-FORENSICS-v1`

### Item 144 — reconcile the Item 87 design-document set before the presentation follow-on

**The ask:** make the design documents say what is currently true, so a prompt written from them
stops inheriting overturned claims. **This BLOCKS Item 143, and after 2026-09-08 it blocks the whole
remaining spine queue — 115, 119, 134, 118.**

**Kickoff:** [`docs/prompts/platform-144-item-87-doc-reconciliation-claude-v1.md`](prompts/platform-144-item-87-doc-reconciliation-claude-v1.md)
— **assigned to the IMPLEMENTATION Claude lane by owner exception 2026-09-08**, recorded in
`CLAUDE.md` → **Worktrees and session roles**. `docs/` normally belongs to planning; the exception is
conditional on the planning lane standing off `docs/campaigns/item-87-*` and this entry's own Item 87
neighbours for the duration.

**WHAT THIS IS, PLAINLY: a session's work, no shipped output, and it unblocks 115, 119, 134 and
118.** Not a tidy-up. Do not squeeze it between implementation slices.

**Scope — 2,273 lines across 16 documents, of which perhaps 350 have ever been read.**
`live-watchlist-scoreboard.md` alone is **651 lines** and three of them have been read; every "canonical
for X" claim made about placement or the record rule rests on those three spots. **This is not a
document set with some stale entries. It is a document set that has never been read.**

**READ ORDER — owner decision 2026-09-08, and the first choice was corrected.**

1. **`live-watchlist-scoreboard.md` (651 lines) FIRST.** It is canonical, so until it is read end to
   end every claim about what is canonical is unverified — **including the ones this index rests on.**
2. `team-highlight.md` (90 lines) — the one whose status mark was already wrong.
3. The remaining thirteen.

**OUTPUT IS EDITS, NOT A REPORT.** A report is a sixteenth document describing fifteen others and goes
stale the same way. **Mark each claim in place** — current / superseded / discharged — and promote the
index entries from "the owner's best knowledge" to **verified**. That is what makes the reading
something the next person inherits rather than redoes.

**THREE VERDICTS, and discharge is the one that saves time.** Of the ten known claims in
`matchups-schedule-design.md`, **at least five are DISCHARGED rather than stale** — the work was done
and nothing marked it: `rank`/`rankSource` both exist, `neutralSite` is at `CompactGameScoreboard:23`,
the contract widenings are in `DESIGN.md`, the recommended sequence has shipped. **An obligation
satisfied and unmarked gets re-litigated as an error**, and one already was.

**Do NOT transfer that ratio to the unread 1,900 lines.** The owner sized the item as "roughly half"
on that arithmetic and withdrew it: it is a ratio measured on a sample of identified claims and says
nothing about the population nobody has read.

**A correction to this entry's own earlier escalation, recorded rather than edited away.** It
previously read _"the stale documents have now produced SHIPPED CODE"_, citing the owner-row tint. That
was wrong. `team-highlight.md` is **CURRENT** and does not conflict with `presentation-decisions.md` —
`:23` rejects owner-IDENTITY colour while `presentation-decisions.md:90` gives the tint OUTCOME
direction; different axes, both hold. **No document was wrong. Two readers asserted the contents of a
ninety-line file neither had opened.** The rail/tint collision in shipped code is real and still blocks
Item 119; its cause is that the tint's outcome-tracking was never implemented and the rail never
retired.

**WHY THIS HAS NOT HAPPENED, because the same pressure will apply again.** A full read costs a large
chunk of context and produces no commit and no shipped fix, while every individual question along the
way was answerable by grepping the specific claim. **Each grep looked like the efficient choice.** The
cost only appeared in aggregate — three wrong statements and one wrong implementation.

**Full analysis:**
[`docs/campaigns/item-87-followon-matchups-gap-analysis.md`](campaigns/item-87-followon-matchups-gap-analysis.md),
owner-authored 2026-09-08, ordered by member impact rather than item ownership — deliberately, because
sorting by item is what let these accumulate. It also resolves a question this ledger had left open:
**"records stay off Matchups" and `DESIGN.md:95` cannot both hold**, because the anchor holds the
record when a game is scheduled. Deferring records leaves the majority of rows structurally
incomplete.

**Owner diagnosis, 2026-09-07 — structural, not a set of typos.** Roughly **fifteen additive
follow-on documents** were written, each superseding parts of earlier ones **without editing them**,
on the reasoning that editing committed docs loses history. The result: the newest statement is
correct, the older ones still read as current, and **nothing errors when a rule is overridden**. So
deciding anything from the design doc means deciding from claims that three later documents have
already reversed.

**Ten stale claims found in one read** of `item-87-followon-matchups-schedule-design.md` — the fourth
time that document has produced a wrong prompt:

- the "Contract widenings — currently unrecorded" section (classification/FCS, neutral-site metadata,
  non-final broadcast and tier 2 are all implemented and in `DESIGN.md`)
- "renders `#rank` only today" and "no neutral-site marker"
- "no precedence rule is needed" — the canonical rule is that rank wins a ranked-FCS collision
- present-tense Schedule defect claims about the collapsed owner line, `NoClaim`, lowercase fallback
  and amber `cardEmphasisClasses` — all describing retired code
- "the Schedule filter already cuts it to the live handful" — that is Item 118, unbuilt
- "Open — card-owner treatment" and its dimming choice — settled as a neutral tint 2026-09-05
- "the row treatment is now identical" / "only two things vary per consumer"
- "suppressed on Schedule" — narrow to "the odds FOOTER is suppressed"; Schedule keeps odds in tier 2
- the recommended sequence — the widening and the Schedule conversion have shipped

**And the mockup has the same disease.** `matchups-schedule-mockup.html` carried a pill rule setting
`#dbc190` and a later typography rule restating it as `#c9a66b`, so it rendered one value while the
document stated another. **Owner fixed that one 2026-09-07** (the typography rule no longer sets
colour). The rest are the same shape — narrow-layout wrapping against the unconditional nowrap rule,
stale green live treatment, rejected outcome-coloured tints, negative vertical tint bleed.

**INTERIM AUTHORITY, owner ruling 2026-09-07, until this pass is done:** the **mockup is
authoritative for layout and structure**; the **document set is authoritative for values**. Do not
read a colour off the mockup or a layout off the prose.

**Two acceptable shapes — owner's choice:** correct the stale claims in place with a note of what
superseded each, or add a status header to each section naming the document that overrides it. The
first is cleaner to read; the second preserves the history the additive approach was protecting.

**Blocker:** none, but **Item 143 should not be written until this lands**, or the follow-on inherits
the same problem.

### Item 143 — DONE: Matchups status-row seams and shared kickoff state

**The ask:** decide, against the component's actual seams, how Matchups renders its status pill, live
indicator, eyebrow tags and odds. **Split out of Item 117 on 2026-09-07** after the receipt gate found
that none of the four fits an existing slot.

**Kickoff:** [`docs/prompts/platform-143-matchups-status-row-codex-v5.md`](prompts/platform-143-matchups-status-row-codex-v5.md).

**Implemented on `codex/143-status-row-v2` (`63e92a15`, `71cf1250` + this closeout), merge
pending.** The reconstruction adds one pure `(score, kickoff, now)` scoreboard-state projection with
four explicit precedence branches: usable final, live, scheduled (future/TBD/unparseable), then
awaiting after kickoff. Matchups supplies those facts rather than deciding its label locally, so a
pre-kickoff row says `SCH` and a post-kickoff row without a usable score says `Awaiting score`.
Overview consumes the same projection while keeping its disruption guard, sectioning, eight-hour
omission, and polling concerns unchanged.

Tags move from tier 2 into the shared status row through a right-aligned seam: the metadata group is
`flex-auto min-w-0`, the tag group is `flex-none`, and only tagged scheduled rows wrap at phone
width. The fixed `h-4` slot also carries `leading-none`; without it the shared 10px eyebrow pill is
about 18.33px tall inside a 16px clipped row. Matchups forwards the settled neutral live hue and a
freshness-gated, `motion-safe` pulse. No odds, disrupted-status rendering, awaiting timeout,
`statusMetadataSlot`, or Schedule change entered the slice.

Both independent reviews ran against `d399411a`. They produced three unique findings: two were
refuted by v5's measured disrupted/awaiting rulings, and both reviewers independently found the real
vertical-clipping P2. Its one-class remediation is `71cf1250`; the strengthened structural test was
first observed failing against the clipped code, then passed 30/30. On that clean exact commit,
`npx tsc --noEmit` and `npm run lint:all` exited 0; `npm test` exited 1 with 4,990/4,992 passing and
exactly Item 137's two recorded failures. Test delta remains +5. **Static JSDOM markup cannot prove
rendered pixel height**; the recursive renderability detection preserves the exact untagged branch.
V5's final diff before this closeout is 12 files, +467/−95 after rebasing onto current `main`, versus
v3's 6 files, +559/−91; the reconstruction's net growth is 372 lines versus v3's 468, 20.5% smaller.

> **v3 STOPPED AND RECONSTRUCTED, 2026-09-08.** Branch `codex/143-matchups-status-row` at `7d6c28ca`
> did not converge: three rounds, both remediation rounds exhausted, four findings still open. **The
> implementer called the stop itself and was right** — the round-3 MEDIUM is the same defect class as
> round 1's, _a local label asserting more than the classifier established_, which is this campaign's
> recorded signal that the MODEL is wrong rather than the patch.
>
> **The measurement that explains why, which the v3 prompt could not carry because it predates it:**
> the branch added **23 references to disrupted / suspended / postponed / cancelled against 3 for
> `awaiting`** — and **Item 172 established the same day that disrupted statuses do not exist in
> production.** 22,761 schedule rows are all `scheduled`; score packs are only `final` or `scheduled`.
> **Two remediation rounds and most of the added surface hardened a state the provider never emits**,
> while the reachable defect — a post-kickoff row with no score rendering `SCH` — surfaced only in
> round 3 and remains open.
>
> **Nothing about the reviews was wasted; the code is what is discarded.** Confirmed correct and
> carried into v4: the tag flex seam, scheduled-only phone wrapping, and the ruling that neutral live
> hue stays (motion is the differentiator, not colour). `statusMetadataSlot` is scope residue with no
> caller and does not return.
>
> **MERGED 2026-09-08 as v5 — PR #587, `ac965a19`.** The shared projection landed as
> `src/lib/selectors/gameScoreboardState.ts`; Overview consumes it and keeps its own ownership,
> pending, abandonment and omission gates.
>
> **THE SIZE PREDICTION WAS WRONG, AND IT WAS MINE.** v5's output contract asked for both diffstats
> and said that if the reconstruction were not materially smaller, that would be **a finding about the
> ruling rather than about the work**. Measured on merge-base diffs: **v3 was 6 files, +559/-91; v5 is
> 15 files, +539/-98.** Effectively the same volume across more than twice the files.
>
> **The right reading is that the model change RELOCATED the work rather than reducing it.** Removing
> scope — disrupted states, `statusMetadataSlot` — freed lines that extraction then spent: a shared
> module costs a new file, its tests and two consumers, where a local condition costs none of those.
> **v3's lines went to branches for a state that cannot occur; v5's go to a seam four surfaces can
> use.** Same size, different asset. **Do not use diff volume as the test of whether a reconstruction
> worked** — it measured the wrong thing here, and the comparison was not reported back, so nothing
> caught it before the merge.
>
> **THE TABLE BELOW IS STALE — re-verified against `main` at `0ab9b76d`, 2026-09-08, and TWO of the
> four have moved.** **Odds on live/final is RESOLVED**: Item 155 replaced the `state === 'scheduled'`
> gate with a content test (`CompactGameScoreboard.tsx:245`, `hasFooterSlot`), so a caller may pass a
> footer in any state today. **The live indicator is PARTLY RESOLVED and much smaller than filed**:
> `gameUi.ts:118` already accepts `liveHue: 'neutral'` and `liveDot: 'pulse'`; the scoreboard simply
> calls it with no options (`:107`), so this is prop forwarding rather than a redesign. **The eyebrow
> tags and the status pill remain live and are the item.** The prompt carries the corrected table;
> build from it, not from here.

**These are not wrong decisions — they are decisions specified without checking the surface they land
on.** Recorded so the follow-on is designed against the component's real shape rather than
re-deriving the requirement and hitting the same wall:

| divergence | why it fits neither slot, verified on `main` |
| --- | --- |
| **eyebrow tags in the status row** | `contextSlot` renders in its own `div` ABOVE the header (`CompactGameScoreboard.tsx:121`), so tags there ADD A LINE — the exact defect the presentation doc says to avoid, now caused by the injection point rather than the markup |
| ~~**odds on live/final**~~ **NOT A DIVERGENCE — corrected 2026-09-08** | **This row was the origin of a wording that reached four documents.** It recorded a component GATE as a presentation REQUIREMENT. The mockup carries **no odds on live or final rows** (all six `sb-odds` elements sit in scheduled blocks), and the design document names no state. Item 155 removed the gate (`:245`, content-based). **The scheduled half is real and is Item 168.** |
| **status pill** | the component owns `statusLabel`; Matchups' `SCH`/`LIVE`/`FINAL` cannot be injected |
| **live indicator** | the component's is hardcoded; Matchups requires a neutral, freshness-gated pulse |

**The seams are the constraint.** Any option here is either a component widening or a consumer
concession, and `CompactGameScoreboard` has already been widened once by slice 5a and once by 5b — a
third and fourth driven by one consumer is how a shared component becomes the union of its callers.

**SECOND CONSUMER, added 2026-09-08: the WEEKLY RECAP.** Owner ruling — the recap adopts the same
component rather than shared primitives, because it built its own scoreboard before the component
existed and has since drifted: stacked tags instead of right-aligned, per-category hues instead of
the bronze pill, no colour bar, metadata restating the scores. **None of that was decided; it is what
a parallel implementation does when the shared one moves.** Primitives would not have prevented it —
they only make divergence cheaper to write.

**Seams verified against the code BEFORE scoping, 2026-09-08** — the lesson from Item 117's round,
where four "fits neither slot" findings surfaced only at the receipt gate. The recap needs **a tag in
the status row** and **metadata beside it**. The header row (`CompactGameScoreboard.tsx:127-131`) is
entirely component-owned — `statusLabel`, schedule notice, `clockLabel`, broadcast, `neutralSite`,
scalar props in fixed order, **no injection point.** So both recap requirements are this item's
existing tag-placement divergence. **The recap adoption is BLOCKED on this item** and would otherwise
reproduce Matchups' findings exactly.

**DERIVE THE SLOT FROM BOTH CONSUMERS, NOT ONE — this is the reason the second consumer matters.** A
slot designed against a single consumer fits that consumer's shape and nothing else, which is how
`contextSlot` ended up ABOVE the header row rather than inside it. Matchups needs the tag on
**scheduled** rows; the recap is **all finals**. Scoping from Matchups alone would likely produce a
tag slot that works on scheduled rows and needs a second widening for finals. Deriving from both
states now costs nothing.

**THE MOCKUP IS NOT AUTHORITATIVE ON RADIUS, PADDING OR TRACKING — owner, 2026-09-08. This narrows
the interim authority ruling.** That ruling said mockup for **layout and structure**, documents for
**values** — and radius and padding read as layout, so it would otherwise cover them. It does not:
**`3px` radius and `1px 5px` padding were set incrementally while building the mockup and were never
derived.** They are not settled decisions.

So Item 143 must **pick whichever reads better on a real slate and record the reason**, not inherit the
mockup's numbers because the mockup is authoritative elsewhere. **Being right about colour and
placement does not make a file right about every dimension it happens to specify.**

Concretely divergent today, all three deliberately left alone by Item 153 as out of its scope:
`rounded-full` vs `3px`; `px-1.5 py-0.5` vs `1px 5px`; `tracking-wide` (0.025em) vs `0.08em`.

**A third undecided divergence, surfaced by Item 144's read:** the mockup omits **broadcast** on
Matchups rows while showing it on the Schedule copy of the same game (`mockup:606`). **No document
decides this.** `CompactGameScoreboard` shows broadcast on any non-final state, so Matchups either
passes it or does not — and neither choice is recorded. Settle it here rather than leaving two
surfaces to diverge again.

**The shape most likely to be missed — put it in the acceptance contract.** The recap's status row is
frequently **tag-only**: after the derivability rule, **six of seven mockup rows carry no metadata at
all**, just the pill. So the slot must handle an **empty left group without collapsing the tag's right
alignment.** Matchups never exercises this — it always has a state label holding the left side open.
A real shape, not a hypothetical.

**Blocker: Item 144.** The document that would settle these is the one with ten stale claims in it.

### Item 147 — DONE: the schedule cron's response-body keys are pinned

**The ask:** pin the `schedule-refresh` cron's response-body keys, as `rankings` now is.

**Filed 2026-09-07 from Item 126B's confirming review, and it is half a fix rather than new work.**
126B's finding 2 was a leak into the **QStash response body** — the rankings cron returned
`exec.years` verbatim, so `failedPartitions` crossed into the body. It shipped because **only the
log-event keys were pinned; nothing pinned the body.** The fix added an allowlist projector and a body
key pin — **for rankings.** `responseYearEntry` on the schedule side is referenced by no test.

**So the two jobs now differ in a way nothing records as deliberate**: one is pinned against exactly
the leak that occurred, the other is not, and the unpinned one is the job the whole item was written
about.

**Pre-existing rather than caused by 126B's remediation round**, which is why it was correctly
excluded from that round's scope under `AGENTS.md`. Filed so the asymmetry is a decision rather than
a gap.

**Blocker:** none. **Closed 2026-09-07 inside Item 126B's second remediation round** — the owner
ruled it in against the letter of `AGENTS.md`'s follow-up rule, because leaving it would have
recorded the asymmetry as a decision nobody made. See
[`docs/prompt-registry.md`](prompt-registry.md) → `PLATFORM-126B-INCIDENT-EVIDENCE-CLAUDE-v1`.

### Item 148 — only Overview can render `awaiting`; Schedule and Matchups cannot

**MIGRATED to [#680](https://github.com/znpruitt/cfb-app/issues/680) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 151 — `buildCfbdGamesUrl`'s `division` parameter is inert; CFBD ignores it

**MIGRATED to [#660](https://github.com/znpruitt/cfb-app/issues/660) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 150 — stop ingesting D-II/D-III: schedule fetch filter and records prune

**MIGRATED to [#659](https://github.com/znpruitt/cfb-app/issues/659) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 149 — 56% of the schedule is D-II/D-III games nothing displays

**ANSWERED — the decision was taken 2026-09-08 and this entry is spent.** It asked whether the
canonical schedule should carry games with no FBS or FCS participant. **Owner ruling: D-II and
D-III are never used in-app; FCS stays**, because it appears only against FBS schools (127
FBS-vs-FCS games in 2026) and those rows render the FCS opponent with its record.
**The ruling and the build both live in [#659](https://github.com/znpruitt/cfb-app/issues/659).**
Kept as a pointer rather than migrated — a decision item whose decision exists is not open work.

### Item 152 — the Schedule three-column breakpoint reproduces nowhere

**MIGRATED to [#681](https://github.com/znpruitt/cfb-app/issues/681) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 153 — DONE: three surfaces, three eyebrow treatments, and one was the blue violation

**Shipped on `claude/153-eyebrow-treatment` (`8cb888e9` + `10d0e046`), merge pending.** One shared constant in `src/lib/gameUi.ts`; no component carries a bronze literal. Reconciled on `0.5px` border and 10px text, so **Schedule's border visibly changed from 1px** — each surface had had exactly one of the two right. Overview's reason row is plain bronze and its conference-championship badge is neutral slate, not bronze. Radius, padding and tracking held as shipped per `AGENTS.md`. `DESIGN.md` amended in four places, including the amber `upset` border recorded as deliberately retired (CARRY row 4). **Two things the prompt did not have:** there were five blue spots in the three files, not four, and a fourth eyebrow spelling — Overview's neutral chips — which the conversion also made uppercase and unfilled. Follow-ons filed as Items 157 and 158. Registry: `PLATFORM-153-EYEBROW-TREATMENT-CLAUDE-v1`.

**Kickoff:** [`docs/prompts/platform-153-eyebrow-treatment-claude-v1.md`](prompts/platform-153-eyebrow-treatment-claude-v1.md).
**Four blue spots, not one** — `OverviewPanel.tsx:195` (the chip) and `:755` (the reason row); the
receipt separates eyebrows from legitimate interactive blue. Also carries **CARRY row 4**: this is the
natural place to record the amber `upset` border as deliberately retired, since the slice makes the
pill the single emphasis instrument across three surfaces.

**The ask:** one eyebrow treatment across Overview, Schedule and Matchups. **Overview is still the
`DESIGN.md` violation Item 117 fixed elsewhere.**

**Measured 2026-09-08:**

| surface | treatment | state |
| --- | --- | --- |
| Overview (`OverviewPanel.tsx:755`) | `text-blue-700 dark:text-blue-300` | **LIVE VIOLATION** of `DESIGN.md` — blue signals interactivity or active state only, never "featured" or "important" |
| Schedule (`GameWeekPanel.tsx:18`) | `border-[#c9a66b]/40`, `text-[10px]` | bronze, one syntax |
| Matchups (`MatchupsWeekPanel.tsx:35`) | `border-[0.5px] border-[rgba(201,166,107,0.40)]`, `text-xs` | bronze, another syntax and a different size |

**Filed as ONE item, not two, and the reason is the drift itself.** Codex flagged the
Schedule-versus-Matchups divergence during Item 117 and correctly scoped it out of that slice. But
fixing Overview alone would produce a third bronze spelling; unifying Schedule and Matchups without
Overview would leave the violation. **The three are one decision: pick the treatment, put it in one
constant, use it in three places.**

**The divergence is the same shape Item 143 exists for** — two implementations of one treatment drift
because nothing shared holds it. A single exported constant is the fix; three near-identical string
literals is the defect.

**Not blocked by Item 143.** That item owns where the tag SITS in the row; this owns what it looks
like. Independent, and this one carries a live violation.

**Blocker:** none.

### Item 154 — postseason round grouping is specified in three documents and has no item

**MIGRATED to [#682](https://github.com/znpruitt/cfb-app/issues/682) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 156 — Schedule is the last surface with records not wired

**MIGRATED to [#683](https://github.com/znpruitt/cfb-app/issues/683) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 155 — the Matchups scheduled row: records as the anchor, and the dead footer

**MERGED — `PLATFORM-155-MATCHUPS-SCHEDULED-ROW-CODEX-v2`, registry entry present.** Matchups now
passes both participants' current records into the shared scoreboard. **This unblocked Item 156**,
now [#683](https://github.com/znpruitt/cfb-app/issues/683), which was waiting on it.

### Item 145 — the upstream debug logger writes provider URLs and headers to the server log

**The ask:** stop `NEXT_PUBLIC_DEBUG=1` logging `statusText`, the provider URL and response headers.

**Found 2026-09-07 during Item 126B's `/verify`, by driving the running route — not by reading.**
`collegefootballdata` appeared four times in the server log. The credential itself was correctly
redacted to `Bearer ***`; the URL, `statusText` and headers were not.

**`NEXT_PUBLIC_DEBUG=1` IS SET in this repo's own `.env.local`**, so this is live in local
development today, not a hypothetical behind a flag nobody sets.

**Pre-existing on `main` and correctly scoped OUT of 126B** — it is a LOG, not the durable store
126B's gate governs, and folding it in would have widened a branch already at both stop-and-reassess
signals. Filed rather than fixed, per that gate.

**Scope:** the upstream debug logger only. Decide what a debug log may carry: a URL is arguably
diagnostic rather than secret, but response headers are not, and the two are emitted together.

**Blocker:** none. Independent of 126.

### Item 146 — the secret scan covers the receipt; a run writes seven durable keys

**The ask:** widen the secret-scan test population from the receipt to every durable key a run writes.

**Found 2026-09-07 by the Item 126B implementer, raised by no reviewer.** A `schedule-refresh` run
writes **seven** durable keys. 126B's secret-scan tests scanned only the **receipt** — so the tests
proved a property about one of seven writes and were named as though they proved it about the run.

**The concrete instance is benign and that is why it is worth filing.** The same run writes a
free-text `"message"` into `provider-refresh-status`:
`"schedule 2026: regular, postseason partition partition-fetch-failed"`. Constructed, secret-free, no
leak. **The defect is the test population, not the value** — a scan whose scope is narrower than the
risk it names will keep passing while an unscanned writer changes.

**Same shape as the vacuous-test findings this campaign keeps producing:** the test named the run and
measured one write. It passes today for the right reason and would pass tomorrow for the wrong one.

**Scope:** the secret-scan test helpers and their population. Not a production change unless the
widened scan finds something.

**Blocker:** none, but it should follow 126B so it can cover what that branch adds.

### Item 142 — Matchups prints kickoff metadata on rows `DESIGN.md` says must not carry it

**MIGRATED to [#679](https://github.com/znpruitt/cfb-app/issues/679) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 141 — the Insights page does a full-season build on every request

**The ask:** stop `/league/<slug>/insights` rebuilding ~3,700 games per render. Cache the recap
context the way the insights feed beside it is already cached, or narrow what recap needs.

**Found 2026-09-07** while correcting a false claim in the Item 139 v3 prompt. Not a regression —
this is how it has always worked; nobody had looked.

**The chain, verified:**

- `src/app/league/[slug]/insights/page.tsx:15` — `export const dynamic = 'force-dynamic'`.
- It calls `loadWeeklyRecap` on every render → `loadRecapContextForSeasonScope` →
  `loadRecapContext` → `assembleSeasonScoredBuild` (`seasonBuild.ts:88`).
- `assembleSeasonScoredBuild` loads the season schedule blob, the team database, the alias map and
  postseason overrides, runs the full `buildScheduleFromApi` canonical build, builds an identity
  resolver, loads reconciled full-season regular and postseason scores, and attaches every score to
  every game. 2026 carries **3,679 games**.
- `loadRecapContext` is wrapped in **`React.cache` only** (`:174`) — per-request dedup, NOT
  cross-request.

**The asymmetry is the tell.** On the same page and in the same `Promise.all`, `loadInsights` IS
wrapped in `unstable_cache` with a TTL (`loadInsights.ts:391-396`). The insights half is cached
across requests; the recap half is not. One of the two was given a cross-request cache and the other
was not, and nothing records that as a decision.

**Live today.** The gate is `leagueStatus.state === 'season' && leagueStatus.year === seasonYear`
(`weeklyRecapFacts.ts:93-98`). Production's registry has `tsc` at
`{"year":2026,"state":"season"}`, so it passes on every Insights render right now.

**AND ON GAME DAYS IT BUILDS THE SEASON TO RENDER NOTHING — measured 2026-09-07.** The season gate
(`isWeeklyRecapActiveSeason`) is cheap and passes, so `loadRecapContext` runs the full build. Only
afterwards does `composeWeeklyRecap` call `selectWeeklyRecapFacts`, which returns `null` when no week
is yet eligible — and `WeeklyRecapSection` then renders `null`.

A week becomes eligible more than one day after its LAST game, or exactly one day after it at/after
06:00 ET (`RECAP_ELIGIBILITY_HOUR = 6`). Today, 2026-09-07, week 1's last game is
**SMU @ Florida State, 23:30 UTC — still scheduled**, so `elapsedDays = 0` and nothing is eligible.
Every Insights render today pays for a 3,679-game build and discards the result.

**That inverts the cost profile.** The expensive path runs hardest exactly when it produces nothing —
Thursday through Monday, which is also the highest-traffic window. The cheap check that would settle
it (is any week eligible?) needs only game dates and `now`, and it runs AFTER the build rather than
before.

**MEASURED 2026-09-07 — this is NOT a cost item, and the entry originally implied it was.** Vercel Web
Analytics, 2026-08-31 → 09-07, by route:

| route                          | pageviews |
| ------------------------------ | --------- |
| `/league/[slug]`               | 128       |
| `/league/[slug]/standings`     | 51        |
| `/`                            | 36        |
| `/admin/diagnostics`           | 21        |
| `/league/[slug]/draft/summary` | 12        |
| **`/league/[slug]/insights`**  | **3**     |

**Three pageviews in a week**, ~1% of 272 total. Against a monthly 4-hour Fluid allowance that is
seconds, while `/api/cron/live-scores` alone runs 480×/day at 1.20 s — roughly the whole allowance.
**Insights is not a second source of CPU pressure; it is noise.** Do not schedule this against Item
102's cost work or cite it in a CPU argument.

_Caveat on the number:_ Web Analytics counts client-side pageviews, so router prefetches that reach
the server without recording a view are not included. Actual renders may exceed 3 — not by the orders
of magnitude that would change the conclusion.

**So the real cost is LATENCY, borne by the one person who opens the page.** A full-season build runs
before first byte, on a `force-dynamic` route, and on game days it produces nothing at all. That is a
user-experience defect on a rarely-visited page — worth fixing cheaply, never worth a caching layer.

**Cross-reference — do NOT let this become precedent.** Item 139 v3's defining constraint is no
full-season build on a request or cron path. This item is the counter-example that already exists;
it is a defect to fix, not a licence to add a second one.

**The cheapest fix may not be a cache at all.** `selectWeeklyRecapTargetWeek` needs only each week's
latest game date and the clock. Hoisting that check ahead of `assembleSeasonScoredBuild` skips the
build entirely whenever no week is eligible — no cache, no invalidation, no new state. Establish
whether that is most of the week or a minority of it before designing anything larger.

**Scope:** `src/lib/recap/loadRecapContext.ts` and its cache wrapper; the eligibility check's position
relative to the build; possibly narrowing `WeeklyRecapContext` to what `composeWeeklyRecap` actually
reads. NOT `assembleSeasonScoredBuild`
itself — rollover and analytics depend on it unchanged.

**Blocker:** none. **Low priority** — measured as ~1% of traffic, so this is a latency polish item, not
a cost item. It should still follow Item 139 v3's design pass, which may establish a cheaper way to
get season-scoped facts that this item can simply reuse. If the eligibility hoist above turns out to
be a few lines, take it on its own; anything larger should wait for v3.

### Item 140 — stamp when a game first reads final, so the reconciliation tail can be sized

> **SCOPE PROTECTED 2026-09-09.** [the 2026-09-08 audit](archive/audits/codebase-audit-existing-plans-2026-09-08.md) → **C3** records that this item measures when a **SCORE** first
> reads final. **It cannot measure when STATISTICS stop changing, and it is NOT a prerequisite for
> Item 110A or 110B.** Recorded because the two are easy to conflate and the audit ruled them apart.

**The ask:** record, per game, the first observation at which it read final. Nothing else — no change
to polling, eligibility, or any rendered output. This is the measurement that turns the tail length
from an inherited guess into a number.

**Why now — an owner-supplied data point, 2026-09-07.** CFBD's developer posted at 08:49 Sunday
following Week 1 that the _"Sunday refresh for already completed week 0 and 1 games is mostly
completed. There are a few small things to clean up and look into. I am AFK again for most of the
day."_ That says the provider's data settles on a **human's Sunday**, not on each game's clock — a
scheduled batch, then a cleanup pass of unpredictable length. Our tail is `kickoff + 24h`
(`RECONCILIATION_GUARANTEE_MS`), anchored per game. The two clocks drift apart by kickoff time.

**Measured against production `2025-all-all`, 2026-09-07.** 3,831 games, 3,536 kicking Saturday ET:

| CFBD settles at | Saturday games whose 24h window has already closed |
| --------------- | -------------------------------------------------- |
| Sun 09:00       | **0** of 3,536                                     |
| Sun 15:00       | 2,042 (57.7%)                                      |
| Sun 18:00       | 2,800 (79.2%)                                      |
| Sun 20:00       | 3,326 (94.1%)                                      |

**The 08:49 batch is fully covered**, and that conclusion is timezone-independent — the earliest any
Saturday window closes is Sun 11:00 ET, so no plausible posting timezone puts the batch outside it.
**The cleanup pass is the exposure**, and it is the pass that fixes the anomalous games — the ones
most likely to still be wrong on our side. This is the probable mechanism behind PLATFORM-105A's
finding that `kickoff+24h` reconciliation gives up on late-arriving finals.

**Why the tail cannot be resized today.** Nothing durable records when a game first read final:
`ScorePack` (`src/lib/scores/types.ts:25`) carries no finalization timestamp, and the cache holds only
a partition-level `effectiveRowTimestamp`. So no retrospective query can produce a settle-time
distribution. The entire empirical base is **Item 108's six games** — which measured the NORMAL path
(`kickoff + 3.40h..4.75h`) and sized the DENSE window. **The straggler path, the only reason the tail
exists, has never been measured.** One post about one weekend — and the season's FIRST weekend, when a
dataset carries the most cleanup — gives the mechanism, not a distribution. Treating it as one repeats
Item 108's error at larger scale.

**Do NOT resize the tail as part of this item, and do not fold it into Item 102 slice 4.** The tail is
pinned to `pollingTarget`'s `POLLING_WINDOW_AFTER_KICKOFF_MS`, and `pollingWindows.ts:54-62` forbids
the planner closing before the handler's eligibility window. Moving it changes what the handler will
poll at all — a correctness change with its own review, not a scheduling tweak. Slice 4 ships on the
inherited 24h.

**What the number is likely to buy, once we have it.** Probably not a longer uniform tail: extending
to 36h costs an hourly wakeup on every game to catch a handful. A Sunday-afternoon re-check anchored to
the WALL CLOCK covers the same exposure far cheaper. Do not design that here — measure first.

**Scope:** the score writer's final-observation seam plus one durable stamp. Observation-only.

**Blocker:** none. Independent of Item 102's slices; parallel-safe against both lanes. Its VALUE
depends on running through live weekends, so the sooner it lands the sooner the tail can be settled.

**This is also the biggest remaining CPU lever in the binding month.** Item 102's own entry records
that the 24-hour tail — not kickoff density — is why October arms 74% of hours against 17% for the
year, holding the planner to ~60% of live-scores wakeups removed in October against ~87% annually, and
landing near ~2.25 CPU-h/30d rather than ~1.1 h. October falls to **50% armed at a 12h tail and 33% at
6h**. So the tail is not only a correctness question: it is what caps the saving in the one month the
monthly allowance is actually under pressure. It cannot be shortened on the sensitivity table alone —
`kickoff + 24h` is the reconciliation guarantee and PLATFORM-105A found that boundary already giving
up on late finals — which is exactly why the measurement has to come first.

### Item 139 — a final can show a pre-game record; reconcile records against completed games

**Status: IMPLEMENTED, REVIEWED, AND MERGE-APPROVED 2026-09-07.** v3 is the execution record;
v1 and v2 are superseded/unimplemented. Overview now receives a server-reconciled record whose
readable unreflected results include the final being shown, while the client payload remains flat at
262,172 bytes. Records remain absent from Schedule; restoring them is separate visible work. See
`PLATFORM-139-RECORD-RECONCILIATION-v3` in `docs/prompt-registry.md` for execution and verification.

**Closeout follow-ups:** persistent score-conflict or participant-mismatch logging remains
unthrottled so failure cannot resemble genuine absence; log-volume control is retained in the
deferral register rather than silently weakening observability. The known lossy identity collision
is owned by Item 83, which now records record reconciliation as its second live consumer and the
production reachability ruling. The misleading `tailScoreRowsValidated` work counter was renamed to
`tailScoreRowsInspected` before closeout; it is not an open follow-up.

**The ask:** make a final always carry the record INCLUDING the result being read, on every surface.

**This is a binding rule, stated twice and violated today.**
`docs/campaigns/item-87-live-watchlist-scoreboard.md:209` — _"Finals carry the POST-GAME record,
including the result being read. A stale record on a final is bad data handling."_ And `DESIGN.md`
carries the corollary as binding: the record is today's, and today includes that game.

**Why it happens — and the window is far WIDER than this entry said until 2026-09-07.** Between a game
finalising and the next records refresh, the cached record predates the result, so the row shows a
pre-game record beside a finished score.

**CORRECTION: `team-records` is NOT refreshed hourly.** This entry, and both abandoned prompts, said
so from `schedulerDeliveryHealth.ts:83` — but that is the CRON's expected delivery cadence, not the
refresh policy. `teamRecordsRefresh.ts:46-47` enforces
`TEAM_RECORDS_MIN_REFRESH_INTERVAL_MS = 6h` (a durable provider-call floor) and
`TEAM_RECORDS_MAX_CACHE_AGE_MS = 12h`. Observing a finalization does not escape the floor — `:113`
still requires `ageMs >= 6h`. **So a final can render a pre-game record for at least six hours and up
to twelve, not one.** Found by Codex during the v3 design pass, verified in the module.

**This makes the item MORE valuable, and it kills a tempting optimization.** A "just look at the
current week" shortcut has no sound boundary at a 6–12 hour cadence with provider lag on top. The
derivation must stay correct for an arbitrarily long tail; only its COST may assume the tail is
usually short.

**Already live on Overview.** `OverviewPanel` renders records through `CompactGameScoreboard` with the
same lag, so this is a pre-existing violation, not one Item 87 slice 5 introduces. Slice 5 would have
extended it to Schedule; it ships without records there instead, pending this item.

**The mechanism — reconcile, do not invalidate.** The record carries a games count:
`total: {wins, losses, ties, games}` (Georgia 2025 reads `{wins:12, losses:2, games:14}`), and
schedule rows carry `completed`. So **"does this record already include this final?" is answerable**:
compare the team's completed-game count against `total.games` and apply the outcomes of any finals the
record is behind on. That has game identity, needs no cache trigger, and works even when the PROVIDER
itself lags.

**Gate VERIFIED 2026-09-06 — do not re-derive it.** Against production `team-records/2025` and
`schedule/2025-all-all`: **668 of 668 teams** have `record.total.games` exactly equal to their
completed-game count, zero disagreement either way. **The test covered the variance, which is the part
that matters** — counts range **1 to 17** (16 teams at 9, 179 at 12, 32 at 14, 5 at 16, Illinois State
at 17), spanning teams that missed a bowl, played a conference championship, and ran deep into the
playoff. A variable postseason cannot break the derivation because it **never compares against an
expected total** — each team is compared against itself.
**Kickoff:** [`docs/prompts/platform-139-record-reconciliation-v3.md`](prompts/platform-139-record-reconciliation-v3.md).

**TWO ATTEMPTS ABANDONED. v3 is a reconstruction that stops for a DESIGN PASS before any code.**

- **v1 (`716bb6d1`) died on the boundary** — it reconciled in the browser, taking the payload from
  ~263 KB to ~738 KB across five dynamic routes.
- **v2 (`132a0daf`) fixed that completely** — payload exactly flat at 262,550 bytes, every gate green
  — **and died on the COST.** Its derivation needs a full-season build, and there is nowhere cheap to
  put one. Three rounds moved the same problem three times: uncached scan → a cache too large for
  Next's 2 MiB entry limit → a compact projection that is invalidated and never warmed.
  **The invalidation is the killer:** the projection carries the standings tags, and
  `live-scores/route.ts:454` busts them on every committing run — every 3 minutes — while the warmer
  repopulates canonical standings only. During a game day the cache is discarded faster than members
  can use it and every page load rebuilds ~3,700 games. That is round 3's behaviour, three rounds on.
  Warming it from the cron is worse: it moves that build onto the job that is already **75% of all
  Vercel Active CPU** and the thing Item 102 exists to shrink.
- **The shape is visible on `main` without reading v2.** `assembleSeasonScoredBuild` already existed,
  and its only callers are rollover, recap and analytics — batch or occasional work. v2 put a
  batch-shaped assembly on five page render paths.

**v3's defining constraint: no full-season build on any request or cron path.**

**v1 (`716bb6d1`) ABANDONED 2026-09-07 — computed in the browser.** To count finished games client-side
it shipped the whole schedule there, taking the payload from **~263 KB to ~738 KB across five dynamic
pages**. Wrong side of the boundary, not a patchable bug. The server already holds the schedule, the
scores and the records together; it computes the answer and ships two numbers per team. That also
dissolves v1's "hidden non-FBS games" finding, since the server sees every game.

**The withholding ruling is WITHDRAWN — it was made without measuring the population.** v1 grew a
withholding policy, null-kickoff ordering rules and a blast-radius argument to handle a finished game
whose score cannot be read. Measured on production 2025: **3,829 of 3,831 completed games have a usable
final score; 2 do not** — 0.05%, with zero missing score rows and zero non-final rows. Skip an
unreadable game and fold the rest. Two rows a season being wrong by one game does not warrant a
mechanism, and certainly not blanking a team's record everywhere it appears.

**One v1 finding is carried verbatim:** `hasUsableFinalScore` (`gameStatus.ts:96`) does two jobs —
detecting that a game concluded, and validating that its outcome is readable. Conflating them is why a
game marked final with a null score slipped past.

**A cache-invalidation trigger was tried and is the wrong layer — do not repeat it.** Slice 5's
`onGamesFinalized` gate discarded game identity, so it blanked every team's record for one final,
never fired on first-seen finals (the case that matters), and over-fired on same-winner score
corrections. Four defects from one mechanism that cannot see which game finished.

**Scope:** the records selector plus its consumers; shared, so it fixes Overview and unblocks
Schedule together. **Blocker:** the design pass. Scope is undecided until the owner rules on a design, because two
implementations have now failed on WHERE the derivation is computed rather than on whether it is
correct. Still gates records returning to Schedule.

### Item 137 — two `writer-convergence` tests are time bombs; `main` is red

**Standing known-failure baseline.** Until this ships, `npm test` on clean `main` exits **1** with
**exactly two** failures, both in `src/app/api/odds/__tests__/writer-convergence.test.ts`:

    not ok - convergence #10: a canonical success is recorded only after the atomic commit
    not ok - compatibility #46: an authorized manual refresh returns the compatible 200 shape

**This is the baseline `CLAUDE.md`'s merge condition 3 refers to.** A lane may merge only when the
failures are EXACTLY these two. One more, or one elsewhere, is a stop-and-report.

**Root cause, diagnosed 2026-09-05.** The fixture pins its kickoff at `2026-09-05T19:30:00.000Z`
(`scheduleItem()` and the odds event's `commence_time`). Past kickoff the odds writer correctly stops
attaching a line — closing-line behaviour — so no durable store record is created, and
`assert.equal(record?.latestSnapshot?.homeSpread, -3.5)` sees `undefined` rather than `null`. Correct
production behaviour meeting a stale fixture. **The durable path itself is healthy**:
`durable-odds:2026 / store` holds 115KB in production.

**This is Item 103's residue.** Item 103 was filed 2026-09-02 as "at least six odds-route tests are
time bombs; four expired first", and `PLATFORM-121` replaced the fixtures in
`src/app/api/odds/__tests__/route.test.ts` — which now passes 21/21 — then closed and removed the
item. **`writer-convergence.test.ts` has the same fixed-kickoff pattern and was never touched.** Its
two expired on 2026-09-05. PLATFORM-121's closeout claim to have "removed at least six latent time
bombs" overstated its reach.

**Fix:** the PLATFORM-121 treatment applied to this file — kickoffs relative to now, not fixed.

**A bisect will lie to you.** Checking out an older commit does not roll back the clock, so a
time-dependent test fails at EVERY commit once expired. A sweep across four historical commits during
diagnosis produced four false positives before the fixture date was read.

**Blocker:** none. Test-only; no production defect. But it costs every branch a clean baseline, which
is the condition under which a third failure hides.

### Item 138 — `isOwnerVsOwner` counts `NoClaim` as a real owner

**The ask:** judge league membership through the shared sentinel seam, not through `!opponentOwner`.

**The mechanism.** `buildOwnerSlateGames` (`src/lib/matchups.ts:249`) sets
`isOwnerVsOwner: Boolean(bucket.homeOwner)` and `isOpponentUnownedOrNonLeague: !bucket.homeOwner`.
After a draft, `buildConfirmedOwnersCsv` writes **`NoClaim` as a real owner** for every undrafted
eligible team (`src/lib/rosterEditing.ts:23`), so both predicates read a sentinel as a league owner:
a game against nobody reports `isOwnerVsOwner: true` and `isOpponentUnownedOrNonLeague: false`.

**Same root as Item 135**, which corrected only the opponent-count path. `displayOwner`
(`src/lib/gameOwnership.ts:24`) is the shared seam that returns `null` for `NoClaim`, and
`AGENTS.md` rule 11 (**Centralized game ownership**) is the governing rule.

**Reported by the implementation lane during Item 135 and deliberately left untouched** — it was out
of that item's scope. Consumers must be surveyed before changing it: these flags are on
`OwnerSlateGame` and a truthy `isOwnerVsOwner` may be feeding presentation or grouping beyond the
count.

**Blocker:** none. Sits in the same file as Item 136 — worth pairing.

### Item 136 — Matchups slate aggregates double-count a self game

**The ask:** make the per-owner tiles count games the way the row list now does — once each.

**The mechanism, measured 2026-09-05.** `buildOwnerWeekPerformance` (`src/lib/matchups.ts:306`) takes
`games: OwnerSlateGame[]` and iterates them directly, incrementing `liveGames` / `finalGames` /
`scheduledGames` per **entry**. `buildOwnerSlateGames` (`:239`, `:254`) emits **two entries for one
game** when an owner holds both teams, so every such game counts twice. `totalGames`, `liveGames` and
`finalGames` on the slate carry the same defect, and `ownerView.ts:346` consumes them.

Probed output for one live self game:

    performance.summary : "0–0 · 2 live"
    performance.detail  : "2 games"
    slate.liveGames     : 2
    rendered rows       : 1

**Visible today.** The 2026 season has **39 games where one owner holds both teams** (measured against
`owners:tsc:2026`, 138 teams, 16 owners, out of 888 games involving a rostered team). Week 1 alone:
Whited (Jacksonville State vs North Dakota State), Maleski (Miami vs Stanford, and Baylor vs Auburn).
Those cards read `2 GAMES` above a single row.

**Item 135 did not cause this — it revealed it.** Before 135 the list rendered the duplicate rows too,
so the header and the list agreed while both were wrong. Deduplicating the rows made the aggregate
disagreement visible. Same shape as the `NoClaim` finding: each correct fix exposes what the previous
defect was masking.

**Correction on record.** An earlier note claimed `performance.summary` was safe because it counts
buckets rather than slate entries. That holds for the **record** half (`wins`/`losses`) only; the
live/total counters iterate the un-deduped entries. Recorded so the scope is not under-described.

**Scope:** `src/lib/matchups.ts` — `buildOwnerWeekPerformance` plus the slate's `totalGames`,
`liveGames`, `finalGames` — and the `src/lib/ownerView.ts:346` consumer. Dedupe on `game.key`, the
same key `scoresByKey` / `oddsByKey` already treat as unique.

**Blocker:** none. Independent of the UI spine; no shared component. Parallel-safe against both lanes.

### Item 134 — Overview three-column tier

**MIGRATED to [#678](https://github.com/znpruitt/cfb-app/issues/678) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 133 — `zinc-500` at small type fails the contrast floor, repo-wide

**The ask:** audit every remaining `dark:text-zinc-500` and move the ones that are normal text to a
passing token.

**The finding, measured 2026-09-05 during Item 87 slice 5a.** `zinc-500` (`#71717a`) on the app's
`#0a0a0a` composition is **4.10:1**. `DESIGN.md` requires **4.5:1 for normal text**, and WCAG large
text begins at 18.66px bold / 24px — so anything at `text-xs` (12px), `text-[12.5px]` or `text-sm`
(14px) fails. `zinc-400` (`#a1a1aa`) is 7.72:1.

Slice 5a fixed this inside `CompactGameScoreboard` only, as a deliberately component-local
prohibition. **184 occurrences across 73 files remain** (measured on `main` at `e5a23313`).

**Split along the UI-spine boundary (2026-09-05), because the halves parallelize differently:**

- **133a — non-spine, ~164 occurrences.** `components/admin` (13 files), `components/history` (10),
  `components/draft` (8), `components/admin/systemHealth` (6) and the rest. **No spine slice touches
  any of these**, so 133a is fully parallel-safe against both lanes. It is still not small: a
  classification pass across roughly 70 files. Good work for a blocked lane, not a third concurrent
  workstream.
- **133b — the spine files, 17 occurrences after PR #572.** `OverviewPanel.tsx` (14) and
  `MatchupsWeekPanel.tsx` (3); slice 5 removed both `GameWeekPanel.tsx` occurrences and one Matchups
  self-result occurrence, while `CompactGameScoreboard.tsx` remains at 0 from slice 5a. These collide
  with every slice that touches those files, so **fold each into the spine slice that owns the file**
  (115 owns `OverviewPanel`, 117 owns `MatchupsWeekPanel`) or run 133b after the spine completes. Do
  not run it as a separate concurrent item.

**Not all 184 are violations — that is the work.** The count includes borders (`dark:border-zinc-500`
is not text), backgrounds, and any genuinely large text. The audit must classify each occurrence by
what it colours and at what size, then fix only the failing ones. **Do not bulk-replace**; a scripted
substitution across 73 files is exactly the shape that has shipped defects past every gate here
before.

**Expect a hierarchy cost, and budget for it.** In the scoreboard, moving suffixes off `zinc-500`
collapsed a colour step against a losing team's name, which was already `zinc-400` — accepted there,
with type size left as the distinction. The same collapse will recur anywhere `zinc-400` and
`zinc-500` were being used as adjacent hierarchy levels. Where it matters, the answer is a different
mechanism (size, weight, spacing), not a return to a failing token.

**Value:** accessibility compliance against a rule `DESIGN.md` already states, on text members read on
every surface. **Not urgent** — it has been shipping this way — but it is a stated rule the codebase
does not currently meet.

**Blocker:** none. Independent of the UI spine; touches presentation only. Best run as one audit pass
with the classification recorded, not folded into a feature slice.

### Item 132 — the Scores and Game stats health rows read the wrong record

**Filed 2026-09-05.** Evidence, both reverted attempts, and the pitfalls they found:
[`docs/campaigns/item-132-partition-scoped-health.md`](campaigns/item-132-partition-scoped-health.md).

**The ask.** Those two datasets record refreshes per week partition, not per year, so the row reads a
canonical year scope that usually does not exist for them. It reports `No refresh history` while they
are refreshing, and — because the freshness dot is driven by cache presence, and scores stay cached
through a total polling outage — it cannot report a stall at all. Verified in production 2026-09-05.

**The value.** A live-scoring outage is currently invisible on the row built to show it, and the row
contradicts the issue list above it. Fixed for the class: `game-stats` reads null the same way.

**The blocker is knowledge, not permission.** Two attempts were built and reverted — a freshness model
(six `provider-refresh-status` semantics it had assumed) and a display-only fix (five review rounds).
The campaign doc holds both, including the fixture rule that cost two of those rounds. **Read it
before starting**; the direction is to build on `attemptFaultIssue`'s existing interpretation rather
than a second one beside it. Abandoned branch, kept for reference: `platform/partition-scoped-health`
at `17f32dc7`.

- Backlog slug: `PLATFORM-PARTITION-SCOPED-HEALTH-v2`

### Item 130 — narrow live-score polling to game clusters, then stand down when they finish

**Filed 2026-09-05, revised the same day after re-reading the measurement.** Depends on Item 102 for
the QStash-write capability; do not start before it. **Build in two steps — the first is where almost
all of the saving is.**

**The unit is a CLUSTER, not a day or a week.** A cluster is a contiguous run of games. The
2026-09-03 weekend is five of them (Thu, Fri, Sat, Sun, Mon), not one four-day window:

    Thu 09-03 20:45 -> 09-04 05:45   9.0h
    Fri 09-04 21:45 -> 09-05 06:45   9.0h
    Sat 09-05 14:45 -> 09-06 07:15  16.5h
    Sun 09-06 15:45 -> 09-07 04:15  12.5h
    Mon 09-07 23:15 -> 09-08 04:15   5.0h

52 dense hours of 120, against ~100% under today's `kickoff + 24h` tail.

#### Step 1 — cluster windows with a margin (schedule-derived, ONE writer)

Three phases, all derived from kickoff times, so the daily planner is the only thing that ever
writes the cron:

| Phase | Window                                      | Rate        |
| ----- | ------------------------------------------- | ----------- |
| Dense | `first kickoff − 15m` → `last kickoff + 8h` | every 3 min |
| Slow  | `last kickoff + 8h` → `last kickoff + 24h`  | hourly      |
| Off   | until the next cluster arms                 | —           |

**CORRECTION 2026-09-05:** this item first said "a ~2-hour slow reconciliation poll", which would
have ended all polling near `+10h` and silently dropped the `kickoff + 24h` reconciliation guarantee
that PLATFORM-105A found already straining. The slow phase must run to `+24h`. Measured cost of doing
it properly: **356 extra wakeups in October** of 14,880, taking the saving from 61% to 59%. Sixteen
hourly checks across the tail are ample for a fact that changes at most once.

**CORRECTION to this item's first filing.** It attributed the saving to observing live game state.
It does not: the measurement behind these numbers ended each cluster at a FIXED offset after the last
kickoff. Clustering plus a short margin is what produces the saving, and it needs no runtime
observation at all.

Margin sensitivity, October, against 14,880 wakeups today:

Margin sensitivity — **DENSE PHASE ONLY**, so these are not the deliverable figures. The saving with
the mandated slow phase included is the 59% in the table below; do not quote these in isolation.

| Margin after last kickoff | Dense hours | Dense-only wakeups | Dense-only removed |
| ------------------------- | ----------- | ------------------ | ------------------ |
| 4.75h                     | 27%         | 3,965              | 73%                |
| **8h (recommended)**      | 36%         | 5,395              | 64%                |
| 12h                       | 48%         | 7,110              | 52%                |

**8h, because Item 108 measured a game still live at 6.4h** behind a weather delay while five others
reconciled at `kickoff + 3.40h..4.75h`. A tighter margin would have slowed polling on that game while
it was on the clock. When a game does overrun the margin the score is not lost — the reconciliation
pass still collects it, late rather than never.

| Wakeups / month                        | Sep    | Oct     | Nov    | Year    |
| -------------------------------------- | ------ | ------- | ------ | ------- |
| live-scores today                      | 14,400 | 14,880  | 14,400 | 175,200 |
| Step 1, dense 8h + hourly slow to +24h | 4,351  | 6,156   | 5,757  | —       |
| removed                                | 70%    | **59%** | 60%    | —       |

Measured through `utcHoursCovered`, i.e. the hours a cron can actually express — partial hours round
up, which costs ~3 points against the raw windows and is already included above.

#### Step 2 — stand down when the games actually finish (+~9 points)

The route already computes this. `pollingTarget.ts` returns `scoreboard` while anything is open,
`final-reconciliation` when only unconfirmed finals remain, `none` otherwise. **The cadence tiers ARE
those three modes**; the scheduler simply never hears about them. Standing down on the real fact
rather than a margin recovers the gap between the 8h and 4.75h margins — about 9 points on the
dense-only base — AND handles an overrunning game correctly instead of generously.

**Why the planner cannot do the observing.** It would have to be awake to notice, and an invocation
every few minutes is the cost this item removes — the campaign measured 66.7% cold starts, so
_"removing an invocation saves its floor as well as its work, which a cheaper handler cannot."_ The
route is already awake and already computes it; it only needs permission to act.

**That means two writers on one cron, which is the shape that cost PLATFORM-127 several rounds — but
here it is safe, and the reason is measured.** Across all 122 in-season days of 2026, **a cluster is
active at 13:00 UTC on ZERO of them** (12:00–15:00 UTC is quiet on >90%). Football has a late-morning
US dead zone. So:

- Planner runs 13:00 UTC and only ever WIDENS; measured never to run mid-cluster.
- The route only ever NARROWS, and only within a cluster already underway.
- They alternate by the clock instead of racing.

**One guard makes that robust rather than lucky: the planner must refuse to widen while a cluster is
active.** That covers a late QStash delivery and covers future seasons where the quiet window moves —
a week-zero game in Ireland kicks off near 11:00 UTC, so this is not hypothetical.

**Take step 2 second regardless**, because step 1 is its prerequisite and shipping it first yields
production evidence of how often games really overrun the margin — which prices step 2 with data
instead of this item's estimate.

**Step 2 CANNOT simply reuse `mode === 'none'`, and the reason was found by Codex reviewing the
browser cadence (2026-09-05).** `resolveWindowState` treats anything that is not a cached `final` as
`unresolved-open`, and says so deliberately: _"an unclear cache never suppresses a poll."_ That
fail-safe is right for "should I make a provider call" and WRONG for "should I stop waking up" —
the two questions want opposite behaviour from an unclear state. Two conditions therefore defeat the
stand-down, both verified:

- **A game that never attaches a score pack** (phantom row, identity miss — PLATFORM-114 found ten
  phantom games) has `cachedStatus: null`, reads `unresolved-open`, and holds dense polling to
  `kickoff + 24h`.
- **A provider row marked `completed` but missing one score** is normalized to in-progress, never
  reaches `final`, and does the same. The cached `ScorePack` is LOSSY here — the original `completed`
  is discarded — so the signal cannot be recovered downstream. It must originate where the live cron
  still holds normalized provider state (`scheduled` / `in_progress` / `completed`) and be persisted
  as target-scoped evidence.

**Step 1 is structurally immune to both** because it reads kickoff times and never consults cache
state. That is now a stronger argument for the margin than the original framing gave it: step 2 is
correct for a game that overruns and INCORRECT for a game that fails to attach, and which is more
common is unmeasured.

**Reconciliation stays per-cluster, not per-slate.** Condensing it to once per week bucket was
considered and rejected: a Thursday game would reconcile Sunday night, stretching `kickoff + 24h` to
+72h, and PLATFORM-105A already found that boundary giving up on late finals. **The slow phase runs
hourly to `last kickoff + 24h`, per the phase table above** — an earlier draft of this paragraph said
"a 2-hour slow poll", which contradicted that table and would have restored the +10h cutoff the
correction rejects. It costs 356 wakeups in October and keeps the guarantee.

- Backlog slug: `PLATFORM-LIVE-CADENCE-CLUSTERS-v1`

### Item 131 — game-stats polls 21 hours per game for data nothing reads live

> **SCOPE PROTECTED 2026-09-09.** [the 2026-09-08 audit](archive/audits/codebase-audit-existing-plans-2026-09-08.md) → **C3** keeps this a **collection and cost** decision,
> separate from correction. **Item 110B owns revisiting satisfied partitions**; this item owns whether
> the initial collection window is the right shape. Do not merge them.

**Filed 2026-09-05.** Depends on Item 102 for the same capability as Item 130. Separate item because
it is a separate automation job (`AGENTS.md` scope rule), and it is the largest proportional saving
available anywhere in the campaign.

**Today:** `gameStats/pollingTarget.ts` makes a game pollable from `kickoff + 3h` to `kickoff + 24h`,
on a `*/15` cron — 21 hours per game, 4 wakeups an hour, effectively continuous in season, for 12% of
all Active CPU.

**Nothing consumes it live.** Item 110's own consumer inventory: insights and archive only. So one
pass once a cluster has settled is sufficient.

**Measured:**

|                      | Sep   | Oct     | Nov   | Year    |
| -------------------- | ----- | ------- | ----- | ------- |
| game-stats today     | 2,880 | 2,976   | 2,880 | 35,040  |
| one pass per cluster | 56    | 92      | 76    | 240     |
| removed              | 98%   | **97%** | 97%   | **99%** |

**Do it LATE, and prefer weekly — CFBD's admin, recorded in Item 110:** _"I will always do a 'final'
data reconciliation on Sundays for that week's games."_ The current 24h window closes Sunday noon for
a Saturday game and therefore already misses that reconciliation. Collecting earlier does not fix it;
collecting after CFBD's Sunday pass would. **That is a correctness gain this item can capture for
free**, and it argues for a weekly late pass rather than a per-cluster one — decide which when the
item is taken.

- Backlog slug: `PLATFORM-GAME-STATS-COLLECT-LATE-v1`

### Item 129 — two `usage-sample` follow-ups deferred out of PLATFORM-127

**Filed 2026-09-04, post-merge.** Both were found by review, judged real, and deliberately NOT folded
into a round that was already about something else. Evidence:
`docs/prompt-registry.md` → `PLATFORM-127-RETAIN-PROVIDER-USAGE-SERIES-v1`.

**The route has no outer `catch`.** All eight sibling cron routes wrap the handler and return their
`{result, reason}` shape with a 500; `usage-sample` has only `try`/`finally`, so an unexpected throw
escapes to Next.js and the declared `NextResponse<UsageSampleResult>` contract is not honoured. The
sharper half is the receipt: `finally` still files one, and `exec.result` would hold whatever it was
last set to — so a crash could file a receipt claiming `success`. **Not currently reachable**:
`fetchCfbdUsage` is wrapped and `recordProviderUsageObservation` never throws. Fix is the sibling
shape plus setting `exec.result = 'failure'` in the catch, so the receipt cannot outlive the truth.

**Its delivery grace equals exactly one cron period.** `DELIVERY_POLICIES` gives `usage-sample`
`graceMs = 6h` against `0 */6 * * *`; every sibling QStash policy uses two periods or more
(live-scores 3m/6m, game-stats 15m/30m, team-records and odds 1h/2h). `requiredStartedAt` therefore
lands exactly on the previous slot, so a receipt preceding its own slot by any margin reads `late` —
and the codebase already acknowledges cross-instance clock skew. Low probability, but it would put a
spurious warning on the job whose whole design goal is a quiet row.

**Value:** both are contract-consistency defects on a job that is now live and unattended. Neither
changes what the sampler records.

- Backlog slug: `PLATFORM-USAGE-SAMPLE-CONTRACT-PARITY-v1`

### Item 125 — four Overview section-ordering decisions are decided but unbuilt

**MIGRATED to [#667](https://github.com/znpruitt/cfb-app/issues/667) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 124 — `OverviewContext.sectionOrder` is dead and now contradicts the shipped order

**SUPERSEDED — done the day it was filed, and the entry never said so.** `overview.ts:35` records
it: "Five fields were removed here on 2026-09-04 (Item 124): `sectionOrder`, `scopeLabel`, ..."
**Found 2026-09-10 by grouping the Overview cluster** — invisible while it sat among unrelated numbers.

### Item 123 — DONE: `buildPostseasonTemplate` retired

**Shipped 2026-09-04** — `PLATFORM-RETIRE-POSTSEASON-TEMPLATE-v1`, merged via PR #565 (`7e505437`).
183 lines, one file, no collateral edits. The slot-numbered playoff keys it carried are recorded in
Item 121 as the convention that fixes the first-round `eventKey` collision.

**Filed 2026-09-04. Dead code with a wrong model inside it.** Surfaced while answering why the 2026
week list ends at 15 with no week 14.

**IMPLEMENTED — review complete, awaiting merge.** `src/lib/postseason-template.ts` was deleted on
`platform/retire-postseason-template` at `12da576e`. No caller, test, replacement module, or runtime
behavior changed. Codex and `/code-review` both returned no findings against that exact commit; all
four required gates passed with the test suite unchanged at 4,590.

**It has no callers.** `buildPostseasonTemplate` (`src/lib/postseason-template.ts:29`, 183 lines)
appears exactly once in the repository — its own definition. No consumer in `src/`, none in
`scripts/`, and no test file references it. It exists to mint postseason placeholders: one
conference-championship slot per conference, four bowl slots, and a playoff bracket.

**Three things are wrong with it, all of which only matter if someone wires it:**

1. **It hardcodes provider week numbers, which drift.** Conference championships are pinned to
   `week: 15` and the bowls and playoff to `week: 17`. That matched 2024 and 2025, where CFBD filed
   the nine championship games at week 15 and Army–Navy at 16. **2026 has already shifted**: CFBD
   places Army–Navy at week 15 (Dec 12, MetLife), so the championships will land at 14. A template
   asserting a week number that must agree with the provider's own numbering is the same defect shape
   as inferring a CFP round from a postseason week — it looks stable until the calendar moves.
2. **It has no first-round slots.** Four quarterfinals, two semifinals, one championship — the
   12-team bracket missing its first round entirely. Any surface built on it would be short four
   games in the round that Item 121 is also about.
3. **Its bowl set is four.** Rose, Sugar, Orange, Cotton — a fragment of a bowl season, and a
   structure the 12-team format made ambiguous, since a quarterfinal _is_ a bowl.

**One thing in it is right, and Item 121 should copy it.** The template's playoff keys are
slot-numbered — `cfp-quarterfinal-1` … `-4`, `cfp-semifinal-1`, `-2` — so it never collides the way
the live path does. `postseason-classify.ts:340-341` mints the unnumbered `cfp-first-round` for every
first-round slot, which is Item 121's bug. The template already demonstrates the convention that fixes
it.

**Recommendation: delete it.** The live classifier is provider-driven and handles placeholders today;
a hardcoded template is a second, unmaintained model of the same structure, and a dead one has been
silently wrong about 2026 for as long as 2026 has existed. If a placeholder surface is ever wanted,
rebuild it from the classifier rather than reviving this. **`npm run build` is the gate for the
deletion** — the same gate that caught the last retired-module claim.

- Backlog slug: `PLATFORM-RETIRE-POSTSEASON-TEMPLATE-v1`

### Item 122 — the historical-cache buttons cannot re-cache anything

**Filed 2026-09-04. Operator defect, no seasonal deadline.** Surfaced while answering whether the 2024
schedule cache could be refreshed.

**`HistoricalCachePanel.tsx:47` and `:70` hardcode `force: false`.** `POST /api/admin/cache-historical-schedule`
treats an already-cached year as a no-provider-call short-circuit unless `force` is set, and
`cache-historical-scores` mirrors it. So for any year that already has a cache — which is every year
the panel is useful for — the button returns `{ alreadyCached: true }`, makes no provider call, and
changes nothing.

**The panel looks functional while being unable to do the thing a re-cache exists for.** The
short-circuit is correct behaviour for the endpoint (it exists so a repair does not re-spend a fetch
on data already held); the defect is that the only UI never offers the other half. The sole way to
refresh a cached season today is a hand-written authenticated `POST` from a browser console.

**Acceptance boundary:** an operator can refresh an already-cached historical year from `/admin/data`
without a console, and the destructive half is distinguishable from the idempotent one — a re-cache
overwrites a durable season, so it should read as a deliberate action rather than a second identical
button. The active-season protection at the route (`computeProtectedActiveYears`, which `force` cannot
bypass) already prevents the dangerous case, so the UI does not need to re-derive it.

- Backlog slug: `PLATFORM-HISTORICAL-CACHE-FORCE-AFFORDANCE-v1`

### Item 121 — every CFP first-round game shares one `eventKey`, and it is the React list key

**Filed 2026-09-04. Data-identity defect, measured not inferred.** Evidence and the grouping work it
touches: `docs/campaigns/item-87-followon-postseason-refinements.md` §3.

**The collision.** `playoffEventKey` (`cfbdSchedule.ts:366-370`) returns `cfp-${round}` when a playoff
row has no bowl name to disambiguate. Quarterfinals and semifinals carry bowl names and are safe; the
championship is singular. **First round is the one round the scheme cannot separate, and the 12-team
format made it four games.** Measured on the read-only replica in **both** seasons that used the 12-team
format: all four 2025 first-round rows carry `eventKey: "cfp-first-round"`, and so do all four 2024
rows, so `schedule.ts:485-486` gives each season four games sharing one `eventId`.

**Two consumers, both reachable.** `schedule.ts:503` sets `key: eventId` for postseason games and
`GameWeekPanel.tsx:213` renders `key={g.key}` — four identical React keys in one list. The operator
label override is the second: `GameWeekPanel.tsx:340` saves by `g.eventId` and
`schedulePostseasonHelpers.ts:372-377` applies it wherever `candidate.eventId === eventId`, so one
label edit would hit all four games. The placeholder participant slot ids (`schedule.ts:492`, `:498`,
`${eventId}-home` / `-away`) collide the same way.

**Not reachable today — it lands in December.** `CFBScheduleApp.tsx:313` fixes the season with
`useState` and no setter exists anywhere in `src/`, so a member sees only their league's season. The
2026 cache holds **zero** postseason rows, so nothing renders these keys yet. It goes live when the
2026 first round is ingested, which is exactly when the postseason tab matters.

**This is our key scheme, not a provider gap.** `playoffEventKey` composes `cfp-${round}` and appends
a bowl slug that first-round games do not have, because they are campus-hosted rather than bowls. The
distinguishing data is present: CFBD supplies a per-game `id`, **unique across all 3,801 rows of 2024
and all 3,831 of 2025, never null**, and `AppGame` already carries it as `providerGameId`
(`schedule.ts:180`, set at four construction sites including the postseason one at `:526`). The
`eventKey` fallback at `schedule.ts:485` already trusts it — `${item.week}-${item.id}`.

**But it cannot be a blanket swap, and this is the design constraint.** `eventKey` is doing two jobs.
For a resolved game it is an identity; for a postseason **placeholder** it is a SLOT key —
`postseason-classify.ts:340-341` mints `eventKey: roundKey` for a Team-TBD row before either team is
known, and a placeholder has no provider id to key on. `slotOrder` has the same collapse
(`:325-333`: `20 + slot` when the provider gives an explicit slot, a single `29` when it does not).
So the fix is to stop resolved games inheriting the slot key, not to abolish it: prefer
`providerGameId` for identity where a real game exists, keep the round key for the TBD slot.

**The fix introduces a mid-lifecycle key change, and that is the part to specify first.** If a
resolved game takes `providerGameId` while a placeholder keeps the round key, then a game's key
CHANGES at the moment the slot resolves and teams are assigned — which for the first round happens
days before kickoff, in December, on the surface this item exists to protect. Everything holding the
old key across that boundary must survive or migrate it. Known holders, all reachable:

- **An operator label override** saved against the slot key. `schedulePostseasonHelpers.ts:372-377`
  matches `candidate.eventId === eventId`, so an override written before resolution silently stops
  applying after it — the failure is a label quietly disappearing, not an error.
- **A React list key** on a list spanning the change (`GameWeekPanel.tsx:213`, `key={g.key}`, and
  `key: eventId` at `schedule.ts:503`). A key that changes remounts the row; four keys collapsing to
  one is today's bug, and one key becoming four is its mirror.
- **Any cached or memoised selector keyed on `key`/`eventId`**, and the placeholder participant slot
  ids at `schedule.ts:492`/`:498` (`${eventId}-home` / `-away`), which feed identity resolution.

**Acceptance boundary:** first-round games get distinct `eventKey` values; a test renders more than one
first-round game in the same list; the placeholder path still resolves a TBD slot to its game; and a
test drives the transition itself — a placeholder with a saved override, resolved to a real game,
still carrying that override afterwards. The transition test is the one that cannot be deferred, since
it is the failure the fix creates rather than the one it removes. End-to-end confirmation of the
override and render paths is the first step, not a prerequisite for filing.

**Separable from round grouping** — that work keys on `playoffRound` and `playoffCompetition`, not
`eventId`, so it is not blocked.

- Backlog slug: `PLATFORM-CFP-EVENT-KEY-COLLISION-v1`

### Item 120 — CLOSED, no action: the 2023/2024 field gap is unread and fails open

**Filed 2026-09-04, closed the same day at its own scoping gate.** It was filed twice wrongly first —
originally as "the 2024 cache holds zero CFP rows" (an artifact of filtering on
`homeClassification === 'fbs'`, a field those caches do not carry, and reading the empty result as
data), then narrowed to a field gap. The consumer audit closes it.

**The gap is real but narrow.** `2023-all-all` (written 2026-07-26) and `2024-all-all` (2026-07-26)
carry neither `completed` nor the team classifications; `2025-all-all` (2026-09-03) carries both. All
three record `partialFailure: false`, and `status: 'scheduled'` is the value on every row of every
season (3,734 / 3,801 / 3,831), so it is not a staleness signal.

**`completed` is unreachable for a past season.** Its only behavioural consumer is
`classifyGameConclusionEvidence` (`gameStatus.ts:115-121`), a three-way OR whose FIRST branch is a
final score pack. The 2024 score caches hold **3,745 of 3,747** regular packs and **54 of 54**
postseason packs as `final`, so that branch fires and `completed` is never consulted. Confirmed
against the outcome rather than the code path: the durable `standings-archive:tsc / 2024` reports
coverage **`complete` for all 17 weeks**.

**The classifications fail open by design.** `scheduleRelevance.ts:17-26` retains a row when either
classification is missing — its own comment says "Missing or unrecognized classifications fail open
for legacy durable rows" — and `isFbsRelevantScheduleBuildRow` retains every postseason row
regardless. Absence keeps rows; it cannot drop a game.

**Therefore no refresh.** It would spend a CFBD call to populate two fields no path reads for a past
season, and the 2024 archive it would notionally improve is already durable and already complete.
Reopen only if a consumer starts reading `completed` or a classification for a historical year.

**The two non-final 2024 packs, identified so nobody rediscovers them.** 2 of the 3,747 regular score
packs read `scheduled` rather than `final`, and both are explained:

- `401640992` — **Liberty at App State**, week 5, 2024-09-28. The Hurricane Helene cancellation, which
  the codebase already documents by name: `standingsHistory.ts:191-194` cites this exact game as the
  genuine never-resolves case, still returning `completed: false` from CFBD nearly two years on, and
  `hasGameBeenAbandoned` is the escape hatch built for it.
- `401677463` — **Defiance College at Taylor**, week 10, 2024-11-02. Division III versus NAIA; not an
  FBS game, so it never enters a standings derivation at all.

Neither is a defect and neither affects the complete coverage above. Recorded here rather than left as
"not chased", because a closed item takes its context with it.

### Item 119 — team-colour bar on the shared scoreboard, and no accent for teams with no colour

**Filed 2026-09-03.** Design and evidence: `docs/campaigns/item-87-followon-team-colour.md`. Depends on
**Item 87 slice 5a** (the bar lands in the shared component). Two separately shippable pieces:

1. **The bar, on the existing normaliser.** An 8px muted bar at the line-start slot reserved for logos,
   using `teamColors.ts` as it ships today (HSL, contrast-lifted to ≥3:1). Teams with no catalog
   colour render **no accent**. That last clause is a bug fix as well as a rule: every FCS row today
   receives the fallback `#059669` (`teamColors.ts:24`, `:267`), a green on a surface where green
   already means live within the scoreboard family (`DESIGN.md` → Color).
2. **OKLCH port — only if (1) measures badly** at 8px, with the reserved-hue guard the follow-on
   specifies. Not a dependency of (1).

**OBSERVED 2026-09-08 — MY observation, not the owner's, and I first misattributed it.** The owner's
report was the horizontal padding defect now filed as **Item 164**, which has nothing to do with the
rail. What follows is a separate and real duplication I noticed in the same screenshot: **the rail is
block-height and the tint is one row, so they visibly disagree.**
`MatchupsWeekPanel.tsx:98-110` is the rail: `border-l-2` in emerald / rose / violet / zinc for win /
loss / self / live, applied to the whole game block.

**Do NOT fix this by extending the background to match the rail.** CARRY row 20 retires the rail and
lets the tint carry outcome, and **the mockup has no rail at all** — outcome is carried by the row
tint alone, and the short bars visible beside each team row are THIS item's 8px team-colour bars, a
different element. Extending the background would entrench the thing that is slated for deletion and
make this item harder, which is what CARRY row 20's "do not entrench it either" clause exists to stop.

**CORRECTED — the rail cannot be retired on its own, and my first note here said it could.** The
authority is `item-87-followon-presentation-decisions.md` → _The tint tracks state across the game's
whole life_, marked **CURRENT and UNBUILT**, whose own words are: _"Shipped code renders the neutral
tint only (slice 5b, Item 117) and still draws the outcome rail beside it."_ **The rail exists BECAUSE
the tint's outcome states are unbuilt.** Delete it today and nothing carries outcome at all.

**So row 20 is one change, not two** — build the tint's live and final states (green/red base,
travelling band while live, static at final) **and** retire the rail in the same slice.

**The tint itself is never in question, on either axis.** `team-highlight.md` decides the IDENTITY
axis — it marks the card owner's team in the matchup, and is never owner colour — and the lifecycle
table above decides the OUTCOME axis. **Nothing in this campaign proposes removing the owned-team
tint**, and a prompt that reads "retire the rail" as touching it has misread the row.

**Decision parked:** the normalisation target — the incumbent is tuned to `#0A0A0A`, the mockup and
follow-on assume `#161616`. One constant, before (1) ships.

- Backlog slug: `POLISH-TEAM-COLOUR-BAR-v1`

**LEDGER GAP CLOSED 2026-09-08, from Item 144's read.** This entry did not record the **slice 5b
`isolation` dependency**: `team-colour-regression.md:58` requires it be noted against this item.
`team-highlight.md:37-39` is the reason — a pseudo-element at `z-index: -1` paints behind the
stacking context, so the row needs `isolation: isolate`; and lifting row content with
`position: relative` **breaks the team-colour bar**, because the bar is absolutely positioned against
`.sb-line` and making `.who` positioned re-anchors it. **`isolation` removes the need for that rule
entirely** — which is why this item depends on 5b having shipped it, and why a future "simplify the
stacking" change would silently shift every bar.

**Also unrecorded:** the slice 5 registry entry does not mention the team-colour removal, and CARRY
row 4 — the amber border retired as a deliberate decision with the eyebrow pill carrying its emphasis
forward — is still absent from `DESIGN.md`.

### Item 118 — Schedule status filter with counts

**MIGRATED to [#677](https://github.com/znpruitt/cfb-app/issues/677) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 115 — Overview sections truncate with no expansion, though "bounded default" was decided

**MIGRATED to [#676](https://github.com/znpruitt/cfb-app/issues/676) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 114 — CLOSED, MISDIAGNOSED. Featured empties early; expiry was never involved

**Filed and closed 2026-09-03.** Kept as a record because the wrong diagnosis survived a code review
and a doc entry before production data disproved it.

**What it claimed:** Featured lingers past the Thursday 06:00 ET boundary while Recent finals
releases, leaving stale results on the page. Owner decision at filing: the two should expire
together.

**Why it is wrong, in two independent ways.**

1. **Featured empties EARLY, not late** — the opposite failure. It is scoped to the active slate, and
   `keyMatchups` drops finals whenever that slate still holds upcoming games. Building the fix this
   item specified (running `recentResults` through the expiry predicate) would have emptied Featured
   sooner still, in exactly the wrong direction.
2. **The boundary is not a fixed Thursday.** It floats with a week's last game — see the correction
   in [[Item 101]]. Week 1's last game is 2026-09-07, so Recent finals does not release it until
   2026-09-10. Nothing was stale; Recent finals was correct the whole time.

**The real cause is [[Item 100b]]**, whose date gate has been removed. Provider week 1 spans
2026-08-27 to 2026-09-07 (455 games, twelve days) because CFBD buckets week 0 into week 1, so the
active slate carries finals and upcoming games simultaneously and Featured renders nothing for the
whole stretch. The internal slate marker is the fix.

**Process note worth keeping.** The review scenario that produced this item assumed the selected week
still pointed at the old week. It does not — `chooseDefaultWeek` advances to the latest week whose
first kickoff has passed. The item was written from a plausible mechanism instead of an observation,
and a single production screenshot overturned it. Two ledger entries and a code-review finding
carried the error forward before anyone looked at the page.

- Backlog slug: none — superseded by `PLATFORM-WEEK-ZERO-MODEL-v1` ([[Item 100b]]).

### Item 113 — Featured games is a plain finals list; the insights-hook reframe was decided but never built

**MIGRATED to [#675](https://github.com/znpruitt/cfb-app/issues/675) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 111 — `/api/odds` fetches its own origin, costing two extra invocations per request

**MIGRATED to [#658](https://github.com/znpruitt/cfb-app/issues/658) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 105 — the postseason override endpoint writes an unvalidated `Partial<AppGame>`

**LOW severity hardening. Rewritten 2026-09-02 — the defect this item was originally filed for does
not exist.** It was filed from GitHub issue #548's framing without tracing the mechanism, and a
`CURRENT` gate was placed on Item 87 slice 4 on that basis. Both were wrong; the gate is removed
and issue #548 is closed. The trace is recorded below so the question is not reopened from scratch.

**What is actually open.** `PUT /api/postseason-overrides` (`route.ts:45`) requires admin auth and
validates only that the body's `map` is a non-array object — then writes it straight to durable state
via `setAppState(scope, 'map', map)`. No field allowlist. `applyManualOverride`
(`schedulePostseasonHelpers.ts:14`) then spreads it over a real game and explicitly honors
`participants.home` / `participants.away`.

That matters because `canonicalSlate.ts:392-395` pairs `home`/`away` taken from the BUILT game with
`homeId`/`awayId` read from the WIRE row by provider id. An override that changes participants moves
the labels and leaves the numeric ids where they were, so a consumer joining by team id can credit
the wrong team. This is the same unvalidated-spread hazard `scheduleEligibility.ts:110-125` already
warns about, now with a second consequence attached.

**Reachability: hand-crafted request only.** The product cannot produce such an override. There is
exactly ONE call site in the UI (`GameWeekPanel.tsx:330`), it is gated on `isAdmin` AND
`card.isPlaceholder`, it opens a `window.prompt`, and it emits `{ label: nextLabel.trim() }` —
nothing else. No control anywhere changes which team is home.

**Fix:** constrain the override payload to the fields the product actually emits, rejecting the rest
at the route. Closes this and the pre-existing eligibility hazard together.

#### The trace that closed the original defect (measured 2026-09-02)

Every path to a label/id misalignment, each checked rather than argued:

| Path                                     | Result                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Provider inverts home/away               | 20,828 games over six seasons: **0 inversions, 0 changes**; pid assignment stable across pulls five years apart   |
| Provider omits a game id                 | **0 of 22,760 rows** across seven seasons — no missing, non-numeric, or beyond-safe-integer ids                   |
| Provider sends duplicate ids             | postseason sets are fully distinct: 139/139, 54/54, 86/86                                                         |
| Provider sends placeholders              | **0** placeholder-looking rows in three postseason slates; CFBD publishes a game only once the matchup is settled |
| Two rows share an id                     | rejected at `canonicalSlate.ts:345` BEFORE source-item metadata is read                                           |
| Two rows have different ids              | never merged — `isIncompatibleCollision` rule 1, the guard PLATFORM-086H3E4 produced                              |
| The app's own `cfp-*` placeholder shells | participants unresolved, so `mergedParticipants` never takes their orientation                                    |
| An override creates a row                | it cannot — `applyManualOverride` patches an existing candidate                                                   |

**`AppGame` has no `homeId`/`awayId` fields at all**, so issue #548's proposed fix — swap them in the
merge return — could not be written as described. The numeric ids live on `CanonicalGame`, stamped
from the wire row, which is why the seam is the slate rather than the merger.

**Participant ids are absent only for 2018** (0 of 1,556 rows; 2021-2026 are 100% covered; 2019-2020
are not cached). A backfill was considered and deferred: it would not reduce this risk — it would
make 2018 _eligible_ for a misalignment it currently cannot have — and a refreshed 2018 would newly
carry provider classification, changing what PLATFORM-120's filter does to an archived season. Revisit
only if Item 87 slice 4's record join reaches historical seasons.

- Backlog slug: `PLATFORM-OVERRIDE-PAYLOAD-VALIDATION-v1`

### Item 110 — game stats have no correction path, and nothing detects that they diverged

> **MEASURED IN PRODUCTION 2026-09-08 — this is no longer a latent gap.** Evidence: [the 2026-09-08 audit](archive/audits/codebase-audit-existing-plans-2026-09-08.md) → **C3**.
> Five stored game-stat records disagree with newer CFBD observations, **three of them FBS games already
> classified "satisfied"** and outside ordinary polling eligibility, stored observation fence
> `2026-09-08T04:45:06.949Z`. Largest: Georgia Southern total yards **424 → 513**.
>
> **Split into two items under this identity, because recovery and prevention have different risk
> profiles and must be reviewed separately:**
>
> **110A — bounded recovery. ✅ RECOVERED 2026-09-09** (`PLATFORM-110A-GAME-STAT-RECOVERY-CLAUDE-v1`).
> Five records re-observed and applied, owner-authorized, verified against the replica: five updated,
> 202 retained untouched, `written-clean`. One CFBD call.
>
> **The acceptance criterion said "the five agree with a fresh observation", and the lane correctly held
> the merge to ask whether a PARTIAL repair meets it** — raw-only categories are not repairable through
> the merge authority (Item 193). **Ruled met, and the reason is structural rather than a concession:**
> `mergeRawEvidence` writes a raw category only where a parser exists, and
> `RECOGNIZED_GAME_STAT_CATEGORIES` — the list `publicProjection.ts:137` loops over to build the exposed
> `raw` record — is derived from the same specs. **The categories the merge cannot repair are exactly the
> categories the projection never exposes.** `tackles`, `sacks`, `qbHurries` and `completionAttempts`
> are stored and unreachable by Insights or the archive. **Acceptance is met for every field a consumer
> can read.**
>
> **The evidence table the owner approved was incomplete, and that is recorded rather than folded into a
> caveat.** It listed 26 normalized deltas; the merge also rewrote roughly thirty raw-only categories it
> never showed. Every delta in it was backed by a present category, so nothing in it was false — **but
> "not wrong" is not the standard for the sole basis of a production data change.**
>
> **110A — bounded recovery. Dispatch position 1.** Re-observe and correct the five measured records
> **through the existing authorized partition writer**, retaining before/after evidence. Preserve
> canonical identity, writer fencing, prior-good retention, quota controls and truthful outcomes.
> **Acceptance:** the five named provider IDs agree with a fresh observation, with the before/after
> recorded. **Bounded** — this is not a season-wide sweep.
>
> **110B — recurring correction reconciliation. Dispatch position 2, designed and reviewed separately.**
>
> **IMPACT ESTABLISHED 2026-09-09, after a demotion was proposed and withdrawn.** The planning session
> argued 110B down on the grounds that game stats touch only Insights and archives, that Insights
> measured about three pageviews a week, and that archives are rebuildable. **Two of those three were
> wrong, and the third does not carry the weight it was given.**
>
> **The insights feed loads with the APP SHELL, not on a tab.** `useInsightsFeed` is called from
> `CFBScheduleApp.tsx:1069`, so stats-derived content renders wherever the app renders. The three
> pageviews a week measured the Insights TAB, which is not the population that sees the feed — the same
> ingests-versus-renders error this project has recorded before.
>
> **The claims are ATTRIBUTIONS, not numbers.** `insights/generators/stats.ts` emits named awards —
> `Ball security leader`, `Defensive takeaway king`, and a `yardsPerWin` ranking — each naming an owner.
> **`Defensive takeaway king` is computed from turnovers, and turnovers were among the corrupted
> fields** (Charleston Southern, 1 against 2). A wrong stat does not surface as a wrong number; it
> surfaces as the wrong member being credited.
>
> **Archives being rebuildable is true and remains true** — `saveSeasonArchive` overwrites and
> `buildSeasonArchive` reads the caches live, so a corrected season can be re-archived for roughly 16
> CFBD calls. **That bounds the permanence of the damage. It does not reduce the weekly exposure**, which
> is the part that reaches members.
>
> **Owner ruling: keep 110B in the near-term queue.** Closing the gap now is proportionate.
> Revisit **satisfied** partitions on a cadence, record changed games and failures, and support
> missed-run recovery. **Extending the initial polling window alone is insufficient** — satisfaction
> establishes usability, not an immutable final provider revision.
>
> **CADENCE RULED 2026-09-09, on measurement rather than judgement.** The Item 110B lane spent **3
> billed CFBD calls** across three partitions and reported: **zero recognized-category changes in 203
> games** at +34h in `2026:1:regular`, and **byte-identical category dictionaries** in two historical
> partitions after **44 days** and **146 days**. **Revisions arrive fast and settle fast.**
>
> **Ruled: one pass per current-season partition at ~kickoff +48h, one cheap second pass at +7 days,
> then never. Historical seasons are never swept.** ~20 calls per season per pass, ~40 total, one call
> per run.
>
> **What the number rules out, each rejected on evidence:** a recurring season-wide or full-history
> sweep (146 games byte-identical after months); a perpetual reconciliation with no horizon; a tight
> hourly or daily-forever cadence (zero new revisions arrived between +25h and +34h); per-game `gameId`
> fetches (203 calls to find 5, and the 5 cannot be named before fetching); and a pass at ~24h, which
> the ordinary cron already owns.
>
> **The +7d pass is the half the measurement does NOT support, and it is labelled as such.** The
> interval from ~2 days to ~44 days is unmeasured — both historical partitions were first observed 7.6
> months after their games, so they prove nothing changed between months 7.6 and 12.4, not between day
> 2 and month 7.6. **It is insurance, and its own run records must be able to retire it within a
> season.** Build it so they can.
>
> **TWO DESIGN RULINGS, 2026-09-09, both raised by the lane at review rather than decided silently.**
>
> **1. Reconciliation REQUIRES the partition to be satisfied. Gate it.** The prompt's scope said so —
> _"it revisits SATISFIED partitions; ordinary polling already covers the rest"_ — and the lane
> correctly reported that it had widened this during design without saying so. **The safety-net
> argument is the one to reject:** a reconciliation that quietly fills a partition the poller never
> collected **masks the collection gap instead of surfacing it**, which is the exact failure this
> entire audit was spent on. A never-collected partition is a HEALTH problem — Item 132's scope — and
> making reconciliation paper over it would remove the only evidence anyone would ever see.
>
> **2. Reconciliation DOES record `provider-refresh-status`, under a scope kind `game-stats` does not
> own.** Neither of the two options offered is right. Not recording loses the failure entirely — the
> ledger holds it but nothing reads the ledger — and teaching the health reader to ignore old-week
> reconciliation attempts adds a special case to a reader that already has the general mechanism.
>
> **`DATASET_ACTIVITY_SCOPE_KINDS` (`providerRefreshHealth.ts:285-301`) already gates activity
> eligibility by scope KIND**, and its docblock states the purpose in these words: _a structurally-valid
> but MISROUTED record must not become that dataset's latest activity_. `game-stats` owns
> `year`, `season-partition` and `week-partition`. **A reconciliation writing under a new kind is
> recorded, readable, and ineligible as latest activity BY CONSTRUCTION** — Root 3 cannot fire, Item
> 194's every-writer-records-status direction is preserved, and the health reader learns nothing new.
>
> **It costs a scope kind and its parser. Pay it** — the alternative is either a blind spot or a
> special case, and this codebase already chose this mechanism for this exact problem.
>
> **3. A merge verdict CLOSES the pass when the response omitted an expected game — ruled 2026-09-09,
> with a condition.** Record `notObserved` and move on. **The reason is not that retrying is expensive;
> it is that THERE ARE TWO PASSES.** A genuinely transient omission is re-observed at p2 seven days
> later, so retrying inside p1 pays extra calls to duplicate what the second pass already does.
>
> **The condition is binding: p2 must run regardless of p1's outcome.** If closing p1 suppresses p2,
> the retry argument collapses and the closing becomes wrong. **That is the defect to test for, not the
> closing.**
>
> **The omission is measured persistent, not assumed.** Item 110A found four rows absent from the CFBD
> response for `2026:1:regular`; the 110B lane's live run reproduced **exactly four**, a day apart.
>
> **A full-history sweep is independently impossible, not merely expensive — see Item 196.** 96 of 97
> partitions are legacy rows that `computeWeeklyGameStatsMerge` classifies `updated` unconditionally,
> so a sweep would report every game as changed while changing nothing.
>
> **BUILT 2026-09-09 on `claude/110b-correction-reconciliation` — implemented and reviewed, NOT yet
> merged, and NOT run against production.** The cadence shipped as ruled, gated on SATISFACTION: only
> a partition whose coverage is `complete` is revisited, so a collection gap stays visible instead of
> being quietly filled. It is a SECOND CONSUMER of the game-stats cron's existing run slot rather
> than a second job — considered only when ordinary polling has no target — so the
> one-billed-call-per-run promise, the quota reserve, the writer fence and the outcome interpreter
> are unchanged, and no new schedule was needed. **The binding p2-independence condition is enforced
> by a named test**, and a mutation making a closed p1 suppress p2 fails it. Three independent
> reviews across two remediation rounds; test delta **+64**. Detail is in the registry entry
> (`PLATFORM-110B-CORRECTION-RECONCILIATION-CLAUDE-v1`); the measurement that ruled the cadence is in
> the audit's C3.
>
> **Two findings recorded and deliberately not fixed**, both in code comments: a `pending`
> unknown-kickoff game can let a partition read `complete` around it — bounded, and once the kickoff
> is repaired the game becomes expected with no evidence, coverage leaves `complete`, and
> reconciliation DECLINES the partition, which leaves the gap visible as ruled; and unreconcilable
> partitions are re-probed on every idle run — no spend, no correctness impact, and the fix trades
> read count against fairness.
>
> **Boundaries that must not blur.** **Item 140 is score-observation measurement and is NOT a
> prerequisite here** — it measures when a SCORE first reads final, which cannot measure when
> STATISTICS stop changing. **Item 131 is a collection/cost decision**, not correction.
> **"Repeatable" permits a legitimate observation-timestamp update without duplicate statistics**; it
> does not mean zero database writes. And this is **stale statistics, not score disagreement** — all
> **454** comparable finals agreed.

**Reframed 2026-09-02.** First filed about SCORES. The owner's observation — that a provider revising
"game data" is far more likely to mean box-score stats than final scores — is supported by the one
measurement available, and it inverts the severity. Scores are unambiguous and settle at the whistle;
stats are what conference crews revise for days.

**The provider revises on a schedule.** CFBD's admin, 2026-09-02: _"game data can change up to
several hours afterward. I will always do a 'final' data reconciliation on Sundays for that week's
games."_

|                        | scores                    | game stats                       |
| ---------------------- | ------------------------- | -------------------------------- |
| Divergence detected?   | yes — `differenceCount`   | **no**                           |
| Correction applied?    | no, deliberately          | no                               |
| Surfaced anywhere?     | weakly, as receipt detail | **not at all**                   |
| Observed in production | **0 differences**         | unmeasurable — nothing counts it |

#### The stats gap — the primary concern

`gameStats/pollingTarget.ts:41-43`: a game becomes pollable exactly 3 hours after kickoff and leaves
the window exactly **24 hours** after kickoff. A partition also stops being a candidate once its
evidence is satisfied, which in the normal case happens the same night. There is no re-ingest path —
no revisit of a satisfied partition, and the Tuesday sweeper handles SCORES only.

So a Saturday noon game's stats window closes Sunday noon, CFBD reconciles "on Sundays", and whatever
we ingested is permanent. **Nothing detects the divergence and nothing reports it.** The only
correction is an operator forcing `bypassCache=1` on `/api/game-stats`.

**The blast radius is small, which caps the item's priority.** Consumer inventory, measured
2026-09-02 — stored game stats are read ONLY by:

- `insights/context.ts` — insight generation;
- admin surfaces (`GameStatsCachePanel.tsx`, `manualRefresh.ts`);
- diagnostics (`archive-integrity`, `providerCacheState`, `providerDataDiagnostics`).

**No member-facing component fetches `/api/game-stats`**, and `seasonBuild.ts` contains no reference
to game stats, so the season archive does not embed them. A missed correction therefore produces
slightly-wrong generated insight copy — never a wrong scoreboard, and nothing a member sees during a
game. Combined with `scoreDifferences=0` on the score side, this item sits below everything currently
ahead of it in the run order.

**This is unsized on purpose.** We cannot say how often stats change after satisfaction, because
nothing compares. Sizing it is one CFBD call: re-fetch a played week's `/games/teams` and diff against
the stored partition. **Do that before designing anything** — if the diff is empty, this closes; if it
is not, the size of the diff picks the fix.

#### The score finding — recorded, measured rare

`finalScoreSweep.ts:305-313`, inside the weekly Tuesday refresh:

    if (cachedGame?.final) {
      if (scorePair(cachedGame.final.pack) !== scorePair(candidate.pack)) {
        differenceCount += 1;
        differences.push(candidate.identity);
      }
      continue;                    // records the divergence, writes nothing
    }

Live polling cannot pick it up either — `resolveWindowState` marks a confirmed final `resolved` and
`selectPollingPlan` never targets it again. So no path applies a score correction to a confirmed
final.

**The refusal is probably right** — the same conservatism that rejects an empty provider response, and
reversing it would let a blip overwrite a good final. **Measured 2026-09-02: `scoreDifferences=0`** on
the schedule-refresh receipt dated 2026-09-01T12:00, the first Tuesday after CFBD's opening-weekend
reconciliation, across the 8 games played. One observation, latest-only receipt, small sample — but it
is the only evidence there is, and it points away from scores.

What remains wrong on the score side is legibility, not correctness: `scoreDifferences` renders only
as a fragment of the schedule-refresh receipt's detail string (`systemHealthPresentation.ts:232`,
appended after year counts beside repairs, sweep failures and kickoff changes) and raises no issue —
`systemHealthIssues.ts` has no score-difference code, so the row reads healthy.

#### What to decide, once the stats diff is measured

- Should a detected divergence — of either kind — raise a health issue so a human adjudicates?
- Is CFBD's own Sunday reconciliation a class safe to apply automatically, unlike a mid-game blip, and
  can either path distinguish them?
- What does an operator DO once told? There is no per-game repair affordance today, only a
  partition-wide admin `bypassCache`.

**Do not fold this into cadence work.** Item 102's tail-cadence design is separate; shortening the
polling tail neither helps nor hurts this, because live polling was never the correction path for
either dataset.

- Backlog slug: `PLATFORM-STATS-CORRECTION-DETECTION-v1`

### Item 108 — CLOSED, VERIFIED: live scores DO tick for FBS-vs-FCS games

**Answered 2026-09-04 05:21–05:24Z against the read-only replica. No defect; both assumptions hold.**

**The proof is a clock that moved.** `401866409` (UAlbany FCS @ Buffalo FBS, kickoff
2026-09-03T23:00Z) sat in `scores/2026-1-regular` reading `status: "Q4 4:53"`, and on a second read
three minutes later read `"Q4 1:02"`, with `itemUpdatedAtById` stamped at the moment of the query.
Only `/scoreboard` produces an in-progress clock — `/games` returns finals — so both open questions
are answered at once:

1. **`/scoreboard?classification=fbs` DOES return a game with an FCS side.** The row is present.
2. **`matchScoreboardRows` DOES match it.** The row reached the durable store with a live clock, and
   kept being updated on the `*/3` cadence.

The other five reconciled to `final` at kickoff **+3.40h to +4.75h** (Bethune-Cookman @ UCF, West
Georgia @ Kennesaw State, Merrimack @ Delaware, Arkansas-Pine Bluff @ Missouri, Eastern Illinois @
Minnesota). The Buffalo game was still in progress at 6.4h after kickoff — a long weather delay is
the likely explanation, and it is why the live evidence was still visible at all.

**Correction to this item's own dispatch note.** It said to read
`provider-refresh-status / scores:week:2026:2:regular`. That key does not exist. All six games are
**week 1** — CFBD buckets weeks 0 and 1 together, so the 2026-09-03 slate is week 1 — and the receipt
is `scores:week:2026:1:regular` (`lastSuccessAt` 05:06:02Z, `rowsCommitted: 1`, outcome `no-op` on the
following attempt).

**Process note: the evidence was perishable.** Holding for the filed "morning of 2026-09-04" read
would have found all six games reconciled to `final`, which proves reconciliation and not live
ticking — the exact ambiguity that made 2025 unable to answer this. The discriminating evidence
existed only while a game was still on the clock.

**One observation, not a finding — mechanism unconfirmed.** The live row carries
`away.team: "ualbany"`, the canonical id, where all five final rows carry provider-cased names
("West Georgia", "Bethune-Cookman"). That is the same slug shape POLISH-021 fixed on the Schedule
participant path. But there was exactly **one** non-final row in the cache, so this cannot distinguish
"the live path writes canonical ids" from "UAlbany specifically resolves to a slug" — n=1 for both.
Re-check when the next FCS-vs-FBS game is live; the next is West Georgia @ Arkansas State, week 2,
2026-09-12T23:00Z.

**A verification, not a fix — the defect may not exist.** Filed 2026-09-02 from a deliberate pass over
narrowing decisions, because the first FBS-vs-FCS games under the current live-score engine kick off
**2026-09-03 19:00 ET** (six of them: Bethune-Cookman @ UCF, Merrimack @ Delaware, West Georgia @
Kennesaw State, Arkansas-Pine Bluff @ Missouri, Eastern Illinois @ Minnesota, UAlbany @ Buffalo).

**The question.** `live-scores/route.ts:312` calls `buildCfbdScoreboardUrl({ classification: 'fbs' })`.
Two assumptions must both hold for those games to update DURING play, and neither has been exercised:

1. **Does `/scoreboard?classification=fbs` return a game where one side is FCS?** CFBD's `/games`
   treats `fbs` as the FBS slate — all **126** FBS-vs-FCS games in the 2025 schedule carry scores — but
   `/scoreboard` is a different endpoint and could read the parameter as "both teams FBS".
2. **If the rows return, do they match?** `matchScoreboardRows` resolves each row's labels through the
   identity resolver. That is the exact step that failed for odds (Item 106). It should hold here —
   CFBD sends plain school names, not the mascot-suffixed labels The Odds API sends, and
   "Bethune-Cookman" already reaches `observedNames` from the schedule — but "should hold" is what was
   assumed about odds.

**Why 2025 does not answer it.** The live-scores job uses `/scoreboard` for in-progress games and
`/games` for final reconciliation, and **both write the same durable store**. So 2025 proves finals
arrive, not that live updates do. 2026 cannot answer it either: all eight games played so far are
`fbs/fbs`.

**The system already records the answer — do not watch the UI.** If targeted games are missing from
the scoreboard response, `runScoreboard` records `scores-scoreboard-targets-missing` and resolves the
run `partial`. Read `provider-refresh-status` for `scores:week:2026:2:regular` (read-replica query,
free) on the morning of **2026-09-04**:

- clean successes, no `targets-missing` → both assumptions hold, **close this item**;
- `targets-missing` on a week containing FBS-vs-FCS games → confirmed.

**Scope if confirmed.** Widen the scoreboard request, or fall back to the `/games` partition path for
unmatched targets. Both are contained — the route already has a final-reconciliation mode that reads
`/games`.

**Why it was worth filing rather than remembering.** This is the same shape as Item 106: a scope
decision pinned at the provider boundary, correct when made, invisible until a new case needs the
excluded thing. If it is broken it breaks on opening night, silently, on the surface members watch.
The check costs one query.

- Backlog slug: `PLATFORM-SCOREBOARD-FCS-COVERAGE-v1`

### Item 107 — PLATFORM-122 deferred review findings (three, all small)

Accepted `/code-review` findings on PLATFORM-122 that were deliberately NOT taken in its remediation
round, so the round stayed cohesive. None is a correctness defect; each removes a way the odds
matching can quietly degrade later. Verified present on `c24950b9` 2026-09-02.

#### 107a — the label normalizer is rebuilt on every call, on a public read path

`oddsAttachment.ts:73` constructs `createOddsTeamLabelNormalizer` per call. Reviewer-measured
**10.28 ms per build** (1,035 games, 138 teams, 928 mascot rows, averaged over 20 builds). It is built
once per `buildNextOddsStore` — which `maintainCanonicalClosingLines` invokes on PUBLIC odds reads —
once per `buildOddsByGame`, and once per `emptyOddsClassifier` reconciliation.

The result is a pure function of `(games, resolver)` and nothing mutates it, so it memoizes cleanly;
the resolver already caches its own registry by a `JSON.stringify` key for exactly this reason. Small
against what PLATFORM-120 removed, but it is per-request CPU on a read path, which is the category
this project just spent a campaign reducing.

#### 107b — `buildDurableOddsSnapshot`'s normalizer parameter is optional, defaulting to pre-fix behavior

`odds.ts:293`. `attachOddsEventsToSchedule` builds a normalizer when none is passed;
`buildDurableOddsSnapshot` silently does not. A caller that attaches (getting the new matching) but
omits the parameter here writes a snapshot whose `moneylineHome` / `homeSpread` / `awaySpread` are all
`null` — **a durable row that exists but carries no line, which is harder to notice than no row at
all.** Both current callers pass it, so this is prophylactic: make the parameter required, or default
it the way the attachment layer does.

#### 107c — the mascot table is a THIRD ungoverned team snapshot

**Reframed 2026-09-02.** This was first filed as "add a refresh hook", which would institutionalise
the problem rather than fix it. The table is a third CFBD-derived team snapshot alongside
`src/data/teams.json` and the durable catalog, and **the right home for it is the Team-catalog source
unification campaign** (see Planned and parked campaigns), which was scoped for two snapshots before
PLATFORM-122 added this one.

Do NOT simply wire `npm run fetch:odds-team-mascots` and call it closed — that makes three
independently-refreshed sources permanent. Decide the sourcing question first; if unification is
deferred, a refresh script plus a staleness signal is an acceptable INTERIM, recorded as such.

The concrete defects below are real either way, and are what a divergence guard would have to catch.
`scripts/fetch-cfbd-odds-team-mascots.ts`, verified 2026-09-02:

- **No `package.json` script.** Every other generator in the repo has one (`fetch:teams`,
  `manage:odds-schedule`, …). Wire `npm run fetch:odds-team-mascots`.
- **`CFBD_ODDS_TEAM_MASCOTS_SOURCE` and `CFBD_ODDS_TEAM_MASCOTS_GENERATED_AT` are emitted but read by
  nothing** — confirmed by grep across `src`, `scripts`, and `docs`. Nothing surfaces the table's age.
- **`npm run fetch:teams` regenerates `teams.json` without touching the mascot table**, so the two
  snapshots drift silently.
- **Line 134 stamps `new Date().toISOString()` unconditionally**, so every regeneration produces a
  diff even when the data is identical — which trains a reviewer to ignore the diff.

Failure it allows: an FCS school renames or changes mascot next offseason, its provider label stops
normalizing, its odds silently stop attaching, and the only symptom is an `unmatched_pair` diagnostic
no surface reports on. Having System Health or the odds diagnostics read `GENERATED_AT` closes it.

**Coverage is complete today, so drift is the ONLY way this breaks.** Measured 2026-09-02 against the
2026 schedule: all **238** teams appearing in FBS-involving games resolve — every
`"{School} {Mascot}"` provider label reaches the correct team identity, zero unresolved, zero
wrong-identity. The table holds 928 rows (fbs 138, fcs 128, ii 171, iii 246, unclassified 245). Note
this is a point-in-time answer: postseason opponents are not in the 2026 schedule yet, so bowl season
introduces teams this check has not seen. The residual risk is naming drift, not missing rows —
Nicholls and SE Louisiana both HAD rows and still needed static aliases because CFBD's school name
differs from the schedule's.

- Backlog slug: `PLATFORM-ODDS-MASCOT-FOLLOWUPS-v1`

### Item 106 — a third of fetched odds are discarded: mascot-suffixed non-FBS names never resolve

**MIGRATED to [#657](https://github.com/znpruitt/cfb-app/issues/657) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 104 — `canonicalWeek` compresses `(seasonType, week)` into one integer and derives the offset from data

**The provider is not ambiguous; we make it ambiguous.** CFBD sends `seasonType` on every row —
measured 2026-09-02, **0 rows missing or out-of-vocabulary** across 2023-2025 — so `(seasonType,
week)` is already a unique key. The compression is visible in the counts:

    2023  rows=3734  distinct (seasonType,week)=21  distinct week alone=15
    2024  rows=3801  distinct (seasonType,week)=17  distinct week alone=16
    2025  rows=3831  distinct (seasonType,week)=19  distinct week alone=16

Six postseason weeks collapse onto regular-season weeks 1-6 in 2023 alone.

**Why the app compresses.** `standingsHistory.ts:65` models the season as `weeks: number[]` — a plain
ordered integer axis. To place postseason games on it, `buildScheduleFromApi` discards `seasonType`
and manufactures an ordering: `schedule.ts:399` reduces `maxRegularSeasonWeek` over the raw rows and
`:419` computes `postseasonCanonicalWeek = maxRegularSeasonWeek + providerWeek`.

**The consequence, found the hard way during PLATFORM-120.** That offset is derived from the RAW row
set, so removing rows moves postseason games. A non-FBS regular-season week-16 row is enough to shift
every bowl and CFP game by one canonical week, and because `PendingGame.week` copies the canonical
game week (`standingsHistory.ts:181`), the change propagates into pending-game state. It is
member-visible: `canonicalWeek` is the rendered week label.

**Latent, not live.** Measured across every cached season, `maxRegularSeasonWeek` is IDENTICAL whether
reduced over all rows or over FBS-relevant rows only — 2018/2021/2022/2023 = 15, 2024/2025 = 16,
2026 = 15 — because an FBS game always occupies the final regular-season week. PLATFORM-120 v3
therefore derives the offset from FBS-relevant rows, which is a provable no-op today and makes the
value invariant under filtering. **That is a containment, not a fix.**

**The actual fix is to stop compressing.** Carry `seasonType` on the week axis so ordering comes from
the pair rather than from a data-derived scalar. This removes the whole fragility class rather than
making one derivation insensitive to one filter.

**Scope care — this is a real refactor, not a cleanup.** `weeks: number[]` reaches trend charts, week
tabs, `PendingGame`, and recap targeting. It is the same underlying defect [[Item 100b]] names from
the other side: `canonicalWeek` is doing double duty as the member-facing label AND the internal
grouping key. Settle them together, or at least in the same design pass.

**Rejected middle option, recorded so it is not re-derived:** making the offset a constant
(`20 + providerWeek`) kills the data dependency in one line, but renumbers existing postseason week
buckets across every archived season and leaves a 16→21 gap in trend charts. Not worth it purely for
robustness once v3's containment lands.

- Backlog slug: `PLATFORM-WEEK-AXIS-SEASONTYPE-v1`

### Item 102 — derive the QStash polling cron from the schedule

**The ask:** stop live-scores and game-stats from firing outside game windows. Once a day, read the
canonical schedule, derive the polling windows, and rewrite the two QStash cron expressions to cover
only those windows.

**The value, measured 2026-09-01:** `/api/cron/live-scores` is **75% of all Vercel Active CPU** and
live-scores plus game-stats is **87%**, at 1.20 s and 0.95 s per invocation across a 12-hour window.
The Hobby 4-hour Fluid allowance is exhausted at ~7h15m/30d. **66.7% of invocations are cold starts**,
so removing an invocation saves its floor as well as its work — which a cheaper handler cannot.
Full evidence, including the rejected alternatives, in
[`docs/campaigns/vercel-active-cpu.md`](campaigns/vercel-active-cpu.md).

**Pairs with shipped PLATFORM-120.** That change cuts the canonical-build cost of every live-score
and game-stats invocation; this cuts their number. Projected together: ~1.1 CPU-h/30d against ~2.8 h
for PLATFORM-120 alone.

**That projection is ANNUAL, and the allowance is monthly — measured 2026-09-05.** Replaying the
planner's own window rule against the real 2026 schedule (3,679 games), hours armed are **17% for the
year** — which confirms the ~20% duty cycle the projection assumed — but **74% in October**, 49% in
September, 66% in November. In the binding month the planner therefore removes ~26% of live-scores
wakeups, landing near ~2.25 h rather than ~1.1 h. **The 24-hour tail is the cause, not kickoff
density**: one Saturday game arms all of Sunday, and October falls to 50% at a 12h tail and 33% at 6h.
Restricting to FBS games does not help — the 888 FBS-involving games give 74% in October, within a
point of the full slate. The tail cannot simply be shortened; `kickoff + 24h` is the
final-reconciliation guarantee, and PLATFORM-105A already found that boundary giving up on late
finals. **Build it for the ~83% annual saving and the manual pause it retires — not as the fix for
in-season pressure.** Evidence and the sensitivity table:
[`docs/campaigns/vercel-active-cpu.md`](campaigns/vercel-active-cpu.md) → _The 20% duty cycle is an
ANNUAL average_. An in-route gate before the context load was proposed and dropped as
redundant against the pair — recorded in the campaign doc so it is not re-derived.

**Four things it collides with, all located:**

1. `scripts/lib/qstashSchedule.ts:342` treats the cron as a FIXED contract constant and reports
   divergence; a planner-written cron makes `inspect` refuse permanently. The cron must become
   planner-owned for these two jobs.
2. `src/lib/server/schedulerDeliveryHealth.ts:82,88` hardcodes `*/3` / `*/15` with 6- and 30-minute
   grace. Narrow the cron and both jobs read `late` forever — the two rows that matter most on a game
   day. Delivery expectations must derive from the planner's window.
3. `QSTASH_TOKEN` is operator-CLI-only today (`qstashSchedule.ts:644`); nothing in `src/` calls the
   QStash management API. A runtime planner needs it in the Vercel environment.
4. One schedule holds one cron expression, so windows over-approximate as hour ranges. Safe — the
   handler guards still block the CFBD call — and it lets the planner stay coarse.

**Existing handler guards stay.** They are the defence for kickoff changes, postponements, stale
QStash state, and planner mistakes. The planner reduces wakeups; it must not become the only
correctness or quota protection.

**What the planner actually buys, and what it does not — recorded 2026-09-04.** It frees **Active CPU
only**. Dead-day runs already cost **zero CFBD quota**: the route bills at most one request per run
_and only when armed_, because the handler guards block the provider call outside game windows, so
Item 95's `monthly calls = armed hours × runs/hour` is already independent of what the cron does on a
Tuesday in July. What those runs do cost is a Vercel invocation, and that is the budget under
pressure — live-scores is 75% of all Active CPU and rebuilds 3,676 rows before deciding to do
nothing. This item's ~1.1 h/30d against the 4 h allowance therefore banks roughly **2.9 h of headroom
that does not exist today**.

**That headroom is the case for polling FASTER inside game windows** — the owner's observation, and
the mechanism is right: stop spending on dead days and there is budget for the hours that matter.
**But a faster in-window cadence spends both budgets.** More invocations (CPU, now funded by this
item) _and_ more provider calls (quota, NOT funded by it, because dead days were never spending any).
Doubling the in-window rate doubles the quota line exactly — `armed hours × 40/hr` instead of
`× 20/hr`. Keep the two separable: ship this item for the CPU win it already justifies, and treat the
cadence increase as **Item 95 portion 2**, which is gated on **Item 94**.

**`QSTASH_TOKEN` in Vercel — decided 2026-09-04, and the rationale recorded because none existed.**
Collision 3 above says a runtime planner needs the token in the Vercel environment. Five places say
the opposite — `docs/deployment-runbook.md:88` ("Never commit it or configure it in Vercel") and four
`scripts/manage-*-schedule.ts` headers — and **not one of them records a reason**. The owner's
reasoning, which survives scrutiny: it is lower risk than the database credential the app already
holds, and the precise form of that is **reconstructibility**. `DATABASE_URL` permits exfiltration,
destruction and silent corruption of canonical data, with no source to rebuild from.
`QSTASH_TOKEN` permits schedules to be stopped, retimed or deleted — observable through System Health
delivery health, and restorable from the repo, because `scripts/lib/qstashSchedule.ts:43` holds the
schedule contract as FIXED constants and `upsert --apply` rewrites it. Bounded denial-of-availability
with a documented recovery path, against unbounded data loss with none.

**Conditions on that decision.** Check first whether QStash offers a scoped management token limited
to the two schedules the planner touches; if it does, use it. And update all five statements in the
same PR that adds the variable — leaving them makes the repo lie about its own security posture.

**This item erodes the property that justifies the decision, and must replace it.** Reconstructibility
holds because the cron is a fixed constant that `qstashSchedule.ts:342` diffs against. Making the cron
planner-owned for `live-scores` and `game-stats` — which collision 1 requires, or `inspect` refuses
forever — turns "reconstructible from a declared constant" into "reconstructible by re-running the
planner", and costs `inspect` its ability to say those two crons are _correct_ rather than merely
_current_. The job that most needs a tampering signal becomes the one without one.

**The replacement is a durable planner-output record — owner direction 2026-09-04.** Every planner
run writes what it derived and what it sent: the input windows, the generated cron, the previous
cron, whether an upsert was applied or skipped, and the outcome. That serves three purposes at once —
debugging a bad cron, future error correction, and restoring the divergence check, because `inspect`
can then diff live QStash state against the planner's last recorded intent instead of against a
constant that no longer exists.

Three constraints on it:

- **Durable, not a runtime log.** Vercel runtime logs expire too quickly to serve as incident
  history — that is Item 126's layer 2, and repeating it here would rebuild the same defect in a new
  place.
- **Never log the request.** `buildUpsertRequest` headers carry TWO secrets:
  `Authorization: Bearer <QSTASH_TOKEN>` and `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`.
  Record an allowlisted projection — cron, `scheduleId`, destination, method, retries, derived
  windows — and never `headers`, a raw request, or a response body. The code already shows the right
  instinct: `Upstash-Redact-Fields` keeps the forwarded route credential out of QStash's own readable
  state.
- **Carry the invocation id**, so this correlates with the receipt like everything else under
  Item 126 Tier A.

**The slices — defined 2026-09-05. Slice 1 (`pollingWindows.ts`, window derivation) merged and is
live; it has no consumer yet, by design.** The split is pure derivation → durable truth → activation,
the same shape as PLATFORM-086C1 → 086C2. Each slice is independently shippable and reviewable, and
**the order is load-bearing** — see the ordering note after slice 4.

**Slice 2 — synthesis: windows → cron, and windows → delivery expectation.** Two pure functions over
slice 1's `PollingWindow[]`. No QStash, no environment variable, no durable write, no consumer.
Ships dormant.

- Synthesize a single cron expression covering the windows. Collision 4 is the governing constraint:
  one schedule holds one cron, so windows over-approximate as hour ranges. **The synthesized cron must
  never UNDER-cover a window** — over-approximation is safe because the handler guards still block the
  provider call, under-approximation silently drops a reconciliation. Assert that direction explicitly;
  it is the one property that matters.
- Derive the delivery expectation (cadence + grace) from the same windows, replacing the hardcoded
  `*/3` / `*/15` and 6/30-minute grace at `schedulerDeliveryHealth.ts:82,88` — **collision 2**. Fall
  back to today's constants when no plan exists, so this ships as a no-op against current production.
- **TWO SCHEDULES PER JOB — corrected 2026-09-05, superseding the "floor cadence" design.** Slice 1
  emits **two phases per window**: `densePhase` (start → last kickoff + 8h) and `slowPhase` (+8h →
  +24h, the reconciliation tail). They need DIFFERENT cadences, and one cron cannot express that —
  `parseCron` applies a single minute-set to every hour it matches, so the union is two rectangles.
  So `live-scores` and `game-stats` each get **two QStash schedules**: dense at `*/3`, slow at hourly.

  **Slice 2's slow cron uses an OFFSET MINUTE — `1`, not `0` — decided 2026-09-05.** `*/3` and `*/15`
  both include minute 0, so a slow cron at `0` fires simultaneously with the dense cron every dense
  hour: two invocations, both reaching the provider, both billed. `live-scores/route.ts` has no
  invocation-level lock or dedupe to absorb it. Minute 1 is in neither dense set. **This is the ONLY
  one of the review's findings that is slice 2's to fix** — the others are the delivery-health
  consumer, which is slice 3's (see above).

  **The slow phase's slower pace is the point, not a compromise.** It catches a late final without
  paying dense cost across a 16-hour tail. Covering dense ∪ slow at `*/3` is safe but gives back most
  of the saving, since the 24h guarantee is why October reads 74% armed. Covering only dense hours
  re-commits the failure `pollingWindows.ts:88` records: _"a cron built from the dense windows alone
  goes dark straight past the eligibility bound, so such a final is never collected at all."_

  **QStash supports it:** identity is the arbitrary `Upstash-Schedule-Id` header
  (`turfwar-live-scores-3m` today), independent of `destination`, so two IDs may target one route.
  Read from `scripts/lib/qstashSchedule.ts:176-196`, not from the provider — `QSTASH_TOKEN` is
  operator-CLI-only.

  **Carry into slices 3 and 4:** collision 1 widens to four planner-owned crons; slice 3's durable
  record covers both schedules per job; and the schedule IDs encode a cadence in their names, so
  `turfwar-live-scores-3m` becomes false and needs renaming once the cron is planner-owned.

- **SUPERSEDED — the floor-cadence rationale, retained because it was wrong in an instructive way.**
  It held that a dark cron would report `late` or `missing`. **False about the code:**
  `buildDeliveryRow` (`schedulerDeliveryHealth.ts:290-320`) derives `late` from
  `receipt.startedAt < requiredMs`, where `requiredMs` is the previous slot OF THAT CRON, and
  `missing` only when the receipt key is absent — never from the cron. Under a narrowed cron a dead
  day's required slot is the last armed slot, which the retained receipt satisfies, so the row reads
  **`on-time`**. The floor guarded an alarm that does not fire. What survives: no cron can mean
  "never", so a zero-window offseason still needs an expression — subsumed by the slow schedule. This
  is the behaviour superseding the manual half of Item 96.

  **Why a state change was rejected.** `SchedulerDeliveryState` is
  `on-time | late | missing | invalid | unavailable` — there is no way to say "not supposed to run",
  so a narrowed cron on a dead day would report `late` or `missing`, both alarms. Adding a sixth
  member (mirroring PLATFORM-090's `ProviderDataExpectation`) would touch `deliveryStateDisplay`,
  `deliveryRowStatus`, `noReceiptExecutionLabel` and `systemHealthIssues.ts:352`. The floor cadence
  buys nearly the same saving for none of that.

  **The floor's cost, computed 2026-09-05** (`*/3` = 480 runs/day, `*/15` = 96; armed 17% annually,
  74% in October):

  | job                  | today   | windows-only | with hourly floor         |
  | -------------------- | ------- | ------------ | ------------------------- |
  | live-scores, annual  | 480/day | 82           | **102 (79% below today)** |
  | live-scores, October | 480/day | 355          | **361 (25% below today)** |
  | game-stats, annual   | 96/day  | 16           | **36 (62% below today)**  |
  | game-stats, October  | 96/day  | 71           | **77 (20% below today)**  |

  The floor costs ~20 runs/day against windows-only in the annual case and ~6/day in October. Update
  `docs/campaigns/vercel-active-cpu.md` with these figures when slice 2 ships rather than leaving the
  windows-only projection standing.

- **`cadenceLabel` is plan-derived — owner decision 2026-09-05.** It renders verbatim at
  `SchedulerHealthSection.tsx:99` and must show the day's actual shape, e.g. _"every 3 min until 04:00
  UTC, then hourly"_, not a static rule. **Ordering consequence:** rendering it needs the plan record,
  which does not exist until slice 3. Slice 2 therefore derives the label from the windows it is
  handed and keeps the existing static constants as the fallback; the health row is not wired to a
  durable plan until slice 3 lands. Do not build a plan reader in slice 2.
- **Must not:** call QStash, read `QSTASH_TOKEN`, write durable state, or change any rendered output.

**Slice 2 SHIPPED 2026-09-05** — `claude/102-slice-2-cron-synthesis` at `575ec6cd`, dormant. Two crons
per job: dense over the dense hours at the job's existing rate, slow over the reconciliation tail
MINUS those hours, so the pair covers every armed hour and no hour is billed twice. Measured from the
shipped synthesizer against `schedule / 2026-all-all`: `live-scores` 63.2 runs/day annual and 190.7 in
October against today's 480; `game-stats` 28.8 and 45.1 against 96. **These supersede the windows-only
table above**, which was computed on the pre-slice-1 `kickoff + 24h` arming rule rather than slice 1's
clusters; see the campaign doc.

**Slices 3a and 3b are both merged. Slice 4 is next, and its two blocking specification items are
RESOLVED** — see the slice-4 entry below; both decisions made it smaller. 3a (`d1b46db4`) stores what the planner derived and sent; 3b
(`7ada7781`) makes delivery health read it. Both are dormant against production output.

**Slice 3 inherits four things, three of them found by review on slice 2:**

1. **Delivery health must stop extrapolating.** `previousScheduleSlotMs` treats a cron as eternal,
   but a planner-owned cron is rewritten daily, so it derives a required slot from a day that ran a
   different plan — roughly nineteen hours of false `late` on an armed day, and a fifteen-hour outage
   reading `on-time` in the other direction. The record slice 3 already stores holds the previous
   cron, which is the input that removes the guess. Slice 2 documents the hazard at the call site and
   wires nothing.
2. **The two-cron row.** One row carrying one cron cannot describe two schedules; restoring
   six-minute in-window detection needs both, taken as `max(previousSlot(dense), previousSlot(slow))`.
3. **A corrupt stored plan should surface as `invalid`/`unavailable`, not fall back to the fixed
   contract.** Falling back claims a firing every three minutes while the real schedule is dark, so a
   corrupt plan reads `late` continuously. That is a delivery-state decision and belongs with the row.
4. **Thread the plan through `SchedulerDeliveryHealthOptions` when it is wired.** The policy functions
   take a plan; `buildDeliveryRow` and `requiredStartedAtForJob` do not, so a partial wiring would
   display one schedule and measure against another with no test failing.

**Item 102 follow-ups from slice 2's final review** (none P0/P1; recorded under the owner's stop
boundary rather than fixed on that branch):

- **The idle slot can share a dense hour for windows slice 1's defaults never produce.** A tail-less
  window (`slowEndMs === denseEndMs`) — admitted by the synthesizer's validated contract, reachable
  through `derivePollingWindows(k, { guaranteeMs: CLUSTER_MARGIN_MS })` with an early kickoff, and
  invited by the module's own note that a caller may construct windows to cover TBD games — yields
  dense hours `0–5` and an idle slot at hour 0. One duplicate billed call per day on that shape. The
  fix is a free-hour lookup plus a generator that ranges over the accepted contract, not just over
  `derivePollingWindows` defaults.
- **`validDenseStep`'s rejection of step 60 is right but its stated reason is stale** after the
  dense/slow builders were split: `*/60` fires at minute 0 only and is no longer identical to the slow
  cron. Only step 1 genuinely collides.
- **The synthesis fallback `catch` is unqualified**, so it would swallow a programming error as well
  as the deliberate validation refusal.

**Slice 3 — SPLIT into 3a and 3b, owner decision 2026-09-06.** It had grown to seven deliverables
across two subsystems with two distinct acceptance contracts, and the risky half rides with the
additive half. **3a: the durable record + `inspect` divergence** — additive, dormant, `scripts/` plus
a new store. **3b: the delivery-health consumer** — the four inherited items, touching functions every
health path calls. 3a first, because 3b reads the record 3a writes.
**Kickoff:** `docs/prompts/platform-102-slice-3a-planner-record-claude-v1.md`.

**Slice 3a SHIPPED 2026-09-06** — `claude/102-slice-3a-planner-record` at `0e294603`, dormant.
A bounded per-job durable series (`src/lib/server/pollingPlannerRecord.ts`, ~400 runs ≈ 13 months)
holding the input windows, both synthesized crons, the previous cron, applied-or-skipped, the outcome
and a nullable `invocationId`; plus `inspect` diffing live QStash state against the last recorded
intent through an INJECTED reader, so `scripts/lib/qstashSchedule.ts` still carries no store, no
database and no application import. **Nothing writes a record in production and no `manage-*` CLI
supplies a reader**, so all seven schedules resolve `absent` and behave exactly as before.
Collision 1 is resolved. Owner rulings that shaped it: `inspect` distinguishes THREE states (absent
falls back to the constant; present-and-readable is diffed against; present-but-unreadable or a store
read failure REFUSES), the record keeps bounded history rather than latest-only, and 3a exposes the
store's read while 3b owns interpretation.

**Slice 4 SHIPPED 2026-09-07** — `claude/102-slice-4-activation`, **NOT dormant: it writes to an
external system and takes ownership of two live crons.** Registry:
[`PLATFORM-102-SLICE-4-ACTIVATION-v1`](prompt-registry.md). Three remediation rounds, the third
authorized as a deliberate ruling under `AGENTS.md:348` (narrow defects around sound production code
are not the reconstruction clause's subject).

**The saving, October first because the Hobby allowance is monthly.** `live-scores` 480 → **214.5
firings/day (−55.3%)**, `game-stats` 96 → **49.4 (−48.6%)**. Annual 57.3 (−88.1%) and 13.4 (−86.0%).

**214.5 is a SNAPSHOT WORST CASE; realized October should be near 193/day (−60%).** The gap from
slice 2's projected 190.7 is whole-day arming of kickoffs with no published time (+21.4/day, 90% of
it), not the cutover carry (+2.5/day). That cost is paid only for a game still TBD on its OWN day and
the planner re-derives daily — measured 2026-09-07, **0 of 1,070 kickoffs in the next three weeks are
TBD**, against 12–16% at four-plus weeks and 32%/60% at twelve and thirteen. Applying today's TBD set
to every future day, which the 214.5 figure does, is a worst case by construction. Record both and
label which is which.

**What the first run does.** It derives the day about to begin, creates `turfwar-live-scores-slow` and
`turfwar-game-stats-slow`, and NARROWS `turfwar-live-scores-3m` and `turfwar-game-stats-15m` from
always-on to that day's armed hours — or pauses them. The morning after, System Health shows a
**Polling planner** row (`daily (23:50 UTC)`) and the two owned rows reading their recorded cadence
instead of a fixed contract; on a quiet day their delivery cell reads a gray **Nothing due**.

**⚠️ RE-ENABLING A HELD DATASET DOES NOT RESTORE COVERAGE.** A held job is skipped entirely, so its
schedules keep whatever cron they had when the hold went on. Re-enable `scores` on a Thursday morning
and the dense schedule still carries the stale expression until the next planner run at 23:50 — so
Thursday's games go unpolled. **The runbook's "resume the schedule" step no longer restores correct
coverage for these two jobs.** Either wait for the next planner run before relying on coverage, or
run the planner manually after re-enabling.

**Slice-4 follow-ups, filed 2026-09-07 and NOT fixed** (round limit spent by owner ruling; findings on
the final commit are follow-ups by the same ruling):

- **`Upstash-Retries: 3` for the planner schedule only.** Evidence gathered: QStash's default is 3 and
  this repo's 0 is a deliberate reduction; the documented reason — a retry colliding with the next run
  of a FREQUENT job causes a duplicate billed CFBD call — provably does not apply to a once-daily job
  that makes no provider calls. Backoff (~+12s/+2.5min/+30min) lands inside the planned day. Highest
  value on this list.
- **The unbounded-wait family**, one coherent piece across three call sites: no deadline on QStash
  management requests, none on the schedule read, and slice 3b's stalled-snapshot item.
- **`latestRecordedIntentForSchedule` walks past `dense: null`** and returns an older ARMED intent, so
  §8l's "upsert --apply all ten, then resume all ten" would write a stale cron over a paused dense
  schedule. Self-clears at the next planner run.
- **A held job's DELIVERY ROW is unchanged** — the hold shows on the planner's receipt, not on the
  held job's row. Deliberately out of round 3's scope (no sixth `SchedulerDeliveryState`).
- **Two code comments contradict the lines they justify**: the `planUnavailableReason` note in
  `systemHealth.ts` and the New Year boundary claim in the planner route (the real boundary is
  30 June → 1 July).
- **`action: 'applied'` is recorded when the CLI sent nothing**; `action` is deliberately never read,
  so this is record accuracy only.

**Slice 3b SHIPPED 2026-09-07** — `claude/102-slice-3b-delivery-consumer` at `7ada7781`, **live read
and dormant output**. Registry:
[`PLATFORM-102-SLICE-3B-DELIVERY-CONSUMER-v1`](prompt-registry.md).

Delivery health reads the record as a PIECEWISE-CONSTANT TIMELINE — each run's `at` opens a span, the
CLI's exit vocabulary says what it left in force, and the following run's `previousCron` cross-checks
that span. The required slot is the LATEST across both schedules, each judged with two intervals of
ITS OWN cadence. Measured on the shipped module: the 19h04m false `late` is gone, and the 15.0 h
slow-schedule blind spot is closed.

**LIVE READ, DORMANT OUTPUT — the framing matters for slice 4.** Two additional durable reads per
System Health load (one `getAppState` per planner-owned job; delivery health goes from one durable
read to three). Nothing writes a record, so both answer `absent` and all nine rows are byte-identical
to the fixed contract — **on the read-SUCCESS path only.** A transient failure on either new query
degrades that row today, before slice 4 writes anything.

**Reconciliation of the four inherited items against what actually shipped:**

1. **Stop extrapolating — done, and it needed more than `previousCron`.** Reading the recorded cron
   was necessary but not sufficient: the timeline also has to cross-check each span against the
   FOLLOWING run's `previousCron`, or a dropped row or an out-of-band cron change silently recreates
   the extrapolation.
2. **The two-cron row — done, but `max(previousSlot(dense), previousSlot(slow))` understated it.**
   Grace had to become per-SPAN as well as per-schedule: a slot from an older expression judged with
   the current one's grace reported `late` up to two hours early.
3. **A corrupt plan surfaces — done, in a vocabulary Item 102's wording could not express.** `invalid`
   means the RECEIPT did not parse and renders "Receipt invalid"; using it for a corrupt plan asserts
   something false about a receipt that parsed fine. Owner ruling 2026-09-07: reuse `unavailable` with
   a companion reason field. No sixth `SchedulerDeliveryState`; none of its four consumers changed.
4. **Thread the plan — done, and inverted.** The plan is not threaded; the RECORD is. Slice 2 left a
   `plan` parameter on `schedulerDeliveryPolicy` as the seam slice 3 was expected to wire, and wiring
   it would have kept predicting. That parameter is now the predictive path with no production caller
   — removing it is a slice-4 cleanup.

**`action`/`outcome` contradictory pairs — CLOSED as a non-issue for this consumer, and the argument
is the useful part.** What a run left in force is a property of the OUTCOME alone: `applied`+`confirmed`
and `skipped`+`confirmed` both leave `intent.cron` live, `applied`+`failed` and `skipped`+`failed`
both leave `previousCron`. Every contradictory pair collapses to the same answer, asserted over all
ten pairs, so 3b never reads `action`. Encoding the valid combinations remains the store's to do.

**Deferred out of slice 3a, filed 2026-09-06 — one item, both stores.** `pollingPlannerRecord` and
`providerUsageSeries` are twins: each drops individually unparseable ROWS tolerantly and refuses only
when a present value yields NOTHING. Two consequences, and changing one twin without the other would
leave two behaviours for one problem, so neither belongs to 3b (delivery health has no business
setting store semantics):

1. **Preserve the unparsed rows** rather than pruning them. Below the refusal threshold a write
   reports success while history shrinks; 3a now COUNTS the loss (`droppedRuns`) so it is visible, but
   counting is not preserving.
2. **The aggregate refusal wedges the writer** when every stored row is unparseable — most reachable
   when a series is one or two rows old. Every subsequent run repeats the refusal until someone edits
   the row by hand.

Also filed: `providerUsageSeries` misreports an unreadable-prior abort as `not-recorded` when the
ROLLBACK also fails (`appStateStore` re-wraps the throw, and a bare `instanceof` misses it). Slice 3a
fixed the identical defect in its own classifier; the twin is untouched.

**SLICE 4 IS PROVISIONED AND RUNNING IN PRODUCTION — 2026-09-07 ~19:55 UTC.** Promoted in
`d51e4803`, all four schedules applied and confirmed on the first successful manual trigger:

| schedule | before | after |
| --- | --- | --- |
| `turfwar-live-scores-3m` | `*/3 * * * *` | `*/3 0,1,2,3,4,5,6,7,23 * * *` |
| `turfwar-live-scores-slow` | `1 * * * *` | `1 8,9,10,11,12,13,14,15,16,17,18,19,20,21,22 * * *` |
| `turfwar-game-stats-15m` | `*/15 * * * *` | `*/15 0,1,2,3,4,5,6,7,23 * * *` |
| `turfwar-game-stats-slow` | `1 * * * *` | `1 8,…,22 * * *` |

Receipt `result=success / reason=plan-applied`; every `previousCron` recorded. **Hour 23 is the
round-3 cutover carry working on a real game** — SMU @ Florida State, 23:30 UTC — with hours 0–7
covering it past midnight. The saving is now live rather than projected.

**Provisioning cost two redeploys and three wrong diagnoses, all from ONE missing variable:
`QSTASH_URL`.** The operator token is regional (`qstash-us-east-1.upstash.io`); production fell back
to the canonical host and every call 401'd. It is indistinguishable from a bad token, and the operator
CLI keeps working the whole time because it reads the variable from `.env.local`. **"The CLI works but
the deployed route does not" means COMPARE THE TWO ENVIRONMENTS FIRST** — I proposed quote-stripping,
base64 padding and a sensitive-variable hypothesis before doing that, and the environment diff found
it in one command. Written into `docs/deployment-runbook.md` §8n so the next person does not repeat it.

**FOLLOW-UP, observed on the first live render 2026-09-07 ~19:51 UTC — two planner-owned rows that
should agree, disagree. Probably CORRECT; verify before changing anything.**

System Health showed `Live scores` as **On time** (green) and `Game stats` as **Nothing due** (gray)
at the same instant, with identical slow crons. Measured inputs at 19:57:

| | live-scores | game-stats |
| --- | --- | --- |
| last receipt | 19:39:00 | 19:30:03 |
| dense cron (in force from 19:39:13) | `*/3 0,…,7,23` | `*/15 0,…,7,23` |
| slow cron | `1 8,…,22` | `1 8,…,22` — **identical** |
| dense `previousCron` | `*/3 * * * *` | `*/15 * * * *` |
| runs in series / dropped | 3 / 0 | 3 / 0 |

**MEASURED through the real reader at 20:02, with the store injected over the read-only rail** — not
inferred from the screenshot. Per-schedule detail:

| job | dense cron JUDGED AGAINST | grace | dense required slot | state |
| --- | --- | --- | --- | --- |
| `live-scores` | **`*/3 * * * *`** — the expression REPLACED at 19:39:13 | 6 min | `19:39:00` | `on-time` |
| `game-stats` | **`*/15 0,…,7,23`** — the current expression | 30 min | `null` | `unavailable` |

Both slow schedules contribute `null`; both `planUnavailableReason` are `null`, so this is the
nothing-due path and not a plan fault.

**The two jobs are being judged against DIFFERENT CRON GENERATIONS at the same instant.** That is the
finding, and it is sharper than "the rows disagree". `live-scores`'s shorter grace puts its cutoff at
19:56, finds no armed hour under the narrowed expression, and walks back across the 19:39:13 boundary
into the pre-cutover span — so it is judged against a cron that no longer exists. `game-stats`'s
30-minute grace lands elsewhere and yields nothing due.

Judging a slot against the cron in force WHEN IT FELL DUE is slice 3b's whole design and is correct.
What needs deciding is whether two schedules of the same job family should be able to sit in different
generations simultaneously, and whether a walk-back should be allowed to cross a cutover boundary at
all when the current expression arms no hour.

**RESOLVED 2026-09-07 — NOT A DEFECT. The prediction was right in mechanism and wrong on timing.**

The 21:42 check read `NO CONVERGENCE`, but it fired ~20 minutes early. Simulated forward through the
real reader with the store injected:

| time | `live-scores` | required slot |
| --- | --- | --- |
| 21:42 | on-time | 19:39 — the stale slot |
| 22:05 | on-time | **20:01** — advanced |
| 23:05 | on-time | 21:01 |

**The stale dense slot self-clears when the SLOW schedule's advancing slot OVERTAKES it** — at
`19:39 + 120 min` of grace ≈ **22:01**. The right formulation was never "2 hours after the cutover",
it was "2 hours after the first slow slot following the cutover".

**Detection is intact, which was the real question.** With `live-scores` frozen at 21:01 to simulate
the job dying, the row reads **`late` by 23:35** — 2.5 h, the correct grace for an hourly schedule. A
permanently frozen required slot would have meant a dead job reading healthy indefinitely. It does
not happen.

**And the trigger is far narrower than this entry first claimed.** It needs a dense schedule
**narrowed but NOT paused** to hours excluding the current one, applied **during** an unarmed hour —
which is the manual mid-afternoon trigger, not the nightly cutover. At 23:50 on a game day the new
dense expression arms hour 23 immediately; on a dead day dense is **paused**, and a paused schedule
contributes no required slot at all. **So it does not recur nightly, and the "recurs at 23:50 every
night" claim below is withdrawn.**

**SECOND FOLLOW-UP, same row — the cadence label reads as its wrong half. Owner misread it in
production 2026-09-07, which is the evidence.**

`cadenceLabel` now renders the day's real shape, which is the improvement slice 4 shipped and it is
working: _"every 3 min at 00:00–07:00, 23:00 UTC, hourly (:01) at 08:00–22:00 UTC"_. Two clauses, one
per phase, accurate and complete.

**But it states the whole day and leaves the reader to work out which half is live.** At 20:0x the
governing clause is the second one; the owner read the first and asked why it said every 3 minutes.
The person who commissioned the label misread it on first pass — that is as strong as UI evidence
gets, and it is not a comprehension failure, it is a label that puts a non-applicable clause first.

**It compounds the required-slot issue directly above it**, and that is why these are one item.
Read as "every 3 min", the row shows a job that fires every three minutes, was last required at
19:39, and last ran at 20:01 — three numbers that cannot be reconciled under that reading. Each
defect alone is survivable; together they make a healthy row unreadable.

**Candidate fix, small:** lead with the clause in force and demote the rest — _"hourly (:01) — dense
00:00–07:00, 23:00"_ — or mark the active phase. The planner already computes everything needed;
this is a change to how one string is ordered, not to what it knows. **Decide it with the
required-slot question, not separately** — the row is either readable or it is not.

**What survives, and it is small.** For a few hours after a mid-window narrowing, one planner-owned
row can read `on-time` against a slot from a replaced cron while its twin reads `Nothing due`. No
fixture spans a cron change with two different step sizes, so tests cannot see it. Neither state
raises an issue and neither is wrong about its own job. **Worth a regression test more than a fix** —
the behaviour is correct and undocumented, which is how it gets "fixed" into a defect later.

**Slice 4 — activation.** Small, because everything it needs is already built and tested by then.

**The two blocking specification items are RESOLVED — owner decisions 2026-09-07. Both made slice 4
smaller.**

- **A dead day PAUSES the schedule; it does not emit a keep-alive cron.** We had reasoned that a
  zero-window day still needs some expression because "no cron can mean never". True of cron syntax —
  but **QStash supports pausing**, and the CLI already carries `pause` / `resume` actions
  (`qstashSchedule.ts:85`, `buildPauseRequest` `:222`). So "never" IS expressible; we were not using
  the mechanism that expresses it. The rule: **games today** → dense over the game hours, slow over
  the tail; **no games but yesterday's tail still open** → slow only, dense paused; **nothing at all**
  (mid-week, offseason) → both paused.
  **Pause, never delete.** Deleting makes the schedule vanish and reappear daily as a new one, which
  undermines what slices 3a and 3b were built to protect.
  **Validated against Upstash's documentation 2026-09-07** — the decision had been made from our own
  code, which showed what we SEND, not what QStash does with it. `POST /v2/schedules/{id}/pause` and
  `/resume` exist; a paused schedule "remains in the system and stays retrievable"; pausing an
  already-paused schedule "has no effect", so a daily re-pause is idempotent. **And `GET
/v2/schedules/{id}` returns an `isPaused` boolean**, which is MORE than the decision assumed —
  `inspect` can compare pause state as a fact rather than merely confirming the schedule exists.
  Slice 4 must wire `isPaused` into `evaluateScheduleContract`, or a schedule that should be paused
  but is running is indistinguishable from one correctly armed. Also validated: the create endpoint
  is an upsert — "if a schedule with the provided ID exists, the settings of the existing schedule
  will be updated with the new settings" — which is what makes a retry after an indeterminate outcome
  safe. **No scoped QStash management token is documented**; the full-privilege token stands, on the
  rationale already recorded above.
  **This dissolves the `dense: null` blocker.** The planner no longer needs to express "deliberately
  off" — _paused_ is the state, visible in QStash rather than inferred from a missing field.
- **Nothing due must not read as a FAULT.** If nothing is due, the job is doing exactly what it was
  told, and that is the healthy state.
  **Verified against `main` 2026-09-07: the state layer is already correct and slice 4 must not redo
  it.** Slice 3b's reasoning stands — nothing-due must NOT be `on-time`, because `on-time` asserts a
  timeliness nothing measured (`schedulerDeliveryHealth.ts:1353-1370`). It resolves to `unavailable`,
  while `missing` still covers "no receipt at all", so the distinction between "nothing due yet" and
  "no evidence this job ever ran" already exists.
  **What is left is the colour and the word.** `deliveryRowStatus` maps every non-`on-time` state to
  yellow and `deliveryStateDisplay` labels `unavailable` as "Unavailable", so a healthy idle job
  renders a yellow row saying it is broken.
  **The discriminator is the RECEIPT, not the reason — corrected 2026-09-07.** An earlier version of
  this bullet said `planUnavailableReason === null` identifies nothing-due. It does not: `:1326`
  (the receipt-scope read failed) also returns `unavailable` with a possibly-null reason, and that is
  a real outage. Nothing-due is uniquely **`reason === null && receipt !== null`** — it reaches
  `:1370` through `entriesByJob.has(job)` so it always carries a parsed receipt, and the scope failure
  never does. `deliveryStateDisplay`'s tone is ALREADY `muted`; only its label and
  `deliveryRowStatus`'s colour are wrong.
  `PanelStatus` already has `gray`, which may serve better than green — the ruling was that a healthy
  idle job must not read as a fault, not that it must match a measured on-time delivery. **Both
  functions are among the four `SchedulerDeliveryState` consumers; widening their signatures is the
  reportable part.** No sixth state member.

- `QSTASH_TOKEN` into the Vercel environment. **Check first whether QStash offers a scoped management
  token** limited to the two schedules the planner touches; if it does, use it. **Update all SEVEN
  statements in the same PR** — `docs/deployment-runbook.md:89` plus **six** `manage-*-schedule.ts`
  headers (`odds`, `rankings`, `schedule-refresh`, `live-scores`, `game-stats`, `usage-sample`;
  `team-records` carries none) — or the repo lies about its own security posture. Counted 2026-09-07;
  an earlier note said five and four. Collision 3.
- The daily cron that derives → synthesizes → records → upserts, and the cutover of `live-scores` and
  `game-stats` to planner-owned crons.
- **`upsert` still answers to the FIXED contract while `inspect` answers to the record** — slice 3a
  deliberately left it there, because choosing `upsert`'s authority IS the planner-ownership decision.
  Once a reader is wired, a planner-owned schedule that goes absent makes `inspect` print "not
  provisioned. Run `upsert --apply` first", which provisions the fixed cron that the next `inspect`
  then refuses. Resolve it here, not before.
- **Existing handler guards stay.** They are the defence against kickoff changes, postponements,
  stale QStash state, and planner mistakes. The planner reduces wakeups; it must never become the
  only correctness or quota protection.

**TWO BLOCKING SPECIFICATION ITEMS — BOTH RESOLVED 2026-09-07 by the owner decisions recorded in the
slice-4 entry above. Nothing here blocks slice 4 any more; the two items are retained for their
analysis, which slice 4 still needs.** They were correctly classified as blockers rather than ordinary
follow-ups: both are invisible today and arrive the moment the planner writes its first record, since
nothing-due and dense-less days are unreachable while every row falls back to a fixed contract that
always has something due.

1. **`dense: null` — RESOLVED 2026-09-07 by the pause decision recorded in the slice-4 entry above.
   This item is closed; it is retained for the argument in its last sentence, which is now the case
   FOR pausing.** Carried from slice 3a, it asked slice 4 to decide between "no dense phase today" and
   "deliberately off". Pausing dissolves the question — the planner never expresses "off", QStash
   holds it. **What the ambiguity cost delivery health, and what pausing buys:** a stale dense
   schedule left installed on a dense-less day **is still firing, and its failure is invisible until
   the next day with a dense phase**. Pausing is what keeps a dead schedule's silence meaningful.
2. **A yellow row with an empty issues list — filed 2026-09-07 from slice 3b's final review.**
   `deliveryRowStatus` maps every non-`on-time` state to yellow, and slice 3b deliberately raises NO
   issue for "nothing is due yet" because nothing is wrong. So the row renders a yellow dot while the
   page's overall state reads healthy and the issues list is empty. It arrives on cutover morning, on
   the idle-slot shape `slowHoursFor` emits routinely — **a dashboard going yellow across rows that
   are behaving perfectly. A dashboard that renders yellow for routine states teaches operators to
   ignore yellow, which is worse than the false `late` this whole item exists to prevent.**
   `PanelStatus` already has `gray`; reaching it means `deliveryRowStatus` seeing more than the state,
   a signature change to one of the four consumers Item 102 has twice designed around. That is the
   decision, and it belongs with the slice that makes the state reachable.

**Slice 3b follow-ups, filed 2026-09-07 — ordinary, not blocking.** Two reviewers converged
independently on four of these, which is why they are recorded as correctly classified rather than
waved off:

- **Mixed per-schedule reasons collapse to the first.** `schedulerDeliveryIssues` names every faulted
  schedule but takes one reason, so a dense `plan-indeterminate` beside a slow `plan-unreadable` tells
  the operator both have the same cause — losing exactly the distinction `PLAN_UNAVAILABLE_EXPLANATION`
  exists to preserve (planner vs database).
- **The all-unavailable global short-circuit drops per-schedule plan faults.** When the receipt scope
  read fails, every row is `unavailable` and the function returns before the per-schedule scan, so a
  simultaneously corrupt planner record produces no issue at all.
- **A STALLED planner read stalls the whole snapshot.** A promise that never settles blocks the
  enclosing `Promise.all`; System Health's 8 s timeout then replaces all nine rows. It is the same
  failure mode the receipt scope read already carried through the same pool, but **the amplification
  is real and must not be inherited as unchanged: there was ONE durable read on this path, there are
  now THREE.**
- **A dropped NEWEST planner run reads as no run at all.** The tolerant parser drops a malformed row
  and leaves `droppedRuns` nonzero; the timeline then treats the prior cron as current. Slice 3b
  argued a dropped row surfaces as a `previousCron` contradiction — **that holds only for a drop
  BETWEEN two retained runs.** A dropped newest run has nothing following it to contradict it, so the
  argument has a hole exactly there. Recorded because the reasoning, not just the defect, was wrong.
- **The record read filters future-skewed rows against `Date.now()`**, not the snapshot's pinned
  clock, contradicting `readSchedulerDeliveryHealth`'s "ONE clock captured for the whole snapshot".
  Harmless in production; it means a caller pinning `nowMs` gets a record filtered against a different
  instant than every slot is judged against. **This one is in slice 3a's store**, which 3b may not
  change.
- **`hourly (:01) at 00:00, 12:00 UTC` overstates a twice-daily schedule** — the same overstatement
  the single-hour branch was added to remove, one shape over. Not emitted by `synthesizePollingCrons`.
- **Slice 2's `plan` parameter on `schedulerDeliveryPolicy` is now dead.** It was the seam slice 3 was
  expected to wire; 3b wired the RECORD instead, so it is the predictive path with no production
  caller. Removing it churns slice 2's tests, so it is a slice-4 cleanup.

**Ordering is load-bearing, not preference.** Slice 3 before slice 4, because slice 4 destroys the
property slice 3 replaces. Slice 2's collision-2 fix before any narrowing, or the two rows that matter
most on a game day read `late` forever. Slice 2 and slice 3 both ship dormant and are therefore safe
to merge in either order relative to each other — but neither may be skipped to reach slice 4.

**Out of scope for all three: the faster in-window cadence.** It spends provider quota that dead days
were never spending, and it is **Item 95 portion 2**, gated on Item 94. Do not fold it in.

**Blocker:** none technical. Until it ships the schedules are managed by hand per game window, which
is what makes the `kickoff + 24h` reconciliation deadline an operational hazard — see the campaign
doc's operator notes.

**Supersedes the manual half of Item 96.** A working planner pauses through the offseason on its own.

- Backlog slug: `PLATFORM-POLLING-WINDOW-PLANNER-v1`

### Item 101 — Recent finals can empty out at season boundaries

**MIGRATED to [#674](https://github.com/znpruitt/cfb-app/issues/674) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 100b — internal opening-slate marker for recap and look-ahead

PLATFORM-120 deleted the member-visible week-0 derivation; this future marker must not restore it.
Provider week 1 remains the rendered label, while the marker supplies only internal grouping.

**DATE GATE REMOVED 2026-09-03 — this has a live 2026 consequence.** The earlier text read "the 2026
opener is in the past, so nothing consumes this until then." That was wrong, and the defect is
visible in production today: **Featured games renders nothing from 2026-08-27 through 2026-09-07.**

Measured from the production replica: provider week 1 spans **2026-08-27 to 2026-09-07 with 455
games**, against ~3 days and ~300 games for every other week (week 2: 09-10 to 09-13). Because that
one bucket holds finished and upcoming games at the same time for twelve days,
`deriveActiveSlateStatus` (`overview.ts`) reports `hasUpcoming: true` throughout, so
`includeFinalWeekGames` is false, so `keyMatchups` filters through `isKeyMatchupState` — which admits
only `inprogress`/`scheduled`/`unknown` and **excludes finals**. `resultCandidates` needs
`hasUsableFinalScore`, gets nothing, and Featured is empty; `OverviewPanel.tsx:1644` then suppresses
the section entirely. (The emptiness also proves standings coverage is `complete`; otherwise
`includeFinalWeekGames` would be true and the finals would render.)

The internal slate marker fixes exactly this: week 0 becomes its own cluster — all final, nothing
upcoming — and Featured populates from it, which is the Week 0 recap card this marker was designed
for. Not a 2027 nicety.

`canonicalWeek` was doing double duty as the member-facing label and the internal grouping.
PLATFORM-120 settled the label; this adds the grouping back where it belongs:

- **week** stays provider-authoritative — both slates are W1, matching every other source;
- **slate** becomes an internal date-cluster marker for recap/preview targeting, never rendered as a
  week tab.

Recap generation is server-side (`loadInsights.ts`, `selectors/insights.ts`), so slate identification
happens where the full row set exists and the client never needs it.

**The clustering implementation this rule needs was DELETED by PLATFORM-120** — `buildRegularSeasonDateClusters`,
`buildRegularSeasonDateBuckets`, `normalizeRegularSeasonDateKey`, `diffDays`, and
`REGULAR_SEASON_CLUSTER_GAP_DAYS = 3` all went with PLATFORM-120, correctly (nothing else consumed
them).
Recover them from `d6184c28:src/lib/regularSeasonWeekCalendar.ts` rather than rewriting ~100 lines
from the rule statement below; that code already implements this exact 3-day-gap clustering.

**A validated splitting rule** — trust the provider from week 2 onward and only disambiguate week 1:

    providerWeek >= 2  -> trust CFBD
    providerWeek == 1  -> cluster FBS week-1 rows by date, split at the FIRST gap >= 3 days;
                          first cluster = opening slate

Validated across all seven seasons. Two findings from that validation: **"largest gap" is the wrong
splitter** (2025 has four games dated 2025-12-13 carrying provider week 1, making the largest gap 102
days), and **FBS-relevant rows are required** — with all divisions, 2026's lower-division games fill
Aug 27-31 continuously and no gap appears until Sept 3. The durable schedule intentionally remains
complete after PLATFORM-120, so Item 100b must apply the shared relevance predicate at consumption
rather than assume storage was filtered.

- Backlog slug: `PLATFORM-WEEK-ZERO-MODEL-v1`

### Item 98 — league page content paint: three measured costs

**MIGRATED to [#613](https://github.com/znpruitt/cfb-app/issues/613) on 2026-09-10, labelled `needs-triage`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.**

### Item 51 — manual assignment is offered but has no completion writer

**MIGRATED to [#600](https://github.com/znpruitt/cfb-app/issues/600) on 2026-09-10, labelled `needs-decision`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.** Triage record:
[`docs/archive/audits/queue-triage-2026-09-10.md`](archive/audits/queue-triage-2026-09-10.md).

### Item 23 — assignment-method and draft-recovery states

**MIGRATED to [#634](https://github.com/znpruitt/cfb-app/issues/634) on 2026-09-10, labelled `needs-triage`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 28 — remaining demo dry-run findings

**MIGRATED to [#597](https://github.com/znpruitt/cfb-app/issues/597) on 2026-09-10, labelled `needs-triage`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.** Triage record:
[`docs/archive/audits/queue-triage-2026-09-10.md`](archive/audits/queue-triage-2026-09-10.md).

### Item 39 — draft-board walkthrough follow-ups

**MIGRATED to [#646](https://github.com/znpruitt/cfb-app/issues/646) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 45 — PLATFORM-092 setup residue

**MIGRATED to [#599](https://github.com/znpruitt/cfb-app/issues/599) on 2026-09-10, labelled `actionable`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.** Triage record:
[`docs/archive/audits/queue-triage-2026-09-10.md`](archive/audits/queue-triage-2026-09-10.md).

### Item 37 — `NoClaim` can count toward confirmation eligibility

**MIGRATED to [#598](https://github.com/znpruitt/cfb-app/issues/598) on 2026-09-10, labelled `actionable`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.** Triage record:
[`docs/archive/audits/queue-triage-2026-09-10.md`](archive/audits/queue-triage-2026-09-10.md).

### Item 17 — mid-season owner replacement does not update membership

**MIGRATED to [#633](https://github.com/znpruitt/cfb-app/issues/633) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 25 — roster membership authority after publication is parked

**MIGRATED to [#605](https://github.com/znpruitt/cfb-app/issues/605) on 2026-09-10, labelled `needs-decision`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.**

### Item 65 — multi-writer draft gate

**MIGRATED to [#610](https://github.com/znpruitt/cfb-app/issues/610) on 2026-09-10, labelled `needs-decision`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.**

### Item 15 — double-submitted pick can be credited to the next owner

**MIGRATED to [#624](https://github.com/znpruitt/cfb-app/issues/624) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 14 — duplicate auto-pick attempts paint spurious refusals

**MIGRATED to [#623](https://github.com/znpruitt/cfb-app/issues/623) on 2026-09-10, labelled `needs-triage`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 13 — undo uses a reusable slot number and deletion bypasses serialization

**SUPERSEDED — closed 2026-09-10 by triage, not migrated.** Both halves shipped:
`unpick/route.ts:63-67` now REQUIRES `expectedPickNumber`, which is the expected-value precondition
this item asked for; and `reset/route.ts:46` runs inside `withAppStateKeyTransaction` ("PLATFORM-102
round 3 — Reset reads and writes inside one key transaction"), which is the serialization it asked
for. **The first item of 20 triaged to come back superseded.** Recorded as prerequisite 3 of 6 in
[#610](https://github.com/znpruitt/cfb-app/issues/610), struck through there.

### Item 12 — remaining draft-writer serialization

**MIGRATED to [#596](https://github.com/znpruitt/cfb-app/issues/596) on 2026-09-10, labelled `actionable`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.** Triage record:
[`docs/archive/audits/queue-triage-2026-09-10.md`](archive/audits/queue-triage-2026-09-10.md).

### Item 19 — alias/store failure preempts a clean pick refusal

**MIGRATED to [#595](https://github.com/znpruitt/cfb-app/issues/595) on 2026-09-10, labelled `actionable`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.** Triage record:
[`docs/archive/audits/queue-triage-2026-09-10.md`](archive/audits/queue-triage-2026-09-10.md).

### Item 20 — database waits are unbounded

**MIGRATED to [#625](https://github.com/znpruitt/cfb-app/issues/625) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 46 — deletion/adoption policy must precede external commissioners

**MIGRATED to [#626](https://github.com/znpruitt/cfb-app/issues/626) on 2026-09-10, labelled `needs-decision`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 47 — public `bypassSuppression` is an invariant and cost bypass

**MIGRATED to [#627](https://github.com/znpruitt/cfb-app/issues/627) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Items 16, 18, and 53 — converge operating year and described-data year

**MIGRATED to [#643](https://github.com/znpruitt/cfb-app/issues/643) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 30 — insight rotation and the NEW tag are trigger-gated

**MIGRATED to [#628](https://github.com/znpruitt/cfb-app/issues/628) on 2026-09-10, labelled `parked`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Items 31–33 — finish preseason gates and superlative population conversion

**MIGRATED to [#644](https://github.com/znpruitt/cfb-app/issues/644) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 34 — remaining roster×schedule insight ideas

**MIGRATED to [#635](https://github.com/znpruitt/cfb-app/issues/635) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 35 — career and historical copy needs explicit time framing

**MIGRATED to [#645](https://github.com/znpruitt/cfb-app/issues/645) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 36 — participation claims remain ungated

**MIGRATED to [#606](https://github.com/znpruitt/cfb-app/issues/606) on 2026-09-10, labelled `needs-triage`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.**

### Item 38 — retire `partial-roster` and restore selector ownership

**MIGRATED to [#636](https://github.com/znpruitt/cfb-app/issues/636) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 42 — INSIGHTS-026 notable results, stored event source, and Forward Look (In progress)

**MIGRATED to [#637](https://github.com/znpruitt/cfb-app/issues/637) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 43 — new preseason generators

**MIGRATED to [#607](https://github.com/znpruitt/cfb-app/issues/607) on 2026-09-10, labelled `actionable`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.**

### Item 54 — season-recap residue

**MIGRATED to [#647](https://github.com/znpruitt/cfb-app/issues/647) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 62 — INSIGHTS-033 is parked, not converged

**MIGRATED to [#640](https://github.com/znpruitt/cfb-app/issues/640) on 2026-09-10, labelled `needs-decision`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 77 — CFBD advanced analytics is an in-season discovery trial

**MIGRATED to [#651](https://github.com/znpruitt/cfb-app/issues/651) on 2026-09-10, labelled `parked`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Insights sequencing note (former item 44)

The current coarse order is: finish truth/gating and decide the INSIGHTS-033 rebuild; then build the
INSIGHTS-026 pulse with INSIGHTS-020 as one event source; then consider new preseason generators,
ranker/decay, History Phase 3, and Slow Draft Mode. Commissioner onboarding remains conditional on
the multi-tenant gates above.

## Polish, engineering-health, and conditional observations

### Item 48 — test-infrastructure follow-ups

**MIGRATED to [#638](https://github.com/znpruitt/cfb-app/issues/638) on 2026-09-10, labelled `parked`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 49 — preseason-banner observation points

**MIGRATED to [#629](https://github.com/znpruitt/cfb-app/issues/629) on 2026-09-10, labelled `parked`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 50 — passive schedule-presentation checkpoint

**MIGRATED to [#608](https://github.com/znpruitt/cfb-app/issues/608) on 2026-09-10, labelled `parked`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.**

### Item 56 — POLISH-005 residue

**MIGRATED to [#648](https://github.com/znpruitt/cfb-app/issues/648) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 59 — second preview branch behavior is unknown and conditional

**CLOSED 2026-09-10 — owner decision: a second preview branch is not wanted.**
[#609](https://github.com/znpruitt/cfb-app/issues/609) carries the reasoning and what was discarded.
**Why the historical `preview-codex` push produced no deployment is now permanently unknown**, which is
acceptable because the alias/project-setting concern does not arise with a single preview branch. **If
the one-lane-at-a-time hand-off ever becomes friction, file a NEW issue** — the constraint will have
changed and this investigation would not apply.

### Item 71 — JSDOM-heavy test startup and timeout headroom

**MIGRATED to [#602](https://github.com/znpruitt/cfb-app/issues/602) on 2026-09-10, labelled `needs-triage`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.** Triage record:
[`docs/archive/audits/queue-triage-2026-09-10.md`](archive/audits/queue-triage-2026-09-10.md).

### Item 73 — archived season-arc axis domain

**MIGRATED to [#641](https://github.com/znpruitt/cfb-app/issues/641) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 78 — post-transition standings copy for an undrafted league

**MIGRATED to [#631](https://github.com/znpruitt/cfb-app/issues/631) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 80 — Next 16 upgrade is offseason-gated

**MIGRATED to [#652](https://github.com/znpruitt/cfb-app/issues/652) on 2026-09-10, labelled `parked`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 83 — team-identity normalization collides distinct schools onto one key

**MIGRATED to [#653](https://github.com/znpruitt/cfb-app/issues/653) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 84 — an overriding provider classification records no diagnostic

**MIGRATED to [#642](https://github.com/znpruitt/cfb-app/issues/642) on 2026-09-10, labelled `needs-triage`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 85 — repair archived seasons polluted by the identity collision

**MIGRATED to [#654](https://github.com/znpruitt/cfb-app/issues/654) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 86 — the archive audit's integrity check can never pass

**MIGRATED to [#612](https://github.com/znpruitt/cfb-app/issues/612) on 2026-09-10, labelled `actionable`.**
The issue carries the ask, the triage verdict and its evidence. **This entry is a pointer — do not
restate the item here, or the two copies will drift.**

### Item 87 — rework Overview game listings as a scoreboard

Presentation and information-architecture half of the Overview games region. POLISH-015 delivered
the interim correctness and empty-copy fixes on this surface. POLISH-016 / slice 1 then shipped the
shared scoreboard contract and converted the Live section; POLISH-017 / slice 2 converted Featured
and settled green-live on Overview; POLISH-019 / slice 3 added Recent finals and structural
promotion. **POLISH-020 / slice 4 converted the Watchlist**, merged 2026-09-03 via PR #558
(`c730b4d0`). **PLATFORM-087 / slice 5a widened the shared component**, merged via PR #570
(`4caa1a79`) on 2026-09-05. **Slice 5 + Item 112 converted Schedule and added its tier-2
disclosure**, merged the same day via PR #572 (`f424222a`). Matchups remains Item 117, not a slice.

**Slice 5a carry-forward for the five consumers — do not re-derive.** `CompactGameScoreboard` now
owns the settled rank/FCS prefix, neutral-site and broadcast metadata, and optional tier-2 slot; the
full visual contract is in `DESIGN.md` → Cards and game results. Overview retains three writers: one
`contextSlot` is an unconditional wrapper that deliberately reserves 22px even when empty; the other
is `gameBadge ? <span /> : undefined`; and `footerSlot` is `string | null`, rendered directly without
the optional-content predicate. Schedule now supplies `tier2Slot` from `GameWeekPanel`.
Renderable-content inspection recurses only through static arrays and fragments — evaluating
arbitrary components would be unsafe and hook-incompatible. Tier-2 reserves no height: it is
variable expansion content, while the unconditional odds band aligns tier-1. Provider
classifications are absent from 2018–2024, so the FCS marker is expected to remain inert on those
historical seasons.

**Problem observed on `/league/tsc` during the 2026 opening slate (2026-08-29).** One game appeared
twice on a single screen — in "Upcoming watchlist" and again in the "Live" tile — and the Live card
printed its own matchup name twice. Four cards filled the viewport, most of the vertical space going
to chrome: three of four carried a `Top matchup` chip, ranks were rendered inline AND as a chip AND
as a section eyebrow, and scheduled rows ended in an empty `———` box.

Remaining root cause:

- The same conceptual object still has multiple renderers. Slices 1–4 moved Overview Live,
  Featured, Recent finals, and Watchlist onto the shared scoreboard anatomy, and slice 5 moved
  Schedule. `GameSummaryList` remains bespoke on Matchups and the recap primitives; Matchups is Item 117.

**Settled decisions (owner, 2026-08-29).** The governing criterion for any marker is that it be
TRUE and VALUABLE to the reader; scarcity is not the test, and chips are not capped. See `DESIGN.md`
→ Cards and game results for the rules these produced.

- One chronological scoreboard list. Live and scheduled are the same row type distinguished by status
  chip, so the duplication has nothing to filter — it cannot occur. This supersedes POLISH-015's
  interim state-specific ordering and exclusion rules.
- Right-edge anchor is the score, or the kickoff time when there is no score. The `———` placeholder
  violates the trailing-whitespace rule and carries no information.
- Rows expand in place; tapping discloses rather than navigating. **Delivered on Schedule by Item
  112 / PR #572**, through `GameWeekPanel`; `CompactGameScoreboard` and Overview remain
  non-interactive.
- Chips get category names ("Top 25 Matchup"), which also resolves the overload below.

**RESOLVED by slice 4.** The `Top matchup` label was false — `gameTags.ts:441` fired the chip from
`isTopOwnerGame`, true when EITHER participant's owner is in the top three (meaning "a contender is
playing," not matchup quality), while `deriveOverviewHighlightSignals` picked a DIFFERENT game per
slate by a composite score and rendered the same words as an eyebrow. The two disagreed in production.
Slice 4 renamed both to what each measures — the chip is now `Contender Watch`, the eyebrow is now
`Game of the Week` — in the shared `gameTags.ts`/`overview.ts`, so this applies everywhere the chip
renders, not just Overview.

Schedule now supplies venue, odds, and conference through the shared tier-2 slot. It deliberately
omits records pending Item 139's completed-game reconciliation; `CompactGameScoreboard` remains a
pure row and Overview's records feed is unchanged.

Acceptance boundary:

- No game appears in more than one place on Overview, enforced structurally rather than by a filter.
- Every chip rendered is true by its own definition.
- Opening a Schedule row shows its tier-2 detail — delivered by Item 112 / PR #572.
- No scheduled row terminates in an empty value.
- Ranked information appears once as inline detail and once as a scannable category chip — not three
  times.

### Item 88 — SUPERSEDED by Item 132

**SUPERSEDED IN FULL 2026-09-05.** Both attempts — a freshness model and a display-only fix — were
built, reviewed, and reverted. Neither merged; nothing reached production. The evidence and the
pitfalls each one found are in
[`docs/campaigns/item-132-partition-scoped-health.md`](campaigns/item-132-partition-scoped-health.md).
**Item 132 supersedes the acceptance bullets below**, which are retained only as the original
diagnosis.

### Item 88 — Provider data health cannot describe a schedule-armed dataset

Observed on `/admin/diagnostics` during the 2026 opening slate (2026-08-29), with live scoring
working correctly at the time.

**The issue is a model mismatch, not a wiring bug.** Provider data asks _how long since this dataset
last refreshed_; Scheduler delivery asks _did the refresh that was expected actually happen_. For a
fixed-cadence dataset those questions coincide, which is why schedule, rankings, and conferences read
correctly. Scores is schedule-armed — refreshed per week partition, only while games sit in the
kickoff window, and legitimately not refreshed for days outside one — so elapsed time carries no
information about it and the first question has no meaningful answer.

Both observable symptoms are consequences of that one mismatch:

- Canonical status `scores:year:2026` has `lastAttemptAt: null` in production while every other active
  dataset is populated. Nothing writes it, because scores never refreshes "the year";
  `/api/cron/live-scores` records `weekPartitionScope(year, week, seasonType)`. Schedule appears
  healthy only because `fullSeasonScheduleRefresh` happens to write a year scope as well.
- `staleAfterMs` for scores is 48 hours, so the freshness dot reads `Current` for a scores cache two
  days old. No fixed threshold can be right here: a two-day gap is correct in the offseason and
  catastrophic mid-slate.

**Severity corrected 2026-08-29 by live observation, having first been overstated here.** A real
CFBD degradation later the same afternoon failed both live-scores and game-stats, and the platform
DID surface it: Prioritized issues raised `JOB - LIVE-SCORES`, `JOB - GAME-STATS`, and
`DATASET - SCORES  Scores refresh failed`. The week-partition failure write feeds the dataset-level
warning, so a scores outage is not invisible. What remains true is narrower: the Provider data ROW
SUMMARY still reads `Current` with `No refresh history` while that warning is active, so the row
contradicts the issue list directly above it. This is a legibility defect in one column, not a
detection gap.

**Confirmed on SUCCESS and confirmed to generalize (2026-08-29 19:19Z).** After recovery, with every
job green and no issues reported, both week-partition writers still read `No refresh history` in the
row summary: `scores:year:2026` and `game-stats:year:2026` each have `lastAttemptAt: null` while
game-stats had succeeded three minutes earlier and its cache state had moved `absent` to `available`.
`schedule:year:2026` was populated at 19:02. So this is not scores-specific and not failure-specific
— it affects every dataset whose refresh is partition-scoped, and it misreports while things are
working. Fix it for the class, not for scores.

**Do not fix by writing a synthetic year-scope record.** That populates the row while still answering
the wrong question. The health model needs to express EXPECTATION for schedule-armed datasets, which
is what Scheduler delivery already does and what PLATFORM-086B2B established as observation-versus-
snapshot freshness for live scores. Consider whether the fix generalizes: game-stats is also
automation-driven and also reads null.

Acceptance boundary:

- The Scores row distinguishes "no refresh was expected" from "a refresh was expected and did not
  happen"; it never reports healthy in the second case.
- With games in the kickoff window, the row stops reading healthy within one polling window of live
  scoring stopping — proven by suppressing the writer in a test, not by reasoning about thresholds.
- Outside the kickoff window, a multi-day gap does not raise an issue.
- The row never reads healthy while an active issue names that same dataset.

### Item 93 — nine CFBD call sites still carry the pre-PLATFORM-115 timeout

**MIGRATED to [#632](https://github.com/znpruitt/cfb-app/issues/632) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 94 — measure the first full in-season month of CFBD burn (READ 2026-09-30)

**MIGRATED to [#655](https://github.com/znpruitt/cfb-app/issues/655) on 2026-09-10, labelled `parked`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Parked identity and operator concepts

- **Owner identity as an ID, not a display name.** Sequence with user accounts. It is the long-term
  answer to rename/reopen/reset ambiguity across confirmed owners, roster CSV, and draft picks.
- **CFBD team IDs for provider matching.** IDs could improve exact provider joins but cannot replace
  aliases, which still reconcile external names and roster repair input. This remains outside the
  current schedule-first identity scope.
- **Cross-league setup superview.** Define “finished setup” and its audience before building. Global
  schedule/scores belong in a year header, not duplicated per league; current storage cost is roughly
  four app-state reads per league-year.

## Unresolved decisions & known deferrals

This is the canonical deferral register. These items are explicitly not scheduled. Resolved entries
are removed rather than retained with strikethrough; their outcomes live in `docs/completed-work.md`.

- **Team-record reconciliation log volume.** Persistent equal-time score conflicts or participant
  mismatches emit one structured error on every request to each of five dynamic league routes. The
  failure must remain distinguishable from a legitimate empty reconciliation, so any rate limit or
  deduplication needs an observability design that preserves first occurrence, counts suppressed
  repeats, and re-emits when the affected provider-ID set changes.
- **Require `seasonContext` at the Overview boundary.** Its optional fallback is unreached by all
  current league routes and wrong for an abandoned-game final season. Optional defaults also let a
  future route compile while silently rendering a finished season as live. Making the prop required
  closes both paths but requires broad fixture updates.
- **PLATFORM-107 low-severity residue.** Shared `startedAt` values can make mixed provider-health
  ties resolve by scope key; final-candidate extraction runs for callers that do not request a
  sweep; equal-timestamp aggregate/child finals can make difference logs nondeterministic. Score
  truth is unaffected.
- **Expected-absence applicability for scores, odds, and rankings.** A genuinely cold
  deployment can still show neutral absence as degraded health. `game-stats` is the only dataset
  given a `ProviderDataExpectation` (`providerDataDiagnostics.ts:108-137`); every other dataset is
  `expected` by construction, so its absence reads as an actionable gap. Each needs its own
  applicability authority; do not generalize the game-stats slate rule.
- **Team-records provider-refresh faults still route to a non-repairing surface.** Scheduler
  execution faults correctly offer no repair action, but dataset-axis failed/partial/interrupted
  records attempts still inherit the generic `Open Data Maintenance & Recovery` link, and that page
  has no records control. A follow-up should either add a real manual records repair or suppress the
  generic link for this dataset; do not imply the current link can fix it.
- **Malformed `CombinedOdds.favorite` producer field.** Recap copy resolves the favorite from side
  spreads, but existing scoreboard and matchup consumers can still render a contradictory stored
  favorite string. Repair the producer or stop those consumers from trusting the field.
- **Provider diagnostics rebuild the canonical slate on every call.** Correctness is intact, but
  preseason System Health and provider-status reads pay catalog, alias, and schedule construction
  cost. A shared lazy/memoized slate seam is preferable to caller hints or completed-slate gating.
- **Owner identity across seasons.** Renamed and returning owners are raw display strings today.
- **PLATFORM-040 ownership-key normalization.** Schedule only with the broader ownership-authority
  work; do not represent it as historical parity.
- **Canonical `conferenceRecords`.** Decide whether canonical standings should carry it.
- **Postseason `AppGame.status` normalization parity.** Two postseason constructors still collapse a
  known-team game to `matchup_set`; audit all status consumers and converge all constructors without
  weakening placeholder semantics.
- **Historical/archive ownership parity (PLATFORM-039).** Historical selectors still use raw owner
  labels in places where current-season ownership uses the canonical authority.
- **Standings lifecycle labeling.** Broader offseason/year copy audit remains planned.
- **Known CFBD game-stats limitation: 2022 Akron @ Buffalo.** The provider still returns only the
  same defense-only partial payload; automated backfill cannot repair it. The deliberate analytics
  exclusion stands, and no manual-entry feature is planned for this one historical game.
- **Rename `manual-only` / `stats-manual-only`.** These names mean unrepairable historical evidence,
  not manually entered data. Rename when the evidence modules are next touched.
- **Cross-authority indeterminate-commit vocabulary.** Schedule and rankings both report a lost
  write acknowledgment as `durable-commit-failed`, although the write may have applied. If fixed,
  add one uniform indeterminate outcome to both authorities.
- **Synthetic final-poll replacement window.** Postseason week remapping can miss a partial
  replacement when source sets are identical. Detection requires retaining pre-remap week identity.
- **Per-game live-overlay freshness.** Partition/global timestamps can let a fresh sibling mask one
  stale live game. A future fix threads per-game effective timestamps into `selectLiveDelta`.
- **Synthetic-only unusable catalog input.** Direct pure-function tests can construct a nonempty
  unusable catalog that production sanitization reduces to empty. Accepted as test-only robustness.
- **Guarded Server Action refusal UX.** Auth guard throws can replace the admin page with the generic
  error boundary. A consistent typed refusal channel is needed; production redacts thrown messages.
- **Dependency-owned Clerk Server Actions.** Clerk registers four actions outside repository
  ownership. Review through dependency upgrades/upstream analysis; never assert exactly nine server
  references in a build.
- **Validate `setAssignmentMethod` at runtime.** Its TypeScript union disappears at the Server
  Action boundary and an invalid string can disable both assignment paths.
- **Demo standings-cache invalidation gaps.** Preseason re-click, offseason, and reset can retain a
  collided standings key without invalidation. The season re-click also invalidates unnecessarily.
- **Middleware matcher residuals.** Non-GET protected requests receive method-preserving 307
  redirects; the regression test uses an unstable Next helper; and dotted dynamic paths remain
  excluded by a negative static-file heuristic. Prefer a positive `_next`/`public` exclusion model
  in a dedicated routing slice.
- **Season-transition commit/invalidation gap.** A process can commit lifecycle state and die before
  cache invalidation; later transition runs no longer select that league. Other schedule/score
  activity mitigates but does not guarantee recovery.
- **Weekly schedule-refresh `maxDuration`.** The route still relies on the platform default. Add an
  explicit latency envelope when the route is next touched.
- **Unusable persisted lifecycle-year recovery.** Invalid legacy status years fail closed with no
  explicit repair operation. Any repair must require a confirmed replacement year and disclose
  targeting/invalidation consequences.
- **Historical candidate follow-ups.** PLATFORM-045 canonical-loader dedup; PLATFORM-052 live-badge
  staleness; PLATFORM-054/055/056 canonical-layer candidates; broader game-stats copy/presentation;
  legacy game-stats migration; and dead `manualRefresh.ts` branches. Re-verify against current code
  before activation.

## Provisional backlog — server-fetch architecture

- **Manual Odds refresh context.** The authorized Odds refresh still loads internal context through
  HTTP; extract a shared server authority when scheduled.
- **Admin debug context loaders.** Some debug routes collapse non-2xx internal responses into empty
  collections. Preserve typed failure instead. Confirmed concretely during PLATFORM-114:
  `/api/debug/schedule-eligibility` builds its four self-calls inline and forwards no credentials,
  unlike every other debug route, which routes through `loadDebugSeasonContext` /
  `forwardAdminAuthHeaders`. On preview it therefore returns every collection empty — including
  `conferenceRecordsCount: 0` — which is indistinguishable from a genuinely empty season and made the
  route unusable for verifying that slice.
- **Score diagnostics self-call.** The scores debug route intentionally self-calls the authorized
  refresh so a cold cache does not report false zeros. Remove only after extracting a shared score
  refresh authority.

### Item 157 — DONE: two tag vocabularies said the same thing in two voices

**Shipped on `claude/157-162-163-tag-vocabulary` (`a008b39c`, `1f4b83a4`, `ca2a13f9`, `2e9c7468`, `3da3c42e`, `0d741e81` + this closeout), merge pending.** `LEAGUE_TAG_LABELS` renders `Top 25 Matchup` on Schedule and Matchups; the identifier is unchanged. `Ranked Team` retired. **Two things the filing did not have.** The highlight family's `top25` was gated on `rank != null` with NO bound, so the rename put one user-facing label behind two different predicates — both are now `isRankedTop25`, bounded 1–25 at **both** ends, since nothing upstream rejects a rank of 0 and the watchlist now sorts on the average of two ranks. And `Ranked Team` had been doing curation nobody had noticed: it supplied 70 to `watchlistPriority` on every one-ranked game, so retiring it could drop ranked games off the six-card board — restored as the signal `hasTop25RankedTeam` by owner ruling, with no chip. Registry: `PLATFORM-157-162-163-TAG-VOCABULARY-CLAUDE-v2`.

**Found during Item 153**, which converted Overview's chips to bronze and exposed why they were a
different colour: they are a **different tag family**. `gameTags.ts:475` `LEAGUE_TAG_LABELS` produces
`Upset` / `Upset watch` / **`Top 25`** for Schedule and Matchups; `gameTags.ts:430` produces
**`Top 25 Matchup`** / `Ranked Team` / `Close` for Overview. **Two systems, near-identical claims,
different wording.**

**CORRECTED 2026-09-08 — my filing premise was wrong, and the correction makes this a live defect
rather than a tidy-up.** These are not the same claim in two voices. The highlight family
distinguishes **both ranked** (`Top 25 Matchup`) from **one ranked** (`Ranked Team`). The league
family tags only both-ranked — `gameTags.ts:586`, `isRankedTop25(away) && isRankedTop25(home)` — and
**labels it `'Top 25'`**.

**So Schedule and Matchups already ship a lossy label.** `Top 25` reads as a property of the game and
would be understood to fire on #1 Ohio State against an unranked opponent. **Owner ruling 2026-09-08:
`Top 25 Matchup` is correct and must NOT be shortened** — "both ranked" is not derivable at a glance
the way one visible rank is, so _Matchup_ is the word carrying the information. The shortening looks
obviously right until you check, which is why the ruling is recorded rather than assumed.

**The ask:** rename the league label to `Top 25 Matchup`, and **retire `Ranked Team`** — it restates a
rank already visible inline on the row. After both, the two families tag the same condition under the
same label and the question of collapsing them is a refactor, not a user-visible decision.

**Why it matters:** Item 153 unified the chips' APPEARANCE across three surfaces. A reader now sees the
same treatment carrying `Top 25` on one surface and `Top 25 Matchup` on another, which reads as an
inconsistency rather than a distinction. Unifying colour without unifying vocabulary is half the job,
and the colour drift Item 153 fixed grew from exactly this kind of split.

**Blocker:** none. **Not urgent** — the surfaces are individually coherent.

### Item 158 — Overview renders two chip shapes in the same slot

**MIGRATED to [#668](https://github.com/znpruitt/cfb-app/issues/668) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 159 — `tailwind.config.ts` is never loaded, and states the opposite of what ships

**Found 2026-09-08** while confirming whether ~100 `tailwindcss-intellisense` `cssConflict` hints on
`OverviewPanel.tsx` were false positives. They are not — the extension is correct — and the reason is
this file.

Tailwind v4 loads a JS/TS config **only** through an `@config` directive. `globals.css:2` does a plain
`@import 'tailwindcss'` and **no `@config` exists anywhere in the repo** (the single grep hit is inside
a comment). So `tailwind.config.ts` is inert. What actually governs is `globals.css:41`
`@custom-variant dark (&)`, which makes every `dark:` utility match unconditionally — the POLISH-010
dark-only theme.

**The ask:** delete the file, or make it load and tell the truth.

**Why it matters:** the file asserts `darkMode: 'media'`. That is not merely unused, it is **false** —
`dark:` is unconditional, not media-driven. And **six `package.json` scripts lint and prettier-check
it**, so it carries every signal of a maintained, live config. A reader deciding how theming works has
one file that answers plainly and wrongly, and one CSS line 40 lines into a stylesheet that answers
correctly.

**Do NOT strip the base light-palette classes** while resolving this. `globals.css:10-12` retains them
deliberately so reverting that one file restores theme-awareness; they are a preserved palette, not
dead code.

**Blocker:** none. **Small.**

### Item 160 — Overview never received the shared-row decisions

**MIGRATED to [#669](https://github.com/znpruitt/cfb-app/issues/669) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 161 — record the surfaces a shared-row decision governs

**MIGRATED to [#670](https://github.com/znpruitt/cfb-app/issues/670) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 162 — DONE: `Contender Watch` was owner standing rendered as a chip

**Shipped on `claude/157-162-163-tag-vocabulary` (`a008b39c`, `1f4b83a4`, `ca2a13f9`, `2e9c7468`, `3da3c42e`, `0d741e81` + this closeout), merge pending.** Retired, and the whole owner-standing input path went with it — `topOwnerNames` existed only to carry `standingsLeaders.slice(0, 3)` into the tag selector, and `tsc` confirmed it had no other reader. Nothing about who leads the league now reaches `deriveGameHighlightTags`. **The five-of-six observation was never reproduced and did not need to be:** the mechanism is stronger than frequency — at priority 90 the tag was also a watchlist SORT KEY, sorting its own games to the top of a six-card list, so a high count follows from the ordering rather than from a high base rate. `DESIGN.md` → the marker rules now carry the vocabulary as game facts only.

**Found 2026-09-08** in the owner's Week 2 preview walkthrough, while confirming Item 153. **Not part
of Item 160** — that item is placement and layout; this is the tag itself.

**`DESIGN.md:295` already forbids it:** _Owner standing appears inline beside the owner name, never as
a chip — it is true on every row, so as a marker it would carry no signal._ `Contender Watch` is owner
standing as a chip. **Same class as the blue eyebrow Item 153 corrected: a live violation of a rule on
the books, not a preference.**

**The mechanism makes it structurally frequent.** `selectors/overview.ts:496` builds `topOwnerNames`
from `standingsLeaders.slice(0, 3)`, and `gameTags.ts:63` fires the tag when **either** participant is
owned by one of those three. Two participants against three of roughly a dozen owners is a high hit
rate by construction, not by coincidence.

**Observed, one slate, not a measured rate:** five of the six watchlist cards carried it on the Week 2
board — including **Rutgers 0–1 against Boston College 0–1**. After one week, "top three in the
standings" is one game's worth of noise, so the chip asserts a contender race that does not exist yet.

**It also sits in the wrong row.** Its neighbours — `Top 25 Matchup`, `Ranked Team`, `Close` — are
facts about the GAME. This one is a fact about an OWNER, which is the distinction `DESIGN.md:295`
draws.

**The ask:** retire it, or move owner standing inline where the rule puts it. **Retiring is the
smaller change** and is what the rule implies.

**Relationship to the other tag items:** Item 157 renames `Top 25` and retires `Ranked Team`; this
retires a third. Worth doing together — after all three, the vocabulary is game facts only.

**Blocker:** none. Independent of Item 143.

### Item 163 — DONE: the `vs <owner>` pill repeated a name already on the row

**Shipped on `claude/157-162-163-tag-vocabulary` (`a008b39c`, `1f4b83a4`, `ca2a13f9`, `2e9c7468`, `3da3c42e`, `0d741e81` + this closeout), merge pending.** **Owner ruling 2026-09-08: retire the owner branch.** `DESIGN.md`'s permission for a restating chip is about WAYFINDING, and the pill sat in tier 2 **below** both team rows while the scoreboard printed that owner inline on the opponent's row — a marker after the content it restates cannot help a reader find the row. That reasoning is now a `DESIGN.md` rule rather than a one-off. Suppressed at the **render seam**, not in `deriveOpponentDescriptor`: the selector's other consumer groups opponents for a summary that renders no scoreboard, where the owner label is the only thing naming them. All four non-`vs` branches survive — `Self`, placeholder/derived, `FCS`, `NoClaim (FBS)`. The filing named three; `Self` was the missed one.

**Found 2026-09-08**, owner question. **Nothing owned this** — it is not in the queue or any campaign
document, so no filed item was going to drop it.

`selectors/matchups.ts:48` returns `` `vs ${opponentOwner}` `` and `MatchupsWeekPanel.tsx:286` renders
it as a pill in the metadata row. **But the shared scoreboard already renders each team's owner inline
on its own row** (`owner: awayOwner` / `owner: homeOwner`, `MatchupsWeekPanel.tsx:244`/`:254`). So
whenever the opponent has a displayable owner, **that owner's name appears twice on one card** — beside
their team, and again in the pill.

**It reads as a leftover.** Before Matchups adopted the compact scoreboard (PLATFORM-087 slice 5,
`9bd9dc41`), the row did not carry owners and the descriptor was the only place the opponent's owner
appeared. Adopting the scoreboard made it redundant and nothing revisited it — **the same
recorded-and-unapplied shape as Item 160**, one surface further along.

**The ask:** decide whether the pill still earns its place, and drop it if not.

**Why this needs a ruling rather than an automatic retirement.** `DESIGN.md:284` is explicit that _a
chip that restates inline content is legitimate when it lets the reader find the row without reading
it_ — restating is not disqualifying on its own. The question is whether a reader scanning an owner
card benefits from the opponent owner being pill-shaped when it is already two lines down. **The
descriptor also carries the non-owner cases** (`FCS`, `NoClaim (FBS)`, placeholder and derived
participants), which are NOT duplicative and must survive whatever is decided about the owner case.

**Related, and worth ruling together:** this is the third marker found today that restates a visible
fact — `Ranked Team` beside `#25 Missouri` (Item 157), `Contender Watch` as owner standing (Item 162),
and this. **Three instances is a pattern about the tag vocabulary, not three coincidences.**

**Blocker:** none. Independent of Item 143.

**MOCKUP EVIDENCE, 2026-09-08.** `mockups/matchups-schedule-mockup.html` carries **no `vs <owner>`
pill**. The opponent's owner appears inline on the team row — "Georgia Tech BHooper" — which is
precisely what the pill repeats. The mockup is not authoritative on geometry, but it is the record of
what the row was designed to contain, and this element is absent from it.

### Item 164 — the owner tint bleeds 8px into padding the block does not have

**MIGRATED to [#684](https://github.com/znpruitt/cfb-app/issues/684) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 165 — the tag cap: three sources, three answers

**RULED AND DONE 2026-09-08.** The cap is **TWO**, and `DESIGN.md:293` was amended to say so in the
same commit, marked as an amendment and carrying its reason. **The uncapped rule is superseded by the
layout it predates, not wrong on its own terms.** #673 is the separate defect that evades the cap.

### Item 166 — CLOSED, ALREADY SATISFIED. The cap ships, in the selector, with the test

**CLOSED 2026-09-08 without work, and the item existed because I checked the wrong function.**
Everything below is retained as the record of the error.

**What actually ships.** `gameTags.ts:38` — `const TOP_BADGE_LIMIT = 2` — applied at `:457`:
`tags.sort((a, b) => b.priority - a.priority).slice(0, TOP_BADGE_LIMIT)` inside
**`deriveGameHighlightTags`**. The cap is two, it is applied **in the selector**, and it governs the
family `DESIGN.md`'s chip block actually names (_Top 25 Matchup_, _Close_).

**The test exists too, and it is exactly the acceptance criterion I wrote.**
`gameTags.test.ts:941` builds a game with both teams ranked (`top25`), both owners in `topOwners`
(`contenderWatch`) and a three-point final margin (`close`) — **three qualifying tags** — and asserts
exactly two survive in priority order.

**`prioritizeGameTags` needs no cap either.** `LeagueGameTag` has three members and two are mutually
exclusive by construction: `upset` requires `state === 'final'` (`gameTags.ts:597`), `upset_watch`
requires `state !== 'final'` (`:611`). **The maximum reachable is two.** A cap there would be
unreachable code, and the acceptance criterion could never be met with real data — not after the
retirements, but today.

**The error, recorded because it is the campaign's named failure mode.** I grepped
`prioritizeGameTags`, found no cap, and reported to the owner that _the code implements neither_. I
never checked `deriveGameHighlightTags`. **That is the proxy that argues for itself** (`AGENTS.md`):
a coherent model from a partial look, with nothing available to contradict it. The Item 165 ruling
itself stands — `DESIGN.md:293` needed amending, because it contradicted both the campaign document
and the shipped code — but it was a **two-source** conflict, not three, and the code was never the
outlier.

**The cap belongs in the SELECTOR, not the renderer.** A render-time truncation of a list the selector
still builds in full is a different behaviour wearing the same number: consumers disagree about how
many tags exist, `secondary` carries tags nothing will show, and Matchups' `hidden sm:inline-flex`
breakpoint rule begins interacting with a cap it was never designed against.

**SEQUENCE THIS BEFORE ITEMS 157 AND 162 — owner, and the reason is about testability.** Those items
retire `Ranked Team` and `Contender Watch`. **If the cap lands after them, real data may never again
produce three qualifying tags, so the test must construct three artificially.** If it lands first,
three still co-occur naturally and the test can use real data — after which the retirements merely
reduce how often the cap fires, which is the safe direction.

**Acceptance criterion, explicitly: a game carrying THREE qualifying tags.** Not "the cap is applied".
**Same shape as the postseason first-round typing trap** (`reference-game-row.md` §15): a suite built
from the cases that happen to be available passes while the actual case goes untested.

**Blocker:** none. **Small** — a slice in the selector plus that test. **Ordered ahead of 157 and 162.**

### Item 167 — audit Overview's other sections against the row reference

**DONE — the audit ran, and its cost is the number that justified [#670].** It found **EIGHT**
divergences on Overview, every one recorded as a Schedule decision while being a property of the
shared row. Its residue became #671 (tags on Live and Recent finals) and #672 (the same audit on
Matchups and Schedule). **The entry's "that section has not been run" is stale** — it described the
composition document's §7 at filing time.

### Item 168 — Matchups renders no odds, and the mockup says scheduled rows carry them

**Split out of Item 143 on 2026-09-08**, after an implementer's read receipt stopped on the odds
divergence and the ruling narrowed it. **This is the live half of widening 4**; the "live and final"
half never existed (INDEX CARRY row 29, corrected).

**The ask:** render odds on **scheduled** Matchups rows, with `Line not posted` when there is no line.

**The data is already there.** `MatchupsWeekPanel` receives `oddsByKey` and reads it at `:158`; it
simply never passes `footerSlot`. **The seam is open too** — Item 155 made the footer content-gated
(`CompactGameScoreboard.tsx:245`), so any state may carry one. **This is caller work only.**

**The empty state is specified and is not a spacer.** The mockup renders `Line not posted` as
CONTENT on rows with no line (`:409`, `:433`). That is deliberately different from Item 155's ruling,
which removed a reserved empty BAND from Matchups: a vertical list has no peer to align with, so it
does not reserve height — but every scheduled row carrying a real string means the rows are uniform
because they all have content, not because one is padded. **Do not reintroduce a reserved band.**

**Live and final rows carry no odds.** Measured: all six `sb-odds` elements in the mockup sit in
scheduled blocks. Do not add them elsewhere.

**Blocker:** none. Independent of Item 143 — that slice is the status-row seam and this needs no seam.

### Item 169 — `Close` can fire on a game that has not been played

**Reported from the 157/162/163 branch, 2026-09-08. Pre-existing, not caused by it.**

`DESIGN.md:298`: _"Close" applies to live and final games only. On a scheduled game it is a
projection, not a fact._ **`gameTags.ts` does not check state.** `gameMargin` (`:70`) reads
`item.score?.away.score` and `item.score?.home.score` and returns their difference; the `close`
branch (`:548`) fires on `margin != null && margin <= 7`.

**So a scheduled row carrying a cached `0-0` score pack yields margin 0, takes the chip, and takes 80
points of `watchlistPriority`** — sorting an unplayed game up a six-card list.

**MEASURED AGAINST PRODUCTION 2026-09-08, read-only replica — the mechanism is REAL and has never hit
an FBS game.** This is the reachability question the item said to answer first.

Across all seven seasons in the score cache (2018, 2021-2026), packs carrying BOTH scores:

| year | status | packs with scores |
| --- | --- | --- |
| 2026 | `final` | 454 |
| 2026 | `scheduled` | **0** |
| 2023 | `final` | 3,724 |
| 2023 | `scheduled` | **6** |
| all other years | `final` only | — |

**Only two literal statuses exist in production — `final` and `scheduled`.** The provider never emits
`postponed`, `canceled` or `suspended`, which the classifier's comment anticipates; it just leaves a
disrupted game as `scheduled`.

**The six are all Alderson-Broaddus**, a Division II school that closed mid-season in 2023. Their
remaining games were cancelled and the provider left them `scheduled` at `0-0`. **Margin 0, so all six
would take the chip and its 80 priority points.**

**So: a live mechanism, zero FBS instances in seven seasons.** The trigger is a game cancelled outright
and left `scheduled` with a zeroed score — a school closing, and plausibly a weather cancellation. The
2023 rows are D-II and would be pruned by Item 150 anyway, so they never reached a member; nothing
makes the mechanism division-specific.

**Ruling: a real guard, not an emergency.** Schedule it as ordinary work rather than a fix. **The
consequence if it does fire is worse than a stray chip** — 80 points of `watchlistPriority` sorts a
cancelled game to the top of a six-card list, so the failure is "the most prominent upcoming game is
one that will never be played".

**The ask:** guard `close` on live-or-final, per the rule.

**Why it needs an item rather than a fix in passing:** it is a behaviour change on a shipped surface,
and the reachability depends on whether a scheduled game can hold a score pack at all. **Establish
that first** — if it cannot, this is a latent guard rather than a live defect, and the item should say
which.

**Blocker:** none.

### Item 170 — CLOSED, NOT A DEFECT. The tertiary element clipping first is the hierarchy working

> **CLOSED 2026-09-09 by owner ruling, without code.** Surfaced when the implementer proposed the fix
> and named its trade honestly: protecting the owner means the **team name** clips instead on every row
> without an inline record — which is Schedule and every scheduled row.
>
> **`reference-game-row.md` §3 settles it.** Team name is **Primary**; record is the inline
> parenthetical; owner is a **Tertiary suffix**. **And there is no degradation rule for the team line at
> all** — the only one in the document governs the status row, where the tag is protected because _the
> tag is the scarce signal and the date is recoverable from the group heading above it_. Nothing says
> the owner is scarce, and it is recoverable from the standings.
>
> **So today's behaviour is the stated hierarchy working, not a regression.** The item was filed as
> _"retiring the `vs` pill removed the owner's fallback"_, which is accurate as description — **but the
> fallback was a duplicate, and what survives is tertiary by design.** Losing the least important
> element first is what a priority order is for.
>
> **The owner's ruling, in their words: team name stays primary.** `Georgia Sou… Chamness` tells a
> reader who owns something they can no longer identify.
>
> **Item 163 is not reopened by this.** Retiring the pill was still right; it duplicated a name already
> on the row. This closure says the surviving instance needs no protection, not that the pill should
> return.
>
> **Worth keeping as the general point:** a filed item can describe a real change accurately and still
> not be a defect. **The description "the owner now clips first" was true at filing and stayed true —
> what was missing was the contract that says it should.**

**Reported from the 157/162/163 branch, 2026-09-08 — a real cost of Item 163's retirement, correctly
reported rather than fixed across a lane boundary.**

The opponent owner used to appear twice: inline on the team line, and in the tier-2 `vs <owner>` pill.
Retiring the pill was right — it duplicated a name already on the row — but it also removed the
fallback. **The owner now lives only inside a truncating span**, so on a narrow card it is the first
element to ellipsize and nothing carries it.

**The ask:** decide whether the owner suffix needs protection from truncation, and if so, give it some.

**This belongs to Item 143's lane, not to a follow-up here.** The fix is in
`CompactGameScoreboard.tsx`, which Item 143 currently owns; the branch that found it was gated out of
that file and reported instead. **Fold it into 143 if that slice is still open when this is picked
up.**

**Blocker:** Item 143, by file ownership rather than by dependency.

### Item 171 — a dead scoring term in the watchlist sort

**MIGRATED to [#685](https://github.com/znpruitt/cfb-app/issues/685) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 172 — the code describes a provider vocabulary the provider has never used

**MIGRATED to [#661](https://github.com/znpruitt/cfb-app/issues/661) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 173 — back-apply tag decisions across Overview sections

**MIGRATED to [#671](https://github.com/znpruitt/cfb-app/issues/671) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 174 — DONE: Live rows render no broadcast

**Shipped on `claude/174-178-overview-conformance` (`0f2ec105`, `e5a3cbb4` + this closeout), merge pending.** `GameCardList` computes the label and passes it, ENUMERATED at the call site: the `live` branch (which resolves to `live` OR `awaiting`) supplies it and the `final` branch supplies nothing. **The gate changes no rendered output on its own** — `CompactGameScoreboard` also suppresses broadcast on finals — so what it buys is that Overview satisfies enumerate-don't-negate at the layer it owns, independent of a negation in Item 143's file. That is not observable at the DOM, proven by a mutation that stayed green, so it carries a structural pin with a retirement condition tied to Item 143 removing the negation.

**Item 167 residue R1.** `GameCardList` serves both Live and Recent finals and **accepts no broadcast
input**. Omitting it is correct for finals — §1: _a completed game's broadcast is dead information_ —
and wrong for live. **`DESIGN.md:201`: broadcast renders for scheduled, live and awaiting rows, not
finals.** §11 says the same.

**One component serving two states, where the rule differs by state.** Live silently inherits the
finals rule. That is `reference-game-row.md` §16's "state defined by one branch, other states inherit"
in its purest form.

**Blocker:** none. **Small** — the data is on the game already; the watchlist formats it at `:743`.

### Item 175 — DONE: two tag treatments in one slot, and the code cites the wrong row

**Shipped on `claude/174-178-overview-conformance` (`0f2ec105`, `e5a3cbb4` + this closeout), merge pending.** The watchlist reason label renders the shared bronze pill, asserted by comparing its rendered treatment to the tag beside it rather than to a literal. The mis-citation is DELETED, not repointed; `EYEBROW_REASON_CLASSES` is retained with **Item 113** named as the consumer that will use it, per the no-consumer rule — a rename mutation confirms it has zero production readers today. **Cost accepted and recorded: Item 186.** The pill carries `shrink-0`, so the row lost its only shrinkable child; the local fix is blocked by the equality contract that owns the slot.

**Item 167 residue R2, surviving Item 157.** On the watchlist, `Upset watch` and `Game of the Week`
render as **plain bronze text** (`gameUi.ts:189-190`, `#c9a66b`) beside `Top 25 Matchup` as a **bronze
pill** (`:174-175`, `#dbc190` + hairline). Two treatments, one slot, one row.

**157 unified the VOCABULARY. The TREATMENT axis survived it** — which is why this is residue rather
than a known divergence: a filed item shipped and did not close what it was filed to close.

**`reference-game-row.md` §2 rejects the split outright:** _"One treatment, no per-class variation… The
distinction is real but undecodable — a reader cannot learn 'pill means outcome' from looking.
Rejected."_

**The code's cited authority is for a DIFFERENT ROW.** `gameUi.ts:177-188` cites
`matchups-schedule-design.md` → _Not applied to the Featured reason row_, which exempts the **Featured
tile's** title (`sb-title`) — _"a card title on its own line rather than an inline tag beside a
status."_ The watchlist's row is an inline tag beside a status. **And that document settles nothing:**
_"bronze appears in two shapes. **Flagged rather than settled** — making it a pill too is a one-line
change if the inconsistency reads badly."_

**Why the mis-citation happened, which is worth keeping:** in the mockup, `.sb-title` is the
**watchlist's** class and Featured uses `.fx-reason`. A reader matching on the class name lands on the
wrong row.

**RULED 2026-09-08 — the watchlist reason label IS a pill.** The Featured exemption was written for
the Featured tile's reason **row**, a card title on its own line. **The watchlist's `GAME OF THE WEEK`
sits inline beside a pill, so it is functioning as a tag and the exemption does not reach it.** One
treatment, per §2.

**The mockup is corrected and is now the reference** — the owner rebuilt `live-scoreboard-mockup.html`
on 2026-09-08: `.sb-title` and `.sb-meta-row` are retired, `.fx-reason-row` is Featured's alone and the
only plain-text bronze on the page, and the file carries a note (`:380`) naming what the old class
name caused **so the next reader cannot reconstruct the mistake from it.**

**The ask:** make the watchlist reason label a pill, and delete the mis-citation in `gameUi.ts:177-188`
rather than repointing it — the exemption it cites does not apply here at all.

**Blocker:** none.

### Item 176 — DONE: the Featured section renders empty instead of hiding

**Shipped on `claude/174-178-overview-conformance` (`0f2ec105`, `e5a3cbb4` + this closeout), merge pending.** The `|| gameSections.recentFinals.length === 0` disjunct is gone. It could only turn the condition false→true, so removing it changes exactly one case — both-empty — and the recent-finals-present case was already absent. The March 2026 test that defended the old behaviour is REPLACED rather than deleted, and mutation-proven: restoring the disjunct turns four tests red.

**Item 167 residue R5.** `OverviewPanel.tsx:1649` renders Featured when
`recentResults.length > 0 || recentFinals.length === 0` — so on a page with **zero games** it renders
the heading plus `No recent results yet.`

**Both references say empty sections hide.** `composition.md` §2 and `reference-game-row.md` §12:
_"Empty sections hide, so outside a slate Live disappears and the watchlist rises without any
conditional logic."_ **The order is described as self-managing; this section manages itself the other
way.**

**A test defends the current behaviour** — `OverviewPanel.test.tsx:1781-1800` asserts the empty string
on a zero-game render, dating to `352054d1` (2026-03-26), **months before** the hide rule was written
(2026-09-08). **No decision reconciles them.** POLISH-013 sanctions the GB Race empty state and is
scoped to the trend section only.

**RULED 2026-09-08 — Featured HIDES when empty.** The hide rule was decided; the March test predates
it and defends behaviour nobody chose.

**The ruling does not depend on resolving Item 113**, which is why it can be made now: **both readings
of Featured agree.** Results-based empty means no results; must-watch empty means nothing selected.
**In either case an orthogonal section with nothing in it does not render.**

**The ask:** hide the section when empty, and **change `OverviewPanel.test.tsx:1781-1800` to defend the
rule rather than the accident.**

**Blocker:** none. Related: **Item 113**, which owns what promotes a game into Featured but says
nothing about the empty case.

### Item 177 — Featured's postseason ordering is the exact reverse of the rule

**DUPLICATE — absorbed into [#675](https://github.com/znpruitt/cfb-app/issues/675) on 2026-09-10.**
Both this entry and Item 113 name `selectFeaturedGames` (`selectors/overview.ts:466`) and both trace
to Item 167's residue. **Item 113's scope was widened on 2026-09-08 to own Featured's ordering while
this entry already did** — neither author saw the other. **This framing is the sharper one and was
kept in #675:** the rendered order is championship (Jan 1) → quarterfinal (Jan 5) → bowl (Jan 9),
the exact reverse of the rule.

### Item 178 — DONE: the 17px section-header exception was decided, marked landed, and never built

**Shipped on `claude/174-178-overview-conformance` (`0f2ec105`, `e5a3cbb4` + this closeout), merge pending.** `SectionHeader` takes an OPT-IN `gameSection` prop, and the direction is the rule rather than a preference: a sixth section inherits the default and must ask for the exception, which is what "not a new default elsewhere" requires. **GB Race is the fifth caller** the receipt found — a standings section `DESIGN.md` excludes by name — and keeps 15px/500. `font-[650]` was verified against the emitted bundle rather than assumed: `.font-\[650\]{--tw-font-weight:650;font-weight:650}`. **Item 185** records that no platform with a static system family can express 650; that is a font-stack property affecting every weight token, not a reason to weaken this rule.

**Item 167 residue R7, and the third instance of this exact shape.**

`DESIGN.md:390`: **Game-section exception (17px, weight 650)** — owner decision 2026-09-03, naming the
four Overview game-section headers. `item-87-live-watchlist-scoreboard.md:564` marks it **"Landed —
Amendment 5 / §Section headers."**

**`git log -S'text-[17px]' -- src` returns ZERO commits.** All four headers render through one
`SectionHeader` (`OverviewPanel.tsx:391`) at `text-[15px] font-medium` — the 15px/500 default the
exception exists to override.

**A canonical rule, marked landed, that has never had an implementation.** Same shape as Item 165's
chip cap and Item 159's inert `darkMode: 'media'`. **A document that was never true is worse than one
that drifted** — nothing in its history marks a moment of change, so no reader has cause to distrust
it, and "Landed" actively vouches for it.

**RULED 2026-09-08 — BUILD IT.** It was a deliberate owner decision and it is in `DESIGN.md`. **The
alternative is retracting a canonical claim because nobody implemented it, which sets the wrong
precedent for the whole family:** the fix for a canonical rule that was never true is **making it
true**, not deleting it. Retire the rule only if the rule is wrong — never because the code disagrees.

**The ask:** implement 17px/650 on the four Overview game-section headers.

**Blocker:** none. **One class string** if it is built.

### Item 179 — DONE: the awaiting anchor renders the contract's en dash

**✅ MERGED 2026-09-09 — PR #589, `d913ede6`.** The shared non-scheduled null-score fallback now renders `–` (U+2013), matching
`reference-game-row.md` §4 and §11. That shared fallback also covers a live row with only one score
populated, so the same glyph changes there; final presentation requires both scores and does not
reach the fallback. Item 170 closed without code: the team name remains primary, the owner remains
the tertiary suffix that clips first, and Item 163's retired `vs <owner>` pill stays retired.

**Item 167 residue R8, at filing.** `CompactGameScoreboard` rendered `—` on awaiting rows;
`reference-game-row.md` §4 and §11 and the mockup all specify `–`.

Trivial in size, real against the contract, **and filed rather than folded so the residue count is not
shaded by tidiness in either direction.**

**Blocker:** none.

### Item 180 — DONE: the `Streaming ·` prefix, agreed and never filed

**Shipped on `claude/174-178-overview-conformance` (`0f2ec105`, `e5a3cbb4` + this closeout), merge pending.** Cut in the SHARED formatter, so **Schedule changes with Overview** — deliberately, because the rule is a property of the shared row and applying it to one surface is the omission Item 160 records. Schedule gained its own test; the assertion that sat nearest to it could never have caught the prefix, since its fixture carries no media at all (**Item 183**). `Radio ·` retained. **The owner's condition was discharged before the cut** (read-only replica, `schedule-media/2026-all`): of 993 `web` rows, the 166 on a game with an FBS participant carry ten outlets — ESPN+, MW+, SECN+, ACCNX, Disney+, ACC Extra, Peacock, HBO Max, ESPN Unlmtd, UConn+ — every one reading as a streaming service unprefixed; `mobile` has zero rows, and the `TV`-named conference networks and bare `.com` school sites that could read otherwise are all on non-FBS games this surface never renders.

**Agreed in `item-87-followon-overview-back-application.md:71-73` and filed nowhere until now.**
Surfaced 2026-09-08 when the owner asked whether Item 174 adds the word "broadcast" to live rows. It
does not — but it routes them through the formatter that adds this.

`gameCardPresentation.ts` → `formatPrimaryBroadcastLabel`:

    case 'web': case 'mobile': return `Streaming · ${best.outlet}`;
    case 'radio':              return `Radio · ${best.outlet}`;
    default:                   return best.outlet;   // "ABC", "FOX", "ESPN2"

**The ask:** drop the `Streaming ·` prefix; render the outlet alone.

**The owner's reasoning, recorded:** _the prefix does not help a reader who does not recognise the
name, and is redundant for one who does. It is also inconsistent: FOX and ESPN2 carry no equivalent
qualifier, so the label appears only when the answer is less familiar — backwards._ It is also the
longest metadata string on the surface and the first to truncate once metadata moves into the status
row.

**DO THIS BEFORE OR WITH ITEM 174, not after.** 174 gives live rows a broadcast label for the first
time. **Doing it first spreads `Streaming ·` onto a surface that does not carry it today**, and the
cut then has two surfaces to clean instead of one. Same shape as Item 166's ordering argument.

**`Radio ·` is NOT ruled and must not be removed with it.** The owner's argument is about a
qualifier that adds nothing — but radio is a different KIND of broadcast, not a less familiar name for
the same kind, so removing it could present a radio-only game as watchable. **Separate call; leave it
alone until it is made.**

**Verify before applying** (the owner's own condition): that no broadcast value is genuinely ambiguous
without the qualifier. That is a production data question — enumerate the distinct `web`/`mobile`
outlets in the schedule-media cache and check none reads as something other than a streaming service.

**Blocker:** none. **One line**, plus the verification above.

### Item 181 — audit Matchups and Schedule the way Item 167 audited Overview

**MIGRATED to [#672](https://github.com/znpruitt/cfb-app/issues/672) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 182 — two unreachable empty branches on Overview

**Reported from the 174-180 branch.** `FeaturedGamesList`'s `emptyMessage` ("No recent results yet.")
became unreachable when Item 176 made the section hide, joining `WatchlistScoreboardList`'s, which
already was — its section is gated on `.length > 0`.

**Left in place deliberately.** Deleting is its own change with its own test surface and was not in the
ruling; an unreachable BRANCH is also not an orphaned MODULE, so `AGENTS.md`'s no-consumer rule does
not reach it.

**The ask:** remove both, or record why an empty-state message is retained for a section that cannot
render empty.

**Blocker:** none. **Small**, but enumerate what each branch does besides print its message first.

### Item 183 — a vacuous assertion on the Schedule streaming test

**Found while cutting the prefix.** `GameWeekPanel.test.tsx:2020` asserts
`doesNotMatch(html, /Streaming ·/)` **on a fixture carrying no media at all**, so it passed identically
before and after Item 180 and could never have caught the prefix.

**Its own subject is missing enrichment, so it is not wrong** — it is testing something else and the
regex is decoration. **The real Schedule coverage is the new test beside it**, which supplies the
positive control this one lacked.

**The ask:** remove the decorative assertion, or give it a fixture that could fail.

**Why file it rather than fix it in passing:** a passing assertion that cannot fail is the vacuous-test
family this campaign has shipped four times, and removing one silently teaches nothing. **This is the
cheapest possible instance to point at** — the fixture is two lines away from the thing it claims to
check.

**Blocker:** none. **Trivial.**

### Item 184 — a failing assertion can present as a file-level timeout with no subtest output

**Observed on the 174-180 branch, mechanism NOT established, and reported as an observation for that
reason.** With four assertions failing mid-build in `OverviewPanel.test.tsx`, `npm run test:file`
reported the **whole file cancelled after 30 seconds and named no test.** Skipping those four ran the
file in under a second; retargeted, it passes in 465ms.

**It reads as a hang and misattributes the cause** — the natural response is to look for an infinite
loop or a slow render, not for an assertion. It cost the implementer real time.

**A synthetic large-TSX reproduction did NOT reproduce it**, so there is no mechanism to state and none
is claimed.

**The ask:** reproduce it deliberately, or record that it could not be reproduced and what was tried.

**Why it matters beyond the annoyance:** the harness is the instrument every gate reads. **An
instrument that reports "cancelled, no test named" for "your assertion failed" will send the next
person looking in the wrong place**, and this session has already spent an hour on a diagnosis that
pointed away from its cause.

**Blocker:** none. **Investigation, not a fix** — it may end in a recorded non-reproduction, which is a
complete answer.

### Item 185 — two web fonts are downloaded on every page and neither is used

**Found during the 174-180 review, ranked first by the implementer, and it is bigger than the header
question that surfaced it.**

`app/layout.tsx:3` imports `Geist` and `Geist_Mono` from `next/font/google`; `:10` and `:15` define
`--font-geist-sans` and `--font-geist-mono`; `:31` applies both variable classes to `<body>`.
**`--font-geist-sans` is consumed by nothing** — its only occurrence in `src/` is its own definition. **Geist Mono is dead too:** the `font-mono` classes in the admin pages resolve to Tailwind's DEFAULT mono stack, because nothing maps `--font-geist-mono` to it and `tailwind.config.ts` is inert (Item 159).
`globals.css:48-61` sets the body to a pure system stack: `ui-sans-serif, system-ui, -apple-system, …`

**So every page load fetches two web fonts that render nothing.** Live, pre-existing, app-wide.

**It is also why Item 178's `font-[650]` cannot render as specified.** System families are static
400/700, and CSS font matching for a target above 500 searches weights ≥ target ascending — so 650
resolves to **700**. A variable family expresses 650; the one that is loaded is never applied.

**The ask:** either apply Geist, or stop downloading it. **Both are defensible and they are different
decisions** — one is a design choice about the app's typeface, the other is removing dead weight.

**Do not fold this into Item 178.** 178 built what `DESIGN.md` specifies and proved it compiles; the
ruling was build-it-not-retract-it. **Whether the platform can express 650 is a property of the font
stack and affects every weight token in the app** — the previous `font-medium` rendered 400 on those
same platforms, not 500. Fixing the stack fixes the class of problem; changing 650 to 600 hides one
instance of it.

**Blocker:** none. Related: **178**, whose rendered weight depends on the answer.

### Item 186 — the watchlist reason row has no overflow valve

**Raised by both reviewers, in two separate rounds, with the remedy blocked both times.** That
rhyming is the reason it is filed rather than patched.

After Item 175 the reason label is a pill, so a card carrying a reason **and** a tag holds two
`shrink-0` pills in a row that is `overflow-hidden whitespace-nowrap`. At narrow widths it **clips
rather than ellipsizing**. Both reviewers measured it latent — roughly 270px of chips in a ~360px
column — so it is not currently reachable.

**The suggested remedy is mechanically blocked, and deliberately.** Adding `min-w-0` to the label turns
`eyebrowTreatment.test.tsx` red on _the watchlist reason label renders the same treatment as a tag
beside it_. `LAYOUT_ONLY_CLASSES` is `{inline-flex, hidden, sm:inline-flex}` and its docblock says
_"exempting a class is how an equality test stops testing equality; keep this set to display alone."_
**The implementer tried the fix rather than arguing about it, and reverted.**

**This belongs to whoever owns the tag slot's overflow behaviour — Item 143.** The contract that blocks
the local fix is the same contract that makes the treatment uniform; the valve has to live where the
slot is defined, not at one caller.

**Blocker:** Item 143.

### Item 187 — the third chip is uncounted

**MIGRATED to [#673](https://github.com/znpruitt/cfb-app/issues/673) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 195 — the Featured badge-label assertion does not prove containment

**From Item 173a's review, accepted and not fixed there** — the single permitted remediation was already
spent, and this is follow-up rather than a defect the remediation caused.

The test proves `CFP Quarterfinal` appears **after** the badge attribute in the markup, not that it is
**inside** the badge element. A label that escaped its badge and rendered as a sibling would pass.

**The ask:** replace it with a JSDOM `textContent` assertion on the badge element.

**Blocker:** none. **Trivial**, and it is the assertion the badge move should have carried.

**Blocker:** none, but it interacts with **169** and **186**; the three are one conversation about what
the slot holds.

### Item 188 — the provider deadline ends before the response body downloads

**MIGRATED to [#662](https://github.com/znpruitt/cfb-app/issues/662) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 189 — an unreadable planner settings store reports itself as an operator pause

**DUPLICATE — merged into [#619](https://github.com/znpruitt/cfb-app/issues/619) on 2026-09-10.**
This was filed 2026-09-08 from the audit (**R2**). Planning filed the same defect again as Item 208 on
2026-09-10, out of the Item 207 chain, **without searching the queue first** — #619 is that issue, and
it now carries both. **This entry's content was the better write-up** and was folded in, including the
point that the planner's own test pins the wrong classification, and the "preserve the previous plan"
half of the ask that Item 208 omitted.

### Item 190 — a failed standings invalidation can leave results stale indefinitely

**Dispatch position 6.** Evidence: [the 2026-09-08 audit](archive/audits/codebase-audit-existing-plans-2026-09-08.md) → **R3**.

Schedule refresh paths swallow lookup and invalidation errors while canonical standings use
`revalidate: false`. **The code comment promising natural cache turnover does not match tag-only
caching**, and a later unchanged provider refresh need not retry the missed invalidation.

**Current user-visible impact is UNRESOLVED, not absent.** Fresh canonical rebuilds succeeded for TSC
and Pruitt (15 and 8 owner rows), but deployed page requests returned the league-password gate, so no
cached-versus-fresh comparison was completed. **That comparison is one of the immediate validation
gates, and its result attaches here.**

**The ask:** report post-commit invalidation failure separately from the commit, and support replay
**without another provider fetch**.

**Blocker:** none. The validation gate informs the design but does not block starting.

### Item 191 — targeted schedule repairs never converge on the whole-season snapshot

**MIGRATED to [#663](https://github.com/znpruitt/cfb-app/issues/663) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 192 — the operator env file carries a production write credential

**Found 2026-09-09** by the Item 110A lane while discharging its read receipt. **Not found by any
gate.**

`.env.operator.local` contains **both** `DATABASE_URL_RO` (the documented `audit_ro` rail) **and a
production read-write `DATABASE_URL`** — `neondb_owner` on the primary endpoint. `CLAUDE.md` described
that file as the home of the read-only rail and said the rail exists so an agent **never needs the
production secret set**. **It was set the whole time.** Corrected 2026-09-09.

**The exposure is not hypothetical and not about trust.** `CLAUDE.md` instructs copying
`.env.operator.local` into every new worktree, so the write credential is present in both
implementation lanes by instruction. **The guardrail against an unauthorized production write is
therefore agent compliance rather than an absent credential** — which is what the corrected wording now
says.

**The ask:** split the write credential out of the operator file, or record why it must stay.

**Do not simply delete it before checking what needs it.** Operator scripts that legitimately write —
`scripts/init-game-stats-writer-control.ts`, `scripts/transition-game-stats-writer-control.ts` — may
read from this file today. **Enumerate the consumers first**; a credential removed from under a working
tool is how the next operator reaches for `vercel env pull`, which is the thing the rail exists to
prevent.

**Related: Item 110A**, whose production apply is gated on owner approval precisely because the
mechanism is available without it.

**ESCALATED 2026-09-09.** During 110A's review the lane could not rule out that one of its own review
agents had written to production — the write turned out to be the owner's own authorized apply, but
**the investigation was reasonable precisely because nothing made it impossible.** A review agent is
forked from the lane's context, inherits the worktree, and this repo's own tooling loads
`.env.operator.local` on startup. **A process nobody dispatched can therefore reach the production
primary by running an ordinary `npm run` script.** That is the exposure, independent of whether it has
ever fired.

**Blocker:** none. **Small**, once the consumers are enumerated.

### Item 193 — the merge repairs modelled categories and never raw-only ones

**Found 2026-09-09 by the Item 110A lane, after the recovery applied. Verified against the replica.**

`mergeRawEvidence` overwrites a raw category only when `parseCategoryValue(...).status === 'valid'`.
Categories with no strict parser — `tackles`, `sacks`, `qbHurries`, `completionAttempts`,
`tacklesForLoss`, `passesDeflected`, `totalFumbles`, `yardsPerPass`, `yardsPerRushAttempt` — return
`unknown-category` and are **preserved at their old values**.

**Production now holds half-repaired rows.** `401858212` reads modelled `totalYards: 324` (corrected)
beside raw `tackles: "0"`, `sacks: "0"`, `completionAttempts: "12-23"` (stale). Both verified.

**Re-applying the same capture cannot fix it.** The stored fence now equals the capture's, so the merge
returns `unchanged`. **A second observation at a newer fence would be needed, and it would repair only
the modelled half again.**

**The ask:** decide whether raw-only categories should be repairable, and if so how a merge distinguishes
"no parser" from "no data".

**This is Item 110B's problem, not a patch on 110A.** A recovery tool that reached past the merge
authority to write raw fields directly would be exactly the bypass the writer fence exists to prevent.

**PRIORITY LOWERED 2026-09-09 — no consumer can see the affected fields.** `mergeRawEvidence` writes
where a parser exists; `publicProjection.ts:137` exposes where a parser exists. **Same set.** So the
unrepairable categories are stored and never projected — unreachable by Insights, the archive, or any
reader. **This is storage hygiene, not wrong data reaching anyone.** It still belongs with 110B,
because a recurring reconciliation should decide whether unparsed evidence is worth carrying at all.

**Blocker:** none. Belongs with **110B**.

### Item 194 — `provider-refresh-status` is false after an out-of-band partition write

**MIGRATED to [#664](https://github.com/znpruitt/cfb-app/issues/664) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 196 — 96 of 97 game-stat partitions are legacy schema

**MIGRATED to [#665](https://github.com/znpruitt/cfb-app/issues/665) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 197 — reconciliation has no durable diagnostic beyond the scheduler receipt

**Reported from Item 110B's third review and deliberately not built there.** The reconciliation records
`provider-refresh-status` under `week-reconciliation` — a scope kind `game-stats` does not own, so it is
readable but **ineligible as latest activity by construction** — and appends to its own ledger.

**Nothing renders either.** The scheduler receipt carries the run's outcome once 110B's classification
fixes land, and that is the reader for now.

**The ask:** decide whether reconciliation warrants a durable diagnostic surface of its own.

**Why it was not folded into 110B:** it is a new surface, not a defect in the one being built. **A
reconciliation that fails silently is a real gap** — but the receipt covers the run, and inventing a
panel inside a remediation round is how a slice stops converging.

**Blocker:** Item 110B must land first — its receipt classification is what this would supplement or
replace. Related: **Item 132** (partition-scoped health), which may be the right home.

### Item 198 — a colour that fails normalisation is indistinguishable from no colour

> **THE CONTRAST TARGET WAS WRONG, AND MY OWN MEASUREMENT USED IT — corrected 2026-09-09.** The Item
> 119 lane found that the bar renders at **~72% opacity** and the normaliser lifts against the **raw**
> colour. `teamColors.ts:11` describes the 72% in its own header comment and does not account for it.
>
> **A colour lifted to exactly 3:1 composites to 2.10:1.** Measured: `#425F88` → `#324765`. The lane
> counted **54 of 125 outputs below 3:1 raw and 100 of 125 after opacity**. **The prompt's
> "contrast-lifted to ≥3:1" premise is false as rendered**, and the OKLCH measurement recorded below
> was taken against the same wrong target.
>
> **Re-measured at 3:1 AFTER 72% compositing, the answer survives and improves: 132 of 138 rescued
> with hue intact, ZERO unreachable in gamut.** It simply lifts further — `#041E42 → #617FAB` rather
> than `#425F88`. Lighter navy, still navy.
>
> **So piece 2's target is 3:1 COMPOSITED, not 3:1 raw**, and that number is the decisive trigger for
> building it.
>
> **Green team brands are NOT guarded — already settled, 2026-09-09 ruling.** `reference-game-row.md`
> §3: _"Identity, not semantics. It says 'this is Michigan', not 'this is good, active or interactive'
> — which is why it cannot collide with the reserved palette the way a meaning-bearing hue would."_
> **The gold guard is an exception for adjacency, not a general hue reservation:** champion amber is a
> token bound to a purpose and a gold bar can sit beside a champion badge. **The live indicator is a
> dotted text label, not a bar** — there is no adjacency to break, and distorting a green school's
> identity to avoid an imagined one is the thing §3 forbids.
>
> **Matchup-level bar uniqueness is NOT a contract.** Four of the five reported collisions are teams
> with identical PROVIDER colours; only one was created by normalisation. Guaranteeing two bars in a
> matchup differ would mean manufacturing colours, which is not identity.

**Observed on preview 2026-09-09 by the owner, then measured against the production catalog.** Item
119's bars render, and **California and Nevada carry none.**

**They are not missing a colour.** Both hold `#041E42` — **the exact value the design doc names as
Penn State's**, cited there as the canonical example of a primary invisible on a dark background. The
normaliser cannot lift it, returns `buildTreatment(FALLBACK_BASE, 'fallback')`, and Item 119's rule
correctly suppresses the bar for `source: 'fallback'`.

**So two different states render identically: NO COLOUR, and A COLOUR WE COULD NOT USE.** The first is
the documented rule — FCS teams have no catalog colour and an absent bar reads as missing data. The
second is a normaliser limitation being reported as missing data.

**Measured against the production `team-database`, 138 teams, all carrying a colour:**

| | |
| --- | --- |
| raw colour below 3:1 on `#0A0A0A` | **91 of 138** |
| pure `#000000` — unliftable while preserving hue | **6** |
| teams sharing `#041E42` (1.20:1) | 4 |

**The design doc estimated "roughly a fifth of the FBS". It is two thirds.** The lift succeeds for most
of them — the preview shows bars on 14 of 16 rows — but where it fails it fails silently.

**This is Item 119 piece 1 measuring badly, which is the documented trigger for piece 2** — the OKLCH
port with its reserved-hue guard, which `item-87-followon-team-colour.md` made conditional on exactly
this outcome. **Piece 2 is now warranted, on evidence rather than preference.**

**Two things to decide, and they are separable:**

1. **Should the two states render differently at all?** A team whose colour cannot be used is arguably
   entitled to something — but the argument against a grey bar still holds: it reads as a team whose
   colour is grey. **Distinguishing them in the DATA is not the same as distinguishing them on screen.**
2. ~~**Does OKLCH actually rescue `#041E42` and `#000000`?**~~ **MEASURED 2026-09-09, before building.
   The answer is yes for 85 of 91, and no for the six blacks — for the reason predicted.**

   Method: sRGB → OKLab → OKLCH, hue and chroma held, lightness raised until 3:1 against `#0A0A0A`,
   run over all 138 production catalog colours.

   | | |
   | --- | --- |
   | already ≥3:1 raw | **47** |
   | **rescued by OKLCH, hue intact** | **85** |
   | become grey (chroma ≈ 0) | **6** |
   | unreachable in gamut | **0** |

   **`#041E42 → #425F88` at 3.04:1 with 0.1° of hue drift** — still recognisably that navy. `#0C2340 →
   #465F80`, `#003594 → #2459BA`, `#782F40 → #914555`, all under 0.2°. **Piece 2 works, and it works
   without distorting team identity.**

   **`#000000 → #5D5D5D`.** The 89.9° of apparent hue drift is an artefact: black has zero chroma, so
   there is no hue to preserve and the result is grey — **the exact rendering the design doc rejects.**
   The six are App State, Army, Cincinnati, Iowa, UCF and Vanderbilt.

   **So piece 2 is warranted on evidence, and its limit is exactly six teams** — not a general
   weakness.

   **AND THAT LIMIT DISSOLVED THE SAME DAY.** Item 199 confirmed the catalog reads the wrong field
   name: the provider sends `alternateColor` and the code reads `altColor`, so all 138 alternates were
   discarded. **All six black teams have an alternate that passes 3:1 RAW, with no lift at all** —
   Army `#d3bc8d` at 10.70:1, Iowa `#ffcd00` at 13.18:1, Vanderbilt `#cfae70` at 9.37:1. **The six were
   never an OKLCH limitation; they were a mapping bug.** Fix Item 199 first — it may change what piece
   2 has left to do.

**Blocker:** none for Item 119 piece 1, which is correct as specified. This is the follow-on it named.

### Item 199 — the team catalog has zero alternate colours, and the field name is the likely reason

**Found 2026-09-09 while measuring Item 198.** The production `team-database` holds **138 of 138 teams
with a primary colour and 0 of 138 with an alternate.**

**That is very unlikely to be true of the provider.** Most FBS teams have a documented alternate —
Army, Iowa and Vanderbilt are gold, and those are three of the six teams whose primary is pure black.

**The likely cause is a field-name mismatch at ingest.** `teamDatabase.ts:233` reads
`record.altColor`; `:232` reads `record.color`, which works for all 138. **A field that works beside a
field that returns nothing for every row is the signature.** CFBD's REST API has used `alt_color` in
snake case.

**CONFIRMED 2026-09-09 — one CFBD call to `/teams/fbs`, HTTP 200, 138 rows.** The field is
**`alternateColor`**, not `altColor`. `teamDatabase.ts:233` reads a name the provider does not send, so
every row resolves `undefined` and the count is 0 of 138. **A one-word mapping bug.**

**Every team the catalog reports as colourless-beyond-repair has a usable alternate**, measured on
`#0A0A0A` and passing the 3:1 floor **raw, with no lift required:**

| team | primary | raw | alternate | raw |
| --- | --- | --- | --- | --- |
| Army | `#000000` | 1.06 | `#d3bc8d` | **10.70:1** |
| Iowa | `#000000` | 1.06 | `#ffcd00` | **13.18:1** |
| Vanderbilt | `#000000` | 1.06 | `#cfae70` | **9.37:1** |
| California | `#041e42` | 1.20 | `#ffc72c` | **12.69:1** |
| Nevada | `#041e42` | 1.20 | `#8a8d8f` | **5.93:1** |

**So the six black teams are not a limit of OKLCH — they are a consequence of this bug.** With the
mapping fixed and the catalog refreshed, they have gold to fall back to. **California, the team whose
missing bar started this, has gold at 12.69:1.**

**Why it matters beyond tidiness: it WAS the missing input for Item 198's six black teams, and now it
is a fix rather than a hypothesis.** OKLCH
rescues 85 of 91 dark primaries and can do nothing for pure black. **An alternate colour is the only
remaining source of hue for those six** — grey is rejected by the design doc, and no bar conflates them
with teams that genuinely have no colour.

**The ask:** confirm the field name against one live response, and if it is wrong, fix the mapping and
re-run the catalog refresh.

**Blocker:** none. **Small, and it may resolve the only open half of Item 198.**

### Item 200 — AGENTS.md has binding rules in lines nobody can read

**Measured 2026-09-09.** `AGENTS.md:146` is a **single line of 17,908 characters** — roughly 3,000
words in one unbroken paragraph. Seven lines exceed 2,000 characters; four exceed 6,000.

| line | characters |
| --- | --- |
| 146 | **17,908** |
| 814 | 10,165 |
| 802 | 9,109 |
| 820 | 6,974 |

**Line 146 carries the whole provider-refresh scope contract** — canonical, binding, and structurally
unreadable. **This is not a style complaint.** This campaign has spent days on rules that were present
and unfindable: the Item 87 obligations at 88% depth, the `Landed` mark on an unbuilt amendment, the
disrupted-status comments, the chip cap. **The owner's own framing of that failure was that prominence
is not the variable — position relative to where reading happens is.** A 17,908-character line is the
same failure by a different mechanism: everything after the first sentence is past where anyone reads.

**And it is still growing.** The `week-reconciliation` description added on 2026-09-09 went into line
146, by the planning session, without anyone noticing the line was already 16,000 characters long.

**The ask:** break the longest lines into structured subsections — the content is not the problem, the
packaging is. **Change no rule while doing it.**

### Item 201 — the seed catalog carries no colours at all

**MIGRATED to [#614](https://github.com/znpruitt/cfb-app/issues/614) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 202 — `src/types/teams.ts` is a dead duplicate that has drifted

**MIGRATED to [#615](https://github.com/znpruitt/cfb-app/issues/615) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 203 — `CfbdTeamRecord` and `/teams/fbs` disagree in both directions

**MIGRATED to [#616](https://github.com/znpruitt/cfb-app/issues/616) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 204 — an empty CFBD response wipes the team catalog, and the seed cannot rescue it

**Found 2026-09-09 by the Item 199 lane, on the refresh path Item 199 asks the owner to click. Traced
end to end here before filing.**

`src/app/api/admin/team-database/route.ts:38` does `records: Array.isArray(rows) ? rows : []` and then
commits unconditionally. **A CFBD 200 carrying a non-array body, or a genuine `[]`, replaces the 138-row
catalog with an empty one.** `AGENTS.md` → **Core rules 1** requires prior-good retention and
empty-replacement rejection for schedule, rankings and game-stats. **The team catalog — the thing every
surface reads identity, classification and aliases from — is the one without it.**

**`previousItems` looks like the guard and is not.** `buildTeamDatabaseFile` uses it only to compute
`updatedCount` (`teamDatabase.ts:270-273`); it never contributes an item. With `records: []` the built
file is `items: []`.

**And the seed fallback does not fire, because the row is present-but-empty rather than absent.**
`teamDatabaseStore.ts:112` is `toTeamDatabaseFile(record?.value) ?? (await readSourceCatalogFallback())`,
and `toTeamDatabaseFile` returns null only when `items` is **not an array** (`:75`) — an empty array
returns a valid file. **`??` does not fire on `[]`**, which is the identical defect this campaign already
shipped and fixed in PLATFORM-128. Recovery is another successful sync; until then every surface has no
team identity.

**Second defect at the same boundary, and the compiler cannot see it.** `teamDatabaseStore.ts:68` reads
`toNullableString(value.altColor)` where `value` is an untyped `Record<string, unknown>`. Renaming the
stored field type-checks the object KEY and leaves the READ silent — 138 durable rows would return
`undefined` with a green build. **The durable catalog is unvalidated in both directions.**

**The ask:** reject an empty or non-array upstream body before committing, retain prior-good, and
surface the refusal in the operator summary. **Blocker: none, and it should land BEFORE the Item 199
catalog resync** — that click is what makes this reachable.

> **SCOPE RULING 2026-09-09 — the standings guard is IN, the read-side validation is OUT (Item 205).**
> The 204 receipt enumerated 17 readers and found **two that persist the degraded result**:
> `leagueStandings.ts` caches wrong standings under the tag-only (`revalidate: false`) data cache, and
> `seasonBuild.ts` archives label-only identity. **Damage that outlives the repair is what makes this
> more than a write guard.**
>
> **`leagueStandings.ts:880-887` argues against guarding, from a premise this item disproves** — that
> `getTeamDatabaseItems` "already handles genuine absence internally." It does, for an ABSENT row; a
> present-but-empty one routes past the fallback. **Two sibling files already carry the correct guard
> AND the correct comment** (`canonicalSlate.ts:437-443`, `canonicalContext.ts:172-177`), so this is one
> file holding a stale model, not a missing feature. Transplant the sibling shape verbatim and delete
> the wrong reasoning — left standing it will talk the next reader out of the fix.
>
> **Item 205 is the read-side field validation** at `teamDatabaseStore.ts:68`. The lane's "no" earned
> itself: its trigger is a stored rename, which this slice's gate forbids, and doing it properly means a
> typed reader over all 14 fields plus a policy for field-level failure — a different item with its own
> blast radius across those same 17 readers.
>
> **The partial-response boundary is ACCEPTED as stated: the guard catches total loss, not partial.**
> No magnitude threshold. FBS membership moves 1-4 schools a year at realignment, so any floor low
> enough to be safe is inert and any floor high enough to matter would refuse a legitimate conference
> reshuffle until someone overrode it. **A threshold needing an override path is more machinery than the
> risk earns.** Not filed; the boundary is written down here instead.
>
> **The lane's own sharpening is adopted: key the guard on the BUILT item count, not the raw row
> count.** A 138-row payload where CFBD renames `school` normalizes to `items: []`, and a
> `rows.length === 0` check never sees it. Three rejection reasons, asserted separately — non-array,
> empty response, and nonempty-but-zero-usable.

### Item 205 — the durable catalog is read through an untyped `Record`

**MIGRATED to [#617](https://github.com/znpruitt/cfb-app/issues/617) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 206 — a refused catalog sync leaves no durable record

**MIGRATED to [#618](https://github.com/znpruitt/cfb-app/issues/618) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 207 — the polling-planner suite flakes on `plan-held`, and `reset()` is not holding

**Observed 2026-09-09 during Item 204's merge gate.** Four tests in
`src/app/api/cron/polling-planner/__tests__/route.test.ts` failed on one full-suite run and passed on
the next, same commit:

    405 - a dead day PAUSES both dense schedules and records what it did
    406 - a game day ARMS both dense schedules with the derived expression
    407 - an ABSENT or EMPTY season record sends nothing — absence is not a dead day
    409 - the durable record stores only the PLANNING DAY's windows

**The mechanism is in the failing run's own log:**
`{"result":"no-op","reason":"plan-held","day":"2026-09-09","jobsHeld":2}`. The planner found a plan
record already held for the planning day and no-op'd, so `pauses.length` was 0 instead of 2. **Durable
state, not logic.**

**What the Item 204 lane ruled out:** cross-file contamination — `run-tests.mjs:91` sets
`APP_STATE_TEST_ISOLATION=1`, keying the backing file by pid, with no stale temp files on disk. The
planner's tests are sequential and each calls `reset()`, which explicitly nulls the planner scope; its
own comment says a neighbour's data would otherwise decide the outcome. **So a record exists after
`reset()` nulled it, which is the part nobody can currently explain.**

**Hypothesis worth testing first: an un-awaited write from a prior test in the same file landing AFTER
`reset()`.** That would explain the nondeterminism, the ~1-in-3 rate, and why `reset()` appears not to
work despite running. Sequential tests do not protect against a promise nobody awaited.

**IMPORT-REACHABILITY DOES NOT CLEAR A TIMING-DEPENDENT FLAKE, and the Item 204 analysis should not be
carried forward as if it did.** The lane established that the planner imports nothing from its diff,
which is true and rules out a logic path. **It does not rule out perturbation:** Item 204 added 12
tests, and anything changing execution order or duration can change whether a late write lands before
or after a `reset()`. **The distinction matters — "this diff cannot cause it" is established, "this
diff cannot make it more likely" is not.**

> **DIAGNOSIS OVERTURNED TWICE. THE THIRD ONE IS MEASURED — 2026-09-10.**
>
> **Not the leaked plan record** (`reset()` nulls that scope at `route.test.ts:53-55`), and **not the
> swallowed `catch`** — planning's theory, refuted by instrumenting `route.ts:371` across **26 runs**:
> it fired exactly once per run, always the deliberate injection in test 11, never spontaneously. On
> every planted failure the settings read SUCCEEDED and returned a record that legitimately said paused.
>
> **The cause is a stale pid-keyed backing file.** `appStateStore.ts:95-97` keys the test store by
> `os.tmpdir()/cfb-app-app-state-test-${process.pid}.json` and **nothing ever deletes it**. There are
> **14,022** such files in `$TMPDIR`, days old. macOS recycles pids, so a new test process can start
> owning a previous run's fully-populated store. **394 of those files carry a
> `provider-refresh-settings::global` record holding BOTH planner jobs** — and `reset()` clears the
> planner record, the receipt scopes and the schedule keys, but **never the settings scope.**
>
> **Measured in the wild: 181 app-state-initialising processes per suite run, of which 260 of 1,086
> (23.9%) started with a pre-existing file at their pid path.** Planting exactly that payload gives
> **20/20 with the reported four-test signature, byte for byte.**
>
> **"Roughly 1 in 3" is NOT supported and should not be carried forward.** 0/6 full-suite runs, 0/60
> file-only runs. The true rate depends on how the pid counter currently lines up with stale
> generations, which drifts.
>
> **The class is 4 suites, not 1.** 139 test files call `__resetAppStateForTests`; **136 also call
> `await __deleteAppStateFileForTests()`** — the established idiom. Four do not: this one,
> `usage-sample/route.test.ts`, `pollingPlannerRecordWrite.test.ts`, `providerUsageWriteOutcome.test.ts`.
> The other three pass under the same planted payload today, but are structurally exposed.

**The ask:** add the repo's own `await __deleteAppStateFileForTests()` idiom to all four exposed
suites, making them the 137th–140th of 140 that do it. **Blocker:** none. **A flaky test in the
pre-merge gate is worse than a failing one** — it trains every lane to re-run until green, which is how
the next real regression gets merged.

### Queue migration to GitHub Issues — NEW WORK IS FILED THERE FROM 2026-09-10

**OWNER DECISION 2026-09-10: NEW WORK ITEMS ARE FILED AS GITHUB ISSUES, NOT HERE.**

**What this file is now canonical for:** the **dispatch order** — what is next and why — plus
cross-item rulings, the known-failure baseline, and campaign notes. **It is no longer where an item's
ask, state or evidence lives.**

**A PR that closes an issue says `Closes #N` in its body.** That state transition is the single
bookkeeping step that has failed by hand more than once in this campaign, and automating it is the
main reason the switch is worth making.

**THE SUB-100 TAIL IS FINISHED.** 57 items triaged, **53 migrated** (#595-#613, #623-#656), **3
superseded** (13, 76, and the already-superseded 88), **1 closed** (#609). **Item 87 is NOT migrated
and should not be** — it is the active campaign, and campaign status is what this file IS canonical
for.

**The premise that started this is refuted at 3 of 57.** The tail was not sediment; it was unstarted
work that was still true.

**A SECOND ITEM WAS FOUND WHOSE PRESCRIPTION IS NOW HARMFUL.** Item 38 asks to delete the
"redundant" `partial-roster` label; `insights/types.ts:99-112` records that it and `official-roster`
**were one value and had to be split**, because they carry different amounts of trust and the page
printed the same caption for both. **Deleting it reverses a shipped correction.** That is two of forty
— #595 and #636 — which is a high enough rate that "re-validate the prescription" is not a precaution,
it is the job.; **the live 200-series
migrated wholesale** (#614-#621). Their entries are pointers. **One superseded (Item 13), one closed
(#609).**

**The third batch was chosen deliberately, not evenly** — five of the ten are #610's gate
prerequisites, so triaging them priced a tracked goal instead of sampling. **Result: one of the six was
already done, two are `needs-decision` rather than work, and the remaining engineering is four issues,
not six unknowns.** **Item 13 is
the exception — SUPERSEDED, closed without an issue**, and the only one of twenty to come back that
way.

**A second axis was added 2026-09-10: DOMAIN labels**, so the backlog is filterable by the part of the
app it touches rather than only by state — `draft`, `preseason`, `season`, `offseason`, `insights`,
`admin`, `provider`, `scheduler`, `platform`, `ui`. Every issue carries at least one.
`docs/next-tasks.md` is ~7,300 lines and ~126,000 tokens: **nobody reads it, everyone greps it, and a
queue reachable only by search has stopped being a queue.**

| label | meaning |
| --- | --- |
| `actionable` | verified live against current code; ready to pick up |
| `needs-decision` | blocked on an owner ruling, not on work |
| `parked` | a conditional note whose trigger has not fired. Not work yet. |
| `needs-triage` | not yet verified against code |

**`parked` exists because Item 81 is neither live nor dead** — every bullet is gated on something that
has not happened ("if a second producer is added", "only if real CFBD evidence shows..."). **Filing
that shape as open work produces a backlog that never drains and cannot be prioritised.** Item 45's
second and third bullets and Item 60's implementation follow-ups are the same shape.

**Two rules for the remaining 46, both learned from the sample:**

1. **Re-validate the PRESCRIPTION, not just the symptom.** Item 19 accurately describes a live defect
   and prescribes a fix that would now deadlock the pool process-wide. A triage asking only "is this
   still broken?" would have marked it live and left the trap armed. **#595 carries that warning in
   bold above the ask.**
2. **A migrated entry becomes a POINTER.** The issue is canonical; the entry says where it went.
   Restating it in both places is how the two drift, and DOCS-012 already binds it.

**Across twenty items: ONE superseded, and the tail is otherwise live.** The premise that started this
— that the sub-100 backlog was mostly dead — is refuted at 1/20.

**The second batch found a shape the first did not: the GATE.** [#610](https://github.com/znpruitt/cfb-app/issues/610)
is not a task; it tracks six prerequisites for allowing members to make their own picks, and one of
the six turned out already done. **A gate filed as ordinary work reads as six times more remaining
than there is** — and reads as zero progress when a prerequisite lands.

**And a triage verdict can UPGRADE an earlier one.** [#596](https://github.com/znpruitt/cfb-app/issues/596)
was justified by an absence and said so; `owners/route.ts:124-126` was found while triaging Item 13
and states the exclusion outright, which turns it from "someone forgot to serialize this" into "a
documented single-operator assumption that #610 would invalidate." **The issue was relabelled
`needs-decision` on that basis.**

**What has NOT been decided:** whether the remaining 36 migrate. **26 sub-100 items remain untriaged**,
plus the 100+ range.

### Logos as the identity accent — MEASURED 2026-09-10, no decision taken

**The owner is prototyping logos in place of the colour bar, in the UI lane. Recorded as measurement
only; nothing here decides anything.**

- **All 138 teams already carry logos in the production catalog.** Mapped at `teamDatabase.ts:242`,
  persisted at `teamDatabaseStore.ts:69`. **No Item 199 repeat — nothing is being discarded.**
- **16 variants per team:** 8 sizes (500, 256, 128, 96, 64, 48, 32, 16) x 2 themes. A 20px row logo can
  fetch the 32px asset rather than downscaling a 500px PNG.
- **One host,** `cdn.collegefootballdata.com`. No auth; 200s on every probe.
- **`logos-dark` is byte-identical to `logos` for 42% of teams** (19 of 45 sampled at 32px, md5). CFBD
  has no genuine dark-background variant for Army, Arizona, Boise State, Colorado and others.
- **BLOCKER: `next.config.ts` is 7 lines with no `images` config.** `next/image` rejects the CDN host
  until `remotePatterns` names it. No CSP is configured, so that is the only gate.

**Why logos are more robust here than colours, and it is not a preference.** A logo carries its own
internal contrast. Army's mark is a black shield — invisible as a solid bar — but the gold helmet and
white outline inside it still read on `#0a0a0a`. **A dark solid bar has no interior; a dark logo does.**
That is why this direction sidesteps the remap/outline problem rather than inheriting it.

**Two questions to settle before, not after.** Serving 138 school marks from a third-party CDN is
conventional for the genre but is a different posture than colour swatches, and it is an owner call.
And **if logos replace the accent, Items 119, 198 and the outline prototype are RETIRED, not paused** —
`teamColors.ts` returns to having no consumer, and several campaign documents currently assert the bar
ships.

### Item 208 — an unreadable settings record reports the one result alerting ignores

**MIGRATED to [#619](https://github.com/znpruitt/cfb-app/issues/619) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 210 — `npm test` can DROP PRODUCTION `app_state`, and the only guard is nobody exporting a variable

**Found 2026-09-10 by `/code-review` on the Item 207 branch; mechanism verified here.** Filed ahead of
Items 208 and 209 — **this is the next platform item.**

`appStateStore.ts:1317-1325`:

    export async function __deleteAppStateFileForTests(): Promise<void> {
      if (hasDatabaseConfig()) {
        await ensureDatabase();
        await getPool().query('delete from app_state');
        return;
      }
      await fs.rm(appStateFilePath(), { force: true });
    }

**It branches on `hasDatabaseConfig()`, NOT on `APP_STATE_TEST_ISOLATION`** — and `run-tests.mjs:89-91`
spreads `...process.env` into the child, setting the isolation flag but passing any ambient
`DATABASE_URL` straight through. **136 test files call this helper**, so an exported `DATABASE_URL`
means `npm test` issues `delete from app_state` at the first suite that resets.

**`app_state` is the only table in the database.** Leagues, rosters, drafts, archives, provider caches,
scheduler receipts, the team catalog — all of it, one statement.

**And `.env.operator.local` carries a production read-WRITE `DATABASE_URL` into every worktree by
setup instruction.** `CLAUDE.md` already records that the guardrail is agent compliance rather than an
absent credential; **this is the path that converts that weakness into total loss.** One `source` or
`export` in the wrong shell.

**Attribution, corrected from the review:** this is **pre-existing and broad**, not introduced by Item
207. 136 files already call the helper, so 207's three additions do not meaningfully widen it. **That
makes it older and more reachable than the review implied, not less serious.**

**ESCALATED 2026-09-10 — THE DELETE IS THE SYMPTOM.** `APP_STATE_TEST_ISOLATION` appears in
`appStateStore.ts` **exactly once**, at `:95`, choosing a temp file path inside `appStateFilePath()` —
which the postgres branch never calls. **It gates no connection.** Ten sites branch on
`hasDatabaseConfig()` alone (`Boolean(process.env.DATABASE_URL)`), and `getAppStateStorageStatus():114`
reports `mode: 'postgres'` whenever a URL is present. **So with `DATABASE_URL` exported the entire suite
transacts against the live store** — `setAppState:1184` rewriting real rows scope by scope for the whole
run is the COMMON case, and reads at `:1147/:1219/:1252/:1277` mean **assertions run against live
leagues, drafts and archives**. The `delete` is merely the audible one.

**MEASURED by the lane, and four of my claims were wrong — all in the safe direction.** A
pool-injection seam **does** exist (`__setAppStatePoolForTests:1439`); `withFakePg` uses it rather than
mocking `pg`, which appears nowhere in the repo; the branch sites are **10 plus one reporter**, not 11;
and the helper has **140** callers, not 136.

**Guard cost: ZERO files.** Refusing only where a REAL pool would be constructed leaves 5,103/5,105 —
exactly the Item 137 baseline. **Not one test constructs a real pool.** Three independent enumerations
converge on one set of six: those failing under a blanket throw, those calling the injection seam, and
those setting `DATABASE_URL`. **And `new Pool(` appears exactly once in all of `src/`** (`:209`), with
`pg` imported nowhere else outside tests and `app_state` the only table — **one refusal covers the
application's entire database surface.**

**Severity bound, proven not assumed.** One file loads `.env.operator.local`
(`scripts/recover-game-stats.ts:945`, into its own process); `run-tests.mjs` loads no env file; no shell
profile references it; and Node v22 auto-loads no `.env` without a flag, so even a `vercel env pull`
into `.env.local` would not reach `npm test`. **It takes a deliberate `export` or `source`. Not a hair
trigger** — but when it fires there is no warning and the blast radius is the whole database.

**OWNER RULING 2026-09-10 — TWO GUARDS, covering DIFFERENT failure modes rather than one twice.** The
pool guard is conditioned on isolation being ON. **Run a test file directly — `node --test src/...`, no
wrapper — and the flag is unset, so the pool guard never fires** and the delete helper transacts against
whatever `DATABASE_URL` names; to that guard the case is indistinguishable from ordinary application
startup. **The helper therefore needs its own refusal, stated as a property of the FUNCTION rather than
of the connection:** `APP_STATE_TEST_ISOLATION !== '1'` → throw, unconditionally.

**The ask:** both guards — refuse a real pool under isolation, and refuse the destructive helper outside
isolation. **Blocker:** none. **The most dangerous thing either reviewer surfaced.**

### Item 211 — three more destructive test seams with the same hole

**MIGRATED to [#621](https://github.com/znpruitt/cfb-app/issues/621) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 209 — the test store leaks a file per process, forever

**MIGRATED to [#620](https://github.com/znpruitt/cfb-app/issues/620) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**
