PROMPT_ID: PLATFORM-722-724-MATCHUPS-DERIVED-STATE-CODEX-v1
PURPOSE: Matchups derives game state from the score alone, while the row it renders derives it from
score plus kickoff plus now. That single divergence produces both a card that reports zero live games
while a row inside it says otherwise (#722) and a sort order the contract does not describe (#724).
SCOPE: `src/lib/matchups.ts` and its suites; `src/components/MatchupsWeekPanel.tsx` only if the
convergence requires the panel to pass something it already has. NOT `GameWeekPanel.tsx`, NOT
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
`preview` with every commit including the closeout.

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
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
