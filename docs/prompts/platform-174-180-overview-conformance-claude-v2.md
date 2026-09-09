PROMPT_ID: PLATFORM-174-175-176-178-180-OVERVIEW-CONFORMANCE-CLAUDE-v2
PURPOSE: Items 174, 175, 176, 178 and 180 — four Overview divergences the audit found and the owner has already ruled on. Every decision is made; none of them is yours to re-litigate.
SCOPE: `src/components/OverviewPanel.tsx`, `src/lib/gameUi.ts`, `src/lib/gameCardPresentation.ts`, `DESIGN.md`, and tests for each. **NOT `CompactGameScoreboard.tsx` — Item 143 has it open in the other lane.** NOT tag selection or precedence.
CARRIES: `item-87-INDEX.md` CARRY rows 7 and 8, verbatim in the task block.

Read `AGENTS.md` first, then **`DESIGN.md`** — canonical for UI, and one of these four is a rule it
already carries that has never been built. Nothing in either is restated.

## These came from Item 167's audit, and all four are RULED

**Do not re-derive the decisions.** The audit found eight divergences mapping to no filed item; the
owner ruled on four the same day. **Your job is to build the rulings, not to evaluate them.** Where a
ruling looks wrong, that is a stop-and-report, not a redesign.

**The reference render is `mockups/live-scoreboard-mockup.html`, REBUILT 2026-09-08.** The previous
version encoded the very layout Item 160 calls a defect, and its class names caused the mis-citation
behind Item 175. **Use the current file. Its notes block explains what changed and why.**

## The four

### 174 — Live rows render no broadcast

`GameCardList` (`OverviewPanel.tsx:653`) serves **both** Live and Recent finals and **accepts no
broadcast prop at all**. Omitting it is correct for finals — `reference-game-row.md` §1: _a completed
game's broadcast is dead information_ — and wrong for live.

**`DESIGN.md:201`: broadcast renders for scheduled, live and awaiting rows, not finals.** §11 agrees.

**One component, two states, a rule that differs by state — and Live silently inherits the finals
rule.** `WatchlistScoreboardList` already formats it (`:743`), so the data and the formatter both
exist.

**AND IT IS NOT ONLY THE OUTLET NAME — read this before writing the change.**
`formatPrimaryBroadcastLabel` (`gameCardPresentation.ts`) returns the bare outlet for TV (`ABC`,
`FOX`) but **prefixes non-TV**: `Streaming · ${outlet}` and `Radio · ${outlet}`.

**`Streaming ·` is already ruled for removal — Item 180, and it must land in this slice, not after.**
Giving live rows a broadcast label first would spread that prefix onto a surface that does not carry it
today, leaving the cut two surfaces to clean instead of one.

**`Radio ·` STAYS.** It is not ruled and is a different case — radio is a different KIND of broadcast
rather than a less familiar name for the same kind, so dropping it could present a radio-only game as
watchable. **Do not remove it, and do not ask to.**

**Item 180 carries an owner condition you must discharge before applying the cut:** verify that no
`web`/`mobile` outlet in the schedule-media cache reads as something other than a streaming service
without its prefix. **Report the enumeration.**

### 175 — the watchlist reason label becomes a pill

**OWNER RULING 2026-09-08.** `Upset watch` and `Game of the Week` render as plain bronze text
(`gameUi.ts:189`) beside `Top 25 Matchup` as a bronze pill. **Two treatments, one slot, one row.**
`reference-game-row.md` §2 rejects the split: _"One treatment, no per-class variation… undecodable…
Rejected."_

**The reasoning, so you do not need to reconstruct it:** the Featured exemption this was built on was
written for the **Featured tile's** reason ROW — a card title on its own line. **The watchlist's sits
INLINE BESIDE A PILL, so it is functioning as a tag and the exemption does not reach it.**

**DELETE the mis-citation at `gameUi.ts:177-188`, do not repoint it.** The exemption does not apply to
this row at all, so a repointed comment would justify a rule that no longer exists here. **The Featured
tile's own plain-text row is NOT in scope and does not change** — it remains the only plain-text bronze
on the page, and the rebuilt mockup names it `.fx-reason-row` for exactly that reason.

### 176 — Featured hides when empty

`OverviewPanel.tsx:1649` renders Featured when
`viewModel.recentResults.length > 0 || gameSections.recentFinals.length === 0` — so on a page with
**zero games** it renders a heading and `No recent results yet.`

**Both references say empty sections hide** (`composition.md` §2, `reference-game-row.md` §12): _"the
order is self-managing"_.

**OWNER RULING 2026-09-08, and it does NOT wait on Item 113**, because both readings of Featured agree:
results-based empty means no results, must-watch empty means nothing selected, **and either way an
orthogonal section with nothing in it does not render.**

**`OverviewPanel.test.tsx:1781-1800` currently defends the wrong behaviour.** It dates to `352054d1`
(2026-03-26), **months before** the hide rule was written. **Change it to defend the rule.** That is
not collateral damage — it is the point.

### 178 — the 17px/650 section headers, decided and never built

`DESIGN.md:390-393` records the **Game-section exception (17px, weight 650)**, owner decision
2026-09-03, naming Overview's **Live, Featured games, Watchlist and Recent finals** headers explicitly
and saying it is _"not a new default elsewhere"_. `item-87-live-watchlist-scoreboard.md:564` marks it
**"Landed"**.

**`git log -S'text-[17px]' -- src` returns ZERO commits.** All four headers render through one
`SectionHeader` (`OverviewPanel.tsx:391`) at `text-[15px] font-medium`.

**OWNER RULING 2026-09-08: BUILD IT, do not retract it.** The alternative is retracting a canonical
claim because nobody implemented it, which sets the wrong precedent for a family this campaign has now
hit three times. **The fix for a canonical rule that was never true is making it true; a rule is
retired only when the RULE is wrong, never because the code disagrees.**

**Scope it to those four headers.** `SectionHeader` may serve others — check before changing it
globally.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Name every caller of `SectionHeader`** and say which are the four the exception covers. **If it
   serves headers outside Overview's game sections, changing it globally is a regression** — say how
   you will scope it.
3. **Quote the current Featured render condition and say what renders in each of its three cases**:
   games present, no games at all, and recent finals present but no featured results. **The third is
   the one the ruling must not break.**
4. **Say what `GameCardList` needs to accept broadcast**, and whether Recent finals can be kept
   unchanged by the same change. **If suppressing it for finals requires a state test inside the
   component, say so** — `DESIGN.md` forbids defining state-dependent rendering by negation.
5. Anything that CONTRADICTS what you were handed. **Every line number above is mine and re-derived
   today; check them anyway** (CARRY row 7).

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/174-178-overview-conformance` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`.

**Do NOT push `preview`.** Codex holds it for Item 143, and `CLAUDE.md`'s standing push-every-commit
instruction is **suspended for this branch** — that suspension is what preserves the single-writer
condition the grant depends on.

<task>
Build the four rulings above.

**CARRIED OBLIGATIONS — verbatim:**

> **Row 7 — LIVE.** **Do not read campaign status from the canonical document**, and **re-derive every
> line-number citation** before putting it in a prompt — they have been stale at least twice, and
> `DESIGN.md` moved again on 2026-09-08.

> **Row 8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard **must not be
> forked**. **CORRECTED 2026-09-08** — there are five direct renderers, and the recap is not one of
> them; `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`.
</task>

<gate>
**Do NOT touch `CompactGameScoreboard.tsx`.** Item 143 has it open in the Codex lane. If a ruling
appears to need a change there, **stop and report** — that is a real finding about scope, not a reason
to reach across.

**Do NOT change the Featured tile's plain-text reason row.** Only the watchlist's changes.

**Do NOT change tag SELECTION or precedence** — selector-owned (row 8).

**Do NOT add a state test inside a shared component to suppress broadcast on finals.** If that is the
only way, stop and report; `DESIGN.md` requires state-dependent rendering be enumerated per state
rather than defined by negation.

**Do NOT make `SectionHeader` 17px globally** unless receipt item 2 establishes it serves only those
four.

STOP and report if any ruling cannot be built as stated.
</gate>

<completeness_contract>
- **A live row renders its broadcast; a final row does not.** Assert both, on rendered output. **A
  test that only covers live proves half the rule.**
- **The watchlist reason label renders as a pill**, matching the tag treatment. Assert equality of the
  rendered treatment between a reason label and a tag — **that is the assertion that catches the next
  drift**, not a class-literal match.
- **The Featured section is absent from the DOM on a zero-game render**, and the old assertion is
  replaced rather than deleted. **Mutation-prove it**: restore the empty render and show a named test
  go red.
- **All four game-section headers render 17px/650, and no other header changes.** Assert both halves.
- **Nothing outside Overview moves.** Prove by mutation — `GameWeekPanel` and `MatchupsWeekPanel`
  consume `gameUi.ts`.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving Featured now hides; the
mutation proving the other consumers are untouched; and anything you deliberately did not do.

**Say what a member sees on Overview before and after**, section by section.

**Report whether `SectionHeader` needed scoping**, per receipt item 2.

Closeout is a separate pre-merge commit after review convergence: registry entry, Items 174/175/176/178
status, and **`item-87-live-watchlist-scoreboard.md:564`'s "Landed" mark for Amendment 5 becomes true
for the first time** — say so explicitly, since it has been asserting that since 2026-09-03.

**Report new findings; do not file them** (`AGENTS.md` → Documentation closeout timing).

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. Promotion is not. **Push the branch only — not `preview`.**
