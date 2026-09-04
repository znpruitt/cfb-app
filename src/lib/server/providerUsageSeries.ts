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

/** A fully usable observation carries `remaining` AND the tier-derived `used`/`limit`. */
function usabilityRank(sample: ProviderUsageSample): number {
  if (sample.remaining === null) return 0;
  // `used` and `limit` derive from `patronLevel` (`cfbdUsage.ts`): a response with
  // `remainingCalls` but no usable `patronLevel` yields BOTH as null. That is the
  // weaker observation — and `used` is the field the "what does a Saturday cost"
  // consumer actually reads — so it must not displace a complete one.
  return sample.used !== null && sample.limit !== null ? 2 : 1;
}

/**
 * Which of two same-day observations to keep.
 *
 * MORE COMPLETE WINS FIRST, regardless of time. The unconditional sampler and the
 * opportunistic game-stats probe both write, and either can come back degraded —
 * unreachable, or usable-but-tierless. Without this, one bad later probe would
 * replace a good earlier reading with a null, or silently drop that day's `used`
 * and `limit`.
 *
 * Among EQUALLY complete observations, the greater `used` wins — NOT the later
 * one. That distinction is load-bearing across a month boundary: CFBD's reset
 * hour is not verified to be 00:00 UTC, so a reset at, say, 06:00 on the 1st puts
 * a pre-reset reading (`used` high) and a post-reset reading (`used` ≈ 0) on the
 * SAME UTC day. Preferring the later would overwrite the previous month's final
 * burn with a fresh zero — destroying precisely the number this series exists to
 * preserve. `used` only rises within a period, so "greater" is "later" everywhere
 * except the one case that matters. `observedAt` breaks a true tie.
 */
export function preferSample(
  existing: ProviderUsageSample,
  candidate: ProviderUsageSample
): ProviderUsageSample {
  const existingRank = usabilityRank(existing);
  const candidateRank = usabilityRank(candidate);
  if (existingRank !== candidateRank) return existingRank > candidateRank ? existing : candidate;

  const existingUsed = existing.used;
  const candidateUsed = candidate.used;
  if (existingUsed !== null && candidateUsed !== null && existingUsed !== candidateUsed) {
    return candidateUsed > existingUsed ? candidate : existing;
  }
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
