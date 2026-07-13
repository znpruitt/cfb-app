/**
 * Pure helpers for user-facing dataset freshness (PLATFORM-086A).
 *
 * Kept free of React and server imports so it is trivially unit-testable and
 * reusable by both the admin panel and the subtle user-facing freshness chips.
 * Produces short, contextual, human phrasing ("3m ago", "yesterday",
 * "Tuesday") — never a single global timestamp implying every dataset shares
 * one freshness.
 */

export type FreshnessTone = 'fresh' | 'aging' | 'stale' | 'missing';

export type FreshnessDescriptor = {
  /** Short relative phrase, e.g. "3m ago" / "yesterday" / "May 4". Null when no timestamp. */
  relative: string | null;
  /** Whole-label phrase, e.g. "Updated 3m ago" / "Not yet updated". */
  text: string;
  tone: FreshnessTone;
  /** Age in ms, or null when there is no timestamp. */
  ageMs: number | null;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function toMillis(timestamp: string | number | Date | null | undefined): number | null {
  if (timestamp == null) return null;
  const ms =
    timestamp instanceof Date
      ? timestamp.getTime()
      : typeof timestamp === 'number'
        ? timestamp
        : new Date(timestamp).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Format a relative "ago" phrase. Future or ~now → "just now". Falls back to an
 * absolute month/day for anything a week or more old (a weekday name would be
 * ambiguous past 7 days).
 */
export function formatRelativeTimestamp(
  timestamp: string | number | Date | null | undefined,
  now: number = Date.now()
): string | null {
  const ms = toMillis(timestamp);
  if (ms == null) return null;

  const ageMs = now - ms;
  if (ageMs < MINUTE_MS) return 'just now';
  if (ageMs < HOUR_MS) {
    const minutes = Math.floor(ageMs / MINUTE_MS);
    return `${minutes}m ago`;
  }
  if (ageMs < DAY_MS) {
    const hours = Math.floor(ageMs / HOUR_MS);
    return `${hours}h ago`;
  }
  if (ageMs < 2 * DAY_MS) return 'yesterday';
  if (ageMs < 7 * DAY_MS) {
    // Within the past week: name the weekday ("Tuesday").
    return WEEKDAY[new Date(ms).getDay()];
  }
  // A week or more: absolute short date ("May 4").
  const d = new Date(ms);
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

/**
 * Classify freshness into a tone using dataset-appropriate thresholds. Defaults
 * suit slow-moving data; callers pass tighter windows for live data (e.g.
 * scores during games).
 */
export function describeFreshness(
  timestamp: string | number | Date | null | undefined,
  options: {
    now?: number;
    /** Age (ms) below which the data is "fresh". */
    freshWithinMs?: number;
    /** Age (ms) at/above which the data is "stale" (warning tone). */
    staleAfterMs?: number;
    /** Noun for the whole-label text; default "Updated". */
    labelVerb?: string;
  } = {}
): FreshnessDescriptor {
  const {
    now = Date.now(),
    freshWithinMs = 6 * HOUR_MS,
    staleAfterMs = 2 * DAY_MS,
    labelVerb = 'Updated',
  } = options;

  const ms = toMillis(timestamp);
  if (ms == null) {
    return { relative: null, text: 'Not yet updated', tone: 'missing', ageMs: null };
  }

  const ageMs = Math.max(0, now - ms);
  const relative = formatRelativeTimestamp(ms, now);
  const tone: FreshnessTone =
    ageMs >= staleAfterMs ? 'stale' : ageMs <= freshWithinMs ? 'fresh' : 'aging';

  return { relative, text: `${labelVerb} ${relative}`, tone, ageMs };
}
