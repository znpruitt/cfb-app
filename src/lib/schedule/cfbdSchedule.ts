import {
  matchConferenceChampionshipSlotByConference,
  matchConferenceChampionshipSlotByText,
} from '../conferenceChampionships';

export type SeasonType = 'regular' | 'postseason';

type GamePhase = 'regular' | 'conference_championship' | 'postseason';
type PostseasonSubtype = 'bowl' | 'playoff';
type PlayoffRound = 'quarterfinal' | 'semifinal' | 'national_championship' | 'playoff';
type NeutralSiteDisplay = 'vs' | 'home_away';

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
  season_type?: SeasonType | string | null;
  seasonType?: SeasonType | string | null;
  game_phase?: GamePhase | string | null;
  gamePhase?: GamePhase | string | null;
  regular_subtype?: 'standard' | 'conference_championship' | string | null;
  regularSubtype?: 'standard' | 'conference_championship' | string | null;
  postseason_subtype?: PostseasonSubtype | string | null;
  postseasonSubtype?: PostseasonSubtype | string | null;
  playoff_round?: PlayoffRound | string | null;
  playoffRound?: PlayoffRound | string | null;
  bowl_name?: string | null;
  bowlName?: string | null;
  conference_championship_conference?: string | null;
  conferenceChampionshipConference?: string | null;
  event_key?: string | null;
  eventKey?: string | null;
  slot_order?: number | string | null;
  slotOrder?: number | null;
  neutral_site_display?: NeutralSiteDisplay | string | null;
  neutralSiteDisplay?: NeutralSiteDisplay | string | null;
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
  gamePhase?: GamePhase;
  regularSubtype?: 'standard' | 'conference_championship';
  postseasonSubtype?: PostseasonSubtype | null;
  playoffRound?: PlayoffRound | null;
  bowlName?: string | null;
  conferenceChampionshipConference?: string | null;
  eventKey?: string | null;
  slotOrder?: number | null;
  neutralSiteDisplay?: NeutralSiteDisplay;
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

function normalizedText(game: CfbdScheduleGame): string {
  return [
    game.name,
    game.notes,
    game.venue,
    game.home_team,
    game.away_team,
    game.homeTeam,
    game.awayTeam,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasBowlMarker(text: string): boolean {
  return /\bbowl\b/i.test(text) && !/\bbowl subdivision\b/i.test(text);
}

function hasPlayoffMarker(text: string): boolean {
  return /(college football playoff|\bcfp\b|quarterfinal|semifinal|national championship)/i.test(
    text
  );
}

function hasChampionshipMarker(text: string): boolean {
  return /\bchampionship\b/i.test(text);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractBowlName(game: CfbdScheduleGame): string | null {
  const candidates = [game.name, game.notes, game.venue, game.home_team, game.away_team]
    .map((value) => normalizeString(value))
    .filter(Boolean);

  for (const source of candidates) {
    if (!hasBowlMarker(source)) continue;

    const atTheMatch = source.match(/(?:at|in)\s+(?:the\s+)?([A-Za-z0-9 .&'/-]*\bBowl\b)/i);
    if (atTheMatch?.[1]) return atTheMatch[1].replace(/\s+/g, ' ').trim();

    const match = source.match(/([A-Za-z0-9.&'/-]+(?:\s+[A-Za-z0-9.&'/-]+)*\s+Bowl)\b/i);
    if (match?.[1]) return match[1].replace(/\s+/g, ' ').trim();

    return source;
  }

  return null;
}

function playoffRoundFromText(text: string): PlayoffRound {
  if (/quarterfinal/i.test(text)) return 'quarterfinal';
  if (/semifinal/i.test(text)) return 'semifinal';
  if (/national championship/i.test(text)) return 'national_championship';
  return 'playoff';
}

function playoffEventKey(round: PlayoffRound, bowlName: string | null): string {
  if (round === 'national_championship') return 'national-championship';
  if (bowlName) return `cfp-${round}-${slugify(bowlName)}`;
  return `cfp-${round}`;
}

function deriveEventMetadata(params: {
  game: CfbdScheduleGame;
  seasonType: SeasonType;
  neutralSite: boolean;
  homeConference: string;
  awayConference: string;
}): Pick<
  ScheduleItem,
  | 'gamePhase'
  | 'regularSubtype'
  | 'postseasonSubtype'
  | 'playoffRound'
  | 'bowlName'
  | 'conferenceChampionshipConference'
  | 'eventKey'
  | 'slotOrder'
  | 'neutralSiteDisplay'
> {
  const { game, seasonType, neutralSite, homeConference, awayConference } = params;

  const normalizedGamePhase = normalizeString(game.game_phase ?? game.gamePhase).toLowerCase();
  const normalizedRegularSubtype = normalizeString(
    game.regular_subtype ?? game.regularSubtype
  ).toLowerCase();
  const normalizedPostseasonSubtype = normalizeString(
    game.postseason_subtype ?? game.postseasonSubtype
  ).toLowerCase();
  const normalizedPlayoffRound = normalizeString(
    game.playoff_round ?? game.playoffRound
  ).toLowerCase();
  const normalizedEventKey = normalizeString(game.event_key ?? game.eventKey);
  const normalizedConference = normalizeString(
    game.conference_championship_conference ?? game.conferenceChampionshipConference
  );
  const normalizedBowlName = normalizeString(game.bowl_name ?? game.bowlName);
  const slotOrderRaw = game.slot_order ?? game.slotOrder;
  const normalizedSlotOrder =
    typeof slotOrderRaw === 'number'
      ? slotOrderRaw
      : typeof slotOrderRaw === 'string' && /^\d+$/.test(slotOrderRaw)
        ? Number.parseInt(slotOrderRaw, 10)
        : null;
  const normalizedNeutralDisplay = normalizeString(
    game.neutral_site_display ?? game.neutralSiteDisplay
  ).toLowerCase();

  const hasExplicitConferenceChampionship =
    seasonType === 'regular' &&
    (normalizedGamePhase === 'conference_championship' ||
      normalizedRegularSubtype === 'conference_championship');

  if (hasExplicitConferenceChampionship) {
    const conferenceSlot =
      matchConferenceChampionshipSlotByConference(normalizedConference) ??
      matchConferenceChampionshipSlotByConference(homeConference) ??
      matchConferenceChampionshipSlotByConference(awayConference);
    const conference = normalizedConference || conferenceSlot?.title || null;
    const eventKey =
      normalizedEventKey ||
      (conferenceSlot ? `${conferenceSlot.slug}-championship` : 'conference-championship');

    return {
      gamePhase: 'conference_championship',
      regularSubtype: 'conference_championship',
      postseasonSubtype: null,
      playoffRound: null,
      bowlName: null,
      conferenceChampionshipConference: conference,
      eventKey,
      slotOrder: normalizedSlotOrder ?? 1,
      neutralSiteDisplay:
        normalizedNeutralDisplay === 'home_away'
          ? 'home_away'
          : normalizedNeutralDisplay === 'vs'
            ? 'vs'
            : neutralSite
              ? 'vs'
              : 'home_away',
    };
  }

  if (normalizedGamePhase === 'postseason') {
    const postseasonSubtype: PostseasonSubtype =
      normalizedPostseasonSubtype === 'playoff' ? 'playoff' : 'bowl';
    const round: PlayoffRound | null =
      normalizedPlayoffRound === 'quarterfinal' ||
      normalizedPlayoffRound === 'semifinal' ||
      normalizedPlayoffRound === 'national_championship' ||
      normalizedPlayoffRound === 'playoff'
        ? (normalizedPlayoffRound as PlayoffRound)
        : null;

    return {
      gamePhase: 'postseason',
      regularSubtype: 'standard',
      postseasonSubtype,
      playoffRound: round,
      bowlName: normalizedBowlName || null,
      conferenceChampionshipConference: null,
      eventKey:
        normalizedEventKey ||
        (postseasonSubtype === 'playoff'
          ? playoffEventKey(round ?? 'playoff', normalizedBowlName || null)
          : normalizedBowlName
            ? slugify(normalizedBowlName)
            : null),
      slotOrder: normalizedSlotOrder,
      neutralSiteDisplay:
        normalizedNeutralDisplay === 'home_away'
          ? 'home_away'
          : normalizedNeutralDisplay === 'vs'
            ? 'vs'
            : neutralSite
              ? 'vs'
              : 'home_away',
    };
  }

  const text = normalizedText(game);
  const bowlName = extractBowlName(game);
  const playoff = hasPlayoffMarker(text);
  const championship = hasChampionshipMarker(text);
  const conferenceFromText =
    matchConferenceChampionshipSlotByText(game.name) ??
    matchConferenceChampionshipSlotByText(game.notes);
  const conferenceFromTeams = (() => {
    const home = matchConferenceChampionshipSlotByConference(homeConference);
    const away = matchConferenceChampionshipSlotByConference(awayConference);
    if (home && away) return home.slug === away.slug ? home : null;
    return home ?? away;
  })();
  const conferenceSlot = conferenceFromText ?? conferenceFromTeams;

  const isConferenceChampionship = championship && !playoff && Boolean(conferenceSlot);

  if (isConferenceChampionship) {
    return {
      gamePhase: 'conference_championship',
      regularSubtype: 'conference_championship',
      conferenceChampionshipConference: conferenceSlot?.title ?? null,
      eventKey: conferenceSlot ? `${conferenceSlot.slug}-championship` : 'conference-championship',
      slotOrder: 1,
      neutralSiteDisplay: neutralSite ? 'vs' : 'home_away',
    };
  }

  if (seasonType === 'postseason') {
    const round = playoff ? playoffRoundFromText(text) : null;
    const postseasonSubtype: PostseasonSubtype = playoff ? 'playoff' : 'bowl';
    const eventKey = playoff
      ? playoffEventKey(round ?? 'playoff', bowlName)
      : bowlName
        ? slugify(bowlName)
        : `postseason-${slugify(text || 'game')}`;

    return {
      gamePhase: 'postseason',
      regularSubtype: 'standard',
      postseasonSubtype,
      playoffRound: round,
      bowlName,
      conferenceChampionshipConference: null,
      eventKey,
      slotOrder: null,
      neutralSiteDisplay: neutralSite ? 'vs' : 'home_away',
    };
  }

  return {
    gamePhase: 'regular',
    regularSubtype: 'standard',
    postseasonSubtype: null,
    playoffRound: null,
    bowlName: null,
    conferenceChampionshipConference: null,
    eventKey: null,
    slotOrder: null,
    neutralSiteDisplay: neutralSite ? 'vs' : 'home_away',
  };
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

  const neutralSite = Boolean(game.neutral_site ?? game.neutralSite);
  const homeConference = normalizeString(game.home_conference ?? game.homeConference);
  const awayConference = normalizeString(game.away_conference ?? game.awayConference);
  const eventMetadata = deriveEventMetadata({
    game,
    seasonType,
    neutralSite,
    homeConference,
    awayConference,
  });

  return {
    ok: true,
    item: {
      id: String(game.id ?? `${week}-${homeTeam}-${awayTeam}`),
      week,
      startDate: game.start_date ?? game.startDate ?? null,
      neutralSite,
      conferenceGame: Boolean(game.conference_game ?? game.conferenceGame),
      homeTeam,
      awayTeam,
      homeConference,
      awayConference,
      status: normalizeString(game.status) || 'scheduled',
      venue: normalizeString(game.venue) || null,
      label: normalizeString(game.name) || null,
      notes: normalizeString(game.notes) || null,
      seasonType,
      ...eventMetadata,
    },
  };
}
