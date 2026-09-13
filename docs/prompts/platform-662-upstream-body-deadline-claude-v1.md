PROMPT_ID: PLATFORM-662-UPSTREAM-BODY-DEADLINE-CLAUDE-v1
PURPOSE: The upstream request deadline is cleared when the response headers arrive, so the response
BODY downloads with no timeout at all. Carry the deadline through body consumption, and stop
classifying a timed-out or truncated body as a JSON parse failure.
SCOPE: `src/lib/api/fetchUpstream.ts` and its suites; `src/lib/odds/oddsRefreshExecutor.ts` only for
the second unprotected body read named below. NOT the timeout VALUES at the ten call sites (#632, a
different defect), NOT the retry policy's attempt counts, NOT the pacing layer, NOT any provider
module's error handling beyond what a changed error `kind` forces.
CARRIES: `AGENTS.md` → *Truthful provider-refresh status (PLATFORM-086A)*, verbatim in the part that
binds here:

> A **failed** attempt must NEVER advance `lastSuccessAt` — it preserves the prior-good
> `source`/`rowsCommitted` still being served; **success** is recorded only AFTER the durable
> provider-data commit (composing with durable-first); and the record helpers are **best-effort** —
> they must never throw into the provider path, so a status-write failure can't corrupt the data
> commit.

And the credential-safety invariant this file already carries in code, which any new error path must
obey (`fetchUpstream.ts:268-271`, PLATFORM-086C2 security remediation):

> A FIXED message — never the raw `error.message`, which (in some environments) can embed the
> requested URL and therefore a credential query parameter. The `url` here is already sanitized.

Issue: [#662](https://github.com/znpruitt/cfb-app/issues/662). Dispatch position 3 on the audit
spine, after #204. Evidence: `docs/archive/audits/codebase-audit-existing-plans-2026-09-08.md` → R1,
independently reproduced by the planning session 2026-09-08 — an ~80ms body completed successfully
against a 5ms timeout, elapsed 81ms.

---

## Lane and branch

**Platform lane, `/Users/zach/cfb-app-claude`.** Branch off current `origin/main`, which is
**`54fa6d7f`** — verify it rather than trusting this line, because the previous kickoff in this
campaign shipped with a stale base SHA and the lane caught it. `npm test` exits 0 on clean `main` and
**the known-failure set is EMPTY**, so any failure stops the merge. Push `preview` with every commit
on the branch, including the closeout.

**`preview` is currently held by the UI lane** (`codex/671-live-finals-tag-slot`). Only one lane can
hold it. Say so when you take it, and do not take it silently.

## The defect, precisely

`fetchUpstreamResponse` (`src/lib/api/fetchUpstream.ts:279`) runs its attempt loop with a
per-attempt `AbortController` and `setTimeout`, and clears that timer in a `finally` at **`:398`**.
That `finally` fires **when the function returns the response** — which is when the headers have
arrived, not when the body has. `fetchUpstreamJson` (`:409`) then awaits `response.json()` with no
deadline, no abort signal, and outside the retry loop.

**The misclassification is the second half and it is in four lines.** `fetchUpstreamJson`'s `catch`
is bare: **every** body failure — an abort, a socket reset mid-download, a truncated payload, genuine
malformed JSON — becomes `kind: 'parse'`, message *"Upstream response was not valid JSON"*. A
consumer branching on `kind` to decide whether to retry, whether to preserve prior-good data, or what
to record cannot distinguish a network death from a schema problem.

**One thing that is NOT broken, so do not "fix" it:** the HTTP-error body read at **`:355`**
(`await res.text().catch(() => '')`) sits inside the try, inside the deadline, inside the retry loop.
It is already correct. Only the SUCCESS-path body read escapes.

## The second surface, which the issue does not name

`fetchUpstreamJson` has **23 call sites across 12 files**. But `oddsRefreshExecutor.ts:423` calls
`fetchUpstreamResponse` directly with `throwOnHttpError: false` and reads the body itself at
**`:507`** — 84 lines and several awaits later. It has the identical defect and is not fixed by
anything you do to `fetchUpstreamJson`. **It is in scope.** Decide and state whether it converges on
the shared helper or keeps its own deadline; a second bespoke timeout is a fork and needs the
argument made.

## The decision this item must make explicitly, not inherit

**Does a body failure become retryable?** Today body failures fall outside the retry loop, so they
are not retried. Moving body consumption inside the loop makes a truncated body a retried request —
**and every retry of a CFBD or odds request is a billed provider call.** This repo has spent Items
94, 95 portion 2 and 127 protecting exactly that budget, and `oddsRefreshExecutor` is metered against
a 50-credit reserve.

**State the choice and its cost in the closeout.** Both answers are defensible; an unstated one that
falls out of where you happened to move the `await` is not. If you make body failures retryable,
say what bounds the spend. If you do not, say what a truncated body costs the caller instead.

## Acceptance boundary

- The deadline spans body consumption. A body that outlives `timeoutMs` aborts.
- **Classification survives.** A body abort is `timeout`; a mid-download transport failure is
  `network`; only genuinely malformed JSON is `parse`. `UpstreamErrorKind` already has all three
  (`:1`) — no new kind unless you can show none fits.
- **Truncated AND delayed bodies are both covered**, per the issue's ask. They are different
  failures: one completes with wrong bytes, one never completes.
- **Prior-good data survives.** The CARRIES invariant above is the binding form of this. Enumerate
  what the 23 call sites do on a thrown `UpstreamFetchError`, and confirm that a body failure now
  classified `timeout` rather than `parse` does not cause any of them to clear a cache, advance
  `lastSuccessAt`, or write an empty replacement. **A changed `kind` is a behaviour change at every
  consumer that branches on it** — that is the risk in this item, not the timer.
- No error message may embed the unsanitized URL. New paths use `sanitizeUpstreamUrl`.
- No timer leak: every path that creates a timeout clears it exactly once, including the path where
  a caller never reads the body.

## Verification

- `npm run lint:all`, `npx tsc --noEmit`, `npm test` — each its own command, each its own real exit
  code, never behind a pipe. Report the test DELTA, not a total.
- **Reproduce the defect before fixing it.** The audit's shape is the control: a body slower than the
  timeout must currently SUCCEED. A test that does not go red against `main` is not a regression test
  for this.
- Mutation-prove each classification assertion: read WHICH assertion fires, not merely that the suite
  is red. Three separate failure modes must produce three distinct kinds, and a test that passes for
  two of them is the failure this branch is most likely to ship.
- Cover a body that is delayed past the deadline, a body truncated mid-download, and a body that is
  complete but malformed. **The third must still be `parse`** — a fix that reclassifies everything as
  `timeout` passes a careless suite and destroys the signal.

## Reviews

`/code-review` and `/codex:review` are **user-invocable only**. Run everything else, then stop and
ask the owner to invoke both against the same commit. Gather both before any remediation.

## Closeout

Pre-merge, on the branch: `docs/prompt-registry.md` entry, and the `docs/next-tasks.md` / issue #662
state. Record the retry decision as TAKEN, the `oddsRefreshExecutor` disposition, and any consumer
whose behaviour changed because an error `kind` changed.

## STOP — read receipt before writing any code

1. **Confirm or break the mechanism.** Write the failing case first: a body slower than `timeoutMs`
   that currently RESOLVES. Report the elapsed time and the timeout it beat. If it does not
   reproduce on `54fa6d7f`, stop and say so — the issue is then wrong and nothing should be built.
2. **Enumerate all 23 `fetchUpstreamJson` call sites and say, per site, what happens on a thrown
   `UpstreamFetchError`** — and specifically **which ones branch on `error.details.kind`**. Give the
   count. **If any site treats `parse` differently from `timeout`, changing the kind changes
   production behaviour**, and I need that list before you write the fix, not in the closeout.
3. Is `oddsRefreshExecutor.ts:507` the ONLY body read outside `fetchUpstream.ts`? Enumerate every
   `.json()` / `.text()` on a `Response` in `src/` that did not come from `fetchUpstreamJson`.
   A count of zero elsewhere is a claim — show the search that supports it.
4. **The retry decision, argued both ways, before you pick.** If a body failure becomes retryable,
   how many additional billed provider calls can one request now make, worst case? Name the number.
5. Does any existing test assert `kind === 'parse'`? If so, list them — those are the tests that will
   change meaning, and a test updated to match new behaviour is not evidence the new behaviour is
   right.
6. `fetchUpstreamResponse` is exported and has exactly one non-test caller today. **If you change its
   contract** (not clearing the timer on return, returning a handle, taking a body-consumer), say what
   that costs a future caller who only wants headers — and whether the export should narrow instead.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
