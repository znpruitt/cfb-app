import { getAppState } from './server/appStateStore.ts';
import { loadCanonicalScheduleForBuild } from './server/canonicalScheduleCache.ts';
import { loadReconciledSeasonScoresByType } from './server/scoreCacheReader.ts';
import { getScopedAliasMap } from './server/globalAliasStore.ts';
import { getTeamDatabaseItems } from './server/teamDatabaseStore.ts';
import { buildScheduleFromApi, type ScheduleWireItem, type AppGame } from './schedule.ts';
import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity.ts';
import {
  buildScheduleIndex,
  attachScoresToSchedule,
  type NormalizedScoreRow,
} from './scoreAttachment.ts';
import { isLikelyInvalidTeamLabel } from './teamNormalization.ts';
import type { ScorePack } from './scores.ts';
import type { AliasMap } from './teamNames.ts';

/**
 * PLATFORM-086H3E3 — the ONE league-scoped scored season build.
 *
 * Extracted verbatim from `buildSeasonArchive` so archive construction and the
 * live analytics provenance assembly share EXACTLY one assembly: cache-only
 * loads (schedule wire rows, team catalog, league/year scoped aliases, league
 * postseason overrides, reconciled scores), ONE `buildScheduleFromApi`
 * invocation, and score attachment against that same build. Consumers that
 * pair a game-stat slate with `scoresByKey` derive the slate from THIS build's
 * exact `games` + `scheduleItems`, so keys, aliases, and overrides can never
 * mix across builds. Never calls a provider; a store-read failure propagates
 * (never silently archives or serves an incomplete snapshot).
 */

// Loose type matching the scores cache CacheEntry items (mirrors scores/types.ts ScorePack)
type ScoresCacheItem = {
  id?: string | null;
  seasonType?: string | null;
  startDate?: string | null;
  week: number | null;
  status: string;
  home: { team: string; score: number | null };
  away: { team: string; score: number | null };
  time: string | null;
};

function scoresCacheItemToNormalizedRow(
  item: ScoresCacheItem,
  defaultSeasonType: 'regular' | 'postseason'
): NormalizedScoreRow {
  const seasonType =
    item.seasonType === 'regular' || item.seasonType === 'postseason'
      ? item.seasonType
      : defaultSeasonType;
  return {
    week: item.week,
    seasonType,
    providerEventId: item.id ?? null,
    status: item.status,
    time: item.time,
    date: item.startDate ?? null,
    home: item.home,
    away: item.away,
  };
}

/** Typed absence: the full-season schedule cache is empty/missing for the year. */
export class SeasonScheduleCacheUnavailableError extends Error {
  constructor(year: number) {
    super(
      `Full-season schedule cache is unavailable for ${year}. Rebuild the schedule cache before archiving.`
    );
    this.name = 'SeasonScheduleCacheUnavailableError';
  }
}

export type SeasonScoredBuild = {
  /** The exact wire rows fed to the build. */
  scheduleItems: ScheduleWireItem[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
  /** The exact `buildScheduleFromApi(...).games` output of the ONE build. */
  games: AppGame[];
  /** Reconciled scores attached to that same build's keys. */
  scoresByKey: Record<string, ScorePack>;
  /**
   * The ONE build's `issues`, seeded with what the durable read boundary destroyed
   * (PLATFORM-813). Rows lost anywhere — dropped at the boundary, coerced in a way that
   * changes the season, or discarded by the build — appear here as
   * `invalid-schedule-row:`, read by `discardedRowIssues`.
   *
   * RETURNED, NOT ACTED ON. What a discard means is the consumer's decision: the archive
   * refuses (`buildSeasonArchive`), while recap and analytics provenance render the
   * surviving games. v3 refused HERE, inside the shared build, which made all three
   * refuse — contradicting both the ruling and the commit message that described it.
   */
  issues: string[];
};

/**
 * Assemble the league-scoped scored build for one season from caches only.
 * Throws when the full-season schedule cache is unavailable (rebuild it before
 * archiving or serving analytics) and propagates store-read failures.
 */
export async function assembleSeasonScoredBuild(
  leagueSlug: string,
  year: number
): Promise<SeasonScoredBuild> {
  // Load schedule items through the ONE canonical reader (PLATFORM-663). This
  // function previously re-implemented `loadCachedScheduleItems`' aggregate-then-
  // pair precedence inline; two copies of that precedence could disagree about
  // which key serves, and the archive is the consumer where disagreeing is
  // durable — a wrong season gets written down rather than re-rendered.
  //
  // PLATFORM-813: the read's `boundaryIssues` are seeded into the build below, so the
  // returned `issues` is ONE list of every row lost anywhere. Neither half is enough on
  // its own: v2 read only the boundary (a count of non-object rows) and missed rows the
  // build discards; v3 read only the build and missed rows the boundary dropped or
  // blanked — a blanked postseason participant is a TBD slot by the time the build sees
  // it, and a dropped row never arrives.
  const { items: scheduleItems, boundaryIssues } = await loadCanonicalScheduleForBuild(year);

  if (scheduleItems.length === 0) {
    throw new SeasonScheduleCacheUnavailableError(year);
  }

  // Load team database
  const teams = await getTeamDatabaseItems();

  // Load the effective alias map (stored global > year > SEED_ALIASES) — the
  // SAME resolution live canonical standings use, so archived standings/history
  // can't disagree with live for the same games/roster/scores.
  const aliasMap: AliasMap = await getScopedAliasMap(leagueSlug, year);

  // Load postseason overrides
  const overridesRecord = await getAppState<Record<string, Partial<AppGame>>>(
    `postseason-overrides:${leagueSlug}:${year}`,
    'map'
  );
  const manualOverrides: Record<string, Partial<AppGame>> = overridesRecord?.value &&
  typeof overridesRecord.value === 'object' &&
  !Array.isArray(overridesRecord.value)
    ? overridesRecord.value
    : {};

  // Build AppGame[] via the full schedule pipeline
  const { games, issues } = buildScheduleFromApi({
    scheduleItems,
    teams,
    aliasMap,
    season: year,
    manualOverrides,
    boundaryIssues,
  });

  // Rebuild resolver with same observed names buildScheduleFromApi uses internally,
  // needed for score attachment (buildScheduleFromApi creates its own internal resolver)
  const providerNames = Array.from(
    new Set(
      scheduleItems
        .flatMap((item) => [item.homeTeam, item.awayTeam])
        .filter(
          (name): name is string => typeof name === 'string' && !isLikelyInvalidTeamLabel(name)
        )
    )
  );
  const resolver = createTeamIdentityResolver({ teams, aliasMap, observedNames: providerNames });

  // Load scores from cache (regular + postseason), reconciling the season-wide
  // and per-week entries via the shared cache-only reader (PLATFORM-084B) so the
  // build captures the SAME reconciled scores public /api/scores and canonical
  // standings see. Cache-only; no provider call. A store-read failure propagates
  // (PLATFORM-084A) so a blip does not silently produce an incomplete snapshot.
  const { regular: regularScores, postseason: postseasonScores } =
    await loadReconciledSeasonScoresByType({ year, teams, aliasMap });

  const normalizedRows: NormalizedScoreRow[] = [
    ...regularScores.items.map((item) => scoresCacheItemToNormalizedRow(item, 'regular')),
    ...postseasonScores.items.map((item) => scoresCacheItemToNormalizedRow(item, 'postseason')),
  ];

  // Attach scores to schedule
  const scheduleIndex = buildScheduleIndex(games, resolver);
  const { scoresByKey } = attachScoresToSchedule({ rows: normalizedRows, scheduleIndex, resolver });

  return {
    scheduleItems,
    teams,
    aliasMap,
    games,
    scoresByKey: scoresByKey as Record<string, ScorePack>,
    issues,
  };
}
