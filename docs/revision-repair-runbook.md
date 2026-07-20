# Game-Stats Revision Repair & Activation-Control Runbook

Status: Current
Last verified: 2026-07-20
Owner: PLATFORM / game-stats
Canonical for: operating the PLATFORM-086H3B revision authority, activation-control
fence, and admin-only revision repair. Binding architecture is
`docs/ai/platform-086h3-contract.md` (frozen) and `AGENTS.md`; this runbook is
operational guidance, not a design source of truth.

> **Dormant lifecycle, LIVE fence (PLATFORM-086H3B-ACTIVATION-DORMANCY-REMEDIATION).**
> The revisioned writer, revision allocation, the transition into `armed`/`active`,
> and APPLIED repair are all production-dormant. What is now LIVE is the fence
> itself: the real production legacy writer (`setCachedGameStats`) is routed
> through it, so a legacy write commits only while the fence is validly `legacy`.
> In production the fence is `legacy` (B arms/activates nothing), so the legacy
> writer behaves exactly as before. The admin route offers inspection and dry-run
> planning only — applied repair is refused (`revision-repair-application-not-active`)
> until a later prerequisite strips internal metadata from the public wire and
> activates ownership.

---

## 1. Concepts

- **Commit stamp** `{ lineage, revision }` — the durable, lineage-aware ordering
  token. `lineage` is an opaque per-scope epoch id; `revision` is a monotonic
  per-partition counter. Revisions compare **only within the same lineage**;
  different lineages are never numerically ordered.
- **Revision ledger** (`game-stats-revision`, keyed `year:week:seasonType`) — once
  initialized, the **sole** ordinary allocator (`revision + 1`). Refresh status is
  never the ordinary allocation authority.
- **Committed refresh status** — a mandatory **restoration / high-water witness**
  consulted on EVERY allocation (ordinary and bootstrap), under the `S` lock. It
  never allocates, but it BLOCKS allocation when it proves history newer than (or
  a different lineage from) the surviving partition/ledger, so a restored-behind
  ledger can never reuse a commit stamp already represented in status.
- **Activation control** (`game-stats-activation-control/global`) — the durable
  fence with states `legacy | armed | active | read-only-safe`.
- **Recovery disposition** (`recovery-disposition`, per partition) — D's per-partition
  recovery claim; repair refuses while an unexpired claim exists.

## 2. Inspection (always start here)

`GET /api/admin/game-stats-revision?year=YYYY&week=W&seasonType=regular|postseason`
(platform-admin only) returns:

- a **safe** structured view of the partition stamp, ledger, committed-evidence
  status stamp, and recovery-claim state (never raw SQL, paths, or tokens);
- the **`expectedStateDigest`** — a versioned, canonical SHA-256 digest over the
  COMPLETE inspected durable state (partition envelope + every game row +
  metadata + commit stamp + ledger + committed status + activation + irreversible
  witness + recovery-disposition/claim + audit + identity). Object-key order does
  not change it; the raw evidence is hashed, never embedded. Echo it back to
  authorize a repair (CAS); the version prefix makes an incompatible digest fail
  clearly.
- a typed **audit availability** — `available` (a successfully read list, empty
  or not), `absent` (no audit dataset ever written), or `unavailable` (read
  failed or malformed). A failed read is NEVER reported as empty history.

Inspection is read-only. It never writes and never contacts a provider. A store
failure returns a redacted `revision-repair-inspection-unavailable` (raw storage
errors are logged server-side only, never returned).

## 3. Safe refusal states (why the automatic writer blocked)

The revision authority BLOCKS rather than guess. Every block preserves all durable
state and writes nothing:

| Code                               | Meaning                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `revision-lineage-conflict`        | Valid sources (partition, ledger, or committed status) disagree on lineage.                                                         |
| `revision-history-ambiguous`       | Malformed/unexplained revision-era state, no usable source.                                                                         |
| `revision-evidence-loss-suspected` | Ledger/status record committed evidence newer than the surviving partition, or evidence is absent while committed history survives. |
| `revision-counter-exhausted`       | The revision counter reached `Number.MAX_SAFE_INTEGER` — refuse rather than wrap.                                                   |

A **missing revision field alone never** proves a scope is new — only a genuinely
empty scope (no partition, ledger, committed-success lineage, revision-era marker,
or repair history) mints lineage 1.

**Refresh-status success & counter safety** (PLATFORM-086H3B-RESTORATION-STATUS-REMEDIATION):

- A game-stats refresh **success requires a confirmed commit stamp**. A missing,
  malformed, or unsafe stamp is refused (`game-stats-success-commit-stamp-required`):
  nothing is persisted, no error is cleared, no attempt is marked succeeded, and
  the composite is never `complete`. Stamp-free terminals (filtered targets,
  unchanged evidence, provider-empty, skipped publication) use the explicit no-op
  API — the ONLY stamp-free successful terminal path.
- **Counters refuse at exhaustion, never wrap or reset.** A revision at
  `Number.MAX_SAFE_INTEGER` → `revision-counter-exhausted`; an attempt ordinal at
  the bound → `refresh-attempt-ordinal-exhausted`; an
  unadvanceable repair floor (nonpositive / unsafe / `MAX_SAFE_INTEGER`) →
  `revision-repair-floor-not-advanceable` (refused at planning AND apply).

**Terminal attempt ownership & ordinal validity** (PLATFORM-086H3B-STATUS-ATTEMPT-OWNERSHIP-REMEDIATION):

- **Every terminal status mutation requires an explicit attempt handle** from
  `beginGameStatsRefreshAttempt`, mandatory at the type boundary AND re-validated at
  runtime (non-empty token, positive safe-integer ordinal, non-empty start
  timestamp, exact scope identity). A missing handle → `game-stats-refresh-attempt-required`;
  a structurally invalid or misrouted handle → `game-stats-refresh-attempt-malformed`.
  Both refuse before any storage mutation and never claim `complete`.
- **Ordinal AND token jointly establish latest-attempt ownership.** A normal
  persisted attempt owns the chronology only when BOTH match the stored latest; a
  matching token with a stale/unknown ordinal, or a matching ordinal with a wrong
  token, does not win. **Tokenless terminals always refuse** — a missing handle is
  never treated as the latest attempt. Stale attempts return `skipped-older` and
  write nothing (outcome, error, timestamps, and committed evidence all preserved).
- **The failed-begin exception requires its explicit returned handle.** Only a
  handle whose own begin persistence failed (`persistence === 'failed'`) may record
  its bounded outcome, and only when its ordinal strictly exceeds the stored
  ordinal; it can never be recreated from a missing/tokenless argument and can never
  overwrite a later successfully persisted attempt.
- **Ordinal `0` is malformed history, not absence.** A valid stored ordinal is a
  POSITIVE safe integer; `0`, negative, fractional, unsafe, or non-number values are
  `refresh-attempt-ordinal-malformed` (refused, the durable record preserved for
  inspection/repair, never silently restarted at 1). Only a genuinely ABSENT ordinal
  begins a first attempt at `1`. Attempt-state absence, ordinal-malformed, and
  ordinal-exhausted stay distinct states.

## 4. Repair (admin-only, precondition-guarded, audited)

`POST /api/admin/game-stats-revision` (platform-admin only). Body:

```jsonc
{
  "identity": { "year": 2025, "week": 3, "seasonType": "regular" },
  "expectedStateDigest": "<from inspection>", // CAS — refused if state changed
  "reason": "restored week 3 from backup", // required, audited
  "apply": false, // DORMANT in B — apply is refused
  "action": { "kind": "rebuild-ledger" },
  "acknowledgeLineageConflict": false,
  "acknowledgeEvidenceLoss": false,
}
```

> **Applied repair is DORMANT through the live route in prerequisite B.** An
> `apply: true` request is refused with a stable `revision-repair-application-not-active`
> (HTTP 409) and writes **nothing** — no partition stamp, no ledger, no status
> stamp, no audit record. Inspection (GET) and dry-run PLANNING (POST without
> `apply`) remain fully available. The repair-planning service still calculates
> and returns the plan; the live route simply never executes it until a later
> prerequisite strips internal metadata from the public wire and activates
> ownership. The preconditions below describe the intended applied behavior E
> will enable.

**Preconditions (every repair — enforced during planning AND, once enabled,
transactional apply):**

- platform-admin auth; exact partition;
- a matching complete-state `expectedStateDigest` (else `revision-repair-state-changed`);
- **structurally valid evidence** — a malformed weekly envelope, invalid/inconsistent
  partition identity, malformed commit stamp, revision-era rows without a valid
  stamp, or an unsafe revision is a HARD refusal (`revision-repair-evidence-malformed`)
  for EVERY action that **no acknowledgement can override**;
- no unexpired recovery claim (else `active-recovery-claim`);
- an advanceable floor (else `revision-repair-floor-not-advanceable`);
- default dry-run.

A store failure returns a redacted `revision-repair-planning-unavailable` (raw
storage/SQL/path/stack text is logged server-side only, never returned).

**Surviving high-water (PLATFORM-086H3B-REPAIR-HIGH-WATER).** The highest
surviving committed revision for a lineage is computed from **every** valid
durable witness — the partition commit stamp, the **revision ledger**, and the
committed refresh-status stamp — comparing revisions only WITHIN one lineage. **A
valid ledger can never be lowered**, and no accepted plan may let a later
allocator reuse a revision already represented by surviving history.

**Floor semantics.** A repair `floor` is the **last committed revision** — the
next allocator issues `floor + 1`. So `floor` must be **at or above** the surviving
same-lineage high-water; then the next allocation is strictly above all surviving
history.

**Supported actions (the only ones):**

1. **`rebuild-ledger`** — rebuild a missing/behind ledger UP to the surviving
   same-lineage high-water (never downward). Refuses malformed/stampless evidence,
   a witness on a different lineage (`revision-repair-lineage-conflict`), and a
   ledger/status **ahead** of the surviving partition
   (`revision-repair-ledger-ahead-of-evidence` — rebuilding down would erase higher
   chronology / mask evidence loss; use adopt- or establish- instead).
2. **`adopt-lineage` `{ lineage, floor }`** — adopt an operator-attested restored
   lineage and floor. Refuses a `floor` below the surviving same-lineage
   high-water (`revision-repair-floor-below-surviving-history`) or a non-advanceable
   floor; requires `acknowledgeLineageConflict` when surviving evidence carries a
   different/malformed lineage.
3. **`establish-new-lineage` `{ floor? }`** — after **acknowledged** evidence loss
   (`acknowledgeEvidenceLoss` required), mint a **genuinely different** lineage at
   `floor` (default 1); the new lineage's revisions are never numerically compared
   with the abandoned one, and the prior lineage + its high-water are preserved in
   the audit trail. Conflicting or suspected-lost history is resolved here (a new
   lineage), never by reusing revisions.

Repair **never alters game-stat rows or fabricates provider evidence.** It writes
only the revision ledger, the committed-evidence status stamp (to establish a
lineage transition), and — for a present partition — the partition's internal
commit-stamp **metadata** (rows untouched). Every applied repair appends an audit
record (actor, time, reason, before digest, action, safe after state) and stamps
the ledger with the audit reference.

**Evidence certification (PLATFORM-086H3B-REPAIR-STRUCTURE-CAS-AUDIT).** Before any
action, a bounded runtime classifier (aligned with the revision authority)
certifies the full envelope: exact identity, a valid `fetchedAt`, a `games` array
in which **every** row satisfies the bounded durable game-stat contract (game +
participant identity, well-formed stat containers), and a valid `commitStamp` if
present. A malformed timestamp or game row (or a mixed valid/invalid `games`
array) is a hard `revision-repair-evidence-malformed` refusal that **no
acknowledgement can override**.

Lock order is
**`E(P) exclusive → activation-control EXCLUSIVE → S(P) exclusive → C(P) exclusive`**,
enforced by the transaction primitive. Repair takes the activation-control fence
**EXCLUSIVE** (`lockKey`) — unlike ordinary legacy/revisioned writers, which hold it
SHARED (`lockKeyShared`) so unrelated partitions commit concurrently. The exclusive
fence is acquired **before** reading the activation record and irreversible witness
(both bound by the CAS digest) and DRAINS every in-flight shared writer, so no
concurrent activation transition — nor any partition's first revisioned commit
touching the global witness — can mutate those inputs inside the CAS window; a
completed change is caught as `revision-repair-state-changed`.

**Audit history is validated entry-by-entry.** `readRevisionAuditTrail` returns
`available` only when the dataset is a valid array in which every entry passes
validation (versioned, allowlisted fields only, order preserved); a non-array, any
malformed entry, any unapproved/extra field, or a read failure is `unavailable`
(never silently dropped, never exposing arbitrary stored content). A malformed
audit history is **never trusted or appended to** — planning and apply refuse with
`revision-repair-audit-unavailable`.

## 5. Activation states & the fence

The fence GOVERNS both live writers — each validates it INSIDE its commit
transaction, under the activation-control fence held **SHARED** (`lockKeyShared`),
immediately before any durable mutation, so a transition that completes first is
always observed and honored. The shared fence lets writers for UNRELATED partitions
commit concurrently; an activation TRANSITION (and operator repair CAS) takes the
fence **EXCLUSIVE**, so it drains in-flight shared writers and blocks new ones — a
queued exclusive is never bypassed by later shared arrivals. Concurrent first
revisioned commits are safe: the durable revision-history witness value is
deterministic (`{ everExisted: true }`), so no two shared-fence writers can produce
conflicting witness content.

| State            | Legacy writer | Revisioned writer | Notes                                            |
| ---------------- | ------------- | ----------------- | ------------------------------------------------ |
| `legacy`         | ✅ allowed    | ❌ fenced         | Behavior-equivalent to current `main`.           |
| `armed`          | ❌ fenced     | ❌ fenced         | Deployment prep ONLY — evidence NOT authorized.  |
| `active`         | ❌ fenced     | ✅ allowed        | The ONLY state that authorizes evidence commits. |
| `read-only-safe` | ❌ fenced     | ❌ fenced         | Safe stop — reads only; excludes both writers.   |

Invariants:

- Revisioned evidence commits ONLY in `active` — `armed` prepares deployment but
  does not authorize evidence. `read-only-safe` fences BOTH writers; a completed
  `read-only-safe` transition excludes any later revisioned commit.
- The transition graph is **strictly forward-only** (PLATFORM-086H3B-ACTIVATION-STATE-CORRUPTION-REMEDIATION):
  the ONLY transitions are `legacy→armed`, `armed→active`, `armed→read-only-safe`,
  `active→read-only-safe`, plus a safe idempotent same-state. **`legacy→armed` is
  irreversible** (there is NO path back to `legacy` from any state, even before
  evidence commits), and **`read-only-safe` is terminal**. An idempotent same-state
  `legacy` request is refused when revisioned history survives, so idempotence can
  never mask a resurrection.
- **Durable global witness:** the first revisioned evidence commit sets a
  write-once, never-cleared `revisioned-evidence-witness`, ATOMICALLY with the
  evidence. Once it exists, the legacy writer is fenced off and legacy ownership
  can never be resurrected — even if the activation record itself is lost.
- **Row presence is distinct from a row's value.** Absence, a present JSON-`null`
  value, and a present-but-malformed value are three different things and are
  never conflated. A **present** activation/witness/ledger row whose value is
  `null` or malformed **fails safe** (activation → `read-only-safe`, refusing both
  writers and all transitions; a present-invalid revision-ledger row blocks
  allocation as `revision-history-ambiguous`) and is **never auto-normalized**. An
  **absent** activation record resolves to `legacy` ONLY when every relevant
  witness row is genuinely absent (no witness row, no per-partition ledger/stamp);
  a surviving witness (valid OR malformed) resolves it to `read-only-safe`.

## 6. Deployment & rollback

- Landing A→E incrementally is safe **because** the fence is durable AND now
  governs the real production writers: a stale or rolled-back deploy cannot
  reintroduce a blind legacy writer alongside revisioned evidence — the durable
  witness fences the legacy writer off once evidence has existed.
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
