# Next Tasks (Active Queue)

Status: Current
Last verified: 2026-08-29
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

`CURRENT`: Item 42, Slice 3 record changes.
`NEXT`: Item 42, Slice 4 odds upsets.

The 2026-08-26 roadmap audit recommends this season-reliability sequence after the current slice;
it is proposed ordering, not an owner-selected `NEXT` designation:

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
elapsed-time conclusion diagnostics are the instruments; both are merged but were unpromoted as of
2026-08-29, so no production rate exists yet. Measure before choosing a cadence — the quota cost of a
ramp should be justified by an observed repair rate, not by this mechanism's existence.

- Backlog slug: `PLATFORM-RESCHEDULE-DETECTION-v1`

### Item 64 — remaining week-resolution residue

Only one PLATFORM-105 follow-up remains:

- **(c) Abandonment is not applied to week resolution.** `selectSeasonContext` can accept an old
  pending game as abandoned, while `isResolvedWeek` still leaves that week unplayed forever. Apply
  the shared conclusion policy consistently so historical trends do not drop the affected week.

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

### Item 42 — INSIGHTS-026 weekly recap and event source (In progress)

The request-time Look Back skeleton, layout, and Slice 2 detail layer are complete. The recap is
scoped to the league's exact active season, selects the immediately preceding eligible canonical
week after the next-day 06:00 ET cutoff, and renders at the top of the existing Insights page. Its
Overview tile consumes the same server-coherent recap view model, reevaluates the request-time
boundary independently from client schedule readiness, and remains visible if client schedule
bootstrap fails. Standing/durable insights remain independent and are inherited alongside the
recap rather than replaced by it. Slice 2 adds week-explicit movement, owner-vs-owner detail, and
weekly accolades while deliberately leaving notable-result UI unwired for the final wiring pass.

Continue the request-time portion vertically:

- **CURRENT — Slice 3:** add the allowlisted partial-season record-change projection.
- **NEXT — Slice 4:** add odds upsets through a shared odds-upset policy helper.
- Final wiring/pass: fill the existing Overview tile from the completed fact families and remove the
  dead prior pulse view-model fields.

This request-time campaign does not close item 42. A later stored artifact must add immutability and
become the event producer that can unblock item 30's NEW tag. Before that work, settle fixed-period
versus since-last-success windows, idempotency/catch-up, year validity, demo exclusion, scheduler
receipts, and DST-correct ET cadence.

Thursday Forward Look is separate future work. It targets the immediate upcoming canonical week of
games and needs schedule/rankings inputs not gathered by the Look Back loader. INSIGHTS-020
record-change work contributes to this campaign rather than preceding it as a standalone feature.

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

### Item 82 — Overview games region: ordering, labelling, and empty states

Three defects on one surface, observed together on `/league/tsc` during the 2026 opening slate
(2026-08-29). Fix them as one slice — they share a component, a review, and a set of fixtures.

**(a) The Upcoming watchlist ignores time.** `prioritizeOverviewItems`
(`src/lib/selectors/overview.ts:428`) orders the list as `topMatchupKey`, then upset watches, then
`rankedHighlightKey`, then everything else in input order. Input order is chronological, so the tail
is correct; only the single top-matchup designation jumps the queue, and it is chosen purely on
matchup quality with no time term anywhere. Observed effect: a Sep 6 game led three games kicking off
within the hour, because weeks 0 and 1 share a bucket and it was the best matchup in that bucket.

Preferred fix: let **position carry time and the badge carry quality** — sort strictly
chronologically and keep the existing "Top matchup" tag. That deletes the three `pushByKey` calls
rather than adding a horizon constant or a decay curve, and the tail already sorts correctly.
Rejected alternatives: a time-bounded candidate set (another threshold to defend) and
priority-decay-by-distance (most tunable, most to get wrong).

**(b) "Featured games" is mislabelled.** The section renders `viewModel.recentResults` — completed
games only — and its own empty copy admits it: "No recent results yet—completed games will appear
here." An empty box under a heading promising curation reads as broken rather than as "nothing has
finished yet." Rename to match the data, or change the data to match the name.

**(c) The empty copy makes a promise.** "…completed games will appear here" is the shape `DESIGN.md`
records as a past mistake in the trend empty state, where "will appear here" promised data that could
never arrive. Lower stakes here since results do arrive, but the pattern is named in the design doc.

Also consider section order while in here: Featured games → Upcoming watchlist → Live games means a
dead results box sits above the live section during a slate, when live is the most valuable thing on
the page.

Related but separate: item 38's dead-code cluster (`leagueHighlights`, `deriveLeagueHighlights`,
`leaguePulse`, `shouldShowLeaguePulse`, `keyMovements`). `25d9bc86` removed the last live consumer of
`leagueHighlights` — a stale gate that hid the watchlist entirely — leaving only unread producers.

- Backlog slug: `POLISH-OVERVIEW-GAMES-REGION-v1`

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

**Confirmed historical impact (2025).** The archive audit reports Missouri State at 13-11 — 24 games,
seven beyond the 17-game FBS ceiling, i.e. Missouri State's real slate merged with Missouri S&T's
Division II slate.
Impact is contained because Missouri State was a no-claim team that season: no owner record, win
percentage, or championship is affected, and the residue is an inflated 2025 no-claim aggregate row
plus phantom rows in the archived game list. Earlier backfilled seasons (2018-2024) carry the same
pollution for the same reason and are safe for a structural one — Missouri State was not FBS before
July 2025, so it could not appear on any historical roster.

**Governing decision:** do not re-derive the 2025 archive. Re-deriving a completed championship
season to remove rows that affect no owner is a destructive operation on historical truth with worse
downside than the defect. The corruption is documented here and left in place.

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
   answers are frozen into ids that then *look* authoritative, making them permanently
   indistinguishable from correct ones.
2. Persist the provider id at each ingest point: catalog fetch, score normalizer (schedule already
   does), and the draft pick at selection time.
3. Migrate stored names to ids under the assertion, live state only. Archives are frozen and are
   deliberately not re-derived (above), so readers must tolerate both keyings rather than the
   migration rewriting history.
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
  reject legitimate seasons. This is the broader net: it catches the *consequence* of any future
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
  visible seed-vs-durable divergence guard as an optional interim step. Draft writes are first.
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
- **Expected-absence applicability for scores, odds, and rankings.** A genuinely cold deployment can
  still show neutral absence as degraded health. Each dataset needs its own applicability authority;
  do not generalize the game-stats slate rule.
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
