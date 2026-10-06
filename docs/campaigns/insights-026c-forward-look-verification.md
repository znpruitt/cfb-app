# INSIGHTS-026C — Forward Look verification

Status: Stopped after the authorized final remediation; bootstrap request P2 unresolved
Date: 2026-10-06
Implementation: `82c68872`; first remediation `2ec3634a`; authorized final remediation `99c284ff`; base `11a4b98a`
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

## Gates

The frozen final code commit `99c284ff` passed `lint:all`, `npx tsc --noEmit`, `npm run build`,
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
implementer reproduced the false present-tense claims and treats this as **unresolved P2**.
At that point the branch was stopped, not merge-ready. No second remediation was attempted until
the owner explicitly authorized the narrow final round below.

### P2 reproduced at the first stop — resolved by the authorized final round

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

### Authorized final remediation — `99c284ff`

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
completed-score bootstrap triggers an additional Insights request. This was independently reproduced and is treated as an unresolved P2, not accepted as a cost tradeoff.

### Final stop: initial score hydration is not a new result

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
No third round is authorized; PR #887 remains draft and was not merged. Under AGENTS.md's two-round
rule, the recommendation is reconstruction from the settled result/response-validity specification,
including a bootstrap baseline and its request-count proof, rather than appending another patch.
No reconstruction or new data path was started, and no new issue was filed by the lane.

The final reviewer also noted pending-state presentation, null-final classification differences,
unowned-game invalidations and non-result schedule changes as smaller or out-of-scope concerns.
None was folded into another patch. The bootstrap P2 alone stops the branch.

No third remediation was performed. `git pull --no-rebase origin main` completed before writing
this closeout, reporting already up to date at `11a4b98a`.

**Structural lesson:** this zone's forward claims have a result-dependent lifetime while displayed.
Calendar/kickoff expiry is insufficient. A later game does not falsify a recap of completed games,
but it can falsify present standings or a live streak asserted about an upcoming game. Future
forward-facing occupants inherit the invalidation obligation, now recorded in AGENTS.md beside the
selector architecture. This is separate from historical provider-score corrections.

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

## Preview

The canonical alias is [cfb-app-preview.vercel.app](https://cfb-app-preview.vercel.app/league/tsc),
verified through Vercel deployment metadata as READY on `99c284ff`, deployment
`dpl_8nVFbC9U8b8fPc8VegNuw224eiUU`. The prior implementation league-route smoke returned HTTP 200. This verifies deployment and
route availability, not a signed-in production-data walkthrough. Local browser and API tests cover
the rendering/transport flow.

The older generated `cfb-app-git-preview-zachary-pruitts-projects.vercel.app` alias still points to an
unrelated September deployment; an initial HTTP smoke check used that alias and is excluded from
current-code verification. The canonical preview alias above is the one to use. Preview naturally
shows the recap until Thursday October 8 at 06:00 ET; no calendar override was deployed.
