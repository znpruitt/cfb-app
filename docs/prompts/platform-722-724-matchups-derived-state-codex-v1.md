PROMPT_ID: PLATFORM-722-724-MATCHUPS-DERIVED-STATE-CODEX-v1
PURPOSE: Matchups derives game state from the score alone, while the row it renders derives it from
score plus kickoff plus now. That single divergence produces both a card that reports zero live games
while a row inside it says otherwise (#722) and a sort order the contract does not describe (#724).
SCOPE: `src/lib/matchups.ts`, **`src/lib/ownerView.ts`** (added 2026-09-13 at the receipt gate — it
holds the second production caller of `deriveOwnerWeekSlates` and the slice is wrong without it), and
their suites; `src/components/MatchupsWeekPanel.tsx` only if the convergence requires the panel to pass
something it already has. NOT `GameWeekPanel.tsx`, NOT
Overview, NOT the shared scoreboard, NOT tags, broadcast, odds or the third-column tier — those are
slices 2, 3 and 5 of the same residue and they touch different files.
CARRIES: `docs/campaigns/item-87-INDEX.md` → **CARRY THIS**, LIVE standing rows 1, 6, 7, 8 and 9.
Checked the "LIVE obligations by owning item" table: **no row is owned by #722 or #724.** The two
that bind hardest here are reproduced first; all five are reproduced verbatim below.

- **Row 8 (LIVE).** Selection and precedence stay selector-owned; the scoreboard **must not be forked**. **CORRECTED 2026-09-08 — "four consumers plus the recap" was wrong on both halves.** There are **five direct renderers**: Overview `GameCardList` (serving Live AND Recent finals), Overview `WatchlistScoreboardList`, Overview `FeaturedGamesList`, `GameWeekPanel`, and Matchups `GameRow` — three importing modules, six rendered contexts. **And the recap is NOT a consumer**: `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`, which is what Item 143 creates the seam for.
- **Row 7 (LIVE).** **Do not read campaign status from the canonical document**, and **re-derive every line-number citation** before putting it in a prompt — they have been stale at least twice, and `DESIGN.md` moved again on 2026-09-08.
- **Row 1 (LIVE).** A build with records absent or stale **will not match the mockup**, and a reviewer comparing them must read that as a **sequenced dependency, not a defect**. State this in the prompt. **Owner ruling 2026-09-08:** a missing record leaves the anchor **blank**, never the spread — and a **store failure** (transient, no item) is NOT the same condition as **"not wired to this surface"** (a sequencing state that needs a filed item and this sentence in the prompt). Records are wired on Overview and Matchups; Schedule remains in the second state under Item 156.
- **Row 6 (LIVE).** **Do not "restore" the mockup's tint inset.** The implementation ships `0 -8px` plus squared facing corners; the mockup's former `-1px -8px` produced a darker stripe at the seam. **Anyone reconciling the two changes the MOCKUP, not the code.**
- **Row 9 (LIVE).** **Never suppress individual finals against recap content**, and do not reintroduce a subtler version. Recent finals is complete; the recap is curated.

Issues: [#722](https://github.com/znpruitt/cfb-app/issues/722), [#724](https://github.com/znpruitt/cfb-app/issues/724).
Slice 1 of 5 in the #672 residue — see `docs/next-tasks.md` → **UI LANE ORDER**.

---

## Lane and branch

**UI lane, `/Users/zach/cfb-app-codex`.** Branch off current `origin/main` — **verify the SHA rather
than trusting any written here**, a prompt in this campaign already shipped with a stale one. `npm test`
exits 0 on clean `main` and **the known-failure set is EMPTY**, so any failure stops the merge. Push
**`preview`: SLICE-SCOPED GRANT, see below.**

### `preview` — slice-scoped exception, granted 2026-09-13

**`AGENTS.md:856` is the binding rule and it says Codex does NOT push `preview`.** An earlier version
of this prompt told you to push it with every commit, which was wrong on its face — corrected here
after the lane flagged it at the receipt gate.

**A slice-scoped exception IS granted for this branch**, on the reasoning `AGENTS.md` requires:
the rule exists because two worktrees force-pushing one ref make `preview` ambiguous, and this slice
changes owner-card counts and slate order — a user-visible surface the owner has historically caught
defects on by clicking.

**The grant's condition is ONE WRITER TO `preview`, which is not the same as one active lane.** The
platform lane is concurrently taking #755, and **its kickoff has been amended to suspend
`CLAUDE.md`'s push-`preview` instruction for that branch** — that suspension is what preserves the
single-writer property, not lane idleness. It has been notified that the suspension is now
load-bearing.

So: push the branch and `preview` together with every commit including the closeout. **The grant
lapses when this slice merges.**

## One root, two issues — this is why they are one slice

`matchups.ts` has its own state function, `getStateFromScore` (`:124`), which classifies from the
score pack alone and returns `'scheduled' | 'inprogress' | 'final' | 'neutral'`. **It cannot express
`awaiting`**, because it never sees a kickoff time or a clock.

The row renders from `projectGameScoreboardState` (`src/lib/selectors/gameScoreboardState.ts:12`),
called at `MatchupsWeekPanel.tsx:188` with `(score, kickoff, nowMs)`. That one **does** return
`awaiting`: a game past kickoff with no usable score and no in-progress status (`:25-27`).

Both consumers of the score-only function are wrong in the same way:

- **#722 — `buildOwnerWeekPerformance` (`:319`)** counts with `getStateFromScore`, so a post-kickoff
  scoreless game increments `scheduledGames` and leaves `liveGames` at zero. The card reads
  `Scheduled` while the row inside it reads `Awaiting score`.
- **#724 — the slate sort (`~:415`)** ranks `inprogress` 0, `scheduled` 1, `final` 2, `neutral` 3.
  **The contract sorts all non-finals together by kickoff, then finals by kickoff.** Bucketing live
  above scheduled is a third ordering no document describes.

**Fix the divergence, not the two symptoms.** A patch that special-cases `awaiting` in the counter and
separately reorders the sort leaves two state authorities in one file, which is how this happened.

## The hazard this introduces, and it is the one that matters

**Converging on `projectGameScoreboardState` makes these selectors TIME-DEPENDENT.** They currently
take no clock. Threading `nowMs` in is the correct fix and it is also how wall-clock time bombs enter
a suite.

**Item 137 (#696, PR #742, merged `a8593d9f`) removed the last two from this repo**, and
`npm run test:clock-shift` exists to detect the class. So:

- **`nowMs` is a parameter, never `Date.now()` inside the selector.** A selector that reads the clock
  itself cannot be tested at a fixed instant.
- **Every new or changed test pins `nowMs` explicitly.** A test that passes today and fails in March
  is the exact defect Item 137 spent a branch removing.
- **Run `npm run test:clock-shift -- 0` as the control and at least one non-zero shift.** Non-zero
  expects exactly one failure (`testStoreLifecycle.test.ts`, which sweeps real file mtimes); **any
  other failure is a real expiry you introduced**, and it names the date it starts.

## Acceptance boundary

- One state authority governs the card count, the sort, and the row. If `getStateFromScore` survives,
  its remaining callers are enumerated in the closeout with why each is still correct score-only.
- **`awaiting` counts as live in the card**, per #722: the contract defines it as an indeterminate
  subset of live, so the card must not report zero live games while a row says `Awaiting score`.
- **Non-finals sort together by kickoff, then finals by kickoff.** State what happens to the
  `neutral`/unknown rank — the contract does not name it, so your choice is a decision to record.
- `liveGames`, `finalGames` and `scheduledGames` still sum to the slate size. A game must not be
  counted twice or dropped by the reclassification.
- **No change to which games appear** — this is state derivation and ordering, not membership.

## Verification

- `npm run lint:all`, `npx tsc --noEmit`, `npm test`, plus the clock-shift runs above. Each its own
  command, each its own real exit code, never behind a pipe. Report the test DELTA, not a total.
- **Mutation-prove both halves independently.** Revert only the counter fix and read WHICH assertion
  fires; then only the sort fix. A single test covering both is a test that cannot tell you which
  broke.
- The #722 test needs a fixture that is genuinely past kickoff with no usable score — **and a positive
  control proving the same fixture CAN produce a live count**, or it passes for the wrong reason.

## Reviews

`/code-review` and `/codex:review` are **user-invocable only**. Run everything else, then stop and ask
the owner to invoke both against the same commit. Gather both before any remediation.

## Closeout

Pre-merge, on the branch: `docs/prompt-registry.md` entry and the `docs/next-tasks.md` slice row.
Record the unknown-state ordering decision as taken, and any caller of `getStateFromScore` left
unconverged with the reason.

## RULINGS ON THE READ RECEIPT — 2026-09-13, binding — the prompt above was wrong in three places

**1. Five callers, not two — accepted, and one of your findings is a third divergence I had not named.**
`getStateFromScore` accepts a final status **without requiring usable scores**, while the row uses
`hasUsableFinalScore`. So even the final counter disagrees with the row. That strengthens the
instruction rather than changing it: **converge the authority; do not patch five call sites.**

**2. SCOPE EXPANDED to `src/lib/ownerView.ts`.** You are right that the slice is wrong without it —
leaving one of two `deriveOwnerWeekSlates` callers on the score-only path preserves the divergence on
the owner view, which is the same defect one surface over. The clock is already available there
(`gameDayContext.now`, `:343`), so it is a parameter pass rather than new plumbing. No collision: the
platform lane is in `cfbdUsage.ts`.

**3. `nowMs` IS REQUIRED, NOT DEFAULTED — this is the ruling that costs you the most and it is not
negotiable.** A parameter defaulting to `Date.now()` would leave all 21 call sites compiling untouched
and every one of them reading the wall clock. **That is precisely how the bombs Item 137 removed got
in.** Update all 21 sites to pass an explicit fixed clock; 24 mechanical test edits is the price of not
planting 24 time bombs, and `npm run test:clock-shift` would otherwise find them later at far higher
cost.

**4. Unknown-state placement accepted as you proposed it** — every non-final, including any future
unknown, in the single kickoff-ordered non-final group; missing or invalid kickoffs keep the
end-of-group `MAX_SAFE_INTEGER` placement and key tie-break; finals after every non-final. **Also
remove `neutral` from `getStateFromScore`'s return type if the helper survives** — an unreachable union
member is a false claim about the function, and `AGENTS.md` binds that something with no reachable path
says why in the code or goes. `MatchupPerformanceState.tone === 'neutral'` is unrelated and stays.

**5. `buildOwnerWeekPerformance` is at `:320`, not `:319`.** Accepted; my citation was stale by one.

**6. The `preview` contradiction — you were right and the prompt was wrong.** See the slice-scoped grant
in *Lane and branch* above, now rewritten. `AGENTS.md:856` says Codex does not push `preview`; a grant
is slice-scoped and conditional on one writer to the ref. **Both lanes were pushing it earlier today
under my instruction, which is the ambiguity the rule exists to prevent** — you observed the symptom
and reported it as a writer moving the ref three times. The grant is now explicit and the platform
lane's instruction is suspended.

**Nothing else in the receipt needs a ruling.** Item 4's zero is the answer I wanted: the sort is
unpinned today, so your test is the first thing asserting the contract.

## OWNER RULINGS 2026-09-13 — the two escalated decisions, binding

**(1) AWAITING IS BOUNDED AT `kickoff + 24h`. Owner ruling, and this slice takes it — absorbing
[#766](https://github.com/znpruitt/cfb-app/issues/766).**

The reasoning, so it is not re-argued: the contract calls awaiting *"an indeterminate subset of
live"*. That is true a minute past kickoff and false eight weeks past — by then it is not
indeterminate, it is abandoned. **The bound is not invented: `POLLING_WINDOW_AFTER_KICKOFF_MS = 24h`
(`pollingTarget.ts:30`, aliased `RECONCILIATION_GUARANTEE_MS`) is the point the score pipeline itself
stops trying to attach a result.** Past it, nothing is still coming, so "awaiting" is a claim the app
does not believe. **Reuse that constant. Do not introduce a second 24h literal.**

Without this, converging the card on its row authority would make a week-3 game count as LIVE in week
8 — strictly worse than the defect being fixed.

**Note what is already true:** Members' `isAwaitingScoreGame` (`gameDayConfidence.ts:41`) is ALREADY
bounded — `isCurrentLiveScoreSeason`, `isLiveScoreEligibleGame`, and a disrupted-status check. **It is
`projectGameScoreboardState` that is unbounded.** So this ruling narrows the gap between the two
authorities rather than inventing a third; it does not make them identical, and it is not required to.

**WHERE the bound goes is yours to determine, and it has a blast radius — receipt item 9.**
`projectGameScoreboardState` has FOUR non-test callers: `MatchupsWeekPanel.tsx:188`,
`overviewGameSections.ts:94`, `gameWeek.ts:82` (Schedule), and the slate selector this slice adds.
Bounding inside the function reaches Overview and Schedule rows too. **One authority argues for
inside; blast radius argues for care.** Measure it, do not choose blind.

**And say what the state BECOMES past the bound.** A game past `kickoff + 24h` with no score is not
scheduled (kickoff has passed), not awaiting (nothing is coming), not live, and not final (no score).
**The existing vocabulary may have no truthful value for it.** If it does not, say so and propose —
do not quietly pick the least-wrong enum member, and do not invent a new state without saying it is
new.

**(2) `1 game · 1–1` STANDS. Owner ruling — leave it.**

A self-matchup counts as ONE distinct game while the participation record stays `1–1`, because the
owner took both a win and a loss from it. It reads oddly and it is true. **Do not add a display
special-case, and do not change the record contract to make the two numbers agree.** Record it in the
closeout as a deliberate, ruled outcome so the next reader does not file it as a defect — 39 games
are affected this season.

## RULINGS ON THE v3 RECEIPT — 2026-09-13, binding. Items 1, 2, 4, 6 accepted as reported.

**Item 5 accepted as a CORRECTION of mine.** "21 call sites / 24 mechanical test edits" described no
real population. The figures are **11** direct clockless slate-selector test calls, plus **19**
clockless snapshot/roster calls once the Members seam is included. Use yours.

**Item 3 accepted and verified independently.** Five pages mount `CFBScheduleApp` — Overview,
`matchups`, `members`, `schedule`, `standings` — and **only `src/app/league/[slug]/page.tsx:48` seeds
`initialNowMs`**. So Matchups is a parameter pass and Members is not, and the clock reaching four more
route pages IS the slice size. (An earlier round seeded those routes, but on a branch that was
restructured rather than merged — it is not on `main`.)

**Item 7 is the most valuable finding in the receipt.** `compareSlates` using the counts as owner-card
**sort keys** is exactly the reader-meaning that matters: distinct-game counting reorders cards, not
merely renders different numbers. And `selectSlateGameVisibility` **already deduplicating
independently** is why #712 is invisible in the row list and visible only in the stat.

### The eight contradictions

**(c) Selector layer — you are right, with a boundary.** `AGENTS.md:193` makes derivation outside
`src/lib/selectors/` an architecture violation. **Put the new distinct-population and surface-projection
code in `src/lib/selectors/`. Do NOT relocate the rest of `matchups.ts`** — that is a pre-existing
question, and moving it here would bury this change under a refactor.

**(e) and (f) — the OWNER RULING stands over the review.** A live row behind disclosure is accepted as
specified; guaranteeing its visibility would add a priority bucket contradicting #724's contract. And
**per-surface row agreement is the invariant — cross-surface equality is not**, so a `startTimeTBD`
divergence between Matchups and Members is not a defect in this slice. **Where a review finding and an
owner ruling conflict, the ruling wins and the finding is recorded as SUPERSEDED**, never silently
dropped.

**(h) Selector-layer dedup is required by (c).** A shared harness under `src/test` is **not** —
**keep fixtures local unless the same construction appears in more than two files.** If it does, name
them and say why in the receipt rather than creating new top-level test infrastructure inside a slice.

**(i) The `preview` grant transfers to v3.** It was slice-scoped, not literally branch-scoped; this is
the same #722/#724 work, and the platform lane's suspension still holds, so single-writer is
preserved. **Declining to assume it was correct** — say so when you take the ref.

**(d) and (g) went to the owner and are answered — see OWNER RULINGS above.**

## SEAM AUDIT — added 2026-09-13, after the owner asked whether I had audited readers and writers; I had not, and the answer changes the guidance

**What the ruling says about Members — *"reuse/extract the complete predicate that produces its row
status"* — reads as though one predicate exists. It does not.**

**Members' row status has SIX producers, in TWO parallel duplicated blocks** (`src/lib/ownerView.ts`):

| line | value |
| --- | --- |
| `:153` | `'Live'` |
| `:172` | `isAwaitingScoreGame(...) ? 'Awaiting score' : 'Upcoming'` |
| `:196` | `'Final'` |
| `:226` | `'Live'` |
| `:243` | `isAwaitingScoreGame(...) ? 'Awaiting score' : 'Upcoming'` |
| `:268` | `'Final'` |

Plus `'No games this week'`. **`isAwaitingScoreGame` is only ONE branch of three**, and it appears
twice. **So the extraction IS the work** — there is nothing sitting there to reuse, and a fix that
threads only `isAwaitingScoreGame` reproduces the awaiting-only shape the ruling retired.

**And the counts do NOT come from that path at all.** `weekSummary.liveGames` / `finalGames` /
`scheduledGames` / `totalGames` read straight off `ownerSlate` (`ownerView.ts:344-349`) — i.e.
`deriveOwnerWeekSlates`, the SAME producer Matchups' card reads.

**That is the real shape of this defect, and the prompt did not state it:**

- **Both surfaces' COUNTS share one producer** (`deriveOwnerWeekSlates`).
- **Their ROWS have different authorities** — Matchups from `projectGameScoreboardState`
  (`MatchupsWeekPanel.tsx:188`), Members from the six-branch block above.
- So on Members, **a summary disagreeing with the rows beneath it is STRUCTURAL** — two separate code
  paths, not one policy parameter. Fixing the slate counts without the row side leaves #722's shape
  alive in the component the fix is meant to make consistent.

**One more trap:** `liveRows = rosterRows.filter((row) => row.currentStatus === 'Live')`
(`ownerView.ts:334`) — a value `isAwaitingScoreGame` **never produces**. Anything reasoning from the
awaiting predicate alone cannot see how a row becomes `'Live'`.

### Other `liveGames` facts that are NOT yours

Found in the same audit, listed so you do not converge them: `computeStandings`
(`gameTags.ts:585-624`) increments a per-owner `liveGames` from its own derivation, and the Overview
league-tag path (`gameTags.ts:33,282`) counts a `liveGames` ARRAY for *"N live games affecting
standings"*. **Different surfaces, own rows, out of scope.** The acceptance boundary's invariant
`live + final + scheduled === distinct games` is **per slate**, never global — do not read it as a
claim about these.

## STOP — read receipt before writing any code

1. **Enumerate every caller of `getStateFromScore` in `matchups.ts`**, with what each does with the
   answer. Give the count. **If any caller is genuinely correct score-only, say which and why** — that
   is the difference between converging an authority and deleting one that is load-bearing somewhere.
2. **Can an `awaiting` row reach the owner card at all?** Construct it and report what the card shows
   today — the counts and the label — before changing anything. If it cannot be reached, #722 is
   wrong and I need to know before you build.
3. **What does `projectGameScoreboardState` need that `buildOwnerWeekPerformance` does not currently
   have?** Name every argument and where it comes from at the call site. **If `nowMs` has to be
   threaded from the component, say how far** — a selector signature change that reaches the page is a
   different size of slice than one that does not.
4. **Count the existing tests in `matchups.ts`'s suite that would go red** if the sort changed to
   non-finals-together. If the answer is zero, the current ordering is unpinned and your test is the
   first thing asserting it.
5. Does any test in the repo call these selectors **without** a pinned clock today? List them — those
   are the ones that become time bombs the moment `nowMs` is threaded through.
6. The contract names finals and non-finals. **What ordering does an unknown/`neutral` state get, and
   can it occur in production?** If you cannot produce one, say so and pick the safe placement.
7. **Enumerate every READER of the slate counts and say what each MEANS by them** — a rendered stat,
   a filter, a sort key, a disclosure threshold. `MatchupsWeekPanel.tsx:427-430` and
   `OwnerPanel.tsx:508-514` are two; give the count and say whether any reader would change meaning
   under distinct-game counting. **A reader that renders a number and one that gates a control fail
   differently.**
8. **The awaiting bound's blast radius.** `projectGameScoreboardState` has four non-test callers.
   If you bound inside it, **what changes on Overview and Schedule rows?** Name the rows and produce
   one. If you bound at the Matchups consumption point instead, say what stops the next consumer from
   inheriting the unbounded version. **Either answer is acceptable; an unmeasured one is not.**
9. **What does a game past `kickoff + 24h` with no score become?** Enumerate what `GameScoreboardState`
   can express and say whether any member is truthful for it. **If none is, say so** — that is a
   finding, and inventing a state silently is worse than reporting the gap.
10. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
