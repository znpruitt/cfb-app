/**
 * Decide whether a member-facing surface is still within the inferred season
 * start date.
 *
 * The schedule probe stores a UTC calendar-date anchor, not a kickoff instant.
 * Normalize defensively from the parsed value so legacy exact-kickoff records
 * receive the same date-only treatment. A missing date remains conservatively
 * awaiting; an invalid persisted value does not hide the diagnostic state.
 */
export function isAwaitingSeasonStartDate(
  inferredSeasonStart: string | null,
  nowMs: number
): boolean {
  if (!inferredSeasonStart) return true;

  const parsed = new Date(inferredSeasonStart);
  if (!Number.isFinite(parsed.getTime())) return false;

  const nextUtcMidnightMs = Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate() + 1
  );
  return nowMs < nextUtcMidnightMs;
}
