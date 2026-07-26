import { getAppState } from './server/appStateStore.ts';
import { deriveStandingsHistory } from './standingsHistory.ts';
import { parseOwnersCsv } from './parseOwnersCsv.ts';
import { assembleSeasonScoredBuild } from './seasonBuild.ts';
import { buildGameStatSlateSnapshot } from './gameStats/slateSnapshot.ts';
import type { SeasonArchive } from './seasonArchive.ts';

// Loose type matching the schedule cache CacheEntry items
type ScheduleCacheItem = {
  playoffRound?: string | null;
  status: string;
  homeTeam: string;
  awayTeam: string;
  [key: string]: unknown;
};

/**
 * Locate the latest postseason game date from the schedule cache for the given year.
 * Prefers a game flagged `playoffRound === 'national_championship'`, otherwise falls
 * back to the latest `seasonType === 'postseason'` game. Returns ISO date or null.
 */
export async function findNationalChampionshipGameDate(year: number): Promise<string | null> {
  try {
    const cached = await getAppState<{ items: Array<Record<string, unknown>> }>(
      'schedule',
      `${year}-all-all`
    );
    let items = cached?.value?.items ?? [];
    if (items.length === 0) {
      const postseasonCached = await getAppState<{ items: Array<Record<string, unknown>> }>(
        'schedule',
        `${year}-all-postseason`
      );
      items = postseasonCached?.value?.items ?? [];
    }
    if (items.length === 0) return null;

    const champ = items
      .filter((i) => i.playoffRound === 'national_championship')
      .map((i) => (typeof i.startDate === 'string' ? i.startDate : null))
      .filter((d): d is string => Boolean(d))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    if (champ) return champ;

    const latestPostseason = items
      .filter((i) => i.seasonType === 'postseason')
      .map((i) => (typeof i.startDate === 'string' ? i.startDate : null))
      .filter((d): d is string => Boolean(d))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    return latestPostseason ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the current season's CFP National Championship has been played and is final.
 * Reads from the schedule cache — does not make upstream API calls.
 * Returns false safely if data is unavailable.
 */
export async function isSeasonComplete(year: number): Promise<boolean> {
  try {
    const cached = await getAppState<{ items: ScheduleCacheItem[] }>('schedule', `${year}-all-all`);
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
export async function buildSeasonArchive(leagueSlug: string, year: number): Promise<SeasonArchive> {
  // The ONE league-scoped scored build (PLATFORM-086H3E3, extracted verbatim):
  // cache-only schedule/teams/aliases/overrides/reconciled-scores loads, ONE
  // buildScheduleFromApi invocation, scores attached against that same build.
  // The archive and the live analytics provenance share this exact assembly.
  const { scheduleItems, teams, aliasMap, games, scoresByKey } = await assembleSeasonScoredBuild(
    leagueSlug,
    year
  );

  // Load owners CSV
  const ownersRecord = await getAppState<string>(`owners:${leagueSlug}:${year}`, 'csv');
  const ownersCsvText = typeof ownersRecord?.value === 'string' ? ownersRecord.value : '';

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

  const now = new Date();

  // Archive-owned game-stat slate snapshot (PLATFORM-086H3E1): derived from the
  // EXACT build above — the same scheduleItems/teams/aliasMap/manualOverrides
  // that produced `games` — so the snapshot pairs ONLY with THIS archive's
  // scoresByKey and can never mix provenance with a live rebuild. Throws (fail
  // closed) on an empty team catalog or ambiguous duplicate provider ids: an
  // archive must not be written with a snapshot lacking catalog authority.
  const gameStatSlate = buildGameStatSlateSnapshot({
    year,
    games,
    scheduleItems,
    teams,
    aliasMap,
    now,
  });

  return {
    leagueSlug,
    year,
    archivedAt: now.toISOString(),
    ownerRosterSnapshot: ownersCsvText,
    standingsHistory,
    finalStandings,
    games,
    scoresByKey,
    gameStatSlate,
  };
}
