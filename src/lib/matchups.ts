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

export function countRenderedMatchupCards(sections: WeekMatchupSections): number {
  return sections.ownerMatchups.length + sections.secondaryGames.length;
}
