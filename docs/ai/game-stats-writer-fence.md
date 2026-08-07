# Game-Stats Writer Fence — game-stats activation & writer-control architecture

Status: Current (architecture)
Last verified: 2026-07-26
Owner: PLATFORM / game-stats
Canonical for: the game-stats fenced-writer + writer-control rollout and the PLATFORM-086H3E activation record (architecture; the operator step-by-step lives in `docs/deployment-runbook.md` §8e)
Supersedes: the PLATFORM-086H3B revision/status-authority branch (frozen, unmerged) and the revision/lineage design in `docs/ai/platform-086h3-contract.md`

Binding project rules in `AGENTS.md` win on any conflict.

**Current state.** The fenced-writer prerequisite (§2) is **merged to `main` (PR #399, 2026-07-21)**;
the C evidence slices (C1–C5) are merged (PRs #400–#402, #404, #407 — C5 is the
numeric participant validation, PLATFORM-086H3C5); the rollout-safety
capability D (§5, PLATFORM-086H3D) is merged (PR #403); the activation execution (E)
shipped as approved slices E1 → E2 → E3 (§4) — E1 (paired analytics provenance,
PLATFORM-086H3E1) merged in PR #408; E2 (refresh/polling/quota primitives,
PLATFORM-086H3E2) merged in PR #409; E3 (final atomic wiring) merged in PR #410.
The reviewed code-bearing artifact (`a161e33`) is active in production and writer
control is durably `active`. **Activation is fully closed (2026-07-26):**
gates-open scheduled deliveries returned QStash HTTP `200` with CFBD quota
unchanged at `4920` (no eligible partition ⇒ no provider attempt), and
Auto-assign Custom Production Domains is re-enabled — no remaining activation or
closeout work. The complete operator record is in `docs/deployment-runbook.md`
§8e. Production must never return to `legacy`; the emergency fallback is
`active → read-only-safe`.

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

**Recovery is NOT complete today (deferred to C/D).** _(This paragraph describes the
state at the 086H3B-disposition time and is retained as historical rationale. It has
since been superseded by the shipped C/D/E work — see below.)_ At that time the cron
selection skipped a week that already had _some_ usable coverage, so a **partial**
partition (some games present, others missing) was **not** re-fetched and its gaps
could remain **stranded** until the C/D coverage + recovery work landed. Only a week
with zero usable coverage was re-fetched. The fenced-writer prerequisite did not
change that — it added no participant-validated coverage, gap detection, or recovery
claims (those were explicitly C and D).

> **Historical update (2026-07-26):** C1–C5, D, and E1–E3 have all shipped and the
> activation (PLATFORM-086H3E) is live. The cron no longer uses the old
> zero-coverage selection heuristic named above (that legacy helper was retired with
> the legacy writer); it now runs evidence-based kickoff-window polling
> (`pollingTarget.ts`) that re-polls a stat-applicable game from kickoff+3h to
> kickoff+24h until its evidence is satisfied, so partial partitions are re-fetched
> within that window. Bounded recovery beyond that window (claims/leases/backoff)
> remains deferred future work.

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

_(HISTORICAL — this one-time fence-bootstrap sequence was completed when the fenced
writer shipped (PR #399). Production has since been initialized, deployed, and
transitioned to `active`. The steps are retained as the record of how the fence was
first stood up; step 6's "keep the state `legacy` until E" was satisfied — E has since
executed and production is durably `active`. For a brand-new environment's pre-fence
bootstrap the create-if-absent `legacy` initializer still applies.)_

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

> **Status:** C (C1–C5), D, and E (E1→E2→E3) have all shipped, and E executed the
> activation — production is durably `active` (see the current-state note at the top
> and the per-slice PR references below). The bullets below describe the revised
> **plan** each slice delivered; where a bullet still reads in the future/plan tense
> it is describing that slice's design intent, not pending work.

- **C — canonical evidence authority:** provider contract, participant validation,
  component merge policy, coverage, public projection. (Duplicate authority keys on
  provider id + resolved participant pair + schema class — no lineage identity.)
  **Landed dormant in slices C1–C5** (read model, ingestion coordination, analytics
  finality gate, paired-input analytics readiness, numeric participant validation —
  see `docs/prompt-registry.md`). C5 completes the participant-validation piece C1
  deferred: schedule persistence captures CFBD numeric `homeId`/`awayId` (additive,
  nullable), and `selectGameEvidence` validates a stored row's `schoolId`s against
  them by EXACT ORIENTED comparison before ranking — mismatched (`identity-mismatch`)
  or unverifiable (`participant-validation-unavailable`) evidence fails CLOSED and can
  never satisfy coverage, publish, enter analytics, or displace a verified sibling.
  **Activation prerequisite this adds for E:** durable schedule caches written before
  C5 carry no participant ids, so their games read `participant-validation-unavailable`
  — before E activates any evidence consumer, force a full-year `bypassCache=1`
  schedule refresh for EVERY target season (2021–2025 + the activation-scope current
  season), verify every addressable stat-producing canonical game has positive numeric
  home/away ids, and run the established read-only participant-validation/parity audit
  (zero validation-unavailable for activation-eligible games, zero unexpected
  identity-mismatch, the accepted 2022 `401506450` exclusion as the sole residual).
  If any year has missing ids or contradictions, STOP — never infer ids, alter
  aliases/owners/archives, mutate evidence, or transition writer control as a
  workaround.
- **D — rollout safety (PLATFORM-086H3D, §5):** the strict writer-control transition
  authority, the operator transition CLI, and H2's in-transaction active-only
  permission check — the complete rollout capability. It shipped merged-but-inactive
  in PR #403 and was **executed by E at activation**: the transition authority (CLI-only)
  moved production `legacy → armed → active`, and H2's active-only permission is now
  live. Bounded recovery (claims, leases, backoff, quota discipline, post-claim
  revalidation) is **deferred future work and is NOT part of D**.
- **E — activation (executed 2026-07-26):** ran the runbook in §6/§8e — production
  transition execution, ingestion/route/cron/reader wiring, consumer activation, reader
  smoke tests, controlled refreshes, final diagnostics, and any final transactional status
  requirement. The `legacy → armed → active` sequence on this control record
  replaces the irreversible witness; no lineage. **E shipped as approved slices
  E1 → E2 → E3** (E1 paired analytics provenance; E2 dormant refresh-outcome /
  polling-target / quota-policy primitives; E3 the single behaviorally atomic
  live switch).
- **E1 — paired analytics provenance (PLATFORM-086H3E1 — merged, PR #408):**
  adds `deriveCanonicalGameStatsSlateFromBuild` (slate derivation from
  an EXACT prior canonical build — its unmodified `buildScheduleFromApi` games
  plus the exact wire rows — inheriting that build's league-scoped aliases,
  manual postseason overrides, and attachment keys instead of an independent
  league-agnostic rebuild; an addressable built game with no associated wire row
  fails CLOSED) and the archive-owned `gameStatSlate` snapshot: a minimal strict
  versioned wire schema built during `buildSeasonArchive` from the same build
  that produced `archive.games`, paired ONLY with that archive's own
  `scoresByKey`, self-validated through its strict parser at build time, and
  failing closed on empty catalog, duplicate/unassociated provider ids, or
  invalid field values. Archives written before E1 lack the field; E3 consumers
  fail closed on absent/malformed snapshots (distinct reasons, never a live
  rebuild) and re-archiving the year is the only repair — a deliberate operator
  action since PLATFORM-086F2H2A retired the admin backfill surface
  (`buildSeasonArchive`/`saveSeasonArchive` remain live and rollover-exercised).
  The operator sequence runs the §4-C full-year schedule refreshes and parity
  audit FIRST, then any re-archiving, all BEFORE E3 activation. The dormant-boundary guard
  now carries ONE exact allowlisted production crossing (`slateSnapshot.ts` →
  `canonicalSlate`, derive entry only), positional and form-strict, with
  laundering self-tests and a documented honest static scope.
- **E2 — refresh/polling/quota primitives (PLATFORM-086H3E2 — merged,
  PR #409; dormant at merge, now wired by E3):** three pure modules E3's
  atomic wiring consumes. `refreshOutcome.ts` is the ONE typed interpreter
  both route and cron must share — it classifies C2's complete ingestion
  result (H2's `DurableMergeResult` nested unchanged) into the locked matrix
  (empty/clean-unchanged/clean-stale → no-op; rejections and mixed
  unchanged/stale → failure with prior-good preserved; written+clean →
  success; written+mixed and partially-merged → partial; those three
  confirmed-commit outcomes — written+clean, written+mixed, partially-merged —
  are the ONLY ones that may advance last-success; conflict → 409;
  unavailable → known-unchanged 503; indeterminate → 503, durability unknown,
  reread required, no same-run retry). `pollingTarget.ts` derives the single 15-minute fetch target from
  schedule time + evidence — NOT score-gated: a game polls while addressable,
  stat-applicable, kickoff-aged [3h, 24h), and not evidence-`satisfied`
  (shared evidence authority); earliest-unresolved-kickoff ordering, regular
  before postseason, then week; at most ONE partition per run; unprovable
  kickoffs/clocks never poll. `quotaPolicy.ts` enforces the 1,000-call
  reserve: automation needs trustworthy finite usage ≥ 1,002 remaining;
  unknown/malformed usage fails closed with distinct reasons; the manual gate
  refuses 429 below reserve unless the second explicit `quotaOverride=1`
  parameter is supplied, reported truthfully. All three shipped as dormant-guard
  homes with forbidden entry-point symbols; the activation-invariant guard now
  governs them as live seams.

- **E3 — final atomic wiring (PLATFORM-086H3E3 — merged, PR #410; active in
  production):** the single behaviorally atomic live switch. The admin-only route
  serves projector-only cache reads and runs manual refreshes through the ONE
  ingestion path (`ingestGameStatsPartitionResponse`) + ONE interpreter +
  durable reread (explicit `bypassCache=1` / `quotaOverride=1` grammar, fresh
  quota probes); the 15-minute cron polls at most one kickoff-window partition
  per run under the reserve; every analytics value consumes
  `projectAnalyticsPartition` over ONE paired provenance (live exact build /
  archive-owned snapshot, fail-closed); diagnostics are evidence-based; the
  activation-invariant guard replaces the dormant guard. Deploying E3 changes
  SERVING behavior, but writing stays operator-gated by this control record:
  legacy only under `legacy`, H2 only under `active`, both refuse in `armed`.
  The complete operator sequence — including the staged-promotion release and
  the refreshes → audit → backfills ordering — is
  `docs/deployment-runbook.md` §8e (preceded by the §8d PLATFORM-086H3E4
  collision-correction sequence; supersedes the sketch in §6 where they
  differ). **It has been EXECUTED (2026-07-26):** the reviewed artifact
  `a161e33` serves production, writer control completed `legacy → armed →
  active`, and the QStash schedule delivered a gates-closed authenticated
  provider-free proof. **Activation is now fully closed (2026-07-26):**
  gates-open scheduled deliveries returned HTTP `200` with CFBD quota unchanged
  at `4920` (no eligible partition ⇒ no provider attempt), and Auto-assign
  Custom Production Domains is re-enabled — recorded in
  `docs/deployment-runbook.md` §8e.

Deploying C, D, E1, and E2 changes no production behavior beyond the additive
archive snapshot field on newly built/backfilled archives.

## 5. Rollout-safety capability (PLATFORM-086H3D — executed at activation)

Three pieces complete the fence into a full rollout mechanism. Their status
**after the PLATFORM-086H3E activation:**

- The **strict transition authority** and **operator CLI** stay
  operator-CLI-only — no route, cron, reader, or application code imports the
  transition module (the activation-invariant guard forbids it). The operator
  used the CLI to transition production `legacy → armed → active`; it remains
  the mechanism for the emergency `active → read-only-safe` stop and
  `read-only-safe → active` recovery.
- **H2's active-only permission** is LIVE: H2 is now the only authorized
  game-stat writer and merges only under `active`.

(Historically, deploying D itself — PR #403 — performed no transition and left
production `legacy`; the transitions above were executed later during E.)

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

## 6. Activation runbook sketch (HISTORICAL — executed 2026-07-26)

**This is the original design-time sketch, retained for context. It has been
EXECUTED during E (2026-07-26): production is durably `active`.** The
authoritative operator record — including the staged-promotion release, the
QStash external-scheduler provisioning, both automation gates, and the exact
delivery-authentication proof — is `docs/deployment-runbook.md` §8e, which
**supersedes this sketch wherever they differ.** Do not replay the steps below
from this document; §8e verifies the completed prerequisites read-only and is
the current source of truth.

Pre-step (added by C5, before step 4): complete the post-deploy full-year schedule
refreshes and the participant-validation audit described in §4's C bullet for every
season E will consume — a season whose canonical games lack numeric participant ids
fails closed everywhere and MUST NOT be activated around.

```text
 1. confirm the target control record is exactly a valid `legacy`
      npm run init:writer-control              # dry run: expect already-legacy no-op
 2. confirm the merged fenced legacy writer is deployed on EVERY instance
 3. deploy D — this performs no transition; production is still `legacy` at
    this step (steps 5 and 8 below transitioned it to `armed`, then `active`)
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
