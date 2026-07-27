import {
  deriveCanonicalGameStatsSlateFromBuild,
  type CanonicalGame,
} from '@/lib/gameStats/canonicalSlate';
import { classifyScorePackStatus, type GameStatusBucket } from '@/lib/gameStatus';
import type { ScheduleWireItem } from '@/lib/schedule';
import { buildScheduleFromApi } from '@/lib/schedule';
import {
  attachScoresToSchedule,
  buildScheduleIndex,
  type NormalizedScoreRow,
} from '@/lib/scoreAttachment';
import type { CacheEntry } from '@/lib/scores/cache';
import type { ScorePack } from '@/lib/scores/types';
import { getAppStateEntries } from '@/lib/server/appStateStore';
import { loadCachedScheduleItems } from '@/lib/server/canonicalScheduleCache';
import { getScopedAliasMap } from '@/lib/server/globalAliasStore';
import { loadReconciledSeasonScoresByType } from '@/lib/server/scoreCacheReader';
import { getTeamDatabaseItems } from '@/lib/server/teamDatabaseStore';
import { createTeamIdentityResolver, type TeamIdentityResolver } from '@/lib/teamIdentity';
import type { AliasMap } from '@/lib/teamNames';

/**
 * PLATFORM-086B1 — cache-only canonical context for schedule-armed live-score
 * polling.
 *
 * The schedule is the source of game identity. This loader resolves the current
 * season's canonical games ONE build through `buildScheduleFromApi`, derives the
 * addressable canonical game list via the shared game-stats slate derivation
 * (which owns provider-id validation, numeric participant ids, duplicate-id
 * rejection, and canonical participants), and attaches the reconciled durable
 * scores through the shared score-attachment + team-identity authorities. It
 * NEVER contacts a provider and NEVER writes.
 *
 * A genuine schedule, catalog, alias, or score-cache READ/BUILD failure is
 * `unavailable` context — never valid absence. Genuine absence (no cached
 * scores) yields an available context whose games all carry `cachedStatus:
 * null`.
 */

/** The reason a canonical context could not be resolved (secret-safe). */
export type LiveScoreContextUnavailableReason =
  | 'schedule-load-failed'
  | 'catalog-load-failed'
  | 'alias-load-failed'
  | 'canonical-build-failed'
  | 'score-cache-unavailable';

/**
 * One addressable canonical game plus its current DURABLE resolution signals.
 * `cachedStatus` is the classified status of the attached reconciled score (null
 * when no score is cached). `pendingConfirmation` is true when this game's
 * provider id is recorded as an unconfirmed scoreboard final in any child score
 * entry. Target eligibility is derived from these in `pollingTarget`.
 */
export type LiveScoreGame = {
  canonical: CanonicalGame;
  cachedStatus: GameStatusBucket | null;
  /**
   * The reconciled prior-good score for this game (across the child AND the
   * season-wide `${year}-all-*` aggregate) as a canonical ScorePack, or null when
   * no score is cached. The durable merge uses this as its monotonic/null
   * protection reference so a transient scoreboard row cannot regress a better
   * aggregate row the child cache key alone would treat as absent.
   */
  cachedScore: ScorePack | null;
  pendingConfirmation: boolean;
};

export type LiveScoreContext = {
  year: number;
  games: LiveScoreGame[];
  /** Shared identity resolver for scoreboard-label validation (legacy fallback). */
  resolver: TeamIdentityResolver;
};

export type LiveScoreContextResult =
  | { status: 'available'; context: LiveScoreContext }
  | { status: 'unavailable'; reason: LiveScoreContextUnavailableReason };

function scorePackToNormalizedRow(pack: {
  id?: string | null;
  seasonType?: 'regular' | 'postseason' | null;
  startDate?: string | null;
  week: number | null;
  status: string;
  home: { team: string; score: number | null };
  away: { team: string; score: number | null };
  time: string | null;
}): NormalizedScoreRow {
  return {
    week: pack.week,
    seasonType: pack.seasonType ?? null,
    providerEventId: pack.id?.trim() || null,
    status: pack.status,
    time: pack.time,
    date: pack.startDate ?? null,
    home: { team: pack.home.team, score: pack.home.score },
    away: { team: pack.away.team, score: pack.away.score },
  };
}

/**
 * The union of provider game ids recorded as unconfirmed scoreboard finals
 * across every child score entry for the year. Cache-only; a read failure
 * propagates (mapped to `score-cache-unavailable` by the caller) — never
 * silently treated as "nothing pending".
 */
async function loadPendingFinalConfirmationIds(year: number): Promise<Set<string>> {
  const entries = await getAppStateEntries<CacheEntry>('scores', `${year}-`);
  const pending = new Set<string>();
  for (const entry of entries) {
    const ids = entry.value?.pendingFinalConfirmationIds;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id === 'string' && id.trim().length > 0) pending.add(id.trim());
    }
  }
  return pending;
}

/**
 * Load the cache-only canonical context. `now` is injected for deterministic
 * slate derivation. Loader/build failures map to `unavailable`; a genuinely
 * empty schedule yields an available, empty context.
 */
export async function loadLiveScoreContext(input: {
  year: number;
  now: Date;
}): Promise<LiveScoreContextResult> {
  const { year, now } = input;

  let scheduleItems: ScheduleWireItem[];
  try {
    scheduleItems = await loadCachedScheduleItems(year);
  } catch {
    return { status: 'unavailable', reason: 'schedule-load-failed' };
  }

  let teams;
  try {
    teams = await getTeamDatabaseItems();
  } catch {
    return { status: 'unavailable', reason: 'catalog-load-failed' };
  }
  // The team catalog is REQUIRED identity authority — an empty catalog would let
  // the schedule build seed identity from labels alone. Treat as unavailable.
  if (teams.length === 0) {
    return { status: 'unavailable', reason: 'catalog-load-failed' };
  }

  let aliasMap: AliasMap;
  try {
    // League-agnostic effective aliases only; no league-specific overrides.
    aliasMap = await getScopedAliasMap('', year);
  } catch {
    return { status: 'unavailable', reason: 'alias-load-failed' };
  }

  // Reconciled durable score state + pending-confirmation metadata. A store-read
  // FAILURE is unavailable context, never absent data — do not confuse the two.
  let regularRows: NormalizedScoreRow[];
  let postseasonRows: NormalizedScoreRow[];
  let pendingIds: Set<string>;
  try {
    const [reconciled, pending] = await Promise.all([
      loadReconciledSeasonScoresByType({ year, teams, aliasMap }),
      loadPendingFinalConfirmationIds(year),
    ]);
    regularRows = reconciled.regular.items.map(scorePackToNormalizedRow);
    postseasonRows = reconciled.postseason.items.map(scorePackToNormalizedRow);
    pendingIds = pending;
  } catch {
    return { status: 'unavailable', reason: 'score-cache-unavailable' };
  }

  // ONE canonical schedule build feeds BOTH the addressable canonical game list
  // and the score-attachment index, so scores and identity can never mix
  // provenance across two builds.
  let games;
  let canonicalGames: CanonicalGame[];
  try {
    games = buildScheduleFromApi({ scheduleItems, teams, aliasMap, season: year }).games;
    canonicalGames = deriveCanonicalGameStatsSlateFromBuild({
      year,
      games,
      scheduleItems,
      teams,
      aliasMap,
      now,
    }).games;
  } catch {
    return { status: 'unavailable', reason: 'canonical-build-failed' };
  }

  // Shared resolver: observed names from settled canonical participants plus the
  // cached score-row labels, so both the attachment and scoreboard-label
  // validation resolve every label they will encounter through teamIdentity.
  const observedNames = new Set<string>();
  for (const game of games) {
    for (const slot of [game.participants.home, game.participants.away]) {
      if (slot.kind === 'team' && slot.canonicalName.trim().length > 0) {
        observedNames.add(slot.canonicalName);
      }
    }
  }
  const allScoreRows = [...regularRows, ...postseasonRows];
  for (const row of allScoreRows) {
    observedNames.add(row.home.team);
    observedNames.add(row.away.team);
  }
  const resolver = createTeamIdentityResolver({
    teams,
    aliasMap,
    observedNames: [...observedNames],
  });

  // Attach the reconciled cached scores through the shared authority so each
  // canonical game learns its current cached status (keyed by AppGame.key,
  // which equals CanonicalGame.key).
  const scheduleIndex = buildScheduleIndex(games, resolver);
  const attached = attachScoresToSchedule({
    rows: allScoreRows,
    scheduleIndex,
    resolver,
    source: 'live-scores-context',
  });

  const liveGames: LiveScoreGame[] = canonicalGames.map((canonical) => {
    const attachedScore = attached.scoresByKey[canonical.key];
    // Reconstruct a canonical ScorePack from the attached reconciled score so the
    // merge has a monotonic/null protection reference for the CURRENTLY-SERVED
    // state (child + aggregate), keyed to this game's canonical identity.
    const cachedScore: ScorePack | null = attachedScore
      ? {
          id: String(canonical.providerGameId),
          seasonType: canonical.seasonType,
          startDate: canonical.kickoff,
          week: canonical.providerWeek,
          status: attachedScore.status,
          home: { team: attachedScore.home.team, score: attachedScore.home.score },
          away: { team: attachedScore.away.team, score: attachedScore.away.score },
          time: attachedScore.time,
        }
      : null;
    return {
      canonical,
      cachedStatus: attachedScore ? classifyScorePackStatus(attachedScore) : null,
      cachedScore,
      pendingConfirmation: pendingIds.has(String(canonical.providerGameId)),
    };
  });

  return { status: 'available', context: { year, games: liveGames, resolver } };
}
