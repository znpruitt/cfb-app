# Game-Stats Writer Fence — replacement reliability prerequisite

Status: **Current architecture.** Supersedes the PLATFORM-086H3B revision/status-authority
branch. The fenced-writer prerequisite (§2) is **merged to `main` (PR #399, 2026-07-21)**;
the C evidence slices (C1–C3) are merged (PRs #400–#402); the rollout-safety
capability D (§5, PLATFORM-086H3D) is implemented dormant; the activation execution (E)
is unwritten — production remains in `legacy` and no transition has ever been executed.
Owner: PLATFORM / game-stats. Binding project rules in `AGENTS.md` win on any conflict.

This document records (a) the disposition of PLATFORM-086H3B and (b) the small
replacement prerequisite that ships in its place.

## 1. Disposition of PLATFORM-086H3B

Two independent architectural audits (Claude and Codex) reached the same conclusion:
the PLATFORM-086H3B "revision status authority" branch
(`platform/086h3b-revision-status-authority`) must **not** be merged. It is
**superseded, unmerged, and frozen as a read-only architectural reference.**

Its concurrency and failure-case research (activation-race, stale-terminal, and
malformed-state scenarios) is retained as reference only. **No additional work will
occur on its revision, repair, dormant-boundary parser, or capability-graph design.**

Why: game statistics are **reconstructible provider projections** — every stored
field derives from a CFBD re-fetch keyed by the canonical schedule, and the weekly
cron re-fetches a week that has **no** usable coverage. No product feature reads a
revision/lineage/commit-stamp; none of that data ever leaves the database; and after
a point-in-time restore **nothing outside the same database remembers a revision**,
so permanent lineage and revision-reuse prevention defend a scenario that cannot
occur at this product's (hobby-scale, commissioner-operated) stage. The proportionate
protection is atomic + serialized writes, keep-last-good, malformed-response refusal,
stale-attempt ordering, and retry-on-next-poll — most of which already ship
(prerequisite A + PLATFORM-086A + the payload classifier).

**Recovery is NOT complete today (deferred to C/D).** The current cron selection skips
a week that already has _some_ usable coverage (`hasUsableGameStats` — ≥1 usable
game), so a **partial** partition (some games present, others missing) is **not**
re-fetched and its gaps can remain **stranded** until the C/D coverage + recovery work
lands. Only a week with zero usable coverage is re-fetched. This fenced-writer
prerequisite does not change that — it does not add participant-validated coverage,
gap detection, or recovery claims (those are explicitly C and D).

Removed from the active plan: **lineage, permanent revision numbers, the revision
ledger, restoration high-water witnesses, the irreversible revision witness,
failed-begin provenance, revision repair (planning/apply/CAS/audit), the
administrator revision route, the semantic dormant-boundary parser, and any
structural capability-graph guard.**

## 2. The replacement prerequisite (this branch)

The replacement contains **only the fenced legacy writer**. It establishes one
invariant:

> Every live legacy game-stat write serializes on its weekly partition, revalidates a
> durable writer-control record in the SAME transaction, and commits only when that
> record is exactly a valid `legacy`.

It reuses prerequisite A (the already-merged multi-key app-state transaction) and
adds no revision, lineage, repair, recovery, shared-lock, status-ownership, or
`fetchedAt` stale-write machinery.

### Writer-control record

Durable app-state row at scope `game-stats-writer-control`, key `state`
(`src/lib/gameStats/writerFence.ts`):

```jsonc
{ "recordVersion": 1, "state": "legacy" } // states: legacy | armed | active | read-only-safe
```

Strictly validated (exact key allowlist; rejects JSON null, primitives, arrays,
unknown versions, missing/unsupported state, and extra fields). An absent or
malformed record is **never** interpreted as `legacy`. The module owns only the
record's identity, validation, presence-aware classification, and the initial
`legacy` constructor — **no transitions, repair, lineage, or HTTP surface**
(transitions live in the D transition authority, §5; execution is E's concern).

### Fenced writer

`setCachedGameStats` (`src/lib/gameStats/cache.ts`) now runs in one transaction:
root EXCLUSIVE on the partition `E(P)` → take the writer-control key EXCLUSIVE
(`lockKey`, canonical forward order — `game-stats` sorts below
`game-stats-writer-control`) → re-read the control record under both locks →
require exactly valid `legacy` → write. A write is **never reported as a successful
persistence** unless it commits. The failure kinds differ in what they claim about
durability, and callers must respect the distinction:

- A fence refusal (absent / malformed / `armed` / `active` / `read-only-safe`) and a
  `store-unavailable` failure (lock-acquisition, callback, or a transaction that
  provably persisted nothing) are **KNOWN-UNCHANGED** — nothing was written and the
  existing partition is preserved byte-for-byte.
- A `store-indeterminate` failure (mutation SQL was submitted but the COMMIT
  acknowledgement was lost — prerequisite A's `writeAttempted: true`) is **UNCERTAIN**:
  the new partition **MAY** be durable. It must be retried / re-read on the next poll
  **without assuming** either the old or the new version is the durable one.

While the record is `legacy`, a committed partition's bytes are identical to the prior
blind write (no revision/lineage/commit-stamp/activation metadata is added). A
lock-order violation is a programming error and is re-thrown, not masked as a store
failure. Provider fetch/normalization/classification happen BEFORE the transaction opens.

Same-partition legacy writes therefore serialize across PostgreSQL-backed instances
(the partition key's advisory lock), and a future rollout can stop this writer by
flipping the control record to a non-`legacy` state — with no code change.

## 3. Required production rollout sequence

**The writer-control row MUST be initialized before the fenced writer is deployed.**
Because absent state fails closed, deploying the fenced writer to an environment
whose control row does not yet exist will cause **all legacy game-stat writes (cron
and manual) to be refused.** This operational dependency is not hidden:

```text
1. build & verify this replacement branch
2. run the initializer DRY-RUN against the target environment
     npm run init:writer-control              # dry run (report only)
3. apply initialization while the CURRENT (pre-fence) legacy writers still ignore the row
     npm run init:writer-control -- --apply   # PostgreSQL only; create-if-absent
4. verify the row is exactly a valid `legacy` record
5. deploy the fenced legacy writer
6. keep the state `legacy` until E
```

The initializer (`scripts/init-game-stats-writer-control.ts`) is create-if-absent
ONLY: it creates the initial `legacy` record when the row is durably absent, is an
idempotent no-op when a valid `legacy` record already exists, and REFUSES (writing
nothing) a malformed or non-`legacy` record. It can never arm, activate, stop,
repair, delete, or edit state, and `--apply` runs only against a writable PostgreSQL
store.

## 4. Revised C / D / E (lineage/revision/repair removed)

- **C — canonical evidence authority:** provider contract, participant validation,
  component merge policy, coverage, public projection. (Duplicate authority keys on
  provider id + resolved participant pair + schema class — no lineage identity.)
  **Landed dormant in slices C1–C3** (read model, ingestion coordination, analytics
  finality gate — see `docs/prompt-registry.md`).
- **D — rollout safety (PLATFORM-086H3D, §5):** the strict writer-control transition
  authority, the operator transition CLI, and H2's in-transaction active-only
  permission check — the complete dormant capability E later executes. Bounded
  recovery (claims, leases, backoff, quota discipline, post-claim revalidation)
  is **deferred future work and is NOT part of D**.
- **E — activation:** executes the runbook in §6 — production transition execution,
  ingestion/route/cron/reader wiring, consumer activation, reader smoke tests,
  controlled refreshes, final diagnostics, and any final transactional status
  requirement. The `legacy → armed → active` sequence on this control record
  replaces the irreversible witness; no lineage.

E is unwritten; deploying C and D changes no production behavior.

## 5. Rollout-safety capability (PLATFORM-086H3D — dormant)

Three pieces complete the fence into a full rollout mechanism. All are dormant:
no route, cron, reader, or production caller invokes any of them (the recursive
dormant-boundary guard enforces this), live game-stat writers remain on the
fenced legacy setter, and **deploying D performs no transition — production
stays `legacy`.**

### Strict transition authority

`src/lib/gameStats/writerControlTransition.ts` — ONE atomic operation over the
existing control record. Every request states the expected current state and the
requested next state; the reread, expected-state check, edge validation, and
conditional write run in one transaction rooted (advisory-locked) on the control
key, persisting only the exact `{recordVersion, state}` shape. The graph is
closed and directional:

```text
legacy ⇄ armed → active ⇄ read-only-safe
```

Everything else refuses without writing: absent or malformed control,
expected-state mismatch (reports the actual state), same-state requests, every
unlisted edge, and — by construction — every return to `legacy` after
activation. Outcomes are typed: `transitioned` (confirmed commit only),
`would-transition` (dry run), the four refusals, `store-unavailable` (no durable
transition), and `store-indeterminate` (mutation SQL submitted, commit
unconfirmed — EITHER state may be durable; the operator must reread, never
retry, repair, or infer which state won).

### Operator CLI

`npm run transition:writer-control -- --from <state> --to <state> [--apply]`
(`scripts/transition-game-stats-writer-control.ts`). Explicit `--from`/`--to`
are required; the default execution is a READ-ONLY dry run that validates the
record, expected state, and edge without writing. A dry run is not a
reservation — `--apply` repeats the whole atomic check, runs only against a
writable PostgreSQL store, and reports the resolved storage mode. Exit codes are
stable: 0 success/valid dry run, 2 refused, 3 store unavailable, 4 indeterminate
durability, 1 unexpected (redacted by default). The one-shot initializer is
unchanged and remains create-if-absent `legacy` only — it can never transition.

### H2 active-only permission

Inside `mergeGameStatsPartitionDurable`'s existing partition transaction, every
invocation takes the control key EXCLUSIVE under the partition lock (canonical
order below), rereads and strictly parses the record under BOTH locks, and
merges ONLY when the state is exactly `active`. Absent, malformed, non-`active`,
unlockable, and unreadable control all refuse BEFORE the partition read, merge
computation, or any write — including for batches that would have been
unchanged, stale, conflicting, or entirely non-persistable — with typed
known-unchanged `unavailable` reasons (`control-lock-unavailable` /
`control-read-failed` / `control-absent` / `control-malformed` /
`control-not-active`).

### Serialization barriers

Because every writer revalidates the control INSIDE its partition transaction
while holding the control lock, a committed transition is a barrier:

- a legacy write holding control completes before `legacy → armed` commits, and
  a writer arriving after the transition rereads `armed` and refuses;
- an H2 write holding control completes before `active → read-only-safe`
  commits, and an H2 write arriving after the stop rereads `read-only-safe` and
  refuses — an earlier out-of-transaction observation of `active` grants
  nothing.

The canonical lock order is unchanged and shared by both writers:

```text
game-stats partition (primary)
  → game-stats-writer-control/state (lockKey)
```

## 6. Activation runbook (executed during E — never before)

Documented now; **no step below has been executed.** Production transition
execution, reader smoke tests, and controlled refreshes are E responsibilities.

```text
 1. confirm the target control record is exactly a valid `legacy`
      npm run init:writer-control              # dry run: expect already-legacy no-op
 2. confirm the merged fenced legacy writer is deployed on EVERY instance
 3. deploy D — this performs no transition; production remains `legacy`
 4. dry-run the arming edge
      npm run transition:writer-control -- --from legacy --to armed
 5. during E: apply `legacy → armed` and drain old requests
      npm run transition:writer-control -- --from legacy --to armed --apply
    (in-flight legacy writes holding the control lock complete first; every
    writer arriving afterwards rereads `armed` and refuses)
 6. deploy and verify E while BOTH writers refuse in `armed`
 7. if activation must be abandoned BEFORE it succeeds: roll back E, then
      npm run transition:writer-control -- --from armed --to legacy --apply
 8. after successful verification: apply `armed → active`
      npm run transition:writer-control -- --from armed --to active --apply
 9. NEVER return to `legacy` after activation (the graph forbids it)
10. for a post-activation stop: apply `active → read-only-safe`; resume only
    through `read-only-safe → active`
```
