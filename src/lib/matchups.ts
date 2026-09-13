import type { ScorePack } from './scores.ts';
import { getGameParticipantTeamId, type AppGame } from './schedule.ts';
import { deriveFinalOwnedParticipations } from './standings.ts';
import { isPolicyFcsConference } from './conferenceSubdivision.ts';
import { displayOwner, getOwnerForGameSide } from './gameOwnership.ts';
import {
  projectGameScoreboardState,
  type GameScoreboardState,
} from './selectors/gameScoreboardState.ts';

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

type ProjectedOwnerSlateGame = {
  game: OwnerSlateGame;
  state: GameScoreboardState;
  kickoffMs: number;
};

function projectOwnerSlateGameState(
  game: OwnerSlateGame,
  scoresByKey: Record<string, ScorePack>,
  nowMs: number
): ProjectedOwnerSlateGame {
  const kickoff = game.game.startTimeTBD === true ? null : game.game.date;
  const parsedKickoffMs = kickoff ? Date.parse(kickoff) : Number.NaN;

  return {
    game,
    state: projectGameScoreboardState(scoresByKey[game.game.key], kickoff, nowMs),
    kickoffMs: Number.isFinite(parsedKickoffMs) ? parsedKickoffMs : Number.MAX_SAFE_INTEGER,
  };
}

export function deriveOwnerWeekSlates(
  games: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>,
  nowMs: number
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
      const projectedGames = ownerGames.map((game) =>
        projectOwnerSlateGameState(game, scoresByKey, nowMs)
      );
      const sortedProjectedGames = projectedGames.slice().sort((a, b) => {
        // The contract has two groups: every non-final together by kickoff,
        // followed by finals by kickoff. A future runtime state is therefore
        // safely non-final unless it is exactly `final`.
        const rankDiff = Number(a.state === 'final') - Number(b.state === 'final');
        if (rankDiff !== 0) return rankDiff;

        if (a.kickoffMs !== b.kickoffMs) return a.kickoffMs - b.kickoffMs;
        return a.game.game.key.localeCompare(b.game.game.key);
      });
      const gamesForOwner = sortedProjectedGames.map(({ game }) => game);
      const liveGames = projectedGames.filter(
        ({ state }) => state === 'live' || state === 'awaiting'
      ).length;
      const finalGames = projectedGames.filter(({ state }) => state === 'final').length;
      const scheduledGames = gamesForOwner.length - liveGames - finalGames;
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
