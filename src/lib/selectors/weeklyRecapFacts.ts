import { getGameOwners } from '../gameOwnership.ts';
import type { LeagueStatus } from '../league.ts';
import type { ScorePack } from '../scores.ts';
import type { AppGame } from '../schedule.ts';
import {
  deriveFinalOwnedParticipations,
  deriveStandingsCoverage,
  NO_CLAIM_OWNER,
} from '../standings.ts';
import { derivePendingGame, type PendingGame } from '../standingsHistory.ts';
import { selectPendingGameFinality } from './pendingGameFinality.ts';

const RECAP_TIME_ZONE = 'America/New_York';
const RECAP_ELIGIBILITY_HOUR = 6;
const MINUTES_PER_HOUR = 60;
const EASTERN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: RECAP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

type EasternDateTime = {
  dateKey: string;
  minutesAfterMidnight: number;
};

export type WeeklyRecapTargetWeek = {
  week: number;
  latestGameDate: string;
};

export type WeeklyOwnerResult = {
  owner: string;
  wins: number;
  losses: number;
  gamesPlayed: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
};

export type WeeklyRecapFacts = {
  targetWeek: WeeklyRecapTargetWeek;
  ownerResults: WeeklyOwnerResult[];
  unresolvedCount: number;
  abandonedCount: number;
  missingResultCount: number;
};

export function isWeeklyRecapActiveSeason(args: {
  leagueStatus: LeagueStatus | undefined;
  seasonYear: number;
}): boolean {
  return args.leagueStatus?.state === 'season' && args.leagueStatus.year === args.seasonYear;
}

function easternDateTime(value: Date): EasternDateTime | null {
  if (!Number.isFinite(value.getTime())) return null;

  const parts = EASTERN_DATE_TIME_FORMATTER.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((candidate) => candidate.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const hour = Number(part('hour'));
  const minute = Number(part('minute'));

  if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  return {
    dateKey: `${year}-${month}-${day}`,
    minutesAfterMidnight: hour * MINUTES_PER_HOUR + minute,
  };
}

function easternGameDate(game: AppGame): string | null {
  if (!game.date) return null;
  const parsed = new Date(game.date);
  return easternDateTime(parsed)?.dateKey ?? null;
}

function utcDayNumber(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(timestamp)) return null;

  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return Math.floor(timestamp / 86_400_000);
}

function isEligible(latestGameDate: string, now: EasternDateTime): boolean {
  const latestDay = utcDayNumber(latestGameDate);
  const currentDay = utcDayNumber(now.dateKey);
  if (latestDay == null || currentDay == null) return false;

  const elapsedDays = currentDay - latestDay;
  if (elapsedDays > 1) return true;
  if (elapsedDays < 1) return false;

  return now.minutesAfterMidnight >= RECAP_ELIGIBILITY_HOUR * MINUTES_PER_HOUR;
}

/** Select the latest week past its next-day 06:00 ET cutoff, independent of game status. */
export function selectWeeklyRecapTargetWeek(
  games: AppGame[],
  now: Date
): WeeklyRecapTargetWeek | null {
  const easternNow = easternDateTime(now);
  if (!easternNow) return null;

  const latestDateByWeek = new Map<number, string>();
  for (const game of games) {
    const week = game.canonicalWeek;
    if (!Number.isInteger(week) || week < 0) continue;

    const dateKey = easternGameDate(game);
    if (!dateKey) continue;

    const previous = latestDateByWeek.get(week);
    if (!previous || dateKey > previous) latestDateByWeek.set(week, dateKey);
  }

  const eligible = Array.from(latestDateByWeek.entries())
    .filter(([, latestGameDate]) => isEligible(latestGameDate, easternNow))
    .sort(([leftWeek], [rightWeek]) => rightWeek - leftWeek);
  const selected = eligible[0];

  return selected ? { week: selected[0], latestGameDate: selected[1] } : null;
}

export function selectWeeklyRecapFacts(args: {
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  scoresByKey: Record<string, ScorePack>;
  now: Date;
}): WeeklyRecapFacts | null {
  const { games, rosterByTeam, scoresByKey, now } = args;
  const targetWeek = selectWeeklyRecapTargetWeek(games, now);
  if (!targetWeek) return null;

  const targetGames = games.filter((game) => game.canonicalWeek === targetWeek.week);
  const leagueGames = targetGames.filter((game) => {
    const { awayOwner, homeOwner } = getGameOwners(game, rosterByTeam);
    return (
      (awayOwner != null && awayOwner !== NO_CLAIM_OWNER) ||
      (homeOwner != null && homeOwner !== NO_CLAIM_OWNER)
    );
  });
  const totalsByOwner = new Map<string, WeeklyOwnerResult>();
  const participations = deriveFinalOwnedParticipations(leagueGames, rosterByTeam, scoresByKey);
  const countedGameKeys = new Set<string>();

  for (const participation of participations) {
    if (participation.owner === NO_CLAIM_OWNER) continue;
    countedGameKeys.add(participation.game.key);
    const current = totalsByOwner.get(participation.owner) ?? {
      owner: participation.owner,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
    };

    current.gamesPlayed += 1;
    current.pointsFor += participation.pointsFor;
    current.pointsAgainst += participation.pointsAgainst;
    current.pointDifferential = current.pointsFor - current.pointsAgainst;
    if (participation.result === 'win') current.wins += 1;
    if (participation.result === 'loss') current.losses += 1;
    totalsByOwner.set(participation.owner, current);
  }

  const pendingGames: PendingGame[] = [];
  let missingResultCount = 0;
  for (const game of leagueGames) {
    if (countedGameKeys.has(game.key)) continue;

    const score = scoresByKey[game.key];
    const pending = derivePendingGame(game, score);
    if (!pending) {
      if (deriveStandingsCoverage([game], rosterByTeam, scoresByKey).state === 'partial') {
        missingResultCount += 1;
      }
      continue;
    }
    pendingGames.push(pending);
  }
  const pendingFinality = selectPendingGameFinality({ pendingGames, now });
  const abandonedCount = pendingFinality.acceptedWithoutResult.length;
  const unresolvedCount = abandonedCount === 0 ? pendingGames.length : 0;

  return {
    targetWeek,
    ownerResults: Array.from(totalsByOwner.values()).sort((left, right) =>
      left.owner.localeCompare(right.owner)
    ),
    unresolvedCount,
    abandonedCount,
    missingResultCount,
  };
}
