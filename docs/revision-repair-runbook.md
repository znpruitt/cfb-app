# Game-Stats Revision Repair & Activation-Control Runbook

Status: Current
Last verified: 2026-07-20
Owner: PLATFORM / game-stats
Canonical for: operating the PLATFORM-086H3B revision authority, activation-control
fence, and admin-only revision repair. Binding architecture is
`docs/ai/platform-086h3-contract.md` (frozen) and `AGENTS.md`; this runbook is
operational guidance, not a design source of truth.

> **Dormant today.** Everything below is BUILT and tested but production-dormant.
> No production route/cron arms or activates the fence, calls the revisioned
> writer, or allocates a revision. The legacy writer (`setCachedGameStats`)
> remains the production game-stats writer while the fence is `legacy`. This
> runbook is the operating manual E will hand to operators once the lifecycle is
> activated; the repair surface itself is already reachable (admin-only) so a
> blocked revision can be inspected and repaired even during staged rollout.

---

## 1. Concepts

- **Commit stamp** `{ lineage, revision }` — the durable, lineage-aware ordering
  token. `lineage` is an opaque per-scope epoch id; `revision` is a monotonic
  per-partition counter. Revisions compare **only within the same lineage**;
  different lineages are never numerically ordered.
- **Revision ledger** (`game-stats-revision`, keyed `year:week:seasonType`) — once
  initialized, the **sole** ordinary allocator (`revision + 1`). Refresh status is
  never the ordinary allocation authority.
- **Activation control** (`game-stats-activation-control/global`) — the durable
  fence with states `legacy | armed | active | read-only-safe`.
- **Recovery disposition** (`recovery-disposition`, per partition) — D's per-partition
  recovery claim; repair refuses while an unexpired claim exists.

## 2. Inspection (always start here)

`GET /api/admin/game-stats-revision?year=YYYY&week=W&seasonType=regular|postseason`
(platform-admin only) returns:

- a **safe** structured view of the partition stamp, ledger, committed-evidence
  status stamp, and recovery-claim state (never raw SQL, paths, or tokens);
- the **`expectedStateDigest`** — a compare-and-set token you must echo back to
  authorize a repair;
- the append-only **audit trail** for the partition.

Inspection is read-only. It never writes and never contacts a provider.

## 3. Safe refusal states (why the automatic writer blocked)

The revision authority BLOCKS rather than guess. Every block preserves all durable
state and writes nothing:

| Code                              | Meaning                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `revision-lineage-conflict`       | Valid sources disagree on lineage.                                       |
| `revision-history-ambiguous`      | Malformed/unexplained revision-era state, no usable source.              |
| `revision-evidence-loss-suspected`| Ledger/status record committed evidence newer than the surviving partition, or evidence is absent while committed history survives. |

A **missing revision field alone never** proves a scope is new — only a genuinely
empty scope (no partition, ledger, committed-success lineage, revision-era marker,
or repair history) mints lineage 1.

## 4. Repair (admin-only, precondition-guarded, audited)

`POST /api/admin/game-stats-revision` (platform-admin only). Body:

```jsonc
{
  "identity": { "year": 2025, "week": 3, "seasonType": "regular" },
  "expectedStateDigest": "<from inspection>",   // CAS — refused if state changed
  "reason": "restored week 3 from backup",       // required, audited
  "apply": false,                                 // default is DRY-RUN (plan only)
  "action": { "kind": "rebuild-ledger" },
  "acknowledgeLineageConflict": false,
  "acknowledgeEvidenceLoss": false
}
```

**Preconditions (every repair):** platform-admin auth; exact partition; a matching
`expectedStateDigest` (else `state-changed`); no unexpired recovery claim (else
`active-recovery-claim`); default dry-run (`apply` must be `true` to write).

**Supported actions (the only ones):**

1. **`rebuild-ledger`** — rebuild a missing/behind ledger from **surviving
   same-lineage partition evidence**. Refuses malformed/stampless evidence.
2. **`adopt-lineage` `{ lineage, floor }`** — adopt an operator-attested restored
   lineage and floor. Refuses a `floor` below surviving same-lineage evidence
   (`floor-below-surviving-evidence`); requires `acknowledgeLineageConflict` when
   surviving evidence carries a different/malformed lineage.
3. **`establish-new-lineage` `{ floor? }`** — after **acknowledged** evidence loss
   (`acknowledgeEvidenceLoss` required), mint a new lineage at `floor` (default 1);
   the superseded lineage is preserved in the audit trail.

Repair **never alters game-stat rows or fabricates provider evidence.** It writes
only the revision ledger, the committed-evidence status stamp (to establish a
lineage transition), and — for a present partition — the partition's internal
commit-stamp **metadata** (rows untouched). Every applied repair appends an audit
record (actor, time, reason, before digest, action, safe after state) and stamps
the ledger with the audit reference.

Lock order is `E(P) → S(P) → C(P)` (evidence → refresh status → recovery
disposition), enforced by the transaction primitive.

## 5. Activation states & the fence

| State            | Legacy writer | Revisioned writer | Notes                                    |
| ---------------- | ------------- | ----------------- | ---------------------------------------- |
| `legacy`         | ✅ allowed     | ❌ fenced          | Behavior-equivalent to current `main`.   |
| `armed`          | ❌ fenced      | ✅ allowed          | Legacy writing fenced off; arming step.  |
| `active`         | ❌ fenced      | ✅ allowed          | Revisioned evidence exists.              |
| `read-only-safe` | ❌ fenced      | ❌ fenced          | Safe stop — reads only.                   |

Invariants: `active` is reachable only from `armed` (never straight from
`legacy`); **once revisioned evidence has existed, returning to `legacy` is
permanently forbidden**; an absent record resolves to `legacy` (safe — reaching any
non-legacy state requires an explicit write); a malformed record resolves to
`read-only-safe`.

## 6. Deployment & rollback

- Landing A→E incrementally is safe **because** the fence is durable: a stale or
  rolled-back deploy cannot reintroduce a blind legacy writer alongside revisioned
  evidence (the fence rejects the legacy writer once `armed`/`active`).
- Reverting the eventual activation (E) alone de-activates the lifecycle without
  disturbing A–D; the durable fence prevents a competing-writer window.
- No B deploy transitions production into `armed`/`active`. Arming/activation is an
  explicit, operator-driven E step.

## 7. Prohibitions

- **Never edit the durable database directly** to fix a revision. Use inspection +
  the guarded repair actions; they enforce CAS, claim, floor, acknowledgement, and
  audit invariants that ad-hoc edits bypass.
- Never hand-write a commit stamp into evidence, or a ledger row, outside repair.
- Never force `legacy` after evidence has existed.
