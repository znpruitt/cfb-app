# INSIGHTS-026C — Forward Look verification

Status: Implemented; stopped after one remediation with an unresolved P2
Date: 2026-10-06
Implementation: `82c68872`; single remediation `2ec3634a`; base `11a4b98a`
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

The implementation and remediation passed lint, `npx tsc --noEmit`, `npm run build`, focused tests,
and `npm test`, each exit 0. The remediated full suite passed **5,641 tests, zero failures and zero
skips**; `lint:all` also passed. The final added exception assertion passed its focused rerun. The initial
sandboxed build could not fetch the existing Google Fonts dependencies; the network-enabled build
passed. The branch's pre-push `lint:all` also passed.

**Test delta: 23 added, none removed.** Existing assertions were not weakened. Added coverage spans
15 selector/composer/parser tests, two tile tests, one Chrome test, two full-app integration tests,
one API-to-client-parser test, one hook failure/scope test, and one loader fault-isolation test. The Chrome test clicks the real React
button at 320, 390, 820 and 1280px and measures normal-flow podium displacement and horizontal overflow.
Exact-viewport screenshots were inspected at 390 and 1280px.

## Mutation evidence

Each mutation was restored before the next control/gate. Mutations below exited 1 with the named
assertion; the unmutated focused suite exited 0. The pre-fix-slot mutation disables only the new
Forward Look branch, restoring the previous empty-slot behavior without breaking compilation.
All 28 final mutation/observer checks ran in an isolated copy of the remediation tree; the 9–1
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
The branch is stopped, not merge-ready. No second remediation was attempted.

### Remaining P2: stale story premises after an earlier result

Synthetic reproduction, using the real composer and visibility selector on `2ec3634a`:

1. Saturday October 10 at 06:00 ET: Alice and Bob have equal current-season wins, with five ordered
   archived Alice wins. Their two upcoming meetings kick off at 12:00 and 19:00 ET.
2. At 17:00 ET, Bob has won the noon game. Keep the morning response mounted and advance its client
   clock. The later meeting backfills with both `Bob and Alice can break their wins tie` and
   `Alice puts a 5-game rivalry streak on the line`.
3. Recompose from that same context with the noon final included. The correct output is
   `Bob and Alice meet one win apart`; no rivalry streak qualifies.

Assertions pinning all four observations passed. This is a synthetic reachability proof, not a
measurement of production frequency. The hook's fetch effect depends on the daily eligibility key,
scope and manual refresh revision, not on attached-score changes. Client expiry removes the kicked
game but does not rederive the premises of the remaining stories. Repeated-pair backfill exposes it
directly; results in other games can also stale standings implications. The daily hook cadence
predates this slice, but the false Forward Look narratives are new behavior. A passing suite did not
cover this dependency.

Recommendation: plan a bounded correction that refreshes or invalidates narrative premises when
relevant results change, preserving the applicable week frame while claims are untrusted. Merely
suppressing a repeated `storyKey` does not cover standings changed by other games. The owner allowed
one remediation round; any additional code work requires explicit authorization.

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
verified through Vercel deployment metadata as READY on `2ec3634a`, deployment
`dpl_75c8Z8gBmhbqYFf75f6tWweij6jz`. Its league route returned HTTP 200. This verifies deployment and
route availability, not a signed-in production-data walkthrough. Local browser and API tests cover
the rendering/transport flow.

The older generated `cfb-app-git-preview-zachary-pruitts-projects.vercel.app` alias still points to an
unrelated September deployment; an initial HTTP smoke check used that alias and is excluded from
current-code verification. The canonical preview alias above is the one to use. Preview naturally
shows the recap until Thursday October 8 at 06:00 ET; no calendar override was deployed.
