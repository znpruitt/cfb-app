PROMPT_ID: PLATFORM-625-DATABASE-TIMEOUTS-CLAUDE-v1
PURPOSE: Database waits are unbounded — `statement_timeout` and `lock_timeout` are both `0`, and the
three-connection pool has no acquisition timeout. Nothing but the platform's 300s function kill breaks
a stuck query, a lock wait, or a pool starvation.
SCOPE: `src/lib/server/appStateStore.ts` (the pool and its session settings) and its suites. NOT the
advisory-lock protocol itself, NOT the transaction seams, NOT the nested-read deadlock's structure
(#595 — this bounds its blast radius, it does not fix its cause).
CARRIES: `AGENTS.md` → *Truthful provider-refresh status (PLATFORM-086A)*, verbatim in the part that
binds here — a bound that starts failing writes must not change what a refresh records:

> A **failed** attempt must NEVER advance `lastSuccessAt` — it preserves the prior-good
> `source`/`rowsCommitted` still being served; **success** is recorded only AFTER the durable
> provider-data commit (composing with durable-first); and the record helpers are **best-effort** —
> they must never throw into the provider path, so a status-write failure can't corrupt the data
> commit.

Issue: [#625](https://github.com/znpruitt/cfb-app/issues/625). Spine position 3, **prerequisite 5 of 6
in #610** and app-wide.

---

## Lane and branch

**Platform lane, `/Users/zach/cfb-app-claude`.** Fast-forward `claude/base`, branch, **verify the
SHA**. `npm test` exits 0 on clean `main`; **the known-failure set is EMPTY**.

**`CLAUDE.md`'s push-`preview` instruction is SUSPENDED for this branch.** No user-visible surface.

## The defect, confirmed against live configuration

| setting | value |
| --- | --- |
| `statement_timeout` | **0** |
| `lock_timeout` | **0** |
| `idle_in_transaction_session_timeout` | 5 min |
| `idle_session_timeout` | 0 |

`pg_db_role_setting` carries no role or database override. **The pool caps at three connections with
no acquisition timeout**, and transactional paths take blocking advisory locks.

**Why three connections makes this sharp (#595):** a nested read inside a draft transaction needs a
fourth client that the waiters cannot release — a permanent deadlock starving DB access
process-wide. **With `lock_timeout` at 0 and no acquisition timeout, nothing breaks it but the 300s
function kill.**

## THE VALUES — derived 2026-09-14, and this is what the queue was holding for

The queue deliberately left these unset because *"the bound must fit the invocation budget."* It now
does, and here is the arithmetic. **The owner has seen this derivation; your job is to verify it
against your own measurement, not to adopt it.**

### What was measured

Production, through `DATABASE_URL_RO`, from a laptop over the public internet:

| | observed |
| --- | --- |
| connection establish (cold, includes Neon autosuspend wake) | **3,088 ms** |
| trivial `select 1` | **35 ms** median |
| largest row (`schedule/2025-all-all`, 0.36 MB) | **1,069 ms** median, range **462–2,162 ms** |
| full-table aggregate over `app_state` | 31–77 ms |

**Coverage, stated because the values rest on it:** a remote client against the **read-only replica**,
so **no write was measured**, and every latency includes public-internet round trips the app does not
pay — it runs in-region. **That makes these an OVER-estimate of the app's own latencies**, which is
the safe direction for deriving a ceiling. The autosuspend wake is the exception: the app pays that
too.

### The proposed values

| setting | value | why |
| --- | --- | --- |
| `statement_timeout` | **15 s** | ~7× the slowest statement observed (2,162 ms) and ~14× its median. The largest row in the store is 0.36 MB; nothing in `app_state` is a scan or a join. A legitimate statement should never approach it. |
| `lock_timeout` | **10 s** | Deliberately **below** `statement_timeout`, so lock contention fails with a distinguishable error rather than looking like a slow query. An advisory lock held longer than 10 s means the holder is stuck, not busy. |
| pool `connectionTimeoutMillis` | **15 s** | Must clear the **3,088 ms** cold-wake with real headroom — this is the one value a too-tight bound would break on ordinary traffic. It is also what bounds #595's starvation: any finite value breaks a permanent wait. |
| `idle_in_transaction_session_timeout` | **unchanged at 5 min** | Already set, already a backstop, and not the gap. Do not tighten it in this slice. |

**Worst case for one DB interaction: 15 s connect + 15 s statement = 30 s**, against a 300 s envelope
— and against a CFBD call that may itself take 40 s. A route doing both fits inside 70 s. For
reference, `schedule-refresh` completed a real run at **44,596 ms**.

**The principle behind all four: generous enough never to fire on legitimate work, tight enough to
leave budget to RECORD the failure.** A bound that only fires at 300 s is the platform kill wearing a
different name, and it produces an unresolved attempt with no trace — which is the outcome CARRIES
exists to prevent.

## RULINGS ON THE READ RECEIPT — 2026-09-14, binding; three corrections accepted, one question is the owner's

**1. THE BUDGET ARITHMETIC IS WRONG AND YOURS IS RIGHT.** `statement_timeout` is **per statement**,
not per interaction. `commitCanonicalOddsRefresh` issues **eight** statements, so the worst case is
**~135 s**, not the 30 s this prompt claimed. **It still fits a 300 s envelope**, so the values hold —
but the framing was wrong and the closeout records **135 s**, not 30 s. A reader who budgets against
30 s would size the next bound incorrectly.

**2. NAME `standingsCacheWarmer.ts:125` IN THE CLOSEOUT.** It is the one path where `lock_timeout: 10 s`
**changes behaviour** rather than merely bounding a hang, and it is also #595's nested-read structure
on the longest-holding lock. **That is not a reason to loosen the bound** — it is the path the bound
exists for. It IS a reason to say so explicitly, because the first production timeout will come from
there and should be recognised rather than investigated from scratch.

**3. THE FAILURE-RECORDING PATH CAN ITSELF BE BOUNDED OUT.** `readPriorStatus` failing →
`logReadFailureSkip` → no record. **Pre-existing, not a regression, and the closeout must NOT imply
the failure is always recorded.** Say plainly that a bound firing during the status read produces a
skip rather than a recorded failure. If that is worth its own item, say so and I will file it — do not
fix it here.

**4. A FIGURE THIS PROMPT SHOULD HAVE CITED.** `docs/deployment-runbook.md:252-255` already records a
measured cold connect: **1,333 ms first connect after idle, 198 ms warm** — and says, in the line
written for exactly this situation, *"enough to matter if someone ever budgets a timeout against it."*
My 3,088 ms was a remote client and over-states it, which is the safe direction, but **the repo had
the number and I measured a worse one instead of citing it.** Use the runbook's figure; 15 s clears it
by 11×.

**5. ANSWERED — PRODUCTION IS POOLED. MECHANISM D, AND IT IS CORRECT RATHER THAN MERELY SAFE.** The runbook documents only the **RO rail's** endpoint, but
[#735](https://github.com/znpruitt/cfb-app/issues/735) settles the question without reading a secret:
**`DATABASE_URL_UNPOOLED` and `POSTGRES_URL_NON_POOLING` both exist in Vercel**, added with the other
six by the Neon-Vercel integration on 2026-08-31. **That integration's convention is fixed — the base
`DATABASE_URL` is the POOLED string and `_UNPOOLED` is the direct one.** A separate unpooled variable
exists only because the base one is pooled.

**This is inference from a documented convention plus the observed variable set, not a read of the
value.** Confidence is high and it agrees with the risk asymmetry below, so it decides the mechanism
— but **if your own work can confirm the host cheaply and safely, do, and record which it was.**

**The risk is asymmetric and that is the whole argument.** C guessed wrong is a **total outage** —
session settings silently not persisting through a transaction pooler, so every bound is absent while
appearing configured. D guessed wrong costs **+2 round trips** on non-transactional calls, which is
recoverable and measurable. **A recoverable cost beats an unrecoverable one when the input is
unknown.**

**Do NOT use C.** Under a transaction pooler a session-level `SET` is precisely the silent-failure case
— every bound appears configured and none applies. Record the endpoint finding and its source, so the
next person does not re-derive it.

## Acceptance boundary

- All four settings applied on every pooled connection, not per call site.
- **A bound firing produces a recorded, attributable failure** — not an unresolved attempt. Per
  CARRIES: prior-good preserved, `lastSuccessAt` untouched, and the status helpers still cannot throw
  into the provider path.
- **Lock contention is distinguishable from a slow statement** in whatever is recorded. That is the
  entire reason the two values differ. **AMENDED 2026-09-14 at review: this bullet is NOT MET by this
  slice and the closeout must say so.** Postgres does distinguish them (`55P03` versus `57014`), but
  every transactional caller flattens both into `store-unavailable` with a fixed code before anything
  durable records it. Fixing that reaches 19 callers and the transaction seams, which this SCOPE
  excludes — filed as [#785](https://github.com/znpruitt/cfb-app/issues/785). **The bounds still end
  the hang; the diagnostic value is latent until a caller preserves the identity.** Do not relax this
  bullet quietly — record it as unmet.
- The file-fallback path (no `DATABASE_URL`) is unaffected.
- **#595's deadlock is BOUNDED, not fixed.** Say so in the closeout; a reader should not come away
  thinking the nested-read structure is safe.

## Verification

- `npm run lint:all`, `npx tsc --noEmit`, `npm test` — each its own command, each its own real exit
  code, never behind a pipe. **One complete run that itself exits 0.** Report the DELTA at both ends.
- **Reproduce an unbounded wait before bounding it.** A statement that sleeps past the bound must hang
  today and fail attributably after. `pg_sleep` is the obvious instrument on a scratch connection.
- **Mutation-prove each bound separately** — a test that goes red for `statement_timeout` must not be
  the same test that covers `lock_timeout`, or you cannot tell which one is wired.
- **Cover the cold-connect case**, since `connectionTimeoutMillis` is the only value that could fire
  on ordinary traffic.

## Reviews

`/code-review` and `/codex:review` are **user-invocable only**. Run everything else, then stop and ask
the owner to invoke both against the same commit. Gather both before any remediation.

## Closeout

Pre-merge: `docs/prompt-registry.md` and the `docs/next-tasks.md` spine row, **keyed by the issue
link**. Record the four values **with the derivation and its coverage limit** — remote client,
read-only replica, no write measured. **If your own measurement disagrees with any of these, the
closeout records yours and says which changed.**

## STOP — read receipt before writing any code

1. **Re-measure in the app's own environment.** Mine is a remote client against the replica, so it
   over-estimates latency and measured **no write**. Time the largest realistic WRITE — a
   `withAppStateKeyTransaction` round trip on a large key. **If a legitimate write approaches 15 s,
   `statement_timeout` is wrong and I need to know before you wire it.**
2. **Reproduce the unbounded wait.** Show a statement hanging past any reasonable bound today.
3. **Where do these settings belong** — a `pg` pool option, a session `SET` on connect, or the
   connection string? Say which the pool actually honours, measured. A setting that silently does not
   apply is the worst outcome here.
4. **What currently happens when a pooled query fails mid-transaction?** Trace one caller end to end
   and confirm the CARRIES invariant holds — prior-good preserved, no advanced `lastSuccessAt`. **A
   bound that starts producing failures on a path that mishandles them makes things worse.**
5. **Can a legitimate operation hold an advisory lock longer than 10 s?** Enumerate the transactional
   paths and the work each does under lock. Name the longest.
6. **Does the file fallback share this code path?** Confirm it is unaffected rather than assuming.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
