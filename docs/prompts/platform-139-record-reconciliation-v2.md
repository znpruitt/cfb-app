PROMPT_ID: PLATFORM-139-RECORD-RECONCILIATION-v2
PURPOSE: Item 139 — a final must carry the record INCLUDING the result being read. Compute the reconciled record ON THE SERVER and ship two numbers per team.
SCOPE: `src/lib/selectors/teamRecordsClient.ts` and its tests, plus the server call sites that build its props. NOT `CompactGameScoreboard.tsx`. No new provider call, no cache invalidation, no client-side counting.

Read `AGENTS.md` first. Nothing in it is restated here.

## v2 is a RECONSTRUCTION — read this before anything else

**v1 (`716bb6d1`) is abandoned. Do NOT cherry-pick, rebase, or copy code from it.** It is reference
only. Its reviews were useful and their conclusions are carried below as specification.

**Why it was abandoned — one finding, not an accumulation.** v1 computed the reconciliation in the
BROWSER, so it had to ship the whole schedule there to count from. That took the payload from **~263 KB
to ~738 KB across five dynamic pages** — nearly tripling what every visitor downloads, to answer a
question about win-loss records. That is not a bug to patch; it is the wrong side of the boundary.
`AGENTS.md` reserves reconstruction for exactly this: *"review shows the scope itself was wrong."*

**Doing it on the server dissolves most of v1's difficulty.** The server already holds the schedule,
the scores and the records in one place. It computes each team's wins and losses and sends two
numbers. No schedule shipped, no client counting, and v1's "hidden non-FBS games" finding disappears
because the server sees every game.

**And one measurement changes the shape of the work.** v1 grew a withholding policy, null-kickoff
ordering rules and a blast-radius argument, all to handle "a finished game whose score cannot be
read". Measured on production `2025-all-all` against the `2025` score packs:

| 2025 completed games | 3,831 |
| --- | --- |
| usable final score | **3,829** |
| no score row at all | 0 |
| score row not final | 0 |
| final with a null score | **2** |

**Two games in 3,831 — 0.05%.** That case needs no policy, no withholding rule and no ceremony. Skip
an unreadable game and fold the rest. Being wrong by one game on two rows a season is not worth a
mechanism, and it is emphatically not worth blanking a team's record everywhere it appears. **The v1
withholding ruling is WITHDRAWN**; it was made without anyone measuring the population.

## References — READ THESE BEFORE WRITING ANYTHING

- **`docs/campaigns/item-87-live-watchlist-scoreboard.md` → _Records across scoreboard states —
  resolved_.** Canonical for PLACEMENT and for **"One rule, not two… No state-dependent branching in
  the data layer."**
- **`DESIGN.md`** → canonical for the RULE: a record is always the team's record today, with the
  binding corollary that a final carries the result being read. Neither supersedes the other.
- [`docs/next-tasks.md`](../next-tasks.md) → **Item 139**, including the cache-invalidation approach
  that failed before v1.
- `src/lib/selectors/teamRecordsClient.ts` — `teamRecordsClientProps(scheduleItems, recordCache)`,
  the server projection. It joins on **exact CFBD team IDs**, no name fallback, and withholds via
  `uncreditableTeamIds` (derived when `wins + losses + ties !== games`).
- `src/lib/gameStatus.ts:96` — `hasUsableFinalScore`.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. A branch checkout is fine; no code until the owner replies.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. Quote **"One rule, not two"** and the sentence after it about the data layer. Say what the
   state/anchor table varies and what it does not, and why that constrains this slice.
3. `hasUsableFinalScore` (`gameStatus.ts:96`) does **two jobs** — v1's review found this and it is
   the one v1 finding worth carrying verbatim. Quote it, name both jobs, and say which one this slice
   needs where.
4. `teamRecordsClientProps` takes `(scheduleItems, recordCache)` and is called from **five** page
   files. Name what those call sites must now also supply, and confirm it is available there —
   **this is the thing v1 got wrong by pushing the work to the browser instead.**
5. Anything in the references that CONTRADICTS or narrows the message you were handed. If nothing, say
   so explicitly.

## Branch

Branch from current `origin/main`, named to distinguish it from the abandoned v1. A `pre-push` hook
runs `npm run lint:all` and refuses a failing push.

<task>
**The defect.** `team-records` is a season-total cache refreshed **hourly**. Between a game finalising
and the next refresh, the cached record predates the result — so a final renders a pre-game record.
Live on Overview today; Item 87 slice 5 deferred records on Schedule rather than extend it.

**The derivation, computed server-side.**

1. **The record carries its own coverage count.** `TeamRecordItem['total']` is
   `{wins, losses, ties, games}`; `games` is how many games it already reflects. Note **`ties`** — the
   projected type drops it today and the fold needs it, or a tied game silently vanishes.
2. **Sort the team's finished games by kickoff.** The record covers the first `games` of them;
   anything at index ≥ `games` is unreflected. A positional test, not a guess about which games the
   provider counted.
3. **Fold every unreflected game**, not only the one being rendered. A record three behind that folds
   one is still wrong.
4. **Ship the result, not the inputs.** `teamRecordsClientProps` returns the reconciled
   `{wins, losses}` per team per game. The payload must not grow materially — that is the constraint
   v1 broke, so **report the before/after payload size**.
5. **An unreadable game is skipped, and that is the whole policy.** 2 in 3,831. Do not build a
   withholding mechanism, a staleness marker, or ordering rules for null kickoffs.

**The population gate is VERIFIED — do not re-derive it.** 668 of 668 teams in 2025 have
`record.total.games` exactly equal to their completed-game count, across a **1-to-17** game spread
(16 teams at 9, 179 at 12, 32 at 14, 5 at 16, one at 17) — so it spans missed bowls, conference
championships and deep playoff runs. The derivation never compares against an expected total; each
team is compared against itself.
</task>

<gate>
**Do NOT compute this in the browser.** That is what v1 did and why it was abandoned. If a call site
cannot supply what the server needs, STOP and report — do not ship the schedule to the client.

**Do NOT build a cache-invalidation trigger.** The approach before v1: a trigger has no game identity,
so it blanked every team's record for one final, never fired on first-seen finals, and over-fired on
same-winner corrections. Four defects from one mechanism.

**Do NOT build a withholding policy.** Withdrawn — see the measurement above.

**Do NOT restore records to Schedule.** Item 87 slice 5 removed them deliberately pending this item;
restoring them is a separate change with its own review.

STOP and report if the payload grows materially, or if a page call site cannot reach the scores.
</gate>

<completeness_contract>
- **A final renders the record INCLUDING its own result.** The headline; assert it directly.
- **A record three games behind folds all three** — not one. A one-game fixture cannot distinguish
  "folds the current game" from "folds everything unreflected", and those are different
  implementations.
- **A record already current is unchanged.** No double-counting; this is the common case.
- **Ties fold.** A tied unreflected game moves `ties`, not `wins` or `losses`.
- **Payload is asserted, not assumed.** v1's defect was invisible to every test it wrote. Measure the
  serialized size before and after and report both.
- **Generate over the type's contract** (`AGENTS.md`), varying games-completed, records-behind-by, tie
  presence and unreadable games.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; **the payload before and after**; the mutation
proving the fold covers all unreflected games rather than only the current one; and anything you
deliberately did not do.

Say plainly that records remain absent from Schedule and that restoring them is a separate change.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 139 status, and
the record paragraph in `DESIGN.md`.
</output_contract>
