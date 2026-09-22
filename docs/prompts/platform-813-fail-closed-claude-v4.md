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
         /api/schedule handler for the new error, and their tests. AMENDED 2026-09-22 by the
         receipt ruling: ALSO the startDate normalization in src/lib/schedule/cfbdSchedule.ts (one
         field), the loadInsights rethrow and the analytics-provenance cause mapping (the two
         catch-all exceptions below), and the fixture completions the strict contract forces.
         DO NOT build a path that returns surviving rows. Its first real consumer builds it, with its
         own review. DO NOT change behaviour for a well-typed row in any way. DO NOT fix consumers'
         pre-existing catch-alls (see receipt item 4), EXCEPT the two ruled below. DO NOT touch
         AGENTS.md / DESIGN.md (planning owns both; report what your diff falsifies). The duplicated
         non-FBS vocabulary is OUT of v4 and filed separately.
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

## RECEIPT RULINGS, 2026-09-22

**1. `startDate` is fixed IN v4, because without it v4 is unsafe.** Receipt item 2 found exactly what
it was written to find. `cfbdSchedule.ts:732` stores `game.start_date ?? game.startDate ?? null`
**raw**, while every other string field goes through `normalizeString` (`:192`). A non-string
`start_date` from CFBD would be committed, and v4 would then take that season down on the next read.
Normalize it to `string | null`, **with a string passed through UNCHANGED**: no trimming, and no
turning `''` into `null`. Only a non-string becomes `null`. Its siblings' `normalizeString` returns
`''` for a non-string, but this field is `string | null`, so it needs `null` instead. And anything that
altered a string date would change a well-typed row, which acceptance 2 forbids. Reading the
acceptance list back as a set is what caught this interaction between ruling 1 and acceptance 2.

**This is not the coercion v4 forbids, and the distinction matters.** The WRITER is the
provider-ingest boundary. Normalizing provider input is already its job for every other field, and
happens once, at the source. The READER validates DURABLE data and must never reinterpret it.
"No coercion" is a rule about the reader.

**And pin it structurally, not by field.** Acceptance 8: adversarial provider input into
`mapCfbdScheduleGame` always produces a row the SHIPPED validator accepts. Item 2 found `startDate` by
reading every field. The next writer gap is found by this test instead of by someone re-reading the
mapper. **Planning's claim in this prompt that "the writer cannot violate the contract" held for the
closed unions and was false for `startDate`.** It was a claim about the fields planning had checked,
stated as a claim about the writer.

**2. The 35 broken tests: accept them as fixture completions, through ONE conforming-row builder.**
Their fixtures seed rows the declared type says cannot exist. A shared builder, taking a well-typed
default plus overrides, makes each fix one line and makes future fixtures conform by default.
**Classify each one first**, per `AGENTS.md`'s intent-versus-mechanism rule. A fixture that was
merely incomplete gets completed. A test that ASSERTED tolerance of a malformed row has had its
intent superseded by fail-closed, so retarget it to expect the typed throw rather than completing
its fixture into irrelevance. Report the final count and the sizing.

**3. `VenueInfo` is checked field by field; `media` is an ordinary optional field.** The contract is
the declared type **all the way down**. Special cases are how a hand-picked list gets back in. So
`venue`'s inner fields are checked against `VenueInfo`. **They are UNMEASURED**: planning's
22,760-row probe checked only that `venue` was an object, string or `null`. Acceptance 7's merge gate
therefore measures them before merge. `media` is declared `ScheduleMediaItem[]` and optional, so it
is either absent or well-typed, with **no extra "must be absent" rule**. Planning's probe found it
absent or an array in all 22,760 rows.

**4. The non-FBS vocabulary half of #813 is split out.** It is a different concern, and v3's
implementation of it was review-clean and mutation-proven, so it ships as a small follow-on on its
own. This slice has failed by widening four times. Keep v4 to fail-closed.

**5. Provenance keeps the cause mapping.** Do NOT delete `'schedule-cache-unreadable'`. Analytics
provenance is the one consumer whose job IS reporting the cause, and v4's whole purpose is a legible
failure. Reporting `build-failed` for an unreadable schedule would make the one diagnostic built for
legibility name the wrong cause.

**6. `loadInsights` keeps v3's rethrow. The stop condition was right to fire.** This prompt's
CARRIES block says v4 satisfies invariant 8 *"by construction: a consumer never holds partial data,
so it cannot cache it."* `loadInsights` makes that claim false. It catches the throw into `[]`
(`:283`), builds insights from no games, and caches that for 300s. The data isn't partial, it's
EMPTY, built from a caught failure, and that is the same uncertainty. `main` does the same, so this
is not a regression. But v4 claims invariant 8, and this is the counterexample. **Rethrow ONLY the
typed non-conformance error**, so every other read failure keeps `main`'s behaviour. `unstable_cache`
never stores a rejection, so the next request retries. It only fires for a malformed row, which a
well-typed season never produces, so "no change for a well-typed row" still holds. **File** the
remaining shape, where any OTHER read failure caches an empty-schedule build for 300s. It predates #813
and is out of scope.

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
   result. A non-zero result means fail-closed would take that season down on promotion. **It now
   covers `VenueInfo`'s inner fields**, which planning's probe did not measure.
8. **Every row the writer can produce passes the reader's validator.** Feed `mapCfbdScheduleGame`
   adversarial provider input, with every field wrong-typed including `start_date`, and assert
   that the SHIPPED validator accepts every row it returns. **This must fail on `main`**, where a
   non-string `start_date` is stored raw. One validator, used on both sides.
9. **`loadInsights` rethrows the typed error and caches nothing**; every other read failure keeps
   `main`'s behaviour. **Provenance reports `'schedule-cache-unreadable'`, not `build-failed`.**

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
