# Next Tasks (Active Queue)

Status: Current
Last verified: 2026-09-05
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
`NEXT`: **Item 87 slice 5a** — shared scoreboard contract widening. **Review converged and pre-merge
closeout is complete on `platform/087-slice-5a-scoreboard-contract-v2`** (2026-09-05); not yet merged.
The kickoff is `docs/prompts/platform-087-slice-5a-scoreboard-contract-v2.md`.

- **v1 was STOPPED, not merged.** `platform/087-slice-5a-scoreboard-contract` reached `b80004c9`
  after two remediation rounds without converging; per `AGENTS.md` → Review and remediation limits it
  was abandoned rather than patched a third time. It is retained for reference only, has no PR, and
  must not merge. Both rounds' findings were carried into the v2 prompt as specification.
- **v2** rebuilt from `main` as a single commit. Both reviewers gathered against `c8562d57`; seven
  findings were accepted — one production-behavior family (optional-slot presence semantics) and six
  proof-surface defects. The first cohesive remediation landed at `254ff171`.
- **Second remediation round — owner exception granted 2026-09-05.** Both confirming reviewers
  agreed on one remaining production defect: `hasRenderableContent` does not recurse into
  `React.Fragment` children, so an empty fragment renders an empty context/tier-2 wrapper. Only that
  defect was caused by the first round; the three coverage gaps predate it and `AGENTS.md:313` would
  class them as follow-ups. **The owner granted an exception drawn at production-vs-test:** fragment
  recursion is the ONLY production change, and everything else in the round is test-only. Rationale —
  these are gaps in a contract **five serial slices inherit** (slice 5 + 112 → 117 → 115 → 119 →
  118), so a follow-up item would have to land before slice 5 to be worth anything, making it a
  blocker rather than a follow-up.
  The exception landed at `afbc81c5`; both confirming reviewers converged on that commit with no
  credible in-scope P2 remaining.
- **Seam audit (2026-09-05), for the five inheriting slices — do not re-derive.** The shared fact is
  "does this slot have renderable content". Writers today are `OverviewPanel` only: `contextSlot`
  `:772` (an unconditional `<div>`, always present), `contextSlot` `:858`
  (`gameBadge ? <span/> : undefined`), and `footerSlot` `:809` (`string | null`, which the footer
  renders directly and the predicate never sees). **`tier2Slot` has no writer at all** — so the
  fragment defect is unreachable in production today and becomes routine the moment slice 5 fills
  that slot. **`OverviewPanel:772` deliberately reserves 22px** (`min-h-[22px]` plus `aria-hidden`)
  by always rendering its wrapper; passing `undefined` there when empty would silently drop that
  reservation, and no test covers it. The recursion boundary is principled: fragments and arrays are
  static structure, inspectable without evaluation, while a component returning `null` would have to
  be rendered to know — which is unsafe and hook-incompatible. Do not cross it.
- **Tier-2 reserves nothing.** Settled 2026-09-05: it is optional, variable-height expansion content,
  an empty wrapper would reserve only margin, and it cannot align against real content anyway. The
  unconditional odds band aligns tier-1. Expansion alignment belongs to the consuming slice.
- **Known limitation:** provider classifications are absent from 2018–2024 data, so the FCS marker
  is inert on every historical season in that range. It renders only where current-season rows carry
  classification; this is expected data coverage, not a broken marker. The widened anatomy and this
  limitation are recorded in the required pre-merge closeout without claiming the branch is merged.

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
3. **Item 87 slice 5a** — `CompactGameScoreboard` contract widening: classification marker in the
   prefix slot (rank | FCS | empty, mutually exclusive by `rankings.ts` exact-match), neutral-site
   marker, broadcast on live rows (`CompactGameScoreboard.tsx:16-19` is scheduled-only today), and a
   tier-2 expansion slot. **Split from slice 5 by owner decision 2026-09-03** so that slice 5, Item
   117 and Item 119 build on one reviewed component change instead of each re-deriving it. Overview
   must render identically before and after — prove it by mutation, not by inspection.
   **Design (canonical, read before writing the prompt):** `docs/campaigns/item-87-followon-matchups-schedule-design.md`
   §1 (prefix slot) and §on neutral site; `docs/campaigns/item-87-live-watchlist-scoreboard.md`;
   `mockups/live-scoreboard-mockup.html`, `mockups/matchups-schedule-mockup.html`.
4. **Item 87 slice 5 + Item 112** — Schedule adopts the scoreboard row with no one-line collapse and
   tier-2 behind "More" (which _is_ Item 112's disclosure model, landing on Schedule first); kickoff
   sort; deletes `GameWeekPanel`'s collapse and `cardEmphasisClasses`. Carries the
   `ownerOutcomeRowClasses` sibling asymmetry into `MatchupsWeekPanel`. **Owner decision needed
   before build:** the amber `upset` border (`GameWeekPanel.tsx:42`) is a reserved-colour violation
   the base addendum explicitly exempted; confirm it dies with the card chrome.
   **Design:** `docs/campaigns/item-87-followon-matchups-schedule-design.md`;
   `docs/campaigns/item-87-followon-section-ordering.md` (the relative label is unbuilt and
   constrains this slice); `mockups/matchups-schedule-mockup.html`.
5. **Item 117** — Matchups adopts the shared scoreboard. User-facing and a correctness fix (the
   shipped row never says which team is which owner). Needs the card-owner-treatment decision.
   **Design:** `docs/campaigns/item-87-followon-matchups-schedule-design.md`;
   `docs/campaigns/item-87-live-watchlist-scoreboard.md`; `mockups/matchups-schedule-mockup.html`.
6. **Item 115** — Overview section expansion. Recent finals is documented as complete and truncates
   at six today; this reuses the disclosure pattern slice 5 settles rather than inventing one.
   **Design:** `docs/campaigns/item-87-followon-section-ordering-resolutions.md` §5 (counts, which
   that document explicitly defers to this item); `docs/campaigns/item-87-followon-section-ordering.md`.
7. **Item 119** — team-colour bar on the existing normaliser, with no accent for teams that have no
   colour — which also removes the green fallback every FCS row carries today. OKLCH only if measured.
   **Design:** `docs/campaigns/item-87-followon-team-colour.md`;
   `docs/campaigns/item-87-live-watchlist-scoreboard.md`.
8. **Item 118** — Schedule status filter with counts. Purely additive; after the rework it filters.
   **Design:** none written. Item 112 likewise has no campaign doc — both are described only here,
   so a prompt for either needs an owner design pass FIRST, not a paraphrase of this entry.
9. **Item 100b** — internal slate marker. Date gate removed 2026-09-03; its 2026 consequence
    (Featured empty through 2026-09-07) closes on its own, but the recap and look-ahead targeting it
    exists for recur next August. Cheap: the clustering code is recoverable from `d6184c28`.
10. **Item 113** — Featured as insight-selected, state-agnostic. Largest, and gated on a decision
    about `INSIGHTS-017-PALETTE` (a prose bullet today, not an item).
    **Design:** `docs/campaigns/item-87-followon-featured-intent.md` — it supplies the product
    intent and states that THIS item owns the reconciliation. Do not re-derive what it settles.
11. **Item 101** — season-boundary finals gap. Re-derive the empty window against the floating cutoff
    first; fix before late November.

**Interstitial, no dedicated slot:** **Item 111** (~5-minute Observability check, any time this
week). **Item 108** is CLOSED — verified 2026-09-04, live scores do tick for FBS-vs-FCS games.

**Postseason, before December:** **Item 121** (CFP first-round `eventKey` collision — dormant until
the 2026 first round is ingested, then live on the surface it breaks). Measured while verifying
Item 87's postseason grouping input; it does not block that work. **Item 120** closed at its scoping
gate, no action. **Item 122** (the historical-cache button cannot re-cache) and **Item 123**
(retire the dead postseason template) are both undated; 123 is small and adjacent to 121.

**Overview ordering:** **Item 125** portions 1 and 2 are DONE — POLISH-023, merged via PR #563
(`1546bbc8`). What remains under that item is portion 2's repo-wide half: Matchups
(`MatchupsWeekPanel.tsx`) and Schedule (`gameCardPresentation.ts:125`) still print a kickoff on final
rows, which the shipped rule forbids. Small and user-facing. **Item 124** (retire the dead `sectionOrder`) is
DONE — POLISH-024, merged via PR #564 (`cac6dab9`).

**Decisions parked, with the item that consumes each:** amber `upset` border → slice 5;
normalisation target `#0A0A0A` vs `#161616` → Item 119; card-owner treatment → Item 117.

**Parallel tracks (added 2026-09-04).** File surfaces verified, not inferred. The server track and
the UI spine do not touch each other, so they can run concurrently:

- **Server track, strictly serial with itself:** Item 102 + 88, then Item 126. All three converge on
  `schedulerExecutionStatus.ts` / `schedulerDeliveryHealth.ts` / `systemHealthIssues.ts`.
- **UI spine, strictly serial with itself:** slice 5a → slice 5 + 112 → 117 → 115 → 119 → 118. Every
  one consumes the component 5a widens; that is what the split was for.
- **Independent, parallel-safe against both:** Item 122 (`admin/HistoricalCachePanel.tsx`), Item 121
  (`schedule/cfbdSchedule.ts`, `schedule.ts`, `schedulePostseasonHelpers.ts` — pipeline, not
  components), and Items 84, 86, 111. **Item 123 shipped 2026-09-04** via PR #565.
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

PLATFORM-110 makes delete-and-recreate reschedules observable after a successful full-season
refresh, but it does not change schedule cadence. A cached game therefore stays in its old canonical
week until schedule maintenance observes the provider's replacement record. Design a targeted
schedule refresh or a quota-measured in-season cadence ramp. Preserve vanished-id logging for delete
and recreate; do not log ordinary same-id kickoff/team/venue rewrites.

Do not try to repair the abandonment clock in `buildScoreboardScorePack`. `PendingGame.kickoff`
comes from the canonical `AppGame`, and the attached score deliberately carries no provider
`startDate`, so preserving that field in a score pack cannot reach `hasGameBeenAbandoned`. Same-id
kickoff changes already self-correct when `refreshFullSeasonSchedule` updates the canonical
schedule; the remaining exposure is the interval before that refresh and the replacement-id case.

CFBD exposes no richer cancellation/postponement status through the football games API. The provider
developer confirmed that a postponed/rescheduled game is normally deleted and recreated with a new
id, so identity disappearance plus the replacement schedule record is the available evidence.

**Second driver: score-repair latency.** Do not size this as reschedule reconciliation alone. Live
score polling arms on a window anchored to CANONICAL kickoff —
`POLLING_WINDOW_BEFORE_KICKOFF_MS` 15 minutes, `POLLING_WINDOW_AFTER_KICKOFF_MS` 24 hours
(`src/lib/liveScores/pollingTarget.ts`). A delete-and-recreate reschedule defeats both ends of that:
the retired id arms around a kickoff that never happens, and the replacement id is absent from
canonical, so it is never armed at all. Neither game gets a score until the weekly schedule refresh
observes the replacement, and the PLATFORM-107 final-score sweeper — which rides that same weekly
cron, `0 12 * * 2` — then fills it.

The 24-hour polling tail means an ordinary game has ample opportunity to be caught live, so a
rescheduled game is plausibly the dominant cause of a final arriving days late rather than minutes
late. Schedule cadence is therefore the main lever on score-repair latency, not only on week
placement. This matters to the weekly recap, whose Overview window opens 06:00 ET the day after a
slate and closes Thursday 06:00 ET: a Tuesday sweeper repair lands inside that window, so records,
points, movement, and accolades can shift under a reader who already saw them.

Frequency is UNMEASURED. PLATFORM-112's game-level score-gap diagnostics and PLATFORM-113's
elapsed-time conclusion diagnostics are the instruments. **Both are promoted as of 2026-08-30** — the
earlier "unpromoted" note is stale — so the measurement gate is open, but no rate exists yet: System
Health reported no score-gap issues through the opening week, which is a thin sample rather than a
finding. Measure before choosing a cadence — the quota cost of a ramp should be justified by an
observed repair rate, not by this mechanism's existence. The trigger for revisiting is accumulated
observation, not promotion.

**Third driver, 2026-09-01: the app holds provider-deleted records for up to three days.** The
Overview section router bounds a scoreless post-kickoff game at **8 hours**
(`hasGameBeenAbandoned`, `standingsHistory.ts:194`). The refresh that removes a record CFBD has
deleted is **weekly** — `turfwar-schedule-weekly`, Tuesdays 12:00 UTC. A Saturday postponement
therefore leaves the app holding a deleted row until Tuesday. POLISH-019's abandonment split stops it
appearing in Live after 8 hours, but week tabs, standings history and matchups still carry the stale
row until the refresh. **That 8-hour-versus-weekly gap is the specific window a cadence ramp would
close**, and it is the sizing argument to bring to the measurement.

**The provider has confirmed there is no alternative to polling.** Asked directly whether any
endpoint or field identifies a canceled or postponed game, the CFBD developer answered:

> Yes, that understanding is correct with regards to statuses. When a game is postponed or
> re-scheduled, there typically is a brand new game record with a new id and the old game record is
> deleted. The football API and infra isn't really built to handle postponed or canceled records at
> this time.

Independently verified: `/games` exposes `completed` only, `/scoreboard` reports just
`scheduled | in_progress | completed`, and all 3,676 rows in the 2026 schedule cache carry one
distinct status, `'scheduled'`. **There is no flag to watch for and no prospect of one**, so schedule
polling is the sole detection mechanism rather than one option among several. That converts this
item's premise from an inference into a provider statement.

**Latent defensive disruption seam, recorded by POLISH-019.** Legacy/defensive disruption labels
are unreachable on the current CFBD-only production path, but three behaviors should be considered
together if a future provider or repair path makes them reachable: the Overview router checks the
label before excluding unresolved bracket shells; the shared pending-game authority deliberately
sets a disrupted game's kickoff to `null`, so the abandonment clock does not expire it; and the
Overview watchlist presents the exact disruption label with the scheduled tone. Do not build a
parallel disruption lifecycle around these dormant branches. Resolve them with the vanished-id /
replacement-id policy here if Item 63 introduces reachable disruption evidence.

- Backlog slug: `PLATFORM-RESCHEDULE-DETECTION-v1`

### Item 64 — remaining week-resolution residue

Only one PLATFORM-105 follow-up remains:

- **(c) Abandonment is not applied to week resolution.** `selectSeasonContext` can accept an old
  pending game as abandoned, while `isResolvedWeek` still leaves that week unplayed forever. Apply
  the shared conclusion policy consistently so historical trends do not drop the affected week.

**Four consumers now, updated 2026-09-01.** The shared policy is `hasGameBeenAbandoned`
(`standingsHistory.ts:194`, `now - kickoff > 8h`):

| Consumer | Applies it? |
| --- | --- |
| `selectSeasonContext` | yes |
| `selectWeeklyRecapFacts` | yes, via `selectPendingGameFinality` (`weeklyRecapFacts.ts:458`) |
| `isResolvedWeek` | **no — this item's remaining gap** |
| Overview section router | added by POLISH-019 (slice 3) |

**Per-game versus population is an INTENTIONAL split, not part of the inconsistency this item fixes.**
`selectPendingGameFinality` is deliberately all-or-nothing across its input population — one
abandoned game beside a genuinely not-yet-played sibling yields no accepted conclusion — which is
correct for "can this week be treated as concluded?" The Overview router asks a different question,
"where does THIS row go", so it calls `hasGameBeenAbandoned` per game and must NOT use the population
rule; doing so would keep a stale game in Live merely because a sibling had not kicked off. Do not
"harmonise" these two call shapes when closing this item.

The prior `(a)`, `(b)`, `(d)`, and `(e)` work is complete and recorded in
`docs/completed-work.md`; do not requeue those slices.

- Backlog slug: `PLATFORM-WEEK-RESOLUTION-RESIDUE-v1`

### Item 68 — archive integrity with incomplete cumulative coverage

Audit the case where rollover reaches a season containing an unresolved score-required owned game.
Choose and test one explicit policy: defer archive publication, publish a marked repairable archive,
or provide a deterministic rebuild path. Keep this separate from live reconciliation because it
changes a different automation job and durable historical contract.

- Backlog slug: `PLATFORM-ARCHIVE-COVERAGE-INTEGRITY-v1`

### Item 76 — team-catalog freshness has no read-only surface

The durable catalog stores `updatedAt`, but `/api/teams` drops it and the admin catalog route exposes
only a mutating `POST`. The current timestamp therefore cannot be learned without spending a
provider call and changing durable state. Expose `updatedAt` and source either in `/api/teams` meta
or through an admin-gated `GET`; keep the sync control on Data Maintenance.

This is related to, but smaller than, the planned team-catalog source-unification campaign.

- Backlog slug: `PLATFORM-CATALOG-FRESHNESS-READ-v1`

### Item 55 — schedule load errors lose the information required for retry

`loadScheduleFromApi` collapses schedule, team-catalog, conference, cold-cache, and malformed-cache
failures into one string. A member retry can repair a transient read failure but cannot repair a
public `503` requiring an authorized refresh or an invalid cached row. Preserve a structured error
kind at the loader boundary before adding retry UI.

### Item 60 — rankings recovery remains incomplete

Future poll normalization is corrected and the current 2026 snapshot was refreshed, but two
operator decisions remain:

- whether historical seasons should be re-fetched where the archived Coaches column may contain a
  lower-division poll, with the associated CFBD cost;
- whether to build a guarded force path for a legitimate rankings replacement that the
  all-or-nothing coverage gate refuses after a poll rename or removed week.

Also retain these low-severity implementation follow-ups when the authority is next touched:
deduplicate unknown-poll warnings across the whole two-partition refresh, and validate `poll.poll`
before trimming it so malformed provider data is classified rather than thrown as an unexpected
programming error.

### Item 79 — vanished-schedule observability follow-ups are evidence-gated

Production behavior is accepted. Make no change unless real log triage demonstrates value:

- add `baselineSource: 'aggregate' | 'partitions'` only if operators need to distinguish the prior
  snapshot source;
- add a path-matched aggregate-write race test before changing aggregate precedence;
- correct the pre-existing changed-data fixture comment when that test is next edited—it covers a
  same-id content rewrite, not numeric-id replacement.

- Backlog slug: `PLATFORM-SCHEDULE-VANISH-OBSERVABILITY-FOLLOWUPS-v1`

### Item 81 — score-gap diagnostic follow-ups are evidence-gated

PLATFORM-112's production behavior and current single-producer boundary are accepted. Preserve
these confirming-review observations without putting them into the active sequence:

- independently cap `SafeDiagnostic.gameRefs` at the System Health presentation boundary if a
  second producer is added; the current producer already caps it at six;
- measure the diagnostics pass against its eight-second bound before deduplicating the canonical
  schedule builds used by score and game-stats coverage;
- change the shared fail-closed conclusion precedence only if real CFBD evidence shows a canceled
  game with `completed: true`; today that contradictory combination deliberately requires a score.

- Backlog slug: `PLATFORM-SCORE-GAP-DIAGNOSTIC-FOLLOWUPS-v1`

### Item 95 — remaining live-score cadence work

Portion 1 shipped via PR #567; its implementation and review record is in
`PLATFORM-BROWSER-POLL-CADENCE-v2` in `docs/prompt-registry.md`. The settled baseline for the open
work is a cache-only, full-partition browser read every 90 seconds inside the bounded fast tier and
every 180 seconds otherwise, with the provider writer unchanged at three minutes.

**Post-merge observation — measure `/api/scores?live=1` Active CPU during a live slate.** Each browser
read still invokes the dynamic route and durable full-season reconciliation. If its attribution is
material, memoize that reconcile; the optimization helps both cadence tiers and does not change what
scores are read.

**Remaining follow-up — retune the client staleness threshold.**
`DEFAULT_LIVE_DELTA_STALE_THRESHOLD_MS` (`selectors/liveDelta.ts`) remains 7 minutes. It detects a
wedged client poll rather than stale provider data, so changing it is a product decision: reduce it
to roughly four minutes to restore a two-missed-tick bound, or keep seven minutes as an intentional
wall-clock allowance. Portion 1 deliberately changes only its docblock, not the value.

**Portion 2 — cron cadence, gated on Item 94.** Because the route bills at most one request per run,
the cost is exactly linear:

    monthly calls = armed hours x runs/hour x 1      (20/hr at 3 min; 40/hr at 90s)

So the price of doubling equals the month's armed-hour count — a number nobody has yet.
**Item 94 produces it.** Do not size this from an estimate; the whole point of 94 is that August's
395 calls covers ~2 in-season days and is not a usable baseline.

Portion 2 remains separate because it changes the provider writer and spends quota.

**Item 102 changes what portion 2 is asking — recorded 2026-09-04.** The planner does not create quota
headroom: dead-day runs already bill zero provider calls, since the route bills only when armed. What
it creates is **Active CPU headroom** — roughly 2.9 h of the 4 h allowance, from ~1.1 h/30d projected
against a budget live-scores currently consumes 75% of. So after the planner, a faster in-window
cadence becomes affordable on the axis that previously blocked it, while its cost on the quota axis is
completely unchanged.

**Both axes now scale with the same unknown: armed hours.** Quota is `armed hours × runs/hour`, and
the added CPU is likewise proportional to how many hours the windows actually cover. So **Item 94
gates both halves of portion 2**, not just the quota half — which upgrades 94 from a passive
measurement into the input for two decisions. It bills 0 (`GET /info`) and reports after the
September reset, so the answer arrives at the start of October on its own.

**Consequence for sequencing:** let the provider cadence decision land when Item 94 reports — with
the headroom banked and quota cost measured rather than estimated. Do not size portion 2 before then;
that is the whole reason Item 94 exists.

- Backlog slug: `PLATFORM-LIVE-SCORE-CADENCE-v1`

### Item 96 — pause the in-season QStash schedules through the offseason

**The ask:** stop paying ~$19/month of Neon wall-clock during ~6 months with no games. Worth
**~$114/year with no coverage tradeoff.** Everything below is the evidence that produced it; the
open work is the _Scope to decide_ list.

**All four billing surfaces measured 2026-08-31. Exposure is one variable: how many computes are
running.**

| Surface | Monthly | Character |
| --- | --- | --- |
| **Neon compute** | $39.03 (`368.21 CU-hrs x $0.106`) | the entire bill |
| QStash | **$0.18** (18K messages @ $0.01/1,000) | noise even at 2x cadence |
| Vercel | $0 | Hobby |
| CFBD | fixed Patreon tier | 395 / 5,000 used |

Neon storage is `0.05 GB x $0.35 = $0.02`. **The attribution, once measured rather than inferred:**

| Compute | CU-hrs | Cost | Why |
| --- | --- | --- | --- |
| `main` primary (`ep-small-lake-ama2wisz`) | ~180 | ~$19 | `*/3` live-scores cron never lets the 5-minute autosuspend threshold open |
| **`cfb-audit-read-replica`** (`ep-plain-term-amtt3ekz`) | **~180** | **~$19** | **autosuspend was `never`** — ran 24/7 with ZERO connections |
| all non-`main` branches | ~5 | ~$0.6 | wake events only; each preview branch reads 0.02 CU-hrs or 0 |
| | **368** | **$39.03** | |

Both computes are at the **0.25 CU minimum** with CPU flat at ~0, a 100% cache hit rate, and a
~40 MB database. Neon bills allocated CU by wall-clock, so this is money paid for **existing**, not
for working. Nothing was straining; two instances were simply switched on.

**The ceiling is verified and hard (2026-08-31).** Both computes on the `main` branch have
autoscaling `min == max == 0.25 CU`, confirmed in the endpoint editor. They physically cannot
allocate more, whatever the load:

    2 computes x 0.25 CU x 744h x $0.106  =  $39.43/month   ABSOLUTE MAXIMUM
    August actual                         =  372.26 CU-hrs, $39.03

**August was therefore already the worst possible month.** The bill that prompted this item was the
ceiling, not a trend. No traffic spike, viral link, runaway query or bug can exceed it; the only
variable is how many hours the two computes run, which is what this item controls.

Per-branch CU confirms the attribution from a second direction: `main` is **366.81 CU-hrs** while
every preview branch reads **0.02 or 0**. And 366.81 CU-hrs at 0.25 CU is 1,467 hours, twice what a
month contains, which is only possible with two computes billing under one branch. Primary plus read
replica at ~183 each.

**FIXED 2026-08-31: the read replica's autosuspend.** Its delay was `never` while `main`'s is the
5-minute default. Setting it to 5 minutes suspended the endpoint **within seconds**, independently
proving nothing was connected. Capability kept, ~$19/month stopped.

**Keep the replica — it is a production-observability rail, not a scaling decision.** Preview is
deliberately isolated from production and can be stale (`deployment-runbook.md` §6c: no production
leagues, rosters, drafts, or caches), so questions of the form "does this behave correctly against
the REAL 2026 schedule?" cannot be answered there. The replica answers them against production data
**read-only**, so no agent or script can mutate production while doing it. Concrete payoff:
PLATFORM-105 was verified against the real **3,610-game 2026 production schedule** and roster
through it, and that replay is what exposed the season reading as over after Week 1 because unplayed
weeks were being treated as resolved.

The three endpoints therefore have distinct jobs: **primary** = the application, reads and writes;
**preview child branches** = isolated feature/UI testing; **read replica** = safe production-data
inspection. `never` is the right autosuspend for latency-sensitive production read traffic and the
wrong one here, where a sub-second cold start before a debugging query costs nothing.

**DONE 2026-08-31: plumbed in as `DATABASE_URL_RO`** in `.env.operator.local` (gitignored), direct
host rather than `-pooler`. Verified: `pg_is_in_recovery()` is `true` and an `INSERT` fails with
`cannot execute INSERT in a read-only transaction`, so the guarantee is proven, not assumed — and it
comes from the endpoint being `RO`, not from the role, which is still `neondb_owner`. Procedure is
in `deployment-runbook.md` §6c. `src/` has no reference and must not gain one: this is an
observability rail, not part of the application read path. Before this, each use was a manual
console step, which is why the compute attribution below stalled.

**STILL OPEN: `main`'s ~$19/month, and it is an offseason item.**

In-season this is the honest price of an app that has to watch live games. February through July
there are no games, and the schedules keep firing every three minutes regardless:

    ~6 offseason months x ~$19  =  ~$114/year for zero work

**No coverage tradeoff** — there is no game coverage to lose. That distinguishes it from narrowing
schedules to game windows in-season, which would trade away Tuesday MAC games and rescheduled
kickoffs and is NOT what this item asks for.

**Settled by PLATFORM-118:** `team-records` pauses with the other in-season jobs; do not exempt it
merely because the provider call is cheap. A completed season's records are immutable, so a
twelve-hour refresh buys no recovery while still waking Neon, writing leases and receipts, and
calling `/records`. Its fourteen-hour cache diagnostic assumes an **unpaused hourly job**. The pause
implementation must therefore add one generalized lifecycle-applicability rule for every dataset it
pauses and suppress the corresponding missing-delivery warnings while paused — not a records-only
exception. Resume must re-arm both delivery and freshness evaluation.

The mechanism exists: every QStash schedule has a manager (`deployment-runbook.md`), and a manual
hold is already an operation this project runs. **Scope to decide:** which schedules pause
(`rankings` and `schedule-refresh` may still be wanted); manual vs lifecycle-driven (**manual
first** — a wrong pause in-season is a live score outage and lifecycle transitions have no reverse);
and **verify `ENDPOINT INACTIVE` actually appears** afterwards, since nothing proves the crons are
the only sub-5-minute caller.

**Also done 2026-08-31: preview retention.** Vercel Pre-Production retention 2 weeks → 1 day, ~135
stale deployments removed, GitHub `delete_branch_on_merge` enabled so the whole chain is automatic.
Neon went **48 → 2 branches**, confirming that Vercel deployment retention — not Git hygiene —
reclaims them. Worth ~$0.85/month, not the ~$20 first claimed; it was worth doing to stop unbounded
growth and to fix the stale-child-branch problem (`deployment-runbook.md` §6c), not for the money.

**When would 0.25 CU stop being enough?** Recorded so a future capacity question is answered from
evidence rather than fear. Today CPU is flat at ~0 through a live game weekend, compute cache hit
rate is 100%, and the database is ~40 MB. Raising the cap would only be warranted by one of:

- **Working set exceeding RAM.** 0.25 CU is ~1 GB and `neon.max_file_cache_size` is 819 MB against a
  ~40 MB database. The signal is the **compute cache hit rate falling below ~99%** in Monitoring,
  meaning reads go to the pageserver instead of local cache. Storage would need to grow ~20x: many
  more seasons of archives, or per-play data rather than per-game.
- **Sustained concurrent query load**, not page views. The connection limit is 105 direct / 10,000
  pooled and the app is nowhere near it. This needs many members loading SIMULTANEOUSLY, which means
  a public or multi-league deployment (see the conditional-gate section), not a bigger private
  league. The signal is **CPU sustained above ~70%**, or pooler wait time rising off zero.
- **A new heavy write or analytical path**: full-season recomputation on demand, cross-season
  aggregates, or anything scanning every archive per request. PLATFORM-119 moved the closest
  existing candidate — standings recomputation at ~1.1s — to write time rather than optimising it.

**None of these is member count.** Adding owners or leagues adds rows to a 40 MB database and page
views to an idle CPU. The trigger is concurrency or data volume, and both are far away.

**Dead ends — recorded so they are not re-derived:**

- **Preview branches were NOT the driver.** First attributed ~188 CU-hrs to them by SUBTRACTION
  from `main`'s baseline. Subtraction proves only that something is not `main`. The owner's
  objection — "I thought they were all idle" — was correct, and the real answer was one dropdown
  away in the branch's **Computes** list. **Wrong by roughly 20x.**
- **The year-wide `app_state` prefix scan is NOT the driver.** `pg_stat_statements`: `key like $2`
  is 3,268 calls / 8.8s / 5,733 rows — 1.75 rows per call. The app's entire database work is
  **~85 seconds**, against **401,912 calls** of Neon's own telemetry.
- **A sentinel gate on that scan would save nothing.** The query costs 2.7ms, and a cheaper query
  cannot create an idle gap. Only the absence of queries can.
- **Cadence is not a Neon cost.** Doubling live-scores adds ~$0.18 of QStash and $0 of Neon, since
  the endpoint is already awake. The only cadence cost is CFBD armed runs (Item 95 portion 2).
- **`52.96 GB` transfer against `0.05 GB` storage** is unexplained by app queries. Not pursued.

**The method lesson:** every wrong answer here came from fitting arithmetic to a story. The right
answers all came from a console page or `pg_stat_statements`. Check the **Computes** list per branch
before attributing compute cost to anything.

**Item 102 subsumes the manual half.** A schedule-derived polling planner pauses these schedules
through the offseason without an operator, and is driven by a Vercel Active CPU finding rather than a
Neon one. Keep this item for the read-replica autosuspend and the non-cadence findings.

- Backlog slug: `PLATFORM-OFFSEASON-SCHEDULE-PAUSE-v1`

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

| Loss layer | Actually scoped to |
| --- | --- |
| 1. Per-unit `result`/`reason` dropped from the target | **schedule-refresh AND rankings.** Both carry `years: Array<{ year, operation }>` and drop the rest. The single-target jobs (`live-scores`, `game-stats`, `odds`, `team-records`) have one unit per run, so the run-level `result`/`reason` covers them — but their targets record only what was ATTEMPTED (`targetGames`, `eligibleGames`, `week`), never an outcome. |
| 2. Runtime event lacks `invocationId` | **All seven.** There are seven separate `cronExecutionLog` modules (`schedule`, `rankings`, `odds`, `liveScores`, `gameStats`, `teamRecords`, `lifecycle`) and `invocationId` appears in none of them. The receipt carries it (`schedulerExecutionStatus.ts:289`); the event does not, so no job's runtime log can be correlated with its durable receipt. |
| 3. `provider-refresh-status` is latest-only | **Universal.** One shared store keyed by dataset scope. A successful manual repair replaces the failed attempt for any dataset, not just schedule. |
| 4. Upstream class collapsed to `fetch-failed` | **schedule AND rankings**, identically: `schedule/fullSeasonScheduleFetch.ts:67` and `rankings/refreshAuthority.ts:111`. Both discard timeout vs network vs HTTP-status vs parse. |

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

| Phase | Window | Rate |
| --- | --- | --- |
| Dense | `first kickoff − 15m` → `last kickoff + 8h` | every 3 min |
| Slow | `last kickoff + 8h` → `last kickoff + 24h` | hourly |
| Off | until the next cluster arms | — |

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
| --- | --- | --- | --- |
| 4.75h | 27% | 3,965 | 73% |
| **8h (recommended)** | 36% | 5,395 | 64% |
| 12h | 48% | 7,110 | 52% |

**8h, because Item 108 measured a game still live at 6.4h** behind a weather delay while five others
reconciled at `kickoff + 3.40h..4.75h`. A tighter margin would have slowed polling on that game while
it was on the clock. When a game does overrun the margin the score is not lost — the reconciliation
pass still collects it, late rather than never.

| Wakeups / month | Sep | Oct | Nov | Year |
| --- | --- | --- | --- | --- |
| live-scores today | 14,400 | 14,880 | 14,400 | 175,200 |
| Step 1, dense 8h + hourly slow to +24h | 4,351 | 6,156 | 5,757 | — |
| removed | 70% | **59%** | 60% | — |

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

**Filed 2026-09-05.** Depends on Item 102 for the same capability as Item 130. Separate item because
it is a separate automation job (`AGENTS.md` scope rule), and it is the largest proportional saving
available anywhere in the campaign.

**Today:** `gameStats/pollingTarget.ts` makes a game pollable from `kickoff + 3h` to `kickoff + 24h`,
on a `*/15` cron — 21 hours per game, 4 wakeups an hour, effectively continuous in season, for 12% of
all Active CPU.

**Nothing consumes it live.** Item 110's own consumer inventory: insights and archive only. So one
pass once a cluster has settled is sufficient.

**Measured:**

| | Sep | Oct | Nov | Year |
| --- | --- | --- | --- | --- |
| game-stats today | 2,880 | 2,976 | 2,880 | 35,040 |
| one pass per cluster | 56 | 92 | 76 | 240 |
| removed | 98% | **97%** | 97% | **99%** |

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

**Filed 2026-09-04.** The decisions and their evidence:
`docs/campaigns/item-87-followon-section-ordering.md` and its two children. Decision 1 (section
order) shipped as POLISH-022; decision 4 was documentation only. This item is the queue home for the
rest, so the document is not the only place they live.

1. **DONE — Live sorts by kickoff alone.** POLISH-023, merged via PR #563 (`1546bbc8`). `compareOverviewLiveItems` reduced
   to kickoff ascending; the in-progress partition and the owner-count key both removed. §2 was
   scoped by the owner on 2026-09-04 to the **three state sections**, so the same key also came out
   of `compareOverviewRecentFinals` and out of the watchlist's `compareWatchlistItems` — the
   watchlist keeps `watchlistPriority`, its curation score, which is not an owner-count key. Sort
   rules for all three are now written down in the resolutions doc.
   **Featured too, by owner ruling 2026-09-04** — `compareRecentResultItems` lost the same key.
   The relevance-surface argument for keeping it holds only for signals someone chose; owner count
   arrived by inheritance. It was worse than a sort key because `selectFeaturedGames` slices without
   re-sorting, so at the cap it decided which games appeared, and `NoClaim` being truthy meant it
   was not measuring what it claimed to. **Every owner-count key is now gone**; the watchlist's
   `watchlistPriority` is the sole surviving non-kickoff key, deliberately.
2. **DONE — no date or time on a Featured final.** POLISH-023, merged via PR #563 (`1546bbc8`). `DESIGN.md` said the
   opposite and was amended. **Still outstanding, and the rule is repo-wide:** Matchups
   (`MatchupsWeekPanel.tsx`, the non-scheduled metadata branch) and Schedule
   (`deriveExpandedMetadataLines`, `gameCardPresentation.ts:125`) both still print a kickoff on final
   rows. Those two surfaces are unbuilt work under this item, not closed by PR #563.
3. **Counts are totals, not visible counts** — belongs to **Item 115**, not here. `liveTitle` reads
   `.length` after `.slice(0, OVERVIEW_LIVE_LIMIT)`, so it is a visible count, and today the surplus
   is dropped with no expand control at all. A total before Item 115 exists would promise games the
   UI cannot reach; the count and the cap are one fix.
4. **"Today" is the only relative date label** — constrains **Item 87 slice 5**, not a change on its
   own. No relative label ships today; every date is absolute.

Items 1 and 2 together are an hour and both are user-facing. 3 and 4 are recorded here only so the
decision is not lost when someone opens Item 115 or slice 5.

- Backlog slug: `POLISH-OVERVIEW-ORDERING-REMAINDER-v1`

### Item 124 — `OverviewContext.sectionOrder` is dead and now contradicts the shipped order

**Filed 2026-09-04 from a `/code-review` finding on PR #562. Pre-existing, not introduced there.**

`overview.ts:41` declares `sectionOrder: OverviewSectionKind[]` and four construction sites populate
it (`:141`, `:154`, `:167`, `:179`). **Nothing outside `overview.ts` and test fixtures reads it** —
`OverviewPanel.tsx` hardcodes section order in static JSX. The live-emphasis value at `:141`,
`['live', 'highlights', 'standings', 'matrix']`, asserts Live leads the page above Standings, which
is now contradicted by the owner decision POLISH-022 implemented.

**Two sibling fields are dead the same way.** `liveDescription` and `highlightsDescription` have no
`.tsx` reader; `liveDescription` at `:159` is copy — "If games go live, they will automatically move
to the top of Overview" — that no surface renders and that describes behaviour the page does not
have.

**Why it matters:** someone edits `sectionOrder` to change the layout, nothing renders differently,
and the model quietly disagrees with the JSX. A second unread model of the same fact is the shape
Item 123 documents in the postseason template.

**Deliberately not folded into PR #562**, which is a 28-line pure block move. Deleting these fields
touches the type, four construction sites and four test files, which would make a presentation-only
change into a data-model one.

**DONE — POLISH-024, merged via PR #564 (`cac6dab9`).** Six fields removed, not three: `sectionOrder`, `scopeLabel`,
`highlightsTitle`, `highlightsDescription` and `liveDescription`. `OverviewContext` is now
`{ scopeDetail, emphasis }`.

**Correcting this item's own scope note.** It said `highlightsTitle` "IS read
(`context.highlightsTitle` supplies the Featured heading), so this is a partial deletion". That was
wrong and unchecked — the Featured heading is the literal string `"Featured games"` in
`OverviewPanel.tsx`, and `highlightsTitle` has no reader outside `overview.ts` and test fixtures.
`scopeLabel` was dead the same way. Only `scopeDetail` (read by
`selectors/overview.ts:237` for the week label) is genuinely read.

**And the same error, one sentence later — caught by `/code-review` on PR #564.** The paragraph
above originally continued "and `emphasis` (five components branch on it) survive", inside the very
correction it was making. That claim was also false and also unchecked: it came from grepping the
bare word `emphasis`, which matches `cardEmphasisClasses`, `data-leader-emphasis` and an unrelated
`CareerSummaryCard` prop. **Nothing in `src/` reads `context.emphasis`** — proved by renaming the
field, which errors in four test files and zero production files. `emphasis` therefore met the
exact criterion the five deleted fields failed, and the owner ruled it out too: **`OverviewContext`
is now `{ scopeDetail }`.** The Item 113 argument did not survive contact with what 113 needs —
`emphasis` is a slate-level fact, and Featured selection is per-game, so a slate signal cannot say
which game to promote; if 113 wants slate context it will derive it in the shape its selector needs.
And "a future item might want this" is the weakest reason to retain code — it is the reason that
produced both false claims, because a field kept for a hypothetical consumer accumulates a story
about being used until someone writes that story down as fact.

**The collapse was an argument for deleting, not against.** With `emphasis` gone,
`deriveOverviewContext`'s four slate branches all returned the same object, so the function reduces
to `{ scopeDetail: selectedWeekLabel ?? null }`. It was never deriving context; it was deriving one
field with ceremony around it. `activeSlateStatus` left its parameters and is still used elsewhere
for `includeFinalWeekGames` and `recentMode`.

**Rule written into `AGENTS.md` → Verification (binding):** a claim that something IS READ requires a
mutation, not a grep. All three of this branch's false claims came from greps that returned matches
on near-namesakes; a rename answers in one command and cannot return a false positive.

**One test deleted rather than gutted.** `overview uses postseason context when the active slate is
postseason-driven` had `scopeLabel` as its entire subject; with the field gone,
`deriveOverviewContext` has no postseason-specific output left, so keeping it meant an `emphasis`
assertion other tests already make. Deleted with a comment in place saying why. `weekGames` also
left `deriveOverviewContext`'s parameters — it existed only to run `isTruePostseasonGame` for that
label.

**Net: 256 lines removed, 36 added.** `npm run build` was run as a gate alongside the usual three,
since the change alters an exported type's surface.

- Backlog slug: `POLISH-RETIRE-OVERVIEW-SECTION-ORDER-v1`

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

**Decision parked:** the normalisation target — the incumbent is tuned to `#0A0A0A`, the mockup and
follow-on assume `#161616`. One constant, before (1) ships.

- Backlog slug: `POLISH-TEAM-COLOUR-BAR-v1`

### Item 118 — Schedule status filter with counts

**Filed 2026-09-03.** Design: `docs/campaigns/item-87-followon-matchups-schedule-design.md` → _The
status key becomes a real filter_. Replaces the FINAL / IN PROGRESS / SCHEDULED colour key, which was
a legend for card colours the Schedule rework deletes. Single-select; counts on each chip; zero-count
states dim rather than disappear; chips neutral, never status-coloured; empty date groups hide under
a filter. Additive functionality — scoped after **Item 87 slice 5**, not inside it.

- Backlog slug: `POLISH-SCHEDULE-STATUS-FILTER-v1`

### Item 117 — Matchups adopts the shared scoreboard

**Filed 2026-09-03.** Design: `docs/campaigns/item-87-followon-matchups-schedule-design.md` →
_Matchups — design decisions_, and `mockups/matchups-schedule-mockup.html`. `MatchupsWeekPanel`'s
bespoke `GameRow` (`:140`) becomes `CompactGameScoreboard`, rendered expanded inline with no collapse
and the odds footer on. **Carries a correctness fix, not only a restyle:** the shipped row reads
`Colorado @ Georgia Tech` over `vs BHooper` and never says which team belongs to which owner — the
same owner→team mapping defect the Overview redesign fixed. Not in slice 5's scope, which touches
this file only for the `ownerOutcomeRowClasses` carry-over. Depends on **Item 87 slice 5a**.

**Open — owner decision:** card-owner treatment. The card owner's name repeats on one line of every
scoreboard; the mockup toggles full weight against dimmed. Decide before implementation.

**Dormant summary and grouping cleanup — retained from Item 116.** `formatSlateSummaryText`
(`selectors/matchups.ts`) has no production caller; `MatchupsWeekPanel` consumes
`summarizeSlateOpponents` entries only for `.length`, which drives the "Show N more opponents"
control. The preserved internal `NoClaim` / `NoClaim (FBS)` grouping keys collapse distinct unowned
FBS opponents, so that count can understate the number of opponent teams even though every owner
game row still renders. If this rework wires `entry.label` into JSX, it must suppress the sentinel
at the presentation seam; otherwise decide whether to re-key or delete the dormant summary path.

- Backlog slug: `POLISH-MATCHUPS-SCOREBOARD-v1`

### Item 115 — Overview sections truncate with no expansion, though "bounded default" was decided

**Sharpened 2026-09-04 by a `/code-review` finding on PR #563.** POLISH-023 made Live sort by
kickoff alone, which changes the cap from "scored rows win the slots" to "earliest kickoffs win the
slots". A provider gap across one kickoff window — the PLATFORM-105A failure mode — routes those
games to `awaiting-score`, and `routeForItem`'s abandonment gate keeps them there for up to
`GAME_MAX_DURATION_MS` (8h from kickoff, `standingsHistory.ts:109`). Six such rows hold the earliest
`sortDate`s, fill Live, and every later game carrying a real score is sliced off: **the Live section
can show six "Awaiting score" rows and zero scores during a live slate, for hours.** That is not a
defect of the sort — the rows are in the decided order — it is the hard cap with no expand control,
which is this item. It is the sharpest argument yet for the expansion, sharper than the count.
**Owner note 2026-09-04:** this makes the cap fix a scoreless-row problem, not purely a volume one.
"Brief gap" was the load-bearing assumption behind rejecting the awaiting-score partition, and eight
hours is not a brief gap. It does not reopen that decision — repositioning on a polling surface is
still worse — but six blank rows and zero scores for an afternoon is a different failure than the one
priced, and this item has to handle it specifically.
**Also a test gap to close here:** `live rows ignore owner count and keep the six-row cap on kickoff
order` uses one unscored row plus six scored ones, so it never exercises the direction where
unscored rows consume the cap.

**Filed 2026-09-03. Owner decision already exists — this is unbuilt work, not an open question.**
`item-87-live-watchlist-scoreboard.md:244` settles it: _"Progressive disclosure per section: bounded
default, expands in place. Header link → Matchups tab; footer control expands this week's slate."_
The cap was designed as a **default view you open past**, not a ceiling.

**Nothing expands.** Verified across `OverviewPanel.tsx`, `CompactGameScoreboard.tsx`, and
`navigation/ViewMoreLink.tsx`: no `useState`, no `aria-expanded`, no show-more control anywhere. All
four sections truncate hard — Live, Watchlist, and Recent finals at 6
(`overviewGameSections.ts:10-12`), Featured at 4 (`overview.ts:69`). The only route to more games is
the `All results →` header link (`OverviewPanel.tsx:1651`, `:1737`), which navigates to Schedule
rather than expanding in place.

**The coverage consequence, and why it is Recent finals' problem specifically.** The campaign doc
calls Recent finals **complete** — _"every recent result"_ (`:95`, settled 2026-09-01, in the context
of refusing recap deduplication). It is not: it caps at six. Featured's picks are removed from the
routing pool first (`featuredGameKeys` → `overviewGameSections.ts:172`), and Recent finals then takes
up to six of the remainder without growing to compensate. Measured at PR #559's head on a 12-final
slate: Featured 6 + Recent finals 6 = 12 visible; Featured 4 + Recent finals 6 = 10 visible. **This
predates PR #559** — any slate over twelve finals already hides games on `main` today.

**Do not fix this by raising caps.** The decided design is expansion, and raising a cap trades one
arbitrary number for another while leaving the same failure at the next boundary. Featured is exempt
from the coverage argument — it is a curated subset by design (owner, 2026-09-03) and a small cap is
its point; this item is about the sections that claim completeness.

**Distinct from [[Item 112]].** Row disclosure (tapping a row reveals detail about that game) and
section expansion (revealing more rows) are different affordances. They share a surface and should
probably be sequenced together, but they are not one ticket.

**Acceptance boundary:** a section whose pool exceeds its default shows an in-place control that
lengthens it, and no game reachable in the current slate is absent from Overview without an
affordance that reveals it. The `All results →` navigation may remain, but it is not the answer to
truncation.

- Backlog slug: `POLISH-OVERVIEW-SECTION-DISCLOSURE-v1`

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

**Carried in from POLISH-023, 2026-09-04.** Specify what _does_ promote a game into Featured, rather
than leaving the slot unfilled. Featured spent this whole campaign ordering and selecting by an
owner-count key nobody chose — it arrived by inheritance from a shared tiebreak and quietly did the
relevance job until a review found it. An unclaimed slot in a selection pipeline is how that happens,
so this item's output must name its signals rather than only removing the wrong one.

**Filed 2026-09-03 from an audit of `docs/campaigns/item-87-live-watchlist-scoreboard.md` against
current code, prompted by the owner asking whether Featured was state-agnostic.** It is not, and the
gap between the doc and the shipped behavior is the reason that question had a wrong-sounding answer.

**What ships today.** `selectFeaturedGames` (`src/lib/selectors/overview.ts:376`) is a plain selector:
drop games where both sides are `NoClaim`, sort postseason games by round tier, slice to a limit.
`deriveFeaturedGameBadge` (`OverviewPanel.tsx:157`) renders a badge only for CFP round labels
(`CFP Semifinal`, `CFP Championship`, ...) — every other featured game carries no reason at all.
Selection is finals-only: `resultCandidates` filters to `hasUsableFinalScore` (`overview.ts:470`), so
a game is invisible to Featured while scheduled or live and only enters once it is final.

**What the campaign doc decided, and marked "resolved" (`item-87-live-watchlist-scoreboard.md:530-571`),
none of it built:**

- **State-agnostic, one place for the whole cycle (`:530`).** "A featured game enters when selected
  and stays through scheduled, live and final, so it appears only in the Featured tile, never in the
  state sections." Today a featured game is an ordinary Watchlist or Live row until it finishes, with
  no distinct treatment, then moves to Featured only at the end.
- **Selection ownership moves to the insights pipeline (`:557-568`).** Featured stops asking "which
  games are worth watching" (football criteria) and starts asking "which games activate a fact the
  league already knows" — reusing the existing insight taxonomy and `INSIGHTS-018`'s priority/
  suppression machinery rather than a parallel calibration.
- **Filter — pair-anchored insights only (`:569`).** Only insights whose subject is a pair of owners
  who happen to be meeting qualify; "longest active title drought" has no game to attach to.
- **Feed-duplicate suppression (`:571`).** An insight surfaced in Featured must not also appear in
  the regular insights feed that week — the same one-place principle as the section promotion model,
  applied to the insights feed instead of the game sections.
- **Copy and colour inherit from the insight (`:566-567`).** Reason text generates from the insight,
  not a game-specific template; colour takes whatever `INSIGHTS-017-PALETTE` assigns to that insight
  category. `INSIGHTS-017-PALETTE` itself is tracked only as a prose bullet under "Unresolved
  decisions," not a numbered item — decide whether this dependency needs one before scoping colour.
- **Cap — settled at FOUR, merged 2026-09-03 via PR #559 (`ce75380b`), separately from this item.**
  It shipped at 6 by inheriting a default; the doc had argued three. Four rather than three because a
  CFP first round and quarterfinal are four games each, and at three one game of a round is demoted
  into Recent finals, which renders it without its round badge or kickoff line.
  **Correction — an earlier version of this entry claimed the cap "does not touch
  Live/Watchlist/Recent finals." That was false**, and review disproved it by measurement:
  `recentResults` feeds `featuredGameKeys` (`OverviewPanel.tsx:1481`), used as an exclusion set at
  `overviewGameSections.ts:172` before routing, so Featured's cap does move how many finals reach
  Recent finals. Accepted rather than fixed: Featured is a curated subset by design. The coverage
  question belongs to Recent finals — see [[Item 115]].

**One architectural question the original design didn't address.** Today's postseason-round sort
(`hasPostseasonGames` branch, `overview.ts:388-395`) is a second, independent selection path with no
insight involved. Reframing selection around pair-anchored insights needs an explicit answer for
whether postseason significance becomes its own insight category feeding the same pipeline, or
remains a separate override layered ahead of it — the campaign doc's design was written for
regular-season rivalry-shaped insights and never considered this case.

**Still open, inherited from the original design record (`:291`) — do not re-decide, just don't
lose them:** reset cadence (weekly, or can a game stay featured across weeks); whether zero
qualifying games hides the tile or renders an empty state; which insight categories are
pair-anchorable, and whether any new generators are needed.

**Re-verify the mockup against current Overview before building.** The design predates POLISH-020
(Watchlist converted to the shared scoreboard, 2026-09-03) and Item 112 (row disclosure, filed the
same day). Both change what "the rest of Overview" looks like around the Featured tile; confirm the
mockup's assumptions still hold rather than trusting it as current.

**Acceptance boundary:** a featured game is selected once and renders in exactly one place —
Featured — for its entire scheduled→live→final lifecycle, never duplicated into Live, Watchlist, or
Recent finals. Selection reads from the insight taxonomy via pair-anchored matching, not from
`prioritizeOverviewItems`'s football criteria. An insight consumed by Featured does not also render
in that week's insights feed. Reason copy and colour come from the insight, not a game-specific
template.

- Backlog slug: `INSIGHTS-FEATURED-GAME-HOOK-v1`

### Item 112 — rows do not expand: a settled Item 87 decision that no slice implemented

**Filed 2026-09-03 at the close of Item 87 slice 4.** The shared scoreboard is now the row type on
every Overview section, which means the gap is uniform rather than per-section — this is the moment
it becomes tractable, and also the moment it stops being invisible.

**The decision.** Owner, 2026-08-29, recorded in Item 87's settled decisions: _"Rows expand in place;
tapping discloses rather than navigating."_ Slices 1-4 converted Live, Featured, Recent finals, and
the watchlist to the shared anatomy and delivered none of it.

**The gap, measured.** `src/components/CompactGameScoreboard.tsx` contains no `useState`, no
`onClick`, no `aria-expanded`, no `<details>`, and no collapse affordance of any kind. It is a pure
presentational row. Three call sites in `OverviewPanel` render it, so one implementation covers every
Overview section at once.

**Why the content half is already paid for.** Item 87 records that L1 disclosure content reaches this
surface and is discarded today: schedule rows carry `media` (broadcast outlet) and full venue,
`CombinedOdds` is already threaded into `GameScoreboard`, and `historySelectors` computes owner
head-to-head records. Confirmed here that `CompactGameScoreboard` currently receives neither `media`
nor `venue` — the props stop short of the row. So the work is a disclosure mechanism plus prop
threading, not new data derivation. That claim is inherited from Item 87 and re-verified only for the
component boundary; verify the four sources independently before scoping.

**Why it was not folded into slice 4.** That branch reached 18 files against the AGENTS.md:306
>15-file signal before this was considered. Adding an interactive affordance and its accessibility
coverage to an already-oversized branch would have been the wrong trade the night before a slate.

**Scope.** One disclosure mechanism on the shared component, its keyboard and screen-reader contract,
and the prop threading for whichever L1 facts survive an owner content decision. Every Overview
section inherits it; Matchups and the recap primitives still use `GameSummaryList` and
`GameScoreboard`, so they do not.

**Still a different affordance — corrected 2026-09-03.** Section-level expansion — a "show more"
that lengthens a capped section — is a DIFFERENT feature from row disclosure, and the two must not be
conflated into one ticket: "tapping a row discloses detail" and "tapping a section reveals more rows"
are not the same thing. **An earlier version of this entry claimed section expansion was "not in the
settled decisions" and "never decided." That was wrong.** The campaign doc settles it at
`item-87-live-watchlist-scoreboard.md:244` — "Progressive disclosure per section: bounded default,
expands in place" — and it was simply never built, the same failure mode as this item. Tracked
separately as [[Item 115]].

- Backlog slug: `POLISH-SCOREBOARD-ROW-DISCLOSURE-v1`

### Item 111 — `/api/odds` fetches its own origin, costing two extra invocations per request

**Filed 2026-09-03 from a preview symptom that turned out to be an architecture finding.** Odds
rendered nowhere on preview — not the Overview watchlist, not the full Schedule page — while
production served all 168 attached entries with correct favorites.

**What it is.** `loadCanonicalScheduleInputs` (`src/app/api/odds/route.ts:278`) resolves its inputs
with a `Promise.all` in which two of the four legs are **HTTP requests back to the route's own
origin**:

- `fetchCanonicalSchedule` (`:239`) → `new URL('/api/schedule?year=${season}', reqUrl.origin)`
- `readConferenceRecords` (`:220`) → `new URL('/api/conferences', reqUrl.origin)`

This is the only route under `src/app/api` that self-fetches; every other consumer of the canonical
schedule reads it in-process.

**How it fails on preview.** Vercel deployment protection intercepts the self-fetch and returns the
SSO login page with a **200**, so the `!response.ok` guards at `:224` and `:245` pass. `.json()` then
hits `<!DOCTYPE` and throws, and the catch at `:679` returns HTTP 500 with the parse error as its
body. Observed at `cfb-app-preview.vercel.app/api/odds?year=2026`:

    {"error":"Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"}

The 200-with-HTML reading is an inference from the error text, not from an observed status line: had
SSO answered 401/403, the guard would have thrown `conferences 401 …` instead of a parse error.

**Consequence on preview: odds can never be validated there.** `useOddsHydration`
(`src/components/hooks/useOddsHydration.ts:56`) is gated only on `scheduleLoaded && hasGames`, so it
fires for every visitor, sees `!res.ok`, and installs no lookup. Records still render because they
arrive as a server prop. This is structural while deployment protection is on, and it silently
removes odds from every preview walkthrough — which is why it went unnoticed until an owner
walkthrough of the Item 87 slice-4 watchlist asked why no spread appeared.

**The production question, UNMEASURED.** Production has no SSO, so the self-fetch succeeds and the
route works. But each odds request still spawns **two additional function invocations**, one of them
`/api/schedule` — the route the Active CPU campaign measured rebuilding thousands of rows. The client
hydration is ungated, so this runs per visitor per page load.

**This is a hypothesis, not a finding.** The campaign's residual non-cron cost of ~220 s/day is
currently unattributed, and this is a plausible contributor — but nothing here has been measured
against the Vercel Observability function breakdown. Do that measurement BEFORE scoping a fix; the
mistake this campaign has already made five times is fitting arithmetic to a story.

**Scope if it lands.** Replace both self-fetches with the in-process reads the rest of the codebase
uses. That removes two invocations and two cold starts per odds request and fixes preview as a side
effect. Contained to one file, but it crosses a shared schedule-read boundary, so it needs the full
suite rather than a focused slice.

**One open sub-question.** `ODDS_HYDRATION_ISSUE` (`src/lib/cfbScheduleAppHelpers.ts:34`, "Odds fetch
failed: unable to load current odds.") is set on `!res.ok` and is classified live-visible by
`isLiveOddsIssue`. Whether it actually renders was not confirmed during the preview walkthrough. If
it does not, the surfacing is broken independently of this item and IS member-visible in production
whenever an odds fetch genuinely fails — file that separately rather than folding it in.

**Adjacent, do not fold in.** `readTeamsCatalog` (`:233`) reads the checked-in `src/data/teams.json`
seed from disk rather than the durable catalog — the same two-sources-of-truth split the
catalog-unification campaign owns. Noted here only because it sits in the same `Promise.all`.

- Backlog slug: `PLATFORM-ODDS-SELF-FETCH-v1`

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

| Path | Result |
| --- | --- |
| Provider inverts home/away | 20,828 games over six seasons: **0 inversions, 0 changes**; pid assignment stable across pulls five years apart |
| Provider omits a game id | **0 of 22,760 rows** across seven seasons — no missing, non-numeric, or beyond-safe-integer ids |
| Provider sends duplicate ids | postseason sets are fully distinct: 139/139, 54/54, 86/86 |
| Provider sends placeholders | **0** placeholder-looking rows in three postseason slates; CFBD publishes a game only once the matchup is settled |
| Two rows share an id | rejected at `canonicalSlate.ts:345` BEFORE source-item metadata is read |
| Two rows have different ids | never merged — `isIncompatibleCollision` rule 1, the guard PLATFORM-086H3E4 produced |
| The app's own `cfp-*` placeholder shells | participants unresolved, so `mergedParticipants` never takes their orientation |
| An override creates a row | it cannot — `applyManualOverride` patches an existing candidate |

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

**Reframed 2026-09-02.** First filed about SCORES. The owner's observation — that a provider revising
"game data" is far more likely to mean box-score stats than final scores — is supported by the one
measurement available, and it inverts the severity. Scores are unambiguous and settle at the whistle;
stats are what conference crews revise for days.

**The provider revises on a schedule.** CFBD's admin, 2026-09-02: _"game data can change up to
several hours afterward. I will always do a 'final' data reconciliation on Sundays for that week's
games."_

| | scores | game stats |
| --- | --- | --- |
| Divergence detected? | yes — `differenceCount` | **no** |
| Correction applied? | no, deliberately | no |
| Surfaced anywhere? | weakly, as receipt detail | **not at all** |
| Observed in production | **0 differences** | unmeasurable — nothing counts it |

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

**Measured 2026-09-02 against production.** We fetch odds for games we then fail to attach, so
members see no line on games the books have priced.

    raw provider events cached : 146
    attached + stored          : 110
    dropped in attachment      :  36

Reproduced locally against the exact cached events, the live catalog, and the durable alias map:

    events=146  attached=98  dropped=48
    drop reasons: { unmatched_pair: 48 }

**Every drop is `unmatched_pair`, and every one has a non-FBS team on one side.** The FBS side always
resolves; the other side never does:

    [unmatched_pair] "Bethune-Cookman Wildcats"         @ "UCF Knights"
    [unmatched_pair] "Merrimack Warriors"               @ "Delaware Blue Hens"
    [unmatched_pair] "Arkansas Pine Bluff Golden Lions" @ "Missouri Tigers"
    [unmatched_pair] "LIU Sharks"                       @ "Kansas Jayhawks"

**Mechanism.** `attachOddsEventsToSchedule` gates on `resolver.buildPairKey(homeTeam, awayTeam)`
(`oddsAttachment.ts:88`); a miss reports `unmatched_pair` and the event is dropped. The provider sends
mascot-suffixed names, and stripping a mascot requires catalog metadata — **the team catalog holds
only the 138 FBS teams**. The schedule does carry "Bethune-Cookman" as a canonical name, so it reaches
`observedNames`, but that is the bare school; `"Bethune-Cookman Wildcats"` never normalizes onto it.

**Member impact.** 51 of 99 week-1 FBS games have no line displayed; **47 of those are `fbs/fcs`**
pairings whose odds we already hold. Confirmed independently by the owner finding a FanDuel line for
Bethune-Cookman @ UCF.

**Not the causes that were considered and ruled out.** The Odds API request carries no date filter and
no limit (`oddsRefreshExecutor.ts:83-89`) — only seven bookmakers and three markets — so this is not a
provider-coverage or configuration gap. Not diacritics either: San José State's catalog alts already
include `"san jose state spartans"`, and that game attaches.

**Fix direction — a matching aid, not an identity authority.** The catalog must remain the FBS
identity authority; do not mint canonical identities for non-FBS schools from it. Prefer a
mascot/alias lookup used ONLY to normalize provider strings before `buildPairKey`, sourced from CFBD
`/teams` (which returns all divisions with mascots). Sizing note: this touches the odds attachment
seam that PLATFORM-086C1/C2 consolidated, so it needs its own review.

**Second failure, now isolated: the aggregator does not carry every game the books price.** UMass @
Rutgers has a live DraftKings line, and DraftKings is FIRST in our seven bookmakers
(`routeInternals.ts:220`), yet the game is absent from our raw events under every spelling tried
(Rutgers, Scarlet, Massachusetts, UMass, Minutemen).

Two candidate explanations were ruled out by measurement rather than argument:

- **Not bookmaker scope** — DraftKings is queried, and the line is on DraftKings.
- **Not staleness.** A forced `GET /api/odds?year=2026&refresh=1` at 2026-09-02T20:06:29Z returned
  `cache: miss` with usage 18 → 21, i.e. a genuine live fetch 26 hours before kickoff. It returned
  **the same 146 events**, still no Rutgers, still 5 of the 6 scheduled Sep-3 games. An earlier
  hypothesis that our 4-hour-old cache explained the absence was a plausible mechanism that turned out
  to be wrong; the cadence policy is behaving correctly (verified: `pregame` arms at
  2026-09-03T16:00Z, exactly six hours before the 22:00Z opener, refreshing every 2h through kickoff).

So this is **provider coverage** — The Odds API's feed is not what the books post. Nothing on our side
recovers it.

**The size of that coverage bucket is NOT measured, deliberately.** A hand-rolled schedule↔feed
matcher produced false negatives (it missed "UAlbany"/"Albany" and mangled "San José State" on the
accent), and a season-wide "absent" count is meaningless anyway because books post late — 737 of 880
future games have no line simply because it is September. Measuring this properly means running the
app's own resolver in REVERSE, schedule games → feed events, which is its own piece of work. Do not
quote a number until then.

**It does not change this item's scope.** The 48 dropped events are ones we ALREADY HOLD; fixing the
match recovers all of them regardless of what the feed omits. Coverage is a separate, smaller,
unquantified residual.

- Backlog slug: `PLATFORM-ODDS-NONFBS-MATCHING-v1`

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
- **The planner never emits an empty cron — owner decision 2026-09-05.** Off-window it emits a
  **floor cadence** (hourly), so the job always runs and delivery health stays truthful with NO change
  to `SchedulerDeliveryState` and none of its four consumers touched. The offseason is not a special
  case: it is a long run of dead days, one rule covers both, and the schedule stays present so
  `inspect` and delivery health keep working. This is the behaviour superseding the manual half of
  Item 96.

  **Why a state change was rejected.** `SchedulerDeliveryState` is
  `on-time | late | missing | invalid | unavailable` — there is no way to say "not supposed to run",
  so a narrowed cron on a dead day would report `late` or `missing`, both alarms. Adding a sixth
  member (mirroring PLATFORM-090's `ProviderDataExpectation`) would touch `deliveryStateDisplay`,
  `deliveryRowStatus`, `noReceiptExecutionLabel` and `systemHealthIssues.ts:352`. The floor cadence
  buys nearly the same saving for none of that.

  **The floor's cost, computed 2026-09-05** (`*/3` = 480 runs/day, `*/15` = 96; armed 17% annually,
  74% in October):

  | job | today | windows-only | with hourly floor |
  | --- | --- | --- | --- |
  | live-scores, annual | 480/day | 82 | **102 (79% below today)** |
  | live-scores, October | 480/day | 355 | **361 (25% below today)** |
  | game-stats, annual | 96/day | 16 | **36 (62% below today)** |
  | game-stats, October | 96/day | 71 | **77 (20% below today)** |

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

**Slice 3 — the durable planner record, and `inspect` divergence against it.** The reconstructibility
replacement, which **must exist before slice 4 takes cron ownership** — otherwise the tampering signal
is gone for the window between them.

- Durable record of every planner run: input windows, generated cron, previous cron, applied-or-
  skipped, outcome, and the invocation id (Item 126 Tier A correlation). **Durable, not a runtime
  log** — Vercel logs expire too fast to be incident history, and rebuilding that defect here is
  explicitly out of bounds.
- **Allowlisted projection only.** `buildUpsertRequest` headers carry TWO secrets —
  `Authorization: Bearer <QSTASH_TOKEN>` and `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`.
  Record cron, `scheduleId`, destination, method, retries and derived windows. Never `headers`, never
  a raw request, never a response body.
- Rewrite `qstashSchedule.ts:342` to diff live QStash state against the planner's **last recorded
  intent** rather than the FIXED constant — **collision 1**. With no record present it must fall back
  to the constant, so `inspect` keeps working before slice 4 ever runs.
- **Must not:** apply an upsert, or make the cron planner-owned. Records are written by tests only.

**Slice 4 — activation.** Small, because everything it needs is already built and tested by then.

- `QSTASH_TOKEN` into the Vercel environment. **Check first whether QStash offers a scoped management
  token** limited to the two schedules the planner touches; if it does, use it. **Update all five
  statements in the same PR** — `docs/deployment-runbook.md:88` and the four `scripts/manage-*-
  schedule.ts` headers — or the repo lies about its own security posture. Collision 3.
- The daily cron that derives → synthesizes → records → upserts, and the cutover of `live-scores` and
  `game-stats` to planner-owned crons.
- **Existing handler guards stay.** They are the defence against kickoff changes, postponements,
  stale QStash state, and planner mistakes. The planner reduces wakeups; it must never become the
  only correctness or quota protection.

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

Recent finals expires when the recap tile stops showing that week. `expiredFinalWeeks`
(`overviewGameSections.ts:147`) filters on `selectWeeklyRecapTileState(target, now) === 'upcoming'`.
**Corrected 2026-09-03 — the cutoff is not a fixed Thursday.** `selectWeeklyRecapTileState`
(`selectors/weeklyRecapFacts.ts:329`, cutoff computed at `:349`) takes the day AFTER that week's
LAST game and advances to the first Thursday 06:00 ET on or after it. The expiry therefore FLOATS
with the week's last game: a week ending Sunday releases the Thursday four days later, while a week
whose last game falls on a Thursday does not release for a further seven days. Verified live —
week 1 (last game 2026-09-07) does not expire until **2026-09-10**, which is why last weekend's
finals were still rendering on Thursday 2026-09-03 afternoon.
Both surfaces therefore release week N at the same instant rather than handing off.

**In-season this is nearly harmless.** Midweek football fills the gap: 2026's FBS regular season has
61 distinct game days including Thursday, Friday, Wednesday and Tuesday slates, so new games usually
kick off the same evening that finals expire. The empty window is hours, on a weekday morning.

**At season boundaries it is not.** The largest gap between consecutive FBS regular-season game days
in 2026 is **13 days — 2026-11-29 to 2026-12-12** — the run from the last regular-season Saturday
through conference-championship week and Army-Navy. Finals expire and nothing replaces them, so
Overview carries no results at the most-watched point of the season. The same shape recurs into bowl
season.

**Re-derive the empty window before sizing this — 2026-09-03.** The figures above were computed
against the fixed-Thursday reading corrected above. With the real floating cutoff, the empty window
is the span from that week's own cutoff (first Thursday 06:00 ET after its last game) to the next
slate's first final, which is NOT the same as the 13-day game-day gap and may be materially shorter.
The 13-day gap between game days is measured and stands; the length of the resulting empty window is
NOT, and no number for it should be quoted until it is recomputed.

**Do not decouple from the recap predicate.** Sharing one definition of the Thursday boundary is
correct and was defended on review; duplicating it would be worse. The defect is _when_ finals
expire, not _what_ computes the date. Candidate fix: hold the most recent completed slate until a
newer slate produces finals, so the two surfaces hand off instead of both letting go.

**Not a POLISH-019 blocker.** Slice 3's routing is correct; this is the expiry rule, it predates the
slice, and it is an edge case rather than the weekly defect first reported. Verify against a real
season boundary before changing anything — the fix trades an empty region for stale-looking results,
and which is worse is a judgement call.

- Backlog slug: `PLATFORM-FINALS-EXPIRY-BOUNDARY-v1`

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

**Measured 2026-08-31.** Three independent costs, each with a number. Everything below was taken
from production; where a measurement turned out to be an artifact it is recorded as one so it is not
repeated.

**What the dashboard says, and what it hides.**

| | Mobile | Desktop |
| --- | --- | --- |
| Real Experience Score | 95 (Great) | 76 (Needs Improvement) |
| **First Contentful Paint** | **2.31s (amber)** | **3.50s (poor)** |
| Largest Contentful Paint | 2.47s green | 3.89s amber |
| INP / CLS / FID | 88ms / 0.05 / 30ms — all green | 64ms / 0.03 / 4ms — all green |
| `/league/[slug]` | 93 (137 samples) | 74 (90 samples) |
| TTFB | 0.31s | — |

**Mobile RES 95 is a composite carried by green INP/CLS/FID. FCP is the only non-green metric on
either device, and FCP is literally "how long until content appears".** Do not read 95 as "this is
fine"; read the FCP row.

**Desktop is not representative.** 90 samples over 7 days on a private league is mostly the owner,
and the window includes a debugging session run with `Disable cache` ticked. Mobile has the larger
sample and is the better signal.

**And the score cannot see the tab-switch complaint at all.** FCP fires once per page load. Client
navigations between Overview and History emit **no FCP event**, so that experience is invisible in
Speed Insights by construction. It was measured directly instead — see cost 3.

#### 98a — standings warm-on-write — shipped

Merged through PLATFORM-119 / PR #547. See `docs/completed-work.md` for the shipped outcome; the
remaining league-page-paint work begins at 98c.

#### 98b — 76% of the schedule payload is discarded after parsing

> **SUPERSEDED by PLATFORM-120.** This proposed shaping the API response, but the complete
> reader audit found expectation-oracle and diagnostic consumers that require the full row set.
> PLATFORM-120 instead filters only the live-score and game-stats canonical builds, keeps durable
> storage and `/api/schedule` complete, and makes week derivation invariant to that filter. Do not
> implement 98b; see the PLATFORM-120 registry and completed-work records.

`/api/schedule?year=2026&seasonType=all` returns **2,764,786 bytes** (245 KB gzipped). Of its 3,676
rows:

| Pairing | Rows |
| --- | --- |
| involves an FBS team | **888 (24%)** |
| iii/iii | 1,158 |
| ii/ii | 811 |
| fcs/fcs | 651 |

**The client already discards them** — `src/lib/schedule.ts:758` filters with `isTrackedGame(...)`
immediately after parsing. So filtering server-side is not a behaviour change; it moves an existing
filter upstream. Same shape as PLATFORM-114: work at the wrong layer, shipping data that is thrown
away.

**Fix: filter on provider classification** (no FBS participant → cannot be tracked) in the
`/api/schedule` response. Use the coarse classification predicate, **not** a server-side
reproduction of `isTrackedGame`, which needs the resolver and canonical metadata. The coarse filter
is provably lossless. Expect ~2.76 MB → ~670 KB parsed.

**Measured 2026-08-31 — the cost is row processing, not bytes.** `buildScheduleFromApi`
(`schedule.ts:345`) against the real production payload, 5 runs after a warm-up, median:

| Input | Median | Range |
| --- | --- | --- |
| all 3,676 rows | **1267 ms** | 1233-1605 |
| 888 FBS-involving rows | **353 ms** | 316-1369 |

**~915 ms of main-thread work removed**, on laptop-class hardware.

**Qualified by the Lighthouse trace:** that benchmark timed the function in ISOLATION. In a real
mobile trace, script evaluation is dominated by React hydration (1,932 ms, see below), and the
schedule work sits inside `Unattributable` (1,240 ms) or chunk `1255` (943 ms). 98b's saving is real
but a smaller share of the load than 915 ms suggests on its own. `JSON.parse` of 2.76 MB is only
tens of ms; essentially all of this is the per-row walk, and it scales with row count
(3.6x fewer rows → 3.6x less time). On a phone this runs 2-4x slower, so on mobile — where FCP is
the amber metric — **98b is plausibly a LARGER win than 98a.**

_Caveat:_ benchmarked with an empty `aliasMap`, so absolute numbers will differ in production; the
ratio is what matters and it is row-count driven.

#### 98c — no client cache, so every navigation refetches everything

`CFBScheduleApp` holds schedule and scores in `useState` and there is **no client data-cache
library** (no SWR, no React Query). Navigating away unmounts the component and discards the state;
navigating back refetches from scratch. Observed on a single Overview → History → Overview round
trip:

    schedule?year=2026   teams   rankings?year=2026   aliases?scope=effective
    owners?year=2026     postseason-overrides?year=…  odds-usage   tsc?year=2026
    → 23 requests, 254 kB, ~12s timeline

**Fix: cache the slow-changing fetches across navigations.** Schedule changes weekly and teams and
aliases change less than that; scores are the only genuinely live one and already have their own
90-second/3-minute tiered polling. Keep the live path exactly as it is.

#### 98d — targeted prefetch of History, paired with `staleTimes`

**98a is shipped; do 98c first.** This is a follow-on that buys one specific transition; 98c helps
both directions and every load.

**Scope it to the single Overview → History tab link** (`WeekViewTabs.tsx:79`), not to links
generally. From Overview there is exactly one History link, so `prefetch={true}` there is **one**
speculative render. The 10+ prefetch burst described below happens on the _History_ page, which
links to matchups, members, stats, rivalries, archive and one route per owner — that is where broad
prefetching would be harmful, and those owner links likely want `prefetch={false}`.

**`prefetch={true}` and `staleTimes` MUST ship together.** In Next 15 the client Router Cache's stale
time for dynamic routes defaults to **0**, so a prefetched dynamic payload is fetched and then not
reused. Shipping the prefetch alone pays History's full server render speculatively and discards it —
strictly worse than doing nothing. Set a short `experimental.staleTimes.dynamic` (~30s): long enough
to make the switch instant, short enough that a member never sees materially stale scores relative
to the 90-second/3-minute tiered browser cadence and the three-minute provider writer.

**What it buys, and what it does not.**

- **Overview → History: most of the win.** History's cost is almost entirely its server render
  (TTFB 377ms + Content Download 739ms) and it has no client-side data layer to miss.
- **History → Overview: the RSC half only.** Prefetch warms the route payload, but `CFBScheduleApp`
  fetches schedule, teams, rankings, aliases, owners and overrides from the _client_ after mount.
  **98c is what fixes that direction**, not prefetch.

**Verify it is not speculative waste:** after shipping, confirm in DevTools that a prefetched History
navigation issues no new `history?_rsc=` request, and that the prefetch burst on the History page has
not grown.

#### 98e — the app icon was 1.2 MB (DONE 2026-08-31)

`src/app/icon.png` was **1024x1024, 1,238 kB**. Next's App Router serves `app/icon.png` verbatim at
`/icon.png`, so every visitor downloaded a megabyte-plus image to render a favicon. In a Lighthouse
trace it was the **largest transfer on the page by 7x** over the next item (`/api/schedule` at
182 kB).

Resized to **512x512, 35 kB** — a 97% reduction, ~1.2 MB off every cold load. 512 exceeds what any
browser needs for a favicon and still covers PWA install and high-DPI; nothing referenced the 1024
version, and there is no manifest. Measured alternatives: 256px 9.3 kB, 192px 6.0 kB.

Not render-blocking, so it does not move FCP directly — but on mobile data it competed for bandwidth
and connections against everything else during load.

#### Known cost, not an action — hydration

Lighthouse (mobile emulation, 4x CPU) attributes **1,932 ms of script evaluation to React DOM, in a
single 1,698 ms long task**, against 3,503 ms of total script evaluation. That is hydration, and it
is the largest single main-thread cost on the page — larger than schedule processing.

The cause is structural: `CFBScheduleApp` is one `'use client'` component wrapping the entire app
surface, so the whole tree hydrates at once. Reducing it means moving parts back to server components
and splitting the client boundary into islands. **That is an architectural change, not a tweak**, and
it is recorded here as a known cost rather than filed as work. Revisit only if 98a-98e leave the page
unsatisfying.

#### Deliberately NOT in scope

- **`getLeague` caching and Suspense boundaries.** TTFB is 236-310ms and green on both devices. The
  server's _first byte_ is not the problem; its streamed body is, and 98a fixes that.
- **Broad `prefetch={true}` across all links.** Targeted prefetch is now 98d; this entry is about
  applying it generally, which would make things WORSE here: the History page
  already fires 10+ viewport RSC prefetches (`matchups`, `members`, `stats`, `rivalries`, `archive`,
  plus one per owner), all `force-dynamic`. They are shell-only today (8.2 kB across 14 requests),
  but forcing full prefetch would turn them into 10+ dynamic renders per visit. A return navigation
  showed DNS 159ms + connect 187ms + SSL 117ms — a _fresh_ connection, because the prefetch burst
  had exhausted the pool. If anything is done here it is `prefetch={false}` on the owner links.
- **Flattening History's five-stage waterfall** (`history/page.tsx:50-88`, 7 archives). Real —
  History's RSC fetch measured TTFB 377ms + Content Download 739ms — but 98c comes first now that
  98a is shipped.
- **Bundle size.** 260 kB First Load JS for `/league/[slug]`, 173 kB for history. Unremarkable and
  not the bottleneck.

#### Measurement artifacts — recorded so they are not repeated

- **`getCanonicalStandings` is NOT slow.** Timing it at 5.6s from a local `tsx` process was an
  artifact: outside the Next runtime `unstable_cache` degrades to a passthrough, and the link to
  Neon carries ~79ms RTT versus ~1-3ms from a Vercel function in the same region. Measure server
  work in production, via DevTools timings or Observability.
- **"~1 MB of JS" was wrong.** That came from summing every chunk referenced in the HTML, including
  non-first-load ones. The build output is authoritative: 260 kB.
- **Desktop RES is polluted by our own testing.** Prefer mobile, and prefer the FCP row over the
  composite score.

- Backlog slug: `PLATFORM-LEAGUE-PAGE-PAINT-v1`

## Open league-setup, roster, and draft work

### Item 51 — manual assignment is offered but has no completion writer

`manualAssignmentComplete` is read by readiness selectors and has no production writer. Selecting
manual assignment therefore strands the league in `manual-assignment-incomplete`, and Complete
Setup can never succeed.

Owner decision required at activation: either implement the manual assignment workflow and a
durable per-`(slug, year)` completion fact, or refuse/hide the assignment method until it exists.
When implemented, that durable completion becomes the second valid evidence source for membership
change insights; a transient preseason lifecycle flag is not sufficient.

### Item 23 — assignment-method and draft-recovery states

Resolve as a focused setup/recovery campaign:

- reselecting the current assignment method should be idempotent rather than an error;
- dialog and server owner-count thresholds must agree;
- draft creation must enforce the chosen assignment method;
- an incomplete imported draft must not enter a state the board can never finish;
- “Continue Setup” must account for an already-published roster;
- publication state must come from the shared selector, not a summary-page re-derivation;
- preseason draft reads need one coherent snapshot rather than unsynchronized duplicate reads.

### Item 28 — remaining demo dry-run findings

Keep these product defects together because they describe the same commissioner recovery flow:

- Reopen does not provide a clear path back to draft setup;
- Setup Complete can survive a reopen;
- “Finish draft” can appear when no draft exists;
- owners cannot be renamed from the owners screen;
- editing owners after confirmation can diverge from draft/roster authority.

### Item 39 — draft-board walkthrough follow-ups

The live writer behavior held under the walkthrough. Remaining work:

- add an already-published guard to draft confirmation so a stale second tab cannot republish over
  the roster; keep legitimate Reopen and missing-roster recovery paths;
- replace internal phase vocabulary such as `Cannot transition from 'live' to 'live'` with an
  operator-readable refusal;
- explain the expired-timer “Select manually” gate when a team click is intentionally ignored;
- place Reopen and Reset in one recovery journey while retaining Reset's typed-slug cost;
- decide whether Reset should explicitly explain that the published roster remains in place.

### Item 45 — PLATFORM-092 setup residue

- Make the preseason banner use the same `MIN_CONFIRMED_OWNERS` threshold as confirmed-roster
  selection; a one-owner repair CSV currently says “Roster confirmed” on one surface and incomplete
  on another.
- Extract the reorder editor if `DraftSettingsPanel` is next expanded; it sits at the library's
  complexity guardrail.
- Avoid importing the full standings dependency graph merely to obtain the owner-count constant
  when that shell is next touched.

### Item 37 — `NoClaim` can count toward confirmation eligibility

A legacy or hand-edited `preseason-owners` row such as `['Alice', 'NoClaim']` can satisfy the owner
threshold before downstream consumers strip `NoClaim`. Insights re-checks the threshold, but draft
creation and setup surfaces consume the padded list. Normalize the confirmed-roster authority once,
before applying the threshold, and explicitly test the behavior change for legacy records.

### Item 17 — mid-season owner replacement does not update membership

The current roster writer can update `owners:{slug}:{year}`, but the confirmed owner list used by
Insights remains preseason-only and has no in-season edit path. A mid-season replacement therefore
appears in standings while membership-aware insights continue using the departed owner. Provide a
guarded in-season membership repair or converge the records under item 25's authority work.

### Item 25 — roster membership authority after publication is parked

The stopped PLATFORM-098 attempt showed this is not safely patchable with display-name equality.
Reopen, re-confirm, roster edits, one-owner/zero-team states, and reset can each make the confirmation
list, roster, and draft disagree. Resume only alongside the owner-identity-as-ID design; until then,
prefer refusing ambiguous destructive operations over guessing whether a name was removed or
renamed.

## Conditional gate before multi-user drafts or public leagues

### Item 65 — multi-writer draft gate

The current risk posture assumes one commissioner is the only draft writer and every other client
is read-only. Before members can make their own picks, complete the following in order:

1. Item 15 — pick attribution.
2. Item 14 — duplicate auto-pick attempts from multiple boards.
3. Item 13 — stable undo identity and serialized draft deletion.
4. Item 12 — remaining roster/draft writers outside the transaction authority.
5. Item 20 — bounded database waits; this item is app-wide and may be scheduled earlier.
6. Items 46 and 47 — deletion/adoption privacy and the public suppression-bypass route.

### Item 15 — double-submitted pick can be credited to the next owner

The route has an expected-owner/index guard, but the client sends only the team. A concurrent second
submission can therefore land after the turn advances and credit the team to the next owner. Send
the client's expected pick index or owner and reject a mismatch.

### Item 14 — duplicate auto-pick attempts paint spurious refusals

Every open administrative board can fire auto-pick at expiry. The serialized writer chooses one
winner, but the losing boards can surface an alarming refusal for a healthy outcome. Reconcile the
loser's response against refreshed draft state and treat an already-advanced turn as benign.

### Item 13 — undo uses a reusable slot number and deletion bypasses serialization

A delayed undo request addressed only by `pickNumber` can delete a replacement occupying the reused
slot. Give picks a stable identity or require an expected-value precondition. Draft deletion/reset
paths must participate in the same serialization and stale-write policy as other writers.

### Item 12 — remaining draft-writer serialization

Existing-draft mutations are serialized, but these writers remain outside the same authority:

- `PUT /api/owners` roster replacement;
- draft creation;
- demo auto-complete.

Keep provider/store I/O ordering compatible with the small database pool, and do not hold a
transaction client across network work.

### Item 19 — alias/store failure preempts a clean pick refusal

The pick route reads aliases before evaluating some draft-state guards. A store outage can therefore
return 500 where the stored draft already proves the pick should be refused without that dependency.
Move nonessential reads behind the cheap authoritative refusal checks.

### Item 20 — database waits are unbounded

The pool is small and has no `connectionTimeoutMillis`; database `statement_timeout` and
`lock_timeout` are zero. A caller waiting on the advisory lock is not idle, so the database's idle
transaction timeout does not protect it. Add checkout, lock, and statement bounds with explicit
operator-visible failure semantics before increasing pool size.

### Item 46 — deletion/adoption policy must precede external commissioners

Deleting a league currently removes only the registry row; owner names, drafts, archives, and other
scoped records remain. Re-adopting the slug reconnects that data. Worse, adopting a past season can
enrol it in nightly rollover, whose archive save can overwrite the genuine retained archive.

Owner decision required: true purge, explicit soft-delete/restore semantics, or retirement of
adoption. At minimum, prevent already-archived past-season adoption from triggering a destructive
rollover before multi-tenant creation is exposed.

### Item 47 — public `bypassSuppression` is an invariant and cost bypass

`/api/insights/[slug]?bypassSuppression=1` bypasses the output cache and suppression rules. On a
passwordless league anyone can force full context rebuilds and request claims normally withheld for
content safety. Decide whether to delete the public flag in favor of the admin diagnostic page or
require platform-admin authorization. This becomes P1 before any passwordless public league.

## Open Insights work

### Items 16, 18, and 53 — converge operating year and described-data year

These are one authority problem, not three independent patches:

- Overview and All Insights can choose different seasons on a drifted legacy record;
- `buildLeagueInsightContext` accepts a resolved year but still sources `context.currentYear` from
  `league.year`;
- consumers use `currentYear` for two different questions: the league's operating season and the
  season whose data is being described.

Carry two explicit fields and audit each consumer. Do not thread a requested data year through the
existing `currentYear` field; that prior attempt reached lifecycle, archive, career, roster, and
recap consumers with incompatible meanings.

- Backlog slug: `INSIGHTS-CURRENT-YEAR-AUTHORITY-v1`

### Item 30 — insight rotation and the NEW tag are trigger-gated

Trigger: resume only when generation consistently exceeds the five-card Overview feed. Rotation has
no job while every generated insight already appears.

The future model must distinguish standing facts from events. Standing facts can rotate back into
view; old events must decay. Rotation selects the feed, while NEW means the semantic signature
changed—not merely that a standing fact resurfaced. Preserve these constraints from the abandoned
attempt:

- signatures must be injective and exclude template wording;
- identity changes are evaluated before numeric tolerance;
- sub-threshold drift accumulates against the last recorded baseline;
- store failure is distinct from a cold store and falls back to stable ordering;
- selection must not order by state that its own write advances;
- weekly boundaries must be chosen deliberately rather than inherited from the Unix epoch.

- Backlog slug: `INSIGHTS-018-NEW-TAG-v1`

### Items 31–33 — finish preseason gates and superlative population conversion

Membership context and two safe career gates have shipped. Remaining gate work must first convert
the uncorrected claims in `historical` and `rivalry`:

- `historical:consistency` and `historical:improvement` measure a member-only population while
  claiming a league-wide extreme;
- `rivalry:even` uses member pairs and favors meeting volume over actual closeness;
- `historical:drought` claims a singular longest over a member-only population and mishandles ties.

Use one shared superlative authority with separate claim and naming populations. Then apply the
two-question preseason rule: content needing current-season evidence stays dark; completed-season
or accumulated facts may run. Re-audit `career:turnover_margin` under that rule rather than carrying
its old gate forward by inertia. Treat eligibility floors as copy constraints, not a reason to
reintroduce departed record holders.

### Item 34 — remaining roster×schedule insight ideas

The shared profile already computes more than current copy uses. Candidate follow-ups:

- weekly self-play occurrence, threshold two in one week;
- postseason/offseason recap connecting self-games drafted to final standing;
- unusually high owner-vs-owner game volume;
- games against undrafted teams, without calling them “free wins.”

Before adding copy, calibrate the simulated `MIN_SELF_GAMES_TO_REPORT` threshold against a real
completed season. Move the pure roster/schedule profile and related membership/superlative
derivations into `src/lib/selectors/`. Add a behavioral integration fixture for decay/variant wiring
when a seeded mid-season league is practical.

### Item 35 — career and historical copy needs explicit time framing

Career movement and `historical:consistency` can narrate an archived change in present tense during
the next preseason. Apply year/last-season framing across the affected generator branches while
preserving already-neutral historical copy.

### Item 36 — participation claims remain ungated

These claims assert current participation when membership is unknown:

- `historical:drought` — “active”/“still waiting”;
- `rivalry:dominance_streak` — “active” and present-tense pattern copy;
- `career:never_last` — “and counting.”

Gate or neutralize them as part of the superlative conversion. The completed-season recap exemption
does not apply to present-tense participation claims.

### Item 38 — retire `partial-roster` and restore selector ownership

Delete the redundant `partial-roster` source label rather than repairing it again; owner count is
already displayed independently. Move `resolveLeagueMembers`, `resolveSuperlative`, and
`buildRosterScheduleProfile` into `src/lib/selectors/` or document a deliberate selector-boundary
exception. Audit the remaining `selectAllRecords` roster-as-membership derivation and decide how its
record eligibility converges with generator-specific rules.

### Item 42 — INSIGHTS-026 notable results, stored event source, and Forward Look (In progress)

The complete request-time Look Back is recorded in `docs/completed-work.md`; do not requeue its
selectors, content families, final wiring, or member renderings. One Look Back element was never
built (portion 1 below) — it is an omission, not a requeue. Three distinct portions remain:

1. **Notable results — the one unbuilt Look Back element.** Mini scoreboards for individual games
   in the recap: a tag eyebrow with the qualifying stat (`Blowout · 35-point margin`), then two team
   lines, team primary with owner as a tertiary suffix and the score right-anchored. Row order is
   away → home per CFB convention in every state, with weight marking the winner rather than
   position. Deferred through 026b and 026c — `docs/prompt-registry.md:140` ("intentionally unwired
   until the notable-results stage") and `docs/completed-work.md:4172` ("notable-result UI remains
   deliberately deferred") — and scheduled for the final wiring pass, which closed without it. The
   underlying facts already exist; only the rendering is missing.

   **Consumes Item 87's scoreboard micro-component rather than defining its own.** POLISH-017
   shipped the consumed neutral-final row, fixed away → home order, winner emphasis, and an additive
   context slot for the qualifying-stat eyebrow/substance. This portion is now runnable without
   waiting for another Item 87 slice. Reference: `mockups/weekly-recap-mockup.html`.

2. **Stored artifact and event source.** Freeze one immutable recap per league and period so a late
   score cannot silently rewrite what members already saw, and make publication the event source
   that can unblock Item 30's NEW tag. Before implementation, settle fixed-period versus
   since-last-success windows, idempotency/catch-up, year validity, demo exclusion, scheduler
   receipts, and DST-correct ET cadence. Preserve the request-time facts layer rather than rebuilding
   it.
3. **Thursday Forward Look.** Target the immediate upcoming canonical week. This is not another
   Look Back composer: it needs upcoming-week selection plus schedule and rankings inputs the current
   loader does not gather.

Neither portion is currently selected for implementation.

### Item 43 — new preseason generators

After the truth/gating work above, add genuinely new preseason content: draft conference
concentration/diversity, AP-ranked teams per owner, schedule-strength projections, and the all-time
toilet-bowl record. Every card must add an angle a reader cannot obtain by simply reading the table.

### Item 54 — season-recap residue

- Align `deriveFinalCollapseInsight`'s span endpoint with the closing-chase calculation.
- Decide how Insights represents a final table whose top owners tie on every ranked criterion;
  current app surfaces still choose row zero while the champion card withholds.
- Converge the duplicated `insightHref` resolver before engine insights reach `StandingsPanel`.
- Move the chase docblock so it documents the exported function rather than a constant.

### Item 62 — INSIGHTS-033 is parked, not converged

The parked branch contains participation gates, two remaining superlative conversions, and
season-climb/slide work, but it exceeded the normal remediation sequence and has no confirming review
against its last commit. Resume by re-deriving against current `main`, then:

- re-check season-run semantics under the corrected week-resolution model;
- test the HTTP surface, not only direct selectors;
- resolve the remaining `dynasty` participation claim;
- update items 33/36 only after the rebuilt work actually ships.

### Item 77 — CFBD advanced analytics is an in-season discovery trial

Run only after real completed 2026 games exist. Sample a small explicit game set and measure
availability delay, null/partial fields, reread stability, identity, response size, quota cost, and
whether three representative narratives are materially better than existing box-score insights.

Compare partition-capable `/stats/game/advanced` for team-level aggregation with per-game
`/game/box/advanced`; reserve one-call-per-game fetching for quarter, player, field-position,
scoring-opportunity, or havoc detail that truly needs it. Missing advanced evidence is absence, never
zero, and cannot weaken current game-stats coverage.

- Backlog slug: `INSIGHTS-CFBD-ADVANCED-ANALYTICS-TRIAL-v1`

### Insights sequencing note (former item 44)

The current coarse order is: finish truth/gating and decide the INSIGHTS-033 rebuild; then build the
INSIGHTS-026 pulse with INSIGHTS-020 as one event source; then consider new preseason generators,
ranker/decay, History Phase 3, and Slow Draft Mode. Commissioner onboarding remains conditional on
the multi-tenant gates above.

## Polish, engineering-health, and conditional observations

### Item 48 — test-infrastructure follow-ups

- Move only genuinely cross-domain fixtures from subsystem `__tests__` directories into `src/test/`.
- Add an explicit rejection for `npm test -- <path>` only if that mistaken invocation continues;
  `npm run test:file -- <path>` is the supported focused form.
- Widen both discovery and the layout audit together if executable JS/MJS tests or tests outside
  `src/` are ever introduced. None exists today.

### Item 49 — preseason-banner observation points

Not queued unless the behavior becomes user-visible: draft facts are loaded best-effort on the
client; setup may fall back to an archive when current owners are absent; a past `scheduledAt` still
supports forward-looking “Draft scheduled” copy. Any future readiness claim must use a shared server
selector and distinguish unknown draft state from no draft.

### Item 50 — passive schedule-presentation checkpoint

No implementation work. Close deployment-runbook §8i when the first qualifying automatic
presentation refresh is observed in production evidence.

### Item 56 — POLISH-005 residue

- Rankings errors are hidden behind an endless loading state because failure leaves `rankings`
  null; model loading and error independently.
- Interactive `CFBScheduleApp` behavior lacks a harness, leaving callback wiring and the real
  `isAdmin` postseason gate structurally but not behaviorally pinned. Introduce a selected-tab seam
  or interaction harness before another feature depends on it.
- Remove write-only odds/scores snapshot state and its hook plumbing together; retain
  `scoresObservedAt`, which still feeds live-delta staleness.

### Item 59 — second preview branch behavior is unknown and conditional

The canonical preview gate documentation is corrected. The only remaining question is why the
historical `preview-codex` push produced no deployment. Investigate only if a second stable preview
branch is actually wanted; the alias/project-setting requirement is the load-bearing concern.

### Item 71 — JSDOM-heavy test startup and timeout headroom

The measured slow component file spent most time in JSDOM/module startup, not test work. Do not
split files by default because that repeats the dominant cost. Re-measure under representative host
load with streaming output, then choose explicitly between shared JSDOM per worker and a larger
per-file timeout while preserving process isolation for pid-scoped app state.

- Backlog slug: `PLATFORM-TEST-STARTUP-HEADROOM-v1`

### Item 73 — archived season-arc axis domain

Archive charts label the raw `standingsHistory.weeks` domain while trend selectors contain only
resolved weeks, producing empty leading/trailing columns. Fix sortedness/validation at the archive
read boundary, preserve real interior week distance, and decide whether an unresolved interior week
draws a continuous net-movement segment or breaks the path. Do not key a synthetic origin as week
zero; canonical week zero is real.

After the axis is correct, separately decide whether the archived chart and full trends surface
should adopt the Overview's preseason origin. The Overview implementation is complete; this is a
consistency choice, not its unfinished work.

Also decide how to prevent the true-zero games-back leader's multi-point stroke from clipping at the
top edge. Do not “fix” it by clamping the whole line downward and changing the represented values.

- Backlog slug: `POLISH-ARCHIVE-AXIS-DOMAIN-v1`

### Item 78 — post-transition standings copy for an undrafted league

Long-term cleanup. Once a league transitions to `season` without a roster, the standings surface
falls to generic “Standings unavailable” copy and loses its draft message. Reuse the draft-state
vocabulary—unscheduled, scheduled date, live, paused—without loosening the guards that prevent manual
assignment or stale draft records from making false claims. This requires server-threaded draft
state and separating draft derivation from the preseason-only banner gate.

- Backlog slug: `POLISH-PRESEASON-STANDINGS-COPY-v1`

### Item 80 — Next 16 upgrade is offseason-gated

`npm audit` reports postcss `8.4.31` as high severity. Next hard-pins that exact version in every
15.x release, so only Next 16 moves it. All four postcss advisories require attacker-controlled CSS
and this build compiles only first-party and dependency CSS, so the finding is not a forcing
function. Do not schedule the upgrade while live scoring, odds polling, and drafts are running;
the trigger is the offseason, not the audit report.

Most of the version-16 migration surface is already satisfied: `params`/`searchParams` are async
throughout, `cookies()` is awaited at both call sites, ESLint runs directly on a flat config with no
`next lint`, there is no custom webpack config, no `next/image` usage, and no parallel-route slots.

The upgrade's real work is `revalidateTag`, which requires a `cacheLife` profile as its second
argument in 16; the single-argument form becomes a TypeScript error. Five non-test call sites exist,
in `src/lib/selectors/leagueStandings.ts` and `src/lib/seasonArchive.ts`. Do not apply `'max'`
uniformly to clear the type error: that is stale-while-revalidate, whereas the current
single-argument form expires immediately. `updateTag()` supplies read-your-writes semantics but is
Server-Actions-only, and the draft write path reaches these tags through API route handlers
(`/api/draft/[slug]/[year]/{pick,unpick,reset,confirm}`), which cannot use it. Decide per call site
whether a confirmed pick may be followed by stale standings; that decision, not the rename, is the
acceptance boundary.

Raise `react` and `react-dom` off their exact `19.1.0` pin in the same slice. That pin satisfies no
band of the installed Clerk peer range, so the bump clears a pre-existing mismatch as well as
meeting the React 19.2 baseline the App Router expects.

Keep `middleware.ts` out of scope. The `proxy.ts` rename is deprecation-only in 16, runs Node-only
with a runtime that cannot be configured, and touches the platform-admin auth gate. Give it its own
slice and confirm Clerk's support first — Clerk's own `proxy` export is its Frontend API domain
proxy and is unrelated to the Next convention.

Cache Components (`cacheComponents: true`) is a separate campaign, not part of this upgrade.
Enabling it surfaces build errors for uncached data outside `<Suspense>` and requires adopting the
model; a rename-only reading of that flag is wrong.

- Backlog slug: `PLATFORM-NEXT16-UPGRADE-v1`

### Item 83 — team-identity normalization collides distinct schools onto one key

`normalizeTeamName` expands `&` to " and " and then strips the standalone "and", so `Missouri S&T`
collapses to `missourist` — the key `Missouri State` already claims through its `missouri st` alt.
`resolveName` therefore returns a resolved, ownable FBS identity for a Division II school, and the
observed-name registration loop skips the real school because the key is taken. The elision is
load-bearing elsewhere: it is what makes `Texas A&M` match its ampersand-free alts, so it cannot
simply be removed.

The identity key is a lossy function of the name and nothing asserts it is injective. The registry
resolves a conflict by silent first-write-wins (`if (!registry.has(aliasId))`, and the observed-name
loop skips a taken key), so a collision is structurally unobservable. A catalog sweep found no key
claimed by two catalog schools, but 31 keys sit in the overloaded `st` class (`ohiost`, `pennst`,
`missourist`, …) where any outside `<X> S&T` or `<X> St.` school lands on a real ownable identity.
CFBD already supplies exact numeric participant ids that disambiguate these schools; the app
persists them and forbids their use for identity.

PLATFORM-114 stopped this reaching eligibility by classifying from the provider's division label, so
new seasons no longer track phantom games. It is forward-only: it does not repair archives, and the
collision still reaches `buildPairKey`, score attachment, and roster/owner mapping.

**Also in scope: the row primary key falls back to a name.** `ScheduleItem.id` is
``String(game.id ?? `${week}-${homeTeam}-${awayTeam}`)`` (`src/lib/schedule/cfbdSchedule.ts:730`,
unchanged since 2026-03-13 and untouched by PLATFORM-114). So a row's identity is
provider-id-when-available and name-composed otherwise, and two rows differing only by a
normalization collision would collide in the key space too. It engages only when CFBD omits
`game.id`, which has not been observed here — latent, not active. Noted because it is the same
name-derived-identity problem this item owns, and Saturday's fix is easily misremembered as having
covered it.

**Confirmed historical impact (2025).** The archive audit reports Missouri State at 13-11 — 24 games,
seven beyond the 17-game FBS ceiling, i.e. Missouri State's real slate merged with Missouri S&T's
Division II slate.
Impact is contained because Missouri State was a no-claim team that season: no owner record, win
percentage, or championship is affected, and the residue is an inflated 2025 no-claim aggregate row
plus phantom rows in the archived game list. Earlier backfilled seasons (2018-2024) carry the same
pollution for the same reason and are safe for a structural one — Missouri State was not FBS before
July 2025, so it could not appear on any historical roster.

Repairing the affected archives is tracked separately as Item 85; this item covers preventing new
collisions, not correcting existing data.

**Objective: make identity numeric, and demote names to display and search.** CFBD supplies a team
id on every provider surface this app consumes, and the app discards it on two of them:
`scripts/fetch-cfbd-teams.ts` types `CFBDTeam.id` and omits it from the written catalog; the score
normalizer (`src/lib/scores/normalizers.ts`) reads names and points from the same `/games` payload
whose `home_id`/`away_id` the schedule mapper already persists. The draft is the sharper case — the
owner selects an unambiguous catalog row and `DraftPick.team` serializes it to a `string | null`
name, destroying information the app itself created at the one moment identity was certain.

There is no forward surface that requires a name. The commissioner CSV upload was a one-time
mechanism for backfilling league history, not a live path, so no compatibility floor forces name-keyed
identity to survive.

Sequence, and the ordering is the load-bearing part:

1. Land collision detection FIRST (see the acceptance boundary). A backfill resolves stored names
   through the same lossy function that caused this bug — migrate before detecting and today's wrong
   answers are frozen into ids that then _look_ authoritative, making them permanently
   indistinguishable from correct ones.
2. Persist the provider id at each ingest point: catalog fetch, score normalizer (schedule already
   does), and the draft pick at selection time.
3. Migrate stored names to ids under the assertion. Scope live state first; archives are frozen and
   are repaired on their own schedule (Item 85), so readers must tolerate both keyings rather than
   this migration rewriting history as a side effect.
4. Make the id authoritative wherever it exists; names become display, search, and provider-variant
   alias matching only.

**Store the id AND the name on durable records — the redundancy is the drift detector.** Ids are only
as stable as the provider. Persist ids alone and a re-keyed or reassigned id is undetectable: the
join still resolves, silently, to the wrong school, and archives keyed by that id become
retroactively wrong with no tell. Persist the name alongside as a witness of what the id meant when
the row was written, and any later disagreement is observable. This does not restore the name to an
identity role; it makes provider drift falsifiable.

**Drift detection.** Every `/games` row carries `home_id` with `home_team`, so the provider
re-asserts the id-to-name binding on every row of every fetch. Validating that pair at ingest gives
continuous detection on live data with no extra provider call and no scheduled job; a catalog diff at
`fetch:teams` time covers teams that appear in no game. Classify the outcomes, because they are not
equally serious:

- same id, different name — requires human adjudication. This single class covers BOTH a benign
  rebrand and a dangerous reassignment, and the system cannot safely tell them apart: `East Texas
A&M` (formerly Texas A&M-Commerce) is a real, benign instance already present in the feed. A
  rename keeps continuity — same conference, recognizably related name — but that is judgment, not a
  rule.
- same school, different id — re-keying. Needs a mapping decision before any further write.
- id no longer present — ordinarily conference realignment leaving FBS; informational.

**Posture: surface, never block.** The provider is expected to be clean, so these events should be
rare, and blocking ingest on the first rebrand of a season would break the app for a benign cause.
Ingest therefore continues. What must not happen is a SILENT rebinding of durable identity: a new
`(id, name)` observation that disagrees with the stored binding is recorded as a conflict rather than
overwriting it, and the durable rebind requires explicit operator action. That way a switch cannot
propagate into the database unnoticed while a rename cannot take the season down.

`src/lib/conferenceDiagnostics.ts` and its debug route are the idiomatic precedent for recording
this; System Health is the established surface for making an operator aware of it.

Acceptance boundary, both required:

- Two distinct schools never share a normalized identity key, proven by a catalog-wide collision
  sweep, and a conflict fails loudly instead of resolving by first-write-wins.
- Provider identity drift is detected and surfaced, and a disagreeing `(id, name)` observation never
  silently overwrites the stored binding. Ingest continues; the durable rebind requires operator
  action.
- A per-team season game-count invariant rejects an impossible schedule. The FBS ceiling is **17**
  — 12 regular-season games, plus a conference championship, plus four College Football Playoff
  rounds under the 12-team format — so the threshold must accommodate a full title run or it will
  reject legitimate seasons. This is the broader net: it catches the _consequence_ of any future
  collision regardless of cause, and a 24-game season went undetected for a full year without it.

### Item 84 — an overriding provider classification records no diagnostic

`classifyTeamSubdivision` treats the CFBD division label as authoritative over both the conference
match and the team catalog, and returns before any of the existing conference recorders run. Every
other classification source in that function records something.

Consequence: a stale provider label — plausible for a school mid-transition, as Missouri State and
Delaware both were on joining Conference USA — silently classifies both sides non-FBS, drops the game
from the schedule, and emits nothing an operator can see. Deferred from the PLATFORM-114 review as
additive scope needing its own recorder and coverage.

Acceptance boundary: when the provider label contradicts the catalog classification, the disagreement
is observable without changing which one wins.

### Item 85 — repair archived seasons polluted by the identity collision

Low priority, but a genuine to-do rather than an accepted loss.

The 2025 archive merged two schools under one identity: the archive audit reports Missouri State at
13-11, which is 24 games against a 17-game FBS ceiling — its real slate plus Missouri S&T's Division
II slate. Impact is contained because Missouri State was a no-claim team that season, so no owner
record, win percentage, or championship is wrong; the residue is an inflated no-claim aggregate row
and phantom rows in the archived game list. **Verified 2026-08-29: only 2025 is affected.** The archive audit was run across every existing
season (2018, 2021-2025; 2019 and 2020 have no archive, matching the six seasons the league has
played). Maximum per-team game counts are 15, 15, 15, 15, and 16 for the pre-2025 seasons — all
legitimate — against 24 for Missouri State in 2025, the only breach of the ceiling in roughly 5,500
archived games. Missouri State is unrostered in every pre-2025 archive. Residual limit: the audit's
per-team table covers ROSTERED teams only, so phantom games attributed to an unrostered team in an
earlier season would not appear; nothing owner-facing is affected either way. Scope is therefore one
season and one team.

PLATFORM-114 is forward-only: it stops new seasons tracking these games but does not touch frozen
archives. Re-derivation is feasible now that eligibility classifies from the provider division label,
but requires the affected season's schedule cache to be refreshed first so its rows carry the
classification the rebuild reads.

Handle with care: this rewrites completed seasons, including a championship year. Prefer a
verifiable, reversible path — audit and diff before writing, and preserve the prior archive — over an
in-place rebuild.

Acceptance boundary: every archived season's per-team game counts fall within the 17-game ceiling,
no archived FBS team's schedule contains a Division II opponent, and owner-facing records are
unchanged by the repair (they are already correct — the repair must prove it does not disturb them).

### Item 86 — the archive audit's integrity check can never pass

`renderSection1Summary` (`src/app/api/debug/archive-audit/route.ts:244-247`) prints
`wins == losses (expected for a closed game universe)?` and reports `NO` in every archived season —
2018, 2021, 2022, 2023, 2024, and 2025 — because the premise does not hold. The universe is not
closed while any FBS team goes unrostered: a rostered team beating an unrostered opponent books a win
with no matching rostered loss. In 2018 that is a 106-8 record against unrostered teams, exactly the
98-game gap the check flags.

A check that fails unconditionally is worse than no check, because it trains an operator to skip the
line where a genuine integrity failure would appear. This matters now specifically: the archive audit
is the tool the Item 85 repair will be verified with.

The meaningful invariant, derived by hand while investigating and closing exactly in all six seasons:

- `bothRostered = teamGames - archiveGames`, `oneRostered = archiveGames - bothRostered`
- `winsVsUnrostered + lossesVsUnrostered == oneRostered`

That form accounts for the open universe and is sensitive to missing or duplicated games, which the
current form is not.

Acceptance boundary: the integrity line reports a pass on all six existing archives, and fails when a
game is injected, dropped, or duplicated in a test fixture. A replacement that cannot be shown to
fail on corruption is the same defect wearing a passing badge.

### Item 87 — rework Overview game listings as a scoreboard

Presentation and information-architecture half of the Overview games region. POLISH-015 delivered
the interim correctness and empty-copy fixes on this surface. POLISH-016 / slice 1 then shipped the
shared scoreboard contract and converted the Live section; POLISH-017 / slice 2 converted Featured
and settled green-live on Overview; POLISH-019 / slice 3 added Recent finals and structural
promotion. **POLISH-020 / slice 4 converted the Watchlist**, merged 2026-09-03 via PR #558
(`c730b4d0`). **Slice 5a** (shared-component contract widening, split out 2026-09-03) and
**slice 5** (Schedule) remain; Matchups is Item 117, not a slice.

**Problem observed on `/league/tsc` during the 2026 opening slate (2026-08-29).** One game appeared
twice on a single screen — in "Upcoming watchlist" and again in the "Live" tile — and the Live card
printed its own matchup name twice. Four cards filled the viewport, most of the vertical space going
to chrome: three of four carried a `Top matchup` chip, ranks were rendered inline AND as a chip AND
as a section eyebrow, and scheduled rows ended in an empty `———` box.

Remaining root cause:

- The same conceptual object still has multiple renderers. Slices 1–4 moved Overview Live,
  Featured, Recent finals, and Watchlist onto the shared scoreboard anatomy, but `GameSummaryList`
  remains bespoke alongside `GameScoreboard` on Matchups and the recap primitives. The remaining
  Item 87 slice (5) completes the Schedule transition.

**Settled decisions (owner, 2026-08-29).** The governing criterion for any marker is that it be
TRUE and VALUABLE to the reader; scarcity is not the test, and chips are not capped. See `DESIGN.md`
→ Cards and game results for the rules these produced.

- One chronological scoreboard list. Live and scheduled are the same row type distinguished by status
  chip, so the duplication has nothing to filter — it cannot occur. This supersedes POLISH-015's
  interim state-specific ordering and exclusion rules.
- Right-edge anchor is the score, or the kickoff time when there is no score. The `———` placeholder
  violates the trailing-whitespace rule and carries no information.
- Rows expand in place; tapping discloses rather than navigating. **Not delivered by any slice** —
  `CompactGameScoreboard` has no disclosure mechanism; tracked as [[Item 112]], not restated here.
- Chips get category names ("Top 25 Matchup"), which also resolves the overload below.

**RESOLVED by slice 4.** The `Top matchup` label was false — `gameTags.ts:441` fired the chip from
`isTopOwnerGame`, true when EITHER participant's owner is in the top three (meaning "a contender is
playing," not matchup quality), while `deriveOverviewHighlightSignals` picked a DIFFERENT game per
slate by a composite score and rendered the same words as an eyebrow. The two disagreed in production.
Slice 4 renamed both to what each measures — the chip is now `Contender Watch`, the eyebrow is now
`Game of the Week` — in the shared `gameTags.ts`/`overview.ts`, so this applies everywhere the chip
renders, not just Overview.

L1 disclosure content already flows to this surface and is currently discarded: schedule rows carry
`media` (broadcast outlet) and full venue, `CombinedOdds` is already threaded into `GameScoreboard`,
and `historySelectors` computes owner head-to-head records. Delivering it is [[Item 112]]'s scope, not
restated here.

Acceptance boundary:

- No game appears in more than one place on Overview, enforced structurally rather than by a filter.
- Every chip rendered is true by its own definition.
- Opening a row shows the detail that justifies it — delivered by [[Item 112]], not this item.
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

PLATFORM-115 raised the CFBD request ceiling to 40s at four call sites. Its scope was enumerated
from three files that happened to be open rather than a repo-wide sweep, so it missed the rest. The
item shipped what it promised and its acceptance boundary held; the scope was wrong, not the work.

**This is a completeness fix, not an urgent one.** Two urgency framings were tried while filing it
and both were wrong; they are recorded so they are not re-argued.

- _Rankings staleness_ — rankings runs twice daily against a poll that changes weekly, so roughly
  fourteen attempts cover each meaningful update. The 2026-08-30 22:00 UTC failure
  (`rankings-provider-fetch-failed`, both partitions, `durationMs: 36838`) left members on the
  preseason AP poll for about five hours; a manual `bypassCache=1` refresh recovered it at 03:01 UTC
  (`rowsCommitted: 1`, `durationMs: 9749`), but the 04:00 run would have done the same unattended.
  Rankings has the BEST redundancy of the nine sites, so it is the weakest case for the fix even
  though it is what exposed the gap.
- _Schedule redundancy_ — the weekly Tuesday 12:00 UTC refresh does have a single shot and the widest
  blast radius, but **schedule cadence belongs to Item 63**, which already owns the in-season ramp as
  the main lever on score-repair latency. Borrowing that argument here double-counts it.
- _Schedule timeout evidence_ — the 2026-09-01 12:00 UTC weekly invocation reached provider work and
  returned `failure / year-results` after 37,124 ms. That duration closely matches three 12-second
  attempts plus retry backoff/pacing. A same-day rankings attempt explicitly failed both CFBD
  partitions after 36,917 ms, and a later manual full-season schedule refresh succeeded in 4,249 ms
  through the unchanged shared authority. This strongly supports a transient schedule-partition
  timeout, but does not prove the failed partition or rule out every transient transport/store
  alternative. The durable-evidence defect exposed by the incident belongs to Item 126. The separate
  2026-09-03 `401 invalid cron authorization` stopped before provider work and is not timeout
  evidence.

What justifies the item on its own terms: the ceiling was judged wrong and changed in four places;
nine more carry it, and both rankings and full-season schedule production paths now have matching
failure evidence. That is enough to review the remaining call sites without borrowing a cadence
argument.

Sequencing: a natural companion to Item 60's two low-severity follow-ups since both touch
`rankings/refreshAuthority.ts`.

Still at `timeoutMs: 12_000`:

| Call site | Notes |
|---|---|
| `src/lib/rankings/refreshAuthority.ts:105` | **Worst configured.** `maxAttempts: 3`, and `fetchUpstream.ts:158` retries timeouts regardless of `retryOnHttpStatuses`, so each failure burns THREE billed calls. 3 x 12s matches the observed 36838ms almost exactly. |
| `src/app/api/schedule/route.ts:345` | |
| `src/lib/schedule/fullSeasonScheduleFetch.ts:61` | September 1's 37,124 ms weekly failure is the production signal; exact timeout/partition remains an inference because Item 126's evidence was not retained. |
| `src/lib/schedule/schedulePresentationRefresh.ts:275`, `:516` | |
| `src/app/api/conferences/route.ts:166` | |
| `src/app/api/game-stats/route.ts:325` | non-cron path |
| `src/app/api/admin/cache-historical-scores/route.ts:53` | |
| `src/lib/odds/oddsRefreshExecutor.ts:422` | **Different provider** (The Odds API), which stayed healthy through the CFBD degradation. Decide separately; do not sweep it in on pattern-match alone. |

`src/app/api/admin/team-database/route.ts:33` sits at 15s — same question, different value.

Use `CFBD_PEAK_LATENCY_TIMEOUT_MS` (`src/lib/api/cfbdRequestPolicy.ts:7`) for any deliberately
more-patient attempt rather than introducing a second peak-latency constant. **Do not mechanically
turn all three 12-second attempts into three 40-second attempts.** A timed-out request bills
(measured: `/info` costs 0, a completed call 1, an aborted call 1), so retries multiply spend during
exactly the condition that causes them; they also multiply worst-case wall time. Evaluate fewer,
more-patient attempts and the total route budget together. The weekly schedule-refresh route still
relies on the platform's default duration, so give it an explicit envelope before increasing the
single-attempt ceiling and retain enough margin for completeness, durable commit, score sweep,
status, and response work.

Acceptance boundary: no CFBD-consuming call site carries a ceiling below the shared constant without
a recorded reason; each converted site's attempt count, maximum billed calls, and worst-case wall
time are deliberate and proven to fit its explicit route/runtime budget; no conversion increases
provider spend merely by multiplying longer timeouts; and a repo-wide `timeoutMs` sweep is part of
verification, not scoping — that omission is what produced this item.

### Item 94 — measure the first full in-season month of CFBD burn (READ 2026-09-30)

**TIMING IS THE WHOLE ITEM — corrected 2026-09-04, and the title was wrong.** `/info` reports
`used`/`remaining` **for the current period only** (`providerQuota.ts:41-43`), the period is calendar
monthly (the 2026-08-31 reading recorded `resets 2026-09-01`), and CFBD exposes **no history**. So a
call made in October returns October-to-date and **September's total is unrecoverable** — the counter
reset and nothing else in this system can reconstruct it. `provider-refresh-status` is latest-only
(Item 126 layer 3) and the app does not durably count provider calls, so an in-period `/info` read is
the ONLY source.

**Read it on 2026-09-30, as late in the day as practical.** The body of this item already says
September — "the first month containing four or five Saturdays of live polling" — while the heading
said October; the heading was the error. Miss the date and the answer slips a full month, silently,
with nothing indicating the number was lost.

**Better than one reading: sample it — now filed as Item 127.** The app already probes `/info` on the
game-stats cron for its spend gate and discards the result. Item 127 does not retain that one — a
second writer on one durable row proved to cost more than the resolution it bought — and instead adds
an unconditional sample on its own six-hourly QStash schedule, four unbilled `/info` requests a day. **If Item 127 ships before 2026-09-30 it supersedes this manual read**, and
removes the cliff where missing one date costs a month. Until then this item stands as the fallback.

**Gates TWO decisions, not one — noted 2026-09-04.** Item 95 portion 2 has always been gated on this
for its quota cost. After Item 102 ships, the armed-hour count this produces is _also_ the input for
whether the planner's freed Active CPU covers a faster in-window cadence: both axes scale with armed
hours, so one number answers both. That raises this item's leverage well above its effort — it bills
0 and requires no development.

**A scheduled measurement, not development work.** Read `GET /info` (which bills 0) after the
September reset and record the month's actual usage.

Live reading 2026-08-31: **Tier 1, 5,000/month, 395 used (8%), `sharedPool: true` across `cfb` and
`cbb`, resets 2026-09-01.** That 395 is NOT representative — the season began ~2026-08-29, so almost
all of August was preseason with no live-score polling, no game-stats archive runs, and minimal odds.
**September is the first month containing four or five Saturdays of live polling**, plus game-stats,
odds, rankings, schedule maintenance, and — if PLATFORM-117 has landed — records.

Tier map (`src/lib/api/providerQuota.ts:25-33`): `0→1,000  1→5,000  2→30,000  3→75,000  4→125,000
5→200,000  6→500,000`. Tier 2 is a 6x jump for a Patreon subscription step, so headroom is cheap to
buy **once there is evidence it is the binding constraint.**

**What this measurement decides, and what it does not.**

- **Decides:** whether cadence is quota-bound. Item 63's in-season ramp, the live-score interval, and
  PLATFORM-117's records refresh floor are all "how often can we afford to ask", and a 6x headroom
  would change those answers. Item 63 is already gated on accumulated observation; this is that
  observation.
- **Does NOT decide:** the cron-spends / client-reads split (PLATFORM-086B2B, PLATFORM-075). That
  boundary is architectural, not budgetary — a client-triggered provider call costs a multiple of
  how many people have the page open, which is unbounded, and raising the ceiling on an uncontrolled
  multiplier is not a fix. The quota reserve check is likewise a runaway-loop detector; a bug that
  burns 5,000 calls burns 30,000 just as happily.

Do not raise the tier pre-emptively as headroom. Raise it in response to a measured constraint,
because an unexplained jump in burn rate is a signal worth keeping legible.

- Backlog slug: `PLATFORM-CFBD-BURN-RATE-v1`

## Planned and parked campaigns

These are valid future campaigns but are not activated implementation work:

- **INSIGHTS-017-PALETTE** — rationalize category microlabel collisions under `DESIGN.md`'s color
  semantics.
- **INSIGHTS-RANKER-TUNING + INSIGHTS-PRIORITY-DECAY** — make base weights commensurable, add sample
  depth, then replace binary freshness cliffs with archive-anchored decay. Engine insights currently
  sort by raw `priorityScore`; they do not pass through `OVERVIEW_TYPE_PRIORITY`, so decide whether a
  type-level bonus authority should exist before tuning it. If decay ships it absorbs
  `INSIGHTS-FRESH-WINDOW-ANCHOR` and may retire `fresh_offseason`.
- **Pairing Cards, Luck Score, Bounce-Back** — planned generator/product ideas; no queue position.
- **Slow Draft Mode** — requires member write authority, notifications, and the item 65 gate.
- **Draft Difficulty Settings** — limited to neutral factual context; do not restore SP+/win-total
  recommendations or non-random auto-pick.
- **PLATFORM-087 Registry Integrity** — two-phase campaign: truthful malformed-element handling at
  every read edge, then writer gating and an explicit salvage path in the same shippable phase.
- **Server Action Auth Hardening** — future commissioner-role enforcement and removal of public
  token fallbacks; platform-admin action guards already belong to completed work.
- **Team-catalog source unification** — move draft/runtime consumers to the durable catalog, with a
  visible divergence guard as an optional interim step. Draft writes are first. **Scope widened
  2026-09-02: there are now THREE CFBD-derived team snapshots, not two**, and none reports drift
  against the others:

  | Snapshot | Scope | Contents | Refresh |
  | --- | --- | --- | --- |
  | `src/data/teams.json` | 138 FBS | stripped seed — no `providerId`, no `id` | `npm run fetch:teams` |
  | durable `team-database` | 138 FBS | full: `providerId`, mascot, classification, colours, logos, alts | admin sync |
  | `src/data/odds-team-mascots.ts` | **928, all divisions** | school, mascot, classification, alts | **no script at all** |

  The third arrived with PLATFORM-122 and is the least governed of them. It was kept separate for a
  real reason — the catalog is the FBS IDENTITY AUTHORITY, `buildScheduleFromApi` treats an empty
  catalog as unavailable rather than "no teams", and a non-FBS entry could mint a canonical identity
  (PLATFORM-114's Westgate Christian / Missouri S&T collision). But that argues for how the boundary
  is EXPRESSED, not for a third file: `TeamCatalogItem` already carries `classification` and `level`,
  so one all-divisions snapshot whose identity consumers filter to `fbs` is representable today. The
  trade is that the filter must then be correct at every consumer, where separate files get it for
  free by not holding the data. **That is a design decision for this campaign, not a cleanup.**
  Item 107c is the symptom that surfaced it.

  **Owner direction, 2026-09-02 — prefer CFBD provider ids over derived internal identity wherever a
  join makes sense.** This is the sharper framing, and it may REDUCE the campaign rather than widen
  it. Three failures in one day all came from name- or catalog-mediated joins, not from having three
  snapshots:

  - Item 106 — odds matching went canonical name → catalog metadata, and the FBS-only catalog could
    not strip a non-FBS mascot. 48 events discarded.
  - Item 87 slice 4 — the records join was specified as canonical name → catalog `providerId` →
    record, and could not reach an FCS opponent for the same reason.
  - Both were unblocked by using a CFBD pid directly.

  **The pid path is measurably complete where it matters.** Records join pid-to-pid —
  `ScheduleWireItem.homeId`/`awayId` against `TeamRecordItem.teamId`, the same id space — at
  **1,776 of 1,776 team lines across every FBS-involving 2026 game, zero misses**, reaching FCS
  opponents because CFBD assigns pids below FBS. Game ids are universal: **22,760 of 22,760 rows**
  across seven cached seasons carry a numeric, safe-integer `id`.

  **The consequence for scope:** the catalog's FBS-only boundary is only a problem because it is being
  used as a BRIDGE. If joins key on pids, the catalog can stay FBS-only as the identity authority —
  which is what PLATFORM-114's collision history requires — without blocking any consumer. That
  argues for converting joins before, or instead of, merging snapshots.

  **Known coverage limit:** participant ids (`homeId`/`awayId`) are absent for 2018 (0 of 1,556 rows)
  and complete from 2021 (100%). 2019-2020 are uncached. A pid-keyed join reaching into history hits
  that wall; a current-season one does not. See Item 105 for the deferred backfill and why it was not
  taken.
- **Server Fetch Architecture** — scoped low-priority fixes for internal HTTP context loaders; do not
  perform a broad rewrite.
- **League State vs Season State** — deliberate product/architecture fork, not a 2026 blocker.
- **Multi-tenant Commissioner Sign-up** — conditional on real multi-league usage and the privacy,
  owner-identity, and multi-writer gates in this queue.
- **Design, copy, back-button, lifecycle-label, and link-styling audits** — polish campaigns to
  activate individually.
- **History Phase 3** — career stats surface, record scoring, Stats/Rivalries/Archive wiring, and
  insight-link retargeting. Sparse-data layout and dynamic tiling remain evidence-gated design work.
  Archive wiring carries a known, owner-observed defect (2026-08-27, `/league/tsc/history/2025`):
  the season-arc chart renders `MiniTrendsGrid`, whose `CONTENDERS = 5` **excludes** every owner
  outside the top five, undisclosed, directly beneath the complete final standings table — so the
  chart and the table under one heading describe different populations, and the axis maximum
  reflects only the retained subset. The standings page's `TrendsDetailSurface` answers the same
  question correctly: its `TOP_FOCUS_COUNT = 5` governs emphasis, not membership, and it draws every
  owner. Owner direction: the archive should reuse that surface, with its Games Back / Win % tabs,
  rather than keeping a second capped implementation. Treat item 73's axis-domain work as LIKELY
  ABSORBED by the swap — `TrendsDetailSurface` derives its domain from resolved weeks instead of the
  raw history — but verify rather than assume, because the archive still supplies the history and the
  leading/trailing week problem may survive the change.
- **Homepage brand identity** — trigger near public launch after surfaces stabilize.
- **Orphaned `/rankings` route** — owner decision required before retiring a potentially bookmarked
  single-tenant route.
- **Postseason start week from schedule** — revisit before an unusual CFP structure invalidates the
  current constant.
- **Header architecture unification** — separate Polish slice after header structure stabilizes.
- **Per-league standings invalidation optimization** — current alias writes are global/year by
  design; schedule only if a different targeting basis is demonstrated.

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

## Hosted deployment runbook

Use `docs/deployment-runbook.md` for hosted environment setup, activation, production observations,
and operator checkpoints. Operational observations are not implementation queue items unless they
surface a defect.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as technical debt unless
explicitly scheduled.
