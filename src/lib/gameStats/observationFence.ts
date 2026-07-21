/**
 * PLATFORM-086H2/H3C1 — the single strict RFC 3339 observation-fence parser.
 *
 * Extracted from the durable merge service so the (dormant) durable merge
 * authority AND the (dormant) C1 evidence authority order v2 observations by the
 * SAME freshness rule. There must be exactly one freshness parser: an
 * observation fence is a full RFC 3339 date-time with an explicit timezone,
 * canonicalized to UTC ISO form before comparison, and compared numerically.
 *
 * This module is a pure, provider-free primitive — it carries no game-stats
 * schema knowledge and references no dormant contract capability — so it is not
 * itself a guarded dormant surface. Its only callers today are the two dormant
 * services above.
 */

// Full date + time + seconds (optional fraction) + explicit Z or numeric
// offset. Date-only strings, locale formats, month names, bare numbers, and
// zone-less timestamps are all rejected structurally; calendar and offset
// components are validated EXPLICITLY because `Date.parse` leniently rolls over
// impossible days-of-month (e.g. Feb 30 → Mar 1) instead of failing.
const RFC3339_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/**
 * Parse a strict RFC 3339 date-time into epoch milliseconds, or `null` when the
 * value is not a string, is not full RFC 3339 with an explicit timezone, or
 * carries an impossible calendar/offset component. Never coerces non-strings and
 * never leniently rolls over invalid dates.
 */
export function parseObservationFenceMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = RFC3339_DATE_TIME.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, offset] = match;
  const monthNum = Number(month);
  if (monthNum < 1 || monthNum > 12) return null;
  const daysInMonth = new Date(Date.UTC(Number(year), monthNum, 0)).getUTCDate();
  if (Number(day) < 1 || Number(day) > daysInMonth) return null;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  if (offset !== 'Z' && offset !== 'z') {
    const [offsetHours, offsetMinutes] = offset!.slice(1).split(':');
    if (Number(offsetHours) > 23 || Number(offsetMinutes) > 59) return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Canonical UTC ISO form used for all persisted/compared fences. */
export function canonicalObservationFence(ms: number): string {
  return new Date(ms).toISOString();
}

/** Whether a value is a parseable strict RFC 3339 observation fence. */
export function isValidObservationFence(value: unknown): boolean {
  return parseObservationFenceMs(value) !== null;
}
