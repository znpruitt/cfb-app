import type { CfbdSeasonType } from '../cfbd.ts';
import { inferSubdivisionFromConference } from '../conferenceSubdivision.ts';
import {
  resolveTeamIdentityKey,
  type TeamIdentityResolver,
  type TeamSubdivision,
} from '../teamIdentity.ts';
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
 *      defines — a provider game id alone NEVER authorizes persistence: the
 *      observation's participants must resolve through `teamIdentity.ts` and
 *      agree with the canonical schedule's participants and orientation, the
 *      schedule classification must permit persistence (FCS-vs-FCS games are
 *      excluded even when scheduled), and the game must be provider-
 *      addressable with resolved (non-placeholder) participants;
 *   3. hands the matched, validated observations to the PLATFORM-086H2
 *      durable merge authority, which serializes the read→merge→write under
 *      the per-partition transaction-scoped advisory lock.
 *
 * Invalid, uncertain, mismatched, unresolved, excluded, or empty responses
 * NEVER reach the merge and therefore can never destructively clear prior
 * durable evidence. Team comparison uses ONLY the centralized identity
 * resolution (`resolveTeamIdentityKey` — canonical identity key with the
 * central normalization fallback); no raw string equality, lowercase/trim
 * matching, or provider-specific alias logic exists here.
 */

// === Canonical-schedule slate expectation ===

/**
 * Minimal structural shape of a cached canonical-schedule wire item that
 * game-stats ingestion consumes. Schedule remains the sole owner of game
 * identity AND participant identity: ingestion only ever narrows this list,
 * it never fabricates entries — or participants — from provider statistics.
 */
export type ScheduleSlateItem = {
  id: string;
  week: number;
  seasonType?: string | null;
  startDate: string | null;
  status: string;
  homeTeam: string;
  awayTeam: string;
  homeConference?: string | null;
  awayConference?: string | null;
  neutralSite?: boolean;
};

/** How a canonical schedule participant resolved through `teamIdentity.ts`. */
export type ExpectedParticipantResolution =
  /** Resolved to a registry identity (canonical or alias). */
  | 'resolved'
  /**
   * A real team label the registry does not know — compared through the
   * centralized normalization key. Common for FCS opponents outside the FBS
   * team database; NOT a placeholder.
   */
  | 'registry-unresolved'
  /** A placeholder/invalid label (TBD, bowl names, …) — not yet a team. */
  | 'placeholder';

export type ExpectedParticipant = {
  /** Canonical schedule label (raw wire value; display/debug only). */
  label: string;
  /**
   * The sanctioned comparison key from `resolveTeamIdentityKey`: the resolved
   * canonical identity key, or the central normalization of the label when
   * the registry does not know it. Empty ONLY for placeholders.
   */
  identityKey: string;
  resolution: ExpectedParticipantResolution;
  /** FBS/FCS classification: resolver identity first, else canonical-schedule conference policy. */
  subdivision: TeamSubdivision;
};

export type ExpectedSlateGame = {
  providerGameId: number;
  home: ExpectedParticipant;
  away: ExpectedParticipant;
  /** Schedule-owned neutral-site semantics (orientation exception below). */
  neutralSite: boolean;
  status: string;
  /** Whether the game has passed the stats-completion threshold. */
  phase: 'expected' | 'pending';
};

export type GameStatsSlateExpectation = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  /** Whether ANY schedule item exists for the year (slate-independent). */
  scheduleAvailable: boolean;
  /**
   * Attachable canonical games by provider game id: provider-addressable,
   * participants identified (or centrally normalizable), classification
   * persistence-eligible. The ONLY games an observation may merge into.
   */
  games: ReadonlyMap<number, ExpectedSlateGame>;
  /** Attachable games past the completion threshold (coverage is judged on these). */
  expectedIds: ReadonlySet<number>;
  /** Attachable games not yet past the completion threshold. */
  pendingIds: ReadonlySet<number>;
  /**
   * Numeric provider ids whose participants are still placeholders (e.g. an
   * unresolved postseason slot that already carries a provider id). A numeric
   * id alone does NOT make a placeholder addressable — these defer.
   */
  placeholderIds: ReadonlySet<number>;
  /** Scheduled ids excluded from persistence by classification (FCS-vs-FCS). */
  excludedIds: ReadonlySet<number>;
  /**
   * Stat-producing schedule games deferred as placeholders: non-numeric ids
   * plus every id in `placeholderIds`. Preserved, never expected, never
   * counted absent, never fetched.
   */
  deferredPlaceholders: number;
  /** Scheduled games excluded by FCS-vs-FCS classification. */
  excludedByClassification: number;
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

function deriveParticipant(
  resolver: TeamIdentityResolver,
  label: string | null | undefined,
  conference: string | null | undefined
): ExpectedParticipant {
  const raw = typeof label === 'string' ? label : '';
  const resolution = resolver.resolveName(raw);
  if (resolution.resolutionSource === 'invalid_label') {
    return { label: raw, identityKey: '', resolution: 'placeholder', subdivision: 'UNKNOWN' };
  }
  const identityKey = resolveTeamIdentityKey(resolver, raw);
  if (identityKey.length === 0) {
    return { label: raw, identityKey: '', resolution: 'placeholder', subdivision: 'UNKNOWN' };
  }
  const resolverSubdivision = resolution.status === 'resolved' ? resolution.subdivision : undefined;
  const subdivision =
    resolverSubdivision && resolverSubdivision !== 'UNKNOWN' && resolverSubdivision !== 'OTHER'
      ? resolverSubdivision
      : inferSubdivisionFromConference(conference);
  return {
    label: raw,
    identityKey,
    resolution: resolution.status === 'resolved' ? 'resolved' : 'registry-unresolved',
    subdivision,
  };
}

/**
 * Derive the canonical-schedule expectation for one weekly partition. This is
 * the ONLY source of "which games should have stats" — provider payloads never
 * extend it. Participant identity is retained (never discarded down to bare
 * ids) so provider observations can be validated against canonical
 * participants, orientation, and FBS/FCS classification before persistence.
 */
export function deriveSlateExpectation(params: {
  scheduleItems: readonly ScheduleSlateItem[];
  resolver: TeamIdentityResolver;
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  now: number;
  completedAfterMs?: number;
}): GameStatsSlateExpectation {
  const { scheduleItems, resolver, year, week, seasonType, now } = params;
  const completedAfterMs = params.completedAfterMs ?? GAME_STATS_COMPLETED_AFTER_MS;

  const games = new Map<number, ExpectedSlateGame>();
  const expectedIds = new Set<number>();
  const pendingIds = new Set<number>();
  const placeholderIds = new Set<number>();
  const excludedIds = new Set<number>();
  let deferredPlaceholders = 0;
  let excludedByClassification = 0;
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

    const home = deriveParticipant(resolver, item.homeTeam, item.homeConference);
    const away = deriveParticipant(resolver, item.awayTeam, item.awayConference);

    // A numeric provider id is NOT sufficient placeholder resolution: until
    // both canonical participants resolve to real teams, the game defers.
    if (home.resolution === 'placeholder' || away.resolution === 'placeholder') {
      placeholderIds.add(providerId);
      deferredPlaceholders += 1;
      continue;
    }

    // Classification comes from the canonical schedule/team registry, never
    // from provider-stat availability: FCS-vs-FCS games are excluded even
    // when scheduled; FBS-vs-FBS, FBS-vs-FCS, and FCS-vs-FBS persist.
    if (home.subdivision === 'FCS' && away.subdivision === 'FCS') {
      excludedIds.add(providerId);
      excludedByClassification += 1;
      continue;
    }

    const kickoff = item.startDate ? new Date(item.startDate).getTime() : Number.NaN;
    const phase =
      Number.isFinite(kickoff) && kickoff <= now - completedAfterMs ? 'expected' : 'pending';
    games.set(providerId, {
      providerGameId: providerId,
      home,
      away,
      neutralSite: item.neutralSite === true,
      status: item.status,
      phase,
    });
    if (phase === 'expected') expectedIds.add(providerId);
    else pendingIds.add(providerId);
  }

  return {
    year,
    week,
    seasonType,
    scheduleAvailable: scheduleItems.length > 0,
    games,
    expectedIds,
    pendingIds,
    placeholderIds,
    excludedIds,
    deferredPlaceholders,
    excludedByClassification,
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

// === Canonical attachment classification ===

/** How one parsed observation relates to the canonical schedule slate. */
export type ObservationAttachmentState =
  /** Scheduled id + canonical participants agree (incl. the documented neutral-site orientation exception). */
  | 'matched'
  /** Scheduled id, resolvable provider participants, but they do NOT agree with the canonical participants/orientation. */
  | 'participant-mismatch'
  /** Scheduled id, but a provider participant cannot resolve to any team identity. */
  | 'unresolved-participant'
  /** Scheduled id excluded from persistence by classification (FCS-vs-FCS). */
  | 'excluded-classification'
  /** Scheduled id whose canonical participants are still unresolved placeholders. */
  | 'placeholder-deferred'
  /** Provider id the canonical schedule slate does not define at all. */
  | 'unscheduled-id';

export type ObservationAttachmentCounts = {
  matched: number;
  participantMismatch: number;
  unresolvedParticipant: number;
  excludedClassification: number;
  placeholderDeferred: number;
  unscheduledId: number;
};

export function emptyAttachmentCounts(): ObservationAttachmentCounts {
  return {
    matched: 0,
    participantMismatch: 0,
    unresolvedParticipant: 0,
    excludedClassification: 0,
    placeholderDeferred: 0,
    unscheduledId: 0,
  };
}

/**
 * Classify one parsed observation against the canonical slate expectation.
 *
 * Persistence authority requires ALL of: a scheduled provider game id, both
 * provider participants resolving through the centralized identity path, and
 * agreement with the canonical schedule participants in schedule orientation.
 * Orientation exception (documented): for a schedule-owned NEUTRAL-SITE game
 * the provider designation may be reversed — the participants must still be
 * the same canonical identities, merely swapped; home/away for a non-neutral
 * game must match exactly. Everything else is typed non-persistable and can
 * never modify durable state.
 */
export function classifyObservationAttachment(
  observation: ParsedV2Observation,
  expectation: GameStatsSlateExpectation,
  resolver: TeamIdentityResolver
): ObservationAttachmentState {
  const id = observation.providerGameId;
  const game = expectation.games.get(id);
  if (!game) {
    if (expectation.excludedIds.has(id)) return 'excluded-classification';
    if (expectation.placeholderIds.has(id)) return 'placeholder-deferred';
    return 'unscheduled-id';
  }

  const homeKey = resolveTeamIdentityKey(resolver, observation.home.school);
  const awayKey = resolveTeamIdentityKey(resolver, observation.away.school);
  if (homeKey.length === 0 || awayKey.length === 0) return 'unresolved-participant';

  if (homeKey === game.home.identityKey && awayKey === game.away.identityKey) return 'matched';
  if (game.neutralSite && homeKey === game.away.identityKey && awayKey === game.home.identityKey) {
    return 'matched';
  }
  return 'participant-mismatch';
}

// === Ingestion (validation → canonical attachment → durable merge) ===

export type GameStatsIngestionResult =
  | { kind: 'invalid-payload' }
  | { kind: 'schema-drift'; entryCount: number; parseFailures: ParseFailureCounts }
  | {
      /**
       * Valid empty provider response. `expected` when the slate has no
       * completed stat-producing games yet (or none at all); `unexpected`
       * when completed games exist that SHOULD have produced stats. Both are
       * non-destructive against durable state; the unexpected case is a
       * FAILURE at the publication layer, never "no applicable data".
       */
      kind: 'valid-empty';
      emptyContext: 'expected' | 'unexpected';
    }
  | {
      /**
       * Observations parsed but none earned canonical attachment. The typed
       * breakdown distinguishes mismatched participants, unresolved provider
       * identity, excluded classification, deferred placeholders, and
       * unscheduled ids — never collapsed into one bucket. Nothing merges.
       */
      kind: 'no-attachable-observations';
      attachment: ObservationAttachmentCounts;
      parseFailures: ParseFailureCounts;
      unresolvedIdentity: number;
    }
  | {
      /**
       * Canonically attached observations exist but NONE carries persistence
       * authority (no strictly valid recognized category on both sides).
       * Nothing merges; prior durable evidence is preserved.
       */
      kind: 'no-persistable-observations';
      attachment: ObservationAttachmentCounts;
      parseFailures: ParseFailureCounts;
      unresolvedIdentity: number;
    }
  | {
      kind: 'merged';
      merge: DurableMergeResult;
      attachment: ObservationAttachmentCounts;
      parseFailures: ParseFailureCounts;
      unresolvedIdentity: number;
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
  resolver: TeamIdentityResolver;
};

/**
 * Route one validated provider response into the durable merge authority.
 *
 * Callers must derive `expectation` from the canonical schedule (with the
 * centralized identity resolver) BEFORE the provider fetch — an unavailable
 * schedule or identity context fails the operation before quota is spent.
 * Only observations that pass FULL canonical attachment (scheduled id +
 * resolved participants + participant/orientation agreement + classification
 * eligibility) are merged; everything else is reported, never persisted.
 */
export async function ingestGameStatsObservations(
  input: GameStatsIngestionInput
): Promise<GameStatsIngestionResult> {
  const { expectation, resolver } = input;
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

  const attachment = emptyAttachmentCounts();
  const matched: ParsedV2Observation[] = [];
  for (const observation of validation.observations) {
    const state = classifyObservationAttachment(observation, expectation, resolver);
    switch (state) {
      case 'matched':
        attachment.matched += 1;
        matched.push(observation);
        break;
      case 'participant-mismatch':
        attachment.participantMismatch += 1;
        break;
      case 'unresolved-participant':
        attachment.unresolvedParticipant += 1;
        break;
      case 'excluded-classification':
        attachment.excludedClassification += 1;
        break;
      case 'placeholder-deferred':
        attachment.placeholderDeferred += 1;
        break;
      case 'unscheduled-id':
        attachment.unscheduledId += 1;
        break;
    }
  }

  if (matched.length === 0) {
    return {
      kind: 'no-attachable-observations',
      attachment,
      parseFailures: validation.parseFailures,
      unresolvedIdentity: validation.unresolvedIdentity,
    };
  }

  if (!matched.some(isPersistableIncomingRow)) {
    return {
      kind: 'no-persistable-observations',
      attachment,
      parseFailures: validation.parseFailures,
      unresolvedIdentity: validation.unresolvedIdentity,
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
    attachment,
    parseFailures: validation.parseFailures,
    unresolvedIdentity: validation.unresolvedIdentity,
  };
}
