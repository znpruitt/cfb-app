import { selectAnalyticsRows, type AnalyticsTeamStats } from './contract.ts';
import type { OwnerSeasonStats } from '../insights/types.ts';
import type { TeamIdentityResolver } from '../teamIdentity.ts';
import type { GameStats, OwnerWeekStats } from './types.ts';

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

/**
 * Owner aggregation consumes ONLY the canonical analytics projection
 * (PLATFORM-086H1): rows are first reduced to at most one analytics-eligible
 * projection per provider game id (`selectAnalyticsRows` — v2 over legacy,
 * identical duplicates counted once, conflicts excluded), and every aggregated
 * value comes from strictly re-parsed raw evidence plus valid points. Stored
 * normalized fallback fields are never read here, so an ineligible row
 * (statless, malformed, sparse, mismatched, unsupported) can no longer leak
 * fabricated zeroes — or fabricated values — into owner analytics. Exact
 * 2021–2025 parity of this path against previously served values was proven by
 * the durable inventory audit.
 */
function accumulateOwners(
  games: GameStats[],
  ownerRoster: Map<string, string>,
  resolver: TeamIdentityResolver
): Map<string, OwnerAccumulator> {
  const accumulators = new Map<string, OwnerAccumulator>();
  const { selected } = selectAnalyticsRows(games);

  for (const game of selected) {
    const sides: Array<{ team: AnalyticsTeamStats; opponent: AnalyticsTeamStats }> = [
      { team: game.home, opponent: game.away },
      { team: game.away, opponent: game.home },
    ];

    for (const { team, opponent } of sides) {
      const resolved = resolver.resolveName(team.school);
      const canonicalName = resolved.canonicalName ?? team.school;
      const identityKey = resolved.identityKey;

      // Look up owner by identity key first, then canonical name
      let owner: string | undefined;
      if (identityKey) {
        owner = ownerRoster.get(identityKey);
      }
      if (!owner) {
        owner = ownerRoster.get(canonicalName);
      }
      if (!owner) continue;

      const acc = accumulators.get(owner) ?? emptyAccumulator(owner);
      addTeamStats(acc, team, opponent);
      accumulators.set(owner, acc);
    }
  }

  return accumulators;
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
 * @param games - Normalized game stats for a week (or set of weeks)
 * @param ownerRoster - Map of canonical team name → owner name
 * @param resolver - Team identity resolver for matching CFBD school names to roster names
 */
export function aggregateOwnerGameStats(
  games: GameStats[],
  ownerRoster: Map<string, string>,
  resolver: TeamIdentityResolver
): OwnerWeekStats[] {
  return Array.from(accumulateOwners(games, ownerRoster, resolver).values()).map(toOwnerWeekStats);
}

/**
 * Aggregate game stats across all weeks into per-owner season totals. The
 * weekly arrays are flattened into ONE aggregation scope before selection, so
 * a duplicate provider game id appearing in two partitions still counts once.
 *
 * @param weeklyGames - Array of per-week game stat arrays
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
  const accumulators = accumulateOwners(weeklyGames.flat(), ownerRoster, resolver);

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
