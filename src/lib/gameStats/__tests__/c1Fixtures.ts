/**
 * PLATFORM-086H3C1 shared test fixtures. Fictional identities only.
 *
 * Two fixture families:
 *   - schedule inputs (`C1_TEAMS`, `scheduleItem`) drive the REAL
 *     `buildScheduleFromApi` path in canonical-slate tests;
 *   - durable-row + canonical-game builders let the evidence/coverage/projection
 *     tests target exact states without an I/O slate. Durable v2 rows are built
 *     through the real `buildV2GameStats` so their shape matches production.
 */

import type { CfbdSeasonType } from '../../cfbd.ts';
import type { ScheduleWireItem } from '../../schedule.ts';
import { toTeamIdentityKey, type TeamCatalogItem } from '../../teamIdentity.ts';
import {
  buildV2GameStats,
  type ParsedV2Observation,
  type ParsedV2TeamObservation,
} from '../contract.ts';
import type {
  CanonicalGame,
  CanonicalGameApplicability,
  CanonicalGameNotExpectedReason,
  CanonicalSlate,
} from '../canonicalSlate.ts';
import type { GameStats, WeeklyGameStats } from '../types.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

// FBS conferences classify as FBS, FCS conferences as FCS (present-day policy),
// matching each team's explicit `level` — so eligibility never surprises a test.
export const C1_TEAMS: TeamCatalogItem[] = [
  { school: 'Alpha State', level: 'FBS', conference: 'Sun Belt' },
  { school: 'Beta Tech', level: 'FBS', conference: 'ACC' },
  { school: 'Gamma A&M', level: 'FBS', conference: 'SEC' },
  { school: 'Delta University', level: 'FBS', conference: 'Big Ten' },
  { school: 'Epsilon College', level: 'FCS', conference: 'Big Sky' },
  { school: 'Zeta State', level: 'FCS', conference: 'Missouri Valley' },
];

/**
 * Identity keys the shared resolver assigns to each fixture school — computed
 * through the SAME `teamIdentity.ts` normalization the resolver uses, so tests
 * never hand-guess a key.
 */
export const IDENTITY_KEYS: Record<string, string> = Object.fromEntries(
  C1_TEAMS.map((team) => [team.school, toTeamIdentityKey(team.school)])
);

const CONFERENCE_OF: Record<string, string> = {
  'Alpha State': 'Sun Belt',
  'Beta Tech': 'ACC',
  'Gamma A&M': 'SEC',
  'Delta University': 'Big Ten',
  'Epsilon College': 'Big Sky',
  'Zeta State': 'Missouri Valley',
};

export function scheduleItem(params: {
  id: string;
  week: number;
  home: string;
  away: string;
  homeConf?: string;
  awayConf?: string;
  startDate?: string | null;
  status?: string;
  neutral?: boolean;
  seasonType?: 'regular' | 'postseason';
  gamePhase?: string;
  postseasonSubtype?: string;
  playoffRound?: string;
  eventKey?: string;
}): ScheduleWireItem {
  return {
    id: params.id,
    week: params.week,
    startDate: params.startDate === undefined ? '2025-09-06T16:00:00Z' : params.startDate,
    neutralSite: params.neutral ?? false,
    conferenceGame: false,
    homeTeam: params.home,
    awayTeam: params.away,
    homeConference: params.homeConf ?? CONFERENCE_OF[params.home] ?? 'Sun Belt',
    awayConference: params.awayConf ?? CONFERENCE_OF[params.away] ?? 'ACC',
    status: params.status ?? 'scheduled',
    seasonType: params.seasonType ?? 'regular',
    ...(params.gamePhase ? { gamePhase: params.gamePhase } : {}),
    ...(params.postseasonSubtype ? { postseasonSubtype: params.postseasonSubtype } : {}),
    ...(params.playoffRound ? { playoffRound: params.playoffRound } : {}),
    ...(params.eventKey ? { eventKey: params.eventKey } : {}),
  };
}

/** A canonical game, built directly (no slate) for evidence/coverage tests. */
export function canonicalGame(params: {
  providerGameId: number;
  home: string;
  away: string;
  neutral?: boolean;
  week?: number;
  seasonType?: CfbdSeasonType;
  applicability?: CanonicalGameApplicability;
  notExpectedReason?: CanonicalGameNotExpectedReason;
}): CanonicalGame {
  const homeKey = IDENTITY_KEYS[params.home] ?? params.home;
  const awayKey = IDENTITY_KEYS[params.away] ?? params.away;
  return {
    providerGameId: params.providerGameId,
    eventId: `evt-${params.providerGameId}`,
    providerWeek: params.week ?? 3,
    seasonType: params.seasonType ?? 'regular',
    neutral: params.neutral ?? false,
    applicability: params.applicability ?? 'expected',
    notExpectedReason: params.notExpectedReason ?? null,
    home: { identityKey: homeKey, canonicalName: params.home },
    away: { identityKey: awayKey, canonicalName: params.away },
    kickoff: '2025-09-06T16:00:00Z',
    rawStatus: 'final',
  };
}

/** Assemble a slate directly from canonical games. */
export function slateOf(games: CanonicalGame[], year = 2025): CanonicalSlate {
  return { year, games };
}

/** A committed weekly durable record envelope for the given partition. */
export function weeklyRecord(
  week: number,
  seasonType: CfbdSeasonType,
  games: GameStats[],
  year = 2025
): WeeklyGameStats {
  return { year, week, seasonType, fetchedAt: '2025-09-08T00:00:00.000Z', games };
}

const COMPLETE_RAW: Record<string, string> = {
  totalYards: '412',
  rushingYards: '187',
  netPassingYards: '225',
  turnovers: '1',
  thirdDownEff: '6-14',
  possessionTime: '31:24',
};

function teamObservation(
  side: 'home' | 'away',
  school: string,
  schoolId: number,
  raw: Record<string, string>,
  points: number | null
): ParsedV2TeamObservation {
  return {
    school,
    schoolId,
    conference: CONFERENCE_OF[school] ?? 'Conf',
    homeAway: side,
    pointsProvided: points !== null,
    points,
    raw,
  };
}

type V2SideSpec = {
  school: string;
  schoolId: number;
  raw?: Record<string, string>;
  points?: number | null;
};

/** A real, complete v2 durable row (schemaVersion 2) with a strict fence. */
export function v2Row(params: {
  id: number;
  home: V2SideSpec;
  away: V2SideSpec;
  week?: number;
  seasonType?: CfbdSeasonType;
  fetchStartedAt?: string | null;
}): GameStats {
  const observation: ParsedV2Observation = {
    providerGameId: params.id,
    home: teamObservation(
      'home',
      params.home.school,
      params.home.schoolId,
      params.home.raw ?? COMPLETE_RAW,
      params.home.points === undefined ? 31 : params.home.points
    ),
    away: teamObservation(
      'away',
      params.away.school,
      params.away.schoolId,
      params.away.raw ?? COMPLETE_RAW,
      params.away.points === undefined ? 17 : params.away.points
    ),
  };
  const row = buildV2GameStats(observation, params.week ?? 3, params.seasonType ?? 'regular');
  const fetchStartedAt =
    params.fetchStartedAt === undefined ? '2025-09-07T02:00:00Z' : params.fetchStartedAt;
  return fetchStartedAt === null ? row : { ...row, fetchStartedAt };
}

/** A complete, analytics-compatible legacy row with the given identities/partition. */
export function legacyRow(params: {
  id: number;
  home: { school: string; teamId: number };
  away: { school: string; teamId: number };
  week?: number;
}): GameStats {
  return legacyRowFromWire(
    wireGame({
      id: params.id,
      home: { school: params.home.school, teamId: params.home.teamId },
      away: { school: params.away.school, teamId: params.away.teamId },
    }),
    params.week ?? 3
  );
}
