import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import type { AppGame } from '@/lib/schedule';
import type { ScorePack } from '@/lib/scores';
import { getSeasonArchive, type SeasonArchive } from '@/lib/seasonArchive';
import { requireAdminAuth } from '@/lib/server/adminAuth';
import { getAppState } from '@/lib/server/appStateStore';
import { getTeamDatabaseItems } from '@/lib/server/teamDatabaseStore';
import { createTeamIdentityResolver, type TeamIdentityResolver } from '@/lib/teamIdentity';
import type { AliasMap } from '@/lib/teamNames';

export const dynamic = 'force-dynamic';

type TeamRecord = {
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  games: number;
};

type OwnerTotal = {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  games: number;
};

async function loadAliasMap(leagueSlug: string, year: number): Promise<AliasMap> {
  let aliasMap: AliasMap = {};
  const scopes = [`aliases:${leagueSlug}:${year}`, `aliases:${year}`, 'aliases:global'];
  for (const scope of scopes) {
    const record = await getAppState<AliasMap>(scope, 'map');
    const value = record?.value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      aliasMap = { ...value, ...aliasMap };
    }
  }
  return aliasMap;
}

function resolveIdentity(
  resolver: TeamIdentityResolver,
  raw: string
): { id: string; name: string } {
  const resolution = resolver.resolveName(raw);
  const id = resolution.identityKey ?? `unresolved:${resolution.normalizedInput || raw}`;
  const name = resolution.canonicalName ?? raw;
  return { id, name };
}

function padRight(value: string | number, width: number): string {
  const str = String(value);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

function padLeft(value: string | number, width: number): string {
  const str = String(value);
  return str.length >= width ? str : ' '.repeat(width - str.length) + str;
}

function fmtDiff(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

type RosterLookup = {
  roster: Record<
    string,
    Array<{ rosterEntry: string; canonicalTeamId: string; canonicalTeamName: string }>
  >;
  ownersByTeamId: Map<string, string[]>;
  rosteredTeamCount: number;
};

function buildRosterLookup(archive: SeasonArchive, resolver: TeamIdentityResolver): RosterLookup {
  const rows = parseOwnersCsv(archive.ownerRosterSnapshot);
  const roster: RosterLookup['roster'] = {};
  const ownersByTeamId = new Map<string, string[]>();

  for (const row of rows) {
    const owner = row.owner;
    const { id, name } = resolveIdentity(resolver, row.team);

    const list = roster[owner] ?? [];
    list.push({ rosterEntry: row.team, canonicalTeamId: id, canonicalTeamName: name });
    roster[owner] = list;

    const ownerList = ownersByTeamId.get(id);
    if (ownerList) {
      if (!ownerList.includes(owner)) ownerList.push(owner);
    } else {
      ownersByTeamId.set(id, [owner]);
    }
  }

  return {
    roster,
    ownersByTeamId,
    rosteredTeamCount: ownersByTeamId.size,
  };
}

type GameOutcome = {
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  homeResult: 'W' | 'L' | 'T';
  awayResult: 'W' | 'L' | 'T';
};

function resolveGame(
  game: AppGame,
  resolver: TeamIdentityResolver,
  scorePack: ScorePack | undefined
): GameOutcome | null {
  const homeScore = scorePack?.home.score ?? null;
  const awayScore = scorePack?.away.score ?? null;
  if (homeScore === null || awayScore === null) return null;

  const home = resolveIdentity(resolver, game.canHome || game.csvHome);
  const away = resolveIdentity(resolver, game.canAway || game.csvAway);

  let homeResult: 'W' | 'L' | 'T';
  let awayResult: 'W' | 'L' | 'T';
  if (homeScore > awayScore) {
    homeResult = 'W';
    awayResult = 'L';
  } else if (homeScore < awayScore) {
    homeResult = 'L';
    awayResult = 'W';
  } else {
    homeResult = 'T';
    awayResult = 'T';
  }

  return {
    homeId: home.id,
    homeName: home.name,
    awayId: away.id,
    awayName: away.name,
    homeScore,
    awayScore,
    homeResult,
    awayResult,
  };
}

function accumulateTeamRecord(
  teamRecords: Map<string, TeamRecord>,
  id: string,
  name: string,
  result: 'W' | 'L' | 'T',
  pointsFor: number,
  pointsAgainst: number
): void {
  let rec = teamRecords.get(id);
  if (!rec) {
    rec = { name, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, games: 0 };
    teamRecords.set(id, rec);
  }
  rec.games += 1;
  if (result === 'W') rec.wins += 1;
  else if (result === 'L') rec.losses += 1;
  else rec.ties += 1;
  rec.pointsFor += pointsFor;
  rec.pointsAgainst += pointsAgainst;
}

function buildTeamRecords(
  archive: SeasonArchive,
  resolver: TeamIdentityResolver,
  ownersByTeamId: Map<string, string[]>
): { teamRecords: Map<string, TeamRecord>; intraRosterCounts: Map<string, number> } {
  const teamRecords = new Map<string, TeamRecord>();
  const intraRosterCounts = new Map<string, number>();

  for (const game of archive.games) {
    const outcome = resolveGame(game, resolver, archive.scoresByKey[game.key]);
    if (!outcome) continue;

    const homeOwners = ownersByTeamId.get(outcome.homeId) ?? [];
    const awayOwners = ownersByTeamId.get(outcome.awayId) ?? [];

    if (homeOwners.length > 0) {
      accumulateTeamRecord(
        teamRecords,
        outcome.homeId,
        outcome.homeName,
        outcome.homeResult,
        outcome.homeScore,
        outcome.awayScore
      );
    }
    if (awayOwners.length > 0) {
      accumulateTeamRecord(
        teamRecords,
        outcome.awayId,
        outcome.awayName,
        outcome.awayResult,
        outcome.awayScore,
        outcome.homeScore
      );
    }

    // Intra-roster: both sides owned by the same owner
    const homeOwnerSet = new Set(homeOwners);
    for (const awayOwner of awayOwners) {
      if (homeOwnerSet.has(awayOwner)) {
        intraRosterCounts.set(awayOwner, (intraRosterCounts.get(awayOwner) ?? 0) + 1);
      }
    }
  }

  return { teamRecords, intraRosterCounts };
}

function renderSection1Summary(
  leagueSlug: string,
  year: number,
  archive: SeasonArchive,
  rosterLookup: RosterLookup,
  teamRecords: Map<string, TeamRecord>
): string {
  const ownerCount = Object.keys(rosterLookup.roster).length;
  const summary = {
    leagueSlug,
    year,
    ownerCount,
    rosteredTeamCount: rosterLookup.rosteredTeamCount,
    totalArchiveGames: archive.games.length,
  };

  let leagueWins = 0;
  let leagueLosses = 0;
  let leagueTies = 0;
  for (const t of teamRecords.values()) {
    leagueWins += t.wins;
    leagueLosses += t.losses;
    leagueTies += t.ties;
  }

  const lines: string[] = [];
  lines.push('='.repeat(80));
  lines.push('SECTION 1: SUMMARY');
  lines.push('='.repeat(80));
  lines.push(JSON.stringify(summary, null, 2));
  lines.push('');
  lines.push('Computed league totals from per-team records:');
  lines.push(`  sum(wins)   = ${leagueWins}`);
  lines.push(`  sum(losses) = ${leagueLosses}`);
  lines.push(`  sum(ties)   = ${leagueTies}`);
  lines.push(
    `  wins == losses (expected for a closed game universe)? ${
      leagueWins === leagueLosses ? 'YES' : 'NO'
    }`
  );
  return lines.join('\n');
}

function renderSection2Teams(teamRecords: Map<string, TeamRecord>): string {
  const teams = [...teamRecords.entries()]
    .map(([id, rec]) => ({ id, ...rec }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const COL_TEAM = 22;
  const COL_WL = 8;
  const COL_PTS = 5;
  const COL_DIFF = 6;

  const lines: string[] = [];
  lines.push('='.repeat(80));
  lines.push(`SECTION 2: PER-TEAM RECORD TABLE (${teams.length} rostered teams)`);
  lines.push('='.repeat(80));
  lines.push(
    padRight('team', COL_TEAM) +
      padRight('W-L', COL_WL) +
      padLeft('PF', COL_PTS) +
      '  ' +
      padLeft('PA', COL_PTS) +
      '  ' +
      padLeft('diff', COL_DIFF) +
      '  games'
  );
  lines.push('-'.repeat(COL_TEAM + COL_WL + COL_PTS * 2 + COL_DIFF + 6 + 7));
  for (const t of teams) {
    const wl = `${t.wins}-${t.losses}${t.ties > 0 ? `-${t.ties}` : ''}`;
    const diff = t.pointsFor - t.pointsAgainst;
    lines.push(
      padRight(t.name, COL_TEAM) +
        padRight(wl, COL_WL) +
        padLeft(t.pointsFor, COL_PTS) +
        '  ' +
        padLeft(t.pointsAgainst, COL_PTS) +
        '  ' +
        padLeft(fmtDiff(diff), COL_DIFF) +
        '  ' +
        padLeft(t.games, 5)
    );
  }
  return lines.join('\n');
}

function renderSection3Owners(
  ownerTotals: Map<string, OwnerTotal>,
  ownerFilter: Set<string> | null
): string {
  const owners = [...ownerTotals.entries()]
    .filter(([name]) => !ownerFilter || ownerFilter.has(name))
    .map(([name, rec]) => ({ name, ...rec, diff: rec.pointsFor - rec.pointsAgainst }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));

  const COL_OWNER = 14;
  const COL_OWL = 10;
  const COL_OPTS = 6;
  const COL_ODIFF = 7;

  const lines: string[] = [];
  lines.push('='.repeat(80));
  lines.push('SECTION 3: OWNER ROLLUP (sum of team records from gameLogsByOwner)');
  lines.push('='.repeat(80));
  lines.push(
    padRight('owner', COL_OWNER) +
      padRight('W-L', COL_OWL) +
      padLeft('PF', COL_OPTS) +
      '  ' +
      padLeft('PA', COL_OPTS) +
      '  ' +
      padLeft('diff', COL_ODIFF) +
      '  games'
  );
  lines.push('-'.repeat(COL_OWNER + COL_OWL + COL_OPTS * 2 + COL_ODIFF + 6 + 7));
  for (const o of owners) {
    const wl = `${o.wins}-${o.losses}${o.ties > 0 ? `-${o.ties}` : ''}`;
    lines.push(
      padRight(o.name, COL_OWNER) +
        padRight(wl, COL_OWL) +
        padLeft(o.pointsFor, COL_OPTS) +
        '  ' +
        padLeft(o.pointsAgainst, COL_OPTS) +
        '  ' +
        padLeft(fmtDiff(o.diff), COL_ODIFF) +
        '  ' +
        padLeft(o.games, 5)
    );
  }
  return lines.join('\n');
}

function renderSection4IntraRoster(
  intraRosterCounts: Map<string, number>,
  roster: RosterLookup['roster'],
  ownerFilter: Set<string> | null
): string {
  const COL_OWNER = 14;
  const lines: string[] = [];
  lines.push('='.repeat(80));
  lines.push('SECTION 4: INTRA-ROSTER GAME COUNT');
  lines.push('='.repeat(80));
  lines.push(padRight('owner', COL_OWNER) + padLeft('intraRosterGames', 20));
  lines.push('-'.repeat(COL_OWNER + 20));
  const allOwners = Object.keys(roster).sort((a, b) => a.localeCompare(b));
  for (const owner of allOwners) {
    if (ownerFilter && !ownerFilter.has(owner)) continue;
    const count = intraRosterCounts.get(owner) ?? 0;
    lines.push(padRight(owner, COL_OWNER) + padLeft(count, 20));
  }
  return lines.join('\n');
}

function renderValidationWarnings(
  teamRecords: Map<string, TeamRecord>,
  ownerTotals: Map<string, OwnerTotal>,
  roster: RosterLookup['roster']
): string {
  const lines: string[] = [];
  lines.push('='.repeat(80));
  lines.push('VALIDATION WARNINGS');
  lines.push('='.repeat(80));

  let warnings = 0;
  const teams = [...teamRecords.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const t of teams) {
    if (t.games < 12 || t.games > 15) {
      lines.push(`WARN: team ${t.name} has ${t.games} games (expected 12-15)`);
      warnings += 1;
    }
    if (t.ties > 0) {
      lines.push(`WARN: team ${t.name} has ${t.ties} tie(s)`);
      warnings += 1;
    }
  }

  for (const [owner, total] of ownerTotals) {
    const rosterEntries = roster[owner] ?? [];
    let sumTeamGames = 0;
    for (const entry of rosterEntries) {
      const rec = teamRecords.get(entry.canonicalTeamId);
      if (rec) sumTeamGames += rec.games;
    }
    const ownerTotalGames = total.wins + total.losses + total.ties;
    if (ownerTotalGames !== sumTeamGames) {
      lines.push(
        `WARN: owner ${owner} total games (${ownerTotalGames}) != sum of rostered teams' games (${sumTeamGames})`
      );
      warnings += 1;
    }
  }

  if (warnings === 0) {
    lines.push('No warnings.');
  }
  return lines.join('\n');
}

function rollupOwnerTotals(
  teamRecords: Map<string, TeamRecord>,
  roster: RosterLookup['roster']
): Map<string, OwnerTotal> {
  const totals = new Map<string, OwnerTotal>();
  for (const [owner, entries] of Object.entries(roster)) {
    const agg: OwnerTotal = {
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      games: 0,
    };
    for (const entry of entries) {
      const rec = teamRecords.get(entry.canonicalTeamId);
      if (!rec) continue;
      agg.wins += rec.wins;
      agg.losses += rec.losses;
      agg.ties += rec.ties;
      agg.pointsFor += rec.pointsFor;
      agg.pointsAgainst += rec.pointsAgainst;
      agg.games += rec.games;
    }
    totals.set(owner, agg);
  }
  return totals;
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function GET(req: Request): Promise<Response> {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const leagueSlug = url.searchParams.get('leagueSlug');
  const yearParam = url.searchParams.get('year');
  const ownersParam = url.searchParams.get('owners');

  if (!leagueSlug || !yearParam) {
    return errorResponse(400, 'leagueSlug and year are required');
  }
  const year = Number.parseInt(yearParam, 10);
  if (!Number.isFinite(year) || year < 2000) {
    return errorResponse(400, 'leagueSlug and year are required');
  }

  try {
    const archive = await getSeasonArchive(leagueSlug, year);
    if (!archive) {
      return errorResponse(404, `No archive found for leagueSlug=${leagueSlug} year=${year}`);
    }

    const ownerFilter = ownersParam
      ? new Set(
          ownersParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        )
      : null;

    const [teams, aliasMap] = await Promise.all([
      getTeamDatabaseItems(),
      loadAliasMap(leagueSlug, year),
    ]);

    const observedNames = Array.from(
      new Set(
        archive.games.flatMap((g) => [g.csvAway, g.csvHome, g.canAway, g.canHome]).filter(Boolean)
      )
    );
    const resolver = createTeamIdentityResolver({ teams, aliasMap, observedNames });

    const rosterLookup = buildRosterLookup(archive, resolver);
    const { teamRecords, intraRosterCounts } = buildTeamRecords(
      archive,
      resolver,
      rosterLookup.ownersByTeamId
    );
    const ownerTotals = rollupOwnerTotals(teamRecords, rosterLookup.roster);

    const body = [
      renderSection1Summary(leagueSlug, year, archive, rosterLookup, teamRecords),
      '',
      renderSection2Teams(teamRecords),
      '',
      renderSection3Owners(ownerTotals, ownerFilter),
      '',
      renderSection4IntraRoster(intraRosterCounts, rosterLookup.roster, ownerFilter),
      '',
      renderValidationWarnings(teamRecords, ownerTotals, rosterLookup.roster),
      '',
    ].join('\n');

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return errorResponse(500, message);
  }
}
