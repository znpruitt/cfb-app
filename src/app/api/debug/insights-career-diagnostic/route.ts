import { NextResponse } from 'next/server';

import { buildOwnerCareerStats } from '@/lib/insights/context';
import { getLeague } from '@/lib/leagueRegistry';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import { getSeasonArchive, listSeasonArchives, type SeasonArchive } from '@/lib/seasonArchive';
import { requireAdminAuth } from '@/lib/server/adminAuth';
import { getAppState } from '@/lib/server/appStateStore';

export const dynamic = 'force-dynamic';

const DEFAULT_LEAGUE_SLUG = 'tsc';

export async function GET(req: Request): Promise<Response> {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const leagueSlug = url.searchParams.get('league') ?? DEFAULT_LEAGUE_SLUG;

  const league = await getLeague(leagueSlug);
  if (!league) {
    return NextResponse.json({ error: 'league-not-found', leagueSlug }, { status: 404 });
  }

  const archiveYears = await listSeasonArchives(leagueSlug);
  const archives: SeasonArchive[] = [];
  for (const year of archiveYears) {
    const archive = await getSeasonArchive(leagueSlug, year);
    if (archive) archives.push(archive);
  }

  const historicalRosters: Record<number, Map<string, string>> = {};
  for (const archive of archives) {
    const rows = parseOwnersCsv(archive.ownerRosterSnapshot);
    historicalRosters[archive.year] = new Map(rows.map((r) => [r.team, r.owner]));
  }

  // Load current roster for active-owner scoping
  const currentOwnersRecord = await getAppState<string>(
    `owners:${leagueSlug}:${league.year}`,
    'csv'
  );
  const currentOwnersCsv =
    typeof currentOwnersRecord?.value === 'string' ? currentOwnersRecord.value : '';
  const currentRoster = new Map<string, string>(
    parseOwnersCsv(currentOwnersCsv).map((r) => [r.team, r.owner])
  );

  const result = await buildOwnerCareerStats({
    leagueSlug,
    currentYear: league.year,
    archives,
    historicalRosters,
    currentRoster,
  });

  const owners = result.ownerCareerStats.map((s) => ({
    owner: s.owner,
    seasons: s.seasons,
    totalWins: s.totalWins,
    totalLosses: s.totalLosses,
    totalPoints: s.totalPoints,
    totalPointsAgainst: s.totalPointsAgainst,
    totalYards: s.totalYards,
    totalTurnovers: s.totalTurnovers,
    totalTurnoversForced: s.totalTurnoversForced,
    totalTurnoverMargin: s.totalTurnoverMargin,
    titles: s.titles,
    titleYears: s.titleYears,
    finishHistory: s.finishHistory,
    firstSeason: s.firstSeason,
    isRookie: s.isRookie,
  }));

  return NextResponse.json({
    leagueSlug,
    currentYear: league.year,
    archiveYears,
    activeOwnerCount: owners.length,
    diagnosticsByYear: result.diagnosticsByYear,
    owners,
  });
}
