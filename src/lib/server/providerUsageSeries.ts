import type { CfbdUsage } from '../api/cfbdUsage.ts';
import { getAppState, withAppStateKeyTransaction } from './appStateStore.ts';

/**
 * PLATFORM-RETAIN-PROVIDER-USAGE-SERIES (Item 127) — a bounded daily record of
 * CFBD quota usage.
 *
 * WHY THIS EXISTS. `/info` reports `used`/`remaining` for the CURRENT PERIOD
 * ONLY, the period is calendar-monthly, and CFBD exposes no history. So the
 * moment a month rolls over, the previous month's burn is unrecoverable — there
 * is no second source, because `provider-refresh-status` is latest-only and the
 * app does not otherwise count provider calls. Item 94 exists solely to read one
 * number before a reset destroys it; this series removes that cliff.
 *
 * WHY DAILY RATHER THAN MONTHLY. The consumers do not actually want a monthly
 * total. Item 95 portion 2 and Item 63 both ask "how often can we afford to ask
 * DURING these windows", which needs to know what a Saturday costs versus a
 * Tuesday. A single end-of-month scalar cannot say.
 *
 * OBSERVATION-ONLY. Nothing here may affect a quota gate, a refusal path, a
 * provider outcome, or any caller's response. Every entry point swallows its own
 * failures: a series that cannot be written is strictly less bad than a cron that
 * fails because its bookkeeping did.
 */

export const PROVIDER_USAGE_SERIES_SCOPE = 'provider-usage';
export const PROVIDER_USAGE_SERIES_KEY = 'cfbd-daily';

/**
 * Bound: ~13 months, so a full season plus the prior year's same month is always
 * comparable. The series is a single durable row rewritten in place, so the bound
 * is structural — there is no pruning job to forget to run.
 */
export const PROVIDER_USAGE_SERIES_MAX_ENTRIES = 440;

/**
 * At most two entries per UTC day: the period running when the day began, and —
 * only if the monthly counter was seen to reset that day — the one that succeeded
 * it. A third "reset" inside one day is a provider anomaly, not a period, and must
 * not grow the row.
 */
export const MAX_PERIODS_PER_DAY = 2;

/**
 * One accumulated entry: a UTC day, within one quota period.
 *
 * A day normally holds ONE entry. It holds two when a period reset is detected
 * inside that day — see `mergeProviderUsageSample`. `periodSequence` is a local
 * ordinal, not a provider period id: CFBD exposes no period identity, so the only
 * thing observable is that `used` fell.
 *
 * `usedMax` and `usedLatest` are both kept because they answer different
 * questions. `usedMax` is the period's high-water mark for the day, which is what
 * a month total needs. `usedLatest` is the most recent complete reading, which is
 * what a day-over-day difference needs. Within one period they normally agree —
 * they diverge exactly when a provider blip or an out-of-order observation
 * reports a lower count, and keeping both means neither question is answered with
 * the other's number.
 */
export type ProviderUsageSample = {
  /** UTC calendar day, `YYYY-MM-DD`. The quota period is monthly, so UTC days key it. */
  day: string;
  /** 0 for the period running at the start of the day; 1 after a reset was seen that day. */
  periodSequence: number;
  /** The earliest observation kept for this (day, period). */
  firstObservedAt: string;
  /** The latest observation kept for this (day, period). */
  observedAt: string;
  /** Greatest `used` seen for this (day, period) — the high-water mark. */
  usedMax: number | null;
  /** `used` from the most recent complete observation. */
  usedLatest: number | null;
  remaining: number | null;
  limit: number | null;
  patronLevel: number | null;
};

export type ProviderUsageSeries = {
  samples: ProviderUsageSample[];
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function utcDayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function usableNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseSample(value: unknown): ProviderUsageSample | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const day = typeof record.day === 'string' ? record.day : '';
  if (!DAY_PATTERN.test(day)) return null;
  const observedAt = typeof record.observedAt === 'string' ? record.observedAt : '';
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) return null;
  const usedLatest = usableNumberOrNull(record.usedLatest);
  const firstObservedAt =
    typeof record.firstObservedAt === 'string' && !Number.isNaN(Date.parse(record.firstObservedAt))
      ? record.firstObservedAt
      : observedAt;
  const periodSequence = usableNumberOrNull(record.periodSequence);
  return {
    day,
    // A row written before the reset split existed carries neither field.
    // Normalize rather than reject: a legacy row is still a truthful record.
    periodSequence: periodSequence !== null && periodSequence >= 0 ? Math.floor(periodSequence) : 0,
    firstObservedAt,
    observedAt,
    usedMax: usableNumberOrNull(record.usedMax) ?? usedLatest,
    usedLatest,
    remaining: usableNumberOrNull(record.remaining),
    limit: usableNumberOrNull(record.limit),
    patronLevel: usableNumberOrNull(record.patronLevel),
  };
}

/**
 * Tolerant of anything: a malformed stored series yields an EMPTY series rather
 * than throwing. Losing history is bad; taking a cron down over it is worse.
 */
export function parseProviderUsageSeries(value: unknown): ProviderUsageSeries {
  if (typeof value !== 'object' || value === null) return { samples: [] };
  const raw = (value as { samples?: unknown }).samples;
  if (!Array.isArray(raw)) return { samples: [] };
  const samples: ProviderUsageSample[] = [];
  for (const entry of raw) {
    const parsed = parseSample(entry);
    if (parsed) samples.push(parsed);
  }
  return { samples };
}

/** A fully usable observation carries `remaining` AND the tier-derived `used`/`limit`. */
function usabilityRank(sample: ProviderUsageSample): number {
  if (sample.remaining === null) return 0;
  // `used` and `limit` derive from `patronLevel` (`cfbdUsage.ts`): a response with
  // `remainingCalls` but no usable `patronLevel` yields BOTH as null. That is the
  // weaker observation — and `used` is the field the burn question reads — so it
  // must not displace a complete one.
  return sample.usedLatest !== null && sample.limit !== null ? 2 : 1;
}

/**
 * Did `candidate` observe a NEW quota period relative to `existing`?
 *
 * CFBD exposes no period identity, so the only observable signal is that `used`
 * fell. Within a period it only rises. A drop therefore means the monthly counter
 * reset between the two observations — which can happen mid-UTC-day, because
 * CFBD's reset HOUR is not verified to be 00:00.
 *
 * Requires both counts to be complete: a degraded observation reports `null`, and
 * `null` is not a drop.
 *
 * ANY drop counts, with no magnitude threshold. That direction is deliberate: a
 * spurious split is harmless — both readings are kept and the day is capped at two
 * entries — while a MISSED split overwrites a period's final burn, which is the
 * one number this series exists to preserve. Fail toward keeping data.
 */
export function observedPeriodReset(
  existing: ProviderUsageSample,
  candidate: ProviderUsageSample
): boolean {
  if (existing.usedMax === null || candidate.usedLatest === null) return false;
  return candidate.usedLatest < existing.usedMax;
}

/**
 * Fold a new observation into an existing (day, period) entry.
 *
 * `usedMax` only ever rises. `usedLatest` and the tier-derived fields advance only
 * on an observation at least as complete as what is already stored, so a network
 * blip or a tierless response cannot blank a good reading. `firstObservedAt` is
 * kept so an entry's span is legible.
 */
export function mergeIntoSample(
  existing: ProviderUsageSample,
  candidate: ProviderUsageSample
): ProviderUsageSample {
  const candidateIsNewer = Date.parse(candidate.observedAt) >= Date.parse(existing.observedAt);
  const takeCandidateFields =
    usabilityRank(candidate) >= usabilityRank(existing) && candidateIsNewer;

  const usedMax =
    existing.usedMax === null
      ? candidate.usedMax
      : candidate.usedMax === null
        ? existing.usedMax
        : Math.max(existing.usedMax, candidate.usedMax);

  return {
    day: existing.day,
    periodSequence: existing.periodSequence,
    firstObservedAt:
      Date.parse(candidate.observedAt) < Date.parse(existing.firstObservedAt)
        ? candidate.observedAt
        : existing.firstObservedAt,
    observedAt: candidateIsNewer ? candidate.observedAt : existing.observedAt,
    usedMax,
    usedLatest: takeCandidateFields ? candidate.usedLatest : existing.usedLatest,
    remaining: takeCandidateFields ? candidate.remaining : existing.remaining,
    limit: takeCandidateFields ? candidate.limit : existing.limit,
    patronLevel: takeCandidateFields ? candidate.patronLevel : existing.patronLevel,
  };
}

export function buildProviderUsageSample(usage: CfbdUsage, now: Date): ProviderUsageSample {
  const observedAt = now.toISOString();
  return {
    day: utcDayOf(now),
    periodSequence: 0,
    firstObservedAt: observedAt,
    observedAt,
    usedMax: usage.used,
    usedLatest: usage.used,
    remaining: usage.remaining,
    limit: usage.limit,
    patronLevel: usage.patronLevel,
  };
}

/**
 * Merge one observation into the series.
 *
 * A day normally holds ONE entry, accumulated by `mergeIntoSample`. It gains a
 * SECOND when `observedPeriodReset` fires — the monthly counter fell inside that
 * UTC day, so the day spans two periods. Both are kept, because each answers a
 * question the other cannot: the closing entry holds the previous period's final
 * burn (the number Item 94 exists to capture, and the one an overwrite destroys),
 * and the opening entry holds the new period's starting point, without which the
 * first day-over-day difference of a month is computed against the old period and
 * comes out negative.
 *
 * Capped at two entries per day, and the whole series at
 * `PROVIDER_USAGE_SERIES_MAX_ENTRIES` — bounded by construction, with no pruning
 * job to forget.
 */
export function mergeProviderUsageSample(
  series: ProviderUsageSeries,
  sample: ProviderUsageSample
): ProviderUsageSeries {
  const sameDay = series.samples
    .filter((entry) => entry.day === sample.day)
    .sort((a, b) => a.periodSequence - b.periodSequence);
  const others = series.samples.filter((entry) => entry.day !== sample.day);

  let dayEntries: ProviderUsageSample[];
  if (sameDay.length === 0) {
    dayEntries = [sample];
  } else {
    const latest = sameDay[sameDay.length - 1]!;
    dayEntries =
      observedPeriodReset(latest, sample) && sameDay.length < MAX_PERIODS_PER_DAY
        ? [...sameDay, { ...sample, periodSequence: latest.periodSequence + 1 }]
        : [...sameDay.slice(0, -1), mergeIntoSample(latest, sample)];
  }

  const all = [...others, ...dayEntries].sort(
    (a, b) => a.day.localeCompare(b.day) || a.periodSequence - b.periodSequence
  );
  return { samples: all.slice(-PROVIDER_USAGE_SERIES_MAX_ENTRIES) };
}

export async function readProviderUsageSeries(): Promise<ProviderUsageSeries> {
  const record = await getAppState<unknown>(PROVIDER_USAGE_SERIES_SCOPE, PROVIDER_USAGE_SERIES_KEY);
  return parseProviderUsageSeries(record?.value);
}

/**
 * Record one observation. NEVER throws and never reports failure to the caller —
 * this is bookkeeping attached to jobs whose real work must not depend on it.
 * Returns whether the write happened, for tests and for a caller that wants to
 * log it; callers are free to ignore it.
 */
export async function recordProviderUsageSample(
  usage: CfbdUsage,
  now: Date = new Date()
): Promise<boolean> {
  try {
    // Read, merge and write INSIDE one key transaction. Two producers write this
    // row — the six-hourly sampler and the 15-minute game-stats probe — so they
    // overlap by construction. Read-modify-write outside a lock is last-write-wins:
    // Postgres upserts do not compare, and the file store's lock begins inside the
    // write, after the read. One invocation would silently discard the other's
    // newer observation, or a whole day at a boundary. Flagged independently by
    // both reviewers.
    await withAppStateKeyTransaction(
      PROVIDER_USAGE_SERIES_SCOPE,
      PROVIDER_USAGE_SERIES_KEY,
      async (txn) => {
        const record = await txn.read<unknown>();
        const series = parseProviderUsageSeries(record?.value);
        await txn.write(mergeProviderUsageSample(series, buildProviderUsageSample(usage, now)));
      }
    );
    return true;
  } catch {
    return false;
  }
}
