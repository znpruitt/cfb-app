# PLATFORM-086H3 — Game-Stats Lifecycle Architecture Contract (FROZEN)

Status: **Frozen target architecture.** This is the design of record for the
staged PLATFORM-086H3 decomposition (prerequisites A–E). It describes the
INTENDED end state, **not** behavior currently active on `main`. On `main`
today the game-stats writers still use the legacy path; the durable merge
authority (H2) is a merged but dormant foundation. Nothing in this contract is
active until the final activation prerequisite (E) merges.

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
  caller discipline: `lockKey` compares the canonical `(scope, key)` identity
  and rejects any acquisition that does not sort strictly above the highest
  lock the transaction already holds (fail-fast `AppStateTxnLockOrderError`,
  before any wait or advisory-lock query; reacquiring a held lock is
  idempotent). The only multi-lock path is `partition -> status` (the one-time
  revision bootstrap consulting status history under that key's own lock), and
  because `game-stats::…` sorts below `provider-refresh-status::…`, that
  direction is the accepted forward order while the reverse is rejected — so
  opposite-root transactions can never invert and deadlock. (Prerequisite A
  ships and enforces this generic comparator; B supplies the partition/status
  callers.)

## 7. Refresh-status attempt vs evidence chronology

- Attempt chronology (the begin marker) is SEPARATE from committed-success
  chronology (`lastSuccessRevision`). Every status mutation (begin / success /
  no-op / failure) is ONE per-scope durable transaction returning a typed
  result. Publication reports a composite `{ begin, terminal, complete }`; a
  terminal write records its attempt truthfully even when the begin marker never
  persisted, while a genuinely stale attempt never overwrites a newer one.

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
