import type { ScorePack } from './scores.ts';
import { getGameParticipantTeamId, type AppGame } from './schedule.ts';
import { deriveFinalOwnedParticipations } from './standings.ts';
import { isPolicyFcsConference } from './conferenceSubdivision.ts';
import { displayOwner, getOwnerForGameSide } from './gameOwnership.ts';
import type { GameDayContext } from './selectors/gameDayConfidence.ts';
import type { GameScoreboardState } from './selectors/gameScoreboardState.ts';
import { projectMatchupsRowState, projectMembersRowState } from './selectors/ownerGameState.ts';

export type MatchupBucket = {
  game: AppGame;
  homeOwner?: string;
  awayOwner?: string;
  homeIsLeagueTeam: boolean;
  awayIsLeagueTeam: boolean;
};

export type WeekMatchupSections = {
  ownerMatchups: MatchupBucket[];
  secondaryGames: MatchupBucket[];
  otherGames: MatchupBucket[];
};

export type MatchupPerformanceState = {
  summary: string;
  detail: string;
  tone: 'scheduled' | 'inprogress' | 'final' | 'neutral';
};

export type OwnerSlateGame = {
  owner: string;
  game: AppGame;
  ownerTeamSide: 'away' | 'home';
  ownerTeamId: string;
  ownerTeamName: string;
  opponentTeamId: string;
  opponentTeamName: string;
  opponentOwner?: string;
  isOwnerVsOwner: boolean;
  isOpponentUnownedOrNonLeague: boolean;
};

export type OwnerWeekSlate = {
  owner: string;
  games: OwnerSlateGame[];
  opponentOwners: string[];
  totalGames: number;
  liveGames: number;
  finalGames: number;
  scheduledGames: number;
  performance: MatchupPerformanceState;
};

export function deriveWeekMatchupSections(
  games: AppGame[],
  rosterByTeam: Map<string, string>
): WeekMatchupSections {
  const ownerMatchups: MatchupBucket[] = [];
  const secondaryGames: MatchupBucket[] = [];
  const otherGames: MatchupBucket[] = [];

  for (const game of games) {
    const homeIsLeagueTeam =
      game.participants.home.kind === 'team' && !isPolicyFcsConference(game.homeConf);
    const awayIsLeagueTeam =
      game.participants.away.kind === 'team' && !isPolicyFcsConference(game.awayConf);
    // Item 713 — ownership enters the bucket through the shared seam, so no
    // consumer has to know the sentinel exists.
    //
    // `buildConfirmedOwnersCsv` writes `NoClaim` as a real owner row for every
    // undrafted eligible team, so after a draft is confirmed `getOwnerForGameSide`
    // resolves an UNOWNED team to a truthy string. Every read below — the
    // sectioning predicates, the owner set that builds slates, the opponent list
    // — decides ownership by truthiness, so each one counted the sentinel as a
    // member. `displayOwner` is the seam that already hides it for
    // `OverviewPanel`/`GameWeekPanel`; applying it HERE, at the one place owners
    // enter the model, is what makes every downstream read correct at once
    // rather than one guard per reader, each of which can be forgotten.
    //
    // `?? undefined` because `MatchupBucket` encodes "no owner" as absent, which
    // is what `''` already meant before a draft is confirmed. The two
    // representations collapse to one here.
    const homeOwner = homeIsLeagueTeam
      ? (displayOwner(getOwnerForGameSide(game, 'home', rosterByTeam)) ?? undefined)
      : undefined;
    const awayOwner = awayIsLeagueTeam
      ? (displayOwner(getOwnerForGameSide(game, 'away', rosterByTeam)) ?? undefined)
      : undefined;

    const bucket = {
      game,
      homeOwner,
      awayOwner,
      homeIsLeagueTeam,
      awayIsLeagueTeam,
    };

    if (homeIsLeagueTeam && awayIsLeagueTeam && homeOwner && awayOwner) {
      ownerMatchups.push(bucket);
      continue;
    }

    if (homeOwner || awayOwner) {
      secondaryGames.push(bucket);
      continue;
    }

    otherGames.push(bucket);
  }

  return { ownerMatchups, secondaryGames, otherGames };
}

function buildOwnerSlateGames(bucket: MatchupBucket, owner: string): OwnerSlateGame[] {
  const games: OwnerSlateGame[] = [];

  if (bucket.awayOwner === owner) {
    games.push({
      owner,
      game: bucket.game,
      ownerTeamSide: 'away',
      ownerTeamId: getGameParticipantTeamId(bucket.game, 'away') ?? bucket.game.canAway,
      ownerTeamName: bucket.game.csvAway,
      opponentTeamId: getGameParticipantTeamId(bucket.game, 'home') ?? bucket.game.canHome,
      opponentTeamName: bucket.game.csvHome,
      opponentOwner: bucket.homeOwner,
      isOwnerVsOwner: Boolean(bucket.homeOwner),
      isOpponentUnownedOrNonLeague: !bucket.homeOwner,
    });
  }

  if (bucket.homeOwner === owner) {
    games.push({
      owner,
      game: bucket.game,
      ownerTeamSide: 'home',
      ownerTeamId: getGameParticipantTeamId(bucket.game, 'home') ?? bucket.game.canHome,
      ownerTeamName: bucket.game.csvHome,
      opponentTeamId: getGameParticipantTeamId(bucket.game, 'away') ?? bucket.game.canAway,
      opponentTeamName: bucket.game.csvAway,
      opponentOwner: bucket.awayOwner,
      isOwnerVsOwner: Boolean(bucket.awayOwner),
      isOpponentUnownedOrNonLeague: !bucket.awayOwner,
    });
  }

  return games;
}

function compareSlates(a: OwnerWeekSlate, b: OwnerWeekSlate): number {
  if (b.liveGames !== a.liveGames) return b.liveGames - a.liveGames;
  if (a.scheduledGames !== b.scheduledGames) return a.scheduledGames - b.scheduledGames;
  if (a.finalGames !== b.finalGames) return a.finalGames - b.finalGames;
  if (b.totalGames !== a.totalGames) return b.totalGames - a.totalGames;
  return a.owner.localeCompare(b.owner);
}

type OwnerCountedRecord = {
  wins: number;
  losses: number;
};

function countOwnerRecordForBucket(
  bucket: MatchupBucket,
  owner: string,
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>
): OwnerCountedRecord {
  const participations = deriveFinalOwnedParticipations([bucket.game], rosterByTeam, scoresByKey);

  let wins = 0;
  let losses = 0;
  for (const participation of participations) {
    if (participation.owner !== owner) continue;
    if (participation.result === 'win') wins += 1;
    else losses += 1;
  }

  return { wins, losses };
}

function buildOwnerWeekPerformance(
  owner: string,
  totalGames: number,
  gameCounts: Pick<OwnerWeekSlate, 'liveGames' | 'finalGames' | 'scheduledGames'>,
  buckets: MatchupBucket[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>
): MatchupPerformanceState {
  let wins = 0;
  let losses = 0;
  const { liveGames, finalGames, scheduledGames } = gameCounts;

  for (const bucket of buckets) {
    const counted = countOwnerRecordForBucket(bucket, owner, rosterByTeam, scoresByKey);
    wins += counted.wins;
    losses += counted.losses;
  }

  const record = `${wins}–${losses}`;

  if (scheduledGames === totalGames) {
    return {
      summary: 'Scheduled',
      detail: `${totalGames} game${totalGames === 1 ? '' : 's'}`,
      tone: 'scheduled',
    };
  }

  if (liveGames > 0) {
    return {
      summary: `${record} · ${liveGames} live`,
      detail: `${totalGames} game${totalGames === 1 ? '' : 's'}`,
      tone: 'inprogress',
    };
  }

  if (finalGames > 0) {
    return {
      summary: record,
      detail: `${totalGames} game${totalGames === 1 ? '' : 's'}`,
      tone: scheduledGames > 0 ? 'neutral' : 'final',
    };
  }

  return {
    summary: 'Scheduled',
    detail: `${totalGames} game${totalGames === 1 ? '' : 's'}`,
    tone: 'scheduled',
  };
}

/**
 * The complete row-state authority a slate surface renders from. Matchups and
 * Members have different established row contracts, so this selection covers
 * every state rather than overriding only `awaiting`.
 *
 * Both clocks are required explicit inputs. Selectors never read wall time.
 */
export type SlateRowStateProjection =
  | { kind: 'matchups'; now: number }
  | { kind: 'members'; context: GameDayContext };

type ProjectedOwnerSlateGame = {
  game: OwnerSlateGame;
  state: GameScoreboardState;
  kickoffMs: number;
};

function projectOwnerSlateGameState(
  game: OwnerSlateGame,
  scoresByKey: Record<string, ScorePack>,
  projection: SlateRowStateProjection
): ProjectedOwnerSlateGame {
  const kickoff = game.game.startTimeTBD === true ? null : game.game.date;
  const kickoffMs = kickoff ? Date.parse(kickoff) : Number.NaN;
  const score = scoresByKey[game.game.key];
  const state =
    projection.kind === 'matchups'
      ? projectMatchupsRowState(game.game, score, projection.now)
      : projectMembersRowState(game.game, score, projection.context);

  return {
    game,
    state,
    kickoffMs: Number.isFinite(kickoffMs) ? kickoffMs : Number.MAX_SAFE_INTEGER,
  };
}

export function selectDistinctOwnerSlateGames(games: OwnerSlateGame[]): OwnerSlateGame[] {
  const seen = new Set<string>();
  const distinct: OwnerSlateGame[] = [];

  for (const game of games) {
    if (seen.has(game.game.key)) continue;
    seen.add(game.game.key);
    distinct.push(game);
  }

  return distinct;
}

function countProjectedGames(
  projectedGames: ProjectedOwnerSlateGame[]
): Pick<OwnerWeekSlate, 'liveGames' | 'finalGames' | 'scheduledGames'> {
  let liveGames = 0;
  let finalGames = 0;
  let scheduledGames = 0;

  for (const { state } of projectedGames) {
    if (state === 'live' || state === 'awaiting') {
      liveGames += 1;
    } else if (state === 'final') {
      finalGames += 1;
    } else if (state === 'scheduled') {
      scheduledGames += 1;
    } else {
      const unhandledState: never = state;
      throw new Error(`Unhandled owner slate state: ${String(unhandledState)}`);
    }
  }

  const totalGames = projectedGames.length;
  if (liveGames + finalGames + scheduledGames !== totalGames) {
    throw new Error('Owner slate state counts must sum to its distinct games');
  }

  return { liveGames, finalGames, scheduledGames };
}

export function deriveOwnerWeekSlates(
  games: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>,
  projection: SlateRowStateProjection
): OwnerWeekSlate[] {
  const sections = deriveWeekMatchupSections(games, rosterByTeam);
  const relevantBuckets = [...sections.ownerMatchups, ...sections.secondaryGames];
  const slatesByOwner = new Map<string, OwnerSlateGame[]>();
  const bucketsByOwner = new Map<string, MatchupBucket[]>();

  for (const bucket of relevantBuckets) {
    const ownersForBucket = new Set<string>();
    if (bucket.awayOwner) ownersForBucket.add(bucket.awayOwner);
    if (bucket.homeOwner) ownersForBucket.add(bucket.homeOwner);

    for (const owner of ownersForBucket) {
      const slateGames = buildOwnerSlateGames(bucket, owner);
      if (slateGames.length === 0) continue;

      const existing = slatesByOwner.get(owner) ?? [];
      existing.push(...slateGames);
      slatesByOwner.set(owner, existing);

      const existingBuckets = bucketsByOwner.get(owner) ?? [];
      existingBuckets.push(bucket);
      bucketsByOwner.set(owner, existingBuckets);
    }
  }

  return Array.from(slatesByOwner.entries())
    .map(([owner, ownerGames]) => {
      // A self matchup creates one entry per owned side. The card renders
      // games, so deduplicate before projection, counts, totals, and ordering.
      // First occurrence (the away-side entry) wins deterministically.
      const distinctOwnerGames = selectDistinctOwnerSlateGames(ownerGames);
      const projectedGames = distinctOwnerGames.map((game) =>
        projectOwnerSlateGameState(game, scoresByKey, projection)
      );
      const sortedProjectedGames = projectedGames.slice().sort((a, b) => {
        // Every non-final shares one kickoff-ordered group. Finals follow it.
        const rankDiff = Number(a.state === 'final') - Number(b.state === 'final');
        if (rankDiff !== 0) return rankDiff;

        if (a.kickoffMs !== b.kickoffMs) return a.kickoffMs - b.kickoffMs;
        return a.game.game.key.localeCompare(b.game.game.key);
      });
      const gamesForOwner = sortedProjectedGames.map(({ game }) => game);
      const { liveGames, finalGames, scheduledGames } = countProjectedGames(projectedGames);
      const opponentOwners = Array.from(
        new Set(
          gamesForOwner
            .map((game) => game.opponentOwner)
            .filter((value): value is string => Boolean(value))
        )
      );

      return {
        owner,
        games: gamesForOwner,
        opponentOwners,
        totalGames: gamesForOwner.length,
        liveGames,
        finalGames,
        scheduledGames,
        performance: buildOwnerWeekPerformance(
          owner,
          gamesForOwner.length,
          { liveGames, finalGames, scheduledGames },
          bucketsByOwner.get(owner) ?? [],
          rosterByTeam,
          scoresByKey
        ),
      };
    })
    .sort(compareSlates);
}
