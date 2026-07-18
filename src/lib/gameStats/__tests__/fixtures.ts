/**
 * PLATFORM-086H1 sanitized, inventory-grounded game-stats fixtures.
 *
 * Every fixture is marked with its provenance relative to the 2021–2025 durable
 * inventory (PLATFORM-086H1-LEGACY-DURABLE-DATA-INVENTORY-AUDIT-v1):
 *   - observed: the structure AND value shapes were seen in production data
 *     (identities are fictional — no production team/owner names appear here);
 *   - synthesized: structurally derived from an observed class, values invented;
 *   - hypothetical: a defensive class with ZERO production instances.
 *
 * Legacy rows are built through the REAL legacy writer path
 * (`normalizeGameTeamStats`) so their stored normalized fields are exactly what
 * production wrote for the same wire payload — the parity tests depend on that.
 */

import { normalizeGameTeamStats } from '../normalizers.ts';
import { setAppState } from '../../server/appStateStore.ts';
import type {
  GameStats,
  RawGameTeamStats,
  RawGameTeamStatsTeam,
  WeeklyGameStats,
} from '../types.ts';

/**
 * Test-only durable seeding. Production has NO direct game-stats write path
 * (PLATFORM-086H3 retired `setCachedGameStats`; the merge authority owns all
 * writes), so tests that need pre-existing durable partitions — legacy rows,
 * corrupt shapes, prior-good evidence — seed them here, outside the guarded
 * production surface.
 */
export async function seedGameStatsPartitionForTests(record: WeeklyGameStats): Promise<void> {
  await setAppState('game-stats', `${record.year}:${record.week}:${record.seasonType}`, record);
}

export type WireStatOverrides = Record<string, string | null>;

/**
 * observed: a realistic full CFBD stat line (values inside inventory-observed
 * ranges), including raw-only recognized categories (`kickReturns`,
 * `puntReturns`), an observed negative punt-return yardage, and the
 * observed-but-unmodeled `completionAttempts: "22-33"` pair.
 */
export function fullWireStats(overrides: WireStatOverrides = {}): Array<{
  category: string;
  stat: string;
}> {
  const base: Record<string, string> = {
    totalYards: '412',
    rushingYards: '187',
    netPassingYards: '225',
    turnovers: '1',
    thirdDownEff: '6-14',
    possessionTime: '31:24',
    fourthDownEff: '1-2',
    totalPenaltiesYards: '7-65',
    firstDowns: '21',
    rushingAttempts: '38',
    rushingTDs: '2',
    passingTDs: '2',
    fumblesLost: '1',
    interceptions: '0',
    passesIntercepted: '0',
    fumblesRecovered: '1',
    interceptionYards: '0',
    interceptionTDs: '0',
    kickReturns: '3',
    kickReturnYards: '64',
    kickReturnTDs: '0',
    puntReturns: '2',
    puntReturnYards: '-4',
    puntReturnTDs: '0',
    completionAttempts: '22-33',
  };
  for (const [category, stat] of Object.entries(overrides)) {
    if (stat === null) delete base[category];
    else base[category] = stat;
  }
  return Object.entries(base).map(([category, stat]) => ({ category, stat }));
}

export function wireTeam(params: {
  side: 'home' | 'away';
  school?: string;
  teamId?: number;
  points?: number;
  statOverrides?: WireStatOverrides;
}): RawGameTeamStatsTeam {
  const { side, statOverrides = {} } = params;
  return {
    teamId: params.teamId ?? (side === 'home' ? 101 : 202),
    team: params.school ?? (side === 'home' ? 'Alpha State' : 'Beta Tech'),
    conference: 'Fixture Conference',
    homeAway: side,
    points: params.points ?? (side === 'home' ? 31 : 17),
    stats: fullWireStats(statOverrides),
  };
}

export function wireGame(
  params: {
    id?: number;
    home?: Partial<Parameters<typeof wireTeam>[0]>;
    away?: Partial<Parameters<typeof wireTeam>[0]>;
  } = {}
): RawGameTeamStats {
  return {
    id: params.id ?? 401_000_001,
    teams: [wireTeam({ side: 'home', ...params.home }), wireTeam({ side: 'away', ...params.away })],
  };
}

/** Build a LEGACY row exactly the way production writers did (no version). */
export function legacyRowFromWire(game: RawGameTeamStats, week = 5): GameStats {
  const rows = normalizeGameTeamStats([game], week, 'regular');
  if (rows.length !== 1) throw new Error('fixture wire game did not normalize to one row');
  return rows[0]!;
}

/** observed: complete, analytics-compatible legacy row. */
export function completeLegacyRow(id = 401_000_001): GameStats {
  return legacyRowFromWire(wireGame({ id }));
}

/**
 * observed: explicit-zero legacy row — zeroes are genuine evidence
 * (`"0"`, `"0-0"`, `"0:00"`, 0 points), not fallbacks.
 */
export function explicitZeroLegacyRow(id = 401_000_002): GameStats {
  const zeroStats: WireStatOverrides = {
    totalYards: '0',
    rushingYards: '0',
    netPassingYards: '0',
    turnovers: '0',
    thirdDownEff: '0-0',
    possessionTime: '0:00',
  };
  return legacyRowFromWire(
    wireGame({
      id,
      home: { points: 0, statOverrides: zeroStats },
      away: { points: 0, statOverrides: zeroStats },
    })
  );
}

/**
 * observed: leading-space possession clock (`" 9:12"` etc.) — the inventory's
 * only initially-incompatible value shape; trimming restores exact parity.
 */
export function leadingSpacePossessionLegacyRow(id = 401_000_003): GameStats {
  return legacyRowFromWire(
    wireGame({
      id,
      home: { statOverrides: { possessionTime: ' 9:12' } },
      away: { statOverrides: { possessionTime: ' 7:16' } },
    })
  );
}

/**
 * observed: malformed OPTIONAL category (`fourthDownEff: "1--1"`) on an
 * otherwise complete row — must NOT invalidate required-complete analytics.
 */
export function malformedOptionalLegacyRow(id = 401_000_004): GameStats {
  return legacyRowFromWire(wireGame({ id, home: { statOverrides: { fourthDownEff: '1--1' } } }));
}

/** observed: possession at the inventory maximum (59 minutes). */
export function longPossessionLegacyRow(id = 401_000_005): GameStats {
  return legacyRowFromWire(
    wireGame({
      id,
      home: { statOverrides: { possessionTime: '59:00' } },
      away: { statOverrides: { possessionTime: '1:00' } },
    })
  );
}

/** synthesized: a required category value is malformed (`totalYards`). */
export function malformedRequiredLegacyRow(id = 401_000_006): GameStats {
  return legacyRowFromWire(
    wireGame({ id, home: { statOverrides: { totalYards: 'not-a-number' } } })
  );
}

/** synthesized: a required category is entirely missing (`possessionTime`). */
export function missingRequiredLegacyRow(id = 401_000_007): GameStats {
  return legacyRowFromWire(wireGame({ id, away: { statOverrides: { possessionTime: null } } }));
}

/**
 * hypothetical: statless legacy row (`raw: {}` both sides) — zero production
 * instances, but the classifier state must exist for defensive coverage.
 */
export function statlessLegacyRow(id = 401_000_008): GameStats {
  const row = completeLegacyRow(id);
  return {
    ...row,
    home: { ...row.home, raw: {} },
    away: { ...row.away, raw: {} },
  };
}

/**
 * synthesized: legacy row whose stored points are not trustworthy (the legacy
 * normalizer wrote a fallback for a malformed wire value; stored value tampered
 * here to simulate the resulting invalid stored integer).
 */
export function invalidStoredPointsLegacyRow(id = 401_000_009): GameStats {
  const row = completeLegacyRow(id);
  return { ...row, home: { ...row.home, points: 3.5 } };
}

/**
 * hypothetical: stored normalized field disagrees with the strict rebuild of
 * its raw evidence — zero production instances (14,668/14,668 matched), kept as
 * a quarantine state.
 */
export function normalizedMismatchLegacyRow(id = 401_000_010): GameStats {
  const row = completeLegacyRow(id);
  return { ...row, home: { ...row.home, totalYards: row.home.totalYards + 25 } };
}

/**
 * synthesized: a row whose raw map carries only categories named after
 * `Object.prototype` members. Untrusted provider category strings must resolve
 * as unknown categories — never as inherited object values — so this row must
 * classify through the normal malformed path without throwing.
 */
export function prototypeNamedCategoryLegacyRow(id = 401_000_012): GameStats {
  const row = completeLegacyRow(id);
  return {
    ...row,
    home: { ...row.home, raw: { ['toString']: '55', ['constructor']: '3' } },
    away: { ...row.away, raw: { ['valueOf']: '1', ['hasOwnProperty']: '2' } },
  };
}

/** synthesized: unusable identity (blank school) on a legacy row. */
export function blankSchoolLegacyRow(id = 401_000_011): GameStats {
  const row = completeLegacyRow(id);
  return { ...row, away: { ...row.away, school: '   ' } };
}

/**
 * synthesized: hand-rolled v2-shaped row (the classifier consumes `unknown`,
 * so tests may construct arbitrary row-likes). Defaults to a COMPLETE v2 row;
 * override `home`/`away`/`schemaVersion` to reach the other v2 states.
 */
export function v2RowLike(
  params: {
    id?: number;
    schemaVersion?: unknown;
    homeRaw?: Record<string, unknown>;
    awayRaw?: Record<string, unknown>;
    homeOverrides?: Record<string, unknown>;
    awayOverrides?: Record<string, unknown>;
  } = {}
): Record<string, unknown> {
  const completeRaw: Record<string, string> = {
    totalYards: '412',
    rushingYards: '187',
    netPassingYards: '225',
    turnovers: '1',
    thirdDownEff: '6-14',
    possessionTime: '31:24',
  };
  return {
    schemaVersion: 'schemaVersion' in params ? params.schemaVersion : 2,
    providerGameId: params.id ?? 401_000_020,
    week: 5,
    seasonType: 'regular',
    home: {
      school: 'Alpha State',
      schoolId: 101,
      points: 31,
      pointsProvided: true,
      raw: params.homeRaw ?? completeRaw,
      ...params.homeOverrides,
    },
    away: {
      school: 'Beta Tech',
      schoolId: 202,
      points: 17,
      pointsProvided: true,
      raw: params.awayRaw ?? completeRaw,
      ...params.awayOverrides,
    },
  };
}
