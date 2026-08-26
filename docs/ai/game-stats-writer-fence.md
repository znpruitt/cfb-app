# Game-Stats Writer Control and Ingestion

Status: Current (architecture)
Last verified: 2026-08-26
Owner: PLATFORM / game stats
Canonical for: current game-stats writer control, ingestion/outcome authority, evidence coverage, and emergency fence behavior
Supersedes: the completed H3B–H3E rollout narrative and the revision/lineage design in `docs/ai/platform-086h3-contract.md`

Binding rules in [`AGENTS.md`](../../AGENTS.md) win on any conflict. Production game-stats
automation is active, and the durable writer-control record is `active`. Current operator commands
live in [`../deployment-runbook.md`](../deployment-runbook.md#8e-game-statistics--active); completed
activation evidence is archived in
[`../archive/operations/provider-activation-2026.md`](../archive/operations/provider-activation-2026.md#game-stats-automation).

## Current architecture

Game statistics are reconstructible CFBD projections attached to the canonical schedule. They do
not define game identity and do not use permanent lineage or revision numbers.

```text
authenticated manual refresh or 15-minute cron
  -> one CFBD /games/teams partition response
  -> H1 parse and persistability classification
  -> one ingestion coordinator
  -> H2 active-only durable merge
  -> one shared refresh-outcome interpreter
  -> evidence selection against the canonical schedule
  -> coverage, public projection, and analytics
```

The cron selects at most one stat-applicable kickoff-window partition per run. Disrupted-only slates
are not expected and are not polled. Provider refresh status and scheduler receipts observe the
operation but never become data authority.

## Writer-control record

The single durable record is `game-stats-writer-control/state` with the exact shape:

```ts
{ recordVersion: 1, state: 'legacy' | 'armed' | 'active' | 'read-only-safe' }
```

Parsing is strict. Absence, JSON `null`, unknown versions/states, and extra fields are distinct from
a valid record and fail closed; nothing defaults to `legacy` or `active`.

The closed transition graph is:

```text
legacy <-> armed -> active <-> read-only-safe
```

`legacy` and `armed` were rollout states. Production has activated and must never return to
`legacy`. The only current operational transition is `active -> read-only-safe` for an incident and
`read-only-safe -> active` after recovery.

Transitions are operator-CLI-only through `npm run transition:writer-control`. The command validates
the expected state and edge inside one durable transaction. Dry runs do not reserve a transition.
An absent or malformed record, stale expected state, forbidden edge, or store failure refuses
without repair. If commit durability is indeterminate, the operator must reread and must not retry
blindly.

## Writer authorization and serialization

There are two fenced write implementations:

| Writer | Allowed control state | Current role |
| --- | --- | --- |
| Legacy partition overwrite in `src/lib/gameStats/cache.ts` | Exactly `legacy` | Retained, fenced compatibility writer; not an authorized active ingestion path. |
| H2 merge in `src/lib/gameStats/durableMerge.ts` | Exactly `active` | Sole active durable game-stats writer. |

Both writers lock the exact weekly partition, acquire the writer-control lock in the canonical
order, reread the control record under those locks, and only then decide whether they may write.
This creates the transition barrier:

- a writer already holding the control lock completes before a transition can commit;
- a writer arriving after the transition rereads the new state and refuses;
- absent, malformed, or wrong-state control never permits a write;
- `read-only-safe` prevents both writer families from mutating game stats.

H2 preserves prior-good rows, merges observations deterministically, rejects incompatible identity
or schema evidence, orders stale attempts by fetch start, and distinguishes known-unchanged storage
failure from indeterminate durability.

## One ingestion path

Both `/api/game-stats` and `/api/cron/game-stats` pass provider responses through
`ingestGameStatsPartitionResponse`. No route or cron may call parsing or the H2 merge as a parallel
ingestion implementation.

The coordinator classifies the top-level response before any merge:

| Provider response | Ingestion result | Durable effect |
| --- | --- | --- |
| Exact empty array | `no-op / empty-response` | No merge and no deletion. |
| Non-array | `rejected / invalid-payload` | Prior-good preserved. |
| Nonempty array with no persistable observations | `rejected / no-persistable-observations` | Prior-good preserved. |
| At least one persistable observation | H1 parses every row and calls H2 once with the parsed batch. | Decided by the H2 merge. |

Mixed batches retain diagnostics for parse failures and non-persistable rows. The coordinator does
not relabel H2 outcomes or implement repair, retry, coverage, HTTP, or provider-status policy.

## One outcome interpreter

Both callers pass the complete ingestion result through `interpretGameStatsRefreshOutcome`:

| Ingestion / merge reason | Interpretation | Advances last success? |
| --- | --- | --- |
| `written-clean` | success | Yes |
| `written-mixed` | partial | Yes |
| `partially-merged` | partial | Yes |
| `empty-response` | no-op | No |
| `unchanged-clean` / `stale-clean` | no-op | No |
| `invalid-payload` / `no-persistable-observations` | failure | No |
| `unchanged-mixed` / `stale-mixed` | failure | No |
| `conflict` / `unavailable` / `indeterminate` | failure | No |

Only confirmed `written` and `partially-merged` commits may advance last-success metadata.
`indeterminate` means the transaction's durable result is unknown: reread the exact partition, infer
no success, and do not retry within the same request or cron run.

## Evidence and coverage authority

The canonical schedule decides which games are expected. Evidence associates to a game by valid
positive provider game id, exact provider partition, and participant validation. Stored rows that
match no scheduled game are diagnostic evidence only and never create coverage.

`evaluatePartitionCoverage` is the coverage authority. Each expected game resolves through the
shared evidence selector, producing partition states `not-applicable`, `complete`, `partial`,
`absent`, `blocked`, or `manual-only`. Pending kickoffs and deferred placeholder matchups are
reported but are not gaps; duplicate conflicts and unmatched stored ids are explicit diagnostics.
If schedule or identity context is unavailable, coverage is unavailable rather than fabricated as
absence.

`src/lib/gameStats/coverage.ts` is deliberately narrower: it only answers whether stored rows are
usable for the admin cache-state panel. It is not the canonical coverage or analytics authority.
Public and analytics projections consume the same evidence decisions, so they cannot establish a
second association policy.

## Operator controls

The active QStash schedule is `turfwar-game-stats-15m`, calling `/api/cron/game-stats` every 15
minutes. Normal incident response is:

1. enable the global provider pause;
2. disable game-stats automation;
3. pause and inspect the QStash schedule;
4. only when the incident requires a durable writer fence, dry-run then apply
   `active -> read-only-safe`;
5. after resolving the cause, dry-run then apply `read-only-safe -> active`, resume the schedule,
   enable the dataset, and clear the global pause last.

The exact commands, authentication checks, and indeterminate-exit handling are maintained only in
the deployment runbook. Never replay the original `legacy -> armed -> active` activation sequence.

## Non-negotiable invariants

- Canonical schedule identity remains upstream of game-stat evidence.
- H2 is the sole active durable writer and requires an exact `active` control record.
- A malformed or missing control record never authorizes a write.
- Every live provider response uses the one ingestion coordinator and one outcome interpreter.
- Empty, invalid, or non-persistable payloads never erase prior-good data.
- Last-success advances only after a confirmed durable merge.
- Evidence coverage uses participant-validated canonical games, not cache presence.
- Production never transitions to `legacy`; `read-only-safe` is the emergency stop.

## Verification map

The principal regression suites are:

- `writerFence.test.ts` — strict record parsing and fenced legacy writes;
- `writerControlTransition.test.ts` — closed graph, dry run, expected-state, and durability outcomes;
- `writerControlBarrier.test.ts` — concurrency barriers around transitions and writers;
- `durableMerge.test.ts` — active-only H2 permission and merge semantics;
- `ingestionCoordinator.test.ts` — top-level classification, parsing, and one H2 call;
- `refreshOutcome.test.ts` — the shared interpretation matrix;
- `canonicalSlate.test.ts`, `evidenceAuthority.test.ts`, and `partitionCoverage.test.ts` — schedule,
  identity, evidence, and coverage behavior;
- `activation-invariants.test.ts` — live routes use only the approved ingestion/coverage boundaries.

## Historical record

The 2026 rollout, QStash activation, gates-open proof, and production `active` confirmation are in
[`../archive/operations/provider-activation-2026.md`](../archive/operations/provider-activation-2026.md#game-stats-automation).
The original frozen H3 contract remains at
[`platform-086h3-contract.md`](platform-086h3-contract.md) for design history only; its permanent
revision/lineage model was rejected and is not current architecture. The prompt and completed-work
ledgers preserve the per-slice implementation record.
