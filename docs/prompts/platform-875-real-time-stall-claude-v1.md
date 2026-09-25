# PLATFORM-875 — a test that ends by exhausting a budget rather than by asserting

```text
PROMPT_ID: PLATFORM-875-REAL-TIME-STALL-CLAUDE-v1
PURPOSE: TWO tests in this file mock `Date` but not `setTimeout`, so each spends ~750-900ms of REAL
         wall-clock in venue backoff sleeps — together ~83% of the file's 1.9s against a 30s budget.
         Fix the one that can take the fix (`:863`); record the other (`:743`) with its measured
         reason. Convert "the bound expired" from a dying file into a named assertion.
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

## RECEIPT ADJUDICATED 2026-09-25 — three rulings, and this prompt's central trap was WRONG

**All five corrections accepted. The slice is smaller than this prompt describes.**

### RULING 1 — `:743` takes option (c): leave it, with the measured reason recorded

**(b) is disqualified by your own analogy and it is the right one.** Making the venue failure
non-retryable removes the sleeps while silently narrowing what the fixture exercises — *"CLAUDE.md's
`--base` trap in test clothes"*. That is exactly the shape: it looks like it is doing the job while
shrinking what is seen, and nothing downstream would show it.

**(a) is correct but buys a guard that needs its own control**, which is the cost this slice exists to
avoid paying twice.

**So: fix `:863` (measured 713–883 ms → 9.07 ms, all four assertions intact), and leave `:743`
documented** with its 714–904 ms against a 30 s budget and the reason it cannot take the same fix —
its boundary is exactly 8 s and every pre-admission tick moves elapsed past it.

### RULING 2 — YES, inherit the existing controls. Do not write a third

`#872: the tick cap fails by ASSERTION, naming what hung` (`:437`) and `#872: the default cap is the
one the loops run under` (`:898`) already feed `tickUntilSettled` an unsettling promise and assert the
`AssertionError` carrying the work's name. Same function, same expiry path, real input. **A third
near-duplicate proves nothing new. Name the providing tests in the closeout** — that is the
"name its test" rule applied to a control.

**And ship your (b) statement as written.** The harness killing the file has no constructible control,
and no fix can build one, because Node cancels from outside the test's own code. **The fix converts
(a) into a named assertion and cannot touch (b); it makes (b) less reachable, which is a probability
reduction and not a guarantee.** That is the honest claim and it is worth more than a confident one.

### RULING 3 — acceptance 5's high-N run is REPLACED by a deterministic check

Your reasoning decides it: a green run at N=500 bounds a 1-in-350 event loosely, while **"zero real
sleeps" is checkable exactly.** Assert the quantity the claim is about — that the fixed test consumes
no real wall clock — and use a modest N only as corroboration. **This is the repo's own rule about
measuring the claim rather than a proxy for it**, and the proxy here is expensive as well as weak.

### This prompt's central trap was wrong, and your correction is sharper

I wrote *"do not reach for `tickUntilSettled` — this one has no clock to drive."* **Acceptance 1
CREATES that clock**, so the warning contradicted the instruction two sections below it, and you
measured `:863` working through the helper.

**The real trap is the inverse: ticking advances the mocked `Date`, which in this file IS the measured
quantity the budget assertions read.** That is what kills `:743`, and it is a sharper statement than
mine. **I was right about what must not happen and wrong about why** — which is the shape the repo
already records for a removed guard, and it is worth noticing that a warning can be load-bearing and
mis-mechanised at the same time.

**Also accepted:**

- **Two tests pay, not one**, and the unnamed one costs marginally more. PURPOSE and the `:863`
  citation are corrected below.
- **`Date`-only is necessary, not sufficient** — five of the seven run in 5–20 ms. The cost needs a
  clock advance that expires the venue catalog.
- **`# fail 0` is real but `npm run test:file` exits 1.** The shape is dangerous to a reader of the
  summary, not to the pre-merge gate. That reduces what acceptance 2 buys and you were right to say so
  before spending the slice.
- **The 40 s abort timer is still pending during every backoff sleep** (`fetchUpstream.ts:466` runs
  before the `continue` exits the try), so a tick step ≥ 40 s fires it. **The shared 45 s step is
  load-bearing in both directions** — do not touch it.
- **56 more `Date`-only `enable` calls in `src/app/api/cron/rankings/__tests__/`**, unmeasured and out
  of scope. Record them in the closeout as unmeasured rather than swept.

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

## THE TRAP — CORRECTED BY MEASUREMENT; the original version of this section was wrong

**It read:** *"Do not reach for `tickUntilSettled` — this one has no clock to drive."* **False, and it
contradicted acceptance 1 two sections below, which instructs you to mock `setTimeout` and therefore
CREATES the clock.** `:863` was measured working through that helper: 713-883 ms → 9.07 ms, all four
assertions intact.

**The real trap is the inverse and sharper: ticking advances the mocked `Date`, and in this file that
IS the measured quantity the budget assertions read.** Every pre-admission tick moves elapsed past
`:743`'s 8 s boundary, which is why that test cannot take the same fix and takes ruling 1's option (c)
instead.

**And the shared tick step is load-bearing in BOTH directions.** ≥ 40 s is required by ACCEPTANCE 3
and 9 to outlast the attempt deadline — the 40 s abort timer is still pending during every backoff
sleep, because `fetchUpstream.ts:466` runs before the `continue` exits the try. ≥ 8 s is fatal to
`:743`. **Do not change the step.**

## THE POSITIVE CONTROL — SETTLED BY RULING 2; the answer is "inherit, and say which"

The receipt separated two "cannot complete" events and only one is controllable.

**The bound expiring IS controlled, by two tests that already exist** — `:437` and `:898` — and
acceptance 2 is inherited when `:863` routes through `tickUntilSettled`. **Name them; do not write a
third near-duplicate.**

**The harness killing the file has NO constructible control**, because Node cancels from outside the
test's own code, and **no fix can build one.** Report it exactly that way: the fix converts the first
into a named assertion, cannot touch the second, and makes the second less reachable — a probability
reduction, not a guarantee.

**That honest split is the deliverable.** A control that cannot fail is the defect this issue is
about, reproduced in its own guard, and that shape has now appeared four times on this project.

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
5. **A DETERMINISTIC check replaces the high-N run.** Assert that the fixed test consumes no real
   wall clock — the quantity the claim is about — rather than inferring it from a green run. A modest
   N corroborates; it does not bound a 1-in-350 event, and N would have to greatly exceed 350 to try.

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
