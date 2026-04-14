import type { CfbdGameLoose, EspnEvent, ScorePack, SeasonType } from './types.ts';

export function seasonYearForToday(now = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function firstStr(fields: Array<string | undefined | null>): string | undefined {
  for (const field of fields) {
    const value = typeof field === 'string' ? field.trim() : undefined;
    if (value) return value;
  }
  return undefined;
}

function firstNum(fields: Array<number | undefined | null>): number | null {
  for (const field of fields) {
    if (typeof field === 'number' && Number.isFinite(field)) return field;
  }
  return null;
}

function toStatus(status?: string | null, completed?: boolean | null): string {
  const normalized = (status ?? '').toLowerCase();
  if (normalized.includes('final')) return 'final';
  if (normalized.includes('progress') || normalized.includes('half') || normalized.includes('q')) {
    return 'in progress';
  }
  if (completed) return 'final';
  if (normalized.includes('sched')) return 'scheduled';
  return normalized ? status! : 'scheduled';
}

export function toScorePackFromCfbd(game: CfbdGameLoose): ScorePack | null {
  const homeTeam = firstStr([game.home_team, game.homeTeam, game.home, game.home_name]);
  const awayTeam = firstStr([game.away_team, game.awayTeam, game.away, game.away_name]);
  if (!homeTeam || !awayTeam) return null;

  const homeScore = firstNum([
    game.home_points ?? null,
    game.homePoints ?? null,
    game.home_score ?? null,
  ]);
  const awayScore = firstNum([
    game.away_points ?? null,
    game.awayPoints ?? null,
    game.away_score ?? null,
  ]);

  return {
    id: game.id != null && String(game.id).trim().length > 0 ? String(game.id).trim() : null,
    seasonType:
      game.season_type === 'postseason' || game.seasonType === 'postseason'
        ? 'postseason'
        : game.season_type === 'regular' || game.seasonType === 'regular'
          ? 'regular'
          : null,
    startDate: game.start_date ?? game.startDate ?? null,
    week:
      typeof game.week === 'number'
        ? game.week
        : /^\d+$/.test(String(game.week ?? ''))
          ? Number.parseInt(String(game.week), 10)
          : null,
    status: toStatus(game.status, game.completed ?? null),
    time: game.start_date ?? null,
    home: { team: homeTeam, score: homeScore },
    away: { team: awayTeam, score: awayScore },
  };
}

export function toScorePackFromEspn(
  event: EspnEvent & { id?: string },
  week: number | null,
  seasonType: SeasonType
): ScorePack | null {
  const competition = event.competitions?.[0];
  if (!competition) return null;

  const statusType = competition.status?.type;
  const name = (statusType?.name ?? '').toLowerCase();
  const description = (statusType?.description ?? '').toLowerCase();

  let status = 'scheduled';
  if (name.includes('final') || description.includes('final')) status = 'final';
  else if (
    name.includes('progress') ||
    description.includes('progress') ||
    description.includes('half') ||
    description.includes('q')
  ) {
    status = 'in progress';
  }

  const homeRef = competition.competitors.find((competitor) => competitor.homeAway === 'home');
  const awayRef = competition.competitors.find((competitor) => competitor.homeAway === 'away');
  if (!homeRef || !awayRef) return null;

  const homeScore = Number.parseInt(homeRef.score ?? '', 10);
  const awayScore = Number.parseInt(awayRef.score ?? '', 10);

  return {
    id: event.id ?? null,
    seasonType,
    startDate: null,
    week,
    status,
    time: statusType?.shortDetail ?? null,
    home: {
      team: homeRef.team.displayName,
      score: Number.isFinite(homeScore) ? homeScore : null,
    },
    away: {
      team: awayRef.team.displayName,
      score: Number.isFinite(awayScore) ? awayScore : null,
    },
  };
}
