/**
 * PLATFORM-086H3B-DURABLE-STATE-CLASSIFICATION — shared presence-aware durable
 * read primitives, consumed by BOTH the revision authority (ordinary allocation)
 * and the operator repair planner so a single contract governs how a durable row's
 * PRESENCE, JSON-null, and malformed states are interpreted. Pure — no I/O, no
 * dataset-specific policy.
 */

/**
 * A durable read that keeps row PRESENCE separate from its (possibly-null) value,
 * so a present JSON-null row is never mistaken for an absent one. Build it from the
 * raw store/transaction record BEFORE reading `.value` — never via
 * `row?.value ?? null`, which collapses present-null into absence.
 */
export type DurableRead = { present: false } | { present: true; value: unknown };

/** Build a `DurableRead` from a raw transaction/store record (never `?? null`). */
export function toDurableRead(row: { value: unknown } | null | undefined): DurableRead {
  return row ? { present: true, value: row.value } : { present: false };
}

/** The decoded value when present, else `null` (for decoders that treat both alike). */
export function presentValue(read: DurableRead): unknown {
  return read.present ? read.value : null;
}

/** A non-null, non-array object. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A CANONICAL timestamp — the exact form the durable writers emit
 * (`new Date().toISOString()`). Round-trip equality rejects a non-string, an empty
 * string, a calendar-invalid value, and any noncanonical form (`Date.parse`
 * finiteness alone would accept a date-only or offset form the contract excludes,
 * and an object would coerce). Shared by the repair evidence, chronology, and
 * ledger validators so they agree exactly.
 */
export function isCanonicalTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString() === value;
}
