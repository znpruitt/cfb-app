import { getAppState } from './server/appStateStore.ts';
import { getTeamDatabaseItems } from './server/teamDatabaseStore.ts';
import { buildScheduleFromApi, type ScheduleWireItem, type AppGame } from './schedule.ts';
import { createTeamIdentityResolver } from './teamIdentity.ts';
import {
  buildScheduleIndex,
  attachScoresToSchedule,
  type NormalizedScoreRow,
} from './scoreAttachment.ts';
import { deriveStandingsHistory } from './standingsHistory.ts';
import { parseOwnersCsv } from './parseOwnersCsv.ts';
import { isLikelyInvalidTeamLabel } from './teamNormalization.ts';
import type { SeasonArchive } from './seasonArchive.ts';
import type { AliasMap } from './teamNames.ts';

// Loose type matching the schedule cache CacheEntry items
type ScheduleCacheItem = {
  playoffRound?: string | null;
  status: string;
  homeTeam: string;
  awayTeam: string;
  [key: string]: unknown;
};

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

/**
 * Returns true if the current season's CFP National Championship has been played and is final.
 * Reads from the schedule cache — does not make upstream API calls.
 * Returns false safely if data is unavailable.
 */
export async function isSeasonComplete(year: number): Promise<boolean> {
  try {
    const cached = await getAppState<{ items: ScheduleCacheItem[] }>(
      'schedule',
      `${year}-all-all`
    );
    let items = cached?.value?.items ?? [];

    // Fall back to postseason-only cache if the combined key is absent
    if (items.length === 0) {
      const postseasonCached = await getAppState<{ items: ScheduleCacheItem[] }>(
        'schedule',
        `${year}-all-postseason`
      );
      items = postseasonCached?.value?.items ?? [];
    }

    const champGames = items.filter((item) => item.playoffRound === 'national_championship');
    if (champGames.length === 0) return false;

    return champGames.some((game) => (game.status ?? '').toLowerCase().includes('final'));
  } catch {
    return false;
  }
}

/**
 * Assembles a complete SeasonArchive for the given league and year from cached data.
 * Does NOT write anything — pure assembly function.
 * Called by the rollover route for both the preview diff and the confirmed write.
 */
export async function buildSeasonArchive(
  leagueSlug: string,
  year: number
): Promise<SeasonArchive> {
  // Load schedule items from cache (CacheEntry.items is ScheduleItem[] from cfbdSchedule.ts,
  // which is a structural subtype of ScheduleWireItem[] from schedule.ts — cast is safe)
  const scheduleCache = await getAppState<{ items: unknown[] }>('schedule', `${year}-all-all`);
  const scheduleItems = (scheduleCache?.value?.items ?? []) as ScheduleWireItem[];

  // Load team database
  const teams = await getTeamDatabaseItems();

  // Load alias map
  const aliasRecord = await getAppState<AliasMap>(`aliases:${leagueSlug}:${year}`, 'map');
  const aliasMap: AliasMap =
    aliasRecord?.value &&
    typeof aliasRecord.value === 'object' &&
    !Array.isArray(aliasRecord.value)
      ? aliasRecord.value
      : {};

  // Load owners CSV
  const ownersRecord = await getAppState<string>(`owners:${leagueSlug}:${year}`, 'csv');
  const ownersCsvText = typeof ownersRecord?.value === 'string' ? ownersRecord.value : '';

  // Load postseason overrides
  const overridesRecord = await getAppState<Record<string, Partial<AppGame>>>(
    `postseason-overrides:${leagueSlug}:${year}`,
    'map'
  );
  const manualOverrides: Record<string, Partial<AppGame>> =
    overridesRecord?.value &&
    typeof overridesRecord.value === 'object' &&
    !Array.isArray(overridesRecord.value)
      ? overridesRecord.value
      : {};

  // Build AppGame[] via the full schedule pipeline
  const { games } = buildScheduleFromApi({
    scheduleItems,
    teams,
    aliasMap,
    season: year,
    manualOverrides,
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

  // Load scores from cache (regular + postseason)
  const [regularCache, postseasonCache] = await Promise.all([
    getAppState<{ items: ScoresCacheItem[] }>('scores', `${year}-all-regular`),
    getAppState<{ items: ScoresCacheItem[] }>('scores', `${year}-all-postseason`),
  ]);

  const normalizedRows: NormalizedScoreRow[] = [
    ...(regularCache?.value?.items ?? []).map((item) =>
      scoresCacheItemToNormalizedRow(item, 'regular')
    ),
    ...(postseasonCache?.value?.items ?? []).map((item) =>
      scoresCacheItemToNormalizedRow(item, 'postseason')
    ),
  ];

  // Attach scores to schedule
  const scheduleIndex = buildScheduleIndex(games, resolver);
  const { scoresByKey } = attachScoresToSchedule({ rows: normalizedRows, scheduleIndex, resolver });

  // Build owner roster map from CSV
  const ownerRows = parseOwnersCsv(ownersCsvText);
  const rosterByTeam = new Map<string, string>(ownerRows.map((row) => [row.team, row.owner]));

  // Derive week-by-week standings history
  const standingsHistory = deriveStandingsHistory({
    games,
    rosterByTeam,
    // scoresByKey shape matches scores.ts ScorePack (status, home, away, time)
    scoresByKey: scoresByKey as Parameters<typeof deriveStandingsHistory>[0]['scoresByKey'],
  });

  // Extract final standings from the last week
  const lastWeek = standingsHistory.weeks[standingsHistory.weeks.length - 1];
  const finalStandings =
    lastWeek !== undefined ? (standingsHistory.byWeek[lastWeek]?.standings ?? []) : [];

  return {
    leagueSlug,
    year,
    archivedAt: new Date().toISOString(),
    ownerRosterSnapshot: ownersCsvText,
    standingsHistory,
    finalStandings,
  };
}
