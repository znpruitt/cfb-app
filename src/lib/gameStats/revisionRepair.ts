import { createHash, randomUUID } from 'node:crypto';

import type { CfbdSeasonType } from '../cfbd.ts';
import { providerRefreshScopeKey, weekPartitionScope } from '../providerRefreshScope.ts';
import { withAppStateKeyTransaction } from '../server/appStateStore.ts';
import { getGameStatsKey } from './cache.ts';
import { classifyGameStatsRow, type GameStatsRowClassificationState } from './contract.ts';
import {
  classifyPartitionStamp,
  GAME_STATS_REVISION_SCOPE,
  validateLedgerRecord,
  type PartitionIdentity,
  type PartitionStampClass,
  type RevisionLedgerRecord,
} from './revisionAuthority.ts';
import {
  isCommitStamp,
  isValidRevision,
  generateLineage,
  toCommitStamp,
  type CommitStamp,
} from './revisionStamp.ts';
import type { WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H3B — operator revision inspection & repair (DORMANT except the
 * admin route).
 *
 * The frozen contract §14 operator-recovery surface for a scope the automatic
 * revision authority BLOCKED (lineage conflict / ambiguous history / suspected
 * evidence loss). It is narrowly scoped: it repairs only the revision LEDGER (and
 * the committed-evidence status stamp / partition commit-stamp METADATA needed to
 * make the ledger coherent). It NEVER alters game-stat rows and NEVER fabricates
 * provider evidence.
 *
 * Safety rails (all enforced under one advisory-locked transaction):
 *   - platform-admin authorization (enforced at the route boundary);
 *   - default dry-run / inspect;
 *   - exact partition + an expected-current-state DIGEST (compare-and-set) — a
 *     repair refuses if durable state changed since inspection;
 *   - refuses while an unexpired recovery claim exists;
 *   - refuses floors below surviving SAME-lineage evidence;
 *   - refuses malformed evidence it cannot safely derive from;
 *   - requires explicit acknowledgement of conflicting lineage or evidence loss;
 *   - appends an audit record (actor, time, reason, before digest, action, safe
 *     after state) and stamps the ledger with the audit reference.
 *
 * Lock order (PLATFORM-086H3B-REPAIR-STRUCTURE-CAS-AUDIT):
 * `E(P) → activation-control → S(P) → C(P)` — the evidence partition, then the
 * global activation-control record (so the activation state + irreversible
 * witness that the CAS digest binds are read UNDER their lock), then the
 * refresh-status stamp, then the recovery disposition. Monotonic under A's
 * comparator: `game-stats` < `game-stats-activation-control` <
 * `provider-refresh-status` < `recovery-disposition`; the reverse is rejected.
 *
 * Fence MODE (PLATFORM-086H3B-ACTIVATION-FENCE-CONCURRENCY): repair holds
 * activation-control **EXCLUSIVE** (`lockKey`) — unlike ordinary legacy/revisioned
 * writers, which hold it SHARED. The exclusive fence DRAINS every in-flight shared
 * writer and blocks new ones, so the activation record + irreversible witness the
 * CAS digest binds cannot change inside the validate→apply window.
 */

const GAME_STATS_SCOPE = 'game-stats';
const PROVIDER_REFRESH_STATUS_SCOPE = 'provider-refresh-status';
/**
 * Per-partition recovery disposition (D owns the full shape; B reads it to
 * refuse a repair racing an active recovery claim, and locks it as C(P)).
 * Named to sort strictly ABOVE `provider-refresh-status` so the
 * `E → activation-control → S → C` acquisition order is monotonic.
 */
export const RECOVERY_DISPOSITION_SCOPE = 'recovery-disposition';
/** Append-only operator-repair audit trail, keyed 1:1 with the partition. */
export const REVISION_AUDIT_SCOPE = 'game-stats-revision-audit';

// === Public shapes ===

export type RevisionRepairAction =
  | { kind: 'rebuild-ledger' }
  | { kind: 'adopt-lineage'; lineage: string; floor: number }
  | { kind: 'establish-new-lineage'; floor?: number };

export type RevisionRepairRefusal =
  // CAS: the durable state changed since inspection (PLATFORM-086H3B-REPAIR-SAFETY-DOCS).
  | 'revision-repair-state-changed'
  | 'active-recovery-claim'
  // PLATFORM-086H3B-REPAIR-HIGH-WATER: the proposed floor is below the highest
  // surviving same-lineage revision across ALL valid durable witnesses (partition
  // stamp, revision ledger, committed status) — accepting it would let a later
  // allocator reuse an already-committed revision.
  | 'revision-repair-floor-below-surviving-history'
  // A valid revision ledger (or committed status) is AHEAD of the surviving
  // partition on the same lineage — `rebuild-ledger` must never reconstruct
  // DOWNWARD (that would erase higher committed chronology / mask evidence loss).
  | 'revision-repair-ledger-ahead-of-evidence'
  // Durable witnesses disagree on lineage — resolve with adopt-lineage /
  // establish-new-lineage, not rebuild-ledger.
  | 'revision-repair-lineage-conflict'
  // PLATFORM-086H3B-RESTORATION-STATUS-REMEDIATION: a floor that cannot advance
  // safely — nonpositive, unsafe, or `Number.MAX_SAFE_INTEGER` — refused during
  // planning AND transactional apply validation.
  | 'revision-repair-floor-not-advanceable'
  // PLATFORM-086H3B-REPAIR-SAFETY-DOCS: structurally invalid revision evidence —
  // a hard refusal for EVERY action that no acknowledgement can override.
  | 'revision-repair-evidence-malformed'
  // rebuild-ledger has no surviving valid same-lineage evidence to derive from.
  | 'malformed-evidence'
  | 'acknowledgement-required'
  | 'invalid-action'
  // PLATFORM-086H3B-REPAIR-STRUCTURE-CAS-AUDIT: the durable audit history is
  // malformed/unavailable — a repair refuses rather than trust or append to it.
  | 'revision-repair-audit-unavailable'
  // The durable store read/transaction failed — a REDACTED, typed refusal (the
  // raw storage error is logged server-side only, never returned).
  | 'revision-repair-planning-unavailable';

/**
 * Safe structured high-water summary for truthful planning output
 * (PLATFORM-086H3B-REPAIR-HIGH-WATER): the highest surviving revision on the
 * adopted lineage and which durable witnesses established it. Never exposes raw
 * game rows or storage internals.
 */
export type SurvivingHighWater = { lineage: string; highWater: number; sources: string[] };

/** Safe, structured partition view — never internal SQL/paths/tokens. */
export type RevisionInspectionState = {
  partition: {
    present: boolean;
    stampClass: PartitionStampClass['kind'];
    stamp: CommitStamp | null;
    gameCount: number | null;
  };
  ledger: RevisionLedgerRecord | null;
  ledgerMarkerPresent: boolean;
  status: {
    committedStamp: CommitStamp | null;
    committedStampMarkerPresent: boolean;
    lastAttemptOrdinal: number | null;
  };
  recovery: { activeClaim: boolean };
};

export type RevisionInspection = {
  partitionKey: string;
  identity: PartitionIdentity;
  state: RevisionInspectionState;
  /**
   * The VERSIONED digest the operator must echo back to authorize a repair (CAS).
   * Covers the complete inspected durable state (PLATFORM-086H3B-REPAIR-SAFETY-DOCS)
   * — see `computeStateDigest`. Never embeds or exposes the underlying evidence.
   */
  expectedStateDigest: string;
};

/** A redacted, typed inspection failure — never carries a raw storage message. */
export type RevisionInspectionUnavailable = {
  ok: false;
  code: 'revision-repair-inspection-unavailable';
};

/**
 * Typed audit availability (PLATFORM-086H3B-REPAIR-SAFETY-DOCS): a failed or
 * malformed read is NEVER collapsed into an empty history.
 *   - `available` — read succeeded (a valid EMPTY entry list is still available);
 *   - `absent`    — no audit dataset has ever been written;
 *   - `unavailable` — the read failed or returned malformed audit state.
 */
export type RevisionAuditRead =
  | { state: 'available'; entries: RevisionRepairAuditEntry[] }
  | { state: 'absent' }
  | { state: 'unavailable' };

export type RevisionRepairAuditEntry = {
  /** Versioned so a schema change fails validation instead of parsing silently. */
  schemaVersion: 1;
  auditRef: string;
  actor: string;
  at: string;
  reason: string;
  action: RevisionRepairAction;
  beforeDigest: string;
  afterState: {
    ledger: RevisionLedgerRecord;
    committedStamp: CommitStamp | null;
    partitionStamp: CommitStamp | null;
  };
  /** Historical lineage preserved when a new lineage supersedes it (§14). */
  supersededLineage?: string | null;
  /** The surviving same-lineage high-water the plan validated against (§16). */
  survivingHighWater?: SurvivingHighWater | null;
};

export type RevisionRepairRequest = {
  identity: PartitionIdentity;
  action: RevisionRepairAction;
  /** Expected-current-state digest from a prior inspection (CAS). */
  expectedStateDigest: string;
  actor: string;
  reason: string;
  /** Default TRUE — inspect/plan without writing. */
  dryRun?: boolean;
  acknowledgeEvidenceLoss?: boolean;
  acknowledgeLineageConflict?: boolean;
};

export type RevisionRepairResult =
  | {
      ok: true;
      dryRun: boolean;
      beforeDigest: string;
      afterState: RevisionRepairAuditEntry['afterState'];
      /** Truthful planning output: the surviving high-water the plan cleared. */
      survivingHighWater: SurvivingHighWater | null;
      auditRef: string;
    }
  | { ok: false; code: RevisionRepairRefusal; detail: string };

// === Presence-aware durable reads (PLATFORM-086H3B-REPAIR-PRESENCE-H1-AUDIT) ===
//
// A durable row's PRESENCE is preserved SEPARATELY from its decoded value, so a
// PRESENT row whose JSON value is `null` (or otherwise malformed) is NEVER
// mistaken for an ABSENT row. Every repair-state read is built from the raw
// transaction record (`{ value } | null`) BEFORE reading `.value` — never via
// `row?.value ?? null`, which collapses present-null into absence and would hash
// identically, mask malformed presence, and let a CAS miss an absent↔present-null
// change.

/** A durable read that keeps row presence separate from its (possibly-null) value. */
export type DurableRead = { present: false } | { present: true; value: unknown };

/** Build a `DurableRead` from a raw transaction/store record (never `?? null`). */
function toDurableRead(row: { value: unknown } | null | undefined): DurableRead {
  return row ? { present: true, value: row.value } : { present: false };
}

/** The decoded value when present, else `null` (for decoders that treat both alike). */
function presentValue(read: DurableRead): unknown {
  return read.present ? read.value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// === Versioned CAS digest over the COMPLETE inspected durable state ===

/**
 * Explicit digest schema version. Any change to what the digest covers (or how)
 * MUST bump this so an old digest fails the CAS clearly rather than silently
 * comparing incompatible digests.
 */
const STATE_DIGEST_VERSION = 'gsr-state-v1';

/**
 * Deterministic canonical form: object keys sorted recursively (so key insertion
 * order never changes the digest), ARRAY ORDER and actual durable values
 * preserved (they are significant). Primitives pass through.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * The complete durable state the CAS digest binds (raw values, never exposed).
 * Every row is a PRESENCE-AWARE `DurableRead`, so `absent` (`{present:false}`),
 * `present-null` (`{present:true,value:null}`), `present-valid`, and
 * `present-malformed` all produce DIFFERENT digests — an absent↔present-null
 * change between inspection and apply is caught as `revision-repair-state-changed`.
 */
type DigestInput = {
  identity: PartitionIdentity;
  partition: DurableRead; // full weekly envelope + every game row + fetchedAt + commitStamp
  ledger: DurableRead; // raw revision ledger row
  status: DurableRead; // full committed status + attempt state
  activation: DurableRead; // activation-control record
  witness: DurableRead; // irreversible revision-history witness
  recovery: DurableRead; // recovery-disposition (incl. active claim token/owner/expiry)
  audit: DurableRead; // repair history used by the planner
};

/**
 * A versioned, canonical, cryptographic digest of the COMPLETE inspected durable
 * state (PLATFORM-086H3B-REPAIR-SAFETY-DOCS). Every material change — a game
 * identifier/participant/statistic, `fetchedAt`, evidence metadata, the commit
 * stamp, the ledger, committed status, activation/witness state, a recovery-claim
 * token/expiration, OR a row's mere PRESENCE (absent vs present-null) — changes the
 * digest; equivalent objects with different key order do not. Evidence is HASHED,
 * never embedded.
 */
function computeStateDigest(input: DigestInput): string {
  const json = JSON.stringify(canonicalize({ v: STATE_DIGEST_VERSION, ...input }));
  return `${STATE_DIGEST_VERSION}:${createHash('sha256').update(json).digest('hex')}`;
}

// === Durable reads (inside the locked transaction) ===

const ACTIVATION_CONTROL_SCOPE = 'game-stats-activation-control';
const ACTIVATION_CONTROL_KEY = 'global';
const REVISIONED_EVIDENCE_WITNESS_KEY = 'revisioned-evidence-witness';

type LoadedState = {
  existing: WeeklyGameStats | null;
  state: RevisionInspectionState;
  digest: string;
  /** False when the durable evidence is structurally invalid (hard refusal). */
  evidenceCertified: boolean;
  /** Validated audit availability — `unavailable` blocks a repair (never trusted). */
  auditRead: RevisionAuditRead;
};

function recoveryClaimActive(value: unknown, nowMs: number): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const claim = (value as { claim?: unknown }).claim;
  if (typeof claim !== 'object' || claim === null) return false;
  const lease = (claim as { leaseExpiresAt?: unknown }).leaseExpiresAt;
  if (typeof lease !== 'string') return false;
  const ms = Date.parse(lease);
  return Number.isFinite(ms) && ms > nowMs;
}

// === Repair evidence certification via the actual H1 durable contract ===
//
// PLATFORM-086H3B-REPAIR-PRESENCE-H1-AUDIT: repair no longer maintains its own
// (weaker, independently evolving) game-row contract. Per-row validity is decided
// by H1's `classifyGameStatsRow` (the shipped durable classifier), so repair
// accepts ONLY evidence H1 recognizes as a valid durable weekly partition and
// refuses everything H1 would withhold, reject, or treat as malformed. Envelope
// concerns H1 does not own (exact partition identity, canonical `fetchedAt`,
// per-row partition consistency, the legacy/revision-era stamp) are layered on
// top — never a second row contract. This aligns with the CURRENTLY SHIPPED H1
// contract only (not C's future canonical evidence model).

/**
 * H1 row states that are ACCEPTABLE durable evidence for repair: recognized legacy
 * rows (compatible or legitimately statless) and persistable revision-era rows
 * (complete or sparse). Any other H1 state is withheld/unsupported or malformed.
 */
const H1_ACCEPTED_ROW_STATES: ReadonlySet<GameStatsRowClassificationState> = new Set([
  'legacy-compatible',
  'legacy-statless',
  'v2-complete',
  'v2-sparse',
]);
/** H1 states H1 would WITHHOLD (structurally recognizable but not valid durable evidence). */
const H1_WITHHELD_ROW_STATES: ReadonlySet<GameStatsRowClassificationState> = new Set([
  'non-persistable-empty',
  'non-persistable-unknown-only',
  'non-persistable-malformed-only',
  'non-persistable-one-sided',
  'unsupported-version',
  'legacy-normalized-mismatch',
]);

/**
 * A weekly envelope `fetchedAt` must be a CANONICAL timestamp — the exact form the
 * durable writer emits (`new Date().toISOString()`). Round-trip equality rejects a
 * non-string, a calendar-invalid value, and any noncanonical form (`Date.parse`
 * finiteness alone would accept a date-only or offset form the contract excludes).
 */
function isCanonicalTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString() === value;
}

type RepairRowClass = 'accepted' | 'withheld' | 'malformed';

/** Classify ONE durable game row against H1 + this partition's identity. */
function classifyDurableEvidenceRow(row: unknown, id: PartitionIdentity): RepairRowClass {
  // Row partition identity must not contradict the containing partition (H1's row
  // classifier is partition-agnostic; the durable writer stamps week/seasonType).
  if (isPlainObject(row)) {
    if ('week' in row && row.week !== id.week) return 'malformed';
    if ('seasonType' in row && row.seasonType !== id.seasonType) return 'malformed';
  }
  const state = classifyGameStatsRow(row).state;
  if (H1_ACCEPTED_ROW_STATES.has(state)) return 'accepted';
  if (H1_WITHHELD_ROW_STATES.has(state)) return 'withheld';
  return 'malformed';
}

export type RepairEvidenceClass =
  | 'absent'
  | 'recognized-legacy'
  | 'valid-revision-era'
  | 'withheld'
  | 'malformed';

/**
 * The ONE repair evidence classifier, decided by the H1 durable contract. Only a
 * genuinely ABSENT row is `absent`; a PRESENT row whose value is JSON `null`, a
 * non-object, an array, or fails identity/`fetchedAt`/row/stamp validation is
 * `malformed`; a present envelope whose every row H1 accepts is `recognized-legacy`
 * or `valid-revision-era` by the shared stamp classifier; and evidence H1 would
 * merely withhold (any row H1 will not persist) is `withheld`. `withheld` and
 * `malformed` are BOTH hard repair refusals (`revision-repair-evidence-malformed`).
 */
export function classifyRepairEvidence(
  read: DurableRead,
  id: PartitionIdentity
): RepairEvidenceClass {
  if (!read.present) return 'absent';
  const value = read.value;
  // Present JSON-null (or any non-object / array) evidence is MALFORMED, not absent.
  if (!isPlainObject(value)) return 'malformed';
  const env = value;
  // Exact partition identity.
  if (env.year !== id.year || env.week !== id.week || env.seasonType !== id.seasonType) {
    return 'malformed';
  }
  // `fetchedAt` under the canonical (round-tripping) production contract.
  if (!isCanonicalTimestamp(env.fetchedAt)) return 'malformed';
  // `games` must be an array; every row is classified by H1. A single withheld or
  // malformed row taints the whole envelope (no partial acceptance).
  if (!Array.isArray(env.games)) return 'malformed';
  let sawWithheld = false;
  for (const row of env.games) {
    const rowClass = classifyDurableEvidenceRow(row, id);
    if (rowClass === 'malformed') return 'malformed';
    if (rowClass === 'withheld') sawWithheld = true;
  }
  // Present-but-invalid commit stamp is malformed.
  if (Object.prototype.hasOwnProperty.call(env, 'commitStamp') && !isCommitStamp(env.commitStamp)) {
    return 'malformed';
  }
  if (sawWithheld) return 'withheld';
  // Stamp/legacy/revision-era classification (shared with the revision authority).
  switch (classifyPartitionStamp(env as WeeklyGameStats).kind) {
    case 'valid':
      return 'valid-revision-era';
    case 'legacy':
      return 'recognized-legacy';
    default:
      // 'malformed' | 'revision-era-no-stamp' | 'absent' (unreachable when present)
      return 'malformed';
  }
}

/**
 * Whether the durable evidence is safe for repair: `absent` (a genuinely new
 * scope), `recognized-legacy`, or `valid-revision-era` certify; `withheld` and
 * `malformed` are BOTH refused (`revision-repair-evidence-malformed`).
 */
function certifyEvidence(read: DurableRead, id: PartitionIdentity): boolean {
  const cls = classifyRepairEvidence(read, id);
  return cls !== 'malformed' && cls !== 'withheld';
}

// === Audit history validation + allowlist (PLATFORM-086H3B-REPAIR-STRUCTURE-CAS-AUDIT) ===

const AUDIT_ENTRY_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'auditRef',
  'actor',
  'at',
  'reason',
  'action',
  'beforeDigest',
  'afterState',
  'supersededLineage',
  'survivingHighWater',
]);
const AUDIT_ACTION_KEYS: Record<string, ReadonlySet<string>> = {
  'rebuild-ledger': new Set(['kind']),
  'adopt-lineage': new Set(['kind', 'lineage', 'floor']),
  'establish-new-lineage': new Set(['kind', 'floor']),
};

const LEDGER_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'year',
  'week',
  'seasonType',
  'lineage',
  'revision',
  'initializedFrom',
  'initializedAt',
  'repairAuditRef',
]);
const STAMP_ALLOWED_KEYS: ReadonlySet<string> = new Set(['lineage', 'revision']);
const AFTER_STATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'ledger',
  'committedStamp',
  'partitionStamp',
]);
const HIGH_WATER_ALLOWED_KEYS: ReadonlySet<string> = new Set(['lineage', 'highWater', 'sources']);

function onlyAllowedKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(obj).every((k) => allowed.has(k));
}

/**
 * PLATFORM-086H3B-REPAIR-PRESENCE-H1-AUDIT: every nested object returned from a
 * stored audit entry is REBUILT field-by-field from validated primitives against
 * an EXACT allowlist — a raw stored object is NEVER retained by reference, and any
 * unexpected nested key fails validation (whole dataset `unavailable`) rather than
 * being silently stripped while the corrupted history is still treated as
 * authoritative.
 */

/** Freshly reconstruct a commit stamp as EXACTLY `{ lineage, revision }`, or null. */
function rebuildCommitStamp(value: unknown): CommitStamp | null {
  if (!isPlainObject(value)) return null;
  if (!onlyAllowedKeys(value, STAMP_ALLOWED_KEYS)) return null; // reject any extra field
  if (!isCommitStamp(value)) return null;
  return { lineage: value.lineage as string, revision: value.revision as number };
}
/** A nullable commit-stamp field: `{ok,value}` (null passes) or `{ok:false}` on malformed. */
function rebuildStampOrNull(
  value: unknown
): { ok: true; value: CommitStamp | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  const stamp = rebuildCommitStamp(value);
  return stamp ? { ok: true, value: stamp } : { ok: false };
}

/** Freshly reconstruct the nested revision ledger against its exact allowlist. */
function rebuildAuditLedger(value: unknown): RevisionLedgerRecord | null {
  if (!isPlainObject(value)) return null;
  if (!onlyAllowedKeys(value, LEDGER_ALLOWED_KEYS)) return null; // reject any unexpected key
  const { year, week, seasonType } = value;
  if (typeof year !== 'number' || !Number.isSafeInteger(year)) return null;
  if (typeof week !== 'number' || !Number.isSafeInteger(week)) return null;
  if (seasonType !== 'regular' && seasonType !== 'postseason') return null;
  // `validateLedgerRecord` validates schemaVersion/revision/lineage/initializedFrom
  // and REBUILDS a fresh record with only the durable ledger fields (no reference
  // retention); the ledger's own identity serves as the self-identity here.
  return validateLedgerRecord(value, { year, week, seasonType });
}

/** Freshly reconstruct the nested `afterState`, or null when any field is invalid. */
function rebuildAuditAfterState(value: unknown): RevisionRepairAuditEntry['afterState'] | null {
  if (!isPlainObject(value)) return null;
  if (!onlyAllowedKeys(value, AFTER_STATE_ALLOWED_KEYS)) return null;
  const ledger = rebuildAuditLedger(value.ledger);
  if (!ledger) return null;
  const committed = rebuildStampOrNull(value.committedStamp);
  if (!committed.ok) return null;
  const partition = rebuildStampOrNull(value.partitionStamp);
  if (!partition.ok) return null;
  return { ledger, committedStamp: committed.value, partitionStamp: partition.value };
}

/** Freshly reconstruct the audit action per kind, or null. */
function rebuildAuditAction(value: unknown): RevisionRepairAction | null {
  if (!isPlainObject(value)) return null;
  const allowed = typeof value.kind === 'string' ? AUDIT_ACTION_KEYS[value.kind] : undefined;
  if (!allowed || !onlyAllowedKeys(value, allowed)) return null;
  if (value.kind === 'rebuild-ledger') return { kind: 'rebuild-ledger' };
  if (value.kind === 'adopt-lineage') {
    if (typeof value.lineage !== 'string' || value.lineage.length === 0) return null;
    if (typeof value.floor !== 'number' || !Number.isSafeInteger(value.floor)) return null;
    return { kind: 'adopt-lineage', lineage: value.lineage, floor: value.floor };
  }
  if (value.kind === 'establish-new-lineage') {
    if ('floor' in value) {
      if (typeof value.floor !== 'number' || !Number.isSafeInteger(value.floor)) return null;
      return { kind: 'establish-new-lineage', floor: value.floor };
    }
    return { kind: 'establish-new-lineage' };
  }
  return null;
}

/** A nullable surviving-high-water field: `{ok,value}` (null passes) or `{ok:false}`. */
function rebuildSurvivingHighWater(
  value: unknown
): { ok: true; value: SurvivingHighWater | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (!isPlainObject(value)) return { ok: false };
  if (!onlyAllowedKeys(value, HIGH_WATER_ALLOWED_KEYS)) return { ok: false };
  if (typeof value.lineage !== 'string') return { ok: false };
  if (typeof value.highWater !== 'number' || !Number.isSafeInteger(value.highWater)) {
    return { ok: false };
  }
  if (!Array.isArray(value.sources) || !value.sources.every((x) => typeof x === 'string')) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      lineage: value.lineage,
      highWater: value.highWater,
      sources: value.sources.map((x) => String(x)),
    },
  };
}

/**
 * Validate ONE audit entry into a clean ALLOWLISTED entry with every NESTED object
 * freshly rebuilt, or `null` when malformed — a missing/invalid field, any
 * unexpected extra field (top-level OR nested), or a nested object that cannot be
 * reconstructed. Never retains a raw stored object by reference.
 */
export function validateAuditEntry(value: unknown): RevisionRepairAuditEntry | null {
  if (!isPlainObject(value)) return null;
  const e = value;
  if (!onlyAllowedKeys(e, AUDIT_ENTRY_ALLOWED_KEYS)) return null;
  if (e.schemaVersion !== 1) return null;
  if (typeof e.auditRef !== 'string' || !e.auditRef) return null;
  if (typeof e.actor !== 'string' || !e.actor) return null;
  if (typeof e.at !== 'string' || !Number.isFinite(Date.parse(e.at))) return null;
  if (typeof e.reason !== 'string') return null;
  if (typeof e.beforeDigest !== 'string' || !e.beforeDigest) return null;
  const action = rebuildAuditAction(e.action);
  if (!action) return null;
  const afterState = rebuildAuditAfterState(e.afterState);
  if (!afterState) return null;
  let supersededLineage: string | null | undefined;
  if ('supersededLineage' in e) {
    if (e.supersededLineage !== null && typeof e.supersededLineage !== 'string') return null;
    supersededLineage = e.supersededLineage as string | null;
  }
  let survivingHighWater: SurvivingHighWater | null | undefined;
  if ('survivingHighWater' in e) {
    const rebuilt = rebuildSurvivingHighWater(e.survivingHighWater);
    if (!rebuilt.ok) return null;
    survivingHighWater = rebuilt.value;
  }
  // Assemble ONLY from validated primitives + freshly-rebuilt nested objects.
  const entry: RevisionRepairAuditEntry = {
    schemaVersion: 1,
    auditRef: e.auditRef,
    actor: e.actor,
    at: e.at,
    reason: e.reason,
    action,
    beforeDigest: e.beforeDigest,
    afterState,
  };
  if (supersededLineage !== undefined) entry.supersededLineage = supersededLineage;
  if (survivingHighWater !== undefined) entry.survivingHighWater = survivingHighWater;
  return entry;
}

/**
 * Classify a whole audit dataset ALL-OR-NOTHING: `available` only when it is a
 * valid array in which EVERY entry validates (order preserved); `absent` when no
 * row exists; `unavailable` when it is a non-array or ANY entry is malformed (a
 * malformed entry is never silently dropped).
 */
function classifyAuditDataset(row: { value: unknown } | null): RevisionAuditRead {
  if (!row) return { state: 'absent' };
  if (!Array.isArray(row.value)) return { state: 'unavailable' };
  const entries: RevisionRepairAuditEntry[] = [];
  for (const raw of row.value) {
    const entry = validateAuditEntry(raw);
    if (!entry) return { state: 'unavailable' };
    entries.push(entry);
  }
  return { state: 'available', entries };
}

type RepairTxn = {
  read<T>(): Promise<{ value: T } | null>;
  readKey<T>(scope: string, key: string): Promise<{ value: T } | null>;
};

async function loadState(
  txn: RepairTxn,
  id: PartitionIdentity,
  partitionKey: string,
  statusKey: string,
  nowMs: number
): Promise<LoadedState> {
  // PRESENCE-AWARE reads: build a `DurableRead` from each raw record BEFORE
  // reading `.value`, so a present-null row is never mistaken for absence.
  const partitionRead = toDurableRead(await txn.read<unknown>());
  // A present value that is not a well-formed envelope decodes to `null` for the
  // stamp classifier (which treats null as absent); presence + evidence
  // certification below distinguish present-null/malformed from genuine absence.
  const existing =
    partitionRead.present && isPlainObject(partitionRead.value)
      ? (partitionRead.value as WeeklyGameStats)
      : null;
  const partitionClass = classifyPartitionStamp(existing);

  const ledgerRead = toDurableRead(
    await txn.readKey<unknown>(GAME_STATS_REVISION_SCOPE, partitionKey)
  );
  const ledger = ledgerRead.present ? validateLedgerRecord(ledgerRead.value, id) : null;
  // A PRESENT ledger row that does not validate — including a JSON-null value — is
  // an ambiguous revision-era MARKER (never "no ledger", never new-lineage init).
  const ledgerMarkerPresent = ledgerRead.present && ledger === null;

  const statusRead = toDurableRead(
    await txn.readKey<Record<string, unknown>>(PROVIDER_REFRESH_STATUS_SCOPE, statusKey)
  );
  const statusValue = statusRead.present ? statusRead.value : null;
  const statusHasStamp =
    isPlainObject(statusValue) &&
    Object.prototype.hasOwnProperty.call(statusValue, 'lastCommittedStamp');
  const committedStamp = statusHasStamp
    ? toCommitStamp((statusValue as Record<string, unknown>).lastCommittedStamp)
    : null;
  const committedStampMarkerPresent = statusHasStamp && committedStamp === null;
  const lastAttemptOrdinal =
    isPlainObject(statusValue) && typeof statusValue.lastAttemptOrdinal === 'number'
      ? statusValue.lastAttemptOrdinal
      : null;

  const recoveryRead = toDurableRead(
    await txn.readKey<unknown>(RECOVERY_DISPOSITION_SCOPE, partitionKey)
  );
  const activeClaim = recoveryClaimActive(presentValue(recoveryRead), nowMs);

  // Additional durable inputs the digest binds (read within E → S → C; the
  // activation/witness/audit keys are read, not separately locked — the CAS
  // recompute catches any change between inspection and apply).
  const activationRead = toDurableRead(
    await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY)
  );
  const witnessRead = toDurableRead(
    await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY)
  );
  const auditRow = await txn.readKey<unknown>(REVISION_AUDIT_SCOPE, partitionKey);
  const auditRead = classifyAuditDataset(auditRow ?? null);

  const state: RevisionInspectionState = {
    partition: {
      // A present-null / malformed partition row is PRESENT (distinct from absent).
      present: partitionRead.present,
      stampClass: partitionClass.kind,
      stamp: partitionClass.kind === 'valid' ? partitionClass.stamp : null,
      gameCount: existing && Array.isArray(existing.games) ? existing.games.length : null,
    },
    ledger,
    ledgerMarkerPresent,
    status: { committedStamp, committedStampMarkerPresent, lastAttemptOrdinal },
    recovery: { activeClaim },
  };
  const digest = computeStateDigest({
    identity: id,
    partition: partitionRead,
    ledger: ledgerRead,
    status: statusRead,
    activation: activationRead,
    witness: witnessRead,
    recovery: recoveryRead,
    audit: toDurableRead(auditRow),
  });
  return {
    existing,
    state,
    digest,
    evidenceCertified: certifyEvidence(partitionRead, id),
    auditRead,
  };
}

// === Inspection (safe, read-only) ===

/**
 * Inspect a partition's revision state and return the expected-current-state
 * digest an operator must echo back to authorize a repair. Read-only — takes the
 * full `E → activation-control → S → C` locks so the digest (which binds the
 * activation record and irreversible witness) is a consistent snapshot; writes
 * nothing.
 */
export async function inspectRevisionState(
  identity: PartitionIdentity
): Promise<RevisionInspection | RevisionInspectionUnavailable> {
  const partitionKey = getGameStatsKey(identity.year, identity.week, identity.seasonType);
  const statusKey = providerRefreshScopeKey(
    'game-stats',
    weekPartitionScope(identity.year, identity.week, identity.seasonType)
  );
  const nowMs = Date.now();
  try {
    return await withAppStateKeyTransaction(GAME_STATS_SCOPE, partitionKey, async (txn) => {
      // E(P) → activation-control → S(P) → C(P) — activation/witness read under
      // their lock, so the digest binds a serialized snapshot.
      await txn.lockKey(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY);
      await txn.lockKey(PROVIDER_REFRESH_STATUS_SCOPE, statusKey);
      await txn.lockKey(RECOVERY_DISPOSITION_SCOPE, partitionKey);
      const loaded = await loadState(txn, identity, partitionKey, statusKey, nowMs);
      return {
        partitionKey,
        identity,
        state: loaded.state,
        expectedStateDigest: loaded.digest,
      };
    });
  } catch (error) {
    // REDACT: the raw storage/SQL/path/stack error is logged server-side ONLY;
    // the caller receives a stable typed code with no diagnostic detail.
    console.error('revisionRepair: inspection failed', {
      identity,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, code: 'revision-repair-inspection-unavailable' };
  }
}

// === Repair action planning (pure) ===

type RepairPlan =
  | {
      ok: true;
      ledger: RevisionLedgerRecord;
      committedStamp: CommitStamp | null;
      partitionStamp: CommitStamp | null;
      supersededLineage: string | null;
      survivingHighWater: SurvivingHighWater | null;
    }
  | { ok: false; code: RevisionRepairRefusal; detail: string };

/**
 * A repair floor must be a positive safe integer that can still ADVANCE — a
 * nonpositive, unsafe, or `Number.MAX_SAFE_INTEGER` floor is refused, so a later
 * allocation (`floor + 1`) can never wrap past the safe-integer bound
 * (PLATFORM-086H3B-RESTORATION-STATUS-REMEDIATION).
 */
function floorNotAdvanceable(floor: number): boolean {
  return !isValidRevision(floor) || floor >= Number.MAX_SAFE_INTEGER;
}

type CommittedWitness = {
  lineage: string;
  revision: number;
  source: 'partition' | 'ledger' | 'status';
};

/** Every VALID same-lineage committed witness relevant to repair. */
function collectCommittedWitnesses(state: RevisionInspectionState): CommittedWitness[] {
  const witnesses: CommittedWitness[] = [];
  if (state.partition.stamp) {
    witnesses.push({
      lineage: state.partition.stamp.lineage,
      revision: state.partition.stamp.revision,
      source: 'partition',
    });
  }
  if (state.ledger) {
    // A VALID revision ledger is a committed witness — it MUST participate in the
    // high-water so repair can never rewrite it to a lower revision.
    witnesses.push({
      lineage: state.ledger.lineage,
      revision: state.ledger.revision,
      source: 'ledger',
    });
  }
  if (state.status.committedStamp) {
    witnesses.push({
      lineage: state.status.committedStamp.lineage,
      revision: state.status.committedStamp.revision,
      source: 'status',
    });
  }
  return witnesses;
}

function hasMalformedRevisionHistory(state: RevisionInspectionState): boolean {
  return (
    state.ledgerMarkerPresent ||
    state.status.committedStampMarkerPresent ||
    state.partition.stampClass === 'malformed' ||
    state.partition.stampClass === 'revision-era-no-stamp'
  );
}

/**
 * A structured assessment of the surviving committed revision history across ALL
 * valid durable witnesses (PLATFORM-086H3B-REPAIR-HIGH-WATER). Revisions are
 * compared ONLY within one lineage — never across lineages.
 */
export type SurvivingHistoryAssessment =
  | { kind: 'none' }
  | { kind: 'conflicting-lineages'; lineages: string[] }
  | { kind: 'malformed' }
  | {
      kind: 'one-lineage';
      lineage: string;
      highWater: number;
      sources: string[];
      /** Committed history (ledger/status) is ahead of the surviving partition. */
      evidenceLossSuspected: boolean;
    };

function assessSurvivingHistory(state: RevisionInspectionState): SurvivingHistoryAssessment {
  const witnesses = collectCommittedWitnesses(state);
  const lineages = [...new Set(witnesses.map((w) => w.lineage))];
  if (lineages.length > 1) return { kind: 'conflicting-lineages', lineages };
  if (lineages.length === 0) {
    return hasMalformedRevisionHistory(state) ? { kind: 'malformed' } : { kind: 'none' };
  }
  const lineage = lineages[0]!;
  const same = witnesses.filter((w) => w.lineage === lineage);
  const highWater = Math.max(...same.map((w) => w.revision));
  const partitionRevision = same.find((w) => w.source === 'partition')?.revision ?? null;
  const recorded = Math.max(
    0,
    ...same.filter((w) => w.source !== 'partition').map((w) => w.revision)
  );
  const evidenceLossSuspected =
    partitionRevision === null ? recorded > 0 : recorded > partitionRevision;
  return {
    kind: 'one-lineage',
    lineage,
    highWater,
    sources: same.map((w) => w.source),
    evidenceLossSuspected,
  };
}

/**
 * The highest surviving committed revision for `lineage` across EVERY valid
 * durable witness — the partition commit stamp, the revision LEDGER, and the
 * committed refresh-status stamp (PLATFORM-086H3B-REPAIR-HIGH-WATER: the valid
 * ledger was previously omitted, which let a repair floor below `ledger.revision`
 * be accepted and permit revision reuse).
 */
function highestSurvivingSameLineage(state: RevisionInspectionState, lineage: string): number {
  let highest = 0;
  for (const w of collectCommittedWitnesses(state)) {
    if (w.lineage === lineage) highest = Math.max(highest, w.revision);
  }
  return highest;
}

function planRepair(
  request: RevisionRepairRequest,
  state: RevisionInspectionState,
  evidenceCertified: boolean,
  now: string,
  auditRef: string
): RepairPlan {
  const id = request.identity;
  // HARD refusal for structurally invalid evidence — checked FIRST, for EVERY
  // action, so no acknowledgement (lineage-conflict / evidence-loss) can convert
  // malformed evidence into valid evidence.
  if (!evidenceCertified) {
    return {
      ok: false,
      code: 'revision-repair-evidence-malformed',
      detail:
        'the durable revision evidence is structurally invalid (malformed envelope, identity, commit stamp, or revision-era shape); repair refused',
    };
  }
  const base = (
    lineage: string,
    revision: number,
    initializedFrom: RevisionLedgerRecord['initializedFrom']
  ): RevisionLedgerRecord => ({
    schemaVersion: 1,
    year: id.year,
    week: id.week,
    seasonType: id.seasonType,
    lineage,
    revision,
    initializedFrom,
    initializedAt: now,
    repairAuditRef: auditRef,
  });

  const assessment = assessSurvivingHistory(state);
  const highWaterOf = (lineage: string): SurvivingHighWater => ({
    lineage,
    highWater: highestSurvivingSameLineage(state, lineage),
    sources:
      assessment.kind === 'one-lineage' && assessment.lineage === lineage ? assessment.sources : [],
  });

  switch (request.action.kind) {
    case 'rebuild-ledger': {
      // Only safe when SURVIVING same-lineage partition evidence proves the
      // lineage — never derived from a malformed or stampless partition.
      const stamp = state.partition.stamp;
      if (!stamp) {
        return {
          ok: false,
          code: 'malformed-evidence',
          detail:
            'rebuild-ledger requires a surviving partition with a valid commit stamp to derive the lineage and revision from',
        };
      }
      // Witnesses must agree on lineage — a ledger/status on a different lineage
      // is a conflict rebuild must not paper over.
      if (assessment.kind === 'conflicting-lineages') {
        return {
          ok: false,
          code: 'revision-repair-lineage-conflict',
          detail: `surviving witnesses disagree on lineage (${assessment.lineages.join(', ')}); use adopt-lineage or establish-new-lineage`,
        };
      }
      // A valid ledger (or committed status) AHEAD of the surviving partition on
      // the same lineage → refuse rather than reconstruct DOWNWARD.
      if (assessment.kind === 'one-lineage' && assessment.evidenceLossSuspected) {
        return {
          ok: false,
          code: 'revision-repair-ledger-ahead-of-evidence',
          detail: `committed history at revision ${assessment.highWater} is ahead of the surviving partition (revision ${stamp.revision}); rebuild would erase higher chronology — investigate before repairing`,
        };
      }
      // Safe: ledger/status are absent, behind, or equal on the same lineage —
      // rebuild UP to the highest surviving same-lineage revision (never down).
      const highWater = highestSurvivingSameLineage(state, stamp.lineage);
      return {
        ok: true,
        ledger: base(stamp.lineage, highWater, 'repair'),
        committedStamp: null, // rebuild does not touch the status stamp
        partitionStamp: null, // partition stamp already matches — unchanged
        supersededLineage: null,
        survivingHighWater: highWaterOf(stamp.lineage),
      };
    }
    case 'adopt-lineage': {
      const { lineage, floor } = request.action;
      if (floorNotAdvanceable(floor)) {
        return {
          ok: false,
          code: 'revision-repair-floor-not-advanceable',
          detail: 'floor must be a positive safe integer strictly below Number.MAX_SAFE_INTEGER',
        };
      }
      if (typeof lineage !== 'string' || lineage.length === 0) {
        return { ok: false, code: 'invalid-action', detail: 'lineage must be a non-empty string' };
      }
      // Never floor BELOW the highest surviving same-lineage revision across ALL
      // valid witnesses (partition stamp, LEDGER, committed status), so the next
      // allocator (`floor + 1`) can never reuse a committed revision.
      const survivingSame = highestSurvivingSameLineage(state, lineage);
      if (survivingSame > floor) {
        return {
          ok: false,
          code: 'revision-repair-floor-below-surviving-history',
          detail: `surviving same-lineage history at revision ${survivingSame} exceeds the requested floor ${floor}; a later allocation would reuse a committed revision`,
        };
      }
      // A partition / ledger / status carrying a DIFFERENT lineage is a lineage
      // conflict — require explicit acknowledgement.
      const conflictsWithPartition =
        state.partition.stamp !== null && state.partition.stamp.lineage !== lineage;
      const conflictsWithLedger = state.ledger !== null && state.ledger.lineage !== lineage;
      const conflictsWithStatus =
        state.status.committedStamp !== null && state.status.committedStamp.lineage !== lineage;
      const malformedEvidence =
        state.partition.stampClass === 'malformed' ||
        state.partition.stampClass === 'revision-era-no-stamp' ||
        state.status.committedStampMarkerPresent ||
        state.ledgerMarkerPresent;
      if (
        (conflictsWithPartition ||
          conflictsWithLedger ||
          conflictsWithStatus ||
          malformedEvidence) &&
        !request.acknowledgeLineageConflict
      ) {
        return {
          ok: false,
          code: 'acknowledgement-required',
          detail:
            'adopt-lineage conflicts with surviving evidence of a different or malformed lineage; set acknowledgeLineageConflict',
        };
      }
      let superseded: string | null = null;
      if (conflictsWithPartition && state.partition.stamp)
        superseded = state.partition.stamp.lineage;
      else if (conflictsWithLedger && state.ledger) superseded = state.ledger.lineage;
      else if (conflictsWithStatus && state.status.committedStamp) {
        superseded = state.status.committedStamp.lineage;
      }
      return {
        ok: true,
        // The floor is the LAST committed revision — the next allocator issues
        // `floor + 1`, strictly above every surviving same-lineage revision.
        ledger: base(lineage, floor, 'repair'),
        committedStamp: { lineage, revision: floor },
        // Reconcile a PRESENT partition's metadata stamp (rows untouched).
        partitionStamp: state.partition.present ? { lineage, revision: floor } : null,
        supersededLineage: superseded,
        survivingHighWater: highWaterOf(lineage),
      };
    }
    case 'establish-new-lineage': {
      if (!request.acknowledgeEvidenceLoss) {
        return {
          ok: false,
          code: 'acknowledgement-required',
          detail: 'establish-new-lineage requires acknowledgeEvidenceLoss',
        };
      }
      const floor = request.action.floor ?? 1;
      if (floorNotAdvanceable(floor)) {
        return {
          ok: false,
          code: 'revision-repair-floor-not-advanceable',
          detail: 'floor must be a positive safe integer strictly below Number.MAX_SAFE_INTEGER',
        };
      }
      // A GENUINELY different lineage from every surviving/abandoned one — the new
      // lineage's revisions are NEVER numerically compared with the prior lineage.
      const abandoned = new Set(collectCommittedWitnesses(state).map((w) => w.lineage));
      let lineage = generateLineage();
      while (abandoned.has(lineage)) lineage = generateLineage();
      const superseded =
        state.partition.stamp?.lineage ??
        state.status.committedStamp?.lineage ??
        state.ledger?.lineage ??
        null;
      // Preserve the ABANDONED lineage's high-water in the planned audit — the old
      // evidence is never reinterpreted as belonging to the new lineage.
      const supersededHighWater = superseded ? highWaterOf(superseded) : null;
      return {
        ok: true,
        ledger: base(lineage, floor, 'repair'),
        committedStamp: { lineage, revision: floor },
        partitionStamp: state.partition.present ? { lineage, revision: floor } : null,
        supersededLineage: superseded,
        survivingHighWater: supersededHighWater,
      };
    }
  }
}

// === Repair (transactional, audited) ===

/**
 * Inspect-or-repair one partition's revision state. Defaults to `dryRun: true`
 * (plan only, no write). A real repair requires the exact expected-state digest,
 * refuses while a recovery claim is active, refuses unsafe floors / malformed
 * evidence / missing acknowledgements, and appends an audit record.
 */
export async function repairRevisionState(
  request: RevisionRepairRequest
): Promise<RevisionRepairResult> {
  const dryRun = request.dryRun ?? true;
  const id = request.identity;
  const partitionKey = getGameStatsKey(id.year, id.week, id.seasonType);
  const statusKey = providerRefreshScopeKey(
    'game-stats',
    weekPartitionScope(id.year, id.week, id.seasonType)
  );
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const auditRef = randomUUID();

  try {
    return await withAppStateKeyTransaction<RevisionRepairResult>(
      GAME_STATS_SCOPE,
      partitionKey,
      async (txn) => {
        // Lock order E → activation-control → S → C, enforced by the primitive.
        // Acquiring activation-control BEFORE reading the activation record and
        // the irreversible witness serializes those CAS inputs, so a concurrent
        // activation transition (or another partition's first revisioned commit)
        // cannot mutate them inside this CAS window.
        await txn.lockKey(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY);
        await txn.lockKey(PROVIDER_REFRESH_STATUS_SCOPE, statusKey);
        await txn.lockKey(RECOVERY_DISPOSITION_SCOPE, partitionKey);
        const loaded = await loadState(txn, id, partitionKey, statusKey, nowMs);

        // Compare-and-set: recompute the COMPLETE-state digest transactionally and
        // refuse if ANY included durable state changed since inspection.
        if (loaded.digest !== request.expectedStateDigest) {
          return {
            ok: false,
            code: 'revision-repair-state-changed',
            detail: 'durable state changed since inspection; re-inspect and retry',
          };
        }
        // A malformed durable audit history is NEVER trusted or appended to.
        if (loaded.auditRead.state === 'unavailable') {
          return {
            ok: false,
            code: 'revision-repair-audit-unavailable',
            detail:
              'the durable repair audit history is malformed/unavailable; resolve it before repairing',
          };
        }
        // Refuse racing an active recovery attempt.
        if (loaded.state.recovery.activeClaim) {
          return {
            ok: false,
            code: 'active-recovery-claim',
            detail: 'an unexpired recovery claim exists for this partition; retry after it expires',
          };
        }

        const plan = planRepair(request, loaded.state, loaded.evidenceCertified, now, auditRef);
        if (!plan.ok) return plan;

        const afterState: RevisionRepairAuditEntry['afterState'] = {
          ledger: plan.ledger,
          committedStamp: plan.committedStamp,
          partitionStamp: plan.partitionStamp,
        };

        if (dryRun) {
          return {
            ok: true,
            dryRun: true,
            beforeDigest: loaded.digest,
            afterState,
            survivingHighWater: plan.survivingHighWater,
            auditRef,
          };
        }

        // Apply-time re-validation of floor advanceability (again, transactionally)
        // so no unadvanceable ledger revision can ever be persisted.
        if (floorNotAdvanceable(plan.ledger.revision)) {
          return {
            ok: false,
            code: 'revision-repair-floor-not-advanceable',
            detail: 'planned ledger revision is not safely advanceable',
          };
        }

        // Apply. Ledger (co-serialized under E). NEVER touches game-stat rows —
        // only the partition's internal commit-stamp METADATA is reconciled.
        await txn.writeKey(GAME_STATS_REVISION_SCOPE, partitionKey, plan.ledger);
        if (plan.partitionStamp && loaded.existing) {
          const reconciled: WeeklyGameStats = {
            ...loaded.existing,
            commitStamp: plan.partitionStamp,
          };
          await txn.write(reconciled);
        }
        if (plan.committedStamp) {
          // Establish the lineage transition on the status stamp (under S(P)).
          // Presence-aware: a present-null / malformed status merges as `{}` (the
          // stamp is set fresh) rather than collapsing present-null into absence.
          const statusRead = toDurableRead(
            await txn.readKey<Record<string, unknown>>(PROVIDER_REFRESH_STATUS_SCOPE, statusKey)
          );
          const priorStatus = isPlainObject(presentValue(statusRead))
            ? presentValue(statusRead)
            : {};
          await txn.writeKey(PROVIDER_REFRESH_STATUS_SCOPE, statusKey, {
            ...(priorStatus as Record<string, unknown>),
            lastCommittedStamp: plan.committedStamp,
          });
        }

        // Append to the VALIDATED audit history (a malformed one was already
        // refused above). `absent` starts a fresh list; `available` uses the
        // re-validated entries so no unapproved stored content is ever carried
        // forward.
        const priorAudit = classifyAuditDataset(
          (await txn.readKey<unknown>(REVISION_AUDIT_SCOPE, partitionKey)) ?? null
        );
        if (priorAudit.state === 'unavailable') {
          return {
            ok: false,
            code: 'revision-repair-audit-unavailable',
            detail:
              'the durable repair audit history is malformed/unavailable; resolve it before repairing',
          };
        }
        const prior = priorAudit.state === 'available' ? priorAudit.entries : [];
        const entry: RevisionRepairAuditEntry = {
          schemaVersion: 1,
          auditRef,
          actor: request.actor,
          at: now,
          reason: request.reason,
          action: request.action,
          beforeDigest: loaded.digest,
          afterState,
          supersededLineage: plan.supersededLineage,
          survivingHighWater: plan.survivingHighWater,
        };
        await txn.writeKey(REVISION_AUDIT_SCOPE, partitionKey, [...prior, entry]);

        return {
          ok: true,
          dryRun: false,
          beforeDigest: loaded.digest,
          afterState,
          survivingHighWater: plan.survivingHighWater,
          auditRef,
        };
      }
    );
  } catch (error) {
    // REDACT: log the raw storage error server-side ONLY; return a stable code.
    console.error('revisionRepair: repair planning/transaction failed', {
      identity: request.identity,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      code: 'revision-repair-planning-unavailable',
      detail: 'the durable store was unavailable; no durable state was changed',
    };
  }
}

/**
 * Read a partition's operator-repair audit trail with TYPED availability and
 * per-entry validation (PLATFORM-086H3B-REPAIR-STRUCTURE-CAS-AUDIT). `available`
 * ONLY when the dataset is a valid array AND EVERY entry passes validation (order
 * preserved, allowlisted fields only); `absent` when no dataset exists;
 * `unavailable` when the dataset is a non-array, ANY entry is malformed / carries
 * unapproved fields, or the read fails. A failure/malformed state is NEVER
 * collapsed into an empty (or partially-dropped) history, and no arbitrary stored
 * field can reach the response.
 */
export async function readRevisionAuditTrail(
  identity: PartitionIdentity
): Promise<RevisionAuditRead> {
  const partitionKey = getGameStatsKey(identity.year, identity.week, identity.seasonType);
  try {
    return await withAppStateKeyTransaction<RevisionAuditRead>(
      GAME_STATS_SCOPE,
      partitionKey,
      async (txn) =>
        classifyAuditDataset(
          (await txn.readKey<unknown>(REVISION_AUDIT_SCOPE, partitionKey)) ?? null
        )
    );
  } catch (error) {
    console.error('revisionRepair: audit read failed', {
      identity,
      error: error instanceof Error ? error.message : String(error),
    });
    return { state: 'unavailable' };
  }
}

/** Parse/validate a raw season type for the admin route. */
export function isCfbdSeasonType(value: unknown): value is CfbdSeasonType {
  return value === 'regular' || value === 'postseason';
}
