# INSIGHTS-026C — Forward Look verification

Status: Merged 2026-10-08 as db292b28, with the bootstrap snapshot race accepted under #888
Date: 2026-10-06
Implementation: `82c68872`; first remediation `2ec3634a`; second remediation `99c284ff`; baseline-only third round `4a3121d9`; base `11a4b98a`
PR: [#887](https://github.com/znpruitt/cfb-app/pull/887)

## Behavioral choices

- The existing recap calendar selects the changeover. Forward Look targets the next canonical week
  after the latest recap-eligible week; it never skips an empty target to find a later story.
- Already-kicked games are excluded from preview candidates. Completed results can inform standings
  and rivalry history. Disrupted, placeholder, unresolved-participant and unconfirmed-time games are
  also excluded from candidates.
- Odds must be `latest`, captured less than **24 hours** ago, not future-dated, and attached to the
  immediate canonical week. One day is the explicit freshness budget for a current-price claim;
  extending the horizon would require changing both the target checks and their tests. Lines expire
  at the earlier of kickoff and capture-plus-24-hours, including on an already-open client.
- Standings implications compare derived win totals, not hypothetical rank changes. A one-win gap
  can close to a tie; the copy does not promise a tiebreaker outcome.
- Tight rivalry candidates require at least four recorded decisions and a win difference of at most
  one. Streak candidates require at least three consecutive wins from ordered meetings, including
  current-season results. Canceled games do not count as meetings. Unknown results and ambiguous mixed-winner time groups
  stop a streak; skipping an intervening unknown could claim a streak that has already ended.
- Five total narrative slots, at most two per family, with one story per owner pair per collision
  family. Transport retains all candidates; the client filters expiry before ranking and capping,
  so later qualifying games replace expired stories. Families contribute independently. An applicable
  empty tile names its week; inapplicable scope renders nothing.

## Second-round gates (historical)

The frozen second-round code commit `99c284ff` passed `lint:all`, `npx tsc --noEmit`, `npm run build`,
focused tests and `npm test`, each exit 0, with HEAD unchanged and the worktree clean. The full suite
passed **5,644 tests, zero failures and zero skips**. Both reviewers examined this same commit. The initial
sandboxed build could not fetch the existing Google Fonts dependencies; the network-enabled build
passed. The branch's pre-push `lint:all` also passed.

**Test delta: 26 added, none removed.** Existing assertions were not weakened. Added coverage spans
16 selector/composer/parser tests, two tile tests, one Chrome test, three full-app integration tests,
one API-to-client-parser test, two hook tests, and one loader fault-isolation test. The Chrome test clicks the real React
button at 320, 390, 820 and 1280px and measures normal-flow podium displacement and horizontal overflow.
Exact-viewport screenshots were inspected at 390 and 1280px.

## Mutation evidence

Each mutation was restored before the next control/gate. Mutations below exited 1 with the named
assertion; the unmutated focused suite exited 0. The pre-fix-slot mutation disables only the new
Forward Look branch, restoring the previous empty-slot behavior without breaking compilation.
All 28 first-remediation mutation/observer checks ran in an isolated copy of that tree; the 9–1
mutation targets only lopsided histories so it reaches its own ordered-streak assertion.

Selector assertions are in
[`forwardLook.test.ts`](../../src/lib/selectors/__tests__/forwardLook.test.ts), tile assertions in
[`ForwardLookTile.test.tsx`](../../src/components/recap/__tests__/ForwardLookTile.test.tsx), and
integration assertions in
[`CFBScheduleAppRecap.test.tsx`](../../src/components/__tests__/CFBScheduleAppRecap.test.tsx).

| Mutation | Named assertion that failed |
| --- | --- |
| Move shared ET cutoff from 6 to 7 | `06:00 ET occupies the zone`; integration cannot find `Week 6 ahead` |
| Remove candidate kickoff check | `only the unstarted immediate-week game is eligible` |
| Reverse the standings-proximity gate | `league stakes outrank AP profile` |
| Expand odds age from 24 hours to 45 days | `reject 2026-10-07T10:00:00Z` |
| Remove immediate target check | `later-week API misuse is refused` |
| Remove immediate game-week check | `later rows cannot smuggle prices into the immediate target` |
| Substitute aggregate home wins for streak when home wins ≥9 | `the same 9–1 aggregate with a last-game loss is not a live streak` |
| Suppress tight aggregates below 20 meetings | `even aggregate earns a rivalry line` |
| Omit current-season rivalry meetings | `current-season win extends archived streak` |
| Raise family cap from 2 to 5 | `family cap prevents a dominant family taking three slots` |
| Collapse composer when no standings qualify | `empty families retain orientation` |
| Remove client expiry filtering | `odds expire without removing standings` |
| Accept partially malformed parsed line arrays | parser test expects null for malformed `expiresAt` |
| Keep disclosure permanently hidden | `click opens the narrative` |
| Return null from empty tile | tile test cannot find heading `Week 6 ahead` |
| Require every family before rendering | independently-empty-family test cannot find `View the week ahead` |
| Restore pre-fix empty-slot branch | integration cannot find heading `Week 6 ahead` |
| Alter standing Insights descriptions only when Forward Look occupies the slot | `Insights content stays unchanged` |
| DOM observer control: append watchlist text only with Forward Look | `watchlist content stays unchanged` |
| DOM observer control: alter scoreboard grid style only with Forward Look | `scoreboard content and geometry stay unchanged` |
| Disable story-key deduplication | `one story per owner pair per family` |
| Cap before filtering client expiry | `eligible evening stories backfill expired daytime stories` |
| Restore kickoff-date filter before canonical standings | `undated finals still count toward canonical wins` |
| Include canceled meetings | `rawStatus cancellation is not a meeting result` |
| Propagate family exceptions | `family exception does not abort composition` |
| Propagate preview assembly failure | `preview assembly failure preserves recap` |
| Propagate recap assembly failure | `recap assembly failure preserves preview` |
| Route recap-only loader through both composers | `recap-only page never composes the preview` |

The national-ranking fixture uses the real `selectOverviewViewModel` as its positive control:
`national curation chooses the other game` stays green under the reversed league-proximity mutation,
while `league stakes outrank AP profile` fails. The watchlist and scoreboard mutations are explicitly
observer controls; their production modules are unchanged by this slice.

## Review

Both initial reviews targeted `82c68872` against `11a4b98a`, and both returned before remediation.
Codex found no credible P0/P1/P2, with four DOM-null assertions violating the React-node diagnostic
rule. `/code-review` identified repeated pair headlines, lost expiry backfill, failure coupling and
null-result streak treatment, plus smaller efficiency/reuse/comment findings.

The one remediation (`2ec3634a`) addresses repeated stories and backfill, isolates families and both
occupant composers, restores recap-only assembly on the Insights page, uses canonical standings for
undated finals, shares the compact header, fixes the stale comment and compares DOM nullness as
booleans. Cancellation and unresolved results now have separate tests. No measured malformed-archive
crash is claimed: fault isolation is pinned with injected failures.

Two suggestions were not adopted:

- Removing the upset selector's immediate-target/row checks conflicts with the owner's explicit
  requirement to make later-week extension hard. Both checks call the existing recap selectors;
  neither introduces another calendar definition.
- Skipping all unknown rivalry results would manufacture continuity across a potentially lost game.
  Canceled games are skipped; unresolved intervening games conservatively suppress a live claim.

Pre-cutoff preview computation remains request-time, using the same gathered context and no extra
reads. Lazy computation is an optional optimization, not a demonstrated correctness defect.

Both confirming reviews targeted `2ec3634a`. Codex found no remaining credible P0/P1/P2 or required
rule failure; it independently passed 33 focused tests and five mutation checks. `/code-review`
confirmed the accepted fixes but found a reachable same-day freshness defect, rating it P2/P3
conditional on an owner exemption for the daily refresh model. No such exemption was given: the
implementer reproduced the false present-tense claims and treated this as **unresolved P2 at that stop** (resolved in round two).
At that point the branch was stopped, not merge-ready. No second remediation was attempted until
the owner explicitly authorized the narrow final round below.

### P2 reproduced at the first stop — resolved by round two

Synthetic reproduction, using the real composer and visibility selector on `2ec3634a`:

1. Saturday October 10 at 06:00 ET: Alice and Bob have equal current-season wins, with five ordered
   archived Alice wins. Their two upcoming meetings kick off at 12:00 and 19:00 ET.
2. At 17:00 ET, Bob has won the noon game. Keep the morning response mounted and advance its client
   clock. The later meeting backfills with both `Bob and Alice can break their wins tie` and
   `Alice puts a 5-game rivalry streak on the line`.
3. Recompose from that same context with the noon final included. The correct output is
   `Bob and Alice meet one win apart`; no rivalry streak qualifies.

Assertions pinning all four observations passed. This is a synthetic reachability proof, not a
measurement of production frequency. The earlier report overstated the daily-only refresh path: the app already called `refreshInsights`
for observed finalizations and corrections. That detector intentionally ignores first-seen finals,
and the old forward claims also remained visible while a refresh was pending. The raw held-payload
reproduction established stale premises, not that every normal live final waited until 06:00 ET.
Results in other games can stale standings implications too. A passing suite did not cover these
response-validity and observed-result dependencies.

The recommendation was to invalidate narrative premises on relevant result changes while retaining
the applicable week frame. Merely suppressing a repeated `storyKey` cannot cover standings changed by
other games. The owner subsequently authorized exactly that narrow correction, with no third round.

### Authorized second remediation — `99c284ff`

The user explicitly approved AGENTS.md step 6's narrow exception. The implementation changes only
three production files: the existing Forward Look selector, Insights hook and CFBScheduleApp wiring.
No endpoint, cache layer, gather or composer input changed; the stop-and-report condition did not fire.

`selectCompletedResultsKey` sorts usable final game IDs with both final scores. That value keys the
existing request effect. First-seen finals, additions/removals and score corrections change it;
clock ticks, live score changes, arrival order and equivalent final labels do not. The former
finalization callback still refreshes canonical server standings, but no longer separately triggers
Insights. Response provenance clears only forward narrative lines while a different result key is
pending; the applicable week frame stays. Existing request sequencing rejects obsolete responses.

Three added tests cover the result signature, hook and real app live poll. The app test observes one
Insights request at bootstrap, then exactly one more when its live poll completes the earlier game.
It observes `Week 6 ahead` while pending and the corrected one-win-gap heading after resolution. The
hook test uses the real composer: repeated clock/live-score changes add zero requests; a first-seen
final adds one; a material final correction adds one. It also exercises overlapping result responses.

The historical 3.33s Active CPU figure was not rederived or used as a current measurement. The cost
claim here is limited to synthetic request counts, not CPU usage or production headroom.

Nine final-round mutations each exited 1 at their intended assertion; the unmutated 30-test focused
control exited 0. They ran in an isolated copy, leaving the review tree untouched.

| Mutation | Named assertion that failed |
| --- | --- |
| Remove result key from fetch dependencies | `a first-seen completed result makes exactly one refresh` |
| Add `nowTick` as a fetch dependency | `clock ticks and nonfinal score changes make no Insights requests` |
| Include nonfinal scores in the key | `clock ticks and nonfinal score changes make no Insights requests` |
| Remove scores from the final signature | `corrected final scores change the key`; `a material final correction refreshes once` |
| Remove stable game-key sorting | `reordered equivalent finals keep the same key` |
| Keep old claims during a key mismatch | `old forward premises disappear while the refresh is pending` |
| Drop the pending frame instead of its lines | app test cannot find `Week 6 ahead` |
| Disconnect app scores from the hook | `the completed-result signal uses exactly one existing refresh` |
| Accept superseded request responses | `a superseded result response cannot clear current narratives` |

The first race-mutation attempt hit an older league-scope assertion, not the new claim: result-key
masking independently hid the stale response. The test was strengthened to resolve the current
response before the old one and assert that obsolete work cannot clear current narratives; the same
mutation then failed that named assertion. No production change was needed.

Final reviews: Codex independently passed 36 focused tests and three memory-only mutations, finding
no credible remaining P0/P1/P2 or required-rule failure. `/code-review` was not clean: an initial
completed-score bootstrap triggers an additional Insights request. This was independently reproduced and was treated as an unresolved P2 at that stop, not accepted as a cost tradeoff.

### Second-round stop: initial score hydration is not a new result

The completed-result key also changes when an empty client score map first receives existing finals.
The first Insights request is already underway (or completed) before that bootstrap; the new key
starts a second request. The previous finalization detector intentionally excluded first-seen
already-final scores, but the replacement trigger has no equivalent bootstrap baseline. The initial
round-two app test seeded an in-progress score, so its request-count assertion missed this case.

Measured on the same synthetic app fixture, in isolated archives of each commit: one existing final
at bootstrap, one score hydration, no subsequent poll. The real CFBScheduleApp, hook and score
attachment path execute against stubbed HTTP responses; the server composer is real.

| Code commit | Bootstrap score requests | Insights requests before any result change |
| --- | --- | --- |
| `2ec3634a` | 1 | 1 |
| `99c284ff` | 1 | 2 |

Both measurement runs exited 0 with assertions for those counts. This establishes request
amplification, not a production CPU duration, headroom or frequency measurement. The steady-state
fix is correct, but the first-load regression is directly attributable to the final remediation.
At that stop no third round was authorized; PR #887 remained draft and was not merged. Under AGENTS.md's two-round
rule, the recommendation is reconstruction from the settled result/response-validity specification,
including a bootstrap baseline and its request-count proof, rather than appending another patch.
No reconstruction or new data path was started, and no new issue was filed by the lane.

The final reviewer also noted pending-state presentation, null-final classification differences,
unowned-game invalidations and non-result schedule changes as smaller or out-of-scope concerns.
None was folded into another patch. The bootstrap P2 alone stopped the branch.

No third remediation had been performed at that stop. `git pull --no-rebase origin main` completed before writing
this closeout, reporting already up to date at `11a4b98a`.

**Structural lesson:** this zone's forward claims have a result-dependent lifetime while displayed.
Calendar/kickoff expiry is insufficient. A later game does not falsify a recap of completed games,
but it can falsify present standings or a live streak asserted about an upcoming game. Future
forward-facing occupants inherit the invalidation obligation, now recorded in AGENTS.md beside the
selector architecture. This is separate from historical provider-score corrections.

## Third round — baseline only, `4a3121d9`

Owner decision 2026-10-06 explicitly authorized a third round, superseding the preceding stop's
no-third instruction for the baseline alone. The starting result set is seeded at the existing
initial score-bootstrap boundary before publishing those scores to React state. The Insights hook
stores a scope-specific baseline; normal polls do not reseed it. The three production files changed
are `CFBScheduleApp.tsx`, `useLiveRefresh.ts` and `useInsightsFeed.ts`. The completed-result selector,
steady-state invalidation, composer inputs, endpoint and caches are unchanged. No clock-driven
request was introduced.

### Requested regression distinction and gates

Two tests were added, none removed or weakened: the existing full-app polling fixture now also
mounts with an existing final, and a hook fixture checks baseline scoping and subsequent results.
The existing-final app fixture makes exactly one Insights request after bootstrap, then a second
when another game finishes. The original nonfinal-bootstrap/steady-state fixture remains a control.

On frozen `4a3121d9`, `npm test` passed 5,646 tests with zero failures/skips; `lint:all`,
`npx tsc --noEmit`, and `npm run build` each exited 0. The app/hook focused run passed 16 tests.
The slice adds 28 tests in total. These gates precede the documentation-only stop closeout; they do
not imply that the later-discovered race is covered by the committed suite.

| Isolated mutation | Failed assertion | Distinction |
| --- | --- | --- |
| Remove bootstrap baseline seeding | `existing finals at mount produce exactly one Insights request` | Original steady-state fixture stays green |
| Reseed baseline on every poll | `the completed-result signal uses exactly one existing refresh` | Mount count stays correct; later changes are lost |

Each mutation exited 1; restored control exited 0. The first mutation's TAP explicitly reports the
original steady-state fixture `ok`; the compact mutation summary lists only failures. Codex
independently reproduced both mutations and passed 32 focused tests. Earlier mutation tables above
remain evidence from their named earlier commits, not reruns on this commit.

### Both reviewers, same commit; binding stop

Both Codex and Claude `/code-review` reviewed `4a3121d972e08bea31cd79b5f7a59ee596810e28` against
`11a4b98a`. Codex was clean. Claude identified a possible interval between the Insights snapshot and
the initial score snapshot: a game can finish after the former but before the latter. The implementer
reproduced it in an isolated full-app fixture using the real composer and score attachment, stubbed
HTTP, and a deferred bootstrap response. The initial Insights response has already rendered a tie
claim; bootstrap then delivers the newly final game that breaks it.

| Code used with identical race fixture | Insights requests | Earlier tie claim visible after final hydration | Correctness assertion exit |
| --- | --- | --- | --- |
| `99c284ff` | 2 | No (withheld pending refresh) | 0 |
| `4a3121d9` | 1 | Yes | 1 |

The named failing assertion is `a final arriving between Insights and bootstrap invalidates the
earlier tie claim`. This differs from an existing final at mount: the two reads legitimately see
different result sets. Both occur independently in production, with no shared snapshot token or
ordering guard. The baseline marker makes the newer set appear equal to the earlier response's
provenance. This is a confirmed P2 caused by round three, not a measured production frequency or CPU
claim. The historical 3.33s figure was not rederived or used.

**Stopped without another code patch or merge.** Correcting the demonstrated ambiguity requires
settling which snapshot establishes the response's baseline (request ordering or response provenance),
beyond simply remembering the first hydrated set. Changing the request trigger or transport contract
would cross the owner's binding baseline-only limit. No such change was attempted. Recommendation:
settle that ordering/provenance contract before further implementation; preserve both requested
request-count cases and this race as separate acceptance cases.

Other Claude findings were evaluated, not accumulated into this round:

- A partial bootstrap can seed an incomplete set; later hydration can add existing finals. The
  callback precedes the existing clean-read clock guard, so the proposed path is plausible; it was
  not independently reproduced or promoted to an additional blocking finding.
- The stale-scope assertion checks externally visible behavior, not unique necessity of the callback
  guard: render-time scope reset supplies a second defense. No claim that guard removal must fail
  that assertion is made.
- The poll-clock option has only one production caller passing true, the initial bootstrap. A future
  caller changing that is a maintenance concern, not a demonstrated second live path.
- Returning a server result fingerprint would change the response contract; not authorized here.
- Unowned-result invalidations originate in round two; filtering the trigger is explicitly outside
  this round. Schedule clearing already changed that trigger in round two; a reload request-count
  concern was not independently reproduced as a new third-round defect.

`git pull --no-rebase origin main` completed before this closeout, already up to date at `11a4b98a`.
PR #887 remains draft and issue #886 open. The structural lesson in AGENTS.md now includes the
starting-state distinction: nothing remembered is not nothing present, and a baseline belongs to a
particular snapshot. No completed-work milestone is added for unmerged work.

### Other confirming-review residue for planning

- Current-season rivalry collection excludes undated finals (unlike the corrected standings
  population). Production occurrence was not measured; a missing timestamp can suppress a real
  streak-breaking result. Requires population evidence before dispatch.
- Equal-score repeated-pair candidates use game-key order rather than kickoff order. The selected
  story can concern the later meeting first; this is a prioritization follow-up.
- Exception logging, duplicated pair-key formatting, the loader docstring and hypothetical
  null-headline reuse were smaller hardening/cleanup suggestions. No additional patches were made.
- Treating every old postponed game as terminal was not accepted: a closed season alone is not
  evidence of what happened to an unresolved meeting. Conservative unknown-result barriers remain.
- Candidate transport is bounded by the immediate week's games; the reviewer did not establish a
  payload/performance defect. No arbitrary cap was added that could recreate lost backfill.

## Owner merge disposition — 2026-10-06

The owner authorized merging the slice with the reproduced bootstrap snapshot race open and filed
[#888 — re-derive Forward Look result invalidation](https://github.com/znpruitt/cfb-app/issues/888).
This supersedes the preceding stop's merge block, not its finding. The race ships deliberately:
a final arriving after the Insights snapshot but before bootstrap can be absorbed into the baseline,
leaving an earlier claim visible. Its production frequency and window duration have not been measured.
Issue #888 requires measurement and a server-authoritative re-derivation of the invalidation component;
it is not authorization to extend the client baseline mechanism. The composer, families, tile,
rendering and changeover remain outside that re-derivation.

The owner's four-round table is the regression list for #888:

| Round | Fix | What review then found |
| --- | --- | --- |
| 0 | The tile | Forward claims go stale when a result lands |
| 1 | Expiry + family isolation | Result dependency: held payload kept a broken streak |
| 2 | Invalidate on results changing | Bootstrap: an empty baseline reads every existing final as new |
| 3 | Record a baseline at mount | A final landing between the Insights fetch and snapshot is absorbed into that baseline |

These are ordering cases in one invalidation mechanism, not four unrelated patch tasks. The
existing-final mount count, later-result count, no-clock-request guard and independently reproduced
bootstrap race must remain distinct regression claims in the re-derivation.

Both reviews remain attached to `4a3121d9`; they were not rerun or represented as both clean.
Everything after that commit is documentation-only: the stop closeout, this merge closeout, and
integration of main's AGENTS.md mechanism lesson (`7c4b62c6`). No runtime or test change followed
review. The `src` tree hash at the reviewed commit and the integrated branch is identical:
`6374f6bd52823a7b24834462ad75102bfee275ae`. The full repository tree differs because documentation
changed. Main was pulled before writing this closeout and will be pulled again after its branch
commit; final comparison and gate results are reported with the merge.

## Merge-gate timeout diagnosis — 2026-10-08

The first response misdiagnosed from summary counts and reran without isolating the cause. The
owner required file attribution, per-file timing, then a fixed alternating A/B following #875.
No timeout, assertion, runtime file or test file was changed during this investigation.

### Named failures, not summary counts

The final failed full-suite TAP contained 22 file-level `testTimeoutFailure` records; all 22 files
are unchanged between main `7c4b62c6` and branch `c7ab0495`. Exit was 1 despite `fail 0`:
5,423 passed, 22 cancelled, 5,445 reported. The table pairs those observed timeout durations with
a single-file measurement using the unchanged repository runner and its 30-second file budget.
An isolated green measurement is timing evidence, not a reliability claim.

| File | Failed-run duration (s) | Isolated file time (s) |
| --- | ---: | ---: |
| `src/app/api/odds/__tests__/odds-quota-guard.test.ts` | 116.754 | 0.495 |
| `src/app/api/odds/__tests__/payload-boundary.test.ts` | 116.709 | 0.694 |
| `src/app/api/odds/__tests__/route.test.ts` | 116.473 | 1.478 |
| `src/app/api/odds/__tests__/writer-convergence.test.ts` | 116.268 | 0.441 |
| `src/components/__tests__/OverviewWatchlist.browser.test.tsx` | 30.004 | 9.755 |
| `src/components/admin/__tests__/ScoreAttachmentRecoveryPanel.test.tsx` | 947.186 | 1.105 |
| `src/components/admin/__tests__/maintenanceActionWiring.test.tsx` | 946.890 | 1.351 |
| `src/components/admin/systemHealth/__tests__/AutomationSafetyControls.test.tsx` | 946.525 | 1.028 |
| `src/components/admin/systemHealth/__tests__/gameStatsTargetSummary.test.ts` | 946.308 | 0.155 |
| `src/lib/__tests__/bootstrap.test.ts` | 927.235 | 2.904 |
| `src/lib/__tests__/insights-cache.test.ts` | 926.174 | 0.308 |
| `src/lib/__tests__/insights-context-aliases.test.ts` | 926.144 | 0.260 |
| `src/lib/__tests__/insights-lifecycle-awareness.test.ts` | 926.086 | 0.225 |
| `src/lib/api/__tests__/fetchUpstreamBodyDeadline.test.ts` | 710.926 | 3.629 |
| `src/lib/gameStats/__tests__/durableMerge.test.ts` | 710.173 | 0.258 |
| `src/lib/gameStats/__tests__/ingestionCoordinator.test.ts` | 710.082 | 0.245 |
| `src/lib/gameStats/__tests__/manageGameStatsSchedule.test.ts` | 709.985 | 0.167 |
| `src/lib/schedule/__tests__/fullSeasonScheduleRefresh.test.ts` | 1019.148 | 4.345 |
| `src/lib/schedule/__tests__/inlinePresentationCallers.test.ts` | 1019.127 | 6.177 |
| `src/lib/server/__tests__/appStateBoundedWaits.test.ts` | 1015.206 | 0.482 |
| `src/lib/server/__tests__/appStateKeyTransaction.test.ts` | 1014.980 | 0.250 |
| `src/lib/server/__tests__/scheduleReadEnumeration.test.ts` | 970.019 | 8.958 |

### Time the slice itself

Every added/modified test file was timed independently at `c7ab0495`, one run each; all exited 0.
The total file measurement includes startup, rather than summing only completed assertions.

| Slice test file | File time (s) | Sum of reported test durations (s) |
| --- | ---: | ---: |
| `src/app/api/insights/[slug]/__tests__/route.test.ts` | 0.635 | 0.069 |
| `src/components/__tests__/CFBScheduleAppRecap.test.tsx` | 2.038 | 0.579 |
| `src/components/hooks/__tests__/useInsightsFeed.test.tsx` | 1.169 | 0.418 |
| `src/components/recap/__tests__/ForwardLookTile.browser.test.tsx` | 2.372 | 1.892 |
| `src/components/recap/__tests__/ForwardLookTile.test.tsx` | 0.824 | 0.122 |
| `src/lib/recap/__tests__/loadTimelyContent.test.ts` | 0.126 | 0.010 |
| `src/lib/selectors/__tests__/forwardLook.test.ts` | 0.179 | 0.014 |

The largest slice file took 2.372 seconds, so these measurements do not support the hypothesis
that the added tests sum beyond 30 seconds in their own file. They do not exclude contention.

### Independent host evidence

The failed run lasted 2026-10-07 17:08:38–18:28:16 America/Chicago (TAP: 4,777.429 seconds).
`pmset -g log` records sleep intervals within that exact window:

| Sleep began (local) | Recorded sleep (s) | Corresponding TAP timeout cohort (s, approximately) |
| --- | ---: | ---: |
| 17:09:06 | 118 | 117 |
| 17:11:49 | 948 | 947 |
| 17:27:39 | 929 | 926 |
| 17:43:10 | 713 | 710 |
| 17:55:08 | 1,017 | 1,019 |
| 18:12:11 | 964 | 970 |

This is measured suspension evidence for the long cohorts, not an inference from cancelled counts.
The watchlist timeout at 30.004 seconds is a separate case and is the target of the A/B below.

### Alternating A/B

An initial diagnostic pilot mistakenly ran five multi-file cohorts concurrently (up to 20 file
workers). Main failed 5/5 with watchlist, inline-presentation and schedule-enumeration timeouts.
The driver was stopped; those overloaded pilot results are retained separately and excluded from
the corrected experiment. They cannot establish a branch regression.

The corrected experiment used isolated archives of main `7c4b62c6` and branch `c7ab0495`, the same
Node v22.19.0 and dependencies, and **only** `OverviewWatchlist.browser.test.tsx`: 30 paired
batches, five independent file processes per batch, 150 runs per arm. Even pairs ran main then
branch; odd pairs reversed the order. Each process used the unchanged `scripts/run-tests.mjs`
and 30-second file timeout. This is 300 runs of the named browser file, not 300 full suites.

| Arm | Runs | Exit zero | Nonzero | Passing TAP file-time range (s) | Median passing time (s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Main `7c4b62c6` | 150 | 150 | 0 | 18.345–29.070 | 22.813 |
| Branch `c7ab0495` | 150 | 145 | 5 | 19.346–28.517 | 22.990 |

Every exit-zero run completed all five tests with zero skips/cancellations. All five nonzero runs
were the same branch batch, zero-based runs 85–89. TAP reports DevTools socket closure (1006),
`Runtime.evaluate` timeout and the file-level timeout; file durations were 154.543–154.600 seconds.
Those runs began at 11:24:29 America/Chicago on October 8 and their TAP was written at 11:27:04.
The power log records **Idle Sleep at 11:24:45, wake at 11:27:03, 138 seconds**. The following main
batch ran after wake. The failures are retained, not discarded, replaced or relabelled green.

**Instrument correction:** the driver's field named `wall_s` used Python `time.monotonic()` and
reported only 18.55–18.58 seconds for that batch. On this host it omitted the suspended interval.
The table above uses TAP's total-file duration; start timestamps plus TAP-write timestamps also
measure 154.67–154.70 seconds. A clock's behavior during suspension is part of its measurement.

**Conclusion and limits:** the slice's added file time does not explain the failures. Host sleep
explains the long timeout cohorts and the reproduced five-run failure cluster by independent
power-event evidence. The existing watchlist file has limited headroom under five concurrent file
processes on BOTH arms. Its original 30.004-second full-suite timeout was not independently
reproduced while awake; this focused experiment does not prove whole-suite reliability or rule out
latent contention sensitivity. No fixture, timeout or production code was patched. The next full
suite is a separately reported merge gate after diagnosis, not a replacement observation for any
failed run. The known application snapshot race remains separately accepted under #888.

## Merge completion — 2026-10-08

PR #887 merged as `db292b28c2656ac70e0f5c084f69d698f36c1e44`; issue #886 closed and #888 remains
open. The branch closeout was committed before the final main pull, which was already current.
On final pre-merge head `fe0c27d9`, the single post-diagnosis `npm test` attempt exited 0:
**5,646 passed, zero failed/cancelled/skipped**, 77.926 seconds. The earlier failed runs and the
five A/B failures above remain part of the record. Sleep assertions were held for this gate's
lifetime. Branch pre-push `lint:all` also exited 0. Typecheck and build had exited 0 on the identical
non-Markdown tree; documentation lint passed on the added closeout.

Both independent reviews remain those gathered on `4a3121d9`; no reviews were rerun. Only
Markdown closeouts and main's documentation-only integration followed that commit. At review,
final branch head and merge, the `src` tree hash is
`6374f6bd52823a7b24834462ad75102bfee275ae`; all tracked non-Markdown content also matches exactly.
The preview grant lapsed at merge; no post-merge preview push or production promotion was made.

## Preview

The canonical alias is [cfb-app-preview.vercel.app](https://cfb-app-preview.vercel.app/league/tsc),
verified through Vercel deployment metadata as READY on `4a3121d9`, deployment
`dpl_ACy4jLVeGHSGCv56w2r61y4aCxAL`. The prior implementation league-route smoke returned HTTP 200. This verifies deployment and
route availability, not a signed-in production-data walkthrough. Local browser and API tests cover
the rendering/transport flow.

The older generated `cfb-app-git-preview-zachary-pruitts-projects.vercel.app` alias still points to an
unrelated September deployment; an initial HTTP smoke check used that alias and is excluded from
current-code verification. The canonical preview alias above is the one to use. Preview naturally
shows the recap until Thursday October 8 at 06:00 ET; no calendar override was deployed.
