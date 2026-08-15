import { getAppState, listAppStateKeys, setAppState } from '../server/appStateStore.ts';

/**
 * INSIGHTS-018 — what the league has already been told, and when.
 *
 * Replaces `insights-suppression` as the serving authority. The old store
 * recorded that an insight FIRED and used that to hide it; this one records what
 * the league last SAW and when it last CHANGED, and selection reads it to decide
 * ordering rather than visibility. Nothing is hidden by having been seen.
 *
 * **Deliberately keyed by insight identity, not by "a generator ran this
 * request".** INSIGHTS-026's pulse produces items from a scheduled job, stored,
 * with no request-time generator behind them; a store that assumed every record
 * came from a generator this request just ran would need reworking the moment the
 * pulse lands. An observation is a fact about an insight, whoever produced it.
 *
 * Separate scope from the retired suppression records — `insights-observation:*`
 * — so the old records are neither read nor destroyed. They age out under their
 * own TTL and the rollover clear that already exists.
 */

const SCOPE_PREFIX = 'insights-observation';

/**
 * Records older than this are treated as absent, mirroring the suppression
 * store's backstop for the same reason: the season-rollover clear is best-effort
 * and never fails a rollover, so a league can enter a new season with records
 * still present. A full CFB season plus postseason spans ~135 days.
 */
export const OBSERVATION_RECORD_TTL_DAYS = 180;
const OBSERVATION_RECORD_TTL_MS = OBSERVATION_RECORD_TTL_DAYS * 24 * 60 * 60 * 1000;

export type InsightObservation = {
  /** `${insightId}:${newsHook}` — stable across a change to the stat value. */
  key: string;
  /** `insightSignature` output at the last observation. */
  signature: string;
  /** When this signature was first recorded — never rewritten. */
  firstSeenAt: string;
  /** When the signature last DIFFERED from the stored one. Drives NEW. */
  lastChangedAt: string;
  /**
   * When this insight was last selected into a served feed. Drives rotation.
   *
   * Null means recorded but never shown, which is reachable: the pulse writes an
   * observation when it produces an item, before any reader has seen it.
   */
  lastShownAt: string | null;
};

function scopeFor(leagueSlug: string, season: number): string {
  return `${SCOPE_PREFIX}:${leagueSlug}:${season}`;
}

export function observationKey(insightId: string, newsHook: string): string {
  return `${insightId}:${newsHook}`;
}

export function isObservationExpired(record: InsightObservation, now = Date.now()): boolean {
  const seenMs = new Date(record.firstSeenAt).getTime();
  if (!Number.isFinite(seenMs)) return false;
  return now - seenMs > OBSERVATION_RECORD_TTL_MS;
}

/**
 * Untrusted shape guard. `getAppState` performs no runtime validation, so a
 * legacy or hand-edited row can hold any JSON; a malformed record must read as
 * absent rather than crash a page or, worse, be treated as a valid observation
 * that suppresses nothing and badges everything.
 */
function toObservation(value: unknown): InsightObservation | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.key !== 'string' || v.key === '') return null;
  if (typeof v.signature !== 'string') return null;
  if (typeof v.firstSeenAt !== 'string' || typeof v.lastChangedAt !== 'string') return null;
  if (v.lastShownAt !== null && typeof v.lastShownAt !== 'string') return null;
  return {
    key: v.key,
    signature: v.signature,
    firstSeenAt: v.firstSeenAt,
    lastChangedAt: v.lastChangedAt,
    lastShownAt: v.lastShownAt,
  };
}

export async function loadObservations(
  leagueSlug: string,
  season: number,
  now = Date.now()
): Promise<Map<string, InsightObservation>> {
  const scope = scopeFor(leagueSlug, season);
  try {
    const keys = await listAppStateKeys(scope);
    const records = new Map<string, InsightObservation>();
    await Promise.all(
      keys.map(async (key) => {
        const record = await getAppState<unknown>(scope, key).catch(() => null);
        const observation = toObservation(record?.value);
        if (observation && !isObservationExpired(observation, now)) {
          records.set(key, observation);
        }
      })
    );
    return records;
  } catch {
    // A store failure must never empty the feed. Selection falls back to stable
    // priority order on an empty map, which is strictly better than serving
    // nothing — and better than the old behaviour, where a read failure silently
    // un-suppressed everything.
    return new Map();
  }
}

/**
 * Record that the league has now seen this insight, carrying forward what the
 * prior observation established.
 *
 * `lastChangedAt` moves ONLY when the signature differs. That is the whole
 * contract: NEW means changed, so a rotation that resurfaces an unchanged
 * standing fact must not reset the clock and re-badge it.
 */
export function nextObservation(
  prior: InsightObservation | undefined,
  key: string,
  signature: string,
  now: Date
): InsightObservation {
  const nowIso = now.toISOString();
  if (!prior) {
    return { key, signature, firstSeenAt: nowIso, lastChangedAt: nowIso, lastShownAt: nowIso };
  }
  const changed = prior.signature !== signature;
  return {
    key,
    signature,
    firstSeenAt: prior.firstSeenAt,
    lastChangedAt: changed ? nowIso : prior.lastChangedAt,
    lastShownAt: nowIso,
  };
}

export async function saveObservation(
  record: InsightObservation,
  leagueSlug: string,
  season: number
): Promise<void> {
  try {
    await setAppState(scopeFor(leagueSlug, season), record.key, record);
  } catch {
    // Non-blocking, matching the suppression store it replaces: a storage
    // failure degrades freshness, it does not stop insights serving.
  }
}
