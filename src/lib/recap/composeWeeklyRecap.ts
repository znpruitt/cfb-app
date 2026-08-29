import type { LeagueStatus } from '../league.ts';
import {
  isWeeklyRecapActiveSeason,
  selectWeeklyRecapLeaders,
  selectWeeklyRecapFacts,
  type WeeklyOwnedGameResult,
  type WeeklyOwnerResult,
} from '../selectors/weeklyRecapFacts.ts';
import { buildWeekLabelMap, formatWeekLabel } from '../weekLabel.ts';
import type { WeeklyRecapContextResult } from './loadRecapContext.ts';

export type WeeklyRecapOwnerLine = {
  owner: string;
  recordLabel: string;
  pointsLabel: string;
};

export type WeeklyRecapLeaderLine = {
  id: 'best-record' | 'high-score' | 'closest-game' | 'biggest-riser';
  label: string;
  value: string;
  context: string;
  tone?: 'positive';
};

export type WeeklyRecapMovementLine = {
  owner: string;
  direction: 'up' | 'down';
  deltaLabel: string;
  shiftLabel: string;
};

export type WeeklyRecapViewModel =
  | { status: 'inactive' }
  | { status: 'absent' }
  | { status: 'unavailable' }
  | {
      status: 'available';
      week: number;
      weekLabel: string;
      latestGameDate: string;
      headline: string | null;
      isIncomplete: boolean;
      ownerLines: WeeklyRecapOwnerLine[];
      leaderLines: WeeklyRecapLeaderLine[];
      tileLeaderLines: WeeklyRecapLeaderLine[];
      movementLines: WeeklyRecapMovementLine[];
    };

export type AvailableWeeklyRecapViewModel = Extract<WeeklyRecapViewModel, { status: 'available' }>;

export type WeeklyRecapSeasonScope = {
  leagueStatus: LeagueStatus | undefined;
  seasonYear: number;
};

const SMALL_COUNT_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
  'Twenty',
] as const;

function weeklyHeadline(facts: ReturnType<typeof selectWeeklyRecapFacts>): string | null {
  if (!facts) return null;
  if (facts.unresolvedCount > 0 || facts.abandonedCount > 0 || facts.missingResultCount > 0) {
    return null;
  }

  const leaders = selectWeeklyRecapLeaders(facts.ownerResults);
  const first = leaders[0];
  if (!first) return null;
  const record = `${first.wins}–${first.losses}`;
  if (leaders.length === 1) return `${first.owner} takes the week at ${record}`;
  if (leaders.length === 2) {
    return `${leaders[0].owner} and ${leaders[1].owner} share the week at ${record}`;
  }

  const count = SMALL_COUNT_WORDS[leaders.length] ?? String(leaders.length);
  return `${count} owners share the week at ${record}`;
}

function ownerNames(results: WeeklyOwnerResult[]): string {
  return formatOwnerNames(results.map((result) => result.owner));
}

function formatOwnerNames(owners: string[]): string {
  if (owners.length === 1) return owners[0]!;
  if (owners.length === 2) return `${owners[0]} & ${owners[1]}`;
  return `${owners.length} owners tied`;
}

function formatAllOwnerNames(owners: string[]): string {
  if (owners.length <= 2) return formatOwnerNames(owners);
  return `${owners.slice(0, -1).join(', ')} & ${owners.at(-1)}`;
}

function gameResultContext(result: WeeklyOwnedGameResult): string {
  const sameOwner = result.winnerOwner != null && result.winnerOwner === result.loserOwner;
  const winner = sameOwner ? result.winnerTeam : (result.winnerOwner ?? result.winnerTeam);
  const loser = sameOwner ? result.loserTeam : (result.loserOwner ?? result.loserTeam);
  const margin = `${result.margin}-point margin`;
  return `${winner} over ${loser} · ${margin}`;
}

function composeLeaderLines(
  facts: NonNullable<ReturnType<typeof selectWeeklyRecapFacts>>
): WeeklyRecapLeaderLine[] {
  const lines: WeeklyRecapLeaderLine[] = [];
  const recordLeaders = selectWeeklyRecapLeaders(facts.ownerResults);
  const firstRecordLeader = recordLeaders[0];
  if (firstRecordLeader) {
    lines.push({
      id: 'best-record',
      label: 'Best record',
      value: `${firstRecordLeader.wins}–${firstRecordLeader.losses}`,
      context:
        recordLeaders.length === 1
          ? `${firstRecordLeader.owner} · ${firstRecordLeader.pointsFor} PF`
          : ownerNames(recordLeaders),
    });
  }

  const highScores = facts.accolades.highScores;
  const highScore = highScores[0];
  if (highScore) {
    lines.push({
      id: 'high-score',
      label: 'High score',
      value: String(highScore.pointsFor),
      context:
        highScores.length === 1
          ? `${highScore.owner} · ${highScore.wins}–${highScore.losses} on the week`
          : ownerNames(highScores),
    });
  }

  const closestGame = facts.accolades.closestGames[0];
  if (closestGame) {
    lines.push({
      id: 'closest-game',
      label: 'Closest game',
      value: `${closestGame.winnerScore}–${closestGame.loserScore}`,
      context: gameResultContext(closestGame),
    });
  }

  return lines;
}

export function composeWeeklyRecap(
  contextResult: WeeklyRecapContextResult,
  now: Date,
  scope: WeeklyRecapSeasonScope
): WeeklyRecapViewModel {
  if (!isWeeklyRecapActiveSeason(scope)) return { status: 'inactive' };
  if (contextResult.status === 'unavailable') return { status: 'unavailable' };
  if (contextResult.status === 'absent') return { status: 'absent' };
  if (contextResult.context.seasonYear !== scope.seasonYear) return { status: 'unavailable' };

  const facts = selectWeeklyRecapFacts({
    games: contextResult.context.games,
    rosterByTeam: contextResult.context.rosterByTeam,
    scoresByKey: contextResult.context.scoresByKey,
    oddsByGameKey: contextResult.context.oddsByGameKey,
    archives: contextResult.context.archives,
    historicalRosters: contextResult.context.historicalRosters,
    seasonYear: contextResult.context.seasonYear,
    now,
  });
  if (!facts) return { status: 'absent' };

  const weekLabelMap = buildWeekLabelMap(contextResult.context.games);
  const compactWeekLabel = formatWeekLabel(facts.targetWeek.week, weekLabelMap);
  const weekLabel = weekLabelMap.has(facts.targetWeek.week)
    ? compactWeekLabel
    : `Week ${facts.targetWeek.week}`;
  const ownerLines = facts.ownerResults.map((result) => ({
    owner: result.owner,
    recordLabel: `${result.wins}–${result.losses}`,
    pointsLabel: `${result.pointsFor} PF · ${result.pointsAgainst} PA`,
  }));
  const isIncomplete =
    facts.unresolvedCount > 0 || facts.abandonedCount > 0 || facts.missingResultCount > 0;
  const leaderLines = composeLeaderLines(facts);
  const movementLines: WeeklyRecapMovementLine[] = facts.rankMovement.map((movement) => ({
    owner: movement.owner,
    direction: movement.rankDelta > 0 ? 'up' : 'down',
    deltaLabel: `${movement.rankDelta > 0 ? '▲' : '▼'} ${Math.abs(movement.rankDelta)}`,
    shiftLabel: `#${movement.previousRank} → #${movement.currentRank}`,
  }));
  const biggestRiser = facts.rankMovement.find((movement) => movement.rankDelta > 0);
  const biggestRisers = biggestRiser
    ? facts.rankMovement.filter((movement) => movement.rankDelta === biggestRiser.rankDelta)
    : [];
  const hasTiedBiggestRisers = biggestRisers.length > 1;
  const tileLeaderLines = biggestRiser
    ? [
        ...leaderLines,
        {
          id: 'biggest-riser' as const,
          label: hasTiedBiggestRisers ? 'Biggest risers' : biggestRiser.owner,
          value: `▲ ${biggestRiser.rankDelta}`,
          context: hasTiedBiggestRisers
            ? formatAllOwnerNames(biggestRisers.map((movement) => movement.owner))
            : `Biggest riser · #${biggestRiser.previousRank} → #${biggestRiser.currentRank}`,
          tone: 'positive' as const,
        },
      ]
    : leaderLines;

  return {
    status: 'available',
    week: facts.targetWeek.week,
    weekLabel,
    latestGameDate: facts.targetWeek.latestGameDate,
    headline: weeklyHeadline(facts) ?? (ownerLines.length > 0 ? `${weekLabel} results` : null),
    isIncomplete,
    ownerLines,
    leaderLines,
    tileLeaderLines,
    movementLines,
  };
}
