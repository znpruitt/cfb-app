import type { CfbdSeasonType } from '../cfbd.ts';
import { isPolicyFcsConference } from '../conferenceSubdivision.ts';
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
  /**
   * Rows that WOULD be expected but carry no provider-addressable game id
   * (missing, synthetic fallback, zero/negative, or malformed). They are
   * UNVERIFIABLE — kept out of the completeness denominator (a coverage row can
   * never match them, so counting them would make the slate permanently
   * incomplete and re-fetched forever) — but surfaced here for diagnostics.
   */
  unverifiableCount: number;
};

/**
 * Whether a canonical schedule id can be matched by game-stats coverage: a
 * positive integer CFBD game id. `mapCfbdScheduleGame` synthesizes fallback ids
 * (`${week}-${home}-${away}`) when CFBD omits `game.id`, and cached coverage
 * rows only ever carry positive numeric provider ids (`isUsableGameStatsRow`) —
 * so a non-numeric id could never be covered and must not create an expectation
 * (review remediation). Identity is still never inferred from stat rows; this
 * only rejects schedule ids the provider cannot address.
 */
function isProviderAddressableGameId(id: string): boolean {
  return /^\d+$/.test(id) && Number.parseInt(id, 10) > 0;
}

/**
 * Derive the canonical game ids EXPECTED to produce team stats for one weekly
 * slate, from canonical schedule rows only (PLATFORM-086H — never from returned
 * provider stat rows). A schedule game is expected unless the schedule itself
 * proves stats are not coming:
 *   - a disrupted/non-played terminal disposition (`expectsGameStats`);
 *   - an unresolved matchup — a side blocks expectation only on POSITIVE
 *     placeholder evidence: the shared label predicate (`isPlaceholderTeamLabel`
 *     — TBD/TBA/"to be announced|determined"/"Winner of …"/synthetic slot/
 *     invalid labels). A pattern-valid but otherwise unknown participant STAYS
 *     expected (review remediation): the FBS-only catalog cannot disprove a
 *     real FCS opponent, and wrongly excluding a real game falsely completes
 *     the week and silently suppresses recovery, while wrongly including a junk
 *     label costs one bounded weekly retry that self-heals when the schedule
 *     resolves. Once the schedule resolves a matchup the game enters the
 *     expected set on the next evaluation;
 *   - an FCS-vs-FCS pairing, excluded only when BOTH conferences positively
 *     classify FCS via the pure, static present-day policy
 *     (`isPolicyFcsConference`) — never the mutable CFBD conference index, so
 *     identical inputs always derive identical expectations regardless of what
 *     other requests loaded or reset in the process; an unknown classification
 *     never excludes, so a real FBS game can't be silently dropped.
 * A row that passes all of the above but has no provider-addressable id is
 * UNVERIFIABLE (counted, never expected) — see `isProviderAddressableGameId`.
 * The derivation is deterministic from its explicit inputs plus the bundled
 * static conference policy — it has no identity-evidence load path.
 */
export function deriveExpectedGameStatsIds(
  items: readonly GameStatsScheduleItem[],
  week: number,
  seasonType: CfbdSeasonType
): ExpectedGameStatsSlate {
  const expectedIds = new Set<string>();
  let hasScheduleEvidence = false;
  let unverifiableCount = 0;

  for (const item of items) {
    if (item.week !== week || normalizeSlateSeasonType(item.seasonType) !== seasonType) continue;
    hasScheduleEvidence = true;
    if (!expectsGameStats(item.status)) continue;
    if (isPlaceholderTeamLabel(item.homeTeam) || isPlaceholderTeamLabel(item.awayTeam)) continue;
    if (isPolicyFcsConference(item.homeConference) && isPolicyFcsConference(item.awayConference)) {
      continue;
    }
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!isProviderAddressableGameId(id)) {
      unverifiableCount += 1;
      continue;
    }
    expectedIds.add(id);
  }

  return { hasScheduleEvidence, expectedIds, unverifiableCount };
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
  /**
   * Incoming rows DISCARDED because they carry no canonical merge key (missing/
   * zero/negative/non-numeric provider game id). Such a row can never be
   * addressed, replaced, or deduplicated, so persisting it would let every
   * recovery run of a still-incomplete week append another copy — accumulating
   * duplicates that inflate downstream owner aggregation (review remediation).
   */
  rowsDroppedKeyless: number;
  /**
   * Keyed incoming rows DISCARDED because they carried NO stat content at all
   * (identity-only rows — the provider supplied a game id and team names but
   * zero stat fields) and no prior row existed to retain. An identity-only row
   * is never authoritative game stats (review remediation).
   */
  rowsDroppedStatless: number;
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
 * STAT AUTHORITY, separate from merge identity (review remediation): how many
 * stat fields the provider EXPLICITLY supplied for this row, counted from the
 * normalizer's per-team `raw` category map — which records exactly the fields
 * present on the wire BEFORE omitted categories are normalized to zero. An
 * explicitly supplied "0" is present in `raw` and counts (a real zero is valid
 * data); an omitted category is absent and does not. A row with a valid id and
 * team names but zero present fields is IDENTITY-ONLY — never authoritative:
 * its zero-filled normalized values would silently replace real prior totals.
 * Deliberately a presence count, never a nonzero-value heuristic.
 */
function statFieldsPresent(row: GameStats): number {
  return Object.keys(row.home?.raw ?? {}).length + Object.keys(row.away?.raw ?? {}).length;
}

/**
 * Merge freshly normalized provider rows into the prior cached weekly record by
 * canonical game id (PLATFORM-086H requirement 4). Recovery of a partial week
 * must be strictly additive-or-replacing:
 *   - a prior row the response omits is RETAINED — a partial or empty recovery
 *     response can never delete prior-good rows;
 *   - an incoming row replaces the prior row for its game id only when it is
 *     authoritative on BOTH axes — identity (an UNUSABLE incoming row with blank
 *     team identity never clobbers a usable prior row) and STAT CONTENT
 *     (`statFieldsPresent`, review remediation): an identity-only row (zero
 *     provider-present stat fields) never replaces anything and is never
 *     persisted as new, and a row with WEAKER present-field coverage than the
 *     usable prior row retains the prior — a partially published CFBD response
 *     must not regress real totals to normalized zeros. Explicit zero values are
 *     present fields and remain valid. A usable incoming row with content still
 *     repairs a prior row whose identity is unusable (that prior row is
 *     unreachable by owner aggregation regardless of its stats);
 *   - an incoming row WITHOUT a canonical merge key is never persisted (review
 *     remediation): it could never be replaced or deduplicated, so a
 *     still-incomplete week would append another copy on every recovery run and
 *     inflate downstream owner aggregation. No fallback key is ever constructed
 *     from team names — identity comes only from the provider id;
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
  let rowsDroppedKeyless = 0;
  let rowsDroppedStatless = 0;
  for (const row of incoming) {
    const key = mergeKey(row);
    if (key === null) {
      rowsDroppedKeyless += 1;
      continue;
    }
    const coverage = statFieldsPresent(row);
    const priorIndex = indexByKey.get(key);
    if (priorIndex === undefined) {
      if (coverage === 0) {
        // Identity-only row with nothing to retain against: never persisted.
        rowsDroppedStatless += 1;
        continue;
      }
      merged.push(row);
      indexByKey.set(key, merged.length - 1);
      rowsCommitted += 1;
      continue;
    }
    // Identity-only rows never replace a prior row of any kind.
    if (coverage === 0) continue;
    const priorRow = merged[priorIndex];
    if (isUsableGameStatsRow(priorRow)) {
      // A usable prior row is replaced only by a usable incoming row whose
      // provider-present stat coverage is at least as strong.
      if (!isUsableGameStatsRow(row)) continue;
      if (coverage < statFieldsPresent(priorRow)) continue;
    } else if (!isUsableGameStatsRow(row)) {
      // Neither side usable: keep the prior row; nothing improves.
      continue;
    }
    if (rowsEqual(priorRow, row)) continue;
    merged[priorIndex] = row;
    rowsCommitted += 1;
    replacedCount += 1;
  }

  return {
    games: merged,
    rowsCommitted,
    rowsRetained: (prior?.games.length ?? 0) - replacedCount,
    rowsDroppedKeyless,
    rowsDroppedStatless,
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
