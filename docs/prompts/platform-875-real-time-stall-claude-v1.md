# PLATFORM-875 — a test that ends by exhausting a budget rather than by asserting

```text
PROMPT_ID: PLATFORM-875-REAL-TIME-STALL-CLAUDE-v1
PURPOSE: `PLATFORM-861: the FIRST year runs even past the budget` mocks `Date` but not `setTimeout`,
         so it spends ~750ms of REAL wall-clock in three venue attempts against real backoff sleeps,
         against a 30s file budget. When the budget goes, the FILE DIES rather than an assertion
         failing — and the TAP summary can print `# fail 0` while it happens.
SCOPE:   src/app/api/cron/schedule-presentation/__tests__/stall.test.ts — the test at `:863` and any
         sibling in this suite with the same shape. DO NOT change src/, the route, the budget
         constants, or any assertion's MEANING.
CARRIES: NONE from the Item 87 campaign index, having checked — this is test-harness integrity, not
         a presentation surface.

         Three standing obligations bind, from AGENTS.md:
         - A negative assertion requires a proven observer, and the observer needs its own positive
           control. That obligation is the HARD part of this slice — see below.
         - A gate's verdict is its exit code, never its summary line.
         - Every claim needs a mutation that reddens its OWN named assertion, and you say which
           assertion fired.
```

---

## The mechanism

`src/app/api/cron/schedule-presentation/__tests__/stall.test.ts:877`:

```js
t.mock.timers.enable({ apis: ['Date'], now: t0 });
```

**`Date` only.** `setTimeout` is real, so the three venue attempts wait out their real backoff sleeps:
about **750 ms of wall-clock** on a file budgeted at **30 s**. Under concurrency that margin is not as
generous as 40× suggests.

**Observed once in 350 runs** by the #872 lane, under five-way concurrency — and it did not merely
fail, it **cancelled the rest of the file**. That is #872's ending reached by a different route:
#872 was a fixed tick count leaving work unsettled; this is real time accumulating until the harness
gives up. Both produce a dead file, and `AGENTS.md` records that `# fail 0` can print while one dies.

## THE TRAP — #872's fix does not transfer, and it is two files away

**Do not reach for `tickUntilSettled`.** #872's tests had a mocked clock to advance; **this one has no
clock to drive.** Its cost is real wall-clock inside real sleeps, and there is nothing to tick.

**The fix has to BOUND the wait, not advance it.** That is a different shape from the one that just
landed in the same file, which is exactly why it is worth saying before you start — the adjacent,
recently-successful pattern is the wrong one here.

## THE HARD PART — the positive control

In #872 you could induce the failure by shrinking a macrotask budget. **Here you cannot.** The failure
comes from starving the process, which a test cannot request.

**So do not accept a control that merely proves the harness runs.** `AGENTS.md`'s observer rule binds,
and this is the case where satisfying it takes thought rather than a line. If you conclude a true
positive control is not constructible, **say so explicitly and say what you substituted**, rather than
shipping something that looks like one. A control that cannot fail is the defect this issue is about,
reproduced in its own guard — and that has now happened four times on this project.

## Acceptance

1. **The test does not consume real time waiting.** Mock `setTimeout` alongside `Date`, or drive the
   wait on a condition rather than a clock. Report the measured wall-clock before and after.
2. **When it cannot complete, it FAILS WITH A NAMED ASSERTION rather than dying.** This is the half
   that matters: a dying file and a passing one are indistinguishable in the TAP summary, so a fix
   that only makes the test faster leaves the dangerous shape intact.
3. **Every existing assertion keeps its meaning.** This test pins that the first year runs even past
   the budget — the ungoverned-first-year guarantee that stopped round 1's starvation. **Changing how
   it waits must not change what it proves.** Name the assertions and confirm each still fails for its
   original reason.
4. **Swept.** Any other test in this suite that mocks `Date` without `setTimeout` gets the same
   treatment, or a stated, measured reason it is safe. Enumerate them — do not report a count.
5. **Verified at high N with the count stated**, per #872's precedent. One occurrence in 350 runs
   means a single green pass distinguishes nothing.

## Testing requirements

**Every claim needs a mutation that reddens its OWN named assertion, and you must say which assertion
fired.**

**Acceptance 2 is the likely false green**, and it is the whole point: a test that now runs fast will
pass whether or not it fails cleanly under starvation. Prove the failure path separately — force the
bound to expire and show it produces a named assertion failure, not a cancellation.

**Beware `mock.timers` itself.** This suite has already recorded a case where enabling fake timers
with `Date` at 0 made both arms of a mutation stay green. If you extend the mocked APIs, prove the
assertions can still fail.

---

## STOP — read receipt before writing any code

1. **Every test in this suite that mocks `Date` without `setTimeout`.** Enumerate them with their
   measured wall-clock cost, not a count.
2. **Where does the ~750 ms actually go?** Name the sleeps and their source — is the backoff in the
   route, the provider client, or the fixture?
3. **Can `setTimeout` be mocked here without changing what the test proves?** The route's own
   deadlines may depend on it. Answer from the code, and if it cannot, say what bounding looks like
   instead.
4. **What positive control is available for acceptance 2**, given the failure cannot be induced by a
   budget change? If your answer is "none that is honest", say that — it is an acceptable answer and a
   fabricated control is not.
5. **Does the file budget apply per file or per process?** It decides whether concurrency is the
   trigger or merely a correlate.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
