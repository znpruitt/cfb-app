# PLATFORM-086H3 — Game-Stats Lifecycle Architecture Contract (FROZEN)

Status: **Frozen target architecture.** This is the design of record for the
staged PLATFORM-086H3 decomposition (prerequisites A–E). It describes the
INTENDED end state, **not** behavior currently active on `main`. On `main`
today the game-stats writers still use the legacy path; the durable merge
authority (H2) is a merged but dormant foundation. Nothing in this contract is
active until the final activation prerequisite (E) merges.

Prerequisite progress: **A** (the durable multi-key app-state transaction
primitive that §6 relies on) **merged via PR #398**. **B** (revision
lineage/ledger authority + atomic status chronology + operator repair +
activation-control fence) is **implemented and under review-remediation, NOT
merged and NOT `/verify`-confirmed** (branch `platform/086h3b-revision-status-authority`);
its production lifecycle is inactive. **C–E remain unimplemented and E (final
activation) has not occurred**; H3 production activation has not happened; the
monolithic branch remains a frozen salvage reference; H4 and the legacy-row
migration remain deferred. The rest of this contract is future-state
architecture, not active behavior.

**Implemented-B reconciliation (PLATFORM-086H3B, authoritative for what B built):**

- **Lock graph as implemented** (monotonic under A's `(scope, key)` comparator —
  `game-stats` < `game-stats-activation-control` < `provider-refresh-status` <
  `recovery-disposition`):

  ```text
  ordinary allocation:          E(P) exclusive → S(P) exclusive   (status is a witness, below)
  legacy writer (fenced):       E(P) exclusive → activation-control SHARED
  revisioned writer/bootstrap:  E(P) exclusive → activation-control SHARED → S(P) exclusive
  operator repair validation:   E(P) exclusive → activation-control EXCLUSIVE → S(P) exclusive → C(P) exclusive
  activation transition:        activation-control EXCLUSIVE
  ```

  §6 originally said ordinary allocation is E(P)-only; the implementation refined
  this so committed refresh status is consulted on EVERY allocation under `S(P)`
  as a restoration/high-water **witness** (never the allocator).

  Lock MODE (PLATFORM-086H3B-ACTIVATION-FENCE-CONCURRENCY): the primary root and
  every `S(P)`/`C(P)` are EXCLUSIVE. The activation-control fence is held SHARED by
  ordinary writers (`lockKeyShared`), so legacy/revisioned writers for UNRELATED
  partitions commit concurrently, and EXCLUSIVE by activation transitions and repair
  CAS (`lockKey`), which therefore drain and exclude all in-flight writers. Mode
  never changes lock identity or the `(scope, key)` ordering; a shared→exclusive
  upgrade within one transaction is refused (`AppStateTxnLockUpgradeError`) and
  poisons it. The revision-history witness value is deterministic
  (`{ everExisted: true }`), so concurrent first commits under the shared fence
  cannot produce conflicting witness content.

- The durable recovery scope is **`recovery-disposition`** (single ownership
  contract). Prerequisite D MUST adopt this exact scope and MUST NOT create a
  parallel recovery scope.
- The committed-evidence status field is the lineage-aware **`lastCommittedStamp`**
  (`{ lineage, revision }`), not a scalar `lastSuccessRevision`.
- Revisioned evidence writes require the activation fence to be exactly
  **`active`**; `armed` prepares deployment but does NOT authorize evidence
  writes; `read-only-safe` fences BOTH writers; an irreversible durable
  revision-history witness prevents any resurrection of legacy ownership after
  revisioned evidence has existed; absent/malformed activation fail safe.
- Refresh **success requires a confirmed commit stamp**; counters refuse at
  `Number.MAX_SAFE_INTEGER` rather than wrapping/resetting.
- Operator repair: **applied repair is unavailable in B** (the live route refuses
  `apply`), inspection and dry-run remain available, malformed evidence is a hard
  refusal no acknowledgement can override, the CAS digest is a versioned canonical
  hash over the COMPLETE inspected durable state, audit availability is explicit
  (`available`/`absent`/`unavailable`), and raw storage errors never reach a
  response. The public game-stats wire strips the internal commit stamp.
- Repair presence + evidence + audit hardening (PLATFORM-086H3B-REPAIR-PRESENCE-H1-AUDIT):
  every durable row repair inspects or hashes is read PRESENCE-AWARE (a
  `DurableRead` built before `.value`), so a **present JSON-null row is never
  collapsed into absence** — absent / present-null / present-valid / present-malformed
  produce DIFFERENT CAS digests, a present-null partition is malformed (not absent),
  a present-invalid ledger (incl. JSON-null) is an ambiguous marker that blocks
  new-lineage init, and an absent↔present-null change is caught as
  `revision-repair-state-changed`. Repair evidence is certified through the **actual
  H1 durable contract** (`classifyGameStatsRow`) — not a second row contract — plus
  canonical (round-tripping) `fetchedAt` and per-row partition-identity consistency;
  anything H1 would withhold/reject/treat-as-malformed is `revision-repair-evidence-malformed`.
  Every nested audit object (ledger, commit stamps, action, after-state,
  surviving-high-water) is **rebuilt field-by-field against an exact allowlist** (no
  raw stored object retained by reference); any unexpected or malformed nested field
  makes the WHOLE audit dataset `unavailable` (never silently stripped), so arbitrary
  stored content can never reach the route response.
- Dormant-boundary guard (PLATFORM-086H3B-DORMANT-BOUNDARY-GUARD-REMEDIATION +
  PLATFORM-086H3B-DORMANT-BOUNDARY-LAUNDERING-REMEDIATION): the admin revision route
  is **scanned, not excluded** — its production capability surface is an explicit
  parser-backed allowlist (TypeScript compiler API), so **inspection and dry-run
  planning are the ONLY sanctioned B-stage operations** it can reach. **Dry-run
  planning is implemented in a MUTATION-FREE owner** (`revisionRepairPlanning.ts`,
  read-only `getAppState`, no transaction, no import path to applied repair); the
  applied service (`repairRevisionState`, in `revisionRepair.ts`) CONSUMES that
  planner. The route imports its revision capabilities exclusively through the
  inspection facade (`revisionRepairInspection.ts`), which imports ONLY from the
  planner — so the facade has **no direct or transitive runtime dependency on the
  applied-repair service or on `withAppStateKeyTransaction`/`setAppState`**. The
  parser resolves re-export/multi-hop/mixed-barrel chains, REJECTS local
  side-effect imports (`import './x'`) and import-equals, and TRACES local aliases
  and wrapper functions (declarations/arrows, chained/destructured aliases, local
  helper hops, namespace member access) to the runtime capabilities they use, so an
  **approved export NAME can never conceal a forbidden terminal**. It fails closed on
  unresolved/computed access. Applied repair, revisioned writes, activation
  transitions, status/chronology publication, recovery, and generic app-state
  mutation cannot reach the route by any form. Applied repair and every lifecycle
  mutation remain dormant.

Owner: PLATFORM / game-stats. Binding project rules in `AGENTS.md` win on any
conflict; this file is the domain design freeze the staged PRs implement. The
oversized single-branch implementation
(`platform/086h3-atomic-game-stats-contract-activation`, HEAD `e1a9593`) is
frozen as a **read-only salvage reference** and is never merged.

---

## 0. Why this exists

A branch-wide architecture audit concluded the monolithic H3 branch was
**unreviewable as one unit** and must be decomposed into cohesive, independently
reviewable, verifiable, and revertible prerequisite PRs. This contract freezes
the authoritative design so the slices implement one agreed architecture rather
than re-deriving it. Two audit findings are incorporated as first-class
corrections (see §5 lineage and §17 activation-control fence).

---

## 1. Canonical identity (schedule-owned)

- Schedule-derived canonical `AppGame`s are the SOLE game identity. No parallel
  game-identity construction. Scores, odds, ownership, standings, archive,
  insights, and game stats attach to schedule-derived canonical games.
- A provider game id ALONE never authorizes persistence.

## 2. Participant resolution

- Every participant resolves through `src/lib/teamIdentity.ts` (team-catalog +
  alias authority). "Resolved" means resolution status `resolved` AND a
  non-empty canonical identity key.
- Normalized text is NEVER an identity. Registry-unknown labels defer (typed),
  never match, and never merge (collision-safe: distinct labels never collapse).

## 3. Eligible classification

- Explicit allowlist: `FBS|FBS`, `FBS|FCS`, `FCS|FBS`. Any UNKNOWN side defers.
  `FCS|FCS` is excluded even when scheduled. Classification derives from resolver
  identity first, canonical-schedule conference policy as fallback for
  catalogued-without-level teams — never from provider-stat availability, never
  by defaulting unknown to FCS.

## 4. Evidence ownership

- ONE durable merge authority (`durableMerge.ts`) owns every game-stats write.
  Every writer routes through it or the same per-partition advisory-locked
  transaction. The blind partition overwrite (`setCachedGameStats`) is deleted.
  No writer may reach the evidence scope through a mutation primitive.

## 5. Revision lineage & monotonic ownership (audit correction)

- The durable commit stamp is **lineage-aware**: `{ lineage, revision }`.
  `lineage` is a stable per-scope epoch id allocated once at genuine
  initialization and carried on the ledger, the partition, and the status row;
  `revision` is the monotonic per-partition counter.
- The per-scope revision ledger (`game-stats-revision`, key
  `year:week:seasonType`, schema-versioned) is, once initialized, the SOLE
  ordinary allocator (`revision + 1`). Refresh status is NEVER the ordinary
  allocation authority.
- A missing revision field ALONE never proves a scope is new.

  | State                                                                | Allocation                                                       |
  | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
  | Genuinely new (no partition, no status marker, no ledger)            | new `lineage`, `revision = 1` (`initializedFrom: new`)           |
  | Recognized pre-revision legacy (explicit legacy shape)               | new `lineage`, `revision = 1` (`initializedFrom: legacy`)        |
  | Initialized ledger, same lineage                                     | `revision = ledger.revision + 1`                                 |
  | Partial restoration, surviving SAME-lineage history above the ledger | continue that lineage at `max(valid floors) + 1`                 |
  | Conflicting lineage (partition/status carry a different lineage)     | typed `revision-lineage-conflict` refusal — no write             |
  | Ambiguous/corrupt (revision-era markers, no usable source)           | typed `revision-history-ambiguous` refusal — no write            |
  | Operator repair                                                      | admin-only, precondition-guarded, advisory-locked, audited (§14) |

## 6. Evidence/revision transaction boundaries & lock order

- Evidence and its revision-ledger row co-commit in ONE advisory-locked
  transaction (both persist or neither). PostgreSQL: one client, one
  `BEGIN`/`COMMIT`, transaction-scoped advisory locks, read-your-writes,
  conservative uncertain-COMMIT handling, uncertain-client destruction. File
  fallback: staged writes, one atomic replacement, all-or-nothing rollback,
  no partial persistence (dev/test only — production requires PostgreSQL).
- Lock order is **acyclic and ENFORCED** by the transaction primitive, not by
  caller discipline. Lock identity is an INJECTIVE `(scope, key)` tuple
  (`JSON.stringify([scope, key])`, so distinct tuples never collide — unlike a
  delimiter-concatenated encoding — and it is identical on both backends and to
  the PostgreSQL advisory-lock hash input; persisted app-state ROW keys are
  unchanged). Every `lockKey` request is SERIALIZED by the primitive in
  invocation order — each classifies and acquires (or rejects) fully before the
  next runs — so overlapping/`Promise.all` calls behave exactly as
  sequentially-awaited ones and deadlock prevention does NOT depend on callers
  awaiting calls sequentially. Ordering state (highest-held tuple, held set)
  advances ONLY after a lock is successfully acquired; a request that does not
  sort strictly above the highest held tuple is rejected fail-fast with
  `AppStateTxnLockOrderError` before any wait or advisory-lock query (reacquiring
  a held lock is idempotent). A `lockKey` is a REQUIRED lock: finalization drains
  EVERY invoked lock request, and any failed acquisition — ordering rejection or
  backend failure — makes the transaction NONCOMMITTABLE (rolled back / staged
  writes discarded), even when its individual promise was un-awaited, caught, or
  discarded. A caught or ignored lock failure therefore cannot be erased. When
  the callback ALSO fails, the two combine into ONE total, nonthrowing typed
  dual error (`AppStateTxnCallbackLockError`: the callback value verbatim as
  `cause`, the typed lock failure as `lockFailure`) for every JavaScript throw
  shape — the callback value is never mutated; a propagated lock rejection is
  thrown directly. The final dual error is CONSTRUCTED only AFTER complete
  backend cleanup: on PostgreSQL, after `ROLLBACK` and client containment
  (release when clean, destroy when uncertain); on the file fallback, after the
  staged state is discarded and every secondary AND the primary lock slot are
  released (the public error is shaped through a deferred descriptor once the
  primary slot's chain entry is gone). A failed rollback retains all three
  (callback, lock, cleanup) through the existing typed cleanup/uncertainty
  contract. The only multi-lock path is
  `partition -> status` (the one-time revision bootstrap consulting status
  history under that key's own lock), and because the `game-stats` partition
  tuple sorts below the `provider-refresh-status` tuple, that direction is the
  accepted forward order while the reverse is rejected — so opposite-root
  transactions can never invert and deadlock. (Prerequisite A ships and enforces
  this generic comparator; B supplies the partition/status callers.)
- **Shared vs exclusive secondary locks** (PLATFORM-086H3B-ACTIVATION-FENCE-
  CONCURRENCY, a BOUNDED extension of A's primitive): `lockKeyShared` acquires a
  SHARED secondary lock and `lockKey` an EXCLUSIVE one; the primary root is always
  EXCLUSIVE. On PostgreSQL, shared uses `pg_advisory_xact_lock_shared` and
  exclusive `pg_advisory_xact_lock` on the SAME canonical advisory key; on the file
  fallback, a fair in-process reader/writer lock (FIFO with reader coalescing)
  admits concurrent shared holders, excludes on an exclusive holder, and — for
  fairness — never lets a later shared arrival bypass a queued exclusive. Mode NEVER
  affects tuple ordering, lock identity, persisted identity, or the deadlock
  comparator; the strongest held mode per identity is tracked so a shared→exclusive
  UPGRADE within one transaction is refused fail-fast (`AppStateTxnLockUpgradeError`)
  and POISONS the transaction under the same required-lock contract (a
  same/weaker-mode reacquisition is an idempotent no-op). The activation-control
  fence uses this: ordinary writers hold it SHARED (unrelated partitions concurrent),
  transitions and repair CAS hold it EXCLUSIVE (draining and excluding writers). All
  previously stated poisoning, cleanup-before-shaping, uncertain-COMMIT, and
  accessor-lifetime guarantees hold identically for both modes.

## 7. Refresh-status attempt vs evidence chronology

- Attempt chronology (the begin marker) is SEPARATE from committed-success
  chronology (the lineage-aware `lastCommittedStamp`). Every status mutation
  (begin / success /
  no-op / failure) is ONE per-scope durable transaction returning a typed
  result. Publication reports a composite `{ begin, terminal, complete }`; a
  terminal write records its attempt truthfully even when the begin marker never
  persisted, while a genuinely stale attempt never overwrites a newer one.
- Every TERMINAL mutation REQUIRES an explicit attempt handle (mandatory at the
  type boundary + runtime-validated): a missing handle →
  `game-stats-refresh-attempt-required`, a malformed/misrouted one →
  `game-stats-refresh-attempt-malformed`. Ownership needs BOTH a matching token
  AND ordinal; tokenless terminals always refuse and are never treated as latest.
  The failed-begin exception is honored ONLY through the explicit handle whose
  begin persistence failed (ordinal strictly above the stored ordinal). A stored
  attempt ordinal is valid only as a POSITIVE safe integer — `0`/negative/unsafe/
  non-number is `refresh-attempt-ordinal-malformed` (refused, never reset to 1;
  absence alone begins at 1), and a valid ordinal at `Number.MAX_SAFE_INTEGER` is
  `refresh-attempt-ordinal-exhausted`.
- Failed-begin authority is RUNTIME-OPAQUE (PLATFORM-086H3B-FAILED-BEGIN-PROVENANCE):
  it is tied to the EXACT handle object `beginGameStatsRefreshAttempt` returned
  after its own durable write failed — recorded in a module-private `WeakMap` and
  re-verified by object identity + field agreement — NOT to the structural
  `persistence: 'failed'` field. A fabricated, copied/spread, serialized,
  reconstructed, proxied, field-mutated, or prior-process handle has NO authority
  (`game-stats-failed-begin-handle-invalid`). The exception authorizes the FAILURE
  terminal ONLY — a failed-begin handle on success/no-op refuses
  `game-stats-failed-begin-terminal-not-allowed` and never advances committed
  evidence. It is one-shot (consumed only after confirmed persistence; a failed
  terminal write stays retry-eligible; a handle claiming `persistence: 'failed'`
  never owns normally). A later persisted attempt always supersedes it
  (`skipped-older`), and provenance is process-local — a process restart invalidates
  a nonpersisted handle while normally persisted handles stay durably authorized by
  token + ordinal. Both new refusals keep the composite `complete: false`.

## 8. Recovery claims, backoff, quota bounds

- Per-partition disposition: fenced `attemptToken` + lease, escalating backoff
  (30m -> 7d cap), terminal manual-action state, meaningful-progress reset
  derived ONLY from committed-coverage / canonical-schedule fingerprints.
  Newest-eligible candidate rotation. At most ONE provider request per weekly
  cron run. Claims are never held across provider access.

## 9. Schedule identity validation — three points (audit correction)

- Canonical participants are validated: (1) BEFORE provider access (target
  validation), (2) AFTER provider access and BEFORE durable merge (attachment
  agreement in schedule orientation, neutral-site reversed orientation allowed),
  and (3) DURING committed coverage evaluation.

## 10. Committed coverage identity

- Committed coverage validates canonical PARTICIPANTS, not just the provider
  game id. A durable row whose resolved participants no longer match the current
  canonical scheduled pair is a typed gap (`identity-mismatch`), NEVER satisfied
  evidence.

## 11. One evidence-level duplicate authority

- A SINGLE duplicate authority decides winner selection AND conflict detection
  from evidence identity (provider id, resolved participant pair, schema class,
  and fence lineage). It is consumed identically by committed coverage, public
  projection, analytics, archive integrity, and diagnostics. Projection-specific
  FIELD eligibility may differ; winner selection and conflict detection must not.
  A coverage-satisfied game can never publish `games: []`.

## 12. Public projection & availability

- The public wire is ALWAYS constructed from explicit allowlists at every level
  (envelope, game, team, and `raw` restricted to recognized contract
  categories). No persisted object is returned by reference; internal metadata
  never reaches the wire. Ordinary reads are provider-free with a
  coverage-derived `meta.availability` summary; strict `seasonType`; typed
  corrupt / malformed / read-failure outcomes distinct from absence.

## 13. Diagnostics & safe error contracts

- Post-claim revalidation failures carry STAGE-SPECIFIC stable codes and safe
  summaries; the raw storage/SQL/path/token/stack cause is logged server-side
  ONLY. The recovery-metadata failure code appears ONLY when a recovery-metadata
  operation actually failed.

## 14. Operator recovery for blocked revision history

- A narrowly scoped, ADMIN-ONLY inspection/repair operation resolves
  `revision-history-ambiguous` and `revision-lineage-conflict`. It checks
  expected-current-state, runs under the same advisory lock, takes explicit
  lineage/revision inputs, defaults to dry-run/inspect, writes an audit trail,
  refuses on precondition mismatch, and NEVER requires ad hoc direct database
  manipulation.

## 15. Bounded static architecture-guard guarantees

- The activation guard proves, over static TypeScript imports/aliases/wrappers/
  exports: no unauthorized IMPORT of guarded capabilities; no re-export or
  forwarding-wrapper laundering; connected lifecycle wiring. It does NOT claim
  runtime/dynamic-dispatch reachability. A genuine internal-argument domain API
  is intentionally allowed.

## 16. Deferred scope

- PLATFORM-086H4 presentation / `GameStatsCachePanel` wording and the legacy-row
  migration are OUT of scope for this contract and every A–E prerequisite.

## 17. Decomposition (A–E) and the activation-control fence (audit correction)

The lifecycle ships as five cohesive, independently reviewable, revertible PRs.
No prerequisite may create a temporary competing writer system; every new
capability stays DORMANT (guarded) until E connects it.

| PR    | Scope                                                                                                                                                        | Dormant until E?                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| **A** | Durable multi-key transaction primitive (`readKey`/`writeKey`/`lockKey`, staged atomic file commit, seams) + this contract                                   | pure capability, activates nothing  |
| **B** | Revision lineage/ledger authority + atomic status chronology + operator repair + **durable activation-control fence**                                        | writer dormant; repair admin-only   |
| **C** | Canonical evidence authority (ingestion, coverage with participant validation, public projection, ONE duplicate authority, score evidence, identity context) | new modules dormant                 |
| **D** | Recovery + orchestration (disposition, planning, finalize path, orchestration entry, read boundary, sanitized errors)                                        | orchestration/read boundary dormant |
| **E** | Final atomic activation: routes, diagnostics, analytics, guards; delete `setCachedGameStats`; swap dormant-boundary → activation guard                       | this IS activation                  |

**Activation-control fence (correction):** PR B introduces a DURABLE fence such
that, once revisioned evidence exists for a scope, the legacy (pre-revision)
writer can never resume writing that scope. This prevents a rollback or a stale
deploy from reintroducing a blind-overwrite writer alongside revisioned
evidence — the fence is checked by any writer before persisting, and it makes
the A→E sequence safe to land and revert incrementally without a window in which
two writer lifecycles compete.

Merge order is strictly linear: `A -> B -> C -> D -> E`.

---

## 18. Final activation (E) — the atomic connection

E, and only E, connects in one revertible step:

```text
canonical schedule
  -> validated ingestion
    -> H2 durable evidence authority
      -> revision / status lifecycle
        -> recovery
          -> public + diagnostic + analytics + archive consumers
```

Because A–D are dormant and fenced, reverting E alone fully de-activates the
lifecycle without disturbing the foundations.
