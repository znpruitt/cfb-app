# PLATFORM-866 — the bounded store read costs ~60s, not 15s (closeout)

Status: Implemented and gated; pre-merge closeout, not a deployment claim.
Issue: [#866](https://github.com/znpruitt/cfb-app/issues/866). **No prompt file** — the owner filed
the issue from the post-merge review of #861 and authorized the slice directly, so no `PROMPT_ID` was
assigned and none is invented here.
Branch: `claude/866-store-read-cost`, off `origin/main` at `41652614`.

**No production behaviour changes.** Every edit is a comment, a test, or a document. The #861
behavioural line is unchanged and was independently confirmed correct on every path by the post-merge
reviewer.

---

## Why this exists

`/code-review 41652614` — a post-merge review of #861's merge commit — returned five findings, all
reproduced here before being accepted. Four are defects in #861's own comments, tests and ledger. The
fifth is a figure that was wrong before #861 started and which #861 propagated into five places.

## 1. The store-read cost: 15s → ~60s, and the severity crosses a threshold

**One `getAppState` on the database path composes FOUR sequential 15s bounds**, verified in
`queryBounded` (`src/lib/server/appStateStore.ts:656-692`):

| step | bound | where |
| --- | --- | --- |
| `getPool().connect()` | `connectionTimeoutMillis: 15_000` | `appStateStore.ts:399` |
| `openBoundedTransaction` | `APP_STATE_OPENER_TIMEOUT_MS = 15_000`, its own `Promise.race` | `:586`, `:612-628` |
| `client.query(text, values)` | `statement_timeout = 15_000` | `:471`, `:536` |
| `client.query('commit')` | **the same `statement_timeout`** | `:536` |

The fourth is the one both earlier passes missed. `APP_STATE_BOUNDED_BEGIN` sets the timeout with
`SET LOCAL`, and LOCAL holds to the end of the transaction, so the `commit` is bounded exactly as the
statement is. **~60s, not 15s and not 45s.**

### It moves the severity twice, both upward, and past the ceiling

| under-count | year starts | year ends | vs the 300s `maxDuration` |
| --- | --- | --- | --- |
| 15s (as #861 recorded) | ~23s | ~265s | 35s of margin |
| 45s (three bounds counted) | ~53s | ~295s | 5s of margin |
| **60s (composed)** | **~68s** | **~310s** | **breached** |

**So the pre-fix defect was not "bounded margin erosion with no traced case breaching 300s."** In the
worst case it could run the function past its own ceiling and lose the receipt — which is #757's
failure reproduced inside the job built to prevent it.

**#861's fix removes it.** Re-measuring makes elapsed read ~68s, `68 + 242 > 250`, and the year is
correctly skipped. **This corrects the record, not a live defect.** Stated plainly because a severity
revision on a shipped fix invites the opposite reading.

### Provenance, which is the reusable part

The 15s came from the `JOB_BUDGET_MS` docblock — *"PLATFORM-625 bounds each at 15s
(`APP_STATE_STATEMENT_TIMEOUT_MS`, `APP_STATE_OPENER_TIMEOUT_MS`)"* — which names two 15s constants in
one breath and composes neither. It travelled from there into #861's issue body, its prompt, its
source comments, its test constant and its closeout. **That docblock sentence is corrected here**,
explicitly authorized as the source of the error; nothing else pre-existing was touched.

This is *never invent figures* in its quieter form: not a fabricated number but an **unverified
inherited one**, and it is more dangerous precisely because a figure that comes from the repo reads as
sourced. The lane that consumed it did not compose it either — it derived 45s later, which was closer
and still wrong, by counting three bounds and stopping.

**Why review did not catch it:** the fixture value crosses the admission boundary at 15s and at 60s
alike (both exceed the 8s margin), so every test passed either way. A wrong constant that is still
wrong in the safe direction produces no red.

## 2. The absence assertion had no witness

`'a year that cannot fit under ANY answer costs no durable read'` asserts `venueReads.reads === 0`.
The counter increments only when a captured stack carries the frame name, so **"the read never
happened" and "the probe cannot see reads" rendered identically.** Reproduced: blinding
`VENUE_READ_FRAME` reddened the three neighbouring tests and **left this one green**. Its siblings
carry implicit controls (`reads === 1`, `reads >= 1`); an absence assertion cannot.

Two additions, because one was not enough:

- **A witness probe** on `mediaObservedAtMs`, a frame the run must reach, with a **zero** advance so
  it changes no timing. If the mechanism stops seeing reads, the witness goes to zero and says so.
  The installer became a **stack** rather than a single slot so two probes can coexist and unwind in
  reverse.
- **A static check** that `VENUE_READ_FRAME` names a real function in `route.ts`. The witness proves
  the mechanism works; it does not prove the frame name is right — blinding only that constant still
  left the test green, because zero is what it expects. The neighbours pin the name, but relying on
  them makes this test silently dependent on tests a future reader might delete.

Both proven: blinding both frames reddens it on the witness message; blinding only the venue frame
reddens it on the static check. **The reviewer's exact mutation now fails.**

## 3. Two stale `:421` citations in the test file

The #861 remediation moved `route.ts`'s self-references from line numbers to names, and documented at
length why — then left two `:421` citations in `stall.test.ts:575` and `:578`, pointing at a bare
`//`. **The fix was applied to one half of the defect it described.** Now by name.

## 4. The §8i gate's broken state read as its safe state

`git merge-base --is-ancestor … && echo "PROMOTED"` had no else branch, and `dpl`, `tok` and `sha`
were unchecked. A missing token, an API error, an `awk` that matched nothing, or a commit not fetched
into the local clone all exited non-zero **silently — the same output as an honest "not promoted."**
Written in the same session that recorded that shape in `AGENTS.md`.

Now every step fails loudly and distinctly, with `CHECK BROKEN` separated from `NOT PROMOTED`, plus a
`git fetch` and an existence check before the ancestry test. **All three paths dry-run as written:**

- happy path → `NOT PROMOTED (d3874dc6…) — gate holds`, exit 0 (correct; the fix is not promoted)
- unreachable alias → `CHECK BROKEN: no deployment id from vercel inspect`, exit 1
- unfetchable SHA → `CHECK BROKEN: … is not in this clone even after fetch`, exit 1

## 5. The #861 closeout's Base line was false in the merged tree

It claimed `main` did not move while the branch held. `cafaf948` landed at 00:33 and was merged into
the branch at `c77dd225` 01:15 — that merge is the merge commit's second parent. True when written at
21:30, stale by merge time. The condition-1b class in its subtler form: **the pull happened, and the
sentence it invalidated was not revisited.** Corrected in place rather than deleted.

## Verification

Each gate its own command, real exit code, on this tree:

- `npm test` — see the figures in the commit message; exit 0
- `npm run lint:all` — exit 0
- `npx tsc --noEmit` — exit 0
- `npm run lint:markdown` — exit 0

### Mutations

| mutation | assertion that fired |
| --- | --- |
| blind both frame constants | `the frame probe can see durable reads in this run (witness saw 0)…` |
| blind only `VENUE_READ_FRAME` | `venueRefreshDueXX_BLIND_PROBE is not a function in route.ts…` |

The #861 mutation set is unchanged and still passes; raising `STORE_READ_WORST_CASE_MS` from 15s to
60s does not alter any of its outcomes, because both figures exceed the 8s margin. **That invariance
is the finding, not a reassurance** — it is why the wrong value survived two reviews.

## Known limitations and what is NOT claimed

- **Not deployed.** Merging is not promoting.
- **The ~60s figure is still restated, not imported.** None of the four bounds is exported from
  `appStateStore`, so changing any of them will not redden these tests. This is the same weakness
  that let 15s stand, and naming it is the only mitigation available without widening scope into the
  store's public surface. **A follow-up that exports a single composed
  `APP_STATE_READ_WORST_CASE_MS` would close it properly.**
- **~60s is a composition of documented bounds, not a measured latency.** No degraded-store run was
  observed taking 60s; the claim is that the code permits it, which is what a worst case is.
- **The `commit` bound is inferred from `SET LOCAL` semantics**, verified by reading
  `APP_STATE_BOUNDED_BEGIN` and PostgreSQL's documented behaviour for LOCAL, not by observing a
  timed-out commit.
- **The static frame check is a source-text assertion.** It proves the name exists, not that the
  runtime stack will carry it; the witness covers the runtime half.
- **`docs/next-tasks.md` is untouched** — planning's file, per DOCS-012.
