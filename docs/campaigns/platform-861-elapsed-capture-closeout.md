# PLATFORM-861 — the budget decided on a stale elapsed time (closeout)

Status: Implemented and gated; pre-merge closeout, not a deployment claim.
Prompt: `PLATFORM-861-ELAPSED-CAPTURE-CLAUDE-v1`.
Branch: `claude/861-elapsed-capture`.
Base: `844b05b735ace4d9785ea57dcb308c61037f7f04`, which was also the merge-base at review time.
**CORRECTED by PLATFORM-866:** this line said `main` did not move while the branch held. It did —
`cafaf948` landed at 00:33 on 2026-09-24 and was merged into the branch at `c77dd225` 01:15, and that
merge is the second parent of the merge commit. The claim was true when written at 21:30 and stale by
merge time, which is the condition-1b class: the pre-closeout `git pull` happened and the sentence it
invalidated was not revisited.
Implementation: `6f2c8f5a`, then `900165f9` (runbook §8i) and one remediation commit.

This is 757a's own closing-round finding, self-reported, and it gated installing the §8i schedule.

---

## The defect and the fix

`src/app/api/cron/schedule-presentation/route.ts`'s per-year admission check reused an `elapsedMs`
captured **before** `await venueRefreshDue()`. That read costs **at least** roughly 60s under
PLATFORM-625 rather than zero, so under a degraded store the check could under-count elapsed by 60s
or more at exactly the moment it decides whether another year fits.

**~60s, AND THIS SECTION SAID 15s — CORRECTED BY PLATFORM-866.** One `getAppState` on the database
path composes FOUR sequential 15s bounds, not one: `getPool().connect()` at
`connectionTimeoutMillis`, `openBoundedTransaction` at `APP_STATE_OPENER_TIMEOUT_MS`, the statement at
`statement_timeout`, and the `commit`, which carries the same bound because `APP_STATE_BOUNDED_BEGIN`
sets it with `SET LOCAL`. The 15s figure was inherited from the `JOB_BUDGET_MS` docblock, which names
two of those constants in one breath and composes neither.

**And ~60s is a FLOOR, not a ceiling** — three of the four legs are server-side `statement_timeout`s,
which `appStateStore` itself describes as *"DETECTION, not a tight bound"*, and a timed-out `commit`
leaves the catch's `rollback` running unbounded. Review caught that second over-claim after the first
correction had already shipped.

Worked case: the capture reads 8s with the venue leg owed, `8 + 242 = 250` admits, and the year
begins at ~68s and ends near **310s — past the 300s `maxDuration` ceiling.**

| under-count | year starts | year ends | vs the 300s ceiling |
| --- | --- | --- | --- |
| 15s (as first recorded) | ~23s | ~265s | 35s of margin |
| 45s (three bounds counted) | ~53s | ~295s | 5s of margin |
| **60s (composed)** | **~68s** | **~310s** | **breached, and 60s is a floor** |

**So the pre-fix behaviour was not "bounded margin erosion", which is what this closeout and #861
both originally claimed.** In the worst case it could run the function past its own ceiling and lose
the receipt — #757's failure reproduced inside the job built to prevent it. The fix removes it:
re-measuring makes elapsed read ~68s, `68 + 242 > 250`, and the year is correctly skipped. **This is a
correction to the RECORD, not a live defect.**

**The error does not compound.** The capture is inside the loop, so each iteration re-reads the clock
and picks up all prior elapsed time, including earlier venue reads. It is one bounded read per
admission decision, at least ~60s, once.

The fix is one line: a fresh `Date.now()` for the admission check only. The cheap pre-check keeps its
pre-read value, because that check exists so a run which cannot afford a year under **any** answer
does not spend a bounded read discovering which answer it would have got — itself 757a round 4,
finding 2.

### A fresh measurement is correct on every path, which is why it is one line

If the pre-check failed, `reservationMs` is `YEAR_WORST_CASE_MS` and `elapsed + 121 > 250` already
held, so a larger fresh value still skips — the same outcome. If `governed` is false, both conditions
short-circuit before the elapsed term is used at all. No branch needed the stale value preserved, so
no conditional was required.

## Why re-measuring is safe where inflating the reservation is not

The adjacent fix was implemented during 757a round 4 and **reverted**: folding a 45s store allowance
into the reservation makes an owed venue leg reserve 287s against a 250s budget, so no second year
could ever be admitted at any elapsed time — round 1's starvation exactly. The record is the
`// NOT A CONSTANT` note at `route.ts:167-183`, below `JOB_BUDGET_MS`, **not** the docblock above it
that merely points at the note. (The prompt cited `:140-165`; the correction was accepted at receipt.)

This change is different, and the difference is the whole argument:

- **The reservation is unchanged.** Still 242s at most — `YEAR_WORST_CASE_MS + VENUE_LEG_WORST_CASE_MS`
  = `121_000 + 121_000`, both `3 × 40s + 1s` — against a 250s budget, with 8s of margin. The
  condition that caused starvation, a reservation larger than the whole budget, cannot arise.
- **It changes the measurement, not the promise.** A fresh read can only make elapsed larger, and
  larger means a year that genuinely does not fit is skipped rather than admitted.
- **The first year is unaffected either way.** It is ungoverned, so it always runs. Starvation was
  only ever about later years.
- **With a healthy store the re-read changes nothing**, because the await returns in milliseconds.

The arithmetic still does not close, and that stays settled rather than reopened: a year owing both
legs plus any meaningful store term cannot be guaranteed under a 300s ceiling at any budget. The
budget governs CFBD time, the store waits stay bounded by #625, and the residual is documented.

## The two tests that caught the reverted store term — NAMED, because 757a's closeout did not

757a's closeout says "two existing tests failed the moment it went in" and **names neither**.
Recovering them cost this slice a measurement: re-applying the 45s mutation, running the two files,
reading which assertions fired, and reverting to a clean tree. They are recorded here so no one pays
that again.

| test | file | assertion that fired | arm |
| --- | --- | --- | --- |
| `the venue obligation comes from the CATALOG, not from a year that skipped the leg` | `__tests__/route.test.ts:563` | `both years run — nothing here is short of time` | **owed** (287s > 250s, starvation proper) |
| `ROUND 3 #1: a comfortably fresh catalog owes nothing, so a later year is judged on ONE leg` | `__tests__/stall.test.ts:353` | `so the second year is judged against one leg, and runs`, `1 !== 2` | **unowed** (inflated to 166s, clock-driven) |

They cover **both arms of the reservation**, which is why they are the regression net for this area:
a net that caught only starvation would miss half the mutation. Both pass unchanged on this branch.

## How the tests make a durable read slow, and why that took a detour

The defect is invisible with a healthy store — `venueRefreshDue()` returns in milliseconds, so a
value captured before it and one captured after it are the same number. **A fixture whose venue read
resolves immediately proves nothing and passes identically before and after the fix.** The read has
to be made slow enough to cross the admission boundary.

Nothing in `appStateStore` can inject latency. Its seams cover read failure, lock failure, commit
failure and pool substitution; a repo-wide search found no timing seam anywhere. Adding one would
widen this slice into a module the whole app shares. `t.mock.module` is unavailable — the runner
spawns `--import tsx --test` with no module-mocks flag, and changing its argv would break
`testRunner.test.ts`'s argv contract.

**The seam that already exists:** the file-fallback store calls `fs.readFile` on `node:fs`'s
**mutable** `promises` object, so a test can wrap it and advance the mock clock for the duration of
one read. `t.mock.timers.tick` is synchronous, so ticking before delegating to the real `readFile`
puts the whole advance inside the awaited read — where production spends it. **No production code
carries a timing hook.**

**Keyed on the calling frame, not a read index.** Measured: a two-year run makes 28 store reads and
exactly **one** carries a `venueRefreshDue` frame — the governed year's, because an ungoverned year
skips the read entirely, which is what the source claims. Keying on the index would bake that count
into the fixture, so any change to the job's store traffic would move the latency onto a different
read and quietly stop testing the claim.

### The fixture's timing, and why it crosses

The margin with both legs owed is **8s** (`250 − 242`). A degraded store read is worth **~60s or
more**
(four composed 15s bounds; none of the four constants is exported, so the test restates the figure and
says so). The defect's whole reachability argument is that **one read outweighs the margin**. Elapsed
reaches the governed year's capture at 0, the read costs ~60s, and `60 + 242 = 302 > 250`.
PLATFORM-866 raised the fixture from 15s to 60s; both cross the 8s boundary, so the tests passed
either way — which is exactly why the wrong figure survived review twice.

`Date` is mocked and **anchored to real time** (`now: t0`) — the trap 757a recorded, where
`mock.timers.enable` starting `Date` at 0 makes every stored `at` look astronomically far in the
future, the catalog reads infinitely fresh, and both sides of a mutation stay green. Nothing advances
the clock except the read under test, so the capture is deterministically 0.

## Verification

Each gate its own command, real exit code, on the remediated tree:

- `npm test` — 5577 pass, 0 fail, **exit 0**
- `npm run lint:all` — **exit 0**
- `npx tsc --noEmit` — **exit 0**
- `npm run lint:markdown` — **exit 0**

**The new tests fail against `main`'s actual `route.ts`**, not merely against a hand-reverted form:
main's file was checked into the tree and the suite run — the slow-read test and the one-millisecond
boundary test fail, the rest pass, and the tree was restored.

### Mutation coverage

Every claim has a mutation that reddened its own named assertion:

| mutation | assertion that fired |
| --- | --- |
| revert the fix (`admissionElapsedMs` → `elapsedMs`) | `the slow read is charged to the year it precedes, so 2027 is skipped` — `2 !== 1` |
| drop the cheap pre-check guard | `the durable read was never attempted for a year that cannot fit` — `1 !== 0` |
| `governed = true` | `the first year is ungoverned and runs whatever the clock says` — `0 !== 1` |
| `>` → `>=` | `exactly 250s of promise is still a promise the job can keep` — `1 !== 2` |
| `JOB_BUDGET_MS` 250s → 251s | `one millisecond over the budget is over the budget` — `2 !== 1` |
| reintroduce the dangling test citation | `route.ts cites a test that does not exist in stall.test.ts: …` |

Reverting the fix does **not** redden `a year IS admitted at exactly the both-legs boundary`, and
that is correct rather than a gap: at 8s both the stale and the fresh value admit, so that test is a
lower-bound pin and not a discriminator. `/code-review` independently reproduced the same
discrimination pattern.

Because `JOB_BUDGET_MS`, `YEAR_WORST_CASE_MS` and `VENUE_LEG_WORST_CASE_MS` are **not exported**,
acceptance 4 is pinned behaviourally by a boundary pair — admitted at exactly 8s, skipped one
millisecond later — which fixes `250 − 242 = 8` and the strict `>` jointly. The last two mutations
above are that pair's positive controls.

## Review provenance

Both reviewers ran against the same commit, `900165f9`, and both were gathered before any
remediation.

- **`/code-review 900165f9 high`** — four findings: one medium (a dangling test citation), three low
  (stale self-referential line numbers, the §8i clearance tied to nothing observable, and a
  cross-document contradiction in planning's queue). All four accepted.
- **`/codex:review --base 844b05b7`** — clean, no actionable regressions. Verified before being
  treated as gathered: **exit 0**; no capacity-failure sentence in the body; and the transcript's
  `git diff` invocations carry the 12-hex prefix `844b05b735ac`, so it diffed the intended
  merge-base rather than a base derived from whatever branch happened to be checked out.

`--base` was passed the real merge-base, confirmed with `git merge-base --is-ancestor` against
`origin/main` — a true merge-base is an ancestor of `origin/main`, a branch commit is not.

## Remediation — one round, and one lesson worth more than the fix

Findings 1 and 2 were comment defects in the very comment block that carries this slice's reasoning.

**Finding 1 is a repeat of a pattern already on file:** the comment cited a test name
(`the admission boundary is 8s of elapsed with both legs owed`) that existed **only in the comment**.
The binding rule is that a comment asserting runtime behaviour names the test asserting the same
thing, and this branch violated it inside the comment that invokes it. A dangling name is worse than
no name: the reader greps, finds nothing, and cannot tell whether the test was deleted, renamed or
never written.

**Finding 2 was self-inflicted by the same edit:** the comment cited `:421` four times, and the five
comment lines it itself added pushed that capture to `:426`. The fix refers to `elapsedMs` **by
name** rather than by line number, because a self-reference an edit can invalidate is the same defect
class as the `above`/`below` misdirection this slice was authorized to correct.

### The guard for finding 1 was vacuous on its first attempt, and how is the point

A test was added asserting every `PLATFORM-861:` name cited in `route.ts` resolves. Its first version
searched the whole **text** of the test file — and the mutation that should have reddened it passed,
because **the guard's own comment quotes the dangling name in order to explain it.** Quoting the
mistake reproduced it: the same shape as `CLAUDE.md`'s rule that writing about a closing keyword
fires the parser again.

The fix stops keying on the file's text and keys on the quantity the check is about: the set of names
`test(...)` **declares**. A citation resolves when a test by that name exists, not when the string
appears somewhere in the file — prose, however careful, is not a test. The guard also carries its own
positive control, asserting the extraction saw at least ten declarations, so a pattern that stopped
matching would fail loudly instead of passing everything.

## §8i — the gate's condition is PROMOTION, and the predicate is runnable

The owner's ruling was convert-don't-delete, compressed, ending "the upsert above has no outstanding
blocker" and citing the fix commit's SHA. That wording was applied in `900165f9`, and `/code-review`
then found a real hole in it: **`upsert --apply` runs against production and auto-promotion is off**,
so between merge and promotion the schedule can be installed while production still serves the
pre-fix job — precisely the exposure the gate existed for. The old wording gave a checkable predicate
("while #861 is open"); "no outstanding blocker" does not, and the next paragraph still assumes
promotion precedes the command.

The section was re-tied to **promotion** and flagged as a deviation rather than taken silently.
**The owner accepted it and named their own wording as the error**, against the binding *merged is
not live* rule: a production gate discharged on the merge event violates it.

**Then amended once more, because the first predicate could not be run.** The deviation said to
`vercel inspect` the production deployment — and `vercel inspect` prints **no commit SHA** (id, name,
target, status, url, created, aliases, builds, and nothing else; verified independently on
2026-09-23). A gate whose check cannot be evaluated is the shape that gets skipped, which would have
reintroduced the problem the deviation existed to fix. §8i now carries a two-step check, both halves
verified end to end and dry-run as written:

1. `vercel inspect turfwar.games` for the deployment **the alias serves** — authoritative per §4. A
   target listing is not: with auto-promotion off, the newest READY production deployment may be
   unpromoted, so "latest production deployment" and "what is being served" are different questions.
2. That deployment's `meta.githubCommitSha` from `https://api.vercel.com/v13/deployments/<id>?withGitRepoInfo=true`
   — `withGitRepoInfo=true` is what populates `meta` — then `git merge-base --is-ancestor 6f2c8f5a <sha>`.

`--is-ancestor` rather than SHA equality is the point: it answers "is the fix in what production is
serving", which equality would get wrong for every later promotion. **Dry-run at closeout time it
correctly reported NOT PROMOTED**, production serving `d3874dc6` (757a's merge) — a positive control
that the gate can answer no, not only yes.

## Known limitations and what is NOT claimed

- **Not deployed.** Merging is not promoting; auto-promotion is off. This closeout claims gates and
  review, not production behaviour.
- **~60s is a floor, not a ceiling**, and the fixture models the cheapest degraded read rather than
  the worst one. See #866.
- **The ~60s figure is restated, not imported.** None of the four bounds
  (`connectionTimeoutMillis`, `APP_STATE_OPENER_TIMEOUT_MS`, `statement_timeout` and the `SET LOCAL`
  it rides on) is exported from `appStateStore`, so a change to any of them would not redden these
  tests. The fixture's comment says so. This is the weakness that let 15s stand.
- **The boundary pair pins the arithmetic, not the literals.** The three constants are unexported, so
  the tests fix `250 − 242 = 8` behaviourally; a change that preserved that difference would pass.
- **The citation guard proves resolution, not correctness.** It cannot tell whether a cited test is
  the *right* test for the claim. It closes the failure mode that actually occurred.
- **`docs/next-tasks.md:290` still says installing §8i is gated on #861.** Planning's file and a
  post-merge flip per the owner's ruling, so it is deliberately not in this branch. Until planning
  updates it, the queue and the runbook disagree, and `/code-review` flagged that as shipped state.
- **The `fs.readFile` wrapper is a test-side monkeypatch** on a Node builtin namespace object. It is
  restored in `afterEach`, but it is a sharper instrument than a purpose-built seam would be. A store
  latency seam remains the cleaner long-term answer and was left out of scope deliberately.
