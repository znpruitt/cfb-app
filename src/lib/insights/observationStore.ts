import {
  deleteAppState,
  getAppState,
  listAppStateKeys,
  setAppState,
} from '../server/appStateStore.ts';

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
  /**
   * The insight's stable ID — NOT `id:newsHook`.
   *
   * Review found the hook cannot be part of the key while it is also part of the
   * signature: an insight moving hook A → B → A would load the old A record,
   * find an equal signature, and report NO CHANGE for a transition that
   * happened twice. One latest observation per insight; the hook lives in the
   * signature, where a transition is what it is meant to detect.
   */
  key: string;
  /** `insightSignature` output at the last observation. */
  signature: string;
  /**
   * The stat value at the last observation, so a threshold-aware comparison is
   * possible. The signature alone cannot serve: it is exact by design, and
   * `standing-moving` types need tolerance rather than equality.
   */
  statValue: number;
  /** When this signature was first recorded — never rewritten. Display only. */
  firstSeenAt: string;
  /**
   * The rotation bucket this was last SELECTED in.
   *
   * Rotation was advancing on every request: `lastShownAt` was rewritten each
   * time, so after the first load every record held a distinct timestamp, the
   * bucket tiebreak never fired, and the served set flipped on every page load —
   * the precise failure the design says it avoids. Both reviewers reproduced it.
   * Recording the bucket is what makes "everything within one bucket sees the
   * same order" true rather than merely asserted.
   */
  lastShownBucket: string | null;
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

export function observationKey(insightId: string): string {
  return insightId;
}

/**
 * Expiry runs from the last ACTIVITY, not from `firstSeenAt`.
 *
 * `firstSeenAt` is deliberately never rewritten, so measuring from it expired
 * every record 180 days after its first appearance no matter how recently it had
 * changed or been shown. A season scope can span preseason through postseason,
 * and at the boundary spent EVENTS became fresh candidates again — re-serving
 * "won the toilet bowl 7 times in 2025" months later, exactly what the event
 * classification exists to prevent.
 */
export function isObservationExpired(record: InsightObservation, now = Date.now()): boolean {
  const activity = record.lastShownAt ?? record.lastChangedAt;
  const activityMs = new Date(activity).getTime();
  if (!Number.isFinite(activityMs)) return false;
  return now - activityMs > OBSERVATION_RECORD_TTL_MS;
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
  if (typeof v.statValue !== 'number' || !Number.isFinite(v.statValue)) return null;
  if (typeof v.firstSeenAt !== 'string' || typeof v.lastChangedAt !== 'string') return null;
  if (v.lastShownAt !== null && typeof v.lastShownAt !== 'string') return null;
  if (v.lastShownBucket !== null && typeof v.lastShownBucket !== 'string') return null;
  // Timestamps are validated HERE, not in the expiry predicate. A record with a
  // corrupt date was accepted and then never expired, pinning a stale signature
  // and rotation position forever — this guard's own doc says a malformed record
  // must read as absent, and it did not.
  const parsable = (value: string): boolean => Number.isFinite(new Date(value).getTime());
  if (!parsable(v.firstSeenAt) || !parsable(v.lastChangedAt)) return null;
  if (typeof v.lastShownAt === 'string' && !parsable(v.lastShownAt)) return null;
  return {
    key: v.key,
    signature: v.signature,
    statValue: v.statValue,
    firstSeenAt: v.firstSeenAt,
    lastChangedAt: v.lastChangedAt,
    lastShownAt: v.lastShownAt,
    lastShownBucket: (v.lastShownBucket as string | null) ?? null,
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
  statValue: number,
  changed: boolean,
  now: Date,
  bucket: string
): InsightObservation {
  const nowIso = now.toISOString();
  if (!prior) {
    return {
      key,
      signature,
      statValue,
      firstSeenAt: nowIso,
      lastChangedAt: nowIso,
      lastShownAt: nowIso,
      lastShownBucket: bucket,
    };
  }
  // `lastShownAt` advances ONLY on a new bucket. Advancing per request made every
  // record's timestamp distinct after the first load, so the rotation sort had a
  // total order it should not have had and the served set flipped every time the
  // page was opened.
  const newBucket = prior.lastShownBucket !== bucket;
  return {
    key,
    signature,
    statValue,
    firstSeenAt: prior.firstSeenAt,
    lastChangedAt: changed ? nowIso : prior.lastChangedAt,
    lastShownAt: newBucket ? nowIso : prior.lastShownAt,
    lastShownBucket: bucket,
  };
}

/** Every observation for a league-season, for the rollover clear. */
export async function clearAllObservations(leagueSlug: string, season: number): Promise<void> {
  const scope = scopeFor(leagueSlug, season);
  try {
    const keys = await listAppStateKeys(scope);
    await Promise.all(keys.map((key) => deleteAppState(scope, key).catch(() => undefined)));
  } catch {
    // Best-effort, matching `clearAllSuppressionRecords`: a rollover must never
    // fail because freshness bookkeeping could not be cleared.
  }
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
