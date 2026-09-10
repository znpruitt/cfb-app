# Item 209 — the pid-keyed app-state test store, and the suites that inherit it

Status: Input record for Item 209 (blocked behind Item 210)
Last verified: 2026-09-10
Owner: Project documentation
Canonical for: the measured exposure list Item 209 has to close, and how it was measured
Supersedes: (none)

Written by the Item 207 implementation lane at closeout. Item 207 fixed three suites; this
records the ten it deliberately did not, and why the remedy moved to the harness.

---

## The mechanism

`appStateStore.ts:95-97`:

```ts
if (process.env.APP_STATE_TEST_ISOLATION === '1') {
  return path.join(os.tmpdir(), `cfb-app-app-state-test-${process.pid}.json`);
}
```

**Nothing ever unlinks that file.** `__resetAppStateForTests()` clears pools and seams but not the
file; no process removes it at exit. 14,022 of them were on the implementation machine at the time
of writing, oldest 2026-09-05, and the owner independently counted 14,042 on his.

macOS recycles pids. A test process can therefore start life owning a previous suite run's entire
durable store — every scope, every key, written by a different test file. Measured across six
instrumented full-suite runs: **260 of 1,086 processes (23.9%) started with a pre-existing file at
their pid path.**

Item 207's symptom was four polling-planner tests intermittently reading `plan-held`, because 394 of
the stale files carried a `provider-refresh-settings::global` record holding both planner jobs and
that suite's `reset()` cleared every scope except the settings one. The failure was reproduced 20/20
by planting exactly that file, and 0/20 after the fix. See the PLATFORM-207 registry entry.

---

## How the exposure was measured

The obvious method — grep for suites calling `__resetAppStateForTests` without
`__deleteAppStateFileForTests` — is **structurally blind to suites that reset nothing at all**, which
is how the first pass missed the two draft suites. It was replaced with a probe that cannot have that
blind spot:

> Plant an **unparseable** app-state file at the process's pid path before any module loads, then run
> the suite. `readFileStore` propagates a parse error by design, so any suite that actually reads the
> file-fallback store fails; any suite that never touches it is unaffected.

Run against **every** test file, with a control arm (same file, no plant) to separate pre-existing
failures.

**Coverage, stated as part of the result:** 389 files probed, 389 rows returned, **0 rows that ran
zero tests**, 5,105 tests executed — exactly the full suite's 5,105. An earlier pass of this same
probe silently ran zero tests for the 23 App Router paths containing `[brackets]`, because
`node --test` treats them as globs and exits 0 — indistinguishable from a pass. Brackets are now
escaped the way `scripts/run-tests.mjs` escapes them, and the zero-test row count is reported so that
failure cannot recur unnoticed.

**What the probe proves, and what it does not.** A corrupt payload is maximally hostile: it proves
the suite reads the store and therefore **inherits**. It does **not** prove that a realistic
inherited payload would flip any assertion in that suite. Structural exposure is measured; live flake
rate is not, and no rate should be quoted for these ten.

---

## The ten suites Item 209 has to close

Each fails under a corrupt inherited store and passes clean.

| Suite | fails / ran |
| --- | --- |
| `src/lib/__tests__/oddsUsageStore.test.ts` | 8 / 8 |
| `src/lib/server/__tests__/schedulerDeliveryHealth.test.ts` | 9 / 36 |
| `src/lib/__tests__/durableOddsStore.test.ts` | 5 / 5 |
| `src/app/league/[slug]/draft/__tests__/draftSchedule.test.ts` | 5 / 5 |
| `src/lib/__tests__/teamDatabaseStore.test.ts` | 4 / 4 |
| `src/app/league/[slug]/draft/board/__tests__/boardData.test.ts` | 3 / 3 |
| `src/app/api/admin/odds-usage/__tests__/route.test.ts` | 2 / 2 |
| `src/app/api/__tests__/admin-debug-auth.test.ts` | 1 / 12 |
| `src/components/admin/systemHealth/__tests__/deliveryNothingDue.test.ts` | 1 / 7 |
| `src/lib/insights/__tests__/seasonOwners.test.ts` | 1 / 6 |

Three further suites were exposed and were fixed by Item 207 — `polling-planner`, `usage-sample` and
`pollingPlannerRecordWrite` — so the original exposed population was thirteen.

`src/app/api/odds/__tests__/writer-convergence.test.ts` fails 2 tests in **both** arms. That is the
standing Item 137 baseline, not exposure.

`src/lib/server/__tests__/providerUsageWriteOutcome.test.ts` is a **grep false positive**: it calls
`__resetAppStateForTests` only as pool teardown, every test runs against `FakePool` or is a pure
function, and it passes under the corrupt plant. A backing-file delete there would be a no-op. The
file carries a comment saying so.

---

## Why the fix is the harness, not ten more call sites

Item 207 fixed its three suites with the repo's existing idiom — `await
__deleteAppStateFileForTests()` before `__resetAppStateForTests()`, already in 136 of 139 app-state
suites. Propagating that to the remaining ten was **rejected by owner decision 2026-09-10**, on the
Item 210 ground rather than the fragility ground:

**`__deleteAppStateFileForTests` is not file-scoped.** `appStateStore.ts:1318-1321` branches on
`hasDatabaseConfig()` — the presence of `DATABASE_URL` — not on `APP_STATE_TEST_ISOLATION`, and runs
`delete from app_state` against the live pool. `scripts/run-tests.mjs:89-91` spreads
`...process.env`, so the isolation flag is set while an ambient `DATABASE_URL` passes straight
through, and `CLAUDE.md` documents that every worktree carries a production read-**write**
`DATABASE_URL` in `.env.operator.local`. `app_state` is the only table. 136 files already call the
seam, so an exported production URL wipes it at the first suite that resets — pre-existing, broad,
and older than any of this. **You do not generalise a destructive call the same hour you learn it is
destructive.**

Sequencing, owner decision 2026-09-10:

1. **Item 210** — make the seam safe (an `APP_STATE_TEST_ISOLATION !== '1'` refusal inside it, or
   equivalent). Next platform item.
2. **Item 209** — a per-run-unique backing-file path plus exit cleanup, which closes all ten at once
   and makes every future suite safe by default rather than by its author remembering an idiom.
3. Only then, if still wanted, the per-suite deletes as belt-and-braces.

Item 208 — separating "settings unreadable" from "operator held everything" on the polling-planner
route — is unrelated to this file and sequenced after 210.
