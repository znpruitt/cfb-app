# PLATFORM-866 — the bounded store read costs ~60s, not 15s (closeout)

Status: Implemented and gated; pre-merge closeout, not a deployment claim.
Issue: [#866](https://github.com/znpruitt/cfb-app/issues/866). **No prompt file** — the owner filed
the issue from the post-merge review of #861 and authorized the slice directly, so no `PROMPT_ID` was
assigned and none is invented here.
Branch: `claude/866-store-read-cost`, off `origin/main` at `40ab8485`.
**CORRECTED in round 2:** this said `41652614`, which was `origin/main` when #861 merged but not when
this branch was cut — `main` had advanced to `40ab8485` in between. `54a00f71^` and
`git merge-base HEAD origin/main` both give `40ab8485`, and this document's own review line
(`--base 40ab8485`) contradicted its Base line. **That is precisely the class §5 below corrects
in the #861 closeout**, committed in the same breath as the correction.

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
statement is. **~60s, not 15s and not 45s** — and, per review round 1 below, **~60s is itself a FLOOR
rather than a ceiling**, because three of the four legs are server-side timeouts whose error packet may
never land and a timed-out `commit` leaves the catch's `rollback` unbounded.

### What the under-count costs, and what it does NOT

| under-count | year starts | + 242s of CFBD time ends at |
| --- | --- | --- |
| 15s (as #861 recorded) | ~23s | ~265s |
| **60s (composed)** | **~68s** | **~310s** |

> **THE THRESHOLD FRAMING WAS WRONG, AND REVIEW ROUND 2 FOUND IT.** These ends add 242s of **CFBD
> time only**, which the `JOB_BUDGET_MS` docblock states explicitly. The same degradation that makes
> the admission read cost 15s or 60s also applies to the year's own dozen sequential store round
> trips, which at these rates add hundreds of seconds by themselves — so the 300s ceiling is reachable
> at **every** row, including 15s, and "35s of margin" / "5s of margin" were not margin. Counting
> store latency in the admission read while omitting it from the year's body is what manufactured the
> threshold.
>
> **What the under-count actually costs: the budget admits a year it was designed to refuse.** That is
> a budget-correctness defect and it is sufficient on its own; re-measuring fixes exactly it. Ceiling
> reachability under a degraded store is a SEPARATE, PRE-EXISTING residual — the first year is
> ungoverned so no admission check protects it, and the store terms are deliberately unreserved —
> which neither #861 nor #866 introduces or removes.

**#861's fix addresses exactly the budget-correctness half.** Re-measuring makes elapsed read ~68s,
`68 + 242 > 250`, and the year is correctly skipped.

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

Both proven, and **independently** — see round 1 below for the corrected mutation pairing, which is
the staleness frame alone for the witness and the venue frame alone for the static check. Blinding BOTH
fires the static check first, so "both mutations red" would have hidden that only one guard was under
test. **The reviewer's exact mutation now fails.**

## 3. Two stale `:421` citations in the test file

The #861 remediation moved `route.ts`'s self-references from line numbers to names, and documented at
length why — then left two `:421` citations in `stall.test.ts:575` and `:578`, pointing at a bare
`//`. **The fix was applied to one half of the defect it described.** Now by name.

## 4. The §8i gate's broken state read as its safe state

`git merge-base --is-ancestor … && echo "PROMOTED"` had no else branch, and `dpl`, `tok` and `sha`
were unchecked. A missing token, an API error, an `awk` that matched nothing, or a commit not fetched
into the local clone all exited non-zero **silently — the same output as an honest "not promoted."**
Written in the same session that recorded that shape in `AGENTS.md`.

Now every step fails loudly and distinctly, with `CHECK BROKEN` separated from `NOT PROMOTED`.

> **THIS SECTION ORIGINALLY CLAIMED "all three paths dry-run as written" AND REPORTED EXIT 1 FOR THE
> BROKEN PATHS. BOTH WERE FALSE**, and review round 1 below is where that is set out: the dry-run ran a
> retyped block with a plain `exit 1` under **bash**, on a **zsh** machine, so it verified a paraphrase
> in the wrong shell. The real text exited **0** on the broken path in a zsh script and fell through
> every guard when pasted into an interactive zsh. The gate is now a shell function with three distinct
> exit codes, re-verified by extracting it from the committed file and running it under both shells in
> both modes — the table is in round 1.

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

---

## Review round 1 — six findings, and two of them falsified claims this closeout had made

`/code-review 54a00f71 high` returned six findings; `/codex:review --base 40ab8485` was clean, verified
by exit code, body, and six transcript `git diff` lines carrying the base prefix `40ab8485b657`. Both
gathered before any remediation. All six accepted; all six reproduced first.

**Two of them contradicted this document**, which is the part worth reading:

### The dry-run claim was false, and that is how the gate defect survived

This closeout said the §8i gate's three paths "dry-run as written". **They did not.** The scratch
script substituted a plain `exit 1` for the runbook's `return 2>/dev/null || exit 1`, and ran under
**bash** on a machine whose shell is **zsh**. A paraphrase, in the wrong shell, reported as the
artifact.

What the real text does, measured: as a zsh **script**, the `CHECK BROKEN` branch prints its message
and the script **exits 0**, because a top-level `return` succeeds and `|| exit 1` never fires. Pasted
into an **interactive** zsh, `return` does not abort and execution **falls through every guard** to
the verdict line. So the gate written to separate "broken" from "not promoted" said `CHECK BROKEN` and
then exited as though fine — the same conflation, moved from the message into the exit code.

**A verification claim licenses the reader to stop checking.** This one was wrong in the direction
that mattered, on the one artifact in the slice an operator executes.

### ~60s is a FLOOR, not a ceiling — the correction over-claimed in the same direction as the error

`appStateStore` says so where it configures `keepAlive`: *"this is DETECTION, not a tight bound … it
closes the 'hangs forever' case, NOT the 'bounded at 15 s' case."* Three of the four legs are
server-side `statement_timeout`s, so if the error packet never lands the wait is the OS probe/retry
schedule. And `queryBounded` has a **fifth** round trip this document omitted: a timed-out `commit`
has already ended the transaction, reverting `SET LOCAL`, so the catch's `rollback` runs **unbounded**.

So "at most ~60s" was the same species of over-claim as "at most 15s", at a larger number. Corrected
to "at least". **It strengthens the ceiling-breach conclusion rather than weakening it** — which is
precisely why it was easy to miss: the error pointed the safe way.

## What the remediation changed

**The gate is now a shell function with three distinct exit codes** — `0` promoted, `1` not promoted,
`2` the check is broken. `return` inside a function behaves identically in bash and zsh, script or
sourced, which bare top-level guards do not.

**And rewriting it found a defect no reviewer had: `status` is a READ-ONLY special variable in zsh.**
The first version of the function declared `local … status` and assigned `status=$?`, which aborts with
*"read-only variable: status"* — the function did not run at all under zsh, in either mode. Found by
extracting the block from the committed file and running it, which is the method this round adopted
precisely because the previous round's paraphrase had hidden a defect. Renamed to `ancestry`.

**`--is-ancestor` exit 128 is no longer read as a verdict.** Measured: unresolvable object → **128**,
genuine not-an-ancestor → **1**, ancestor → **0**. The previous `if/else` folded 128 into "not
promoted". The status is now captured and `case`-matched, `1` alone means not promoted, and **both**
commits — the production SHA and the hardcoded fix commit — are existence-checked, since `git fetch`
does not deepen a shallow clone. On a `--depth 1` clone the old block would have reported "not
promoted" for a promoted fix.

**The witness probe is now installed FIRST.** Each probe wraps whatever `fs.readFile` already is, so
the one installed last is outermost and captures its stack one frame **shallower** than the probe it
wraps. The witness was last — a weaker observer than the one whose blindness it exists to rule out,
and stack truncation (a cause its own comment names) is exactly what hides a deep frame while leaving
a shallow one visible. Installed first it is innermost, and a true lower bound.

**The 45s attribution is sourced or dropped.** "A later pass derived 45s by counting three of the
four" was unsourced, and worse, collided with 757a's 45s store *allowance* — a chosen number, not a
composition. The route comment now names this closeout as the source and says explicitly that it is
not 757a's figure.

### Verification of the rewritten gate, done the way the failed claim should have been

Extracted from the committed `docs/deployment-runbook.md` by regex, run unmodified:

| shell / mode | scenario | output | gate exit |
| --- | --- | --- | --- |
| zsh script | healthy | `NOT PROMOTED (d3874dc6…)` | 1 |
| zsh sourced | healthy | `NOT PROMOTED (d3874dc6…)` | 1 |
| bash script | healthy | `NOT PROMOTED (d3874dc6…)` | 1 |
| zsh script | `vercel` broken | `CHECK BROKEN: no deployment id…` | 2 |
| zsh script | fix commit unresolvable | `CHECK BROKEN: … absent from this clone — shallow?…` | 2 |
| zsh script | `merge-base` returns 128 | `CHECK BROKEN: git merge-base exited 128, which is not a verdict` | 2 |

### Mutations, re-proven after the probe swap

| mutation | assertion that fired |
| --- | --- |
| blind `VENUE_READ_FRAME` only | `venueRefreshDueXX_BLIND is not a function in route.ts…` |
| blind `STALENESS_READ_FRAME` only | `the frame probe can see durable reads in this run (witness saw 0)…` |

The two guards are **independently** proven: the static check and the witness fire on different
mutations. Blinding both frames fires the static check first, which is why the staleness-only mutation
is the one that exercises the witness — a detail worth recording, because "both mutations red" would
otherwise have hidden that only one guard was being tested.

## Relay to planning — not a lane edit

**`docs/prompts/platform-861-elapsed-capture-claude-v1.md` still says "bounded at 15s under
contention" and "at most 15s, once", and `docs/campaigns/platform-757a-presentation-job-closeout.md`
carries the same figure**, both with no supersession marker. This closeout enumerates "its prompt" as
one of the five sites the figure travelled to, so leaving it unmarked contradicts this document.
**The two files are withheld for DIFFERENT reasons, and round 2 found that this section gave only
one.** `docs/prompts/` is planning's, like `docs/next-tasks.md`. But
`platform-757a-presentation-job-closeout.md` is in `docs/campaigns/` — **a directory this very commit
edits** — so "planning's file" was never the reason for it. The real reason is authorization: the
owner authorized exactly one pre-existing correction for this slice, the `JOB_BUDGET_MS` docblock, and
"nothing else pre-existing". Another slice's closeout is outside that grant, so it is relayed rather
than edited — and it still carries the 15s figure at several points, including a "265s against a 250s
promise, eating 15s of the 50s ceiling margin" line that #866 now contradicts twice over.

The earlier version of this section also named only `next-tasks.md` as deliberately untouched, which
implied the prompt had been handled. It had not.

---

## Review round 2 — six findings, and the headline conclusion was one of them

`/code-review 46bff0a6 high`. Six findings, two medium, all reproduced before acceptance. **Codex has
not reviewed `46bff0a6`**; only the round-1 Codex report at `40ab8485` exists, and it was clean.

Round 2 cleared, by its own re-testing: the four-bound composition and all five of its line citations;
the restore stack's LIFO unwinding; the witness-ordering argument; that `--base 40ab8485` is a real
merge-base; and that raising the fixture to 60s weakens no #861 assertion.

### The threshold claim was false, and it was this slice's headline

**`year ends` = `year starts + 242s`, and 242s counts CFBD time ONLY** — which the `JOB_BUDGET_MS`
docblock states, in a paragraph this slice edited. The rows' premise is a degraded store, since that is
the only condition under which the admission read costs 15s or 60s. **In that same condition the
year's own dozen sequential store round trips are equally degraded, adding hundreds of seconds by
themselves.** So the 300s ceiling is reachable at *every* row, including 15s; "35s of margin" and "5s
of margin" were not margin; and "60s crosses a threshold that 15s did not" does not follow.

**Counting store latency in the admission read while omitting it from the year's body is what
manufactured the threshold.** The arithmetic in each row was right, which is why it survived — the
error was in what the rows were allowed to conclude.

Corrected at all four durable sites: the `route.ts` comment, both closeouts, and the registry. The
45s row is gone rather than re-labelled, since its only purpose was to sit on a slope the table no
longer claims.

**What the under-count actually costs: the budget admits a year it was designed to refuse.** That is a
budget-correctness defect, it is sufficient on its own, and re-measuring fixes exactly it. Ceiling
reachability under a degraded store is separate and pre-existing — the first year is ungoverned, so no
admission check can protect it, and the store terms are deliberately unreserved. Round 1 also claimed
"re-measuring removes that … not a live defect"; that holds for the governed admission path only, and
now says so.

### The gate's SCRIPT exit was 0 on every path

`check_861_promoted; echo "gate exit: $?"` ends in a successful `echo`, so the block's status was the
echo's. Measured: `CHECK BROKEN` → script exit **0**; `NOT PROMOTED` → **0**; `PROMOTED` → **0**.

**Round 1's verification table recorded the FUNCTION's return, not the script's — so the re-verification
did not cover the quantity the section exists to protect.** Third instance of one defect in one
section: first the message, then the function's contract, now the block's status. Each fix moved the
conflation one level out rather than removing it.

Now `check_861_promoted; gate=$?; echo "gate exit: $gate"; ( exit "$gate" )`. The subshell makes `$?`
the verdict for anything wrapping the block **without** exiting an interactive shell, which a bare
`exit` would. Verified in zsh and bash, as a script and sourced.

### The remaining four

- **A citation with a wrong path AND line numbers** — `server/appStateStore.ts:656-692`; the file is
  `src/lib/server/appStateStore.ts`, and this slice's own text argues twice that self-references must
  be by name. The citation guard only validates `'PLATFORM-861: …'` test names, so nothing reddened.
  Now named, not numbered.
- **The Base line said `41652614`** — `origin/main` when #861 merged, but `main` had advanced to
  `40ab8485` before this branch was cut. Corrected above, with the irony noted in place.
- **The relay gave one reason for two files.** `docs/prompts/` is planning's; the 757a closeout is in
  `docs/campaigns/`, which this commit edits, so that reason never covered it. The real reason is the
  authorization boundary — one pre-existing correction was granted, "nothing else pre-existing".
- **Two comment lines were left unreflowed** at 115 and 89 characters after mid-sentence insertions.
  Prettier does not reflow comments, so `lint:all` stayed green. Reflowed; `route.ts:109`'s 89-character
  formula line is pre-existing and deliberately untouched.

### What this round says about the slice

Three of the six findings are **defects introduced by round 1's own corrections** — the script exit,
the citation, the Base line — and a fourth, the threshold, was introduced by this slice's founding
commit. **Every one of them is an over-claim in the safe-looking direction**: a stricter severity, a
more precise citation, a tidier ledger. That is the same shape as the 15s figure this slice exists to
correct, and the reason it keeps recurring is that a correction feels like evidence of care and is
therefore read less sceptically than the thing it replaces.
