/**
 * PLATFORM-086H3B-REPLACEMENT-LEGACY-WRITER-FENCE — the durable writer-control
 * record that gates the LIVE legacy game-stats writer.
 *
 * This is the small, pre-deployed foundation the eventual staged rollout (E) will
 * arm: every live legacy write revalidates this record inside its partition
 * transaction and commits ONLY when the record is exactly a valid `legacy`. Once
 * the record is created (by the one-shot initializer) and the fenced writer is
 * deployed, a later rollout can flip the record to `armed`/`active`/`read-only-safe`
 * and the legacy writer will refuse — WITHOUT any code change and without a window
 * in which a blind writer and a future revisioned writer both persist a partition.
 *
 * Scope discipline (deliberately minimal): this module owns ONLY the record's
 * identity, strict validation, presence-aware classification, and the initial
 * `legacy` constructor. It performs NO transition orchestration, repair, lineage,
 * revision allocation, restoration witness, evidence/status/recovery mutation, or
 * any HTTP/admin operation — those are future (C/D/E) concerns and are intentionally
 * absent so this record can never become a repair or activation surface.
 */

/** The durable app-state scope + key that hold the single writer-control record. */
export const WRITER_CONTROL_SCOPE = 'game-stats-writer-control';
export const WRITER_CONTROL_KEY = 'state';

/**
 * The only supported record version. Named `recordVersion` (not the dormant per-row
 * version field) so the writer-control record is never conflated with game-stats row
 * schema metadata.
 */
export const WRITER_CONTROL_RECORD_VERSION = 1 as const;

/**
 * The writer-control states required for eventual rollout. `legacy` is the ONLY
 * state under which the live legacy writer may persist a partition; every other
 * state refuses. (Transitions between states are NOT defined here — see E.)
 */
export const WRITER_CONTROL_STATES = ['legacy', 'armed', 'active', 'read-only-safe'] as const;
export type WriterControlState = (typeof WRITER_CONTROL_STATES)[number];

/** The exact, versioned durable record. No extra fields are permitted. */
export type WriterControlRecord = {
  recordVersion: typeof WRITER_CONTROL_RECORD_VERSION;
  state: WriterControlState;
};

const STATE_SET: ReadonlySet<string> = new Set(WRITER_CONTROL_STATES);
const ALLOWED_KEYS: ReadonlySet<string> = new Set(['recordVersion', 'state']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strictly parse an unknown durable value into a `WriterControlRecord`, or `null`
 * when it is malformed. Rejects JSON `null`, primitives, arrays, unknown schema
 * versions, a missing/unsupported `state`, and ANY extra field. There is no
 * lenient coercion and no default — a malformed record is never silently repaired.
 */
export function parseWriterControl(value: unknown): WriterControlRecord | null {
  if (!isPlainObject(value)) return null;
  if (Object.keys(value).some((k) => !ALLOWED_KEYS.has(k))) return null;
  if (value.recordVersion !== WRITER_CONTROL_RECORD_VERSION) return null;
  if (typeof value.state !== 'string' || !STATE_SET.has(value.state)) return null;
  return { recordVersion: WRITER_CONTROL_RECORD_VERSION, state: value.state as WriterControlState };
}

/**
 * A presence-aware read of the writer-control row. Absence (`present:false`), a
 * present-but-malformed value (`present:true, record:null`), and a present valid
 * record are THREE distinct outcomes — an absent or malformed record is NEVER
 * interpreted as `legacy`.
 */
export type WriterControlRead =
  | { present: false }
  | { present: true; record: WriterControlRecord | null };

/**
 * Build a presence-aware read from a durable row (`{ value }` or `null`). Presence
 * is decided BEFORE `.value`, so a present JSON-null / primitive / malformed value
 * classifies as present-malformed, never as absence.
 */
export function toWriterControlRead(row: { value: unknown } | null): WriterControlRead {
  if (row === null) return { present: false };
  return { present: true, record: parseWriterControl(row.value) };
}

/** The gate result for a live legacy write against the writer-control record. */
export type LegacyWriteGate =
  | { allow: true }
  | { allow: false; reason: 'writer-control-absent' }
  | { allow: false; reason: 'writer-control-malformed' }
  | { allow: false; reason: 'writer-control-not-legacy'; state: WriterControlState };

/**
 * Classify whether a live legacy write is permitted. Fail-closed: only an exactly
 * valid `legacy` record allows the write; absent, malformed, `armed`, `active`, and
 * `read-only-safe` all refuse. Presence and value both matter.
 */
export function classifyLegacyWrite(read: WriterControlRead): LegacyWriteGate {
  if (!read.present) return { allow: false, reason: 'writer-control-absent' };
  if (read.record === null) return { allow: false, reason: 'writer-control-malformed' };
  if (read.record.state !== 'legacy') {
    return { allow: false, reason: 'writer-control-not-legacy', state: read.record.state };
  }
  return { allow: true };
}

/** The initial, valid `legacy` record the one-shot initializer creates. */
export function initialLegacyWriterControl(): WriterControlRecord {
  return { recordVersion: WRITER_CONTROL_RECORD_VERSION, state: 'legacy' };
}
