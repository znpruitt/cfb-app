import type { OwnerSeasonStats } from '../insights/types.ts';
import type { TeamIdentityResolver } from '../teamIdentity.ts';
import {
  selectAnalyticsRows,
  type AnalyticsGameStats,
  type AnalyticsTeamStats,
} from './contract.ts';
import type { GameStats, OwnerWeekStats } from './types.ts';

/**
 * PLATFORM-086H3 — owner analytics through the canonical projection (ACTIVE).
 *
 * Owner aggregation consumes the PLATFORM-086H1 analytics projection
 * (`selectAnalyticsRows` → `toAnalyticsGameStats`) EXCLUSIVELY: eligible rows
 * (strict v2-complete or bounded legacy-compatible) project to strictly
 * re-parsed raw evidence plus valid points, duplicates resolve
 * deterministically, and ineligible/malformed/sparse rows are excluded rather
 * than aggregated as fabricated zeroes. No consumer-side category
 * interpretation and no consumer-specific identity matching exist here: team
 * resolution stays on the injected `teamIdentity` resolver, and persistence
 * metadata never appears in the projection.
 *
 * For the production legacy inventory this is output-equivalent to the
 * pre-activation normalized-field aggregation (validated across 2021–2025:
 * exact owner-analytics parity for every stored row).
 */

type OwnerAccumulator = {
  owner: string;
  gamesPlayed: number;
  points: number;
  pointsAgainst: number;
  totalYards: number;
  rushingYards: number;
  passingYards: number;
  turnovers: number;
  turnoversForced: number;
  thirdDownConversions: number;
  thirdDownAttempts: number;
  possessionSeconds: number;
};

function emptyAccumulator(owner: string): OwnerAccumulator {
  return {
    owner,
    gamesPlayed: 0,
    points: 0,
    pointsAgainst: 0,
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

function addTeamStats(
  acc: OwnerAccumulator,
  team: AnalyticsTeamStats,
  opponent: AnalyticsTeamStats
): void {
  acc.gamesPlayed += 1;
  acc.points += team.points;
  acc.pointsAgainst += opponent.points;
  acc.totalYards += team.totalYards;
  acc.rushingYards += team.rushingYards;
  acc.passingYards += team.passingYards;
  acc.turnovers += team.turnovers;
  acc.turnoversForced += opponent.turnovers;
  acc.thirdDownConversions += team.thirdDownConversions;
  acc.thirdDownAttempts += team.thirdDownAttempts;
  acc.possessionSeconds += team.possessionSeconds;
}

function resolveOwner(
  school: string,
  ownerRoster: Map<string, string>,
  resolver: TeamIdentityResolver
): string | undefined {
  const resolved = resolver.resolveName(school);
  const canonicalName = resolved.canonicalName ?? school;
  const identityKey = resolved.identityKey;
  // Look up owner by identity key first, then canonical name
  if (identityKey) {
    const owner = ownerRoster.get(identityKey);
    if (owner) return owner;
  }
  return ownerRoster.get(canonicalName);
}

function accumulateProjectedGames(
  accumulators: Map<string, OwnerAccumulator>,
  projected: readonly AnalyticsGameStats[],
  ownerRoster: Map<string, string>,
  resolver: TeamIdentityResolver
): void {
  for (const game of projected) {
    const sides: Array<{ team: AnalyticsTeamStats; opponent: AnalyticsTeamStats }> = [
      { team: game.home, opponent: game.away },
      { team: game.away, opponent: game.home },
    ];

    for (const { team, opponent } of sides) {
      const owner = resolveOwner(team.school, ownerRoster, resolver);
      if (!owner) continue;

      const acc = accumulators.get(owner) ?? emptyAccumulator(owner);
      addTeamStats(acc, team, opponent);
      accumulators.set(owner, acc);
    }
  }
}

function toOwnerWeekStats(acc: OwnerAccumulator): OwnerWeekStats {
  return {
    owner: acc.owner,
    gamesPlayed: acc.gamesPlayed,
    points: acc.points,
    totalYards: acc.totalYards,
    rushingYards: acc.rushingYards,
    passingYards: acc.passingYards,
    turnovers: acc.turnovers,
    turnoverMargin: acc.turnoversForced - acc.turnovers,
    thirdDownPct: acc.thirdDownAttempts > 0 ? acc.thirdDownConversions / acc.thirdDownAttempts : 0,
    possessionSeconds: acc.possessionSeconds,
  };
}

/**
 * Aggregate game stats across all teams owned by each owner.
 *
 * @param games - Stored game-stats rows for a week (or set of weeks)
 * @param ownerRoster - Map of canonical team name → owner name
 * @param resolver - Team identity resolver for matching CFBD school names to roster names
 */
export function aggregateOwnerGameStats(
  games: GameStats[],
  ownerRoster: Map<string, string>,
  resolver: TeamIdentityResolver
): OwnerWeekStats[] {
  const accumulators = new Map<string, OwnerAccumulator>();
  accumulateProjectedGames(
    accumulators,
    selectAnalyticsRows(games).selected,
    ownerRoster,
    resolver
  );
  return Array.from(accumulators.values()).map(toOwnerWeekStats);
}

/**
 * Aggregate game stats across all weeks into per-owner season totals.
 *
 * @param weeklyGames - Array of per-week stored game-stats row arrays
 * @param ownerRoster - Map of canonical team name → owner name
 * @param resolver - Team identity resolver for matching CFBD school names to roster names
 * @param season - Season year to stamp on each result
 */
export function aggregateOwnerSeasonStats(
  weeklyGames: GameStats[][],
  ownerRoster: Map<string, string>,
  resolver: TeamIdentityResolver,
  season: number
): OwnerSeasonStats[] {
  const accumulators = new Map<string, OwnerAccumulator>();
  // One selection over the whole aggregation scope so duplicate provider game
  // ids across weeks resolve through the same deterministic policy.
  const { selected } = selectAnalyticsRows(weeklyGames.flat());
  accumulateProjectedGames(accumulators, selected, ownerRoster, resolver);

  return Array.from(accumulators.values()).map((acc) => ({
    owner: acc.owner,
    season,
    gamesPlayed: acc.gamesPlayed,
    points: acc.points,
    pointsAgainst: acc.pointsAgainst,
    totalYards: acc.totalYards,
    rushingYards: acc.rushingYards,
    passingYards: acc.passingYards,
    turnovers: acc.turnovers,
    turnoversForced: acc.turnoversForced,
    turnoverMargin: acc.turnoversForced - acc.turnovers,
    thirdDownConversions: acc.thirdDownConversions,
    thirdDownAttempts: acc.thirdDownAttempts,
    thirdDownPct: acc.thirdDownAttempts > 0 ? acc.thirdDownConversions / acc.thirdDownAttempts : 0,
    possessionSeconds: acc.possessionSeconds,
  }));
}
