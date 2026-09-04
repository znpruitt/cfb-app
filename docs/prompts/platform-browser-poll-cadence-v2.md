PROMPT_ID: PLATFORM-BROWSER-POLL-CADENCE-v2
PURPOSE: Give the browser a two-speed live-score cadence — 90s while a game is actually in progress, 180s otherwise — always reading the FULL eligible partition set. Supersedes both `platform/browser-poll-interval` and `platform/browser-poll-interval-v2`, which are abandoned.
SCOPE: `src/lib/liveScores/browserPolling.ts` + its tests; `src/components/hooks/useLiveRefresh.ts` + `useLiveRefresh.oddsDecouple.test.tsx`; cadence prose in `docs/architecture/game-data-flow.md` and `docs/deployment-runbook.md`. NO change to any cron cadence, any TTL value, the cache-only browser boundary, or `/api/scores` behaviour. NO partition SELECTION logic and no partial-poll health state.

Read `AGENTS.md` first. It is canonical for scope/sizing, verification, review limits and reporting;
this prompt does not restate or override those rules.

## Why v2 is abandoned rather than trimmed

Your own analysis is why, and it was right. Recorded so it is not re-derived:

1. **Partition selection cannot do what it was built to do.** `LiveScorePartition` is
   `{ providerWeek, seasonType }` — week granularity, verified. On a normal Saturday every game is
   `(week N, regular)`, so "partitions containing a live game" and "all eligible partitions" emit the
   *identical* request. The optimization changes the request set only during rare cross-partition
   overlaps.
2. **Partial polling does not compose with global health metadata.** It yields preserved-but-stale
   errors, duplicated errors, and data whose displayed freshness disagrees with it — three defects
   from one choice that buys nothing in the common case.
3. **The full-window clock starts at 0**, so the first heartbeat always forces a full read even when
   the window holds only scheduled or already-final games.

Trimming (1) and (2) out of `fafe4074` would leave code shaped by a premise that turned out false.
Re-derive from `main` instead. **Reuse v2's tests wherever they still apply** — they are the most
valuable thing on that branch. Read it with
`git -C /Users/zach/cfb-app-codex show platform/browser-poll-interval-v2:<path>`.

## The actual benefit — state it correctly

The cron is the **only writer**, every three minutes. A browser cannot show a change before it is
written, so the end-to-end wait is `~90s (cron) + half the browser interval`:

- 180s browser polling → ~180s
- 90s browser polling → ~135s

**~45 seconds, a 25% improvement — not 2×.** Do not describe it as halving latency anywhere, in code
comments or docs. Item 95's original framing was wrong and any prose you touch should say this.

## The cost argument that decides the design

The eligibility window stays open **24 hours past kickoff**, and nothing is written for almost all of
it. Per visible tab, per hour:

| | Live slate | 24h finals tail |
| --- | --- | --- |
| `main` today | 20 | 20 |
| 90s always (the abandoned v1) | 40 | **40** |
| This prompt | 40 | **20** |

Doubling the tail buys zero freshness because nothing changes during it. Tiering the *cadence* is
what makes this worth shipping at all.

<task>
1. In `browserPolling.ts`, add a predicate for "at least one eligible game is IN PROGRESS", exported
   and unit-tested alongside the existing eligibility helpers.
2. In `useLiveRefresh.ts`, use it to pick the interval — 90s when it holds, 180s otherwise — and
   ALWAYS pass the full eligible partition set, exactly as `main` does today.
3. Stamp the poll clock when the season-wide bootstrap completes, so a window of only
   scheduled/final games does not take an extra read 90s later.
4. Update the cadence prose in the two docs listed in SCOPE.
</task>

<critical_implementation_risk>
**Derive "in progress" from KICKOFF TIME PASSED AND NOT FINAL — never from the presence of a live
score pack.** If it requires score data, the browser will not switch to 90s until after the first
cron write, so the speed-up arrives late at precisely the moment it is supposed to help. A test must
prove the fast cadence is selected for a game that has kicked off and has NO score pack yet.
</critical_implementation_risk>

<completeness_contract>
- Both cadences reachable and asserted, including the just-kicked-off no-score-pack case above.
- The full eligible partition set is passed on BOTH cadences. Assert the request set is identical to
  `main`'s — this prompt changes only *when*, never *what*.
- No `coversEligiblePartitions`, no partial-poll health state, no new error/freshness semantics. If
  you find yourself preserving global health because a poll was incomplete, the design has drifted:
  stop and report.
- Every new predicate is mutation-proven: break it, watch a SPECIFIC named test go red, restore.
- Test count delta reported as a number, measured not estimated.
</completeness_contract>

<gate>
Stop and report, without coding around it, if: `/api/scores` turns out to narrow below week
granularity; the 180s constant is load-bearing anywhere beyond cadence; or "in progress" cannot be
derived without score data. Any of those changes the design, and that is the owner's call.
</gate>

<verification>
Run each separately and report its own exit code — never chained behind `&&` or a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.
</verification>

<output_contract>
Report: what changed and where; the consumer inventory for any constant you touch; the measured test
delta; verbatim before/after for any operator-facing string; and anything you deliberately did not do.
Push the BRANCH ONLY.

**Do not push `preview`, or any preview branch.** That is Claude's alone (`AGENTS.md` → Preview
branch) — the repo's usual "push branch and preview together" cadence is Claude's, not yours.

The Codex worktree's dev server is port **3010**, not 3000.
</output_contract>
