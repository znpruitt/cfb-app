PROMPT_ID: PLATFORM-661-DISRUPTED-VOCABULARY-NOTE-CLAUDE-v1
PURPOSE: Issue #661 — four comments describe a provider vocabulary as live behaviour that has never been observed in seven seasons. Put one authoritative measurement at the classifier and make the others defer to it.
SCOPE: `src/lib/gameStatus.ts` (the authoritative note), plus EVERY non-test comment carrying the present-tense disrupted phrasing — measured at roughly 24 modules, not the four originally named here. **COMMENTS AND ONE NOTE. No behaviour change.**
CARRIES: NONE, having checked `item-87-INDEX.md`.

Read `AGENTS.md` first.

## ⚠️ DO NOT DELETE THE CLASSIFIER OR ANY CONSUMER

**A guard against a provider value that could appear is legitimate.** `AGENTS.md` requires a module with no live consumer to say why rather than be removed, and that is exactly what this item asks for.

**The guards are not the defect. The comments are** — because they are written as descriptions of live behaviour and a reader takes them as fact.

## What has been measured, twice, on two different populations

**2026-09-08** (the original filing) and **2026-09-11** (re-measured through `DATABASE_URL_RO` while scoping #727):

| population | measured |
| --- | --- |
| schedule cache, 7 partitions | **22,760 games, `status` = `scheduled` on every one.** No cached row carries a `rawStatus` KEY. |
| score cache, 15 partitions | **20,424 status values, exactly two distinct: `final` (19,524) and `scheduled` (900).** |

**Not one disrupted label, on either field, ever.** The provider leaves a disrupted game `scheduled` — which is how six cancelled Alderson-Broaddus games reached the cache at `0-0`, and how the Week 1 power-outage game presented.

**The 2026-09-08 count was 22,761 and today's is 22,760.** One row, three days apart. Not material, and recorded so the two numbers do not silently disagree.

## The cost is not hypothetical, and it has now happened twice

**`gameUi.ts:61-62` says** *"Disrupted labels (postponed/canceled/suspended/delayed) present as 'scheduled', matching the classifier's buckets."*

- The filer of this issue: *"I reasoned from this sentence today and concluded a suspended game was the likely path into Item 169. It was not."*
- **2026-09-11: the #727 implementation built disruption handling into Schedule's scoreboard derivation**, including reading `rawStatus` — a populated field that can only ever hold `scheduled` — and a planning prompt was drafted making two unreachable disruption cases into required tests. **Caught by the owner, not by any gate.**

**A comment written as description gets read as fact. That is the whole item.**

## The count has moved — re-derive it

**CORRECTED 2026-09-11 — my "3" was wrong by an order of magnitude and the queue's original was closer.** The 3 counted `DISRUPTED_RE` only, which never leaves `gameStatus.ts`. Measured: **10 modules import `isDisruptedStatusLabel` across 13 call sites**, and 10 branch on the `'disrupted'` bucket. Two sibling predicates (`isCanceledStatusLabel`, `isCanceledOrPostponedStatusLabel`) carry more consumers and are **outside this slice**.

## STOP — post a READ RECEIPT before writing anything

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote all four comments verbatim, with current line numbers**, and say for each whether it asserts observed behaviour or describes a forward-looking guard. **Not every one may need changing.**
3. **Re-derive the consumer count.** Every reference to `DISRUPTED_RE`, `isDisruptedStatusLabel` and the `'disrupted'` classifier bucket, outside tests. Say the number.
4. **ANSWERED by this prompt's own receipt — `rawStatus` IS populated.** `schedule.ts:459/:522/:617/:695` set `rawStatus: item.status ?? null` at `AppGame` construction, with 11 read sites. **"Absent from every row" was true of the CACHED ROW and false of the DERIVED FIELD.** The note must say: **populated on every game, carrying `scheduled`, because that is the only value the provider has ever sent.**
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

STOP and report if any comment turns out to describe a behaviour the guard does NOT have — a wrong description of the code is a different defect from a wrong description of the provider.
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

`npm test` on clean `main` exits **0** — there is no known-failure baseline. Item 137 (#696)
removed the last two time-bomb failures on 2026-09-11, so **any** failure is a stop-and-report,
not a baseline to verify against.
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


## RULINGS 2026-09-11, from this prompt's read receipt

**(a) `rawStatus` wording — say it is POPULATED.** See above. The note must not claim the field is
unused; it must say the field carries `scheduled` on every game because that is the only value the
provider has ever sent. **That is a stronger and more useful statement than absence.**

**(b) `standingsHistory.ts` — your recommendation is accepted.** `:135` describes classification
POLICY (which labels are non-terminal) and `:182` explains why a disrupted game's cached kickoff is
discarded. **Neither claims the provider emits the labels.** A single deferral pointer at `:135`, no
change at `:182`.

**(c) POINTERS GO BEYOND THE FOUR — scope widened, and the rule requires it.** You found ~20 further
non-test modules carrying the same present-tense phrasing, and cited the binding rule at me:
**"correcting a claim means grepping for it, not fixing the copies you know about."** That rule points
directly at this, and four pointers leaving twenty copies standing is the failure it names.

**Conditions on the widening, because a 24-file diff must stay reviewable:**

- **One identical pointer sentence at every site.** Not twenty phrasings of the same deferral — that is
  how these drifted in the first place.
- **Change nothing else in those files.** Not a word of surrounding prose, not a line of code.
- **Report the final count**, and name any comment you judged already correct and left alone.
- **`selectors/trends.ts:101` is the one to read carefully** — *"retains postponed games, so ONE
  postponed week-1 game leaves that week…"* is a behavioural claim about a scenario that cannot occur,
  which is a stronger statement than the other nineteen.

**The test population stays untouched**, per the gate. **Do say in the report that the ~30 test files'
coverage is synthetic rather than production-derived** — `AGENTS.md` binds that a measurement's
coverage is part of its result, and "the guard is tested" without that qualifier is the same
overstatement this item exists to fix.
