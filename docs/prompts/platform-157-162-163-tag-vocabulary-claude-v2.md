PROMPT_ID: PLATFORM-157-162-163-TAG-VOCABULARY-CLAUDE-v2
PURPOSE: Items 157, 162 and 163 — one decision about what the tag vocabulary IS. Three markers each restate something already visible on the row; after this slice the vocabulary is game facts only.
SCOPE: `src/lib/gameTags.ts`, `src/lib/selectors/matchups.ts`, `src/components/MatchupsWeekPanel.tsx`, and tests for each. NOT tag PLACEMENT (Item 143, running concurrently in the other lane). NOT the tag treatment (Item 153, shipped).
CARRIES: `item-87-INDEX.md` CARRY rows 7, 8 and 72, verbatim in the task block.

Read `AGENTS.md` first, then **`DESIGN.md`** — canonical for UI, and this slice acts on two rules
already in it. Nothing in either is restated.

## Why ONE item and not three

All three are the same defect: **a marker restating a fact already on the row.** Filed separately
because they were found separately. Doing them separately means three read-receipt cycles, three
review rounds and three chances to re-litigate the same question against one file — which is how the
Schedule and Matchups treatments drifted apart in the first place.

**`docs/campaigns/item-87-reference-game-row.md` §2 is the consolidated statement of the vocabulary.**
Read it first. It is a REFERENCE — it adds nothing new, and where it disagrees with another document
`item-87-INDEX.md` arbitrates and the reference yields. **A claim in it nothing else supports is a
defect in that file; report it.**

## The three, with the rule each one breaks

### 157 — `Top 25` is a lossy label, and `Ranked Team` restates the row

`gameTags.ts` `LEAGUE_TAG_LABELS` renders `top_25_matchup` as **`'Top 25'`**. But
`hasTop25Matchup = isRankedTop25(awayRank) && isRankedTop25(homeRank)` — **both ranked.**
**`Top 25` reads as a property of the game** and would be understood to fire on `#1 Ohio State`
against an unranked opponent.

**Owner ruling 2026-09-08: `Top 25 Matchup` is correct and must NOT be shortened.** "Both ranked" is
not derivable at a glance the way one visible rank is, so *Matchup* is the word carrying the
information. **The shortening looks obviously right until you check** — which is why it is recorded.

**`Ranked Team` is retired.** Beside `#25 Missouri` it adds nothing; the rank is on the row.

### 162 — `Contender Watch` is owner standing rendered as a chip

**`DESIGN.md:296-297` forbids it outright:** *Owner standing appears inline beside the owner name, never
as a chip — it is true on every row, so as a marker it would carry no signal.*

**Structurally high-frequency, by construction.** `selectors/overview.ts:496` builds `topOwnerNames`
from `standingsLeaders.slice(0, 3)`, and `gameTags.ts:63` fires when **either** participant is owned
by one of them. Observed on **five of six** watchlist cards on the Week 2 board — one slate, not a
measured rate — including **Rutgers 0–1 against Boston College 0–1**, where "top three" is one game's
worth of noise.

**It is also a fact about an OWNER sitting in a row of facts about the GAME.** That is the distinction
`DESIGN.md:296-297` draws.

### 163 — the `vs <owner>` pill, and this one is a RULING, not a retirement

`selectors/matchups.ts:48` returns `` `vs ${opponentOwner}` `` and `MatchupsWeekPanel.tsx:286` renders
it as a pill. **The scoreboard already renders each team's owner inline on its own row**, so when the
opponent has a displayable owner that name appears **twice on one card**. The mockup carries no such
pill. It reads as a leftover from before Matchups adopted the shared scoreboard, when the descriptor
was the only place the opponent's owner appeared.

**But `DESIGN.md:289` is explicit that a chip restating inline content is legitimate WHEN IT AIDS
SCANNING**, so redundancy alone does not settle it. **Bring the question back with what you find; do
not decide it in the diff.**

**Whatever is decided, the non-owner branches must survive.** `deriveOpponentDescriptor` also produces
`FCS`, `NoClaim (FBS)` and placeholder/derived participant names. **None of those appear anywhere else
on the row** and none is duplicative.

## What is already true — verified 2026-09-08, do not re-derive

**The two-tag cap ships and is tested.** `TOP_BADGE_LIMIT = 2` (`gameTags.ts:38`) applied in
`deriveGameHighlightTags` at `:457`; `gameTags.test.ts:941` asserts it against a game carrying three
qualifying tags. **Item 166 was filed to add it and closed unworked.** Do not add a cap.

**`prioritizeGameTags` needs none either.** `upset` requires `state === 'final'` and `upset_watch`
requires `state !== 'final'`, so the league family cannot exceed two.

**These retirements shrink the space.** Removing `ranked` and `contenderWatch` leaves `top25` and
`close`, which are independent — so the highlight family drops to a maximum of two. **The cap's
existing test must still be able to reach three, or it becomes vacuous.** That is a named risk, and
it is receipt item 4.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote `DESIGN.md:289` and `:296-297` with re-derived line numbers.** Say which of the three items
   each governs, and whether either governs the `vs <owner>` pill. **`:289` may permit it.**
3. **Enumerate every consumer of every label you change** — `LEAGUE_TAG_LABELS`, `GameHighlightTag`
   text, `deriveOpponentDescriptor`. **A label appearing in a test assertion is a consumer.** Say what
   breaks.
4. **`gameTags.test.ts:941` reaches the cap with three qualifying tags. Say whether it still can
   after these retirements.** If it cannot, **the cap's only test becomes vacuous** and that is a
   finding to report before you write anything — not something to fix silently with a fixture.
5. Anything that CONTRADICTS what you were handed. **The five-of-six observation, the both-ranked
   predicate and the twice-rendered owner name are all mine and all checkable — check them.**

A receipt that summarises without quoting is not a receipt.

## RULINGS ON YOUR RECEIPT — v2, and three of your corrections are mine

**Your receipt is accepted in full. Every citation you corrected was wrong and every one was mine.**
`DESIGN.md:284`/`:295` are the bowl-badge and rankings-inline lines; the rules are `:289` and
`:296-297`, corrected above. `gameTags.ts:596`/`:609` are `:597`/`:611` — **I wrote those into the
reference document and the Item 166 entry today, in the same commit that carried CARRY row 7.** Both
corrected on `main`. And **`CARRIES:` was not verbatim in three of three rows**; that is a `CLAUDE.md`
violation and the rows below are now copied exactly.

**`deriveOpponentDescriptor` has FIVE branches, not four** — `Self` is the one I missed, and it joins
the survives-regardless set. **And the completeness contract asked for something unassertable:**
`NoClaim (FBS)` never renders, because `hideOpponentDescriptor` suppresses it unconditionally, so it is
assertable at the selector only. Contract corrected below. **That `getOpponentBadgeClasses` therefore
has a dead `NoClaim (FBS)` branch is a finding — report it, do not delete it here.**

### RULING 1 — the vacuous cap test: report it, retarget what still discriminates, keep the code

**Your analysis is right and the gate holds: do not fabricate a third tag.** But do not leave a test
whose name claims it caps while its body cannot.

- **Split the assertion.** Priority ORDERING between `top25` and `close` still discriminates — keep
  that, and rename the test to what it actually proves.
- **Delete the cap assertion** rather than leave it passing vacuously, and **say in a comment at
  `TOP_BADGE_LIMIT` that the family can no longer reach it**, naming this slice.
- **Do NOT delete `TOP_BADGE_LIMIT` or the `.slice()`.** `DESIGN.md:293` was amended on 2026-09-08 to
  require the cap; deleting its implementation would leave a canonical rule with nothing behind it —
  **the exact "never true" failure that amendment exists to correct.** It stays as a forward guard,
  documented as one, which is the same shape as `AGENTS.md`'s rule that a module with no consumer must
  say why in the code.

### RULING 2 — the empty watchlist reason row: KEEP the reservation

**Same ruling as the odds band on 2026-09-08, for the same structural reason.** Overview renders the
watchlist as a **grid**, and after the retirements **some cards carry `top25` and some carry nothing**
— which is precisely the case where a reserved band earns its place, keeping two side-by-side cards
level. It becomes dead space only if it goes empty on EVERY card, which is Schedule's case and not
this one. **Do not touch `min-h-[22px]`.**

### RULING 3 — the ordering change is IN SCOPE, and must be reported

You found that `highlightTags[0].priority` feeds `watchlistPriority`. **Retiring two tags therefore
changes watchlist ORDER, not only labels** — which no filed item mentions.

**It does not collapse, and the prompt's gate does not forbid it.** `watchlistPriority`
(`selectors/overview.ts:343-350`) is a `Math.max` over four signals: `highlightTags[0].priority`,
`isUpsetWatch` 95, `isGameOfSlate` 90, `isRankedSpotlight` 70. Removing `contenderWatch` (90) and
`ranked` (70) removes one input to that max; `isGameOfSlate` also supplies 90 and `isRankedSpotlight`
also supplies 70. **"Do not change precedence" means do not re-rank the tags that remain** — it never
meant a retirement must leave ordering untouched, which is impossible.

**Report the ordering delta explicitly**, with a before/after on a real slate if you can reach one.

### Your findings that become work in this slice

- **`GameWeekPanel.test.tsx:1617` and `:1642` assert `/Top 25/`**, which `Top 25 Matchup` also
  satisfies. **Tighten them** — they discriminate nothing today and would discriminate nothing after.
- **`OverviewPanel.test.tsx:2046`'s name claims it prefers Top 25 Matchup and Contender Watch chips
  and its body asserts neither.** Fix the test to match its name, or rename it to what it proves.

### Your findings that are NOT this slice — report, do not act

- The dead `NoClaim (FBS)` branch in `getOpponentBadgeClasses`.
- `formatSlateSummaryText` being test-only with no production caller.
- Whether the reference document's §2 entries need updating — **that is closeout**, and you are right
  that they are not defects now.

## Branch

`claude/157-162-163-tag-vocabulary` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`.

**Do NOT push `preview`.** The Codex lane holds it for Item 143, and `CLAUDE.md`'s standing
push-every-commit instruction is **suspended for this branch**. That suspension is what preserves the
single-writer condition the grant depends on.

<task>
1. **157 — rename `top_25_matchup`'s label to `Top 25 Matchup`, and retire `Ranked Team`.**
2. **162 — retire `Contender Watch`.**
3. **163 — report on the `vs <owner>` pill; do not remove it without the ruling.** Receipt item 2
   settles whether `DESIGN.md:284` permits it. **The non-owner branches survive regardless.**

**CARRIED OBLIGATIONS — verbatim:**

> **Row 72 — Item 157.** `Top 25` is a LOSSY label already shipped on Schedule and Matchups.
> `gameTags.ts:586` computes `isRankedTop25(away) && isRankedTop25(home)` — **both ranked** — and
> `LEAGUE_TAG_LABELS` renders it `'Top 25'`, which reads as a property of the game and would be
> understood to fire on #1 vs unranked. **`Top 25 Matchup` is the correct label and must not be
> shortened** (owner ruling 2026-09-08). Retire `Ranked Team` instead — it restates a rank already on
> the row.

> **Row 8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard **must not be
> forked**. Now four consumers plus the recap.

> **Row 7 — LIVE.** **Do not read campaign status from the canonical document**, and **re-derive every
> line-number citation** before putting it in a prompt — they have been stale at least twice, and
> `DESIGN.md` moved again on 2026-09-08.
</task>

<gate>
**Do NOT change tag PLACEMENT.** Item 143 is running concurrently in the Codex lane and owns the
status-row seam. **Touching `CompactGameScoreboard.tsx` collides with a live branch** — if you believe
you need to, stop and report.

**Do NOT add a cap.** It exists (`TOP_BADGE_LIMIT`), it is in the selector, and it is tested.

**Do NOT remove the `vs <owner>` pill on your own judgement.** It is a ruling, and the non-owner
branches of `deriveOpponentDescriptor` must survive either way.

**Do NOT rename `top_25_matchup` the IDENTIFIER.** The label is what is wrong. A key rename touches
persistence and priority maps for no user-visible gain.

**Do NOT fix the cap's test by inventing a third tag.** If receipt item 4 shows it can no longer reach
three, report it — a fixture built to keep a test green is the vacuous-test failure this campaign has
shipped four times.

STOP and report if retiring `contenderWatch` leaves any surface with no tag at all where the design
expects one.
</gate>

<completeness_contract>
- **No surface renders `Ranked Team` or `Contender Watch`.** Assert against rendered output across
  every consumer, not a source grep.
- **`Top 25 Matchup` renders where `Top 25` did**, on Schedule and Matchups both.
- **A one-ranked game renders NO rank tag** after `Ranked Team` retires — assert the absence, and
  mutation-prove it by restoring the tag and showing a named test go red.
- **The `vs <owner>` pill is unchanged** unless the ruling says otherwise, and **all FOUR non-`vs`
  branches are unchanged regardless** — `Self`, placeholder/derived `displayName`, `FCS`, and
  `NoClaim (FBS)`. **Assert `NoClaim (FBS)` AT THE SELECTOR, not on rendered output** — it never
  renders, because `hideOpponentDescriptor` suppresses it unconditionally.
- **Watchlist ordering: report the delta.** Assert the new order on a fixture that would have sorted
  differently before.
- **The cap's existing test still reaches three qualifying tags**, or the report says plainly that it
  cannot and why.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **0** — there is no known-failure baseline. Item 137 (#696)
removed the last two time-bomb failures on 2026-09-11, so **any** failure is a stop-and-report,
not a baseline to verify against.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving a one-ranked game
carries no tag; and anything you deliberately did not do.

**Say what a member sees on the Overview watchlist before and after** — five of six cards carried
`Contender Watch`, so this is the visible outcome.

**Report the `vs <owner>` ruling as a QUESTION with your evidence**, not as a change.

**Report whether the cap's test survives**, per receipt item 4.

Closeout is a separate pre-merge commit after review convergence: registry entry, Items 157/162/163
status, and `item-87-INDEX.md` CARRY row 72 moved to DISCHARGED.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the
four conditions. Promotion is not. **Push the branch only — not `preview`.**
