import type { CfbdUsage } from '../api/cfbdUsage.ts';
import { getAppState, setAppState } from './appStateStore.ts';

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
export const PROVIDER_USAGE_SERIES_MAX_DAYS = 400;

export type ProviderUsageSample = {
  /** UTC calendar day, `YYYY-MM-DD`. The quota period is monthly, so UTC days key it. */
  day: string;
  /** When this observation was taken. Later observations replace earlier ones — see `preferSample`. */
  observedAt: string;
  used: number | null;
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
  return {
    day,
    observedAt,
    used: usableNumberOrNull(record.used),
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

/**
 * Which of two same-day observations to keep.
 *
 * A USABLE observation always beats an unusable one, REGARDLESS of time. This is
 * the rule that matters: the 00:00 floor sample runs unconditionally, while the
 * opportunistic game-stats sample runs later in the day and can fail (network,
 * an unusable `remainingCalls`). Without this, one failed evening probe would
 * destroy a good morning reading for that day and leave a null where a number
 * had been. Among two observations of equal usability, the later one wins,
 * because `used` is cumulative within the period and a later read is strictly
 * more complete.
 */
export function preferSample(
  existing: ProviderUsageSample,
  candidate: ProviderUsageSample
): ProviderUsageSample {
  const existingUsable = existing.remaining !== null;
  const candidateUsable = candidate.remaining !== null;
  if (existingUsable !== candidateUsable) return existingUsable ? existing : candidate;
  return Date.parse(candidate.observedAt) >= Date.parse(existing.observedAt) ? candidate : existing;
}

/**
 * Merge one observation into a series: replace the same day's entry per
 * `preferSample`, keep days sorted ascending, and trim to the newest
 * `PROVIDER_USAGE_SERIES_MAX_DAYS`.
 */
export function mergeProviderUsageSample(
  series: ProviderUsageSeries,
  sample: ProviderUsageSample
): ProviderUsageSeries {
  const byDay = new Map<string, ProviderUsageSample>();
  for (const entry of series.samples) byDay.set(entry.day, entry);
  const existing = byDay.get(sample.day);
  byDay.set(sample.day, existing ? preferSample(existing, sample) : sample);
  const sorted = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  return { samples: sorted.slice(-PROVIDER_USAGE_SERIES_MAX_DAYS) };
}

export function buildProviderUsageSample(usage: CfbdUsage, now: Date): ProviderUsageSample {
  return {
    day: utcDayOf(now),
    observedAt: now.toISOString(),
    used: usage.used,
    remaining: usage.remaining,
    limit: usage.limit,
    patronLevel: usage.patronLevel,
  };
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
    const series = await readProviderUsageSeries();
    const merged = mergeProviderUsageSample(series, buildProviderUsageSample(usage, now));
    await setAppState(PROVIDER_USAGE_SERIES_SCOPE, PROVIDER_USAGE_SERIES_KEY, merged);
    return true;
  } catch {
    return false;
  }
}
