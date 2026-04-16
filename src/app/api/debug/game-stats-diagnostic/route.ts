import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState } from '@/lib/server/appStateStore';
import { getTeamDatabaseItems } from '@/lib/server/teamDatabaseStore';
import { createTeamIdentityResolver, type TeamIdentityResolver } from '@/lib/teamIdentity';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import { listCachedGameStatsWeeks, getCachedGameStats } from '@/lib/gameStats/cache';
import { getSeasonArchive } from '@/lib/seasonArchive';
import type { AliasMap } from '@/lib/teamNames';
import type { CfbdSeasonType } from '@/lib/cfbd';
import type { TeamGameStats } from '@/lib/gameStats/types';

export const dynamic = 'force-dynamic';

const LEAGUE_SLUG = 'tsc';
const YEARS = [2021, 2022, 2023, 2024, 2025];

type OwnerAccumulator = {
  gamesPlayed: number;
  points: number;
  totalYards: number;
  rushingYards: number;
  passingYards: number;
  turnovers: number;
  turnoversForced: number;
  thirdDownConversions: number;
  thirdDownAttempts: number;
  possessionSeconds: number;
};

function emptyAccumulator(): OwnerAccumulator {
  return {
    gamesPlayed: 0,
    points: 0,
    totalYards: 0,
    rushingYards: 0,
    passingYards: 0,
    turnovers: 0,
    turnoversForced: 0,
    thirdDownConversions: 0,
    thirdDownAttempts: 0,
    possessionSeconds: 0,
  };
}

function resolveOwner(
  team: TeamGameStats,
  rosterByTeam: Map<string, string>,
  resolver: TeamIdentityResolver
): string | null {
  const resolved = resolver.resolveName(team.school);
  const identityKey = resolved.identityKey;
  const canonicalName = resolved.canonicalName ?? team.school;
  if (identityKey) {
    const owner = rosterByTeam.get(identityKey);
    if (owner) return owner;
  }
  return rosterByTeam.get(canonicalName) ?? null;
}

function addTeamToAccumulator(
  acc: OwnerAccumulator,
  team: TeamGameStats,
  opponent: TeamGameStats
): void {
  acc.gamesPlayed += 1;
  acc.points += team.points;
  acc.totalYards += team.totalYards;
  acc.rushingYards += team.rushingYards;
  acc.passingYards += team.passingYards;
  acc.turnovers += team.turnovers;
  acc.turnoversForced += opponent.turnovers;
  acc.thirdDownConversions += team.thirdDownConversions;
  acc.thirdDownAttempts += team.thirdDownAttempts;
  acc.possessionSeconds += team.possessionSeconds;
}

type OwnerSeasonSummary = {
  owner: string;
  wins: number | null;
  losses: number | null;
  gamesPlayed: number;
  points: number;
  totalYards: number;
  rushingYards: number;
  passingYards: number;
  turnovers: number;
  turnoversForced: number;
  turnoverMargin: number;
  thirdDownConversions: number;
  thirdDownAttempts: number;
  thirdDownPct: number;
  possessionSeconds: number;
};

type SeasonDiagnostic = {
  weeksLoaded: number;
  totalGames: number;
  owners: OwnerSeasonSummary[];
};

type DiagnosticResponse = {
  seasons: Record<string, SeasonDiagnostic | { error: string }>;
};

export async function GET(req: Request): Promise<NextResponse<DiagnosticResponse | { error: string }>> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const teams = await getTeamDatabaseItems();
  const seasons: Record<string, SeasonDiagnostic | { error: string }> = {};

  for (const year of YEARS) {
    try {
      // Load alias map — try league-scoped, year-only, and global; merge all
      let aliasMap: AliasMap = {};
      for (const scope of [
        `aliases:${LEAGUE_SLUG}:${year}`,
        `aliases:${year}`,
        'aliases:global',
      ]) {
        const record = await getAppState<AliasMap>(scope, 'map');
        if (record?.value && typeof record.value === 'object' && !Array.isArray(record.value)) {
          aliasMap = { ...record.value, ...aliasMap };
        }
      }

      const resolver = createTeamIdentityResolver({ teams, aliasMap });

      // Load owners CSV
      const ownersRecord = await getAppState<string>(`owners:${LEAGUE_SLUG}:${year}`, 'csv');
      const ownersCsvText = typeof ownersRecord?.value === 'string' ? ownersRecord.value : '';
      if (!ownersCsvText) {
        seasons[String(year)] = { error: 'no owners CSV found' };
        continue;
      }
      const ownerRows = parseOwnersCsv(ownersCsvText);
      const rosterByTeam = new Map<string, string>(ownerRows.map((r) => [r.team, r.owner]));

      // Load all cached game stats weeks for this year
      const weekKeys = await listCachedGameStatsWeeks(year);
      if (weekKeys.length === 0) {
        seasons[String(year)] = { error: 'no cached game stats weeks' };
        continue;
      }

      // Accumulate per-owner season totals directly from game data
      const accumulators = new Map<string, OwnerAccumulator>();
      let totalGames = 0;
      let weeksLoaded = 0;

      for (const key of weekKeys) {
        const parts = key.split(':');
        if (parts.length !== 3) continue;
        const week = parseInt(parts[1], 10);
        const seasonType = parts[2] as CfbdSeasonType;

        const stats = await getCachedGameStats(year, week, seasonType);
        if (!stats) continue;
        weeksLoaded++;
        totalGames += stats.games.length;

        for (const game of stats.games) {
          const sides: Array<{ team: TeamGameStats; opponent: TeamGameStats }> = [
            { team: game.home, opponent: game.away },
            { team: game.away, opponent: game.home },
          ];

          for (const { team, opponent } of sides) {
            const owner = resolveOwner(team, rosterByTeam, resolver);
            if (!owner) continue;

            const acc = accumulators.get(owner) ?? emptyAccumulator();
            addTeamToAccumulator(acc, team, opponent);
            accumulators.set(owner, acc);
          }
        }
      }

      // Load final standings from season archive
      const archive = await getSeasonArchive(LEAGUE_SLUG, year);
      const standingsMap = new Map<string, { wins: number; losses: number }>();
      if (archive?.finalStandings) {
        for (const row of archive.finalStandings) {
          standingsMap.set(row.owner, { wins: row.wins, losses: row.losses });
        }
      }

      // Build output
      const owners: OwnerSeasonSummary[] = [];
      for (const [owner, acc] of accumulators) {
        const standing = standingsMap.get(owner);
        owners.push({
          owner,
          wins: standing?.wins ?? null,
          losses: standing?.losses ?? null,
          gamesPlayed: acc.gamesPlayed,
          points: acc.points,
          totalYards: acc.totalYards,
          rushingYards: acc.rushingYards,
          passingYards: acc.passingYards,
          turnovers: acc.turnovers,
          turnoversForced: acc.turnoversForced,
          turnoverMargin: acc.turnoversForced - acc.turnovers,
          thirdDownConversions: acc.thirdDownConversions,
          thirdDownAttempts: acc.thirdDownAttempts,
          thirdDownPct: acc.thirdDownAttempts > 0
            ? acc.thirdDownConversions / acc.thirdDownAttempts
            : 0,
          possessionSeconds: acc.possessionSeconds,
        });
      }

      owners.sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0));

      seasons[String(year)] = { weeksLoaded, totalGames, owners };
    } catch (err) {
      seasons[String(year)] = { error: err instanceof Error ? err.message : 'unknown error' };
    }
  }

  return NextResponse.json({ seasons });
}
