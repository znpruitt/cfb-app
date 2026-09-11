PROMPT_ID: PLATFORM-139-RECORD-RECONCILIATION-v1
PURPOSE: Item 139 — a final must carry the record INCLUDING the result being read. Reconcile the hourly-cached team record against the games the schedule shows completed, so a finished game never renders its pre-game record.
SCOPE: TWO parts. (1) `src/lib/selectors/teamRecordsClient.ts` — widen the projected record to carry its coverage count across the server boundary. (2) A reconciliation selector, called where records and scores are BOTH in scope, plus the consumer that calls it. Tests for both. NOT `CompactGameScoreboard.tsx` — the component renders what it is handed. No new provider call, no cache invalidation.

Read `AGENTS.md` first, then `DESIGN.md` — canonical for UI, and it carries the rule this slice enforces. Neither is restated here.

## References — READ THESE BEFORE WRITING ANYTHING

**Canonical; they win over anything summarised below.**

- **`docs/campaigns/item-87-live-watchlist-scoreboard.md:194` → _Records across scoreboard states —
  resolved_. CANONICAL.** It carries the state/anchor/position table, the inline format
  (`#14 USC (7-1) . Chamness . 21`), the markup order **rank -> team -> record -> owner**, and the two
  rules this slice turns on: **"Finals carry the POST-GAME record, including the result being read"**
  and **"One rule, not two... No state-dependent branching in the data layer."**
- **`DESIGN.md`** is canonical for the RULE — what a record always is, with the corollary marked
  binding. The campaign section above is canonical for PLACEMENT. Neither supersedes the other; a
  previous wording in `DESIGN.md` claimed it did, corrected 2026-09-06.
  `item-87-followon-records.md` is the retained INPUT, applied 2026-08-31 and folded into the section
  above — read that one, not this.
- [`docs/next-tasks.md`](../next-tasks.md) → **Item 139**, including the failed approach it records.
- **`docs/campaigns/item-87-live-watchlist-scoreboard.md` → _Records across scoreboard states —
  resolved_.** THIS is canonical for the record rule, not `DESIGN.md` alone.
  `item-87-followon-records.md` is the retained input and says so at its head: applied 2026-08-31,
  folded into that section. Read the canonical one.
- `src/lib/selectors/teamRecordsClient.ts` — the SERVER projection. `teamRecordsClientProps` joins
  records to schedule rows on **CFBD team IDs**, exactly, with no name fallback, and withholds via
  `uncreditableTeamIds`. **It has NO scores** — it takes `(scheduleItems, teamRecords)` and is called
  from five page files, none of which have scores in scope. It cannot host the reconciliation; it can
  only carry the coverage count across the boundary.
- `src/components/OverviewPanel.tsx` — where records and scores DO coexist
  (`teamRecordsByProviderGameId` at `:133`/`:638`, `scoresByKey` alongside). `recordForGame` (`:136`)
  is the lookup the reconciliation wraps. `MatchupsWeekPanel` joins that population after Item 117.
- `src/lib/teamRecords/teamRecordsCache.ts` — where `uncreditableTeamIds` is derived.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. A branch checkout is fine; no code, no tests until the owner
replies.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. From `item-87-live-watchlist-scoreboard.md:194`: quote **"One rule, not two"** and the sentence that
   follows it about the data layer. Then say what the state/anchor table varies by state and what it
   does NOT — and why that distinction constrains this slice.
3. `TeamRecordClient` is `Pick<TeamRecordItem['total'], 'wins' | 'losses'>`. **Name the field it drops
   that this slice needs.** Then say what `teamRecordsClientProps` receives as arguments, and why that
   means the reconciliation cannot live there — this is the correction that reshaped the slice.
4. `teamRecordsClientProps` already withholds a record for some teams. Name the mechanism and where its
   input is derived. Say whether you intend to reuse it for the no-usable-score case, and why.
5. Anything in the references that CONTRADICTS or narrows the message you were handed. If nothing, say
   so explicitly.

A receipt that summarises without quoting is not a receipt.

## Branch

Branch from current `origin/main`. A `pre-push` hook runs `npm run lint:all` and refuses a failing
push; do not bypass it.

<task>
**The defect.** `team-records` is a season-total cache refreshed **hourly**
(`schedulerDeliveryHealth.ts:83`). Between a game finalising and the next refresh, the cached record
predates the result — so a final renders a pre-game record. Live on Overview today; slice 5 deferred
records on Schedule rather than extend it.

**The derivation. Reconcile — do NOT invalidate.**

1. **The record carries its own coverage count.** `TeamRecordItem['total']` is
   `{wins, losses, ties, games}`, and `games` is **the number of games already reflected**.
2. **The schedule says what has finished.** Sort a team's `completed` games by kickoff. The record
   covers the first `games` of them; **anything at index ≥ `games` is not yet reflected.** That is a
   positional test, not a guess about which specific games the provider counted.
3. **Fold every unreflected game, not only the one being rendered.** If the record is behind by three,
   applying just the current game leaves a number that is still wrong. Folding all of them makes the
   record correct for every row on the card.
4. **Outcomes come from the scores already in hand.** No provider call — this is why the approach
   survives CFBD itself lagging. **`hasUsableFinalScore` (`src/lib/gameStatus.ts:96`) is the existing
   authority** for whether a score can be read as a result; do not write a second one. `ScoreTeam.score`
   is `number | null`, so a "final" with a null score is exactly the case the open question covers.

5. **No state-dependent branching in the data layer.** The canonical section is explicit: the record is
   the team's CURRENT record in every state, and the only thing that varies by state is where it is
   POSITIONED (anchor on scheduled, inline parenthetical on live/final). This slice makes "current"
   actually current — it must not introduce a scheduled-versus-final branch in the record itself.

**The population gate is VERIFIED, not merely satisfiable — do not re-derive it.** Measured
2026-09-06 against production `team-records/2025` and `schedule/2025-all-all`: **668 of 668 teams**
have `record.total.games` exactly equal to their completed-game count. Zero disagreement in either
direction. And the test covered the **variance**, which is the part that matters — game counts range
**1 to 17** (16 teams at 9, 179 at 12, 32 at 14, 5 at 16, Illinois State at 17), so it spans teams that
missed a bowl, played a conference championship, and ran deep into the playoff. **The derivation never
compares against an expected total**; it compares each team against itself, which is why a variable
postseason cannot break it.
</task>

<gate>
**Do NOT build a cache-invalidation trigger.** Item 139 records why: slice 5 tried one
(`onGamesFinalized`), and because a trigger has no game identity it blanked every team's record for one
final, never fired on first-seen finals — the case that matters — and over-fired on same-winner score
corrections. Four defects from one mechanism. If you find yourself wanting to clear a cache, stop.

**Do NOT touch `CompactGameScoreboard.tsx`.** The component renders what it is handed. This is a
selector change.

**Do NOT add a provider call or widen a payload.** Everything needed is already in the schedule, the
record cache, and the scores.

**Do NOT restore records to Schedule.** Slice 5 removed them deliberately pending this item; putting
them back is a separate change with its own review.

STOP and report if a team's completed-game count and `record.total.games` disagree in a way the
verified gate does not predict, or if the outcome of an unreflected game cannot be determined from the
scores available at this seam.
</gate>

<completeness_contract>
- **A final renders the record INCLUDING its own result.** The headline case; assert it directly.
- **A record behind by more than one game folds all of them** — assert with a record three games
  behind, not one. A one-game fixture cannot distinguish "folds the current game" from "folds
  everything unreflected", and those are different implementations.
- **A record already up to date is unchanged.** No double-counting: the common case is that the
  hourly refresh has already run.
- **The no-usable-score case behaves as decided** (see the open question below), asserted explicitly
  rather than falling out of the code.
- **Generate over the space, not over chosen fixtures** (`AGENTS.md`): vary games-completed, records-
  behind-by, tie presence, and missing scores. The space is the **type's contract** — a generator
  seeded from one season's shape tests that season.
- Test count delta reported as a measured number.
</completeness_contract>

<open_question>
**Answer before building; do not choose silently.** What renders when an unreflected game fails
`hasUsableFinalScore` — the outcome cannot be determined, so the record cannot be folded correctly.

Options: show the stored record unadjusted (honest "we cannot tell yet"); withhold the record entirely
via the existing `uncreditableTeamIds` mechanism; or fold what is determinable and show a partially-
adjusted number. **The third is the one to argue against** — a partially folded record is wrong in a
way nothing signals.

State your recommendation with reasoning in the receipt; the owner rules.
</open_question>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **0** — there is no known-failure baseline. Item 137 (#696)
removed the last two time-bomb failures on 2026-09-11, so **any** failure is a stop-and-report,
not a baseline to verify against.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving the fold covers all
unreflected games rather than only the current one; and anything you deliberately did not do.

**Report what this unblocks:** records were removed from Schedule by Item 87 slice 5 pending this item.
Restoring them is a separate change — say so rather than doing it.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 139 status, and
the `DESIGN.md` team-record paragraph, which currently describes the accent removal and should record
that the binding corollary is now enforced.
</output_contract>
