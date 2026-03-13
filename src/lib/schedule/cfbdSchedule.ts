export type SeasonType = 'regular' | 'postseason';

export type CfbdScheduleGame = {
  id?: number | string;
  week?: number | string;
  start_date?: string | null;
  startDate?: string | null;
  neutral_site?: boolean;
  neutralSite?: boolean;
  conference_game?: boolean;
  conferenceGame?: boolean;
  home_team?: string;
  away_team?: string;
  homeTeam?: string;
  awayTeam?: string;
  home_conference?: string | null;
  away_conference?: string | null;
  homeConference?: string | null;
  awayConference?: string | null;
  status?: string | null;
  venue?: string | null;
  notes?: string | null;
  name?: string | null;
};

export type ScheduleItem = {
  id: string;
  week: number;
  startDate: string | null;
  neutralSite: boolean;
  conferenceGame: boolean;
  homeTeam: string;
  awayTeam: string;
  homeConference: string;
  awayConference: string;
  status: string;
  venue?: string | null;
  label?: string | null;
  notes?: string | null;
  seasonType?: SeasonType;
};

export type ScheduleDropReason =
  | 'invalid_payload'
  | 'missing_week'
  | 'missing_home_team'
  | 'missing_away_team';

export type ScheduleMapResult =
  | { ok: true; item: ScheduleItem }
  | { ok: false; reason: ScheduleDropReason; raw: unknown };

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWeek(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

export function mapCfbdScheduleGame(
  game: CfbdScheduleGame,
  seasonType: SeasonType
): ScheduleMapResult {
  if (!game || typeof game !== 'object') {
    return { ok: false, reason: 'invalid_payload', raw: game };
  }

  const week = normalizeWeek(game.week);
  if (week == null) {
    return { ok: false, reason: 'missing_week', raw: game };
  }

  const homeTeam = normalizeString(game.home_team ?? game.homeTeam);
  if (!homeTeam) {
    return { ok: false, reason: 'missing_home_team', raw: game };
  }

  const awayTeam = normalizeString(game.away_team ?? game.awayTeam);
  if (!awayTeam) {
    return { ok: false, reason: 'missing_away_team', raw: game };
  }

  return {
    ok: true,
    item: {
      id: String(game.id ?? `${week}-${homeTeam}-${awayTeam}`),
      week,
      startDate: game.start_date ?? game.startDate ?? null,
      neutralSite: Boolean(game.neutral_site ?? game.neutralSite),
      conferenceGame: Boolean(game.conference_game ?? game.conferenceGame),
      homeTeam,
      awayTeam,
      homeConference: normalizeString(game.home_conference ?? game.homeConference),
      awayConference: normalizeString(game.away_conference ?? game.awayConference),
      status: normalizeString(game.status) || 'scheduled',
      venue: normalizeString(game.venue) || null,
      label: normalizeString(game.name) || null,
      notes: normalizeString(game.notes) || null,
      seasonType,
    },
  };
}
