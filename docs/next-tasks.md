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

**MERGED — `PLATFORM-128` — merged `2dace5c5`.** Registry entry present. Status flipped 2026-09-10 during the
queue migration; **the entry had been stale since the merge.**

### Item 127 — sample CFBD usage on its own schedule and retain a daily series

**MERGED — `PLATFORM-127-RETAIN-PROVIDER-USAGE` — merged `dc82dfd8`.** Registry entry present. Status flipped 2026-09-10 during the
queue migration; **the entry had been stale since the merge.**

### Item 126 — schedule-refresh incident evidence is not durable enough to explain the failure

**MIGRATED to [#688](https://github.com/znpruitt/cfb-app/issues/688) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 144 — reconcile the Item 87 design-document set before the presentation follow-on

**MERGED — `PLATFORM-144` — merged, PR #582 (`08a31979`).** Registry entry present. Status flipped 2026-09-10 during the
queue migration; **the entry had been stale since the merge.**

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

**MIGRATED to [#697](https://github.com/znpruitt/cfb-app/issues/697) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 146 — the secret scan covers the receipt; a run writes seven durable keys

**MIGRATED to [#698](https://github.com/znpruitt/cfb-app/issues/698) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 142 — Matchups prints kickoff metadata on rows `DESIGN.md` says must not carry it

**MIGRATED to [#679](https://github.com/znpruitt/cfb-app/issues/679) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 141 — the Insights page does a full-season build on every request

**MIGRATED to [#714](https://github.com/znpruitt/cfb-app/issues/714) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 140 — stamp when a game first reads final, so the reconciliation tail can be sized

**MIGRATED to [#692](https://github.com/znpruitt/cfb-app/issues/692) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 139 — a final can show a pre-game record; reconcile records against completed games

**DONE — `PLATFORM-139-RECORD-RECONCILIATION-v3` merged**, registry entry present; v1 and v2 are
superseded and unimplemented. Overview now receives a server-reconciled record whose readable
unreflected results are included, so a final no longer shows a pre-game record.

### Item 137 — two `writer-convergence` tests are time bombs; `main` is red

**MIGRATED to [#696](https://github.com/znpruitt/cfb-app/issues/696) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 138 — `isOwnerVsOwner` counts `NoClaim` as a real owner

**MIGRATED to [#713](https://github.com/znpruitt/cfb-app/issues/713) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 136 — Matchups slate aggregates double-count a self game

**MIGRATED to [#712](https://github.com/znpruitt/cfb-app/issues/712) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 134 — Overview three-column tier

**MIGRATED to [#678](https://github.com/znpruitt/cfb-app/issues/678) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 133 — `zinc-500` at small type fails the contrast floor, repo-wide

**MIGRATED to [#711](https://github.com/znpruitt/cfb-app/issues/711) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 132 — the Scores and Game stats health rows read the wrong record

**MIGRATED to [#691](https://github.com/znpruitt/cfb-app/issues/691) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 130 — narrow live-score polling to game clusters, then stand down when they finish

**MIGRATED to [#689](https://github.com/znpruitt/cfb-app/issues/689) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 131 — game-stats polls 21 hours per game for data nothing reads live

**MIGRATED to [#690](https://github.com/znpruitt/cfb-app/issues/690) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 129 — two `usage-sample` follow-ups deferred out of PLATFORM-127

**MIGRATED to [#710](https://github.com/znpruitt/cfb-app/issues/710) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

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

**MIGRATED to [#709](https://github.com/znpruitt/cfb-app/issues/709) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 121 — every CFP first-round game shares one `eventKey`, and it is the React list key

**MIGRATED to [#708](https://github.com/znpruitt/cfb-app/issues/708) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

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

**MIGRATED to [#687](https://github.com/znpruitt/cfb-app/issues/687) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 110 — game stats have no correction path, and nothing detects that they diverged

**DONE — both halves merged 2026-09-09/10.** `PLATFORM-110A-GAME-STAT-RECOVERY-CLAUDE-v1` corrected
the five diverged records in production (12/12 fields verified against the replica, five fences
advanced, 202 untouched); `PLATFORM-110B-CORRECTION-RECONCILIATION-CLAUDE-v1` (PR #590, `9b150eb0`)
closed the gap permanently. **Its residue is filed separately** — #694 (raw-only categories the
merge never repairs) and #695 (the reconciliation's diagnostic is recorded but ineligible).

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

**MIGRATED to [#707](https://github.com/znpruitt/cfb-app/issues/707) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 106 — a third of fetched odds are discarded: mascot-suffixed non-FBS names never resolve

**MIGRATED to [#657](https://github.com/znpruitt/cfb-app/issues/657) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 104 — `canonicalWeek` compresses `(seasonType, week)` into one integer and derives the offset from data

**MIGRATED to [#686](https://github.com/znpruitt/cfb-app/issues/686) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

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

**MIGRATED to [#706](https://github.com/znpruitt/cfb-app/issues/706) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

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

**SUPERSEDED by Item 132, now [#691](https://github.com/znpruitt/cfb-app/issues/691).** This is the
STALE SECOND COPY of Item 88's heading — the first carries the supersession and this one kept the
original text. **Two headings, one number, one marked and one not**, which is how it survived five
earlier passes. Both attempts at this were built, reviewed and reverted; neither merged.

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

**MIGRATED to [#699](https://github.com/znpruitt/cfb-app/issues/699) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

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

**MIGRATED to [#715](https://github.com/znpruitt/cfb-app/issues/715) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 169 — `Close` can fire on a game that has not been played

**MIGRATED to [#716](https://github.com/znpruitt/cfb-app/issues/716) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

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

**MIGRATED to [#717](https://github.com/znpruitt/cfb-app/issues/717) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 183 — a vacuous assertion on the Schedule streaming test

**MIGRATED to [#700](https://github.com/znpruitt/cfb-app/issues/700) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 184 — a failing assertion can present as a file-level timeout with no subtest output

**MIGRATED to [#701](https://github.com/znpruitt/cfb-app/issues/701) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 185 — two web fonts are downloaded on every page and neither is used

**MIGRATED to [#702](https://github.com/znpruitt/cfb-app/issues/702) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 186 — the watchlist reason row has no overflow valve

**MIGRATED to [#718](https://github.com/znpruitt/cfb-app/issues/718) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 187 — the third chip is uncounted

**MIGRATED to [#673](https://github.com/znpruitt/cfb-app/issues/673) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 195 — the Featured badge-label assertion does not prove containment

**MIGRATED to [#704](https://github.com/znpruitt/cfb-app/issues/704) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

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

**MIGRATED to [#693](https://github.com/znpruitt/cfb-app/issues/693) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 191 — targeted schedule repairs never converge on the whole-season snapshot

**MIGRATED to [#663](https://github.com/znpruitt/cfb-app/issues/663) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 192 — the operator env file carries a production write credential

**MIGRATED to [#703](https://github.com/znpruitt/cfb-app/issues/703) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 193 — the merge repairs modelled categories and never raw-only ones

**MIGRATED to [#694](https://github.com/znpruitt/cfb-app/issues/694) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 194 — `provider-refresh-status` is false after an out-of-band partition write

**MIGRATED to [#664](https://github.com/znpruitt/cfb-app/issues/664) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 196 — 96 of 97 game-stat partitions are legacy schema

**MIGRATED to [#665](https://github.com/znpruitt/cfb-app/issues/665) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 197 — reconciliation has no durable diagnostic beyond the scheduler receipt

**MIGRATED to [#695](https://github.com/znpruitt/cfb-app/issues/695) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

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

**MERGED — merged `1cfa9df1`, PR #591.** Registry entry present. Status flipped 2026-09-10 during the
queue migration; **the entry had been stale since the merge.**

### Item 200 — AGENTS.md has binding rules in lines nobody can read

**MIGRATED to [#705](https://github.com/znpruitt/cfb-app/issues/705) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

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

**MERGED — merged `6ae1bd72`, PR #592.** Registry entry present. Status flipped 2026-09-10 during the
queue migration; **the entry had been stale since the merge.**

### Item 205 — the durable catalog is read through an untyped `Record`

**MIGRATED to [#617](https://github.com/znpruitt/cfb-app/issues/617) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 206 — a refused catalog sync leaves no durable record

**MIGRATED to [#618](https://github.com/znpruitt/cfb-app/issues/618) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 207 — the polling-planner suite flakes on `plan-held`, and `reset()` is not holding

**MERGED — merged `a08c8e7e`, PR #593.** Registry entry present. Status flipped 2026-09-10 during the
queue migration; **the entry had been stale since the merge.**

### Queue migration to GitHub Issues — NEW WORK IS FILED THERE FROM 2026-09-10

**OWNER DECISION 2026-09-10: NEW WORK ITEMS ARE FILED AS GITHUB ISSUES, NOT HERE.**

**What this file is now canonical for:** the **dispatch order** — what is next and why — plus
cross-item rulings, the known-failure baseline, and campaign notes. **It is no longer where an item's
ask, state or evidence lives.**

**A PR that closes an issue says `Closes #N` in its body.** That state transition is the single
bookkeeping step that has failed by hand more than once in this campaign, and automating it is the
main reason the switch is worth making.

**THE QUEUE MIGRATION IS FINISHED. TWO ENTRIES REMAIN AND BOTH ARE CORRECT TO LEAVE:** **Item 87**,
the active campaign — campaign status is what this file stays canonical for — and **Item 198**, in
flight with the UI lane as this was written.

**What the triage found across the whole queue, none of it visible before grouping:**

| | |
| --- | --- |
| already **done** and still reading as open | **13** |
| **duplicates** of another entry | **3** |
| **blockers cleared** without anyone noticing | **2** |
| items whose **prescription had become harmful** | **2** |
| a heading carrying **two entries under one number** | **1** |

**The two harmful prescriptions are the finding that justifies the exercise.** #595's fix would deadlock
a three-client pool process-wide; #636's would reverse a shipped correction. **Both items were still
accurate about their symptom.** A triage asking only "is this still broken?" marks both LIVE and leaves
the traps armed.

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

**MERGED — merged `421fab9c`, PR #594.** Registry entry present. Status flipped 2026-09-10 during the
queue migration; **the entry had been stale since the merge.**

### Item 211 — three more destructive test seams with the same hole

**MIGRATED to [#621](https://github.com/znpruitt/cfb-app/issues/621) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**

### Item 209 — the test store leaks a file per process, forever

**MIGRATED to [#620](https://github.com/znpruitt/cfb-app/issues/620) on 2026-09-10, labelled `actionable`.**
The issue is canonical for the ask, its evidence and its state. **This entry is a pointer.**
