import { NextResponse } from 'next/server';

import type { CfbdSeasonType } from '@/lib/cfbd';
import { getCachedGameStats, listCachedGameStatsWeeks } from '@/lib/gameStats/cache';
import type { GameStats } from '@/lib/gameStats/types';
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

type RosterEntryOut = {
  rosterEntry: string;
  canonicalTeamId: string;
  canonicalTeamName: string;
};

type GameLogEntry = {
  week: number | string;
  ownerTeamId: string;
  ownerTeamName: string;
  opponentTeamId: string;
  opponentTeamName: string;
  result: 'W' | 'L' | 'T';
  ownerScore: number;
  opponentScore: number;
  canonicalGameId: string;
  isNeutralSite: boolean;
  opponentClassification: 'FBS' | 'FCS' | 'unknown';
};

type DuplicateAssignment = {
  canonicalTeamId: string;
  canonicalTeamName: string;
  assignedOwners: string[];
};

type ScoreIntegrityDiff = {
  canonicalGameId: string;
  week: number | string;
  homeTeamName: string;
  awayTeamName: string;
  archiveScore: { home: number | null; away: number | null };
  cacheScore: { home: number; away: number };
};

type UnattachedArchiveGame = {
  canonicalGameId: string;
  week: number | string;
  homeTeamName: string;
  awayTeamName: string;
  reason: string;
};

type IntegrityResponse = {
  summary: {
    leagueSlug: string;
    year: number;
    ownerCount: number;
    rosteredTeamCount: number;
    totalArchiveGames: number;
    duplicateAssignmentCount: number;
    scoreDiffCount: number;
    unattachedGameCount: number;
  };
  roster: Record<string, RosterEntryOut[]>;
  gameLogsByOwner: Record<string, GameLogEntry[]>;
  duplicateRosterAssignments: DuplicateAssignment[];
  scoreIntegrityDiffs: ScoreIntegrityDiff[];
  unattachedArchiveGames: UnattachedArchiveGame[];
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

function classifyOpponent(resolver: TeamIdentityResolver, raw: string): 'FBS' | 'FCS' | 'unknown' {
  const identity = resolver.getTeamIdentity(raw);
  if (!identity) return 'unknown';
  if (identity.subdivision === 'FBS') return 'FBS';
  if (identity.subdivision === 'FCS') return 'FCS';
  return 'unknown';
}

function weekLabel(game: AppGame): number | string {
  if (game.stage === 'regular') return game.week;
  if (game.bowlName) return game.bowlName;
  if (game.playoffRound) return game.playoffRound;
  if (game.stage === 'conference_championship') return 'championship';
  if (game.stage === 'bowl') return 'bowl';
  if (game.stage === 'playoff') return 'playoff';
  return game.week;
}

function compareWeeks(a: number | string, b: number | string): number {
  const aNum = typeof a === 'number';
  const bNum = typeof b === 'number';
  if (aNum && bNum) return (a as number) - (b as number);
  if (aNum) return -1;
  if (bNum) return 1;
  return String(a).localeCompare(String(b));
}

async function loadGameStatsByProviderId(year: number): Promise<Map<number, GameStats>> {
  const weekKeys = await listCachedGameStatsWeeks(year);
  const map = new Map<number, GameStats>();
  for (const key of weekKeys) {
    const parts = key.split(':');
    if (parts.length !== 3) continue;
    const week = Number(parts[1]);
    if (!Number.isFinite(week)) continue;
    const seasonType = parts[2] as CfbdSeasonType;
    const stats = await getCachedGameStats(year, week, seasonType);
    if (!stats) continue;
    for (const g of stats.games) {
      map.set(g.providerGameId, g);
    }
  }
  return map;
}

function buildRoster(
  archive: SeasonArchive,
  resolver: TeamIdentityResolver
): {
  roster: Record<string, RosterEntryOut[]>;
  ownersByTeamId: Map<string, string[]>;
  teamNameById: Map<string, string>;
  rosteredTeamCount: number;
} {
  const rows = parseOwnersCsv(archive.ownerRosterSnapshot);
  const roster: Record<string, RosterEntryOut[]> = {};
  const ownersByTeamId = new Map<string, string[]>();
  const teamNameById = new Map<string, string>();

  for (const row of rows) {
    const owner = row.owner;
    const rosterEntry = row.team;
    const { id, name } = resolveIdentity(resolver, rosterEntry);

    const list = roster[owner] ?? [];
    list.push({ rosterEntry, canonicalTeamId: id, canonicalTeamName: name });
    roster[owner] = list;

    const ownerList = ownersByTeamId.get(id);
    if (ownerList) {
      if (!ownerList.includes(owner)) ownerList.push(owner);
    } else {
      ownersByTeamId.set(id, [owner]);
    }

    if (!teamNameById.has(id)) teamNameById.set(id, name);
  }

  return {
    roster,
    ownersByTeamId,
    teamNameById,
    rosteredTeamCount: ownersByTeamId.size,
  };
}

function deriveDuplicateAssignments(
  ownersByTeamId: Map<string, string[]>,
  teamNameById: Map<string, string>
): DuplicateAssignment[] {
  const duplicates: DuplicateAssignment[] = [];
  for (const [teamId, owners] of ownersByTeamId) {
    if (owners.length > 1) {
      duplicates.push({
        canonicalTeamId: teamId,
        canonicalTeamName: teamNameById.get(teamId) ?? teamId,
        assignedOwners: [...owners].sort((a, b) => a.localeCompare(b)),
      });
    }
  }
  duplicates.sort((a, b) => a.canonicalTeamName.localeCompare(b.canonicalTeamName));
  return duplicates;
}

function buildGameLogs(
  archive: SeasonArchive,
  resolver: TeamIdentityResolver,
  ownersByTeamId: Map<string, string[]>,
  ownerFilter: Set<string> | null
): {
  gameLogsByOwner: Record<string, GameLogEntry[]>;
  unattached: UnattachedArchiveGame[];
} {
  const logsByOwner: Record<string, GameLogEntry[]> = {};
  const unattached: UnattachedArchiveGame[] = [];

  for (const game of archive.games) {
    const scorePack: ScorePack | undefined = archive.scoresByKey[game.key];
    const home = resolveIdentity(resolver, game.canHome || game.csvHome);
    const away = resolveIdentity(resolver, game.canAway || game.csvAway);

    const homeOwners = ownersByTeamId.get(home.id) ?? [];
    const awayOwners = ownersByTeamId.get(away.id) ?? [];

    if (homeOwners.length === 0 && awayOwners.length === 0) {
      unattached.push({
        canonicalGameId: game.key,
        week: weekLabel(game),
        homeTeamName: home.name,
        awayTeamName: away.name,
        reason: 'home team in no roster, away team in no roster',
      });
      continue;
    }

    const homeScore = scorePack?.home.score ?? null;
    const awayScore = scorePack?.away.score ?? null;
    if (homeScore === null || awayScore === null) continue;

    const week = weekLabel(game);

    const emit = (targetOwner: string, side: 'home' | 'away') => {
      if (ownerFilter && !ownerFilter.has(targetOwner)) return;
      const ownerSide = side === 'home' ? home : away;
      const oppSide = side === 'home' ? away : home;
      const ownerScore = side === 'home' ? homeScore : awayScore;
      const opponentScore = side === 'home' ? awayScore : homeScore;
      let result: 'W' | 'L' | 'T';
      if (ownerScore > opponentScore) result = 'W';
      else if (ownerScore < opponentScore) result = 'L';
      else result = 'T';

      const entry: GameLogEntry = {
        week,
        ownerTeamId: ownerSide.id,
        ownerTeamName: ownerSide.name,
        opponentTeamId: oppSide.id,
        opponentTeamName: oppSide.name,
        result,
        ownerScore,
        opponentScore,
        canonicalGameId: game.key,
        isNeutralSite: Boolean(game.neutral),
        opponentClassification: classifyOpponent(
          resolver,
          side === 'home' ? game.canAway || game.csvAway : game.canHome || game.csvHome
        ),
      };
      const list = logsByOwner[targetOwner] ?? [];
      list.push(entry);
      logsByOwner[targetOwner] = list;
    };

    for (const owner of homeOwners) emit(owner, 'home');
    for (const owner of awayOwners) emit(owner, 'away');
  }

  for (const owner of Object.keys(logsByOwner)) {
    logsByOwner[owner]!.sort(
      (a, b) => compareWeeks(a.week, b.week) || a.ownerTeamName.localeCompare(b.ownerTeamName)
    );
  }

  return { gameLogsByOwner: logsByOwner, unattached };
}

function buildScoreDiffs(
  archive: SeasonArchive,
  resolver: TeamIdentityResolver,
  cacheByProviderId: Map<number, GameStats>
): ScoreIntegrityDiff[] {
  const diffs: ScoreIntegrityDiff[] = [];
  for (const game of archive.games) {
    const providerId = game.providerGameId ? Number(game.providerGameId) : null;
    if (providerId === null || !Number.isFinite(providerId)) continue;
    const cached = cacheByProviderId.get(providerId);
    if (!cached) continue;

    const archiveScore = archive.scoresByKey[game.key];
    const home = resolveIdentity(resolver, game.canHome || game.csvHome);
    const away = resolveIdentity(resolver, game.canAway || game.csvAway);

    const archiveHome = archiveScore?.home.score ?? null;
    const archiveAway = archiveScore?.away.score ?? null;

    const cachedHome = resolveIdentity(resolver, cached.home.school);
    const sideAlignsDirectly = cachedHome.id === home.id;
    const cacheHomePoints = sideAlignsDirectly ? cached.home.points : cached.away.points;
    const cacheAwayPoints = sideAlignsDirectly ? cached.away.points : cached.home.points;

    const homeDiffers = archiveHome !== cacheHomePoints;
    const awayDiffers = archiveAway !== cacheAwayPoints;
    if (!homeDiffers && !awayDiffers) continue;

    diffs.push({
      canonicalGameId: game.key,
      week: weekLabel(game),
      homeTeamName: home.name,
      awayTeamName: away.name,
      archiveScore: { home: archiveHome, away: archiveAway },
      cacheScore: { home: cacheHomePoints, away: cacheAwayPoints },
    });
  }
  return diffs;
}

export async function GET(req: Request): Promise<Response> {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const leagueSlug = url.searchParams.get('leagueSlug');
  const yearParam = url.searchParams.get('year');
  const ownersParam = url.searchParams.get('owners');

  if (!leagueSlug || !yearParam) {
    return NextResponse.json(
      { error: 'leagueSlug and year are required' },
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
  const year = Number.parseInt(yearParam, 10);
  if (!Number.isFinite(year) || year < 2000) {
    return NextResponse.json(
      { error: 'leagueSlug and year are required' },
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  try {
    const archive = await getSeasonArchive(leagueSlug, year);
    if (!archive) {
      return NextResponse.json(
        { error: `No archive found for leagueSlug=${leagueSlug} year=${year}` },
        { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const ownerFilter = ownersParam
      ? new Set(
          ownersParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        )
      : null;

    const [teams, aliasMap, cacheByProviderId] = await Promise.all([
      getTeamDatabaseItems(),
      loadAliasMap(leagueSlug, year),
      loadGameStatsByProviderId(year),
    ]);

    const observedNames = Array.from(
      new Set(
        archive.games.flatMap((g) => [g.csvAway, g.csvHome, g.canAway, g.canHome]).filter(Boolean)
      )
    );
    const resolver = createTeamIdentityResolver({ teams, aliasMap, observedNames });

    const { roster, ownersByTeamId, teamNameById, rosteredTeamCount } = buildRoster(
      archive,
      resolver
    );

    const duplicateRosterAssignments = deriveDuplicateAssignments(ownersByTeamId, teamNameById);

    const { gameLogsByOwner, unattached: unattachedArchiveGames } = buildGameLogs(
      archive,
      resolver,
      ownersByTeamId,
      ownerFilter
    );

    const scoreIntegrityDiffs = buildScoreDiffs(archive, resolver, cacheByProviderId);

    const rosterFiltered = ownerFilter
      ? Object.fromEntries(Object.entries(roster).filter(([owner]) => ownerFilter.has(owner)))
      : roster;

    const response: IntegrityResponse = {
      summary: {
        leagueSlug,
        year,
        ownerCount: Object.keys(roster).length,
        rosteredTeamCount,
        totalArchiveGames: archive.games.length,
        duplicateAssignmentCount: duplicateRosterAssignments.length,
        scoreDiffCount: scoreIntegrityDiffs.length,
        unattachedGameCount: unattachedArchiveGames.length,
      },
      roster: rosterFiltered,
      gameLogsByOwner,
      duplicateRosterAssignments,
      scoreIntegrityDiffs,
      unattachedArchiveGames,
    };

    return NextResponse.json(response, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
