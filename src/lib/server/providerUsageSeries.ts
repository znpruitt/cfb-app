import type { CfbdUsage } from '../api/cfbdUsage.ts';
import { getAppState, withAppStateKeyTransaction } from './appStateStore.ts';

/**
 * PLATFORM-RETAIN-PROVIDER-USAGE-SERIES (Item 127) — a bounded log of raw CFBD
 * quota observations.
 *
 * WHY THIS EXISTS. `/info` reports `remaining` for the CURRENT PERIOD ONLY, the
 * period is calendar-monthly, and CFBD exposes no history — so the moment a month
 * rolls over the previous month's burn is unrecoverable. There is no second
 * source: `provider-refresh-status` is latest-only and nothing else counts
 * provider calls.
 *
 * WHY RAW OBSERVATIONS RATHER THAN A DAILY SUMMARY. An earlier design stored
 * derived state — one accumulated entry per UTC day, carrying a period number, a
 * high-water mark and a latest value. Every write then had to decide, from partial
 * state and in whatever order writes happened to arrive, whether a reading opened
 * a new quota period and which period it belonged to. Five review rounds found
 * defects in those decisions and each fix enabled the next. Storing what was
 * observed removes the decision: writes append, and every question is answered at
 * read time from a sorted list, where arrival order cannot matter.
 *
 * WHY `remaining` AND NOT `used`. `used` is derived (`limit − remaining`), so a
 * patron-tier change moves it with no calls made — which the previous design read
 * as a quota reset. `remaining` is what the provider actually reports. Within a
 * period it only falls; it rises exactly once, when the period rolls. That single
 * fact replaces a magnitude threshold, a calendar-boundary exception, and two
 * ordering branches.
 *
 * OBSERVATION-ONLY. Nothing in `src/` reads this. It must never become an input to
 * a decision — in particular not to the game-stats quota gate, which needs a FRESH
 * reading and would be wrong to trust a stored one.
 */

export const PROVIDER_USAGE_SERIES_SCOPE = 'provider-usage';
export const PROVIDER_USAGE_SERIES_KEY = 'cfbd-observations';

/**
 * ~14 months at four samples a day: a full season plus the same month a year
 * earlier, which is the comparison that actually gets asked. ~106 KB, trimmed on
 * every write — so the bound is structural and there is no cleanup job to forget.
 */
export const PROVIDER_USAGE_MAX_OBSERVATIONS = 1700;

export type ProviderUsageObservation = {
  /** When the probe returned. The only ordering key. */
  at: string;
  /** Provider-reported calls remaining this period, or null when nothing usable came back. */
  remaining: number | null;
  /**
   * The tier's monthly limit, recorded as CONTEXT only. Never subtracted, never
   * compared — deriving from it is what let a tier change look like a reset.
   */
  limit: number | null;
};

export type ProviderUsageSeries = {
  observations: ProviderUsageObservation[];
};

/**
 * The canonical trustworthy-count rule, matching `quotaPolicy.isTrustworthyCount`.
 * `resolveCfbdUsage` accepts any finite non-negative number, so `/info` returning
 * `remainingCalls: 1500.5` yields a fractional count the quota gate REFUSES as
 * untrustworthy. Storing it would put a value in the log that the rest of the
 * system considers unusable.
 */
function trustworthyCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseObservation(value: unknown): ProviderUsageObservation | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const at = typeof record.at === 'string' ? record.at : '';
  if (!at || Number.isNaN(Date.parse(at))) return null;
  return {
    at,
    remaining: trustworthyCount(record.remaining),
    limit: trustworthyCount(record.limit),
  };
}

/**
 * Tolerant of anything: a malformed stored row yields an EMPTY series rather than
 * throwing. Losing history is bad; taking the cron down over it is worse.
 */
export function parseProviderUsageSeries(value: unknown): ProviderUsageSeries {
  if (typeof value !== 'object' || value === null) return { observations: [] };
  const raw = (value as { observations?: unknown }).observations;
  if (!Array.isArray(raw)) return { observations: [] };
  const observations: ProviderUsageObservation[] = [];
  for (const entry of raw) {
    const parsed = parseObservation(entry);
    if (parsed) observations.push(parsed);
  }
  return observations.length > 0 ? sortAndBound(observations) : { observations: [] };
}

/**
 * Sort by time and enforce the bound. Deliberately NOT deduplicated: an earlier
 * version dropped entries sharing an `at`, which was wrong in both directions. A
 * QStash redelivery re-probes `/info` and stamps a fresh timestamp, so it never
 * collided in the first place; two genuine probes landing in the same millisecond
 * did, and one was silently lost. A duplicate row in an observation-only log is
 * harmless — `/info` is unbilled, so it distorts no count — while a dropped
 * observation is exactly the write-time decision this module exists to avoid.
 *
 * `sort` is stable, so entries sharing an `at` keep insertion order.
 */
function sortAndBound(observations: ProviderUsageObservation[]): ProviderUsageSeries {
  const sorted = [...observations].sort((a, b) => a.at.localeCompare(b.at));
  return { observations: sorted.slice(-PROVIDER_USAGE_MAX_OBSERVATIONS) };
}

/** Append one observation. Sorting and the bound are applied to the whole set. */
export function appendProviderUsageObservation(
  series: ProviderUsageSeries,
  observation: ProviderUsageObservation
): ProviderUsageSeries {
  return sortAndBound([...series.observations, observation]);
}

export function buildProviderUsageObservation(
  usage: CfbdUsage,
  now: Date
): ProviderUsageObservation {
  return {
    at: now.toISOString(),
    remaining: trustworthyCount(usage.remaining),
    limit: trustworthyCount(usage.limit),
  };
}

export async function readProviderUsageSeries(): Promise<ProviderUsageSeries> {
  const record = await getAppState<unknown>(PROVIDER_USAGE_SERIES_SCOPE, PROVIDER_USAGE_SERIES_KEY);
  return parseProviderUsageSeries(record?.value);
}

/**
 * Record one observation. NEVER throws and never reports failure to the caller —
 * bookkeeping must not be able to fail the job carrying it. Returns whether the
 * write happened, for tests and for a caller that wants to log it.
 */
export async function recordProviderUsageSample(
  usage: CfbdUsage,
  now: Date = new Date()
): Promise<boolean> {
  try {
    // Read, append and write inside one key transaction. There is a single
    // producer, but QStash can redeliver, and read-modify-write outside a lock is
    // last-write-wins: Postgres upserts do not compare, and the file store's lock
    // begins inside the write, after the read.
    await withAppStateKeyTransaction(
      PROVIDER_USAGE_SERIES_SCOPE,
      PROVIDER_USAGE_SERIES_KEY,
      async (txn) => {
        const record = await txn.read<unknown>();
        const series = parseProviderUsageSeries(record?.value);
        await txn.write(
          appendProviderUsageObservation(series, buildProviderUsageObservation(usage, now))
        );
      }
    );
    return true;
  } catch {
    return false;
  }
}
