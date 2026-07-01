import { getGameSideForTeam } from './gameOwnership.ts';
import { gameStateFromScore, usesNeutralSiteSemantics } from './gameUi.ts';
import { deriveOwnerWeekSlates, deriveWeekMatchupSections } from './matchups.ts';
import type { ScorePack } from './scores.ts';
import { getGameParticipantTeamId, type AppGame } from './schedule.ts';
import type { OwnerStandingsRow } from './standings.ts';

export type OwnerRosterRowStatus = 'Final' | 'Live' | 'Upcoming';

export type OwnerRosterRow = {
  teamId?: string;
  teamName: string;
  record: string;
  nextOpponent: string | null;
  nextOpponentTeamId?: string | null;
  nextGameLabel: string | null;
  ownerTeamSide: 'away' | 'home';
  isNeutralSite: boolean;
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

// Ownership side is resolved through canonical game identity candidates so a
// stored assigned team ("Washington State") still matches provider labels
// ("Wash St"). Opponent/team *display* still uses provider-facing csv labels.
function getOwnerTeamSide(teamName: string, game: AppGame): 'away' | 'home' {
  return getGameSideForTeam(game, teamName) ?? 'home';
}

function getTeamGames(teamName: string, games: AppGame[]): AppGame[] {
  return games.filter((game) => getGameSideForTeam(game, teamName) !== null);
}

function getTeamId(teamName: string, teamGames: AppGame[]): string {
  const firstGame = teamGames[0];
  if (!firstGame) return teamName;
  return getGameParticipantTeamId(firstGame, getOwnerTeamSide(teamName, firstGame)) ?? teamName;
}

function getOpponentTeamId(teamName: string, game: AppGame): string {
  const opponentSide = getOwnerTeamSide(teamName, game) === 'away' ? 'home' : 'away';
  return (
    getGameParticipantTeamId(game, opponentSide) ??
    (opponentSide === 'home' ? game.canHome : game.canAway)
  );
}

function getOpponentProviderName(teamName: string, game: AppGame): string {
  return getOwnerTeamSide(teamName, game) === 'away' ? game.csvHome : game.csvAway;
}

function isAttachedFinalGame(score?: ScorePack): boolean {
  return gameStateFromScore(score) === 'final';
}

function isLiveGame(game: AppGame, score?: ScorePack): boolean {
  return game.status === 'in_progress' || gameStateFromScore(score) === 'inprogress';
}

function buildNextGameLabel(teamName: string, game: AppGame): string {
  const opponent = getOpponentProviderName(teamName, game);
  if (usesNeutralSiteSemantics(game) || game.neutral) {
    return `vs ${opponent}`;
  }

  return getOwnerTeamSide(teamName, game) === 'away' ? `at ${opponent}` : `vs ${opponent}`;
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
    const teamId = getTeamId(teamName, teamGames);

    let wins = 0;
    let losses = 0;

    for (const game of teamGames) {
      const score = scoresByKey[game.key];
      if (!isAttachedFinalGame(score)) continue;

      const side = getOwnerTeamSide(teamName, game);
      const teamScore = side === 'away' ? score?.away.score : score?.home.score;
      const opponentScore = side === 'away' ? score?.home.score : score?.away.score;
      if (teamScore == null || opponentScore == null || teamScore === opponentScore) continue;

      if (teamScore > opponentScore) wins += 1;
      else losses += 1;
    }

    const liveGame = teamGames.find((game) => isLiveGame(game, scoresByKey[game.key]));
    if (liveGame) {
      const liveScore = scoresByKey[liveGame.key];
      const ownerTeamSide = getOwnerTeamSide(teamName, liveGame);
      return {
        teamId,
        teamName,
        record: `${wins}–${losses}`,
        nextOpponent: getOpponentProviderName(teamName, liveGame),
        nextOpponentTeamId: getOpponentTeamId(teamName, liveGame),
        nextGameLabel: buildNextGameLabel(teamName, liveGame),
        ownerTeamSide,
        isNeutralSite: usesNeutralSiteSemantics(liveGame) || liveGame.neutral,
        nextKickoff: liveGame.date,
        currentStatus: 'Live',
        currentScore: buildScoreLine(liveScore),
        liveGameKey: liveGame.key,
      };
    }

    const nextGame = teamGames.find((game) => !isAttachedFinalGame(scoresByKey[game.key]));
    if (nextGame) {
      const ownerTeamSide = getOwnerTeamSide(teamName, nextGame);
      return {
        teamId,
        teamName,
        record: `${wins}–${losses}`,
        nextOpponent: getOpponentProviderName(teamName, nextGame),
        nextOpponentTeamId: getOpponentTeamId(teamName, nextGame),
        nextGameLabel: buildNextGameLabel(teamName, nextGame),
        ownerTeamSide,
        isNeutralSite: usesNeutralSiteSemantics(nextGame) || nextGame.neutral,
        nextKickoff: nextGame.date,
        currentStatus: 'Upcoming',
        currentScore: null,
        liveGameKey: null,
      };
    }

    return {
      teamId,
      teamName,
      record: `${wins}–${losses}`,
      nextOpponent: null,
      nextOpponentTeamId: null,
      nextGameLabel: null,
      ownerTeamSide: 'home',
      isNeutralSite: false,
      nextKickoff: null,
      currentStatus: 'Final',
      currentScore: null,
      liveGameKey: null,
    };
  });
}

function filterRosterRowsToWeek(
  allRosterRows: OwnerRosterRow[],
  weekGames: AppGame[],
  scoresByKey: Record<string, ScorePack>
): OwnerRosterRow[] {
  // Rows are already this owner's teams; a row belongs to the week when its
  // stored team plays a week game (resolved via canonical game identity).
  return allRosterRows
    .filter((row) => getTeamGames(row.teamName, weekGames).length > 0)
    .map((row) => {
      const teamWeekGames = getTeamGames(row.teamName, weekGames).sort(compareGamesByKickoff);
      const liveGame = teamWeekGames.find((game) => isLiveGame(game, scoresByKey[game.key]));
      if (liveGame) {
        const opponentTeamName = getOpponentProviderName(row.teamName, liveGame);
        return {
          ...row,
          nextOpponent: opponentTeamName,
          nextOpponentTeamId: getOpponentTeamId(row.teamName, liveGame),
          nextGameLabel: buildNextGameLabel(row.teamName, liveGame),
          ownerTeamSide: getOwnerTeamSide(row.teamName, liveGame),
          isNeutralSite: usesNeutralSiteSemantics(liveGame) || liveGame.neutral,
          nextKickoff: liveGame.date,
          currentStatus: 'Live',
          currentScore: buildScoreLine(scoresByKey[liveGame.key]),
          liveGameKey: liveGame.key,
        };
      }

      const nextGame = teamWeekGames.find((game) => !isAttachedFinalGame(scoresByKey[game.key]));
      if (nextGame) {
        const opponentTeamName = getOpponentProviderName(row.teamName, nextGame);
        return {
          ...row,
          nextOpponent: opponentTeamName,
          nextOpponentTeamId: getOpponentTeamId(row.teamName, nextGame),
          nextGameLabel: buildNextGameLabel(row.teamName, nextGame),
          ownerTeamSide: getOwnerTeamSide(row.teamName, nextGame),
          isNeutralSite: usesNeutralSiteSemantics(nextGame) || nextGame.neutral,
          nextKickoff: nextGame.date,
          currentStatus: 'Upcoming',
          currentScore: null,
          liveGameKey: null,
        };
      }

      const latestWeekGame = teamWeekGames.at(-1);
      if (latestWeekGame) {
        const opponentTeamName = getOpponentProviderName(row.teamName, latestWeekGame);
        return {
          ...row,
          nextOpponent: opponentTeamName,
          nextOpponentTeamId: getOpponentTeamId(row.teamName, latestWeekGame),
          nextGameLabel: buildNextGameLabel(row.teamName, latestWeekGame),
          ownerTeamSide: getOwnerTeamSide(row.teamName, latestWeekGame),
          isNeutralSite: usesNeutralSiteSemantics(latestWeekGame) || latestWeekGame.neutral,
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
  /**
   * Canonical standings rows. When **supplied** (any array, including empty),
   * canonical is authoritative for the owner header summary (rank / record /
   * win% / point differential): the header is the canonical row for the resolved
   * owner, or `null` when canonical does not contain that owner — never the local
   * row. This keeps Members from resurrecting owners/standings that canonical
   * excludes. The local row is used only when NO canonical snapshot is supplied
   * (`undefined`, e.g. Trends/History routes). Owner options, selection, roster
   * rows, and weekly game details always remain schedule/client-derived.
   */
  canonicalStandingsRows?: OwnerStandingsRow[];
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

  // Owner summary source: when a canonical snapshot is supplied it is
  // authoritative (no local fallback) so Members never resurrects an owner or
  // standings canonical excludes; the local row is used only when no canonical
  // snapshot is supplied at all (Trends/History routes).
  const { canonicalStandingsRows } = params;
  const summaryRows = canonicalStandingsRows ?? standingsRows;
  const headerIndex = summaryRows.findIndex((row) => row.owner === resolvedOwner);
  const headerRow = headerIndex >= 0 ? summaryRows[headerIndex] : null;
  const headerRank = headerIndex + 1;
  const rosterRows = deriveOwnerRoster(resolvedOwner, allGames, rosterByTeam, scoresByKey);
  const liveRows = rosterRows.filter((row) => row.currentStatus === 'Live');
  const weekRows = filterRosterRowsToWeek(rosterRows, weekGames, scoresByKey);

  const weekSections = deriveWeekMatchupSections(weekGames, rosterByTeam);
  const ownerSlates = deriveOwnerWeekSlates(weekGames, rosterByTeam, scoresByKey);
  const ownerSlate = ownerSlates.find((slate) => slate.owner === resolvedOwner) ?? null;
  const opponentOwners = ownerSlate?.opponentOwners ?? [];
  const totalGames = ownerSlate?.totalGames ?? 0;
  const liveGames = ownerSlate?.liveGames ?? 0;
  const finalGames = ownerSlate?.finalGames ?? 0;
  const scheduledGames = ownerSlate?.scheduledGames ?? 0;

  return {
    selectedOwner: resolvedOwner,
    ownerOptions,
    header: headerRow
      ? {
          owner: headerRow.owner,
          rank: headerRank,
          record: `${headerRow.wins}–${headerRow.losses}`,
          winPct: headerRow.winPct,
          pointDifferential: headerRow.pointDifferential,
        }
      : null,
    rosterRows,
    liveRows,
    weekRows,
    weekSummary: ownerSlate
      ? {
          totalGames,
          liveGames,
          finalGames,
          scheduledGames,
          opponentOwners,
          performanceSummary: ownerSlate.performance.summary,
          performanceDetail: ownerSlate.performance.detail,
        }
      : weekSections.secondaryGames.length || weekSections.ownerMatchups.length
        ? {
            totalGames: 0,
            liveGames: 0,
            finalGames: 0,
            scheduledGames: 0,
            opponentOwners: [],
            performanceSummary: 'No games this week',
            performanceDetail: 'No owned teams are attached to this week.',
          }
        : null,
  };
}
