import type { CfbdSeasonType } from '../cfbd.ts';
import {
  isPersistableIncomingRow,
  isValidProviderGameId,
  parseV2GameObservation,
  type ParsedV2Observation,
  type V2ObservationParseFailureReason,
} from './contract.ts';
import { expectsGameStats } from './coverage.ts';
import { mergeGameStatsPartitionDurable, type DurableMergeResult } from './durableMerge.ts';

/**
 * PLATFORM-086H3 — validated provider ingestion for game stats (ACTIVE).
 *
 * The single production entry point between an untrusted CFBD `/games/teams`
 * response and the durable merge authority. Every production writer (scheduled
 * cron refresh, authorized manual refresh, schedule-relative recovery) routes
 * its payload through `ingestGameStatsObservations`, which:
 *
 *   1. validates and classifies the raw payload (invalid payload, schema
 *      drift, valid-empty, observations) through the ONE strict parser
 *      (`parseV2GameObservation` — no second parser exists);
 *   2. attaches observations ONLY to games the canonical schedule already
 *      defines (matching by provider game id — never by team-name equality,
 *      and never constructing game identity from a statistics payload);
 *   3. hands the matched, validated observations to the PLATFORM-086H2
 *      durable merge authority, which serializes the read→merge→write under
 *      the per-partition transaction-scoped advisory lock.
 *
 * Invalid, uncertain, unmatched, or empty responses NEVER reach the merge and
 * therefore can never destructively clear prior durable evidence. The typed
 * result distinguishes provider-unavailable (handled by the caller at the
 * fetch boundary), invalid payload, schema drift, valid empty, contextually
 * unexpected empty, unmatched observations, unresolved identity, and merged
 * outcomes — provider uncertainty is never represented as confirmed absence.
 */

// === Canonical-schedule slate expectation ===

/**
 * Minimal structural shape of a cached canonical-schedule wire item that
 * game-stats ingestion consumes. Schedule remains the sole owner of game
 * identity: ingestion only ever narrows this list, it never fabricates
 * entries from provider statistics.
 */
export type ScheduleSlateItem = {
  id: string;
  week: number;
  seasonType?: string | null;
  startDate: string | null;
  status: string;
};

export type GameStatsSlateExpectation = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  /** Whether ANY schedule item exists for the year (slate-independent). */
  scheduleAvailable: boolean;
  /**
   * Provider-addressable stat-producing schedule games in this slate whose
   * kickoff is already `completedAfterMs` in the past — the games durable
   * coverage is judged against.
   */
  expectedIds: ReadonlySet<number>;
  /**
   * Addressable stat-producing games in the slate that have NOT yet reached
   * the completion threshold (still upcoming or too recent to expect stats).
   */
  pendingIds: ReadonlySet<number>;
  /**
   * Stat-producing schedule games in this slate that are NOT provider-
   * addressable yet (placeholder ids, e.g. unresolved postseason slots).
   * They are preserved as schedule placeholders — never expected, never
   * counted absent, never fetched.
   */
  deferredPlaceholders: number;
  /** Disrupted (canceled/postponed/…) slate games — never stat-producing. */
  disrupted: number;
};

/** A slate counts a game as expected once its kickoff is this far past. */
export const GAME_STATS_COMPLETED_AFTER_MS = 6 * 60 * 60 * 1000;

function normalizeSeasonType(value: unknown): CfbdSeasonType {
  return value === 'postseason' ? 'postseason' : 'regular';
}

/** Parse a schedule item id into a provider-addressable game id, if it is one. */
export function providerAddressableId(id: string | null | undefined): number | null {
  if (typeof id !== 'string' || !/^\d+$/.test(id.trim())) return null;
  const parsed = Number(id.trim());
  return isValidProviderGameId(parsed) ? parsed : null;
}

/**
 * Derive the canonical-schedule expectation for one weekly partition. This is
 * the ONLY source of "which games should have stats" — provider payloads never
 * extend it.
 */
export function deriveSlateExpectation(params: {
  scheduleItems: readonly ScheduleSlateItem[];
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  now: number;
  completedAfterMs?: number;
}): GameStatsSlateExpectation {
  const { scheduleItems, year, week, seasonType, now } = params;
  const completedAfterMs = params.completedAfterMs ?? GAME_STATS_COMPLETED_AFTER_MS;
  const expectedIds = new Set<number>();
  const pendingIds = new Set<number>();
  let deferredPlaceholders = 0;
  let disrupted = 0;

  for (const item of scheduleItems) {
    if (item.week !== week || normalizeSeasonType(item.seasonType) !== seasonType) continue;
    if (!expectsGameStats(item.status)) {
      disrupted += 1;
      continue;
    }
    const providerId = providerAddressableId(item.id);
    if (providerId === null) {
      deferredPlaceholders += 1;
      continue;
    }
    const kickoff = item.startDate ? new Date(item.startDate).getTime() : Number.NaN;
    if (Number.isFinite(kickoff) && kickoff <= now - completedAfterMs) {
      expectedIds.add(providerId);
    } else {
      pendingIds.add(providerId);
    }
  }

  return {
    year,
    week,
    seasonType,
    scheduleAvailable: scheduleItems.length > 0,
    expectedIds,
    pendingIds,
    deferredPlaceholders,
    disrupted,
  };
}

// === Payload validation ===

export type ParseFailureCounts = Partial<Record<V2ObservationParseFailureReason, number>>;

export type GameStatsPayloadValidation =
  | { kind: 'invalid-payload' }
  | { kind: 'empty' }
  | { kind: 'schema-drift'; entryCount: number; parseFailures: ParseFailureCounts }
  | {
      kind: 'observations';
      observations: ParsedV2Observation[];
      parseFailures: ParseFailureCounts;
      /** Entries rejected specifically for unresolvable team identity. */
      unresolvedIdentity: number;
    };

/**
 * Validate an untrusted provider payload into typed observations. A non-array
 * payload is invalid; an empty array is a VALID empty response (its contextual
 * meaning is judged against the schedule expectation, not here); a nonempty
 * payload in which no entry parses is schema drift. Individual entry failures
 * never poison sibling entries.
 */
export function validateGameStatsPayload(payload: unknown): GameStatsPayloadValidation {
  if (!Array.isArray(payload)) return { kind: 'invalid-payload' };
  if (payload.length === 0) return { kind: 'empty' };

  const observations: ParsedV2Observation[] = [];
  const parseFailures: ParseFailureCounts = {};
  let unresolvedIdentity = 0;
  for (const entry of payload) {
    const parsed = parseV2GameObservation(entry);
    if (parsed.ok) {
      observations.push(parsed.observation);
      continue;
    }
    parseFailures[parsed.reason] = (parseFailures[parsed.reason] ?? 0) + 1;
    if (parsed.reason === 'unusable-identity') unresolvedIdentity += 1;
  }

  if (observations.length === 0) {
    return { kind: 'schema-drift', entryCount: payload.length, parseFailures };
  }
  return { kind: 'observations', observations, parseFailures, unresolvedIdentity };
}

// === Ingestion (validation → schedule matching → durable merge) ===

export type GameStatsIngestionResult =
  | { kind: 'invalid-payload' }
  | { kind: 'schema-drift'; entryCount: number; parseFailures: ParseFailureCounts }
  | {
      /**
       * Valid empty provider response. `expected` when the slate has no
       * completed stat-producing games yet (or none at all); `unexpected`
       * when completed games exist that SHOULD have produced stats. Both are
       * non-destructive no-ops against durable state.
       */
      kind: 'valid-empty';
      emptyContext: 'expected' | 'unexpected';
    }
  | {
      /**
       * Observations parsed but none matched a canonical-schedule game in
       * this slate. Nothing merges — provider statistics never create games.
       */
      kind: 'unmatched-only';
      unmatched: number;
      unresolvedIdentity: number;
      parseFailures: ParseFailureCounts;
    }
  | {
      /**
       * Schedule-matched observations exist but NONE carries persistence
       * authority (no strictly valid recognized category on both sides).
       * Nothing merges; prior durable evidence is preserved. Reported as a
       * content failure, never as an ordinary empty success.
       */
      kind: 'no-persistable-observations';
      matched: number;
      unmatched: number;
      unresolvedIdentity: number;
      parseFailures: ParseFailureCounts;
    }
  | {
      kind: 'merged';
      merge: DurableMergeResult;
      matched: number;
      unmatched: number;
      unresolvedIdentity: number;
      parseFailures: ParseFailureCounts;
    };

export type GameStatsIngestionInput = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  /**
   * Observation fence: when the provider fetch producing `payload` STARTED
   * (strict RFC 3339). Forwarded verbatim to the merge authority, which
   * rejects invalid fences as `unavailable`.
   */
  fetchStartedAt: string;
  payload: unknown;
  expectation: GameStatsSlateExpectation;
};

/**
 * Route one validated provider response into the durable merge authority.
 *
 * Callers must derive `expectation` from the canonical schedule BEFORE the
 * provider fetch (an unavailable schedule fails the operation before quota is
 * spent). Only observations whose provider game id the schedule slate already
 * expects — completed or still pending — are merged; everything else is
 * reported, never persisted.
 */
export async function ingestGameStatsObservations(
  input: GameStatsIngestionInput
): Promise<GameStatsIngestionResult> {
  const { expectation } = input;
  const validation = validateGameStatsPayload(input.payload);
  if (validation.kind === 'invalid-payload') return { kind: 'invalid-payload' };
  if (validation.kind === 'schema-drift') {
    return {
      kind: 'schema-drift',
      entryCount: validation.entryCount,
      parseFailures: validation.parseFailures,
    };
  }
  if (validation.kind === 'empty') {
    return {
      kind: 'valid-empty',
      emptyContext: expectation.expectedIds.size > 0 ? 'unexpected' : 'expected',
    };
  }

  const matched: ParsedV2Observation[] = [];
  let unmatched = 0;
  for (const observation of validation.observations) {
    if (
      expectation.expectedIds.has(observation.providerGameId) ||
      expectation.pendingIds.has(observation.providerGameId)
    ) {
      matched.push(observation);
    } else {
      unmatched += 1;
    }
  }

  if (matched.length === 0) {
    return {
      kind: 'unmatched-only',
      unmatched,
      unresolvedIdentity: validation.unresolvedIdentity,
      parseFailures: validation.parseFailures,
    };
  }

  if (!matched.some(isPersistableIncomingRow)) {
    return {
      kind: 'no-persistable-observations',
      matched: matched.length,
      unmatched,
      unresolvedIdentity: validation.unresolvedIdentity,
      parseFailures: validation.parseFailures,
    };
  }

  const merge = await mergeGameStatsPartitionDurable({
    year: input.year,
    week: input.week,
    seasonType: input.seasonType,
    fetchStartedAt: input.fetchStartedAt,
    observations: matched,
  });

  return {
    kind: 'merged',
    merge,
    matched: matched.length,
    unmatched,
    unresolvedIdentity: validation.unresolvedIdentity,
    parseFailures: validation.parseFailures,
  };
}
