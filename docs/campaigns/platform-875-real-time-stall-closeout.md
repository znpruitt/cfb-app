# PLATFORM-875 — a test that ended by exhausting a budget rather than by asserting (closeout)

Status: **Merged** — [PR #878](https://github.com/znpruitt/cfb-app/pull/878), `e2b3ac90`, 2026-09-25.
The merged tree hash matched the gated one (`c75bb284`). Not a deployment claim: auto-promotion is
off, and this branch is test-only in any case.
Issue: [#875](https://github.com/znpruitt/cfb-app/issues/875).
Prompt: `docs/prompts/platform-875-real-time-stall-claude-v1.md`
(`PROMPT_ID: PLATFORM-875-REAL-TIME-STALL-CLAUDE-v1`).
Branch: `claude/875-real-time-stall`, off `origin/main` at `15299121`.

**No production behaviour changes.** Every edit is in
`src/app/api/cron/schedule-presentation/__tests__/stall.test.ts`. `preview` was not taken — a
test-only branch has nothing to click through.

---

## What shipped

`PLATFORM-861: the FIRST year runs even past the budget, with a slow store and the venue leg owed`
mocked `Date` but not `setTimeout`, so the venue leg's three attempts waited out `fetchUpstream`'s
real backoff sleeps. It now mocks both and drives the existing `tickUntilSettled`.

| quantity | before | after |
| --- | --- | --- |
| the test | 713–883 ms (5 runs) | **9.17–10.95 ms** (10 runs) |
| the whole file | 1833–1959 ms (5 runs) | **920–1186 ms** (40 runs) |

Three things came with it: a deterministic real-wall-clock assertion, a venue attempt count, and a
re-measured tick budget that turned out to have been stale before this branch existed.

## 1. Where the time went, and why the file budget is the thing at risk

The cost is not in the fixture. `stubMediaOkVenuesDown` throws synchronously; `isRetryableError`
(`fetchUpstream.ts:156`) classifies that `network`, and the retry loop sleeps on the real clock
between attempts — `sleep()` at `fetchUpstream.ts:176`, awaited at `:466`, with waits from
`computeBackoffMs` over `CFBD_RETRY_POLICY` (`schedulePresentationRefresh.ts:82`). Three attempts,
**two** sleeps: 250 ± 50 and 500 ± 100. Measured inter-attempt gaps on an instrumented run: **243 ms
and 523 ms**.

Pacing contributes nothing — `applyPacing` is disabled in the test child.

**The budget is per FILE, and that was worth measuring rather than assuming.** A probe of four tests
(20 s / 20 s / 35 s / instant) showed Node applies `--test-timeout=30000` to the *file-level subtest*
as well as to each test:

```text
ok 1 - probe A: 20s of real wall clock            duration_ms: 20003
not ok 1 - …/budgetprobe.probe.test.ts            duration_ms: 30004
  failureType: 'testTimeoutFailure'
# tests 2 / # pass 1 / # fail 0 / # cancelled 1        REAL_EXIT=1
```

Probes B, C and D never ran. So the constraint is the **sum** over the file, which is why one test's
750 ms matters at all.

**`# fail 0` is real, and the gate is not blind.** The runner exits 1. The dangerous shape is
dangerous to a reader of the summary, not to the pre-merge gate — which is `AGENTS.md`'s own rule
that a gate's verdict is its exit code. This was reported before the slice was spent, because it
changes how much the work buys.

## 2. Why mocking `setTimeout` is safe here and nowhere else in this file

Ticking advances the mocked `Date`, and in this file **`Date` is the measured quantity the budget
assertions read**. The fixed test's single year is the UNGOVERNED first one — precisely what it
pins — so no ticked elapsed can change its verdict.

The prompt's original trap section said the opposite (*"no clock to drive"*) and was corrected by
measurement before implementation; the adjudicated prompt records that. The tick step was not
touched: ≥ 40 s is required by ACCEPTANCE 3 and 9 to outlast the attempt deadline, because the 40 s
abort timer is still armed during every backoff sleep (`fetchUpstream.ts:466` runs before the
`continue` exits the try).

## 3. The sweep — enumerated, not counted

Seven tests mock `Date` without `setTimeout`. Measured from TAP `duration_ms`, five solo runs, with
provider calls counted by an instrumented copy:

| test | wall clock |
| --- | --- |
| `ROUND 3 #1: a comfortably fresh catalog owes nothing …` | 8.6–9.0 ms |
| `ROUND 3 #3: a catalog that expires mid-run …` | 5.0–5.3 ms |
| `PLATFORM-861: a slow venue read is charged to the admission check …` | 10.3–10.6 ms |
| `PLATFORM-861: a year IS admitted at exactly the both-legs boundary` | **714–904 ms** |
| `PLATFORM-861: one millisecond past the boundary …` | 9.7–20.3 ms |
| `PLATFORM-861: a year that cannot fit under ANY answer …` | 10.0–13.6 ms |
| `PLATFORM-861: the FIRST year runs even past the budget …` | **713–883 ms** |

**`Date`-only is necessary, not sufficient.** Five cost under 21 ms because they never reach the
retry loop: `mock.timers.enable` anchors `t0` *before* `seed` writes the catalog at
`realNow() − TTL`, so the authority's freshness check reads `TTL − δ` and short-circuits. Only a
fixture that then advances the mocked clock past the TTL expires the catalog.

**The prompt named one test; two pay, and the unnamed one costs more.**

### The one that keeps its cost — owner ruling, option (c)

`PLATFORM-861: a year IS admitted at exactly the both-legs boundary` cannot take the same fix.
`tickUntilSettled` ticks from the start of the run, so mocked time lands *before* year 2027's
admission capture, and that test's subject is that the capture reads exactly 8 s. Measured: the
assertion `exactly 250s of promise is still a promise the job can keep` fires, `1 !== 2`.

Two alternatives were rejected:

- **Gate the tick loop on the venue fetch having been entered.** Works, but buys a second condition
  needing its own positive control — the cost this slice exists to avoid paying twice.
- **Make the venue failure non-retryable.** Removes the sleeps, and the test asserts nothing about
  attempt count so it stays green. **That is the trap**: it silently narrows what the fixture
  exercises, and nothing downstream shows the loss.

### Unmeasured, not swept

`src/app/api/cron/rankings/__tests__/` carries **56** further `apis: ['Date']` enables across
`route.test.ts`, `receipts.test.ts` and `incidentEvidence.test.ts`. Out of scope, **not timed**, and
no claim is made either way — the reason the five cheap tests above are cheap is a property of
`stall.test.ts`'s fixtures and does not carry.

## 4. Acceptance 2 — the honest split

Two distinct "cannot complete" events, and only one is controllable.

**The bound expiring is controlled, by tests that already existed.**
`#872: the tick cap fails by ASSERTION, naming what hung — it does not kill the file` and
`#872: the default cap is the one the loops run under, and it stays clear of measured demand` both
feed `tickUntilSettled` a genuinely unsettling promise and assert the `AssertionError` carrying the
work's name. Acceptance 2 is **inherited and named**. A third near-duplicate would prove nothing.

**The harness killing the file has no constructible control and cannot get one.** Node cancels the
file-level subtest from outside the test's own code; nothing asserted there runs first. Removing the
real sleeps makes that outcome less reachable. **A probability reduction, not a guarantee.**

## 5. Acceptance 1 checked deterministically, replacing the high-N run

Owner ruling 3: assert the quantity the claim is about. `realElapsedMsSince` reads
`process.hrtime.bigint()`, which `mock.timers` does not mock, so it measures real time while `Date`
is frozen. The bound is `MIN_REAL_BACKOFF_MS = 600` — the **floor of the defect**, derived from the
retry policy (`250 − 50` then `500 − 100`), not a tuned ceiling on health. It is one-sided: its only
failure mode is that a real backoff sleep happened.

`CFBD_RETRY_POLICY` is not exported, so the constant is restated and a policy change will not redden
it — the same weakness `STORE_READ_WORST_CASE_MS` names about itself, and naming it is again the only
honest mitigation available from a test file.

N=40 corroborates (40/40 exit 0); it does not bound a 1-in-350 event.

## 6. Review

Both reviewers gathered against `500c349b`, before any remediation. They were run **sequentially, not
concurrently** — `/code-review` writes probe files into the worktree Codex gates, and the 2026-09-21
measurement recorded that poisoning four of Codex's gates while it still reported clean. The tree was
confirmed clean (`git status --porcelain --untracked-files=all`) between them.

**`/codex:review --base 15299121` — no actionable defects, and it DISCLOSED its own gap:** its
`npm run test:file` hit exit 1 under a read-only sandbox, so *"runtime verification remains
incomplete"*. Verified by exit code (0), by the transcript's diff base (`git diff 152991215c2b…` on
the same line, exit 0), and by the body. **Treated as a static-only pass, not as corroboration of the
timing claims.**

**`/code-review high` — four findings, all accepted, one with its attribution corrected.**

### Finding 1 (medium) — the tick budget, and it was stale before this branch

The `MAX_STALL_TICKS` docblock recorded settle indices of 6–9 and 6–13 from five-way contention, and
the default-cap test floored the cap at 30 citing a worst index of 13. Re-instrumented, **n=64 per
caller at eight-way contention**:

| caller | min | max | p95 |
| --- | --- | --- | --- |
| `the stalled schedule-presentation run` | 8 | 13 | 12 |
| `the budget-exhausted …` (ACCEPTANCE 9) | 9 | **21** | 13 |
| `the ungoverned first year` (new) | 14 | 19 | 18 |

The review said this branch "added the heaviest consumer." **The worst index is not the new
caller's** — ACCEPTANCE 9 reached 21, on a caller this branch never touched, so the recorded range
was already stale at eight-way contention. The new caller raised the **floor** (14, against 8 and 9)
and the p95, not the maximum.

Substance accepted: docblock re-measured, floor raised **30 → 45** (2.1× over 21, against 1.4×
before). Cap stays 60, now described as ~2.9× rather than "about four times".

### Finding 2 (low, and sharper than its rating)

The sweep record rejects the non-retryable alternative *because* nothing asserted attempt count — and
the new elapsed-time bound is one-sided, so it would not catch that either. `stubMediaOkVenuesDown`
now counts venue attempts and the test pins three.

### Findings 3 and 4 (low) — both self-search defects in the guard this branch widened

**3.** The declaration stripper's replacement literal was matched by its own pattern, blanking a span
of the guard's own source. Not cosmetic: demonstrated below.

**4.** The `PLATFORM-875` alternation arm matched nothing while the witness was satisfied by the live
`PLATFORM-861:` citation. Dropped rather than back-filled — an arm whose necessity and exercise are
not the same condition is coverage that reads as present and checks nothing.

### Found during remediation, by the guard itself, twice

The re-measured docblock cites a test across a `/** */` line break, and `flatten` stripped only
line-comment continuations — so the extracted name carried a literal `*` and the guard refused it. The first
attempt to explain that quoted a **truncated** name, which is the #872 round-1 defect reproduced
while documenting it. `flatten` now strips both continuation markers; that arm needs no separate
control, because a wrapped block-comment citation reddens the guard if the stripping stops working,
and with no such citation the arm is unneeded — necessity and exercise coincide, which is exactly
what finding 4's dead arm lacked.

## 7. Mutations — every claim reddened its own named assertion

| mutation | assertion that fired |
| --- | --- |
| drop `'setTimeout'` from the mocked APIs | `:304` the `tickUntilSettled` cap — **not** the real-clock check |
| 700 ms real sleep inside the measured window | `the run spent 726.8 ms of REAL wall clock …` |
| blind `STALENESS_READ_FRAME` | `the clock really was driven, before the loop` |
| venue provider succeeds | `and it ran with the venue leg genuinely owed …` |
| `governed = true` in `route.ts` | `the first year is ungoverned and runs whatever the clock says` |
| `maxAttempts: 1` in `schedulePresentationRefresh.ts` | `the venue leg really ran its three bounded attempts …`, `1 !== 3` |
| `MAX_STALL_TICKS = 30` | `the cap must stay clear of measured demand (worst last-fire index 21 …)` |
| narrow the alternation to `#872` only | `the widened extraction found no PLATFORM-* citation …` |
| revert `flatten` to `//`-only | `a comment cites a test that does not exist …` with a `*` in the name |
| dangling citation in prose | `a comment cites a test that does not exist …` |

**Two entries carry a lesson rather than a green tick.**

**Dropping `'setTimeout'` does not redden the real-clock assertion.** The tick loop exhausts its
ticks in microseconds while the real sleeps are still pending, so the *cap* fires first — by name,
which is acceptance 2 working. But it means that mutation does not prove acceptance 1; the injected
real sleep does. Stopping at the first would have been a false coverage claim.

**The `maxAttempts: 1` mutation reddens ONLY the new attempt-count assertion.** The timing bound and
`provider-fetch-failed` both stay green — which is finding 2's gap, reproduced and then closed.

**Findings 3's fix is not mutation-detectable on its own**, because the blanked span currently holds
only code. The hazard was demonstrated directly instead: the same dangling citation placed in that
span is **caught** with the fixed replacement and **missed** with the old one.

| declaration-strip demonstration | result |
| --- | --- |
| fixed replacement + dangling citation in the blanked span | `not ok 13` — caught |
| old self-matching replacement + the same citation | `ok 13` — **blind** |

## 8. Verification

Every gate its own command, its own exit code, at the final tree. `npm test` and `lint:all` were
re-run **after** Prettier reformatted the file, because this file's guard reads its own source.

| gate | exit |
| --- | --- |
| `npx tsc --noEmit` | 0 |
| `npm test` | 0 — 5599 pass, 0 fail, 0 cancelled |
| `npm run lint:all` | 0 |
| `npm run test:clock-shift -- 0` | 0 — 5599 pass |
| N=40 `test:file` corroboration | 40/40 exit 0 |

## 9. Residuals

- `PLATFORM-861: a year IS admitted at exactly the both-legs boundary` keeps 714–904 ms by ruling,
  documented in-file with the rejected alternatives.
- The 56 `Date`-only enables in `rankings/__tests__/` are **unmeasured**.
- `MIN_REAL_BACKOFF_MS` and `STORE_READ_WORST_CASE_MS` both restate unexported production constants
  and will not redden when those change.
- Node's file-level timeout remains uncontrollable from inside a test. This slice reduces its
  reachability and does not remove it.
