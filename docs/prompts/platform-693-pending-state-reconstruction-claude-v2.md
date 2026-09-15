# PLATFORM-693 v2 — pending-state module reconstruction

```text
PROMPT_ID: PLATFORM-693-PENDING-STATE-RECONSTRUCTION-CLAUDE-v2
PURPOSE: Rebuild the standings-invalidation pending-state module from specification, discarding
         the v1 module and its tests. Everything else on the branch is reviewed and STAYS.
SCOPE:   REBUILD src/lib/server/standingsInvalidationPending.ts and its tests, plus the cron
         drain test. KEEP every other file on claude/693-standings-invalidation. One new touch
         is authorised: schedulerExecutionIssues, for requirement R1 below.
CARRIES: PLATFORM-086A truthful status — a post-commit failure must never relabel a COMMITTED
         write as failed, and must never turn a completed state change into a 500.
         cronExecutionLog policy — "a count only: never a slug" on every value serialized into
         the execution event or its durable receipt.
         AGENTS.md:468 — widening to a second surface without route-level coverage is a scope
         violation in itself; deleting new behaviour must redden the suite.
         Owner scope approvals: e378c090 (file count) and 4abd0528 (line count). Both signals
         are crossed; a v2 that lands smaller than v1 does not need a third.
```

---

## Why this is a reconstruction and not a third remediation round

`AGENTS.md` → *Review and remediation limits*: **"When a branch has taken two remediation rounds and
still yields credible findings... abandon the branch and rebuild the settled behavior from clean
`main` rather than patching further."** The branch is at `4efd3c19` → `f62b4200` → `bbc38a51`, both
reviewers still return credible P1/P2 findings, and **each round's fix has produced the next round's
finding** — the generation guard added in round 2 is inert, and the test written to prove it passed
by exercising a neighbouring generator.

**Owner decision 2026-09-15: rebuild the MODULE, not the branch.** The rule's literal text says
abandon the branch; its stated rationale is that *"the stopped history carries the defects that
stopped it."* Those defects are not distributed. **Both reviewers independently confirmed the trigger
placements, the reporting seam, the receipt plumbing and the authority changes in round 2** — codex's
round-2 findings were all already in the approved plan. What has not converged is one new module's
bookkeeping: revision semantics, clear semantics, counting, and its comments.

**Round-count discipline is planning's failure here, and it is stated so you can hold me to it.**
Round 2 required explicit owner approval under step 6 and never got it. I ruled confidently on
individual findings across three rounds without once counting them. **This reconstruction gets ONE
cohesive remediation round after its reviews, and step 7 after that: report, recommend, stop.**

---

## What you KEEP — do not rebuild, do not "improve"

Every file below is reviewed by both reviewers and settled. Touch one only if a requirement here
forces it, and say so if it does.

| file | what it holds |
| --- | --- |
| `src/lib/selectors/leagueStandings.ts` | the shared reporting seam; the three-value outcome; the `E263` predicate |
| `src/lib/schedule/fullSeasonScheduleRefresh.ts` | **trigger B** and the third defect site |
| `src/app/api/cron/schedule-refresh/route.ts` | **trigger A** at `:222`, ahead of every exit |
| `src/app/api/schedule/route.ts` | the two route-local blocks |
| `src/lib/schedule/cronExecutionLog.ts`, `fullSeasonScheduleRefreshResult.ts` | the result contract and event plumbing |
| `src/lib/server/schedulerExecutionStatus.ts` | `standingsInvalidationFailures`, the receipt shape |
| `src/lib/server/admin/systemHealth/systemHealthPresentation.ts` | the rendered sweep detail |

**The two triggers are settled and their rationale must survive the rebuild verbatim: there are two
REACHABILITY gaps, not two placements of one idea.** A cron drain cannot cover the manual repair
path; an authority discharge cannot cover a zero-target run, because the authority is never called
when there are no targets.

## What you REBUILD, from this specification rather than from the v1 file

- `src/lib/server/standingsInvalidationPending.ts` (v1: 335 lines)
- `src/lib/server/__tests__/standingsInvalidationPending.test.ts` (v1: 246 lines)
- `src/app/api/cron/schedule-refresh/__tests__/pendingDrain.test.ts` (v1: 163 lines)

**Re-derive. Do not cherry-pick the v1 file.** Read it once to understand the contract, then write
from these requirements. The v1 shape is what produced three rounds of findings, and an edit of it
inherits the shape.

---

## SPECIFICATION — every accepted finding, restated as a requirement

### Round 3 — the findings that stopped the branch

**R1. A positive pending count must make a HEALTHY-looking system report unhealthy.**
`schedulerExecutionIssues` emits warnings only for `receipt.result` of `failure` or `partial`. A run
whose own years succeeded while old obligations remain pending leaves the result unchanged, so the
still-pending line appears only inside a collapsed Target panel while Scheduler and Overall stay
green. **Derive an independent issue from a positive pending count.**

> **This requirement reverses a ruling I gave, and the reversal is the transferable part.** We
> declined a health issue code on the correct grounds that three earlier findings all came from
> adding a field ahead of a consumer, and I set the condition *"name the rendering at a specific
> line."* The lane satisfied it exactly and the result was still invisible. **A consumer that cannot
> RAISE the condition is not a consumer.** The condition should have been: *name the surface that
> will show a healthy system as unhealthy when this value is non-zero.* Use that test here.

**R2. The generation guard must actually discriminate a concurrent re-record.** In v1,
`recordPendingStandingsInvalidation` reproduces an existing record byte-for-byte, so neither `since`
nor `attempts` can distinguish generations — **the exact race `observed` exists for is undetectable**.
Carry a revision that advances on **every** obligation recorded, and compare it at **all three** clear
sites.

**R3. Both post-walk clears must pass `observed`.** In v1, `bustStandingsForYear` and
`reportStandingsInvalidation` pass none, against a docblock stating that is correct only where no
walk preceded.

**R4. `cleared` must count the RESULT, not the attempt.** The clear swallows store errors and
declines on mismatch, while the drain increments unconditionally — so **four failed clears report
`stillPending: 0`.** A swallowed failure producing a false all-clear is this issue's own defect, for
the fourth time. Have the clear return a confirmed boolean and count that.

**R5. `stillPending` must be derived from the full durable set after the drain, not from the drained
slice.** Capped at the drain bound, ten pending years drain four and report zero.

**R6. The "do not write when nothing is pending" guard must sit OUTSIDE the transaction.** In v1 it
is inside, so the client checkout and advisory lock it exists to avoid happen anyway (lock ~`:1281`,
`fn(txn)` at `:1297`). Read with `getAppState` before opening one.

**R7. A cleared record is DELETED, not tombstoned.** `listAppStateKeys` returns tombstones forever.

**R8. The discharge's return value must be recorded**, or its docblock must stop saying a caller can
record it.

**R9. Two comments must state what is true.** The v1 comment claims trigger B "repairs during a
provider outage" — it sits after the fetch, so it does not.

### Rounds 1–2 — requirements that must survive the rebuild

**R10. The pending unit is a YEAR.** Never a league slug — the value is serialized into a
count-only surface. Replay re-walks every league for the year; over-invalidation is correct **here**
and wrong on the commit path, and the discriminator is evidence: the replay path names a year KNOWN
to have a failed bust, the commit path has no evidence any bust failed.

**R11. A separate `app_state` scope, never co-located with the schedule-refresh lease.**
`releaseScheduleRefreshLease` writes `{ lease: null }` — a whole-record replacement — so a field
beside it is erased by the release at the end of the very run that wrote it. **Self-erasing, not
untidy.**

**R12. Clear only on a walk that actually busted:** `complete` **and** `invalidated === attempted`.
An all-`E263` walk busts nothing; clearing on `complete` alone loses the fault permanently.

**R13. A registry entry that is not a conforming object counts as FAILED.** A string entry, or an
object missing `slug`, does not throw — `standingsSlugTag(undefined)` is the valid tag
`standings:undefined` and `revalidateTag` succeeds, so the walk counts a bust that never happened.

**R14. `malformed` is population-unknown (`attempted: null`), `missing` is a genuine empty registry.**
Consume `readLeagueRegistry()`, never `getLeagues()`, whose collapse the reader's own docblock calls
*"the collapse this reader exists to prevent."*

**R15. Never re-dereference a value that threw, inside a catch, in a helper documented as never
throwing.** Post-commit that returns 500 after a successful commit — the CARRIES violation the
original swallow existed to prevent.

**R16. Ordering is fewest-attempts, then oldest `since`.** Oldest-first alone lets four permanently
failing years hold every slot while a repairable fifth is never attempted.

**R17. A drain failure must not fail the run or alter any year's reported result.** Per-run facts
belong in the run-level target, like `invalidLifecycleTargets`. A year whose own work completed is a
succeeded refresh.

**R18. The drain bound is a SAFETY RAIL against pending-set growth. Its comment must assert no cost
model.** The rebuild is deferred to the next READ, so an invalidated entry with no readers costs
nothing, rebuilds never land together, and the active year is already invalidated by every
content-changed refresh. `N = 4` stands on the rail argument alone. **A measured standings rebuild
would not decide this and is RETIRED, not deferred.**

### Refuted, with the evidence — do not re-raise

**`attempts: existing?.attempts ?? 0` does NOT reset a re-recorded year's count.** `??` falls through
only on `null`/`undefined`, so an existing count is preserved. `/code-review` raised it; the lane
refuted it and **pinned the behaviour with a test rather than a rebuttal**, which is the practice to
repeat. Keep that test.

### Known limit — state it, do not work around it

**Staleness cannot be reproduced in-process.** `unstable_cache` does not exist under `node:test`
(`leagueStandings.ts:286`), so the selector falls back to direct compute and there is no data cache
to leave stale. **Build no fake.** A harness that fakes the subject proves only that the fake works.

---

## The three habits that produced these rounds

Stated because the code is being rebuilt and the habits are not.

1. **A test's name outran what it proved, three times, and only a mutation ever caught it.** The
   round-2 trigger-B test unit-tested the helper and never tested that anything CALLS it — deleting
   the call site left the suite green. The round-3 generation test bumped `attempts` through a
   neighbouring generator instead of re-recording, so it never reached the race. **Every requirement
   above needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
   fired.**
2. **Seven false mechanism comments across three rounds, four of them in the round AFTER the rule
   became binding.** Your own diagnosis is the right one and it is now the instruction: the gap is
   mechanical, not attentional — you write the comment from the design you intend, the design moves,
   and **a diff never flags a comment whose own lines nobody edited.** Re-read every comment in every
   touched file as a discrete step before committing, against the shipped code.
3. **Citing a rule is not coverage for it.** The `:468` miss landed in the round that cited `:468`;
   the comment defects landed in the commit citing the comment rule. Treat a citation as a reminder
   to apply the rule, never as evidence you did.

---

## STOP — read receipt before writing any code

1. **Read the v1 module once, then answer: which of R1–R9 does its existing shape make hard to
   satisfy?** Name them. If the answer is "none, all nine are local edits", say so plainly — that is
   an argument the owner's reconstruction call was wrong, and I would rather hear it now than
   discover it in a diff that looks like a patch.
2. **Where does R1's issue belong** — `schedulerExecutionIssues` alongside the existing codes, or
   somewhere else? Name the code, its severity, and the exact panel whose state changes when the
   count is positive. Then say what an operator is supposed to DO about it.
3. **Does R2's revision belong on the record or on the scope?** Say which, and what happens to an
   existing v1 record that has no revision field when this ships.
4. **Enumerate every caller that clears**, from the code, and confirm three. If there are more, R3
   is under-specified and I need to know before you build.
5. **R5 says derive `stillPending` from the full durable set.** What does that cost — a full
   `listAppStateKeys` scan per cron run? Give the operation and say whether it is bounded.
6. **Is any requirement here in tension with another?** R7 (delete) against R2 (revision continuity)
   is the pair I would look at first, but I want your answer, not confirmation of mine.
7. **What does the v1 branch do that this specification does not require?** Anything you find is
   either a requirement I failed to carry forward — which I need to know — or something that should
   not be rebuilt.
8. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
