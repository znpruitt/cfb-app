import { classifyScorePackStatus } from './gameStatus.ts';
import type { CombinedOdds } from './odds.ts';
import type { ScorePack } from './scores.ts';
import type { AppGame } from './schedule.ts';
import { deriveFinalOwnedParticipations } from './standings.ts';
import { isPolicyFcsConference } from './conferenceSubdivision.ts';
import { displayOwner, getOwnerForGameSide } from './gameOwnership.ts';
import {
  selectOwnerSlateStateProjection,
  selectOwnerSlateGamesForBucket,
  type OwnerSlateStateProjection,
} from './selectors/matchups.ts';
import { NO_SCORE_REPORTED_LABEL } from './selectors/gameScoreboardState.ts';
import type { OwnerSlateSurfaceProjection } from './selectors/ownerGameState.ts';

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

export type MatchupCardViewModel = MatchupBucket & {
  title: string;
  performance: MatchupPerformanceState;
  supporting: {
    awayTeam: string;
    homeTeam: string;
    scoreSummary: string;
    oddsSummary: string;
  };
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
  unavailableGames: number;
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

function getStateFromScore(score?: ScorePack): 'scheduled' | 'inprogress' | 'final' {
  const bucket = classifyScorePackStatus(score);
  if (bucket === 'final') return 'final';
  if (bucket === 'inprogress') return 'inprogress';
  return 'scheduled';
}

function formatOwnerLead(scoreValue: number | null | undefined): string {
  return scoreValue == null ? '—' : String(scoreValue);
}

function buildPerformanceState(bucket: MatchupBucket, score?: ScorePack): MatchupPerformanceState {
  const state = getStateFromScore(score);

  if (bucket.awayOwner && bucket.homeOwner) {
    if (!score) {
      return {
        summary: 'Awaiting kickoff',
        detail: `${bucket.awayOwner} vs ${bucket.homeOwner}`,
        tone: 'scheduled',
      };
    }

    const awayScore = score.away.score;
    const homeScore = score.home.score;

    if (awayScore == null || homeScore == null || state === 'scheduled') {
      return {
        summary:
          state === 'final' ? 'Final' : state === 'inprogress' ? 'In progress' : 'Awaiting kickoff',
        detail: `${bucket.awayOwner} vs ${bucket.homeOwner}`,
        tone: state,
      };
    }

    if (awayScore === homeScore) {
      return {
        summary: state === 'final' ? 'Final: tied score' : 'Tied',
        detail: `${bucket.awayOwner} ${formatOwnerLead(awayScore)} - ${formatOwnerLead(homeScore)} ${bucket.homeOwner}`,
        tone: state === 'final' ? 'final' : 'neutral',
      };
    }

    const leader = awayScore > homeScore ? bucket.awayOwner : bucket.homeOwner;
    const trailing = awayScore > homeScore ? bucket.homeOwner : bucket.awayOwner;
    const leaderScore = awayScore > homeScore ? awayScore : homeScore;
    const trailingScore = awayScore > homeScore ? homeScore : awayScore;

    return {
      summary: state === 'final' ? `Final: ${leader} won` : `${leader} leading`,
      detail: `${leader} ${formatOwnerLead(leaderScore)} - ${formatOwnerLead(trailingScore)} ${trailing}`,
      tone: state,
    };
  }

  const ownedOwner = bucket.awayOwner ?? bucket.homeOwner;
  const ownedTeam = bucket.awayOwner ? bucket.game.csvAway : bucket.game.csvHome;

  if (!ownedOwner) {
    return {
      summary: 'No matchup',
      detail: 'This game is not part of the weekly head-to-head cards.',
      tone: 'neutral',
    };
  }

  if (!score) {
    return {
      summary: 'Awaiting kickoff',
      detail: `${ownedOwner}'s ${ownedTeam} plays this week.`,
      tone: 'scheduled',
    };
  }

  return {
    summary:
      state === 'final' ? 'Final' : state === 'inprogress' ? 'In progress' : 'Awaiting kickoff',
    detail: `${ownedOwner}'s ${ownedTeam} is in secondary team context this week.`,
    tone: state,
  };
}

function buildScoreSummary(score?: ScorePack): string {
  if (!score) return 'No score yet';
  return `${score.away.team} ${score.away.score ?? '—'} at ${score.home.team} ${score.home.score ?? '—'} (${score.status})`;
}

function buildOddsSummary(odds?: CombinedOdds): string {
  if (!odds) return 'No odds available';

  const sourceLabel =
    odds.lineSourceStatus === 'latest'
      ? 'Latest'
      : odds.lineSourceStatus === 'closing'
        ? 'Closing'
        : 'Stored latest';

  return `Favorite: ${odds.favorite ?? '—'} · Spread: ${odds.spread ?? '—'} · Total: ${odds.total ?? '—'} · ${sourceLabel}`;
}

export function buildMatchupCardViewModel(
  bucket: MatchupBucket,
  scoresByKey: Record<string, ScorePack>,
  oddsByKey: Record<string, CombinedOdds>
): MatchupCardViewModel {
  const score = scoresByKey[bucket.game.key];
  const odds = oddsByKey[bucket.game.key];

  return {
    ...bucket,
    title:
      bucket.awayOwner && bucket.homeOwner
        ? `${bucket.awayOwner} vs ${bucket.homeOwner}`
        : bucket.awayOwner
          ? `${bucket.awayOwner} vs Open / non-league`
          : bucket.homeOwner
            ? `Open / non-league vs ${bucket.homeOwner}`
            : `${bucket.game.csvAway} vs ${bucket.game.csvHome}`,
    performance: buildPerformanceState(bucket, score),
    supporting: {
      awayTeam: bucket.game.csvAway,
      homeTeam: bucket.game.csvHome,
      scoreSummary: buildScoreSummary(score),
      oddsSummary: buildOddsSummary(odds),
    },
  };
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
  stateProjection: OwnerSlateStateProjection,
  buckets: MatchupBucket[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>
): MatchupPerformanceState {
  const { games, liveGames, finalGames, scheduledGames, unavailableGames } = stateProjection;
  let wins = 0;
  let losses = 0;

  for (const bucket of buckets) {
    const counted = countOwnerRecordForBucket(bucket, owner, rosterByTeam, scoresByKey);
    wins += counted.wins;
    losses += counted.losses;
  }

  const record = `${wins}–${losses}`;

  if (scheduledGames === games.length) {
    return {
      summary: 'Scheduled',
      detail: `${games.length} game${games.length === 1 ? '' : 's'}`,
      tone: 'scheduled',
    };
  }

  if (liveGames > 0) {
    return {
      summary: `${record} · ${liveGames} live`,
      detail: `${games.length} game${games.length === 1 ? '' : 's'}`,
      tone: 'inprogress',
    };
  }

  if (finalGames > 0) {
    return {
      summary: record,
      detail: `${games.length} game${games.length === 1 ? '' : 's'}`,
      tone: scheduledGames > 0 || unavailableGames > 0 ? 'neutral' : 'final',
    };
  }

  if (unavailableGames > 0) {
    return {
      summary: NO_SCORE_REPORTED_LABEL,
      detail: `${games.length} game${games.length === 1 ? '' : 's'}`,
      tone: 'neutral',
    };
  }

  return {
    summary: 'Scheduled',
    detail: `${games.length} game${games.length === 1 ? '' : 's'}`,
    tone: 'scheduled',
  };
}

export function deriveOwnerWeekSlates(
  games: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>,
  projection: OwnerSlateSurfaceProjection
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
      const slateGames = selectOwnerSlateGamesForBucket(bucket, owner);
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
      const stateProjection = selectOwnerSlateStateProjection({
        games: ownerGames,
        scoresByKey,
        projection,
      });
      const gamesForOwner = stateProjection.games;
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
        totalGames: stateProjection.totalGames,
        liveGames: stateProjection.liveGames,
        finalGames: stateProjection.finalGames,
        scheduledGames: stateProjection.scheduledGames,
        unavailableGames: stateProjection.unavailableGames,
        performance: buildOwnerWeekPerformance(
          owner,
          stateProjection,
          bucketsByOwner.get(owner) ?? [],
          rosterByTeam,
          scoresByKey
        ),
      };
    })
    .sort(compareSlates);
}
