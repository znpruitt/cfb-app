import type { CfbdSeasonType } from '../cfbd.ts';
import type { RawGameTeamStats, RawGameTeamStatsTeam, TeamGameStats, GameStats } from './types.ts';

/** parseInt that reports malformation as null instead of a fallback zero. */
function parseIntOrNull(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeInt(value: string | undefined | null): number {
  return parseIntOrNull(value) ?? 0;
}

/**
 * Parse a fraction string like "6-14" into [numerator, denominator].
 * Returns null if malformed (the normalizer falls back to [0, 0]).
 */
function parseFractionOrNull(value: string | undefined | null): [number, number] | null {
  if (!value) return null;
  const parts = value.split('-');
  if (parts.length !== 2) return null;
  const num = parseInt(parts[0], 10);
  const den = parseInt(parts[1], 10);
  if (!Number.isFinite(num) || !Number.isFinite(den)) return null;
  return [num, den];
}

/**
 * Parse "MM:SS" possession time to total seconds.
 * Returns null if malformed (the normalizer falls back to 0).
 */
function parsePossessionTimeOrNull(value: string | undefined | null): number | null {
  if (!value) return null;
  const parts = value.split(':');
  if (parts.length !== 2) return null;
  const minutes = parseInt(parts[0], 10);
  const seconds = parseInt(parts[1], 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return minutes * 60 + seconds;
}

const FRACTION_CATEGORIES = new Set(['thirdDownEff', 'fourthDownEff', 'totalPenaltiesYards']);

/**
 * Whether a provider-supplied category VALUE parses successfully under the SAME
 * parsers the normalizer uses (adversarial-review remediation) — presence alone
 * proves nothing, because every malformed value normalizes to a fallback zero
 * indistinguishable from real data. An explicit valid zero ("0", "0-0", "0:00")
 * parses and counts; `not-a-number` does not. One parsing system: these checks
 * delegate to the exact OrNull parsers `normalizeTeam` consumes.
 */
export function isParseValidCategoryValue(
  category: string,
  value: string | undefined | null
): boolean {
  if (typeof value !== 'string') return false;
  if (FRACTION_CATEGORIES.has(category)) return parseFractionOrNull(value) !== null;
  if (category === 'possessionTime') return parsePossessionTimeOrNull(value) !== null;
  return parseIntOrNull(value) !== null;
}

/**
 * The provider stat categories `normalizeTeam` actually consumes — THE
 * canonical recognized-category contract (review remediation). Stat AUTHORITY
 * derives from this list: `statMap` copies every wire category into `raw`
 * unfiltered (unknown/renamed categories stay visible for debugging), but only
 * these keys produce normalized values, so only these keys may establish
 * authority — otherwise a schema-drifted payload of unrecognized categories
 * would count as real data while every normalized metric is a fabricated zero.
 * Kept HERE, next to the consumption site, with a contract test locking the
 * list, so validation and normalization cannot drift.
 */
export const RECOGNIZED_STAT_CATEGORIES: readonly string[] = [
  'firstDowns',
  'fourthDownEff',
  'fumblesLost',
  'fumblesRecovered',
  'interceptionTDs',
  'interceptionYards',
  'interceptions',
  'kickReturnTDs',
  'kickReturnYards',
  'netPassingYards',
  'passAttempts',
  'passCompletions',
  'passesIntercepted',
  'passingTDs',
  'possessionTime',
  'puntReturnTDs',
  'puntReturnYards',
  'rushingAttempts',
  'rushingTDs',
  'rushingYards',
  'thirdDownEff',
  'totalPenaltiesYards',
  'totalYards',
  'turnovers',
] as const;

/**
 * The raw-backed categories owner-stat aggregation actually CONSUMES
 * (`addTeamStats` reads the normalized fields these produce: totalYards,
 * rushingYards, passingYards←netPassingYards, turnovers, thirdDown*←
 * thirdDownEff, possessionSeconds←possessionTime). COMPLETE stat coverage —
 * the bar for a game to count as covered, for cache availability, and for
 * analytics eligibility — requires ALL of these structurally present on BOTH
 * teams; a sparse row missing any of them is stored (real partial data) but
 * stays recovery-eligible and analytics-ineligible, because its omitted
 * metrics would otherwise aggregate as fabricated zeros. `points` is a
 * structural wire field (not raw-backed), so its presence cannot be gated
 * here — documented limitation. Kept next to `RECOGNIZED_STAT_CATEGORIES`
 * with a contract test so it cannot drift from the aggregation code.
 */
export const ANALYTICS_REQUIRED_CATEGORIES: readonly string[] = [
  'netPassingYards',
  'possessionTime',
  'rushingYards',
  'thirdDownEff',
  'totalYards',
  'turnovers',
] as const;

function statMap(team: RawGameTeamStatsTeam): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of team.stats ?? []) {
    if (entry.category && typeof entry.stat === 'string') {
      map[entry.category] = entry.stat;
    }
  }
  return map;
}

/**
 * Build a normalized team row from its provider RAW category map plus identity
 * and points metadata — THE single normalization path (adversarial-review
 * remediation): `normalizeTeam` wraps it for wire rows, and the field-level
 * merge rebuilds merged rows through it, so normalized values always derive
 * from raw provider fields via one parser set (never from normalized fallback
 * zeros used as inputs).
 */
export function buildTeamStats(params: {
  school: string;
  schoolId: number;
  conference: string;
  homeAway: 'home' | 'away';
  points: number;
  pointsProvided: boolean;
  raw: Record<string, string>;
}): TeamGameStats {
  const { raw } = params;
  const [thirdDownConversions, thirdDownAttempts] = parseFractionOrNull(raw.thirdDownEff) ?? [0, 0];
  const [fourthDownConversions, fourthDownAttempts] = parseFractionOrNull(raw.fourthDownEff) ?? [
    0, 0,
  ];
  const [penaltyCount, penaltyYards] = parseFractionOrNull(raw.totalPenaltiesYards) ?? [0, 0];

  return {
    school: params.school,
    schoolId: params.schoolId,
    conference: params.conference,
    homeAway: params.homeAway,
    points: params.points,
    pointsProvided: params.pointsProvided,
    totalYards: safeInt(raw.totalYards),
    rushingYards: safeInt(raw.rushingYards),
    passingYards: safeInt(raw.netPassingYards),
    rushingAttempts: safeInt(raw.rushingAttempts),
    passingAttempts: safeInt(raw.passAttempts),
    passingCompletions: safeInt(raw.passCompletions),
    rushingTDs: safeInt(raw.rushingTDs),
    passingTDs: safeInt(raw.passingTDs),
    firstDowns: safeInt(raw.firstDowns),
    turnovers: safeInt(raw.turnovers),
    fumblesLost: safeInt(raw.fumblesLost),
    interceptionsThrown: safeInt(raw.interceptions),
    passesIntercepted: safeInt(raw.passesIntercepted),
    fumblesRecovered: safeInt(raw.fumblesRecovered),
    thirdDownAttempts,
    thirdDownConversions,
    thirdDownPct: thirdDownAttempts > 0 ? thirdDownConversions / thirdDownAttempts : 0,
    fourthDownAttempts,
    fourthDownConversions,
    penaltyCount,
    penaltyYards,
    possessionSeconds: parsePossessionTimeOrNull(raw.possessionTime) ?? 0,
    interceptionReturnYards: safeInt(raw.interceptionYards),
    interceptionReturnTDs: safeInt(raw.interceptionTDs),
    kickReturnYards: safeInt(raw.kickReturnYards),
    kickReturnTDs: safeInt(raw.kickReturnTDs),
    puntReturnYards: safeInt(raw.puntReturnYards),
    puntReturnTDs: safeInt(raw.puntReturnTDs),
    raw,
  };
}

function normalizeTeam(team: RawGameTeamStatsTeam): TeamGameStats {
  const pointsProvided = typeof team.points === 'number' && Number.isFinite(team.points);
  return buildTeamStats({
    school: team.team ?? '',
    schoolId: team.teamId ?? 0,
    conference: team.conference ?? '',
    homeAway: team.homeAway === 'away' ? 'away' : 'home',
    points: pointsProvided ? (team.points as number) : 0,
    pointsProvided,
    raw: statMap(team),
  });
}

export function normalizeGameTeamStats(
  rawGames: RawGameTeamStats[],
  week: number,
  seasonType: CfbdSeasonType
): GameStats[] {
  const results: GameStats[] = [];

  for (const rawGame of rawGames) {
    if (!rawGame.id || !Array.isArray(rawGame.teams) || rawGame.teams.length < 2) continue;

    const homeRaw = rawGame.teams.find((t) => t.homeAway === 'home');
    const awayRaw = rawGame.teams.find((t) => t.homeAway === 'away');
    if (!homeRaw || !awayRaw) continue;

    results.push({
      providerGameId: rawGame.id,
      week,
      seasonType,
      home: normalizeTeam(homeRaw),
      away: normalizeTeam(awayRaw),
    });
  }

  return results;
}
