import { classifyScorePackStatus } from './gameStatus.ts';
import type { ScorePack } from './scores.ts';
import type { AppGame } from './schedule.ts';

export type OwnedFinalParticipation = {
  owner: string;
  game: AppGame;
  teamSide: 'away' | 'home';
  teamName: string;
  opponentTeamName: string;
  opponentOwner?: string;
  pointsFor: number;
  pointsAgainst: number;
  result: 'win' | 'loss';
};

export type OwnerStandingsRow = {
  owner: string;
  wins: number;
  losses: number;
  winPct: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
  gamesBack: number;
  finalGames: number;
};

export type StandingsSnapshot = {
  /** Primary rows, sorted canonically; NoClaim is excluded. */
  rows: OwnerStandingsRow[];
  /** NoClaim's own standings row, when the underlying roster contained one. */
  noClaimRow: OwnerStandingsRow | null;
  participations: OwnedFinalParticipation[];
  leaderWins: number;
};

export type StandingsCoverageState = 'complete' | 'partial' | 'error';

export type StandingsCoverage = {
  state: StandingsCoverageState;
  message: string | null;
};

export const NO_CLAIM_OWNER = 'NoClaim';

/**
 * Splits a sorted list of owner standings into real-owner rows and the NoClaim
 * aggregate (when present). Mirrors the canonical selector's filter so every
 * consumer of standings data — live derivation and archive reads — produces
 * the same {rows, noClaimRow} shape and never accidentally renders NoClaim.
 */
export function splitOutNoClaim(rows: OwnerStandingsRow[]): {
  rows: OwnerStandingsRow[];
  noClaimRow: OwnerStandingsRow | null;
} {
  let noClaimRow: OwnerStandingsRow | null = null;
  const filtered: OwnerStandingsRow[] = [];
  for (const row of rows) {
    if (row.owner === NO_CLAIM_OWNER) {
      noClaimRow = row;
      continue;
    }
    filtered.push(row);
  }
  return { rows: filtered, noClaimRow };
}

function hasOwnedTeam(game: AppGame, rosterByTeam: Map<string, string>): boolean {
  return rosterByTeam.has(game.csvAway) || rosterByTeam.has(game.csvHome);
}

export function deriveStandingsCoverage(
  games: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>,
  options?: {
    isLoadingScores?: boolean;
    hasScoreLoadError?: boolean;
  }
): StandingsCoverage {
  const relevantFinalGames = games.filter(
    (game) => game.status === 'final' && hasOwnedTeam(game, rosterByTeam)
  );

  const hasMissingFinalScores = relevantFinalGames.some((game) => {
    const score = scoresByKey[game.key];
    if (classifyScorePackStatus(score) !== 'final') return true;

    return score?.away.score == null || score.home.score == null;
  });

  if (!hasMissingFinalScores) {
    return { state: 'complete', message: null };
  }

  if (options?.hasScoreLoadError) {
    return {
      state: 'error',
      message: 'Standings may be incomplete — some completed game scores could not be loaded.',
    };
  }

  if (options?.isLoadingScores) {
    return {
      state: 'partial',
      message: 'Standings may be incomplete — some completed game scores are still loading.',
    };
  }

  return {
    state: 'partial',
    message: 'Standings may be incomplete — some completed game scores are not available yet.',
  };
}

function toOwnedFinalResult(
  side: 'away' | 'home',
  awayScore: number,
  homeScore: number
): 'win' | 'loss' {
  if (side === 'away') {
    return awayScore > homeScore ? 'win' : 'loss';
  }

  return homeScore > awayScore ? 'win' : 'loss';
}

export function deriveFinalOwnedParticipations(
  games: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>
): OwnedFinalParticipation[] {
  const participations: OwnedFinalParticipation[] = [];

  for (const game of games) {
    const score = scoresByKey[game.key];
    if (classifyScorePackStatus(score) !== 'final') continue;

    const awayScore = score.away.score;
    const homeScore = score.home.score;
    if (awayScore == null || homeScore == null) continue;

    const awayOwner = rosterByTeam.get(game.csvAway);
    const homeOwner = rosterByTeam.get(game.csvHome);

    if (awayScore === homeScore) {
      console.warn(
        `[standings] Ignoring unexpected final tie for ${game.key} (${game.csvAway} ${awayScore}-${homeScore} ${game.csvHome}).`
      );
      continue;
    }

    const awayResult = awayOwner ? toOwnedFinalResult('away', awayScore, homeScore) : null;
    const homeResult = homeOwner ? toOwnedFinalResult('home', awayScore, homeScore) : null;

    if (awayOwner && awayResult) {
      participations.push({
        owner: awayOwner,
        game,
        teamSide: 'away',
        teamName: game.csvAway,
        opponentTeamName: game.csvHome,
        opponentOwner: homeOwner,
        pointsFor: awayScore,
        pointsAgainst: homeScore,
        result: awayResult,
      });
    }

    if (homeOwner && homeResult) {
      participations.push({
        owner: homeOwner,
        game,
        teamSide: 'home',
        teamName: game.csvHome,
        opponentTeamName: game.csvAway,
        opponentOwner: awayOwner,
        pointsFor: homeScore,
        pointsAgainst: awayScore,
        result: homeResult,
      });
    }
  }

  return participations;
}

export function deriveStandings(
  games: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>
): StandingsSnapshot {
  const owners = Array.from(new Set(rosterByTeam.values())).sort((a, b) => a.localeCompare(b));
  const participations = deriveFinalOwnedParticipations(games, rosterByTeam, scoresByKey);
  const totals = new Map<
    string,
    Omit<OwnerStandingsRow, 'gamesBack' | 'pointDifferential' | 'winPct'>
  >();

  for (const owner of owners) {
    totals.set(owner, {
      owner,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      finalGames: 0,
    });
  }

  for (const participation of participations) {
    const current = totals.get(participation.owner) ?? {
      owner: participation.owner,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      finalGames: 0,
    };

    if (participation.result === 'win') current.wins += 1;
    if (participation.result === 'loss') current.losses += 1;
    current.pointsFor += participation.pointsFor;
    current.pointsAgainst += participation.pointsAgainst;
    current.finalGames += 1;
    totals.set(participation.owner, current);
  }

  const leaderWins = Array.from(totals.values()).reduce((best, row) => Math.max(best, row.wins), 0);

  // League standings precedence (SOURCE OF TRUTH):
  // 1. Total Wins (primary ranking metric)
  // 2. Win Percentage (tiebreaker — accounts for unequal games played)
  // 3. Point Differential (secondary tiebreaker)
  //
  // This matches official league rules (confirmed via season-final standings email).
  // Do NOT reorder without updating league rules documentation.
  const allRows = Array.from(totals.values())
    .map((row) => {
      const decisions = row.wins + row.losses;
      const pointDifferential = row.pointsFor - row.pointsAgainst;
      return {
        ...row,
        winPct: decisions > 0 ? row.wins / decisions : 0,
        pointDifferential,
        gamesBack: leaderWins - row.wins,
      };
    })
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.winPct !== a.winPct) return b.winPct - a.winPct;
      if (b.pointDifferential !== a.pointDifferential) {
        return b.pointDifferential - a.pointDifferential;
      }
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
      return a.owner.localeCompare(b.owner);
    });

  const { rows, noClaimRow } = splitOutNoClaim(allRows);
  return { rows, noClaimRow, participations, leaderWins };
}
