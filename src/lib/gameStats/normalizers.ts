import type { CfbdSeasonType } from '../cfbd.ts';
import type { RawGameTeamStats, RawGameTeamStatsTeam, TeamGameStats, GameStats } from './types.ts';

function safeInt(value: string | undefined | null): number {
  if (!value) return 0;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parse a fraction string like "6-14" into [numerator, denominator].
 * Returns [0, 0] if malformed.
 */
function parseFraction(value: string | undefined | null): [number, number] {
  if (!value) return [0, 0];
  const parts = value.split('-');
  if (parts.length !== 2) return [0, 0];
  const num = parseInt(parts[0], 10);
  const den = parseInt(parts[1], 10);
  return [Number.isFinite(num) ? num : 0, Number.isFinite(den) ? den : 0];
}

/**
 * Parse "MM:SS" possession time to total seconds.
 * Returns 0 if malformed.
 */
function parsePossessionTime(value: string | undefined | null): number {
  if (!value) return 0;
  const parts = value.split(':');
  if (parts.length !== 2) return 0;
  const minutes = parseInt(parts[0], 10);
  const seconds = parseInt(parts[1], 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0;
  return minutes * 60 + seconds;
}

function statMap(team: RawGameTeamStatsTeam): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of team.stats ?? []) {
    if (entry.category && typeof entry.stat === 'string') {
      map[entry.category] = entry.stat;
    }
  }
  return map;
}

function normalizeTeam(team: RawGameTeamStatsTeam): TeamGameStats {
  const raw = statMap(team);
  const [thirdDownConversions, thirdDownAttempts] = parseFraction(raw.thirdDownEff);
  const [fourthDownConversions, fourthDownAttempts] = parseFraction(raw.fourthDownEff);
  const [penaltyCount, penaltyYards] = parseFraction(raw.totalPenaltiesYards);

  return {
    school: team.team ?? '',
    schoolId: team.teamId ?? 0,
    conference: team.conference ?? '',
    homeAway: team.homeAway === 'away' ? 'away' : 'home',
    points: typeof team.points === 'number' ? team.points : 0,
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
    possessionSeconds: parsePossessionTime(raw.possessionTime),
    interceptionReturnYards: safeInt(raw.interceptionYards),
    interceptionReturnTDs: safeInt(raw.interceptionTDs),
    kickReturnYards: safeInt(raw.kickReturnYards),
    kickReturnTDs: safeInt(raw.kickReturnTDs),
    puntReturnYards: safeInt(raw.puntReturnYards),
    puntReturnTDs: safeInt(raw.puntReturnTDs),
    raw,
  };
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
