# PLATFORM-813 v2 — validate the durable row, not the field

```text
PROMPT_ID: PLATFORM-813-ROW-VALIDATION-CLAUDE-v2
PURPOSE: A durable schedule row is cast to ScheduleWireItem with no runtime validation, and the
         readers then call string methods on its fields. v1 guarded ONE field and two review rounds
         found the next one four times. Validate the ROW at the boundary instead.
SCOPE:   src/lib/server/canonicalScheduleCache.ts (the boundary), src/lib/schedule.ts and
         src/lib/postseason-classify.ts (the reads that stop needing their own guards), the
         duplicated non-FBS vocabulary, and their tests. DO NOT re-do #833's deletions or #794 —
         both land on a separate branch. DO NOT change the aggregate-only contract, the canonical
         precedence helper, any member-facing surface, or AGENTS.md / DESIGN.md (planning owns both;
         report anything that needs amending).
CARRIES: NONE from the Item 87 campaign index, having checked — this is store-layer work and
         touches no scoreboard row, tag slot or row anatomy.

         Two standing obligations bind, and the second is why this prompt exists:

         "Audit seams BEFORE writing": enumerate a shared fact's WRITERS, its readers' MEANINGS,
         and the controls live in each state.

         "A clean measurement of the wrong population": name the population the CLAIM is about. A
         CORRECT measurement stated too broadly is the cheaper cousin of a wrong one — and on v1 it
         was the defect class itself, six findings in round 1 and six in round 2.
```

---

## Why there is a v2, stated plainly because the error was planning's ruling

**v1's receipt argued for a per-field guard over boundary validation, and I ruled for it.** The
argument was that readers converge on one consumer, so one guard covers ~17 call sites. **That was
right about `eventKey` and wrong about the class**, and the reviewers found the next field four
times across two rounds.

**The trace that settles it**, verified on `main` 2026-09-20:

```ts
// src/lib/postseason-classify.ts:215-217
function looksEmptyRow(row: ScheduleWireItem): boolean {
  return !row.homeTeam.trim() || !row.awayTeam.trim();
}

// :274-275
export function classifyScheduleRow(row: ScheduleWireItem, season: number): RowClassification {
  if (looksEmptyRow(row)) return { kind: 'invalid_row', reason: 'empty participant names' };
```

**`row.homeTeam.trim()` runs on the FIRST line of `classifyScheduleRow`, ahead of any `eventKey`
guard.** A durable row whose `homeTeam` is a JSON number still throws out of
`buildScheduleFromApi`'s per-row loop and still takes down the whole build. A guard a sibling read
jumps in front of is not a guard.

**One guard × 17 call sites × at least nine fields is not a saving.** The unit of work is the row.

## The boundary, and how wide it actually is

`loadCachedScheduleItems` (`src/lib/server/canonicalScheduleCache.ts`) is the single canonical
reader after PLATFORM-663. **It has 13 production consumers**, not one — enumerated on `main`:

| consumer | site |
| --- | --- |
| season build (standings, Insights, archives) | `seasonBuild.ts:98` |
| scores route | `app/api/scores/route.ts:345` |
| historical-scores repair | `app/api/admin/cache-historical-scores/route.ts:265` |
| polling planner cron | `app/api/cron/polling-planner/route.ts:121` |
| Insights loader | `insights/loadInsights.ts:283` |
| championship rollover | `schedule/nationalChampionshipRollover.ts:148` |
| game-stats canonical slate | `gameStats/canonicalSlate.ts:429` |
| team records client | `server/teamRecordsClient.ts:34` |
| provider diagnostics | `server/providerDataDiagnostics.ts:309`, `:564` |
| odds canonical context | `odds/canonicalOddsContext.ts:92` |
| odds refresh executor | `odds/oddsRefreshExecutor.ts:145` |
| live-score canonical context | `liveScores/canonicalContext.ts:160` |
| league standings selector | `selectors/leagueStandings.ts:1022` |

**Validating once here covers all thirteen.** That is the argument v1's receipt should have made and
did not.

Note `scheduleDisappearanceBaseline.ts:28-33` deliberately does NOT call it and says why — its
validity policy is stricter on purpose. **Do not "fix" that**; read the comment and leave it, or
report if the comment is now wrong.

## Why the type does not protect you

`ScheduleWireItem` (`schedule.ts:73`) declares `homeTeam: string`, `awayTeam: string`, `id: string`.
**TypeScript therefore believes every read is safe, and the durable row is what lies.**
`StoredScheduleEntry<T>` (`canonicalScheduleCache.ts:9-14`) is honest about the shape of the record
but says nothing about the shape of an ITEM.

**Optional chaining does not help and reads as though it does.** `postseason-classify.ts:351` has
`row.label?.trim()` — that survives `null` and `undefined` and **still throws on a number**, because
`(5).trim` is `undefined`, not callable. Any audit that treats `?.` as a guard will undercount.

**SIXTEEN unguarded string reads in `postseason-classify.ts` alone** — corrected 2026-09-21 by the
v2 receipt. A regex sweep sees only six (`:216` ×2, `:343`, `:344`, `:351`, `:362`, `:363`); the
checker finds ten more, including `:43` `(row.eventKey ?? '').trim()`, `:52`
`row.label?.trim() || row.bowlName?.trim()`, and `:226`/`:241`/`:368`
`(row.seasonType ?? '').toLowerCase()`. **Every one of those hides behind a form that reads as a
guard and is not one.**

The read v1 fixed is at `schedule.ts:413` — the `eventKey` trim with its week-and-id template fallback.
**This prompt cited `:498`, inherited from v1 without re-deriving it — an off-by-85, and the CARRIES
block at the top of this very file says to re-derive every line-number citation.** Quoting a rule is
not complying with it; that is now twice on this campaign.

## The second half: one provider vocabulary, two definitions

`NON_FBS_PROVIDER_CLASSIFICATIONS` (`schedule.ts:354`, used `:421`) duplicates the unexported
`NON_FBS_CLASSIFICATIONS` (`schedule/cfbdSchedule.ts:305`, used `:322-323`). Two copies of one
provider vocabulary drift silently, and the guard that misses a new division fails open.

**The v1 sweep for this rooted at `src/lib` rather than `src`** — a Codex P2. That is the same class
as everything else here: **a sweep's ROOT is part of its claim**, and a clean result from a narrow
root reads identically to a clean result from the right one. State the root with the result.

## Acceptance

1. **A durable row with a non-string value in ANY OF THE TEN MEASURED FIELDS cannot take down the
   build**, pinned **per field** by a test that fails against today's code. Per field, not per class
   — the class is what v1 asserted and did not cover.

   **AMENDED 2026-09-21 by the v2 receipt, and the amendment is the same defect this slice fixes.**
   This bullet first named six fields — `homeTeam`, `awayTeam`, `id`, `label`, `bowlName`,
   `eventKey` — taken from a regex sweep of `postseason-classify.ts` that returned six sites. The
   lane resolved receiver types with the TypeScript checker instead and found **16 sites in that
   file alone**. The ten the acceptance now covers:

   | field | note |
   | --- | --- |
   | `homeTeam`, `awayTeam` | 4 sites each |
   | `id` | 4 sites, across three files |
   | `eventKey` | 3 sites |
   | `seasonType` | 3 sites, all `(row.seasonType ?? '').toLowerCase()` |
   | `label` | 2 sites |
   | `startDate` | 2 sites |
   | `bowlName` | 1 site |
   | `conferenceChampionshipConference` | 1 site |
   | `status` | **transitive only** — `mapStatus` (`schedule.ts:289`) does `(rawStatus \|\| '').toLowerCase()`, called at `:542` and `:778` inside the per-row loop |

   **Why the first list was short, because it is the lesson and not an apology:** a regex keyed on
   `row.field.method` cannot see `(row.eventKey ?? '').trim()` or `row.label?.trim()`, and **`?? ''`
   catches `null` and `undefined` while still throwing on a number** — so the guarded-looking forms
   are exactly the unguarded ones. Verified on `main`: `:43`, `:52`, `:226`, `:241`, `:368` are all
   real method calls the sweep missed. **A field list assembled by grep is a measurement of the
   grep.**
2. **The validation happens once, at the boundary**, and the per-field guards it makes redundant are
   REMOVED rather than left beside it. Two answers to "is this row safe" is the shape this slice
   exists to delete.
3. **Every one of the 13 consumers gets the behaviour** without its own change, proven by a test
   that fails if a consumer starts reading around the boundary.
4. **What happens to an invalid row is a decision you state and pin** — dropped with a recorded
   count, or coerced, or the read fails. #693's lesson binds: if the reader cannot say whether the
   season is complete after dropping rows, it reports that rather than assuming.
5. **One provider vocabulary, one definition**, with a test that fails if a second copy reappears —
   and the sweep's ROOT stated beside its result.
6. **The aggregate-only contract is untouched.** No week-partition machinery returns.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which
assertion fired.**

**The defect is unreachable in production, so the tests are the only evidence** — construct each
malformed row deliberately and show each test failing against today's code before the fix.

**And the specific false green that beat v1 twice:** a fixture built from a row the OLD code already
handled proves nothing, and a sweep that cannot see the form you are looking for returns the same
clean zero as a sweep that looked. **For every sweep, audit or coverage claim in the closeout, state
the population it ran over and how you know that population is the right one.**

**Pair every mechanism comment with the test that asserts the same behaviour.**

**A diff that falsifies a comment owns it — and that extends across `src/` ↔ `docs/`.** Sweep the
SYMBOL repo-wide, not the file you are in. Planning has now missed a sibling three times on this
campaign doing exactly that (`91aa30a3`, `f1b08adb`, fixed in `eca8836e`); report anything in
`docs/` or `AGENTS.md` your diff falsifies rather than editing it.

---

## STOP — read receipt before writing any code

1. **Enumerate every field of `ScheduleWireItem` a reader calls a method on**, across all 13
   consumers and their transitive helpers — not just the two files named above. This is the
   population v1 never established, and the count is the whole argument for boundary validation.
2. **What does an invalid row become?** Your recommendation for acceptance 4, with what each
   consumer would then see. A dropped row changes standings; say so.
3. **Where exactly does the validation go** — inside `loadCachedScheduleItems`, or in a validator it
   calls? Say what the process cache holds afterwards: validated rows, or raw ones re-validated per
   read.
4. **What does validation COST** on the real 2026 row count (3,679 items, measured 2026-09-20) —
   this read is on the standings path and `loadCachedScheduleItems` is called on most requests.
5. **Which existing per-field guards become dead** once the boundary validates, and are any of them
   load-bearing for a reason unrelated to type safety?
6. **Does `scheduleDisappearanceBaseline`'s stricter policy still hold** after this, and is its
   comment still true?
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
