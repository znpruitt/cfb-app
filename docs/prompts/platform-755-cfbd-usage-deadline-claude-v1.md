PROMPT_ID: PLATFORM-755-CFBD-USAGE-DEADLINE-CLAUDE-v1
PURPOSE: `fetchCfbdUsage` is a raw `fetch` with no timeout on headers or body, awaited in the quota
gate ahead of three crons. Give it a deadline without changing what it means.
SCOPE: `src/lib/api/cfbdUsage.ts` and its suites; the five call sites only if a changed error type
forces it. NOT the odds body deadline (#759), NOT the timeout VALUES at other call sites, NOT the
quota-reserve policy, NOT `usage-sample`'s cadence or retention (#710).
CARRIES: `AGENTS.md` → *Truthful provider-refresh status (PLATFORM-086A)*, verbatim in the part that
binds here — a quota probe that starts failing differently must not change what a refresh records:

> A **failed** attempt must NEVER advance `lastSuccessAt` — it preserves the prior-good
> `source`/`rowsCommitted` still being served; **success** is recorded only AFTER the durable
> provider-data commit (composing with durable-first); and the record helpers are **best-effort** —
> they must never throw into the provider path, so a status-write failure can't corrupt the data
> commit.

And `CLAUDE.md` → *Reading production data*, which governs the measurement this item needs:

> **Use the read-only replica. Do not `vercel env pull`.**

Issue: [#755](https://github.com/znpruitt/cfb-app/issues/755), filed out of the #662 branch's scoping
by the lane that correctly refused to widen into it.

---

## Lane and branch

**Platform lane, `/Users/zach/cfb-app-claude`.** Branch off current `origin/main` — **verify the SHA**,
do not trust one written here. You are currently on a merged branch; return to `claude/base` first.
`npm test` exits 0 on clean `main` and **the known-failure set is EMPTY**. Push `preview` with every
commit including the closeout. **`preview` is held by the UI lane** — if you need it, say so and take
it explicitly.

## The defect

`fetchCfbdUsage` (`src/lib/api/cfbdUsage.ts:58`) calls `fetch` directly at `:69`. No
`AbortController`, no `setTimeout`, no retry policy, no `UpstreamFetchError`. **Neither the header
phase nor the body read is bounded by anything.**

It is awaited ahead of the work by five callers:

| caller | mode |
| --- | --- |
| `src/app/api/cron/game-stats/route.ts:359` | `fresh: true` |
| `src/app/api/cron/rankings/route.ts:378` | `fresh: true` |
| `src/app/api/cron/usage-sample/route.ts:104` | `fresh: true` |
| `src/app/api/game-stats/route.ts:276` | `fresh: true` |
| `src/app/api/admin/usage/route.ts:12` | cached |

**On a serverless invocation a hang here is not a slow probe — it is a cron that never does its work**,
killed by the platform envelope after spending the invocation and before reaching the job.

**This is NOT #662's defect.** That one was a deadline ending too early; this is a deadline that does
not exist. #662 fixed the shared helper and this file never used it.

## A measurement, not a description

Read from `app_state / scheduler-execution-status` through `DATABASE_URL_RO` on 2026-09-13, the
latest receipt per job:

| job | `durationMs` |
| --- | --- |
| `usage-sample` | **28,779** |
| `team-records` | 7 |
| `rankings` | 239 |
| `polling-planner` | 343 |
| `odds` | 454 |

**`usage-sample`'s work is essentially the one `/info` call this item is about, and its last recorded
run took 28.8 seconds.**

**State the coverage honestly wherever you cite this, because I am handing you a bounded claim:** it
is whole-run duration — route entry, the probe, the durable write, response — so it is an **upper
bound on the probe, not a measurement of it**, and the receipt is **latest-only**, so it is one run,
not a distribution. It is enough to show the probe is not reliably fast. It is not enough to set a
ceiling from. **Do not quote 28.8s as the `/info` latency.**

## What must survive, both documented in the file

1. **The `fresh` / cached split.** `cache: 'no-store'` for quota gates, `next: { revalidate: 600 }`
   for display surfaces. The comment at `:64-68` states why: a cached remaining-count would let a
   burst of refreshes reuse one pre-spend snapshot and collectively cross the reserve.
2. **A 200 with a non-object body resolves to all-unavailable rather than throwing** (`:87-89`),
   keeping "unavailable" distinct from the thrown provider-read-failure path.

**Whether `fetchUpstreamJson` can carry `next: { revalidate }` at all is an open question, not an
assumption.** `FetchUpstreamJsonOptions extends Omit<RequestInit, 'signal'>`, and `next` is a Next.js
extension to `RequestInit`. If it does not survive the shared path, that is a real finding and it may
be the reason this file keeps its own bounded `fetch` instead.

## The value, and why you may not copy one

`CFBD_PEAK_LATENCY_TIMEOUT_MS` is 40s and is **wrong here by construction**. PLATFORM-115 derived it
from completed `/games` samples — large payloads. `/info` is a small probe **sitting ahead of the work
it gates**, so its ceiling is a share of the invocation budget, not a payload-latency band.

**Derive it, do not borrow it.** #632 already records the rule for this exact situation: *"Decide
separately; do not sweep it in on pattern-match alone."* If no durable record supports a derivation,
say so and propose a number **with the arithmetic shown** — a stated assumption is acceptable, an
unexplained constant is not.

## Acceptance boundary

- Both phases of the `/info` request are bounded. A hang cannot consume the invocation.
- Both documented behaviours above survive, each pinned by a test.
- **A probe failure does not become a provider-data failure.** The quota gate's job is to decide
  whether to spend; a probe that times out must leave the caller able to make its own conservative
  decision, exactly as a probe that returns unavailable does today.
- **No caller's recorded status changes shape** unless you show why it must, per CARRIES.
- No new error message may embed the unsanitized URL — it carries `Authorization`, and the
  credential-safety invariant in `fetchUpstream.ts` exists because of that class.

## Verification

- `npm run lint:all`, `npx tsc --noEmit`, `npm test` — each its own command, each its own real exit
  code, never behind a pipe. Report the test DELTA, not a total.
- **Reproduce the unboundedness first.** A server that never responds must currently hang the call and
  must, after the fix, fail at the deadline. A test that does not go red against `main` is not a
  regression test for this.
- **Cover `maxAttempts > 1` if you adopt a retry policy.** #662's HIGH shipped through a green suite
  because every test used a single attempt; do not repeat it one file over.
- Pin both surviving behaviours with mutation: revert each separately and read WHICH assertion fires.

## Reviews

`/code-review` and `/codex:review` are **user-invocable only**. Run everything else, then stop and ask
the owner to invoke both against the same commit. Gather both before any remediation.

## Closeout

Pre-merge, on the branch: `docs/prompt-registry.md` entry and the `docs/next-tasks.md` row. Record the
timeout value **with its derivation**, whether the shared helper was adopted or the file kept a bounded
`fetch` of its own and why, and whether any caller's failure handling changed.

## STOP — read receipt before writing any code

1. **Reproduce it.** Point `fetchCfbdUsage` at a server that accepts the connection and never responds.
   Report what happens today and how long you waited. **If it does not hang, the issue is wrong and I
   need to know before you build.**
2. **Does `fetchUpstreamJson` carry `next: { revalidate: 600 }` through to `fetch`?** Answer by running
   it, not by reading the type. This decides whether the shared path is usable at all, and it is the
   single question that determines the shape of the fix.
3. **Enumerate what each of the five callers does when `fetchCfbdUsage` THROWS today**, and say which
   would behave differently if the throw became an `UpstreamFetchError`. Give the count that branch on
   the error at all. **#662 taught that the module's own file is where the branching hides — check
   `cfbdUsage.ts` itself, not only the callers.**
4. **Is there any durable record of `/info` latency alone?** `provider-usage`, the cron execution logs,
   the receipts. If the honest answer is "only the whole-run upper bound above", say so — that is the
   coverage statement the value has to be chosen under.
5. **What does the quota gate do if the probe is unavailable today?** Name the conservative path per
   caller. A timeout should land there, and if any caller has no conservative path, that is a finding
   bigger than this item.
6. `usage-sample` exists to sample usage on its own schedule. **If the probe gets a deadline, can
   `usage-sample` still do its job** — or does bounding it turn a slow-but-successful sample into a
   gap in the retained series? Say which, with the cadence.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
