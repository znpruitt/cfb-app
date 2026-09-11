PROMPT_ID: PLATFORM-727-SCHEDULE-AWAITING-RECONSTRUCTION-CODEX-v2
PURPOSE: Issue #727 — reconstruct Schedule's scoreboard-state derivation from current `main`, around an explicit precedence model. v1 took two review rounds, round 2 found a regression created by round 1, AND half of what v1 built guards a provider state that has never occurred.
SCOPE: `src/lib/selectors/gameWeek.ts` and its tests, plus the pipeline coverage v1 established. NOT `CompactGameScoreboard`. NOT Matchups. NOT #728 (tags in `contextSlot`), which stays untouched.
CARRIES: NONE, having checked `item-87-INDEX.md`.

Read `AGENTS.md` first — **Review and remediation limits** is why this is a reconstruction and not a third commit.

## Why reconstruct rather than patch again

v1 is `bc7f5f0d` + `80c6b6c2` on `codex/727-schedule-awaiting-trigger`, PR #736. **Round 2 found a regression that round 1's remediation introduced** — a placeholder game with an attached final 31–28 renders `scheduled`, where both `4eaf0253` and `bc7f5f0d` rendered it `final`.

**That is the trigger, not a judgement call.** `AGENTS.md` binds reconstruct-don't-accumulate, and a fix that creates the next finding is the signal that the model is wrong rather than the patch.

**The lane proposed this itself.** Nothing here is a criticism of the work — v1 established the right behaviours and the tests that pin them. **They carry forward.**

## THE MODEL — write this down first, in code, before anything else

v1's defects were all one thing: **Schedule-derived gates outranked positive score evidence.** The gates were each individually reasonable and the ORDER was never stated, so every round found another place the implicit order was wrong.

**State the precedence explicitly and derive everything from it:**

| step | rule |
| --- | --- |
| **1** | **Project score evidence FIRST.** Before any gate is consulted. |
| **2** | **Usable `final` or `live` evidence WINS.** A real score outranks every schedule-derived gate. |
| **3** | **Placeholder and abandonment constrain ONLY evidence-free rows** — `scheduled` and `awaiting`. They cannot override evidence. |
| **4** | **When evidence wins, SUPPRESS the abandonment notice too.** A row showing a live score must not also claim the game was abandoned. |
| **5** | **Disruption sits in the same position as a forward-looking guard** — see below. It is not load-bearing and must not be treated as though it were. |

**If a future finding does not fit this table, the table is wrong and gets changed — not worked around.** That is the whole point of writing it down.

**The two REACHABLE cases, each its own test:**

- placeholder game + attached final **31–28** → **final**
- abandoned game + live Q4 **24–17** → **live**

**The third case v1 was scoped around — disrupted game + live Q3 7–10 — cannot occur.** Keep the guard consistent with the table, but **do not build the model around it and do not present its test as production coverage.** See below.

## ⚠️ DISRUPTION HAS NEVER OCCURRED. v1 BUILT HALF ITS MODEL AROUND IT.

**Measured through `DATABASE_URL_RO` 2026-09-11**, and independently 2026-09-08 for #661:

| population | measured |
| --- | --- |
| schedule cache, 7 partitions | **22,760 games, `status` = `scheduled` on every one.** `rawStatus` **absent from every row.** |
| score cache, 15 partitions | **20,424 status values, exactly two: `final` (19,524) and `scheduled` (900).** |

**`isDisruptedStatusLabel` cannot return true on this data, so `summaryStateKind`'s `'disrupted'` branch is unreachable.**

**v1 read `rawStatus` — a field no production row carries.** That was not a mistake in reasoning; `gameUi.ts:61-62` describes disrupted labels as live behaviour, and **#661 exists because that comment has now caused a wrong conclusion twice.**

**What this means for the reconstruction:**

- **Keep the guard.** `AGENTS.md` requires a module with no live consumer to say why rather than be deleted, and #661 says so explicitly. A provider value that could appear is worth guarding.
- **Say in the code that it is forward-looking, not observed.** #661 lands the authoritative note at `gameStatus.ts`; **defer to it, do not restate the measurement.**
- **Do not make an unreachable case a required test and call it coverage.** If you test it, label it as guarding a state never seen in production — `AGENTS.md` binds that a measurement's coverage is part of its result.
- **Do not read `rawStatus` as though it were populated.** If the guard needs a field, say which field actually carries the value.

## Two defects that are NOT precedence — fix them separately

**Score-pack disruption enums are not normalized.** The score-pack branch can expose literal provider values such as `STATUS_POSTPONED`. **It must use the same token normalization the `rawStatus` branch uses.** One normalizer, two call sites — not two spellings.

**An absent `startTimeTBD` fails OPEN.** `startTimeTBD === true ? null : game.date` treats `undefined` as a confirmed kickoff. **A kickoff is confirmed only when `startTimeTBD === false`.** Both `true` and `undefined` must pass no kickoff to the projection.

## Carry forward from v1 — settled, do not re-derive

- **Scoreless rows past kickoff await through the eight-hour abandonment boundary**, then restore `Scheduled · kickoff`. **This is the real defect #727 was filed for** — the trigger currently fires only when a status label already says live, so the exact population `awaiting` exists for never reaches it. **900 score entries read `scheduled` today**, which is where this lives.
- **v1's raw-disruption handling does NOT carry forward as written.** It read `rawStatus`, which no row populates. Re-derive it as a guard if you keep one.
- **Label-only `FINAL` does not bypass the shared projector.** Usable final scores determine `final`; Overview and Matchups already behave this way.
- **v1's pipeline tests**, which exercise the real `buildScheduleFromApi → deriveGameWeekPanelViewModel` path rather than the selector alone. That is what made round 1's findings confirmable.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote the current derivation** and say where in it a gate currently precedes evidence. Name the lines.
3. **For each of the three evidence-beats-gate cases, say what current `main` renders.** If any already renders correctly, that is a finding and the case still gets a test.
4. **Is the precedence table above complete?** Name any state or gate it does not cover. **A model that misses a case is how v1 got here**, and the receipt is the cheapest place to find that out.
5. **Where does the `rawStatus` normalizer live**, and can the score-pack branch call it as-is or does it need extracting?
6. Anything that CONTRADICTS what you were handed.

A receipt that summarises without quoting is not a receipt.

## Branch

`codex/727-awaiting-v2` from current `origin/main`, in `/Users/zach/cfb-app-codex`.
**#661 should land first** — it puts the authoritative measurement at `gameStatus.ts` for this prompt to defer to. If it has not merged when you start, say so and write the deferral as a TODO naming #661 rather than restating the numbers here.
**Do NOT build on `codex/727-schedule-awaiting-trigger`.** Cherry-pick tests from it freely; do not inherit its derivation.

**PR #736 stays open until the reconstruction PR exists**, then close it referencing the replacement. Its review history is the record of why this exists.

<task>
1. **Implement the precedence table as the structure of the code**, not as conditionals that happen to agree with it.
2. **Fix the two normalization defects.**
3. **Carry v1's settled behaviours and tests forward.**
</task>

<gate>
**Do NOT add a gate without placing it in the table.** A gate whose precedence is unstated is how v1 accumulated three rounds of findings.

**Do NOT touch #728.** Tags in `contextSlot` is a separate divergence with its own issue.

STOP and report if the table turns out to be incomplete — a missing row is a design question, not something to resolve inline.
</gate>

<completeness_contract>
- **Each of the three evidence-beats-gate cases has its own test.** One test covering all three proves none of them.
- **Each is mutation-proven**, and the report names **which side stayed green** — `AGENTS.md` binds this.
- **Both `startTimeTBD` shapes are asserted separately** — `true` and `undefined`. One test covering both proves neither.
- **A disrupted row with a winning live score asserts the notice is SUPPRESSED**, not merely that the state is `live`.
- **v1's carried tests still pass**, reported as a measured count.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: the precedence table as implemented; what changed and where; the measured test delta; the
mutations with the green side named; and anything you deliberately did not do.

**Say whether the table survived contact with the code unchanged.** If it needed a row, say which and why — that is the most useful sentence in the report.

Closeout is a separate pre-merge commit after review convergence. **`Closes #727` in the PR body**, and close #736 referencing the replacement.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. **Verify the remote ref moved before reporting a push.**
</output_contract>
