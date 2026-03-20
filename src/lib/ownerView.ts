import { formatGameMatchupLabel, gameStateFromScore } from './gameUi.ts';
import { deriveOwnerWeekSlates, deriveWeekMatchupSections } from './matchups.ts';
import type { ScorePack } from './scores.ts';
import type { AppGame } from './schedule.ts';
import type { OwnerStandingsRow } from './standings.ts';

export type OwnerRosterGameRow = {
  gameKey: string;
  ownerTeamSide: 'away' | 'home';
  teamName: string;
  opponentTeamName: string;
  opponentOwner?: string;
  isOwnerVsOwner: boolean;
  status: 'final' | 'inprogress' | 'scheduled' | 'unknown';
  statusLabel: string;
  scoreLine: string;
  kickoff: string | null;
  matchupLabel: string;
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
  rosterRows: OwnerRosterGameRow[];
  liveRows: OwnerRosterGameRow[];
  weekRows: OwnerRosterGameRow[];
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

function buildScoreLine(game: AppGame, score?: ScorePack): string {
  if (!score) return 'Awaiting score';
  return `${score.away.team} ${score.away.score ?? '—'} - ${score.home.score ?? '—'} ${score.home.team}`;
}

function toOwnerRosterGameRows(params: {
  owner: string;
  game: AppGame;
  rosterByTeam: Map<string, string>;
  scoresByKey: Record<string, ScorePack>;
}): OwnerRosterGameRow[] {
  const { owner, game, rosterByTeam, scoresByKey } = params;
  const awayOwner = rosterByTeam.get(game.csvAway);
  const homeOwner = rosterByTeam.get(game.csvHome);

  const rows: OwnerRosterGameRow[] = [];
  const score = scoresByKey[game.key];
  const status = gameStateFromScore(score);

  if (awayOwner === owner) {
    rows.push({
      gameKey: game.key,
      ownerTeamSide: 'away',
      teamName: game.csvAway,
      opponentTeamName: game.csvHome,
      opponentOwner: homeOwner,
      isOwnerVsOwner: Boolean(homeOwner),
      status,
      statusLabel: score?.status ?? 'Scheduled',
      scoreLine: buildScoreLine(game, score),
      kickoff: game.date,
      matchupLabel: formatGameMatchupLabel(game),
    });
  }

  if (homeOwner === owner) {
    rows.push({
      gameKey: game.key,
      ownerTeamSide: 'home',
      teamName: game.csvHome,
      opponentTeamName: game.csvAway,
      opponentOwner: awayOwner,
      isOwnerVsOwner: Boolean(awayOwner),
      status,
      statusLabel: score?.status ?? 'Scheduled',
      scoreLine: buildScoreLine(game, score),
      kickoff: game.date,
      matchupLabel: formatGameMatchupLabel(game),
    });
  }

  return rows;
}

function compareOwnerRosterRows(a: OwnerRosterGameRow, b: OwnerRosterGameRow): number {
  const rank = (row: OwnerRosterGameRow): number => {
    if (row.status === 'inprogress') return 0;
    if (row.status === 'scheduled') return 1;
    if (row.status === 'final') return 2;
    return 3;
  };

  const diff = rank(a) - rank(b);
  if (diff !== 0) return diff;

  const aTime = a.kickoff ? new Date(a.kickoff).getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.kickoff ? new Date(b.kickoff).getTime() : Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;

  const keyDiff = a.gameKey.localeCompare(b.gameKey);
  if (keyDiff !== 0) return keyDiff;

  if (a.ownerTeamSide !== b.ownerTeamSide) {
    return a.ownerTeamSide === 'away' ? -1 : 1;
  }

  return a.teamName.localeCompare(b.teamName);
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
  const rosterRows = allGames
    .flatMap((game) =>
      toOwnerRosterGameRows({ owner: resolvedOwner, game, rosterByTeam, scoresByKey })
    )
    .sort(compareOwnerRosterRows);

  const liveRows = rosterRows.filter((row) => row.status === 'inprogress');
  const weekRows = weekGames
    .flatMap((game) =>
      toOwnerRosterGameRows({ owner: resolvedOwner, game, rosterByTeam, scoresByKey })
    )
    .sort(compareOwnerRosterRows);

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
