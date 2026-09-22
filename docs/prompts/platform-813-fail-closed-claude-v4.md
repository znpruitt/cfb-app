# PLATFORM-813 v4 — fail closed, and name the row

```text
PROMPT_ID: PLATFORM-813-FAIL-CLOSED-CLAUDE-v4
PURPOSE: A durable schedule row that does not conform to its declared type makes the build throw an
         unattributable TypeError. The fix is a TYPED error that names the row and the field, thrown
         at the canonical reader, so no consumer ever receives partial data. v2 and v3 served the
         surviving rows instead, and six review rounds each found another consumer that assumed
         completeness. v4 removes that approach rather than extending it.
SCOPE:   the durable-row validator, src/lib/server/canonicalScheduleCache.ts (both construction paths
         of loadCanonicalScheduleEntry), src/app/league/[slug]/draft/board/boardData.ts and
         src/app/league/[slug]/draft/page.tsx (moved onto the reader, as ruled in v3), the
         /api/schedule handler for the new error, and their tests.
         DO NOT build a path that returns surviving rows. Its first real consumer builds it, with its
         own review. DO NOT change behaviour for a well-typed row in any way. DO NOT fix consumers'
         pre-existing catch-alls (see receipt item 4). DO NOT touch AGENTS.md / DESIGN.md (planning owns
         both; report what your diff falsifies).
CARRIES: NONE from the Item 87 campaign index, having checked. This is store-layer work.

         AGENTS.md invariant 8: "cache valid absence, never cache uncertainty." v4 satisfies it by
         construction: a consumer never holds partial data, so it cannot cache it, archive it or
         destroy prior-good data on the strength of it.

         AGENTS.md: "WHEN YOUR CHANGE KILLS A TEST, SEPARATE ITS INTENT FROM ITS MECHANISM." v2 and v3
         wrote per-field coercion tests and per-writer refusal tests. Their INTENT (a malformed row
         must not crash the build silently, and must not produce a wrong durable record) survives.
         Their MECHANISM (coercion, refusal predicates) does not. Retarget the tests; don't delete
         their reason.
```

---

## The owner's ruling, and why it reverses planning's earlier one

**Owner decision 2026-09-22: fail closed by default.** v3 round 2 found three defects in one class:
playoff fields and conference fields whose coercion silently changed a game's meaning, and an odds
refresh that could erase prior-good odds on the strength of the surviving rows. **Every hole across v2
and v3 has the same mechanism: partial data reaches a consumer that assumes it is complete.** Each fix
found the next such consumer, because the fixes were built from lists, of fields and then of writers,
and each list was drawn from the population somebody had already looked at.

**Planning ruled in v3 that "partial drops must NOT throw," because throwing restores the defect #813
was filed about.** Six rounds of evidence say that ruling was wrong. `main` already fails closed: one
bad row throws, and nothing gets published, cached, archived or erased on incomplete data. **The real
defect was that the failure is an unattributable `TypeError` thrown deep in the build, not that it
fails at all.** v4 keeps the failure and makes it legible.

**What this gives up, stated plainly:** availability during a corruption, on every consumer of that
season. The corruption has never occurred in production (below), and the draft pages already render
empty when their load fails.

## The contract

**A row conforms when it matches `ScheduleWireItem`'s declared type** (`schedule.ts:73`):

- every **required** field is present with its declared type: `id`, `week`, `startDate`,
  `neutralSite`, `conferenceGame`, `homeTeam`, `awayTeam`, `homeConference`, `awayConference`,
  `status`;
- every **optional** field is either absent or of its declared type;
- **closed unions are checked against their set.** `homeClassification`/`awayClassification` are
  `ProviderClassification` (`'fbs' | 'fcs' | 'ii' | 'iii'`, `conferenceSubdivision.ts:89`), and
  `playoffRoundSource` has three literals and no `| string`.

**A non-conforming row, or a non-object row, throws a typed error** naming the durable key, the row's
position and `id` where it has one, the field, and the observed type. **No coercion of any kind.**
Coercion is what turned "malformed" into "silently different" in v2 and v3.

**This is deliberately stricter than `main`.** `main` only crashes on a field some code happens to call
a method on. v4's contract is the declared type, not the set of fields that currently crash. That is
what lets the error name a field, and what stops the next field from escaping a list.

## Measured before ruling: the contract holds for every stored row today

Fail-closed is only safe if real data already conforms; otherwise it is an outage on deploy. **Planning
measured it on the read-only rail on 2026-09-22:**

| season key | rows | non-conforming |
| --- | --- | --- |
| `2018-all-all` | 1,556 | 0 |
| `2021-all-all` | 2,454 | 0 |
| `2022-all-all` | 3,705 | 0 |
| `2023-all-all` | 3,734 | 0 |
| `2024-all-all` | 3,801 | 0 |
| `2025-all-all` | 3,831 | 0 |
| `2026-all-all` | 3,679 | 0 |
| **total** | **22,760** | **0** |

Every required field, every present optional field, and both closed unions were checked. **Positive
control: 7 of 7 synthetic bad rows flagged** (a `null` row, a numeric `homeTeam`, a `null`
`homeConference`, a missing `status`, `homeClassification: 'FBS'`, an unknown `playoffRoundSource`, a
string `startTimeTBD`), **and a clean row passed.** So a zero here means the checker looked and found
nothing, not that it failed to look.

**That measurement used a hand-written copy of the contract, which is a second definition.** The
merge gate below re-runs it with the shipped validator.

**The writer cannot violate the closed union.** `cfbdSchedule.ts:720`/`:723` pass provider
classification through `normalizeProviderClassification` (`conferenceSubdivision.ts:99`), which maps
an unknown value to `undefined`, and an absent optional field conforms. So a new CFBD division is
stored as absent, not stored as a value the reader then rejects. Receipt item 2 asks for the same
guarantee from every writer.

## What survives from v2/v3, and what is deleted

**Reuse** the durable-row validator module and the per-field test matrix, retargeted from "coercion
prevents the crash" to "the typed error names this field." **Reuse** the v3 rulings that still apply:
the draft board and draft page move onto the canonical reader, and `/api/schedule` answers the new
error with a shaped 503, matching `route.ts:360`.

**Delete** everything that exists to serve partial data: coercion, `LOSSY_COERCIONS` and any field
allowlist, the boundary reports routed into `issues`, the per-writer refusal predicates, and the
counts. Receipt item 3 asks you to name them, so the deletion is complete rather than partial.

**Work on a fresh branch off current `main`.** `claude/813-row-validation-v2` carries two rounds of
the plumbing v4 deletes. Carry the validator and the tests forward, not the history. Keep the old
branch unmerged until v4 lands.

## Acceptance

1. **Every non-conforming or non-object row throws the typed error at the canonical reader**, from
   both construction paths of `loadCanonicalScheduleEntry`, naming key, row, field and observed type.
   Tested over the whole contract: every required field made non-conforming, every optional field
   given a wrong-typed value, each closed union given an out-of-set string, and a non-object row, in
   each row kind (regular, conference championship, postseason).
2. **A well-typed row produces exactly `main`'s output.** A test builds the same well-typed season
   through the new reader and through `main`'s path and asserts identical games. This is what makes
   "nothing else changes" a checked claim rather than a promise.
3. **No path returns surviving rows.** Nothing in the shipped code serves the rows that remain after
   a malformed one.
4. **The odds regression from v3 cannot occur.** A season with a malformed row plus prior-good odds,
   followed by an empty provider response, must leave the prior odds in place. **This test must fail
   at `8578ad38`**, where the surviving rows let `commitEmptyOddsRefresh` erase them.
   **It should hold without any change to the odds code, and that is the point.**
   `gatherEmptyOddsScheduleEvidence` catches a failed read into `scheduleItems = null`
   (`oddsRefreshExecutor.ts:146-147`), and the classifier's own contract says *"`scheduleItems === null`
   means the schedule read FAILED (unavailability is never evidence)"* (`emptyOddsClassifier.ts:201-202`).
   Its fallback then proves nothing obsolete (`:254-256`). **The odds path was already built to be safe on
   a failed read. v3 broke it by making a failed read look like a successful partial one, and v4's throw
   sends it back into that branch.** Planning read this from the code; the test is what proves it. If
   the test needs an odds-code change to pass, stop and report rather than making one.
5. **The draft board and draft page read through the canonical reader.**
6. **`/api/schedule` answers the typed error with a shaped 503.**
7. **Merge gate: the shipped validator, run over every stored schedule row on the read-only rail,
   reports zero non-conforming rows, with a positive control showing it can flag a bad row.** Run it
   immediately before merging, record the counts in the closeout, and do not merge on a non-zero
   result. A non-zero result means fail-closed would take that season down on promotion.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.**

**Acceptance 2 is the one most likely to pass vacuously.** Build the season through both paths from
the SAME fixture, and prove the comparison can fail: mutate one well-typed field in one path only and
show the assertion reddens.

**Acceptance 7's zero needs its control in the same run.** A validator that silently fails to load or
connect also reports zero non-conforming rows.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## STOP — read receipt before writing any code

1. **Enumerate every consumer of the canonical reader and every direct reader of the durable
   schedule key**, by a method stronger than a single-line grep, and say what each one does when the
   reader throws. Planning will not supply a count: it has published a wrong one twice in this family.
2. **Enumerate every path that WRITES the durable schedule**, and say whether each can store a row the
   validator would reject. Classification is covered by `cfbdSchedule.ts:720`/`:723`. Check
   `playoffRoundSource` and every other closed or typed field the same way. **A writer that can store
   a non-conforming row turns fail-closed into a season-wide outage on the next upstream change**, so
   this answer decides whether v4 is safe.
3. **Name everything v2/v3 added that v4 deletes**, symbol by symbol, including tests whose intent
   survives and must be retargeted rather than dropped.
4. **Which consumers catch the error and turn it into an empty result?** `loadInsights`
   (`.catch(() => [])`) and both draft pages are known. **Say for each whether the empty result is
   ever written durably or cached.** Those catch-alls predate #813 and swallowed `main`'s `TypeError`
   the same way, so v4 does not change them. **But if one of them turns the throw into a durable or
   cached record, stop and report**: that is invariant 8 again, reached through a catch rather than
   through partial data.
5. **What does `/api/schedule` return today for this case**, and what status and body does a caller
   see after the change?
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
