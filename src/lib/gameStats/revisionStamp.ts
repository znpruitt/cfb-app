import { randomUUID } from 'node:crypto';

/**
 * PLATFORM-086H3B — lineage-aware commit-stamp primitives.
 *
 * The durable game-stats commit stamp is `{ lineage, revision }` (the frozen
 * contract §5 audit correction). `lineage` is an OPAQUE per-scope epoch id
 * allocated once at genuine initialization; `revision` is the monotonic
 * per-partition counter. The two rules the rest of the lifecycle depends on:
 *
 *   - revisions compare ONLY within the same lineage and partition; two stamps
 *     of DIFFERENT lineage are never numerically ordered (`compareCommitRevision`
 *     returns `null`), so a stale/foreign lineage can never masquerade as newer
 *     or older evidence;
 *   - a commit stamp is INTERNAL durable bookkeeping and never enters public
 *     output (the projection allowlists own that — this module only produces the
 *     stamp; it never serializes it to a wire shape).
 *
 * This module is intentionally PURE and side-effect-free (no durable access, no
 * allocation policy, no provider access), so every layer that needs the stamp
 * TYPE and its comparison rules — the revision authority, the durable merge
 * writer, the refresh-status chronology, and operator repair — can share one
 * definition without importing the dormant allocation policy. Importing this
 * module activates NOTHING; it is deliberately outside the dormant-boundary
 * module ban for that reason.
 */

/** The durable, lineage-aware commit stamp. Internal bookkeeping only. */
export type CommitStamp = {
  /** Opaque per-scope epoch id, stable for the life of one lineage. */
  lineage: string;
  /** Monotonic per-partition counter; a positive safe integer. */
  revision: number;
};

/** A positive safe integer is the only valid revision. */
export function isValidRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * An opaque lineage is any NON-EMPTY string. It is never parsed or ordered — a
 * missing/blank lineage is not a lineage. (The generator below produces a UUID,
 * but callers must treat lineage identity as opaque and compare only by
 * equality.)
 */
export function isOpaqueLineage(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Whether `value` is a structurally valid commit stamp. */
export function isCommitStamp(value: unknown): value is CommitStamp {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return isOpaqueLineage(record.lineage) && isValidRevision(record.revision);
}

/** Parse `value` to a valid commit stamp, or `null` when it is not one. */
export function toCommitStamp(value: unknown): CommitStamp | null {
  return isCommitStamp(value) ? { lineage: value.lineage, revision: value.revision } : null;
}

/** Same lineage AND same revision. */
export function commitStampsEqual(a: CommitStamp, b: CommitStamp): boolean {
  return a.lineage === b.lineage && a.revision === b.revision;
}

/** Same lineage (opaque equality). */
export function sameLineage(a: CommitStamp, b: CommitStamp): boolean {
  return a.lineage === b.lineage;
}

/**
 * Compare two stamps' revisions — but ONLY when they share a lineage. Returns a
 * negative/zero/positive number for a strictly-less/equal/greater revision
 * WITHIN the same lineage, and `null` when the lineages differ (incomparable —
 * different lineages are never numerically ordered). Callers MUST treat `null`
 * as "not comparable", never as equality.
 */
export function compareCommitRevision(a: CommitStamp, b: CommitStamp): number | null {
  if (a.lineage !== b.lineage) return null;
  return a.revision - b.revision;
}

/** Allocate a fresh opaque lineage id. Cryptographically unique across processes. */
export function generateLineage(): string {
  return randomUUID();
}
