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

  // INSIGHTS-023a — this route passes NO `leagueMembers`, so its seed population
  // is `archives ∪ current-CSV owners`, while /admin/[slug]/insights seeds
  // `archives ∪ leagueMembers`.
  //
  // An earlier version of this comment said the two "both agree" now that the
  // accumulator spans every archived owner. They agree for anyone who has PLAYED,
  // which is most of the time and is why the gap is easy to miss — but a
  // brand-new owner named in the confirmed list, absent from every archive and
  // not yet in the CSV, gets a career-stats entry on the page and none here.
  // That is the pre-draft preseason window this slice exists for, so the
  // divergence is likeliest exactly when someone is debugging it. Left as a
  // stated limitation rather than closed: this route is a debug surface, and
  // giving it membership means giving it a confirmed-roster read of its own.
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
    // INSIGHTS-023a — renamed, not just re-scoped. `buildOwnerCareerStats` now
    // accumulates over every owner in the archives (membership decides who may
    // be NAMED, not who the comparison spans), so "active" was simply wrong.
    //
    // Precisely: this counts `archived ∪ current-CSV`, per the seed above — NOT
    // the league's all-time owner count, which an earlier version of this
    // comment claimed. It excludes a confirmed owner who has never played.
    historicalOwnerCount: owners.length,
    diagnosticsByYear: result.diagnosticsByYear,
    owners,
  });
}
