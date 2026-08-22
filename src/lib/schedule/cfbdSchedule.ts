import {
  matchConferenceChampionshipSlotByConference,
  matchConferenceChampionshipSlotByText,
} from '../conferenceChampionships.ts';

export type SeasonType = 'regular' | 'postseason';

type GamePhase = 'regular' | 'conference_championship' | 'postseason';
type PostseasonSubtype = 'bowl' | 'playoff';
type PlayoffRound =
  | 'first-round'
  | 'quarterfinal'
  | 'semifinal'
  | 'national_championship'
  | 'playoff';
type NeutralSiteDisplay = 'vs' | 'home_away';

/**
 * Provenance of a postseason row's `playoffRound` (PLATFORM-086E1A). This is the
 * gate the season-rollover authority reads: ONLY `cfbd-structured` — a structured
 * CFBD playoff competition PLUS structured round — is authoritative enough to
 * drive automatic season rollover. `explicit-provider-field` (a flat provider
 * round field with no structured competition context) and `text-inferred` (round
 * inferred from name/notes) may still inform presentation/diagnostics but must
 * NEVER authorize rollover.
 */
export type PlayoffRoundSource = 'cfbd-structured' | 'explicit-provider-field' | 'text-inferred';

export type VenueInfo = {
  stadium: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
};

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
  /** Score fields ride on CFBD's `/games` schedule rows but are not persisted on ScheduleItem. */
  home_points?: number | null;
  away_points?: number | null;
  homePoints?: number | null;
  awayPoints?: number | null;
  home_score?: number | null;
  away_score?: number | null;
  home_id?: number | string | null;
  homeId?: number | string | null;
  away_id?: number | string | null;
  awayId?: number | string | null;
  home_conference?: string | null;
  away_conference?: string | null;
  homeConference?: string | null;
  awayConference?: string | null;
  home_classification?: string | null;
  homeClassification?: string | null;
  away_classification?: string | null;
  awayClassification?: string | null;
  status?: string | null;
  completed?: boolean | null;
  start_time_tbd?: boolean | null;
  startTimeTBD?: boolean | null;
  venue?: string | null;
  venue_id?: number | string | null;
  venueId?: number | string | null;
  venue_city?: string | null;
  venueCity?: string | null;
  venue_state?: string | null;
  venueState?: string | null;
  venue_country?: string | null;
  venueCountry?: string | null;
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
  playoff_competition?: string | null;
  playoffCompetition?: string | null;
  /**
   * CFBD's structured playoff object (PLATFORM-086E1A). We extract ONLY the
   * `competition`/`round` scalars from it and NEVER persist the object itself.
   * A competition + round sourced from here marks the row `cfbd-structured` — the
   * only provenance the rollover authority trusts.
   */
  playoff?: { competition?: string | null; round?: string | null } | null;
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
  /**
   * CFBD numeric participant ids, normalized to a positive safe integer or
   * explicit `null` when the provider omitted or supplied an invalid value.
   * Participant METADATA only — canonical team identity remains the
   * resolver-produced string identity (`teamIdentity.ts`); these ids never
   * drive name matching, and an invalid id never drops the schedule row.
   */
  homeId: number | null;
  awayId: number | null;
  homeConference: string;
  awayConference: string;
  status: string;
  /**
   * CFBD `completed` flag (PLATFORM-086E1A). Retained provider metadata only —
   * canonical finality for rollover/standings is still derived from the SCORE
   * cache via the centralized status classifier, never from this flag.
   */
  completed?: boolean;
  /** CFBD `start_time_tbd` flag (PLATFORM-086E1A) — presentation metadata only. */
  startTimeTBD?: boolean;
  venue?: VenueInfo | string | null;
  /** CFBD numeric venue id (PLATFORM-086E1A) — positive safe integer, else omitted. */
  venueId?: number;
  label?: string | null;
  notes?: string | null;
  seasonType?: SeasonType;
  gamePhase?: GamePhase;
  regularSubtype?: 'standard' | 'conference_championship';
  postseasonSubtype?: PostseasonSubtype | null;
  playoffRound?: PlayoffRound | null;
  /**
   * Structured CFBD playoff competition string (PLATFORM-086E1A), e.g. the CFP.
   * Populated only when the provider supplies a structured competition; the raw
   * provider `playoff` object is never persisted.
   */
  playoffCompetition?: string;
  /** How `playoffRound` was determined (PLATFORM-086E1A) — gates rollover. */
  playoffRoundSource?: PlayoffRoundSource;
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

function extractVenueInfo(game: CfbdScheduleGame): VenueInfo | string | null {
  const stadium = normalizeString(game.venue) || null;
  const city = normalizeString(game.venue_city ?? game.venueCity) || null;
  const state = normalizeString(game.venue_state ?? game.venueState) || null;
  const country = normalizeString(game.venue_country ?? game.venueCountry) || null;

  if (!stadium && !city && !state && !country) return null;
  if (!city && !state && !country) return stadium;

  return { stadium, city, state, country };
}

/**
 * Normalize a CFBD numeric participant id to a positive safe integer, or `null`.
 * Strict grammar: a positive safe-integer number, or a canonical decimal-digit
 * string collapsing to one. Zero, negatives, fractions, exponent/hex/signed
 * forms (`1e3`, `0x10`, `+16`, `12.5`), unsafe integers, blank strings, and
 * every other coercive JavaScript numeric form normalize to `null` — a missing
 * or invalid participant id never drops an otherwise valid schedule row.
 */
function normalizeParticipantId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Normalize a CFBD boolean flag (`completed`, `start_time_tbd`) to an explicit
 * boolean, or `undefined` when the provider omitted it or supplied a non-boolean.
 * A missing flag is left off the persisted item (never coerced to `false`), so a
 * consumer can distinguish "provider said false" from "provider did not say".
 */
function normalizeBooleanFlag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Normalize a CFBD venue id to a positive safe integer, or `undefined`. Same
 * strict grammar as {@link normalizeParticipantId} — zero/negatives/fractions/
 * non-decimal-string forms are rejected — but returns `undefined` (omit) rather
 * than `null`, matching the optional `venueId?` field.
 */
function normalizeVenueId(value: unknown): number | undefined {
  const normalized = normalizeParticipantId(value);
  return normalized ?? undefined;
}

function normalizeWeek(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    return Number.parseInt(trimmed, 10);
  }
  return null;
}

export function deriveScheduleWeeks(items: Array<Pick<ScheduleItem, 'week'>>): number[] {
  return Array.from(
    new Set(
      items
        .map((item) => item.week)
        .filter((week): week is number => Number.isInteger(week) && week >= 0)
    )
  ).sort((a, b) => a - b);
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

/**
 * CFBD classification values that are EXPLICIT negative evidence for CFP
 * inference. CFBD currently emits `fbs`, `fcs`, `ii`, and `iii`.
 */
const NON_FBS_CLASSIFICATIONS: ReadonlySet<string> = new Set(['fcs', 'ii', 'iii']);

/**
 * Whether the provider EXPLICITLY classifies either participant below FBS.
 * Generic postseason wording ("semifinal", "championship", …) also appears on
 * FCS / Division II / Division III championship rows — the 2024 partition
 * carried FCS and D-III semifinals whose notes minted the SHARED `cfp-semifinal`
 * event key, collapsing four unrelated games into one canonical postseason slot
 * and producing a hybrid record (one row's participants under another row's
 * provider id). An explicit non-FBS classification therefore suppresses
 * text-based CFP inference; MISSING classification metadata keeps the existing
 * text fallback, and explicit FBS CFP rows are unaffected.
 */
function hasExplicitNonFbsParticipant(game: CfbdScheduleGame): boolean {
  const home = normalizeString(game.home_classification ?? game.homeClassification).toLowerCase();
  const away = normalizeString(game.away_classification ?? game.awayClassification).toLowerCase();
  return NON_FBS_CLASSIFICATIONS.has(home) || NON_FBS_CLASSIFICATIONS.has(away);
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
  if (/first.?round/i.test(text)) return 'first-round';
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

/**
 * Parse a provider-supplied playoff round label (nested structured object OR flat
 * field) into a canonical `PlayoffRound`, or null. Accepts CFBD's spaced
 * "National Championship" alongside the hyphenated/underscored forms.
 */
function parseProviderPlayoffRound(raw: string): PlayoffRound | null {
  const t = raw.trim().toLowerCase();
  if (t === 'first-round' || t === 'first round') return 'first-round';
  if (t === 'national_championship' || t === 'national championship')
    return 'national_championship';
  if (t === 'quarterfinal' || t === 'semifinal' || t === 'playoff') return t as PlayoffRound;
  return null;
}

type PlayoffProvenance = {
  round: PlayoffRound | null;
  /** Structured/flat competition string, or '' when none. */
  competition: string;
  source: PlayoffRoundSource | undefined;
  /** True when the round came from an explicit provider field (nested or flat), not text. */
  fromProviderField: boolean;
};

/**
 * Resolve a postseason row's playoff round, competition, and PROVENANCE from the
 * strongest available evidence (PLATFORM-086E1A findings 1 & 2). This is the single
 * gate the season-rollover authority trusts, applied identically whether or not the
 * row carried `game_phase: 'postseason'`:
 *   - `cfbd-structured` ONLY when the round AND the competition BOTH come from CFBD's
 *     nested structured `playoff` object — the strongest signal;
 *   - `explicit-provider-field` for any explicit provider round that is not fully
 *     structured (a nested round without a structured competition, a flat round, or
 *     a nested/flat mix) — never authoritative for rollover;
 *   - `text-inferred` for a round guessed from name/notes text (suppressed for
 *     explicit non-FBS rows so FCS/D-II/D-III wording can never mint a CFP identity).
 * The raw `playoff` object is read here for its scalars only and never persisted.
 */
function derivePlayoffProvenance(params: {
  game: CfbdScheduleGame;
  text: string;
  explicitNonFbs: boolean;
}): PlayoffProvenance {
  const { game, text, explicitNonFbs } = params;
  const structuredPlayoff =
    game.playoff && typeof game.playoff === 'object' && !Array.isArray(game.playoff)
      ? game.playoff
      : null;
  const structuredRound = parseProviderPlayoffRound(normalizeString(structuredPlayoff?.round));
  const flatRound = parseProviderPlayoffRound(
    normalizeString(game.playoff_round ?? game.playoffRound)
  );
  const structuredCompetition = normalizeString(structuredPlayoff?.competition);
  const flatCompetition = normalizeString(game.playoff_competition ?? game.playoffCompetition);
  const competition = structuredCompetition || flatCompetition;

  // cfbd-structured: the round AND competition BOTH come from the nested object.
  if (structuredRound != null && structuredCompetition) {
    return {
      round: structuredRound,
      competition,
      source: 'cfbd-structured',
      fromProviderField: true,
    };
  }
  // explicit-provider-field: any explicit provider round that is not fully structured.
  const explicitRound = structuredRound ?? flatRound;
  if (explicitRound != null) {
    return {
      round: explicitRound,
      competition,
      source: 'explicit-provider-field',
      fromProviderField: true,
    };
  }
  // text-inferred: round guessed from text (non-FBS rows suppress inference).
  const roundFromText =
    !explicitNonFbs && hasPlayoffMarker(text) ? playoffRoundFromText(text) : null;
  return {
    round: roundFromText,
    competition,
    source: roundFromText != null ? 'text-inferred' : undefined,
    fromProviderField: false,
  };
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
  | 'playoffCompetition'
  | 'playoffRoundSource'
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
  // Playoff round/competition/provenance are resolved by `derivePlayoffProvenance`
  // (PLATFORM-086E1A) so nested-structured, flat, and text evidence are classified
  // identically in both postseason branches below.
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
    const text = normalizedText(game);
    const bowlName = normalizedBowlName || extractBowlName(game);
    // Explicit non-FBS participants suppress TEXT-based CFP inference — the
    // wording of FCS/D-II/D-III championship rows must never mint a shared
    // `cfp-*` identity. Explicitly supplied normalized metadata (subtype,
    // round, event key) is preserved as-is.
    const explicitNonFbs = hasExplicitNonFbsParticipant(game);
    const playoffFromText = !explicitNonFbs && hasPlayoffMarker(text);
    const provenance = derivePlayoffProvenance({ game, text, explicitNonFbs });
    const round = provenance.round;
    // Subtype precedence: an explicit provider subtype wins; otherwise an explicit
    // provider playoff round OR a text-playoff marker makes it a playoff.
    const postseasonSubtype: PostseasonSubtype =
      normalizedPostseasonSubtype === 'playoff'
        ? 'playoff'
        : normalizedPostseasonSubtype === 'bowl'
          ? 'bowl'
          : provenance.fromProviderField || playoffFromText
            ? 'playoff'
            : 'bowl';

    return {
      gamePhase: 'postseason',
      regularSubtype: 'standard',
      postseasonSubtype,
      playoffRound: round,
      ...(provenance.competition ? { playoffCompetition: provenance.competition } : {}),
      ...(provenance.source ? { playoffRoundSource: provenance.source } : {}),
      bowlName,
      conferenceChampionshipConference: null,
      eventKey:
        normalizedEventKey ||
        (postseasonSubtype === 'playoff' && !explicitNonFbs
          ? playoffEventKey(round ?? 'playoff', bowlName)
          : bowlName
            ? slugify(bowlName)
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
  // Same guard as the normalized-postseason branch above: explicit non-FBS
  // participants keep generic wording from inferring CFP identity here or in
  // the `seasonType === 'postseason'` fallback below.
  const explicitNonFbs = hasExplicitNonFbsParticipant(game);
  const playoff = !explicitNonFbs && hasPlayoffMarker(text);
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

  // Explicit non-FBS negative evidence suppresses FBS conference-championship
  // inference exactly as it suppresses CFP inference above: a row CFBD
  // explicitly classifies FCS / Division II / Division III can never acquire
  // an inferred FBS conference-championship identity from generic wording
  // (PLATFORM-086H3E4 — the "FCS Championship - Second Round" row must not
  // become `sec-championship`). Genuine FBS conference championships have no
  // non-FBS participant, and missing classification metadata keeps the
  // existing text fallback.
  const isConferenceChampionship =
    championship && !playoff && Boolean(conferenceSlot) && !explicitNonFbs;

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
    // Use the SAME provenance derivation as the `game_phase: 'postseason'` branch
    // (PLATFORM-086E1A finding 1): a structured CFBD `playoff` object authorizes
    // rollover even for a postseason row that omitted `game_phase`. A text-only
    // round stays `text-inferred`.
    const provenance = derivePlayoffProvenance({ game, text, explicitNonFbs });
    const round = provenance.round;
    const postseasonSubtype: PostseasonSubtype = round != null ? 'playoff' : 'bowl';
    // Mirror the `game_phase: 'postseason'` branch's `!explicitNonFbs` guard around
    // `playoffEventKey` (PLATFORM-086E1A cycle-2 fix): an explicitly non-FBS row must
    // NEVER mint a shared `cfp-*` event key — even from an explicit provider round —
    // or FCS/D-II/D-III games collide with FBS CFP identities (the PLATFORM-086H3E4
    // collision class). Round/provenance metadata is still retained for diagnostics;
    // only the identity-bearing event key is guarded.
    const eventKey =
      round != null && !explicitNonFbs
        ? playoffEventKey(round, bowlName)
        : bowlName
          ? slugify(bowlName)
          : `postseason-${slugify(text || 'game')}`;

    return {
      gamePhase: 'postseason',
      regularSubtype: 'standard',
      postseasonSubtype,
      playoffRound: round,
      ...(provenance.competition ? { playoffCompetition: provenance.competition } : {}),
      ...(provenance.source ? { playoffRoundSource: provenance.source } : {}),
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

  // Retained provider scalars (PLATFORM-086E1A). Each is included ONLY when the
  // provider supplied a usable value, so an absent flag stays absent rather than
  // being coerced to a default that a consumer could misread as authoritative.
  const completed = normalizeBooleanFlag(game.completed);
  const startTimeTBD = normalizeBooleanFlag(game.start_time_tbd ?? game.startTimeTBD);
  const venueId = normalizeVenueId(game.venue_id ?? game.venueId);

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
      homeId: normalizeParticipantId(game.home_id ?? game.homeId),
      awayId: normalizeParticipantId(game.away_id ?? game.awayId),
      homeConference,
      awayConference,
      status: normalizeString(game.status) || 'scheduled',
      ...(completed !== undefined ? { completed } : {}),
      ...(startTimeTBD !== undefined ? { startTimeTBD } : {}),
      venue: extractVenueInfo(game),
      ...(venueId !== undefined ? { venueId } : {}),
      label: normalizeString(game.name) || null,
      notes: normalizeString(game.notes) || null,
      seasonType,
      ...eventMetadata,
    },
  };
}
