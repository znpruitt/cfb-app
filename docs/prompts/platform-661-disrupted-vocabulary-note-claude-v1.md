PROMPT_ID: PLATFORM-661-DISRUPTED-VOCABULARY-NOTE-CLAUDE-v1
PURPOSE: Issue #661 — four comments describe a provider vocabulary as live behaviour that has never been observed in seven seasons. Put one authoritative measurement at the classifier and make the others defer to it.
SCOPE: `src/lib/gameStatus.ts` (the authoritative note), and the comments at `src/lib/gameUi.ts`, `src/lib/useLiveRefresh.ts`, `src/lib/standingsHistory.ts`, `src/app/api/scores/route.ts`. **COMMENTS AND ONE NOTE. No behaviour change.**
CARRIES: NONE, having checked `item-87-INDEX.md`.

Read `AGENTS.md` first.

## ⚠️ DO NOT DELETE THE CLASSIFIER OR ANY CONSUMER

**A guard against a provider value that could appear is legitimate.** `AGENTS.md` requires a module with no live consumer to say why rather than be removed, and that is exactly what this item asks for.

**The guards are not the defect. The comments are** — because they are written as descriptions of live behaviour and a reader takes them as fact.

## What has been measured, twice, on two different populations

**2026-09-08** (the original filing) and **2026-09-11** (re-measured through `DATABASE_URL_RO` while scoping #727):

| population | measured |
| --- | --- |
| schedule cache, 7 partitions | **22,760 games, `status` = `scheduled` on every one.** `rawStatus` is **absent** from every row. |
| score cache, 15 partitions | **20,424 status values, exactly two distinct: `final` (19,524) and `scheduled` (900).** |

**Not one disrupted label, on either field, ever.** The provider leaves a disrupted game `scheduled` — which is how six cancelled Alderson-Broaddus games reached the cache at `0-0`, and how the Week 1 power-outage game presented.

**The 2026-09-08 count was 22,761 and today's is 22,760.** One row, three days apart. Not material, and recorded so the two numbers do not silently disagree.

## The cost is not hypothetical, and it has now happened twice

**`gameUi.ts:61-62` says** *"Disrupted labels (postponed/canceled/suspended/delayed) present as 'scheduled', matching the classifier's buckets."*

- The filer of this issue: *"I reasoned from this sentence today and concluded a suspended game was the likely path into Item 169. It was not."*
- **2026-09-11: the #727 implementation built disruption handling into Schedule's scoreboard derivation**, including reading `rawStatus` — a field no production row carries — and a planning prompt was drafted making two unreachable disruption cases into required tests. **Caught by the owner, not by any gate.**

**A comment written as description gets read as fact. That is the whole item.**

## The count has moved — re-derive it

The entry says "roughly ten call sites." Measured 2026-09-10: **3 references outside tests, one of them the definition.** Re-derive before scoping; do not inherit either number.

## STOP — post a READ RECEIPT before writing anything

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote all four comments verbatim, with current line numbers**, and say for each whether it asserts observed behaviour or describes a forward-looking guard. **Not every one may need changing.**
3. **Re-derive the consumer count.** Every reference to `DISRUPTED_RE`, `isDisruptedStatusLabel` and the `'disrupted'` classifier bucket, outside tests. Say the number.
4. **Is `rawStatus` populated anywhere?** Planning measured it absent on all 22,760 schedule rows. **If any writer sets it, that is a finding** and the note must say so rather than claiming the field is unused.
5. **Does any test assert disrupted behaviour?** A test pinning a state the provider never produces is a different problem from a comment, and it should be named rather than quietly left.
6. Anything that CONTRADICTS what you were handed.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/661-disrupted-vocabulary-note` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`. **Do NOT push `preview`** — Codex holds it.

<task>
1. **One authoritative note at `gameStatus.ts`'s classifier**, recording: the measurement above with its date and populations, that the guard is **forward-looking rather than observed**, and that a disrupted game presents as `scheduled` in practice.
2. **Make the other comments defer to it** rather than each restating a behaviour nobody has seen. A pointer, not a copy — four copies of one measurement is how they drifted into four different phrasings.
</task>

<gate>
**NO BEHAVIOUR CHANGE.** Not the classifier, not a consumer, not a test's expectations. If you believe a guard is wrong, that is a finding to report, not a change to make.

**Do NOT delete the classifier.** It is a legitimate forward-looking guard and this item says so explicitly.

**Do NOT restate the measurement in each comment.** One authoritative place, four pointers. Restating it is the defect this item is fixing.

STOP and report if `rawStatus` turns out to be populated by any writer — that changes what the note can honestly claim.
</gate>

<completeness_contract>
- **The authoritative note carries the measurement, its date, and both populations** — a note saying "rare" rather than "never observed across 22,760 schedule rows and 20,424 score values" is the vague claim this replaces.
- **No comment restates the measurement.** Assert this by reading, and say how you checked.
- **No behaviour changed**, demonstrated by an unchanged test count and an unchanged failure set.
- Test count delta reported as a measured number, expected to be **0**.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: the four comments as found and as changed; the re-derived consumer count; whether any test
asserts disrupted behaviour; and anything you deliberately did not do.

**Say plainly whether every comment needed changing.** If one was already correct, leaving it alone is
the right answer and worth stating.

Closeout is a separate pre-merge commit after review convergence. **`Closes #661` in the PR body.**

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. **Verify the remote ref moved before reporting a push.**
</output_contract>
