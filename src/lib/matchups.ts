import type { CombinedOdds } from './odds';
import type { ScorePack } from './scores';
import type { AppGame } from './schedule';

function isFcsConference(conference: string | null | undefined): boolean {
  return /\bfcs\b/i.test(conference ?? '');
}

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
  game: AppGame;
  ownerTeamSide: 'away' | 'home';
  ownerTeamName: string;
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
      game.participants.home.kind === 'team' && !isFcsConference(game.homeConf);
    const awayIsLeagueTeam =
      game.participants.away.kind === 'team' && !isFcsConference(game.awayConf);
    const homeOwner = homeIsLeagueTeam ? rosterByTeam.get(game.csvHome) : undefined;
    const awayOwner = awayIsLeagueTeam ? rosterByTeam.get(game.csvAway) : undefined;

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

function getStateFromScore(score?: ScorePack): 'scheduled' | 'inprogress' | 'final' | 'neutral' {
  const status = score?.status?.toLowerCase() ?? '';

  if (!score || !status) return 'scheduled';
  if (status.includes('final')) return 'final';
  if (
    status.includes('progress') ||
    status.includes('quarter') ||
    status.includes('half') ||
    status.includes('ot')
  ) {
    return 'inprogress';
  }

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
      summary: 'No owner matchup',
      detail: 'This game is not part of weekly owner-vs-owner cards.',
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
    detail: `${ownedOwner}'s ${ownedTeam} is in secondary league context this week.`,
    tone: state,
  };
}

function buildScoreSummary(score?: ScorePack): string {
  if (!score) return 'No score yet';
  return `${score.away.team} ${score.away.score ?? '—'} at ${score.home.team} ${score.home.score ?? '—'} (${score.status})`;
}

function buildOddsSummary(odds?: CombinedOdds): string {
  if (!odds) return 'No odds available';
  return `Favorite: ${odds.favorite ?? '—'} · Spread: ${odds.spread ?? '—'} · Total: ${odds.total ?? '—'}`;
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
          ? `${bucket.awayOwner} vs Unowned / Non-league`
          : bucket.homeOwner
            ? `Unowned / Non-league vs ${bucket.homeOwner}`
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

function buildOwnerSlateGame(bucket: MatchupBucket, owner: string): OwnerSlateGame | null {
  if (bucket.awayOwner === owner) {
    return {
      game: bucket.game,
      ownerTeamSide: 'away',
      ownerTeamName: bucket.game.csvAway,
      opponentTeamName: bucket.game.csvHome,
      opponentOwner: bucket.homeOwner,
      isOwnerVsOwner: Boolean(bucket.homeOwner),
      isOpponentUnownedOrNonLeague: !bucket.homeOwner,
    };
  }

  if (bucket.homeOwner === owner) {
    return {
      game: bucket.game,
      ownerTeamSide: 'home',
      ownerTeamName: bucket.game.csvHome,
      opponentTeamName: bucket.game.csvAway,
      opponentOwner: bucket.awayOwner,
      isOwnerVsOwner: Boolean(bucket.awayOwner),
      isOpponentUnownedOrNonLeague: !bucket.awayOwner,
    };
  }

  return null;
}

function compareSlates(a: OwnerWeekSlate, b: OwnerWeekSlate): number {
  if (b.liveGames !== a.liveGames) return b.liveGames - a.liveGames;
  if (b.finalGames !== a.finalGames) return b.finalGames - a.finalGames;
  if (b.totalGames !== a.totalGames) return b.totalGames - a.totalGames;
  return a.owner.localeCompare(b.owner);
}

function buildOwnerWeekPerformance(
  games: OwnerSlateGame[],
  scoresByKey: Record<string, ScorePack>
): MatchupPerformanceState {
  let liveGames = 0;
  let finalGames = 0;
  let scheduledGames = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const slateGame of games) {
    const score = scoresByKey[slateGame.game.key];
    const state = getStateFromScore(score);

    if (state === 'inprogress') {
      liveGames += 1;
    } else if (state === 'final') {
      finalGames += 1;
    } else {
      scheduledGames += 1;
    }

    if (!score) continue;

    const ownerScore = slateGame.ownerTeamSide === 'away' ? score.away.score : score.home.score;
    const opponentScore = slateGame.ownerTeamSide === 'away' ? score.home.score : score.away.score;

    if (ownerScore == null || opponentScore == null || state !== 'final') continue;

    if (ownerScore > opponentScore) wins += 1;
    else if (ownerScore < opponentScore) losses += 1;
    else ties += 1;
  }

  const opponentOwners = Array.from(
    new Set(
      games.map((game) => game.opponentOwner).filter((value): value is string => Boolean(value))
    )
  );

  if (finalGames > 0 && scheduledGames === 0 && wins + losses + ties > 0) {
    const record = `${wins}-${losses}${ties > 0 ? `-${ties}` : ''}`;
    const detailParts = [
      `${games.length} game${games.length === 1 ? '' : 's'} this week`,
      `final record ${record}`,
    ];
    if (liveGames > 0) detailParts.push(`${liveGames} live`);
    if (scheduledGames > 0) detailParts.push(`${scheduledGames} awaiting kickoff`);
    if (opponentOwners.length > 0) detailParts.push(`faces ${opponentOwners.join(', ')}`);

    return {
      summary: `Finals in progress · ${record}`,
      detail: detailParts.join(' · '),
      tone: liveGames > 0 ? 'inprogress' : 'final',
    };
  }

  if (liveGames > 0) {
    const detailParts = [
      `${games.length} game${games.length === 1 ? '' : 's'} this week`,
      `${liveGames} live`,
    ];
    if (scheduledGames > 0) detailParts.push(`${scheduledGames} awaiting kickoff`);
    if (opponentOwners.length > 0) detailParts.push(`faces ${opponentOwners.join(', ')}`);

    return {
      summary: liveGames === games.length ? 'Live slate' : `${liveGames} live`,
      detail: detailParts.join(' · '),
      tone: 'inprogress',
    };
  }

  if (scheduledGames === games.length) {
    return {
      summary: games.length === 1 ? '1 game scheduled' : `${games.length} games scheduled`,
      detail:
        opponentOwners.length > 0
          ? `Awaiting kickoff · faces ${opponentOwners.join(', ')}`
          : 'Awaiting kickoff-heavy slate',
      tone: 'scheduled',
    };
  }

  return {
    summary: `${games.length} game${games.length === 1 ? '' : 's'} this week`,
    detail:
      opponentOwners.length > 0
        ? `Mixed slate · faces ${opponentOwners.join(', ')}`
        : 'Mixed owned-team slate this week',
    tone: 'neutral',
  };
}

export function deriveOwnerWeekSlates(
  games: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>
): OwnerWeekSlate[] {
  const sections = deriveWeekMatchupSections(games, rosterByTeam);
  const relevantBuckets = [...sections.ownerMatchups, ...sections.secondaryGames];
  const slatesByOwner = new Map<string, OwnerSlateGame[]>();

  for (const bucket of relevantBuckets) {
    const ownersForBucket = new Set<string>();
    if (bucket.awayOwner) ownersForBucket.add(bucket.awayOwner);
    if (bucket.homeOwner) ownersForBucket.add(bucket.homeOwner);

    for (const owner of ownersForBucket) {
      const slateGame = buildOwnerSlateGame(bucket, owner);
      if (!slateGame) continue;

      const existing = slatesByOwner.get(owner) ?? [];
      existing.push(slateGame);
      slatesByOwner.set(owner, existing);
    }
  }

  return Array.from(slatesByOwner.entries())
    .map(([owner, ownerGames]) => {
      const gamesForOwner = ownerGames.slice().sort((a, b) => {
        const aTime = a.game.date ? new Date(a.game.date).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.game.date ? new Date(b.game.date).getTime() : Number.MAX_SAFE_INTEGER;
        if (aTime !== bTime) return aTime - bTime;
        return a.game.key.localeCompare(b.game.key);
      });
      const liveGames = gamesForOwner.filter(
        (game) => getStateFromScore(scoresByKey[game.game.key]) === 'inprogress'
      ).length;
      const finalGames = gamesForOwner.filter(
        (game) => getStateFromScore(scoresByKey[game.game.key]) === 'final'
      ).length;
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
        performance: buildOwnerWeekPerformance(gamesForOwner, scoresByKey),
      };
    })
    .sort(compareSlates);
}

export function countRenderedMatchupCards(sections: WeekMatchupSections): number {
  const owners = new Set<string>();
  for (const bucket of [...sections.ownerMatchups, ...sections.secondaryGames]) {
    if (bucket.awayOwner) owners.add(bucket.awayOwner);
    if (bucket.homeOwner) owners.add(bucket.homeOwner);
  }
  return owners.size;
}
