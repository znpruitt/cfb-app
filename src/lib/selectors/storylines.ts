import type { StandingsHistory } from '../standingsHistory';
import type { GamesBackSeries, WinBarsRow, WinPctSeries } from './trends';

export type LeagueStoryline = {
  id: string;
  text: string;
  priority: number;
  type: 'leader-gap' | 'tight-race' | 'movement' | 'win-pct' | 'generic';
};

const MAX_STORYLINES = 3;
const MEANINGFUL_LEADER_GAP = 2;
const TIGHT_RACE_GAP = 1;
const MEANINGFUL_MOVEMENT_DELTA_WINS = 2;
const MIN_WIN_PCT_STANDOUT_GAP = 0.01;

function formatGames(value: number): string {
  return `${value} game${value === 1 ? '' : 's'}`;
}

function latestValue(series: { points: { value: number }[] }): number | null {
  const point = series.points[series.points.length - 1];
  return point ? point.value : null;
}

function selectLeaderGapStoryline(gamesBackTrend: GamesBackSeries[]): LeagueStoryline | null {
  if (gamesBackTrend.length < 2) return null;

  const latestByOwner = gamesBackTrend
    .map((entry) => ({ ownerName: entry.ownerName, latest: latestValue(entry) }))
    .filter((entry): entry is { ownerName: string; latest: number } => entry.latest != null)
    .sort((left, right) => {
      if (left.latest !== right.latest) return left.latest - right.latest;
      return left.ownerName.localeCompare(right.ownerName);
    });

  const leader = latestByOwner[0];
  const runnerUp = latestByOwner[1];
  if (!leader || !runnerUp) return null;
  if (leader.latest !== 0) return null;
  if (runnerUp.latest < MEANINGFUL_LEADER_GAP) return null;

  return {
    id: `leader-gap-${leader.ownerName.toLowerCase().replace(/\s+/gu, '-')}`,
    type: 'leader-gap',
    priority: 100,
    text: `${leader.ownerName} leads by ${formatGames(runnerUp.latest)}, opening the biggest gap at the top.`,
  };
}

function selectTightRaceStoryline(gamesBackTrend: GamesBackSeries[]): LeagueStoryline | null {
  if (gamesBackTrend.length < 2) return null;

  const latestByOwner = gamesBackTrend
    .map((entry) => ({ ownerName: entry.ownerName, latest: latestValue(entry) }))
    .filter((entry): entry is { ownerName: string; latest: number } => entry.latest != null)
    .sort((left, right) => {
      if (left.latest !== right.latest) return left.latest - right.latest;
      return left.ownerName.localeCompare(right.ownerName);
    });

  const topTwo = latestByOwner.slice(0, 2);
  if (topTwo.length < 2) return null;

  const topThree = latestByOwner.slice(0, 3);
  const thirdGap = topThree[2]?.latest;
  if (thirdGap != null && thirdGap <= TIGHT_RACE_GAP) {
    return {
      id: 'tight-race-top-3',
      type: 'tight-race',
      priority: 90,
      text: `The top 3 are separated by ${formatGames(thirdGap)}, keeping the title race tight.`,
    };
  }

  const runnerUpGap = topTwo[1].latest;
  if (runnerUpGap <= TIGHT_RACE_GAP) {
    return {
      id: 'tight-race-top-2',
      type: 'tight-race',
      priority: 90,
      text: `${topTwo[0].ownerName} and ${topTwo[1].ownerName} are within ${formatGames(
        runnerUpGap
      )} in a tight race for first.`,
    };
  }

  return null;
}

function selectMovementStoryline(
  standingsHistory: StandingsHistory | null
): LeagueStoryline | null {
  if (!standingsHistory || standingsHistory.weeks.length < 2) return null;

  const orderedWeeks = [...standingsHistory.weeks].sort((left, right) => left - right);
  const latestWeek = orderedWeeks[orderedWeeks.length - 1];
  const previousWeek = orderedWeeks[orderedWeeks.length - 2];
  if (latestWeek == null || previousWeek == null) return null;

  const latest = standingsHistory.byWeek[latestWeek]?.standings ?? [];
  const previous = standingsHistory.byWeek[previousWeek]?.standings ?? [];
  if (latest.length === 0 || previous.length === 0) return null;

  const previousByOwner = new Map(previous.map((row) => [row.owner, row] as const));
  const movements = latest
    .map((row) => {
      const previousRow = previousByOwner.get(row.owner);
      if (!previousRow) return null;
      return {
        owner: row.owner,
        deltaWins: row.wins - previousRow.wins,
      };
    })
    .filter((movement): movement is { owner: string; deltaWins: number } => movement !== null)
    .filter((movement) => Math.abs(movement.deltaWins) >= MEANINGFUL_MOVEMENT_DELTA_WINS)
    .sort((left, right) => {
      const leftMagnitude = Math.abs(left.deltaWins);
      const rightMagnitude = Math.abs(right.deltaWins);
      if (rightMagnitude !== leftMagnitude) return rightMagnitude - leftMagnitude;
      if (left.deltaWins !== right.deltaWins) return right.deltaWins - left.deltaWins;
      return left.owner.localeCompare(right.owner);
    });

  const movement = movements[0];
  if (!movement) return null;

  if (movement.deltaWins > 0) {
    return {
      id: `movement-gain-${movement.owner.toLowerCase().replace(/\s+/gu, '-')}`,
      type: 'movement',
      priority: 80,
      text: `${movement.owner} made the biggest move this week, gaining ${movement.deltaWins} win${movement.deltaWins === 1 ? '' : 's'}.`,
    };
  }

  return {
    id: `movement-drop-${movement.owner.toLowerCase().replace(/\s+/gu, '-')}`,
    type: 'movement',
    priority: 80,
    text: `${movement.owner} saw the biggest slide this week, dropping ${Math.abs(movement.deltaWins)} win${Math.abs(movement.deltaWins) === 1 ? '' : 's'}.`,
  };
}

function selectWinPctStoryline(params: {
  winPctTrend: WinPctSeries[];
  winBars: WinBarsRow[];
}): LeagueStoryline | null {
  const { winPctTrend, winBars } = params;
  if (winPctTrend.length === 0 || winBars.length < 2) return null;

  const latestWinPctByOwner = new Map<string, number>();
  for (const series of winPctTrend) {
    const latest = latestValue(series);
    if (latest == null) continue;
    latestWinPctByOwner.set(series.ownerName, latest);
  }

  if (latestWinPctByOwner.size < 2) return null;

  const bestWinPctOwner = Array.from(latestWinPctByOwner.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .map(([owner, winPct]) => ({ owner, winPct }))[0];

  const leader = winBars[0];
  if (!bestWinPctOwner || !leader) return null;
  if (bestWinPctOwner.owner === leader.ownerName) return null;
  if (bestWinPctOwner.winPct - leader.winPct < MIN_WIN_PCT_STANDOUT_GAP) return null;

  return {
    id: `win-pct-standout-${bestWinPctOwner.owner.toLowerCase().replace(/\s+/gu, '-')}`,
    type: 'win-pct',
    priority: 70,
    text: `${bestWinPctOwner.owner} owns the league's best win percentage but still trails ${leader.ownerName} in total wins.`,
  };
}

export function selectLeagueStorylines(args: {
  standingsHistory: StandingsHistory | null;
  gamesBackTrend: GamesBackSeries[];
  winPctTrend: WinPctSeries[];
  winBars: WinBarsRow[];
}): LeagueStoryline[] {
  const { standingsHistory, gamesBackTrend, winPctTrend, winBars } = args;

  const leaderGap = selectLeaderGapStoryline(gamesBackTrend);
  const tightRace = leaderGap ? null : selectTightRaceStoryline(gamesBackTrend);
  const movement = selectMovementStoryline(standingsHistory);
  const winPct = selectWinPctStoryline({ winPctTrend, winBars });

  return [leaderGap, tightRace, movement, winPct]
    .filter(
      (storyline): storyline is LeagueStoryline => storyline !== null && storyline.text.length > 0
    )
    .sort((left, right) => right.priority - left.priority)
    .slice(0, MAX_STORYLINES);
}
