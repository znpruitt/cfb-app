# PLATFORM-813 v3 — use the channel that already exists

```text
PROMPT_ID: PLATFORM-813-ROW-VALIDATION-CLAUDE-v3
PURPOSE: v2's boundary coercion is right and stays. Its REPORTING is wrong: it invented a parallel
         count for a fact `buildScheduleFromApi` already records with reasons, and routed corruption
         into a silent discard in the durable path. Delete the parallel channel, read the existing
         one, and cover the consumer that bypasses the boundary entirely.
SCOPE:   src/lib/server/canonicalScheduleCache.ts, src/lib/seasonBuild.ts,
         src/app/league/[slug]/draft/board/boardData.ts (the bypass), the durable writers the
         receipt identifies, and their tests. DO NOT re-litigate WHERE validation happens — the
         boundary is settled and uncontested by both reviewers across two rounds. DO NOT change the
         aggregate-only contract, AGENTS.md or DESIGN.md (planning owns both; report what your diff
         falsifies).
CARRIES: NONE from the Item 87 campaign index, having checked — store-layer work, no row anatomy.

         Three standing obligations bind, and the first is why v3 exists:

         "Audit seams BEFORE writing": enumerate a shared fact's WRITERS, its readers' MEANINGS, and
         the controls live in each state. **Planning ruled a parallel count into existence without
         checking whether the codebase already recorded the same fact. It did.**

         AGENTS.md invariant 8: "cache valid absence, never cache uncertainty."

         "When your change kills a test, separate its intent from its mechanism" (added 2026-09-21,
         from this slice's own v2).
```

---

## What v2 got right, and keeps

**Coercion at the boundary is settled.** Non-string → `''`, wired into every construction path of
`loadCanonicalScheduleEntry`. Both reviewers across two rounds contested the *reporting*, never the
*location*. Keep it. `565f7fba` stays on the branch; v3 is a deletion on top of it.

Also keep: `null`/`undefined` left uncoerced so absence stays distinguishable from empty, the
all-dropped throw, and the per-field tests.

## The defect v3 exists to remove

**Coercion routes corruption into a silent discard, in the durable path.** A coerced participant
field leaves the row in `items`; `classifyScheduleRow` discards it as `invalid_row`;
`assembleSeasonScoredBuild` destructures only `{ games }` (`seasonBuild.ts:124`) and never sees the
loss. Both reviewers found this independently. **On `main` that row threw and the archive cron failed
loudly** — so v2 converted a loud failure into silent data loss, which is strictly worse than the
status quo for the surface that matters most.

It violates **invariant 8**, and `leagueStandings`' cache is tag-only (`revalidate: false`), so a
snapshot built from an incomplete schedule **persists indefinitely**.

## The channel already exists — this is the whole slice

Verified on `main` 2026-09-21:

| fact | site |
| --- | --- |
| `issues: string[]` on the return type | `schedule.ts:227` |
| `issues.push(\`invalid-schedule-row: ${classified.reason}\`)` | `schedule.ts:648` |
| `issues` returned | `schedule.ts:896` |
| the consumer that throws it away | `seasonBuild.ts:124`, `const { games } = buildScheduleFromApi({...})` |

**`droppedRowCount` and `coercedFieldCount` are a second, weaker record of a fact the codebase
already computes with reasons attached.** Two sources of truth about one thing is the pattern this
repo keeps paying for. **Delete them.** If a durable writer needs to know rows were discarded, it
reads `issues`, which tells it *why* as well as *how many*.

Planning ruled those counts into existence on 2026-09-21 without auditing for an existing channel.
That ruling is withdrawn.

## The 14th consumer — the premise was wrong

v2's prompt said *"validating once here covers all thirteen."* It does not.
**`boardData.ts:23` reads `getAppState<{ items: unknown[] }>('schedule', \`${year}-all-all\`)`
directly** and feeds the raw items into `buildScheduleFromApi` at `:26`, bypassing
`loadCachedScheduleItems` entirely. It is the spectator **draft board** — member-facing, and a
corrupted row renders a wrong board during a live draft.

**Owner decision 2026-09-21: it moves onto the canonical reader.** One read changes; the boundary
then covers 14 of 14. This touches a draft surface, so state in the receipt what else that file's
behaviour depends on before changing it — `:7-14`'s comment explains why it reads the way it does
and whether that reason survives is receipt item 4.

`scheduleDisappearanceBaseline.ts:53-54` stays out, as in v2 — it bypasses deliberately and says why.

## Acceptance

1. **A durable writer never records a season as complete when rows were discarded.** It reads
   `issues` from the build it actually performed. Pinned by a test that fails against `ff79e1a6`.
2. **`droppedRowCount` and `coercedFieldCount` no longer exist**, and nothing reintroduces a second
   record of row loss. A test or structural assertion pins their absence.
3. **A non-array `items` is unreadable, not empty.** `0/0` reporting is what recreated the collapse
   in round 2; the value must be distinguishable from a season with no rows.
4. **The draft board reads through the canonical reader**, and a corrupted row cannot render a wrong
   board. Pinned.
5. **All ten fields keep their per-field tests** from v2, still mutation-proven.
6. **The all-dropped throw survives**, with `/api/schedule` handling it — round 2 found no handler.
7. **Every consumer claim in the closeout is an enumeration, not a substring sweep.** Round 2's
   acceptance-3 sweep passed `providerDataDiagnostics` while it read aggregate rows directly.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which
assertion fired.**

**The false greens that beat v2, named so they cannot repeat:**

- **A sweep shaped to pass.** State what each sweep ENUMERATES, not what string it matched. A
  substring sweep over consumer names is a measurement of the names.
- **A count that reaches no consumer.** If nothing reads a value, a test asserting its value proves
  nothing about behaviour.
- **A fix that recreates the thing it fixed** — `Array.isArray` reporting `0/0` did exactly that.
  After each fix, ask what the new path reports in the case the fix was for.
- **A recount done by eye.** v2's field count was wrong twice, once after being corrected. Derive
  counts from the committed artifact, in a script, and print them.

**Pair every mechanism comment with the test that asserts the same behaviour**, and re-derive every
line-number citation against `main` before the closeout — v2's report cited branch-relative lines
for files whose branch state is being deleted.

---

## STOP — read receipt before writing any code

1. **Which consumers write DURABLE records** from a schedule build — archives, receipts, standings
   snapshots — and what does each do today when rows were discarded? This is the list acceptance 1
   binds; enumerate it, do not sweep for it.
2. **What does each durable writer DO with `issues`** — refuse to write, write with the loss
   recorded, or something else? Recommend per writer; a blanket answer is the thing that produced
   v2's silent discard.
3. **What survives deletion?** Name every symbol, test and doc block that exists only to serve
   `droppedRowCount`/`coercedFieldCount`, so the deletion is complete rather than partial.
4. **`boardData.ts`** — read `:7-14`'s comment and say whether its stated reason for the direct read
   survives the move, what else changes for the draft board, and what test proves the board is
   unaffected in the healthy case.
5. **What does `/api/schedule` do with the all-dropped throw**, and what status does a caller see?
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
