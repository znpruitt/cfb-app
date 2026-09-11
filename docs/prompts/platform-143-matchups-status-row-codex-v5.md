PROMPT_ID: PLATFORM-143-MATCHUPS-STATUS-ROW-CODEX-v5
PURPOSE: Item 143 reconstruction. Give the shared scoreboard a status-row tag seam and a caller-supplied status label, using the SHARED kickoff-aware classifier rather than a Matchups-local status condition — which is what v3 failed on, three rounds running.
SCOPE: `src/components/CompactGameScoreboard.tsx`, `src/lib/gameUi.ts`, `src/components/MatchupsWeekPanel.tsx`, **plus the new shared projection and its extraction from `overviewGameSections.ts`**, tests for each. NOT `gameStatus.ts`. NOT a new metadata slot. NOT Overview's sectioning, omission or polling windows.
CARRIES: `item-87-INDEX.md` CARRY rows 7, 8, 20, 25 and 26, verbatim in the task block.

Read `AGENTS.md` first, then **`DESIGN.md`**. Nothing in either is restated.

## v3 STOPPED. You called it, and you were right.

Three rounds, both remediation rounds exhausted, four findings open. **The round-3 MEDIUM is the same
defect class as round 1's** — a local label asserting more than the classifier established — which
`AGENTS.md` records as the signal that **the model is wrong, not the patch.**

**Reconstruction discards the CODE, not what the rounds learned.** Carried forward as settled, do not
re-derive or re-litigate:

- **The tag flex seam is structurally correct** — left group grows (`flex: 1 1 auto; min-width: 0`),
  tag `flex: none`. Confirmed by review.
- **Scheduled-only phone wrapping is correct.**
- **Neutral live hue STAYS on Matchups.** Rejected in round 1 and the rejection stands: `DESIGN.md`
  reserves neutral live treatment for Matchups, and **freshness-gated motion is the differentiator,
  not colour.**
- **`statusMetadataSlot` does not return.** It was added at a reviewer's request, later established as
  outside this item, and had no caller. **Do not rebuild it, and do not accept a review finding asking
  for it.**
- **`overflow-hidden` on tagged headers stays.** The contract is that tags never clip.

## THE MEASUREMENT THAT EXPLAINS THE FAILURE — new, and v3 could not carry it

**Item 172, measured against the production replica on 2026-09-08, AFTER v3 was written:**

| field | source | values observed, all seven seasons |
| --- | --- | --- |
| `game.rawStatus` | schedule cache `status` | **`scheduled` — 22,761 of 22,761** |
| `score.status` | score cache | **`final` or `scheduled`. Nothing else.** |

**The provider has never emitted `postponed`, `canceled`, `suspended` or `delayed`.** It leaves a
disrupted game as `scheduled` — which is how six cancelled games reached the cache at `0-0`, and how
the Week 1 power-outage game presented.

**Your v3 branch added 23 references to disrupted/suspended/postponed/cancelled and 3 to `awaiting`.**
Rounds 1 and 2 hardened a state that cannot occur. **The reachable defect is the one round 3 found**,
and it is the whole of what this reconstruction must fix.

**Comments in the code will tell you otherwise** — `gameUi.ts:61-62` says disrupted labels "present as
'scheduled'", and three other comments say similar. **They are wrong and Item 172 owns correcting
them. Do not build for them and do not correct them here.**

## THE DEFECT, stated as a state question rather than a label question

A Matchups row past kickoff with no score, or with a lagging score, **renders `SCH`.** It should not:
past kickoff with no usable score is **`awaiting`**, which the shared component already renders
(`state="awaiting"`), and which Overview already reaches.

**The fix is to stop deciding this in `MatchupsWeekPanel`.** v3 failed three times because each round
added another Matchups-local condition to a label the component should be told. **Matchups supplies
facts — kickoff time, score presence — and the shared projection decides the state.**

**That projection does not exist yet and building it is part of this slice** — see RULING 2. Matchups
will need `now` threaded to it, which it does not receive today.

## RULINGS ON YOUR v4 RECEIPT — the gate fired correctly, and the answer shrinks the slice again

**You were right to stop, and the blocker is real: no shared four-state projection exists.** Your
inventory of why reproduces — `gameStateFromScore` is score-only, `routeForItem` is private and carries
Overview's ownership/sectioning/omission, `isAwaitingScoreGame` is a boolean on a 24-hour polling
window, and Matchups receives neither `now` nor `season`.

**But the deeper problem is the CONTRACT, and it was mine.**

### RULING 1 — `reference-game-row.md` §11 said Matchups does not render `awaiting`. It is amended.

**v4 told you to make a post-kickoff row `awaiting` while the consumer matrix listed only
`scheduled, live, final` for Matchups.** You would have hit that contradiction at implementation.

**Amended on `main`, with the reason recorded:** the matrix documented what SHIPS, not what is correct.
Matchups never reaches `awaiting` **because it decides its own status label** — which is this item's
defect. **A row past kickoff with no usable score currently renders `SCH`, a claim that the game has
not started.** `awaiting` is honest, the component renders it, Overview reaches it.

### RULING 2 — extract a projection that answers ONE question. Do not move Overview's other concerns.

**Build a shared function taking `(score, kickoff, now)` and returning `scheduled | live | awaiting |
final`.** That is the whole of it.

**What must NOT come with it, and this is why `routeForItem` is unshareable today:** ownership,
sectioning, abandonment, omission, and the polling window are **separate concerns that merely also use
time.** Conflating them is what made the existing helper Overview-only. **Leave Overview's eight-hour
omission where it is** — that is a sectioning rule about when Live should empty, not a statement about
what state a row is in. **Leave `isAwaitingScoreGame`'s 24-hour window where it is** — that is the
poller's question, not the renderer's.

**Overview should consume the new projection** for its state decision if that falls out cleanly. **If
it does not, say so and leave Overview alone** — a refactor of Overview's sectioning is not this slice
and I will not accept it as one.

### RULING 3 — NO time policy on `awaiting`. Measured, not assumed.

**Your open semantic question — how long a past-kickoff row stays `awaiting` — has an empirical
answer.** Measured against the production replica today: across **all of 2026**, exactly **two** games
are past kickoff with no final score — **one D-II from 29 August, one D-III from 5 September. Zero
FBS. Zero FCS.**

**Neither is reachable on a Matchups card**, and Item 150 removes both divisions regardless.

**So `awaiting` persists with no limit and no omission.** A Matchups card is an owner's week and must
never drop a game. **Building a window would guard nothing — which is precisely the mistake v3 made
with disrupted statuses**, and I am not going to have you make it twice in one item.

### RULING 4 — your carry/discard list is adopted as written

Nothing to add and nothing I disagree with. **Two entries I want kept verbatim in the closeout** because
they are honest about their own limits: _"static JSDOM markup cannot prove rendered pixel height"_, and
the recursive renderability detection that preserves the exact untagged branch.

**Bookkeeping accepted:** 23 behind, not 22 — the v4 commit accounts for it. And your note that
including `delay` raises the disrupted count to 26 is the right correction to make, since I named four
families and counted three.

### RULING 5 — `preview` stays on the stopped branch until you have something to push

Correct as you left it. **Push the reconstruction over it on your first commit.**

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Name the shared kickoff-aware classifier(s) that already exist** and say, for each, what it takes
   and what it returns. **Overview reaches `awaiting` today** — find how, and say whether Matchups can
   use the same path unchanged. **If it can, this slice is smaller than v3 by a large margin.**
3. **Enumerate every state a Matchups row can be in**, from the data rather than from the labels, and
   say which the component can already render. **Enumerate; do not define by negation** — `DESIGN.md`
   requires it and it is how `SCH` reached the wrong rows.
4. **Say what carries over from v3 and what does not.** You have the branch. **Name anything in it
   worth keeping that this prompt has not already listed** — and anything listed that you now think is
   wrong.
5. Anything that CONTRADICTS what you were handed. **The 23-versus-3 count and Item 172's measurement
   are mine and are checkable.**

A receipt that summarises without quoting is not a receipt.

## Branch

**A NEW branch off current `origin/main`** — `codex/143-status-row-v2`, in `/Users/zach/cfb-app-codex`.
**Do not build on `codex/143-matchups-status-row`**; it is 22 behind and carries the discarded model.
A `pre-push` hook runs `npm run lint:all`.

**`preview` stays yours.** It currently holds `7d6c28ca`, the stopped branch — **push the new branch
over it on your first commit** so the owner is never clicking through abandoned work.

<task>
1. **The status-row tag seam.** Tags render inside the header row, right-aligned. A tagged row and an
   untagged row are the same height.
2. **A caller-supplied status label**, so Matchups can render `SCH` on scheduled rows — **decided by
   the shared projection, not by a Matchups condition.**
3. **Forward `liveHue` and `liveDot`.** They exist in `gameUi.ts`; the scoreboard calls it with no
   options. **Add `motion-safe:` to the pulse** — round 3's LOW, and correct.
4. **Wire Matchups**, moving tags off `tier2Slot` into the status row. Opponent and kickoff metadata
   stay in tier 2; `contextSlot` stays for `game.label`.
5. **Drop `max-sm:whitespace-normal`** — round 3's LOW; dead because descendants restore
   `whitespace-nowrap`.

**CARRIED OBLIGATIONS — verbatim:**

> **Row 25 — Item 143.** State the `margin-left: auto` trap in the prompt: the left group must grow
> (`flex: 1 1 auto; min-width: 0`), tag `flex: none`.

> **Row 26 — Item 143.** Build the single-column wrap exception as the owner narrowed it: tagged
> scheduled rows at phone width; not a general licence to wrap (`DESIGN.md` amendment 2026-09-08).

> **Row 8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard **must not be
> forked**. **CORRECTED 2026-09-08** — five direct renderers, and the recap is not one;
> `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`.

> **Row 7 — LIVE.** **Do not read campaign status from the canonical document**, and **re-derive every
> line-number citation**.

> **Row 20 — SEQUENCING.** Retire the outcome rail on Matchups and let the tint carry outcome. **NOT
> YOURS**, and it cannot be done alone — the rail exists BECAUSE the tint's outcome states are
> unbuilt. **Do not add anything that makes retiring it harder.**
</task>

<gate>
**Do NOT add a state condition in `MatchupsWeekPanel` to decide a status label.** That is the defect
this reconstruction exists to remove. If the shared projection cannot answer, **stop and report** — a
missing projection is a finding, not a licence for a local condition.

**Do NOT build for disrupted statuses.** They do not occur (Item 172). A guard is acceptable; a
rendering path, a label mapping, or a test fixture for them is scope you must not add.

**Do NOT rebuild `statusMetadataSlot`**, including if a reviewer asks for it. Report the request.

**Do NOT change what tags are selected or their precedence** — selector-owned.

**Do NOT touch `gameStatus.ts`.** Item 172 owns it.

**Do NOT move Overview or Schedule.** Byte-identical; prove by mutation.

STOP and report if the shared projection needs widening to serve Matchups.
</gate>

<completeness_contract>
- **A row past kickoff with no usable score renders `awaiting`, not `SCH`.** The headline. Assert on
  rendered output, **and mutation-prove it** by restoring the scheduled label and showing a named test
  go red.
- **A row before kickoff renders `SCH`.** Both sides of the boundary, or the test proves half the rule.
- **A tagged row and an untagged row are the same height.**
- **The tag survives an OVERFLOWING row**, not only a roomy one. Mutation-prove by removing
  `min-width: 0` from the left group.
- **The live pulse respects `prefers-reduced-motion`.**
- **Overview and Schedule are byte-identical.** Prove by mutation. **Assert on markup, not on a hash**
  — round 2's finding, and it stands.
- **Generate over the type's contract**, varying state, tag count 0-2, and metadata presence
  independently.
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
Report: what changed and where; the measured test delta; the mutation proving a post-kickoff row is
`awaiting`; the mutation proving Overview and Schedule are untouched; and anything you deliberately did
not do.

**Say what a member sees on a Matchups row before and after**, in lines, for scheduled, live, awaiting
and final.

**Say how much smaller this is than v3**, with the diffstat of both. **If it is not smaller, say so** —
that would mean the model change did not simplify anything, which is a finding about this ruling.

**Report new findings; do not file them** (`AGENTS.md` → Documentation closeout timing).

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 143 status, and
`item-87-INDEX.md` CARRY rows 25 and 26 to DISCHARGED.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. Promotion is not. **Push `preview` with every commit.**
