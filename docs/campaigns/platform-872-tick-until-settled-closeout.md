# PLATFORM-872 — the stall tests tick until the run settles (closeout)

Status: Implemented and gated; pre-merge closeout, not a deployment claim.
Issue: [#872](https://github.com/znpruitt/cfb-app/issues/872). **No prompt file** — the owner filed
the issue from the #866 lane's post-merge investigation and authorized the slice directly, so no
`PROMPT_ID` was assigned and none is invented here.
Branch: `claude/872-tick-until-settled`, off `origin/main` at `1d66c742`.

**No production behaviour changes.** Every edit is in
`src/app/api/cron/schedule-presentation/__tests__/stall.test.ts`.

---

## What shipped

The two stall tests drove `t.mock.timers.tick` a fixed number of times — ten for `ACCEPTANCE 3`,
twelve for `ACCEPTANCE 9`. Both now call one shared `tickUntilSettled`, which ticks **until the
awaited run settles**, with a bounded cap whose expiry is an **assertion naming what did not settle**
rather than a hang. A third test, `#872: the tick cap fails by ASSERTION`, is the cap's positive
control.

## 1. The mechanism, corrected

The issue described the fixed count as an unwritten safety claim. It is, but the claim is wrong in a
more specific way than "nobody measured it", and the specifics are the reason the fix is shaped as it
is.

The old comment reasoned that three attempts need five ticks — one per attempt deadline, two for the
backoff sleeps between them — so ten left five spare and *"extra ticks are free"*.

**The timer count was exactly right. The headroom was not.** A tick fires only a timer that has
already been SCHEDULED. `settle()` returns after a fixed budget of macrotask turns, not when the run
reaches its next `await`, so a tick issued while the run is still inside a durable read fires nothing
and is **spent**. The five "spare" ticks were never spare; they were already being consumed.

Measured by instrumenting the loop to count timers scheduled under the mocked clock and to record
which ticks fired one (2026-09-24, this machine, 8-way host):

| quantity | result |
| --- | --- |
| timers the run schedules (`fired`) | **exactly 5**, in **all 700** instrumented executions |
| ticks spent firing nothing | 4-11 observed |
| tick index of the LAST firing tick | the quantity that actually bounds a fixed count — below |

`UPSTREAM_PACING_DISABLED=1` in the test child, so the old comment's *"plus the shared CFBD pacing
waits"* contributed no timers at all. Five is the whole demand.

## 2. The margin, and why `ACCEPTANCE 9` was also exposed

The fixed count had to cover the index of the **last firing tick**, not the total ticks used: ticks
issued after the last timer fires are spent on nothing, and the old loop's trailing `await running`
finished the remaining non-timer work with no tick at all.

200 runs at five-way contention, 400 executions:

| last-fire index | `ACCEPTANCE 3` (allowance 0-9) | `ACCEPTANCE 9` (allowance 0-11) |
| --- | --- | --- |
| 6 | 2 | 18 |
| 7 | 82 | 75 |
| 8 | 113 | 98 |
| 9 | **3** | 8 |
| 13 | — | **1** |

`ACCEPTANCE 3` reached index 9 — **the last passing value** — in 3 of 200 runs. Its real margin was
about one tick, not five.

**`ACCEPTANCE 9` exceeded its own allowance once in 200 runs**, at index 13 against a ceiling of 11.
That run would have hung under the old code. The issue's acceptance 3 asked for a sweep of other
fixed-count loops; this is the measured reason it was necessary rather than precautionary, and it is
the one finding here that the issue did not already state.

## 3. Reproduction: by mutation, not by rate

**The natural flake was NOT reproduced on this machine: 300 runs, 0 failures** — 150 unloaded and 150
at five-way contention, on the unmodified file. Stated plainly because a green high-N run against a
defect nobody can trigger locally is not evidence, and the verification in §5 would mean nothing
without a positive control.

The control is a mutation that makes spent ticks common on demand: shrink `settle()`'s macrotask
budget, so the loop far more often ticks while the run is still mid-read.

| `settle()` turns | old fixed-count loops | new `tickUntilSettled` |
| --- | --- | --- |
| 20 (shipped) | 0/5 failed | 0/5 failed |
| 5 | **5/5 died** | 0/5 failed |
| 3 | **5/5 died** | 0/5 failed |
| 2 | **5/5 died** | 5/5 **failed by named assertion** |
| 1 | **5/5 died** | 5/5 **failed by named assertion** |

The last two rows are the cap doing its job: at a budget where the run genuinely cannot progress, the
new loop still fails — and that is correct — but it fails as
`the stalled schedule-presentation run did not settle after 60 ticks of 45000 ms`, on the two tests
that hung, instead of killing the file.

## 4. The `# fail 0` shape, reproduced

The old code under the settle=5 mutation:

```text
# tests 11
# pass 1
# fail 0
```

**Ten tests died and the summary reported zero failures.** One hung test poisons every test after it
in the file — each reports `Promise resolution is still pending but the event loop has already
resolved` — and none of them counts as a failure. The new code under a mutation severe enough to
break it reports `# tests 12 / # pass 10 / # fail 2`.

This is the independent confirmation of the rule added to `AGENTS.md` on 2026-09-24: a gate's verdict
is its exit code, never its summary line. Every run in this closeout was judged on the exit code; the
harness deletes a run's log only when it exited 0.

## 5. Verification

Each gate its own command and its own exit code, never behind a pipe.

- `npx tsc --noEmit` — exit 0.
- `npm run test:file -- src/app/api/cron/schedule-presentation/__tests__/stall.test.ts` — exit 0,
  12/12 pass (11 before, plus the cap's positive control).
- **200 runs at five-way contention, plus 60 unloaded — see the verification line appended below.**
  Acceptance 2 asks for high N rather than one green pass, because at 2.5% a single pass has a 97.5%
  chance of looking fixed either way.
- `npm run lint:all` and `npm test` — see below.

## 6. Method note: three instruments, three wrong quantities

Recorded because the shape is this repo's recurring one, and it recurred inside the fix for an
instance of it.

Measuring "how many ticks does this need" went wrong twice before it went right:

1. **Loop iterations until settled** — over-counts. Iterations continue while the run finishes
   non-timer work.
2. **Total ticks used (`fired + spent`)** — still over-counts, for the same reason: trailing spent
   ticks are not a requirement, because the old loop's `await running` needed no tick to finish.
3. **Index of the last firing tick** — the quantity a fixed count actually had to cover.

Instruments 1 and 2 both reported that the old allowance was exceeded in ~78% of runs, which is
flatly contradicted by the old code passing 300/300. **A measurement that disagrees with an observed
outcome by two orders of magnitude is measuring something else** — that disagreement is what caught
it, not review. Both wrong instruments were keyed on something adjacent to the claim; only the third
asks the question the claim is about. Same shape as the `git diff` base check in `CLAUDE.md`, which
was corrected three times for keying on a rendering detail rather than on the question.

## 7. Scope held

`t.mock.timers` appears in four other files. None carries a fixed-count loop driving a run to
completion: `rankings/__tests__/{route,receipts,incidentEvidence}.test.ts` use
`enable({ apis: ['Date'] })` with single deterministic advances, and
`CompactGameScoreboard.logoLifecycle.test.tsx` ticks three fixed durations inside `act()` with no
awaited run to outlast. Within `stall.test.ts` the remaining `tick()` calls are single `Date`
advances inside fetch stubs and `installReadClock`, not loops. Acceptance 3 is discharged by
treatment for the two loops and by inspection for the rest.
