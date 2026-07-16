import type { CfbdSeasonType } from '../cfbd.ts';
import { inferSubdivisionFromConference } from '../conferenceSubdivision.ts';
import { isDisruptedStatusLabel } from '../gameStatus.ts';
import { isPlaceholderTeamLabel } from '../teamNormalization.ts';
import { normalizeGameTeamStats } from './normalizers.ts';
import type { GameStats, RawGameTeamStats, WeeklyGameStats } from './types.ts';

/**
 * Whether a canonical schedule game is EXPECTED to produce team stats. Disrupted
 * games (canceled/postponed/suspended/delayed, via `gameStatus.ts`) never do — a
 * slate composed only of them is not applicable for game-stats retrieval, so it
 * must not trigger a missing-stats diagnostic or a cron provider retry (5th-review
 * findings #1/#3). Shared by the game-stats cron slate selection AND the coverage
 * diagnostics so both use ONE definition of a stat-producing game (no duplicate
 * status parsing).
 */
export function expectsGameStats(status: string | null | undefined): boolean {
  return !isDisruptedStatusLabel(status);
}

/**
 * Content-based game-stats coverage (PLATFORM-086A 4th-review finding #3).
 *
 * The presence of a `WeeklyGameStats` cache KEY does not prove the week has usable
 * data: both the cron and the manual refresh persist a record with `games: []`
 * when CFBD returns no rows, or when every row is dropped during normalization.
 * Coverage must therefore be judged on the record's actual game CONTENT, resolved
 * through canonical game identity — never on key existence alone. Diagnostics and
 * cron recovery share these helpers so they cannot drift.
 */

/** Whether a normalized team row carries a resolvable identity (nonempty school). */
function hasTeamIdentity(team: GameStats['home'] | GameStats['away'] | null | undefined): boolean {
  return Boolean(team && typeof team.school === 'string' && team.school.trim().length > 0);
}

/**
 * A normalized game-stats row is usable when it carries a real CFBD provider game
 * id (the canonical identity a schedule game resolves to) AND a nonempty team
 * identity on BOTH sides. A dropped/placeholder row (no positive id) or a row whose
 * team-name field CFBD omitted/renamed — leaving `school: ''` — is NOT coverage:
 * downstream owner aggregation (`aggregateOwnerGameStats`) cannot resolve a blank
 * school to an owner, so counting it as covered would wrongly stop cron repair
 * (4th/5th-review finding). Identity *resolution* still happens through the
 * centralized resolver elsewhere — this only validates that the inputs exist.
 */
export function isUsableGameStatsRow(game: GameStats): boolean {
  return (
    typeof game.providerGameId === 'number' &&
    Number.isFinite(game.providerGameId) &&
    game.providerGameId > 0 &&
    hasTeamIdentity(game.home) &&
    hasTeamIdentity(game.away)
  );
}

/**
 * The set of canonical game ids (as strings, to match `ScheduleItem.id`) that a
 * cached weekly record actually covers. Empty for a missing record, a `games: []`
 * record, or a record whose every row was dropped.
 */
export function usableGameStatsGameIds(record: WeeklyGameStats | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!record) return ids;
  for (const game of record.games ?? []) {
    if (isUsableGameStatsRow(game)) ids.add(String(game.providerGameId));
  }
  return ids;
}

/**
 * Whether a cached weekly record has ANY usable game coverage. `false` for a
 * missing record, an empty `games` array, or an all-dropped record — exactly the
 * cases a bare key-existence check wrongly treated as covered.
 */
export function hasUsableGameStats(record: WeeklyGameStats | null | undefined): boolean {
  return usableGameStatsGameIds(record).size > 0;
}

/**
 * The structural slice of a canonical `ScheduleItem` that expected-coverage
 * derivation reads. Kept structural (not the wire type) so pure helpers and
 * tests do not drag the schedule module graph in.
 */
export type GameStatsScheduleItem = {
  id?: string | null;
  week: number;
  seasonType?: string | null;
  status?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  homeConference?: string | null;
  awayConference?: string | null;
};

function normalizeSlateSeasonType(value: unknown): CfbdSeasonType {
  return value === 'postseason' ? 'postseason' : 'regular';
}

export type ExpectedGameStatsSlate = {
  /**
   * Whether the canonical schedule carries ANY row for this (week, seasonType)
   * slate. `false` means there is no schedule evidence to judge the week with —
   * callers must treat completeness as unprovable, never as complete.
   */
  hasScheduleEvidence: boolean;
  /** Schedule-defined canonical game ids expected to produce team stats. */
  expectedIds: Set<string>;
};

/**
 * Derive the canonical game ids EXPECTED to produce team stats for one weekly
 * slate, from canonical schedule rows only (PLATFORM-086H — never from returned
 * provider stat rows). A schedule game is expected unless the schedule itself
 * proves stats are not coming:
 *   - a disrupted/non-played terminal disposition (`expectsGameStats`);
 *   - an unresolved matchup — either side still a placeholder label (TBD /
 *     "Winner of …" / synthetic postseason slot), via the same predicate
 *     participant building uses; once the schedule resolves the matchup the
 *     game enters the expected set on the next evaluation;
 *   - an FCS-vs-FCS pairing, excluded only on POSITIVE canonical classification
 *     of BOTH conferences (`inferSubdivisionFromConference`) — an unknown
 *     classification never excludes, so a real FBS game can't be silently
 *     dropped from expectations.
 */
export function deriveExpectedGameStatsIds(
  items: readonly GameStatsScheduleItem[],
  week: number,
  seasonType: CfbdSeasonType
): ExpectedGameStatsSlate {
  const expectedIds = new Set<string>();
  let hasScheduleEvidence = false;

  for (const item of items) {
    if (item.week !== week || normalizeSlateSeasonType(item.seasonType) !== seasonType) continue;
    hasScheduleEvidence = true;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) continue;
    if (!expectsGameStats(item.status)) continue;
    if (isPlaceholderTeamLabel(item.homeTeam) || isPlaceholderTeamLabel(item.awayTeam)) continue;
    if (
      inferSubdivisionFromConference(item.homeConference) === 'FCS' &&
      inferSubdivisionFromConference(item.awayConference) === 'FCS'
    ) {
      continue;
    }
    expectedIds.add(id);
  }

  return { hasScheduleEvidence, expectedIds };
}

export type WeeklyGameStatsCompleteness =
  /** No schedule rows for the slate — completeness is unprovable, never "complete". */
  | { state: 'schedule-unavailable' }
  /** Schedule rows exist but none is expected to produce stats (disrupted/placeholder/FCS-only). */
  | { state: 'no-expected-games' }
  /** Expected games exist but no usable row covers any of them. */
  | { state: 'no-usable-rows'; expectedCount: number; missingIds: string[] }
  /** Some — not all — expected games have usable rows. */
  | { state: 'partial'; expectedCount: number; coveredCount: number; missingIds: string[] }
  /** Every expected game id has a usable cached row. */
  | { state: 'complete'; expectedCount: number };

/**
 * Schedule-relative weekly completeness (PLATFORM-086H finding #5). A week is
 * complete only when EVERY schedule-expected canonical game id has a usable
 * cached row; games the schedule proves non-stat-producing are already excluded
 * from the expected set. "Some usable rows exist" is explicitly NOT completeness
 * — a partial week stays eligible for recovery.
 */
export function evaluateWeeklyGameStatsCompleteness(params: {
  scheduleItems: readonly GameStatsScheduleItem[];
  week: number;
  seasonType: CfbdSeasonType;
  record: WeeklyGameStats | null | undefined;
}): WeeklyGameStatsCompleteness {
  const { scheduleItems, week, seasonType, record } = params;
  const { hasScheduleEvidence, expectedIds } = deriveExpectedGameStatsIds(
    scheduleItems,
    week,
    seasonType
  );
  if (!hasScheduleEvidence) return { state: 'schedule-unavailable' };
  if (expectedIds.size === 0) return { state: 'no-expected-games' };

  const covered = usableGameStatsGameIds(record);
  const missingIds = [...expectedIds].filter((id) => !covered.has(id)).sort();
  if (missingIds.length === 0) return { state: 'complete', expectedCount: expectedIds.size };
  const coveredCount = expectedIds.size - missingIds.length;
  if (coveredCount === 0) {
    return { state: 'no-usable-rows', expectedCount: expectedIds.size, missingIds };
  }
  return { state: 'partial', expectedCount: expectedIds.size, coveredCount, missingIds };
}

export type WeeklyGameStatsMerge = {
  /** The merged rows to persist (prior order preserved; new rows appended). */
  games: GameStats[];
  /** Rows this refresh actually added or replaced with new authoritative data. */
  rowsCommitted: number;
  /** Prior rows preserved because the response omitted them or was not authoritative. */
  rowsRetained: number;
  /** Whether the merged content differs from the prior record at all. */
  changed: boolean;
};

/** Merge key: the canonical (provider) game id, when the row carries a valid one. */
function mergeKey(row: GameStats): string | null {
  return typeof row.providerGameId === 'number' &&
    Number.isFinite(row.providerGameId) &&
    row.providerGameId > 0
    ? String(row.providerGameId)
    : null;
}

/**
 * Best-effort row equality. Rows are produced by the one shared normalizer, so a
 * stable field order makes JSON comparison reliable; a false negative merely
 * causes a redundant (harmless) rewrite, never data loss.
 */
function rowsEqual(a: GameStats, b: GameStats): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merge freshly normalized provider rows into the prior cached weekly record by
 * canonical game id (PLATFORM-086H requirement 4). Recovery of a partial week
 * must be strictly additive-or-replacing:
 *   - a prior row the response omits is RETAINED — a partial or empty recovery
 *     response can never delete prior-good rows;
 *   - an incoming row replaces the prior row for its game id only when it is
 *     authoritative — an UNUSABLE incoming row (blank team identity) never
 *     clobbers a usable prior row;
 *   - identical incoming data changes nothing (`changed: false`), so callers can
 *     skip the durable rewrite and downstream invalidation entirely.
 * Identity comes only from ids already on the rows — this merges rows, it never
 * creates game identity from provider stats.
 */
export function mergeWeeklyGameStats(
  prior: WeeklyGameStats | null | undefined,
  incoming: readonly GameStats[]
): WeeklyGameStatsMerge {
  const merged: GameStats[] = [...(prior?.games ?? [])];
  const indexByKey = new Map<string, number>();
  merged.forEach((row, index) => {
    const key = mergeKey(row);
    // First occurrence wins the index; duplicate prior ids are left in place.
    if (key !== null && !indexByKey.has(key)) indexByKey.set(key, index);
  });

  let rowsCommitted = 0;
  let replacedCount = 0;
  for (const row of incoming) {
    const key = mergeKey(row);
    const priorIndex = key !== null ? indexByKey.get(key) : undefined;
    if (priorIndex === undefined) {
      merged.push(row);
      if (key !== null) indexByKey.set(key, merged.length - 1);
      rowsCommitted += 1;
      continue;
    }
    const priorRow = merged[priorIndex];
    const authoritative = isUsableGameStatsRow(row) || !isUsableGameStatsRow(priorRow);
    if (!authoritative || rowsEqual(priorRow, row)) continue;
    merged[priorIndex] = row;
    rowsCommitted += 1;
    replacedCount += 1;
  }

  return {
    games: merged,
    rowsCommitted,
    rowsRetained: (prior?.games.length ?? 0) - replacedCount,
    changed: rowsCommitted > 0,
  };
}

export type GameStatsPayloadClassification =
  | { kind: 'noop' } // genuine empty provider array — valid absence
  | { kind: 'no-usable-rows' } // nonempty/non-array → zero usable rows — failure
  | { kind: 'commit'; games: GameStats[] }; // ≥1 usable row — commit

/**
 * Classify a raw CFBD `/games/teams` payload into the durable outcome it should
 * produce (5th-review finding #5). Shared by the game-stats cron AND the manual
 * `/api/game-stats` refresh so both behave identically:
 *   - a non-array payload, or a NONEMPTY payload whose normalized rows include zero
 *     USABLE rows (schema drift / blank team identities) → `no-usable-rows`
 *     (failure — preserve prior-good, never commit an empty/unusable record);
 *   - a genuinely EMPTY array → `noop` (valid absence — no durable write, no
 *     last-success advance);
 *   - at least one usable row → `commit` with the normalized games.
 */
export function classifyGameStatsPayload(
  rawGames: unknown,
  week: number,
  seasonType: CfbdSeasonType
): GameStatsPayloadClassification {
  if (!Array.isArray(rawGames)) return { kind: 'no-usable-rows' };
  if (rawGames.length === 0) return { kind: 'noop' };
  const games = normalizeGameTeamStats(rawGames as RawGameTeamStats[], week, seasonType);
  if (!games.some(isUsableGameStatsRow)) return { kind: 'no-usable-rows' };
  return { kind: 'commit', games };
}
