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

`CURRENT`: **none on the server track — needs an owner call.** (Item 88 is superseded in full by
**Item 132**; both attempts at it were reverted.)

> **Item 102 is COMPLETE and LIVE, recovered 2026-09-11.** All four slices merged — slice 1 PR #566,
> slice 2 PR #574, slices 3a and 3b PR #577, slice 4 PR #578 (`4e10ec07`, 2026-09-07) — and the
> planner runs in production on `turfwar-polling-planner-daily`. Three registry entries still read
> *pre-merge closeout* until today, which is why this pointer went stale: **nothing flips a CURRENT
> pointer when a lane merges its own PR**, so a completed item stays CURRENT until someone reads the
> ledger against the remote.
>
> **The server track's stated order says Item 126 Tier A next, and that ordering predates Item 102
> finishing.** Tier A is `invocationId` across nine cron-log modules, and this file already records
> its value as capped — *"it correlates runtime logs that expire."* Against that, **And #689 is NOT the alternative I first
> claimed — CORRECTED 2026-09-11 within the hour.** Item 102 did not unblock #689's step 1; it
> *delivered* it. `derivePollingWindows` is called with no options at `pollingPlanner.ts:176`, so
> production runs every default step 1 specifies: 15m lead (`CLUSTER_LEAD_MS`), dense to last kickoff
> +8h (`CLUSTER_MARGIN_MS`), hourly to +24h (`SLOW_STEP_MINUTES = 60`,
> `RECONCILIATION_GUARANTEE_MS`), then off — and a real contiguous-cluster loop, not a per-day one.
> **The 59-61% saving is already banked.** I read two issue titles that sound alike and did not open
> the file; the constants are named `CLUSTER_*` and would have shown it in one grep.
>
> **What remains of #689 is step 2 only** — standing down when games actually finish rather than
> waiting out the 8h margin, estimated ~9 points. **And #689 itself says what to do first:** *"shipping
> [step 1] first yields production evidence of how often games really overrun the margin — which
> prices step 2 with data instead of this item's estimate."* Step 1 has been live since 2026-09-07.
> **THAT MEASUREMENT WAS RUN 2026-09-12 — see
> [`docs/campaigns/vercel-active-cpu.md`](campaigns/vercel-active-cpu.md) → *MEASURED IN PRODUCTION
> 2026-09-12*, which is canonical for the figures.** In short: the planner installed 993 `live-scores`
> wakeups over its first six days (165.5/day against 504/day before it), and October replays on the
> shipped code at **6,574**, 55.8% below the pre-planner fixed cron. **The 6,156 this line used to
> project has no derivation on record anywhere in the repo** — the two replays bracket it (6,063
> all-confirmed, 6,574 as the schedule stands), and the campaign document's 190.7/day was the
> all-confirmed floor, not the installed cadence.
>
> **Step 2 is priced: ~323 October wakeups per hour of margin removed, so 8h→5h is 969** — real, and
> roughly a seventh of what the planner already banked. **The tail evidence is NOT yet there.** Item
> 140's stamp holds five finals, all from one Friday night, all final within 4.45h of their own
> kickoff and 4.03h inside the margin. **Five observations from one slate is not a distribution.**
> **So step 2 is not ready to branch: re-run the measurement after two or three full Saturdays.**
> **Owner picks** between waiting on that and Item 126 Tier A. (#732 and #733 both shipped 2026-09-12 — PR #748,
> `8208c7d9`, and PR #749, `717fb842`. Held planner runs now leave a durable trace under a separate
> `held:<job>` series, and the planner's repair link is reason-keyed rather than job-keyed.)

`NEXT`: **Item 118** — Schedule status filter with counts. **Its prompt needs an owner design pass
first**; the entry below is a placement, not a specification.

> **Item 134 SHIPPED 2026-09-12** — PR #751, `4cfae75a`, three columns at ≥1348px. **v1 was stopped
> and closed unmerged (PR #747).** It ran without a prompt, from this queue line and a campaign
> document, so both Item 134 CARRY obligations reached nobody — the gap the `CARRIES:` field exists
> to close, left open here by planning. The v2 reconstruction carried them and converged.
> **[#750](https://github.com/znpruitt/cfb-app/issues/750) is open and is the owner's:** whether the
> tier should start below 1348px. Measured under a realistic worst case — rank, record, three-digit
> score — the row still retained 52.766px, so the breakpoint is conservative by a knowable margin
> rather than by guess.

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
3. **Items 119 and 198 — RETIRED by owner decision 2026-09-10.** Real-scoreboard prototypes showed
   that colour remapping collapsed familiar distinctions and the alternate-colour outline was too
   garish. A permanent **28px CFBD team logo** now owns the shared line-start slot across Overview,
   Matchups, Schedule, and Postseason; `DESIGN.md` carries the current contract.
4. **Item 118** — Schedule status filter with counts. Purely additive; after the rework it filters.
   **Design:** none written, so its prompt needs an owner design pass first rather than a paraphrase
   of this entry.
5. **Item 100b** — internal slate marker. Date gate removed 2026-09-03; its 2026 consequence
   (Featured empty through 2026-09-07) closes on its own, but the recap and look-ahead targeting it
   exists for recur next August. Cheap: the clustering code is recoverable from `d6184c28`.
6. **Item 113** — Featured as insight-selected, state-agnostic. Largest, and gated on a decision
   about `INSIGHTS-017-PALETTE` (a prose bullet today, not an item).
   **Design:** `docs/campaigns/item-87-followon-featured-intent.md` — it supplies the product
   intent and states that THIS item owns the reconciliation. Do not re-derive what it settles.
7. **Item 101** — season-boundary finals gap. Re-derive the empty window against the floating cutoff
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

**Retired decision:** the `#0A0A0A` versus `#161616` colour-normalisation target disappeared when
the owner selected logos instead of a solid colour accent.

**Parallel tracks (added 2026-09-04).** File surfaces verified, not inferred. The server track and
the UI spine do not touch each other, so they can run concurrently:

- **Server track, strictly serial with itself:** Item 102 + 88, then Item 126. All three converge on
  `schedulerExecutionStatus.ts` / `schedulerDeliveryHealth.ts` / `systemHealthIssues.ts`.
- **UI spine, strictly serial with itself:** 115 → the **28px shared-row logo treatment** → **134** →
  118. The shared component widening, Schedule transition, and card-owner row modifier merged via
  PRs #570, #572, and #575. Item 134 must use the permanent 32px logo slot when deriving its
  breakpoint.
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
| ✅ | ~~188~~ | provider deadlines carried through body consumption — **merged `57fdbd82`, PR #762**; closed #632 alongside. The ODDS body read is NOT covered and is #759 |
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
> **Historical sequencing is complete.** Items 199 and 204 merged before the catalog refresh and UI
> measurement. Their colour-bar dependency disappeared when the owner retired Items 119 and 198 in
> favour of logos; the alternate-colour ingest fix remains catalog correctness, not a scoreboard
> rendering dependency.

**110A first and unconditionally.** It is the only item with measured wrong data in production, and it
is bounded — five named provider IDs, not a sweep. **188, 20 and 47 follow because they are cheap,
self-contained, and the kind of defect that costs a weekend when it eventually fires.** 110B sits last
in this lane because it is prevention rather than repair, it carries an open cadence decision, and it is
a multi-round slice.

#### UI lane — `cfb-app-codex` — convert the seam Item 143 just built

| # | item | what |
| --- | --- | --- |
| **1** | **173b** | IMPLEMENTED AND REVIEWED 2026-09-12 — Live and Recent finals use the shared status-row tag slot with selector-owned `top25` / `close`. `Close` eligibility is centralized across all Overview consumers: scheduled/unknown packs never qualify; finals qualify at margins ≤7 except exact 0-0; Live qualifies at margins ≤7 with nonzero points or period/clock evidence. Suppression preserves other eligible tags. **MERGED `1d0cc3f8` (PR #763) 2026-09-13**; [#671](https://github.com/znpruitt/cfb-app/issues/671) and [#716](https://github.com/znpruitt/cfb-app/issues/716) both closed — **#716 was fixed CONSEQUENTIALLY by the centralization, not targeted**, because the watchlist reaches the same predicate through `prioritizeOverviewItems`. Residue: [#760](https://github.com/znpruitt/cfb-app/issues/760), [#761](https://github.com/znpruitt/cfb-app/issues/761). |
| ✅ | ~~170~~ | CLOSED, NOT A DEFECT — the tertiary element clipping first is the hierarchy working |
| ✅ | ~~179~~ | DONE — the awaiting anchor renders the contract's en dash |

**173a shipped** (PR #588, `00e3fccc`), so Featured is done and the item is scoped to its residue.
**Item 115 has since shipped too** (PR #744, `11350f11`), which discharges the issue's "sequence 173b
after 115" blocker.

**AND THE UI LANE'S QUEUE IS NO LONGER JUST THIS TRIO.** The **#672 audit RAN on 2026-09-11** — this
file and the issue both still described it as unrun — and filed ten residue
issues — #715, #722, #723, #724, #725, #726, #728, #729, #730 and #731 (#727 already shipped,
PR #741). That is Matchups and
Schedule conformance work the 2026-09-08 dispatch order could not have sequenced, and it needs an
owner pass against 173b for order. **Two of them are gated:** #726 (no third-column tier on either
surface) waits on the width numbers in #678/#681 being re-derived against the 28px logo slot,
and #750 is the owner's call on whether Overview's tier starts below 1348px.

#### UI LANE ORDER — the #672 residue, ordering pass 2026-09-13

**Five slices, grouped by FILE rather than by severity**, because the UI lane is strictly serial with
itself and two slices touching one component file cost two reviews of the same diff. All ten issues
were read in full; the grouping is stated so a future reader can check it rather than re-derive it.

| # | slice | issues | file(s) | state |
| --- | --- | --- | --- | --- |
| 1 | Matchups derived state | **#722**, **#724** | `src/lib/matchups.ts` | ready |
| 2 | Matchups caller work | **#723**, **#725**, **#715** | `MatchupsWeekPanel.tsx` | ready |
| 3 | Schedule presentation | **#728**, **#730**, **#731** | `GameWeekPanel.tsx` | ready |
| 4 | Schedule team-name form | **#729** | `gameWeek.ts`, `DESIGN.md` | **BLOCKED — owner decision** |
| 5 | Third-column tier | **#726** | both panels | **BLOCKED — and must be LAST** |

**#722 leads because it is the only CORRECTNESS defect in the ten.** An owner card reports zero live
games and can read `Scheduled` while a row inside it reads `Awaiting score` — wrong information on
screen, not a style divergence. Everything else in the set is conformance. It pairs with **#724**
because both are derived state in `matchups.ts` (aggregation at `:317`, sort at `:400`) rather than
rendering, so one slice covers one file and one kind of change.

**Slices 2 and 3 are mostly BACK-APPLICATION of decisions already ruled on Overview**, which is
exactly what the #672 audit exists to surface. **#725 is the direct
one-surface-over instance of #671's ruling** — `DESIGN.md` puts the two-tag cap in the SELECTOR, and Matchups adds a second,
invisible cap with a responsive `hidden`, so the cap that ships is not the cap that was ruled. **#728
is the slot confusion Item 173a already fixed on Featured.** Take them while those rulings are warm.

**#715 may split out of slice 2 if it grows.** It is caller work in the same file as #723 and #725,
but it carries a specified empty state (`Line not posted` as CONTENT, never a reserved band) and a
mockup-measured scope limit (scheduled rows only; zero `sb-odds` on live or final). If the receipt
shows it is more than passing `footerSlot`, it becomes its own slice rather than widening one.

**#726 IS LAST, AND NOT ONLY BECAUSE IT IS GATED.** It waits on the #678/#681 width numbers being
re-derived against the 28px logo — but the stronger reason is that **slices 2 and 3 change what a row
CONTAINS**: #723 adds broadcast, #715 adds an odds footer, #728 moves tags into the status row, #730
changes block padding. A column-count breakpoint derived before the row content is final has to be
derived twice, and the first derivation is the one that gets recorded and believed.

**#729 is a DECISION, not a conformance fix, and it is the owner's.** `DESIGN.md` is silent on team-name
display form, so the only contract is a campaign document that `DESIGN.md` does not corroborate —
and abbreviations may simply be correct at Schedule's density. `AGENTS.md` binds that a campaign
decision absent from `DESIGN.md` is not settled until `DESIGN.md` changes, so whichever way it goes,
**`DESIGN.md` gains the line.** A test currently defends the abbreviations (`GameWeekPanel.test.tsx:644`),
which is a fact about coverage, not evidence of a decision.

**Not in this order:** #750 (Overview tier breakpoint) is its own owner decision and gates nothing
here; #758 (phone-width tag relief) came out of 173b and is unsequenced.

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

**Remaining presentation work continues beneath all of the above.** What the UI lane takes now (173,
170, 179) is the subset Item 143 unblocked; the rest of the Item 87 queue — 115, 134, 118, the recap
adoption — is sequenced after the audit spine. Items 119 and 198 are retired; Item 134 must derive its
breakpoint from the replacement 32px logo slot.

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
pairing — same file, same `NoClaim` root), Item 133a (below), 122, 121, 84, 86, 111. Item 139 is
complete and merge-approved below. **Item 137 merged 2026-09-11** (#696, PR #742, `a8593d9f`); it is no
longer a filler.

> **Known-failure baseline: EMPTY as of 2026-09-11.** Item 137 (#696, PR #742, merged `a8593d9f`)
> removed the last two — wall-clock time bombs in
> `src/app/api/odds/__tests__/writer-convergence.test.ts`, not product defects. **`npm test` on clean
> `main` exits 0.** `CLAUDE.md`'s merge condition 3 now binds to an EMPTY set, so any failure
> anywhere stops a merge. If a known failure is ever accepted onto `main` again, it is recorded HERE
> and named individually — a count would hide the second one.
>
> **Item 135 shipped 2026-09-05** — PR #571, merged
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

### Item number → where it went

**`docs/next-tasks.md` was reduced to this table on 2026-09-10.** Every entry's ask, evidence and state
now lives in its GitHub issue; the 24 resolved without one are in
[`docs/archive/audits/queue-triage-2026-09-10.md`](archive/audits/queue-triage-2026-09-10.md), Appendix.

**This table exists so `Item N` still resolves.** Sixteen Item 87 campaign documents and every prompt in
`docs/prompts/` cite items by number, and rewriting those citations would be a larger and riskier change
than keeping a redirect. **Do not add rows — new work is filed as an issue and never gets an item
number.**

| item | went to | |
| --- | --- | --- |
| **12** | [#596](https://github.com/znpruitt/cfb-app/issues/596) | remaining draft-writer serialization |
| **13** | resolved — see the audit appendix | undo uses a reusable slot number and deletion bypasses serialization |
| **14** | [#623](https://github.com/znpruitt/cfb-app/issues/623) | duplicate auto-pick attempts paint spurious refusals |
| **15** | [#624](https://github.com/znpruitt/cfb-app/issues/624) | double-submitted pick can be credited to the next owner |
| **16** | [#643](https://github.com/znpruitt/cfb-app/issues/643) | filed jointly — see the compound row |
| **16, 18, and 53** | [#643](https://github.com/znpruitt/cfb-app/issues/643) | converge operating year and described-data year |
| **17** | [#633](https://github.com/znpruitt/cfb-app/issues/633) | mid-season owner replacement does not update membership |
| **18** | [#643](https://github.com/znpruitt/cfb-app/issues/643) | filed jointly — see the compound row |
| **19** | [#595](https://github.com/znpruitt/cfb-app/issues/595) | alias/store failure preempts a clean pick refusal |
| **20** | [#625](https://github.com/znpruitt/cfb-app/issues/625) | database waits are unbounded |
| **23** | [#634](https://github.com/znpruitt/cfb-app/issues/634) | assignment-method and draft-recovery states |
| **25** | [#605](https://github.com/znpruitt/cfb-app/issues/605) | roster membership authority after publication is parked |
| **28** | [#597](https://github.com/znpruitt/cfb-app/issues/597) | remaining demo dry-run findings |
| **30** | [#628](https://github.com/znpruitt/cfb-app/issues/628) | insight rotation and the NEW tag are trigger-gated |
| **31** | [#644](https://github.com/znpruitt/cfb-app/issues/644) | filed jointly — see the compound row |
| **31–33** | [#644](https://github.com/znpruitt/cfb-app/issues/644) | finish preseason gates and superlative population conversion |
| **32** | [#644](https://github.com/znpruitt/cfb-app/issues/644) | filed jointly — see the compound row |
| **33** | [#644](https://github.com/znpruitt/cfb-app/issues/644) | filed jointly — see the compound row |
| **34** | [#635](https://github.com/znpruitt/cfb-app/issues/635) | remaining roster×schedule insight ideas |
| **35** | [#645](https://github.com/znpruitt/cfb-app/issues/645) | career and historical copy needs explicit time framing |
| **36** | [#606](https://github.com/znpruitt/cfb-app/issues/606) | participation claims remain ungated |
| **37** | [#598](https://github.com/znpruitt/cfb-app/issues/598) | `NoClaim` can count toward confirmation eligibility |
| **38** | [#636](https://github.com/znpruitt/cfb-app/issues/636) | retire `partial-roster` and restore selector ownership |
| **39** | [#646](https://github.com/znpruitt/cfb-app/issues/646) | draft-board walkthrough follow-ups |
| **42** | [#637](https://github.com/znpruitt/cfb-app/issues/637) | INSIGHTS-026 notable results, stored event source, and Forward Look (In progre |
| **43** | [#607](https://github.com/znpruitt/cfb-app/issues/607) | new preseason generators |
| **45** | [#599](https://github.com/znpruitt/cfb-app/issues/599) | PLATFORM-092 setup residue |
| **46** | [#626](https://github.com/znpruitt/cfb-app/issues/626) | deletion/adoption policy must precede external commissioners |
| **47** | [#627](https://github.com/znpruitt/cfb-app/issues/627) | public `bypassSuppression` is an invariant and cost bypass |
| **48** | [#638](https://github.com/znpruitt/cfb-app/issues/638) | test-infrastructure follow-ups |
| **49** | [#629](https://github.com/znpruitt/cfb-app/issues/629) | preseason-banner observation points |
| **50** | [#608](https://github.com/znpruitt/cfb-app/issues/608) | passive schedule-presentation checkpoint |
| **51** | [#600](https://github.com/znpruitt/cfb-app/issues/600) | manual assignment is offered but has no completion writer |
| **53** | [#643](https://github.com/znpruitt/cfb-app/issues/643) | filed jointly — see the compound row |
| **54** | [#647](https://github.com/znpruitt/cfb-app/issues/647) | season-recap residue |
| **55** | [#639](https://github.com/znpruitt/cfb-app/issues/639) | schedule load errors lose the information required for retry |
| **56** | [#648](https://github.com/znpruitt/cfb-app/issues/648) | POLISH-005 residue |
| **59** | resolved — see the audit appendix | second preview branch behavior is unknown and conditional |
| **60** | [#601](https://github.com/znpruitt/cfb-app/issues/601) | rankings recovery remains incomplete |
| **62** | [#640](https://github.com/znpruitt/cfb-app/issues/640) | INSIGHTS-033 is parked, not converged |
| **63** | [#630](https://github.com/znpruitt/cfb-app/issues/630) | delete-and-recreate reschedules need canonical reconciliation, and gate score- |
| **64** | [#649](https://github.com/znpruitt/cfb-app/issues/649) | remaining week-resolution residue |
| **65** | [#610](https://github.com/znpruitt/cfb-app/issues/610) | multi-writer draft gate |
| **68** | [#650](https://github.com/znpruitt/cfb-app/issues/650) | archive integrity with incomplete cumulative coverage |
| **71** | [#602](https://github.com/znpruitt/cfb-app/issues/602) | JSDOM-heavy test startup and timeout headroom |
| **73** | [#641](https://github.com/znpruitt/cfb-app/issues/641) | archived season-arc axis domain |
| **76** | resolved — see the audit appendix | team-catalog freshness has no read-only surface |
| **77** | [#651](https://github.com/znpruitt/cfb-app/issues/651) | CFBD advanced analytics is an in-season discovery trial |
| **78** | [#631](https://github.com/znpruitt/cfb-app/issues/631) | post-transition standings copy for an undrafted league |
| **79** | [#611](https://github.com/znpruitt/cfb-app/issues/611) | vanished-schedule observability follow-ups are evidence-gated |
| **80** | [#652](https://github.com/znpruitt/cfb-app/issues/652) | Next 16 upgrade is offseason-gated |
| **81** | [#603](https://github.com/znpruitt/cfb-app/issues/603) | score-gap diagnostic follow-ups are evidence-gated |
| **83** | [#653](https://github.com/znpruitt/cfb-app/issues/653) | team-identity normalization collides distinct schools onto one key |
| **84** | [#642](https://github.com/znpruitt/cfb-app/issues/642) | an overriding provider classification records no diagnostic |
| **85** | [#654](https://github.com/znpruitt/cfb-app/issues/654) | repair archived seasons polluted by the identity collision |
| **86** | [#612](https://github.com/znpruitt/cfb-app/issues/612) | the archive audit's integrity check can never pass |
| **88** | resolved — see the audit appendix | Provider data health cannot describe a schedule-armed dataset — SUPERSEDED by Item 132 ([#691](https://github.com/znpruitt/cfb-app/issues/691)). **Had TWO headings under one number.** |
| **93** | [#632](https://github.com/znpruitt/cfb-app/issues/632) | RESOLVED 2026-09-13 — all ten raised to `CFBD_PEAK_LATENCY_TIMEOUT_MS`, merged `57fdbd82` inside the #662 branch, because #662 changed what `timeoutMs` MEANS. The row read *nine* until 2026-09-12; the tenth writes `12000` without the underscore, which a `12_000` grep misses — keep that trap recorded, it has caught this count twice |
| **94** | [#655](https://github.com/znpruitt/cfb-app/issues/655) | measure the first full in-season month of CFBD burn (READ 2026-09-30) |
| **95** | [#604](https://github.com/znpruitt/cfb-app/issues/604) | remaining live-score cadence work |
| **96** | [#656](https://github.com/znpruitt/cfb-app/issues/656) | pause the in-season QStash schedules through the offseason |
| **98** | [#613](https://github.com/znpruitt/cfb-app/issues/613) | league page content paint: three measured costs |
| **100b** | [#706](https://github.com/znpruitt/cfb-app/issues/706) | internal opening-slate marker for recap and look-ahead |
| **101** | [#674](https://github.com/znpruitt/cfb-app/issues/674) | Recent finals can empty out at season boundaries |
| **102** | resolved — see the audit appendix | derive the QStash polling cron from the schedule |
| **104** | [#686](https://github.com/znpruitt/cfb-app/issues/686) | `canonicalWeek` compresses `(seasonType, week)` into one integer and derives t |
| **105** | [#687](https://github.com/znpruitt/cfb-app/issues/687) | the postseason override endpoint writes an unvalidated `Partial<AppGame>` |
| **106** | [#657](https://github.com/znpruitt/cfb-app/issues/657) | a third of fetched odds are discarded: mascot-suffixed non-FBS names never res |
| **107** | [#707](https://github.com/znpruitt/cfb-app/issues/707) | PLATFORM-122 deferred review findings (three, all small) |
| **108** | resolved — see the audit appendix | CLOSED, VERIFIED: live scores DO tick for FBS-vs-FCS games |
| **110** | resolved — see the audit appendix | game stats have no correction path, and nothing detects that they diverged |
| **111** | [#658](https://github.com/znpruitt/cfb-app/issues/658) | `/api/odds` fetches its own origin, costing two extra invocations per request |
| **113** | [#675](https://github.com/znpruitt/cfb-app/issues/675) | Featured games is a plain finals list; the insights-hook reframe was decided b |
| **114** | resolved — see the audit appendix | CLOSED, MISDIAGNOSED. Featured empties early; expiry was never involved |
| **115** | [#676](https://github.com/znpruitt/cfb-app/issues/676) | RESOLVED 2026-09-11 — Overview section expansion shipped (PR #744, `11350f11`) |
| **118** | [#677](https://github.com/znpruitt/cfb-app/issues/677) | Schedule status filter with counts |
| **120** | resolved — see the audit appendix | CLOSED, no action: the 2023/2024 field gap is unread and fails open |
| **121** | [#708](https://github.com/znpruitt/cfb-app/issues/708) | every CFP first-round game shares one `eventKey`, and it is the React list key |
| **122** | [#709](https://github.com/znpruitt/cfb-app/issues/709) | the historical-cache buttons cannot re-cache anything |
| **123** | resolved — see the audit appendix | DONE: `buildPostseasonTemplate` retired |
| **124** | resolved — see the audit appendix | `OverviewContext.sectionOrder` is dead and now contradicts the shipped order |
| **125** | [#667](https://github.com/znpruitt/cfb-app/issues/667) | four Overview section-ordering decisions are decided but unbuilt |
| **126** | [#688](https://github.com/znpruitt/cfb-app/issues/688) | schedule-refresh incident evidence is not durable enough to explain the failur |
| **127** | resolved — see the audit appendix | sample CFBD usage on its own schedule and retain a daily series |
| **128** | resolved — see the audit appendix | every browser poll refetches the whole team catalog it already has |
| **129** | [#710](https://github.com/znpruitt/cfb-app/issues/710) | two `usage-sample` follow-ups deferred out of PLATFORM-127 |
| **130** | [#689](https://github.com/znpruitt/cfb-app/issues/689) | narrow live-score polling to game clusters, then stand down when they finish |
| **131** | [#690](https://github.com/znpruitt/cfb-app/issues/690) | game-stats polls 21 hours per game for data nothing reads live |
| **132** | [#691](https://github.com/znpruitt/cfb-app/issues/691) | the Scores and Game stats health rows read the wrong record |
| **133** | [#711](https://github.com/znpruitt/cfb-app/issues/711) | `zinc-500` at small type fails the contrast floor, repo-wide |
| **134** | [#678](https://github.com/znpruitt/cfb-app/issues/678) | Overview three-column tier |
| **136** | [#712](https://github.com/znpruitt/cfb-app/issues/712) | Matchups slate aggregates double-count a self game |
| **137** | [#696](https://github.com/znpruitt/cfb-app/issues/696) | RESOLVED 2026-09-11 (PR #742, `a8593d9f`) — the time bombs are fixed, `main` is green, and `test:clock-shift` detects the class |
| **138** | [#713](https://github.com/znpruitt/cfb-app/issues/713) | `isOwnerVsOwner` counts `NoClaim` as a real owner |
| **139** | resolved — see the audit appendix | a final can show a pre-game record; reconcile records against completed games |
| **140** | [#692](https://github.com/znpruitt/cfb-app/issues/692) | RESOLVED 2026-09-11 — the stamp ships (PR #743, `65cf8fb3`); the DISTRIBUTION needs live weekends before the tail moves |
| **141** | [#714](https://github.com/znpruitt/cfb-app/issues/714) | the Insights page does a full-season build on every request |
| **142** | [#679](https://github.com/znpruitt/cfb-app/issues/679) | Matchups prints kickoff metadata on rows `DESIGN.md` says must not carry it |
| **143** | resolved — see the audit appendix | DONE: Matchups status-row seams and shared kickoff state |
| **144** | resolved — see the audit appendix | reconcile the Item 87 design-document set before the presentation follow-on |
| **145** | [#697](https://github.com/znpruitt/cfb-app/issues/697) | the upstream debug logger writes provider URLs and headers to the server log |
| **146** | [#698](https://github.com/znpruitt/cfb-app/issues/698) | the secret scan covers the receipt; a run writes seven durable keys |
| **147** | resolved — see the audit appendix | DONE: the schedule cron's response-body keys are pinned |
| **148** | [#680](https://github.com/znpruitt/cfb-app/issues/680) | only Overview can render `awaiting`; Schedule and Matchups cannot |
| **149** | resolved — see the audit appendix | 56% of the schedule is D-II/D-III games nothing displays |
| **150** | [#659](https://github.com/znpruitt/cfb-app/issues/659) | stop ingesting D-II/D-III: schedule fetch filter and records prune |
| **151** | [#660](https://github.com/znpruitt/cfb-app/issues/660) | `buildCfbdGamesUrl`'s `division` parameter is inert; CFBD ignores it |
| **152** | [#681](https://github.com/znpruitt/cfb-app/issues/681) | the Schedule three-column breakpoint reproduces nowhere |
| **153** | resolved — see the audit appendix | DONE: three surfaces, three eyebrow treatments, and one was the blue violation |
| **154** | [#682](https://github.com/znpruitt/cfb-app/issues/682) | postseason round grouping is specified in three documents and has no item |
| **155** | resolved — see the audit appendix | the Matchups scheduled row: records as the anchor, and the dead footer |
| **156** | [#683](https://github.com/znpruitt/cfb-app/issues/683) | Schedule is the last surface with records not wired |
| **157** | resolved — see the audit appendix | DONE: two tag vocabularies said the same thing in two voices |
| **158** | [#668](https://github.com/znpruitt/cfb-app/issues/668) | Overview renders two chip shapes in the same slot |
| **159** | [#699](https://github.com/znpruitt/cfb-app/issues/699) | `tailwind.config.ts` is never loaded, and states the opposite of what ships |
| **160** | [#669](https://github.com/znpruitt/cfb-app/issues/669) | Overview never received the shared-row decisions |
| **161** | [#670](https://github.com/znpruitt/cfb-app/issues/670) | record the surfaces a shared-row decision governs |
| **162** | resolved — see the audit appendix | DONE: `Contender Watch` was owner standing rendered as a chip |
| **163** | resolved — see the audit appendix | DONE: the `vs <owner>` pill repeated a name already on the row |
| **164** | [#684](https://github.com/znpruitt/cfb-app/issues/684) | the owner tint bleeds 8px into padding the block does not have |
| **165** | resolved — see the audit appendix | the tag cap: three sources, three answers |
| **166** | resolved — see the audit appendix | CLOSED, ALREADY SATISFIED. The cap ships, in the selector, with the test |
| **167** | resolved — see the audit appendix | audit Overview's other sections against the row reference |
| **168** | [#715](https://github.com/znpruitt/cfb-app/issues/715) | Matchups renders no odds, and the mockup says scheduled rows carry them |
| **169** | [#716](https://github.com/znpruitt/cfb-app/issues/716) | RESOLVED 2026-09-13 by PR #763 (`1d0cc3f8`) — closed as a CONSEQUENCE of centralizing `Close` eligibility for Item 173b, not by a targeted fix. Scheduled and unknown packs are never eligible, so the watchlist's `0-0` path is gone |
| **170** | resolved — see the audit appendix | CLOSED, NOT A DEFECT. The tertiary element clipping first is the hierarchy wor |
| **171** | [#685](https://github.com/znpruitt/cfb-app/issues/685) | a dead scoring term in the watchlist sort |
| **172** | [#661](https://github.com/znpruitt/cfb-app/issues/661) | the code describes a provider vocabulary the provider has never used |
| **173** | [#671](https://github.com/znpruitt/cfb-app/issues/671) | RESOLVED 2026-09-13 — MERGED `1d0cc3f8` (PR #763). 173a shipped Featured (PR #588); 173b shipped Live and Recent finals with `Close` eligibility centralized across all four Overview consumers |
| **174** | resolved — see the audit appendix | DONE: Live rows render no broadcast |
| **175** | resolved — see the audit appendix | DONE: two tag treatments in one slot, and the code cites the wrong row |
| **176** | resolved — see the audit appendix | DONE: the Featured section renders empty instead of hiding |
| **177** | resolved — see the audit appendix | Featured's postseason ordering is the exact reverse of the rule |
| **178** | resolved — see the audit appendix | DONE: the 17px section-header exception was decided, marked landed, and never  |
| **179** | resolved — see the audit appendix | DONE: the awaiting anchor renders the contract's en dash |
| **180** | resolved — see the audit appendix | DONE: the `Streaming ·` prefix, agreed and never filed |
| **181** | [#672](https://github.com/znpruitt/cfb-app/issues/672) | AUDIT RUN 2026-09-11 — ten residue issues filed (#715, #722-#726, #728-#731; #727 shipped). The issue's own triage verdict still reads *audit not run* and is stale |
| **182** | [#717](https://github.com/znpruitt/cfb-app/issues/717) | two unreachable empty branches on Overview |
| **183** | [#700](https://github.com/znpruitt/cfb-app/issues/700) | a vacuous assertion on the Schedule streaming test |
| **184** | [#701](https://github.com/znpruitt/cfb-app/issues/701) | a failing assertion can present as a file-level timeout with no subtest output |
| **185** | [#702](https://github.com/znpruitt/cfb-app/issues/702) | two web fonts are downloaded on every page and neither is used |
| **186** | [#718](https://github.com/znpruitt/cfb-app/issues/718) | the watchlist reason row has no overflow valve |
| **187** | [#673](https://github.com/znpruitt/cfb-app/issues/673) | the third chip is uncounted |
| **188** | [#662](https://github.com/znpruitt/cfb-app/issues/662) | RESOLVED 2026-09-13 — merged `57fdbd82` (PR #762), 14 of 15 call sites. **The ODDS body read is deliberately NOT covered** — pulled under a pre-committed stopping rule after four findings in one seam across three rounds, and owned by [#759](https://github.com/znpruitt/cfb-app/issues/759) with the model that took those rounds to find |
| **189** | resolved — see the audit appendix | an unreadable planner settings store reports itself as an operator pause |
| **190** | [#693](https://github.com/znpruitt/cfb-app/issues/693) | a failed standings invalidation can leave results stale indefinitely |
| **191** | [#663](https://github.com/znpruitt/cfb-app/issues/663) | targeted schedule repairs never converge on the whole-season snapshot |
| **192** | [#703](https://github.com/znpruitt/cfb-app/issues/703) | the operator env file carries a production write credential |
| **193** | [#694](https://github.com/znpruitt/cfb-app/issues/694) | the merge repairs modelled categories and never raw-only ones |
| **194** | [#664](https://github.com/znpruitt/cfb-app/issues/664) | `provider-refresh-status` is false after an out-of-band partition write |
| **195** | [#704](https://github.com/znpruitt/cfb-app/issues/704) | the Featured badge-label assertion does not prove containment |
| **196** | [#665](https://github.com/znpruitt/cfb-app/issues/665) | 96 of 97 game-stat partitions are legacy schema |
| **197** | [#695](https://github.com/znpruitt/cfb-app/issues/695) | reconciliation has no durable diagnostic beyond the scheduler receipt |
| **199** | resolved — see the audit appendix | the team catalog has zero alternate colours, and the field name is the likely  |
| **200** | [#705](https://github.com/znpruitt/cfb-app/issues/705) | AGENTS.md has binding rules in lines nobody can read |
| **201** | [#614](https://github.com/znpruitt/cfb-app/issues/614) | the seed catalog carries no colours at all |
| **202** | [#615](https://github.com/znpruitt/cfb-app/issues/615) | `src/types/teams.ts` is a dead duplicate that has drifted |
| **203** | [#616](https://github.com/znpruitt/cfb-app/issues/616) | `CfbdTeamRecord` and `/teams/fbs` disagree in both directions |
| **204** | resolved — see the audit appendix | an empty CFBD response wipes the team catalog, and the seed cannot rescue it |
| **205** | [#617](https://github.com/znpruitt/cfb-app/issues/617) | the durable catalog is read through an untyped `Record` |
| **206** | [#618](https://github.com/znpruitt/cfb-app/issues/618) | a refused catalog sync leaves no durable record |
| **207** | resolved — see the audit appendix | the polling-planner suite flakes on `plan-held`, and `reset()` is not holding |
| **208** | [#619](https://github.com/znpruitt/cfb-app/issues/619) | an unreadable settings record reports the one result alerting ignores |
| **209** | [#620](https://github.com/znpruitt/cfb-app/issues/620) | the test store leaks a file per process, forever |
| **210** | resolved — see the audit appendix | `npm test` can DROP PRODUCTION `app_state`, and the only guard is nobody expor |
| **211** | [#621](https://github.com/znpruitt/cfb-app/issues/621) | three more destructive test seams with the same hole |

### Item 119 — team-colour bar on the shared scoreboard, and no accent for teams with no colour

**RETIRED 2026-09-10 — replaced by logos, not completed.** PR #719 (`3c000300`) ships **28px team
logos** at the line start and documents them as the permanent treatment. **The colour bar never
shipped**, and `src/lib/teamColors.ts` is back to zero production consumers — the state it was in
before this item, now for the second time.

**What this invalidates elsewhere:** any width budget reasoned against an 8px bar. The line-start
element is **20px wider** than planned, which is flagged on
[#678](https://github.com/znpruitt/cfb-app/issues/678) and
[#681](https://github.com/znpruitt/cfb-app/issues/681).

### Insights sequencing note (former item 44)

The current coarse order is: finish truth/gating and decide the INSIGHTS-033 rebuild; then build the
INSIGHTS-026 pulse with INSIGHTS-020 as one event source; then consider new preseason generators,
ranker/decay, History Phase 3, and Slow Draft Mode. Commissioner onboarding remains conditional on
the multi-tenant gates above.

## Polish, engineering-health, and conditional observations

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

- **Overview Live / Recent-finals phone tag fit ([#758](https://github.com/znpruitt/cfb-app/issues/758)).** Their fact pills use the fixed status-row edge.
  The existing `max-sm:` wrapping relief is gated on scheduled state and therefore belongs to
  scheduled Matchups/Schedule rows, not Featured or these Live/Final rows. Decide whether Live/Final
  needs its own relief; PLATFORM-671 deliberately makes no phone-width style change.
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

### Item 198 — a colour that fails normalisation is indistinguishable from no colour

**RETIRED 2026-09-10 with Item 119.** The band, the remap and the outline prototype are all
moot — logos replaced the colour treatment entirely. **The measurements are not wasted and should
not be re-derived:** `item-87-reference-game-row.md` records that only 31 of 135 bars cleared 3:1
composited, that a clamp collapses a population mostly below its floor, and that four distinct reds
rendered identically. **That evidence is why logos won**, and it is the reason not to revisit a
colour accent without new information.

### Queue migration to GitHub Issues — NEW WORK IS FILED THERE FROM 2026-09-10

**OWNER DECISION 2026-09-10: NEW WORK ITEMS ARE FILED AS GITHUB ISSUES, NOT HERE.**

**What this file is now canonical for:** the **dispatch order** — what is next and why — plus
cross-item rulings, the known-failure baseline, and campaign notes. **It is no longer where an item's
ask, state or evidence lives.**

**A PR that closes an issue says `Closes #N` in its body.** That state transition is the single
bookkeeping step that has failed by hand more than once in this campaign, and automating it is the
main reason the switch is worth making.

**THE QUEUE MIGRATION IS FINISHED.** **Item 87** remains because it is the active campaign and
campaign status is what this file stays canonical for. Item 198 remains only as a retired historical
record of the prototype that led to the permanent logo decision.

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

### Logos as the identity accent — DECIDED 2026-09-10, implementation ready to merge

**Owner decision:** a 28px CFBD logo permanently replaces the colour bar on shared scoreboard rows.
The 14/18/20/22/24/28px treatments were viewed on mobile and desktop; 28px was the first size that
read clearly on both without dominating the row. Items 119 and 198 and the temporary colour/outline
prototypes are retired.

- **Production FBS coverage is 138/138** from the durable catalog's 64px dark-surface assets. The
  checked-in seed deliberately has no logo arrays; in seed-backed local and verify runs, retained
  schedule provider IDs construct the same guarded CDN family instead.
- **FCS coverage is 126/128 in the provider catalog and 100/100 among opponents on the measured live
  slate.** Retaining provider IDs through schedule construction supplies those logos without widening
  the FBS-only catalog.
- **Catalog state is explicit:** valid dark-64px artwork wins; populated artwork that fails the
  dark/size/host gate blocks fallback; empty or absent artwork permits the schedule provider-ID
  fallback. Missing or failed artwork leaves the reserved slot empty — there is no colour substitute.
- **The row uses the 64px source at 28px rendered size** and reserves a 32px line-start slot plus a
  32px minimum row height whether artwork exists or not.
- **The runtime image gate is `teamLogos.ts`.** Its protocol, host, path-family, and size checks are
  load-bearing. `next/image` is unoptimized for these provider assets, so `remotePatterns` is
  defense-in-depth rather than the enforcing gate; no image CSP is configured.
- **Schedule day boundaries gain a 2px full-width rule.** It explains deliberate empty cells in the
  two-column grid without changing date grouping or game order.

**Why logos are more robust here than colours, and it is not a preference.** A logo carries its own
internal contrast. Army's mark is a black shield — invisible as a solid bar — but the gold helmet and
white outline inside it still read on `#0a0a0a`. **A dark solid bar has no interior; a dark logo does.**
That is why this direction sidesteps the remap/outline problem rather than inheriting it.

**Serving the provider's CDN marks is an explicit owner choice.** The feature does not add a refresh
job or provider call: logo metadata refreshes with the existing team-database sync, while browsers
fetch immutable-sized artwork from CFBD's CDN.
