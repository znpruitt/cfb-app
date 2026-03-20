import { gameStateFromScore } from './gameUi.ts';
import { deriveOwnerWeekSlates, deriveWeekMatchupSections } from './matchups.ts';
import type { ScorePack } from './scores.ts';
import type { AppGame } from './schedule.ts';
import type { OwnerStandingsRow } from './standings.ts';

export type OwnerRosterRowStatus = 'Final' | 'Live' | 'Upcoming';

export type OwnerRosterRow = {
  teamName: string;
  record: string;
  nextOpponent: string | null;
  nextKickoff: string | null;
  currentStatus: OwnerRosterRowStatus;
  currentScore: string | null;
  liveGameKey: string | null;
};

export type OwnerHeaderSummary = {
  owner: string;
  rank: number;
  record: string;
  winPct: number;
  pointDifferential: number;
};

export type OwnerViewSnapshot = {
  selectedOwner: string | null;
  ownerOptions: string[];
  header: OwnerHeaderSummary | null;
  rosterRows: OwnerRosterRow[];
  liveRows: OwnerRosterRow[];
  weekRows: OwnerRosterRow[];
  weekSummary: {
    totalGames: number;
    liveGames: number;
    finalGames: number;
    scheduledGames: number;
    opponentOwners: string[];
    performanceSummary: string;
    performanceDetail: string;
  } | null;
};

function compareGamesByKickoff(a: AppGame, b: AppGame): number {
  const aTime = a.date ? new Date(a.date).getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.date ? new Date(b.date).getTime() : Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  return a.key.localeCompare(b.key);
}

function buildScoreLine(score?: ScorePack): string | null {
  if (!score) return null;
  if (score.away.score == null || score.home.score == null) return null;
  return `${score.away.team} ${score.away.score} - ${score.home.score} ${score.home.team}`;
}

function getTeamGames(teamName: string, games: AppGame[]): AppGame[] {
  return games.filter((game) => game.csvAway === teamName || game.csvHome === teamName);
}

function isFinalGame(game: AppGame, score?: ScorePack): boolean {
  return game.status === 'final' || gameStateFromScore(score) === 'final';
}

function isLiveGame(game: AppGame, score?: ScorePack): boolean {
  return game.status === 'in_progress' || gameStateFromScore(score) === 'inprogress';
}

export function deriveOwnerRoster(
  owner: string,
  games: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>
): OwnerRosterRow[] {
  const ownedTeams = Array.from(rosterByTeam.entries())
    .filter(([, teamOwner]) => teamOwner === owner)
    .map(([teamName]) => teamName)
    .sort((a, b) => a.localeCompare(b));

  return ownedTeams.map((teamName) => {
    const teamGames = getTeamGames(teamName, games).sort(compareGamesByKickoff);

    let wins = 0;
    let losses = 0;

    for (const game of teamGames) {
      const score = scoresByKey[game.key];
      if (!isFinalGame(game, score)) continue;

      const teamScore = game.csvAway === teamName ? score?.away.score : score?.home.score;
      const opponentScore = game.csvAway === teamName ? score?.home.score : score?.away.score;
      if (teamScore == null || opponentScore == null || teamScore === opponentScore) continue;

      if (teamScore > opponentScore) wins += 1;
      else losses += 1;
    }

    const liveGame = teamGames.find((game) => isLiveGame(game, scoresByKey[game.key]));
    if (liveGame) {
      const liveScore = scoresByKey[liveGame.key];
      const opponentTeamName = liveGame.csvAway === teamName ? liveGame.csvHome : liveGame.csvAway;
      return {
        teamName,
        record: `${wins}–${losses}`,
        nextOpponent: opponentTeamName,
        nextKickoff: liveGame.date,
        currentStatus: 'Live',
        currentScore: buildScoreLine(liveScore),
        liveGameKey: liveGame.key,
      };
    }

    const nextGame = teamGames.find((game) => !isFinalGame(game, scoresByKey[game.key]));
    if (nextGame) {
      const opponentTeamName = nextGame.csvAway === teamName ? nextGame.csvHome : nextGame.csvAway;
      return {
        teamName,
        record: `${wins}–${losses}`,
        nextOpponent: opponentTeamName,
        nextKickoff: nextGame.date,
        currentStatus: 'Upcoming',
        currentScore: null,
        liveGameKey: null,
      };
    }

    return {
      teamName,
      record: `${wins}–${losses}`,
      nextOpponent: null,
      nextKickoff: null,
      currentStatus: 'Final',
      currentScore: null,
      liveGameKey: null,
    };
  });
}

function filterRosterRowsToWeek(
  owner: string,
  allRosterRows: OwnerRosterRow[],
  weekGames: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>
): OwnerRosterRow[] {
  const weekTeamSet = new Set(
    weekGames.flatMap((game) => {
      const teams: string[] = [];
      if (rosterByTeam.get(game.csvAway) === owner) teams.push(game.csvAway);
      if (rosterByTeam.get(game.csvHome) === owner) teams.push(game.csvHome);
      return teams;
    })
  );

  return allRosterRows
    .filter((row) => weekTeamSet.has(row.teamName))
    .map((row) => {
      const teamWeekGames = getTeamGames(row.teamName, weekGames).sort(compareGamesByKickoff);
      const liveGame = teamWeekGames.find((game) => isLiveGame(game, scoresByKey[game.key]));
      if (liveGame) {
        const opponentTeamName =
          liveGame.csvAway === row.teamName ? liveGame.csvHome : liveGame.csvAway;
        return {
          ...row,
          nextOpponent: opponentTeamName,
          nextKickoff: liveGame.date,
          currentStatus: 'Live',
          currentScore: buildScoreLine(scoresByKey[liveGame.key]),
          liveGameKey: liveGame.key,
        };
      }

      const nextGame = teamWeekGames.find((game) => !isFinalGame(game, scoresByKey[game.key]));
      if (nextGame) {
        const opponentTeamName =
          nextGame.csvAway === row.teamName ? nextGame.csvHome : nextGame.csvAway;
        return {
          ...row,
          nextOpponent: opponentTeamName,
          nextKickoff: nextGame.date,
          currentStatus: 'Upcoming',
          currentScore: null,
          liveGameKey: null,
        };
      }

      const latestWeekGame = teamWeekGames.at(-1);
      if (latestWeekGame) {
        const opponentTeamName =
          latestWeekGame.csvAway === row.teamName ? latestWeekGame.csvHome : latestWeekGame.csvAway;
        return {
          ...row,
          nextOpponent: opponentTeamName,
          nextKickoff: latestWeekGame.date,
          currentStatus: 'Final',
          currentScore: buildScoreLine(scoresByKey[latestWeekGame.key]),
          liveGameKey: null,
        };
      }

      return row;
    });
}

export function deriveOwnerViewSnapshot(params: {
  selectedOwner: string | null;
  standingsRows: OwnerStandingsRow[];
  allGames: AppGame[];
  weekGames: AppGame[];
  rosterByTeam: Map<string, string>;
  scoresByKey: Record<string, ScorePack>;
}): OwnerViewSnapshot {
  const { selectedOwner, standingsRows, allGames, weekGames, rosterByTeam, scoresByKey } = params;

  const ownerOptions = standingsRows.map((row) => row.owner);
  const fallbackOwner = ownerOptions[0] ?? null;
  const resolvedOwner =
    selectedOwner && ownerOptions.includes(selectedOwner) ? selectedOwner : fallbackOwner;

  if (!resolvedOwner) {
    return {
      selectedOwner: null,
      ownerOptions: [],
      header: null,
      rosterRows: [],
      liveRows: [],
      weekRows: [],
      weekSummary: null,
    };
  }

  const headerRow =
    standingsRows.find((row) => row.owner === resolvedOwner) ?? standingsRows[0] ?? null;
  const rosterRows = deriveOwnerRoster(resolvedOwner, allGames, rosterByTeam, scoresByKey);
  const liveRows = rosterRows.filter((row) => row.currentStatus === 'Live');
  const weekRows = filterRosterRowsToWeek(
    resolvedOwner,
    rosterRows,
    weekGames,
    rosterByTeam,
    scoresByKey
  );

  const weekSections = deriveWeekMatchupSections(weekGames, rosterByTeam);
  const ownerWeekSlate = deriveOwnerWeekSlates(weekGames, rosterByTeam, scoresByKey).find(
    (slate) => slate.owner === resolvedOwner
  );
  const ownerRelevantBuckets = [
    ...weekSections.ownerMatchups,
    ...weekSections.secondaryGames,
  ].filter((bucket) => bucket.awayOwner === resolvedOwner || bucket.homeOwner === resolvedOwner);

  return {
    selectedOwner: resolvedOwner,
    ownerOptions,
    header: headerRow
      ? {
          owner: headerRow.owner,
          rank: standingsRows.findIndex((row) => row.owner === headerRow.owner) + 1,
          record: `${headerRow.wins}–${headerRow.losses}`,
          winPct: headerRow.winPct,
          pointDifferential: headerRow.pointDifferential,
        }
      : null,
    rosterRows,
    liveRows,
    weekRows,
    weekSummary: ownerWeekSlate
      ? {
          totalGames: ownerWeekSlate.totalGames,
          liveGames: ownerWeekSlate.liveGames,
          finalGames: ownerWeekSlate.finalGames,
          scheduledGames: ownerWeekSlate.scheduledGames,
          opponentOwners: ownerWeekSlate.opponentOwners,
          performanceSummary: ownerWeekSlate.performance.summary,
          performanceDetail: ownerWeekSlate.performance.detail,
        }
      : ownerRelevantBuckets.length > 0
        ? {
            totalGames: ownerRelevantBuckets.length,
            liveGames: 0,
            finalGames: 0,
            scheduledGames: ownerRelevantBuckets.length,
            opponentOwners: Array.from(
              new Set(
                ownerRelevantBuckets
                  .map((bucket) =>
                    bucket.awayOwner === resolvedOwner ? bucket.homeOwner : bucket.awayOwner
                  )
                  .filter((value): value is string => Boolean(value))
              )
            ),
            performanceSummary: 'Scheduled',
            performanceDetail: `${ownerRelevantBuckets.length} game${ownerRelevantBuckets.length === 1 ? '' : 's'}`,
          }
        : null,
  };
}
