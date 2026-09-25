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
rather than a hang. Two added tests cover the cap itself: one that its expiry is a named assertion
rather than a death, and one (added in round 1 remediation) that the default value and its wiring are
what the loops actually run under.

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

Each gate its own command and its own exit code, never behind a pipe. All against the tip recorded in
§8, worktree clean. **Round 1 finding 4 corrected this**: it read "all against `380a8e52`" while the
tip was `718c1edf`, which edits this very file — a file inside `lint:markdown`'s set — so the
`lint:all` row did not reach the commit being merged. The gates had in fact run against the tip's
content; the claim was the defect, not the coverage.

| gate | exit | result |
| --- | --- | --- |
| `npx tsc --noEmit` | 0 | — |
| `npm run lint:all` | 0 | 139 markdown files, 0 issues; Prettier clean |
| `npm test` | 0 | 5588/5588 pass, 0 `not ok` lines |
| `npm run test:file -- …/stall.test.ts` | 0 | 12/12 (11 before, plus the cap's positive control) |

**Acceptance 2 — high N, 260 runs, zero non-zero exits:** 200 at five-way contention and 60
unloaded, each run judged on its exit code. Acceptance 2 asks for this rather than one green pass
because at 2.5% a single pass has a 97.5% chance of looking fixed either way.

**What 260 green runs do and do not establish.** They do not by themselves demonstrate the defect is
gone, because the unmodified file also passed 300 (§3) — the natural rate is below what this machine
reproduces. The load-bearing evidence is the mutation table in §3, where the same budget that kills
the old loops 5/5 leaves the new one green, plus the §2 distribution showing the old margin was one
tick wide. The high-N run establishes that the new loop introduced no new instability.

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

## 7. HANDOFF: the known-failure baseline must be retired by planning

**Round 1 finding 3.** `docs/next-tasks.md` records one entry in `main`'s known-failure SET —
`stall.test.ts:236 ACCEPTANCE 3`, ~2.5%, tracked as #872 — and it says to restore the line to EMPTY
the moment #872 lands. That file belongs to the planning lane, so **this branch does not edit it**,
and an implementation lane reports rather than files. Recording the instruction here so it survives
the merge rather than living only in a chat message.

**Why it is not cosmetic.** `CLAUDE.md` merge condition 3 binds to the SET: merge only when the
failures are exactly the known set. A stale entry naming `ACCEPTANCE 3` therefore **licenses a future
lane to merge over a real failure in that test** — the entry would tell them it is expected. The
entry is load-bearing in the direction of permitting a merge, which is the direction that costs
something.

**Two specifics for whoever makes the edit:**

- The recorded line number `:236` is already stale. After this branch, `stall.test.ts:236` lands
  inside the `MAX_STALL_TICKS` docblock, not on the test.
- Retire the entry to EMPTY rather than editing it, per the note's own instruction, and keep the
  wording as a SET so a future second entry cannot hide behind a count.

## 8. Review and remediation

Both reviewers ran against `718c1edf`, gathered before any remediation.

- **`/codex:review --base 1d66c742` — clean, no findings.** Verified as a real review rather than a
  review of nothing, in the order `CLAUDE.md` sets: exit code 0 first; then the diff base, with all
  four `git diff` invocations in the transcript carrying `1d66c742` and none carrying anything else;
  then the body, which describes the actual change.
- **`/code-review 718c1edf` — no correctness bug in the helper, four secondary findings, all
  accepted.** It independently re-derived the load-bearing arguments instead of taking this
  document's word for them, and added one this document had left implicit: because ticks are issued
  only while the run is unsettled, in-run elapsed can only be **greater than or equal to** the old
  fixed loop's, since the old loop's trailing ticks were post-settlement no-ops. That is what makes
  §2's monotonicity argument safe for `ACCEPTANCE 9` rather than merely plausible.

| finding | disposition |
| --- | --- |
| Dangling citation: the docblock quoted a TRUNCATED form of the control's real name | Fixed, and the guard WIDENED — see below |
| `MAX_STALL_TICKS` and its default wiring were unobserved by any test | Fixed: a new test pins the safety margin and the wiring |
| Known-failure baseline not retired | §7 above — planning's file, instruction recorded |
| Gate table SHA under-covered the tip | Fixed in §5 |

**The citation finding is the interesting one, because the guard that exists for exactly it could not
see it.** `stall.test.ts` already carries a test asserting that every cited test name resolves to a
declared test — written on the #861 branch after a comment cited a test that was never written. It
read `route.ts` only. This branch's dangling citation lived in this file's own comments, so it passed.
A truncated real name resolves to nothing exactly as an invented one does. The guard now extracts
`'#872:…'` citations from this file too, with its own positive control on the added extraction.

**Every remediated claim was mutation-tested, reading WHICH assertion fired:**

| mutation | result |
| --- | --- |
| Truncate the docblock citation | Widened guard fails: `a comment cites a test that does not exist…` |
| `MAX_STALL_TICKS` 60 → 14 (tuned toward the measured 6-13) | Margin assertion fails, naming the worst measured index |
| Sever the default wiring, constant untouched | Wiring assertion fails — and `ACCEPTANCE 3`/`9` fail by NAMED ASSERTION rather than dying, which is the whole fix demonstrated a second time |

## 9. One observation the verification turned up, NOT caused by this branch

The post-remediation 200-run verification returned **5 failures**, where the same run had returned 0
before remediation. Recorded with its resolution rather than quietly re-run, because "I re-ran it and
it was fine" is the shape that hides a real regression.

**All five were the same batch** — five concurrent processes, all timing out together — and all hung
at `PLATFORM-861: the FIRST year runs even past the budget, with a slow store and the venue leg
owed`. That test is **not touched by this branch**, and it is declared BEFORE both added tests, so
neither can affect it; the two tests that do use `tickUntilSettled` passed in ~30 ms each in the same
logs.

**A/B under shared conditions settles it.** Running the pre-remediation and remediated files in
alternating batches, so any load spike hits both arms: **150 runs each, 0 failures in both.** The
batch-37 cluster was a machine-level stall, not a property of either version.

**What it does leave on the record, for planning rather than for this branch:** that test spends
~750 ms of REAL time (three venue attempts against real backoff sleeps — it mocks `Date` only, not
`setTimeout`), against a 30 s per-process file budget. Under a severe enough stall it can exhaust
that budget, and when it does the file dies rather than failing an assertion — the same shape #872
just fixed, reached by a different route. Observed once, in one batch, in 350 post-remediation runs.
Not filed here: an implementation lane reports new findings and planning numbers them.

## 10. Scope held

`t.mock.timers` appears in four other files. None carries a fixed-count loop driving a run to
completion: `rankings/__tests__/{route,receipts,incidentEvidence}.test.ts` use
`enable({ apis: ['Date'] })` with single deterministic advances, and
`CompactGameScoreboard.logoLifecycle.test.tsx` ticks three fixed durations inside `act()` with no
awaited run to outlast. Within `stall.test.ts` the remaining `tick()` calls are single `Date`
advances inside fetch stubs and `installReadClock`, not loops. Acceptance 3 is discharged by
treatment for the two loops and by inspection for the rest.
