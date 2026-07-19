import type { CfbdSeasonType } from '../cfbd.ts';
import {
  classifyGameStatsRow,
  RECOGNIZED_GAME_STAT_CATEGORIES,
  type GameStatsRowClassificationState,
} from './contract.ts';
import type { GameStats, TeamGameStats, WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H3 — schema-safe public wire projection for game-stats reads
 * (ACTIVE).
 *
 * EVERYTHING on the public wire is CONSTRUCTED from explicit allowlists — the
 * envelope, each game, each team, and each team's `raw` category map. Nothing
 * is ever produced by spreading a persisted object (and deleting a short list
 * of internal names), and NO row is returned by reference. Unknown persisted
 * fields at any level — `schemaVersion`, `fetchStartedAt`, `pointsProvided`,
 * `commitRevision`, transaction/recovery bookkeeping, an unrecognized future
 * `raw` category, or anything added later — are dropped by construction and
 * can never reach a caller.
 *
 *   PUBLISHED (public-compatible states):
 *     - `legacy-compatible`;
 *     - `v2-complete` / `v2-sparse` (sparse rows still carry the full
 *       participant identity and public structural shape; classification runs
 *       BEFORE any field access, so sparse never means malformed).
 *
 *   WITHHELD (typed, counted, never served):
 *     - `unsupported-version` / `malformed-v2` — never laundered;
 *     - defective legacy states, `unusable-identity`, `non-persistable-*`,
 *       and any unknown future classifier state;
 *     - `unaddressable` structurally malformed rows;
 *     - rows whose OWN `year`/`week`/`seasonType` are malformed or disagree
 *       with the requested partition (a malformed value is NOT "absent");
 *     - duplicate conflicts per the PUBLIC DUPLICATE AUTHORITY (below).
 *
 * Public duplicate authority: a purpose-specific selector that agrees with H1
 * classification and format precedence (eligible v2 supersedes an equivalent
 * legacy copy) but compares the ACTUAL PUBLIC PROJECTIONS, not analytics
 * equality. Two copies that would aggregate identically but differ in ANY
 * public field (including return statistics that analytics never inspects)
 * are a public CONFLICT and every copy is withheld — array order never
 * decides which copy serves.
 */

export type PublicWeeklyGameStatsView = {
  /** The public partition: envelope fields plus only publishable rows. */
  record: WeeklyGameStats;
  /** Rows withheld from the public wire, by typed cause. */
  withheld: {
    /** Unsupported authoritative schema (`schemaVersion: 3`, malformed versions). */
    unsupportedSchema: number;
    /** Structurally unusable rows (not an object, unaddressable game id). */
    malformed: number;
    /** H1-defective evidence (defective legacy states, unusable identity, non-persistable v2). */
    defective: number;
    /** Rows whose own year/week/seasonType are malformed or contradict the partition. */
    partitionMismatch: number;
    /**
     * Number of GAME IDS withheld under the public duplicate conflict policy
     * (counted per conflicted game, never per copy). A single game with three
     * divergent copies contributes 1.
     */
    conflictingDuplicates: number;
  };
};

/** The explicit public-compatible allowlist. */
const PUBLIC_APPROVED_STATES: ReadonlySet<GameStatsRowClassificationState> = new Set([
  'legacy-compatible',
  'v2-complete',
  'v2-sparse',
]);

const DEFECTIVE_STATES: ReadonlySet<GameStatsRowClassificationState> = new Set([
  'legacy-statless',
  'legacy-malformed',
  'legacy-normalized-mismatch',
  'unusable-identity',
  'non-persistable-empty',
  'non-persistable-unknown-only',
  'non-persistable-malformed-only',
  'non-persistable-one-sided',
]);

/**
 * The approved PUBLIC team numeric fields — the exact public API surface.
 * Everything else on a persisted team object (including future internal
 * additions) is dropped by construction.
 */
const PUBLIC_TEAM_NUMERIC_FIELDS = [
  'schoolId',
  'points',
  'totalYards',
  'rushingYards',
  'passingYards',
  'rushingAttempts',
  'passingAttempts',
  'passingCompletions',
  'rushingTDs',
  'passingTDs',
  'firstDowns',
  'turnovers',
  'fumblesLost',
  'interceptionsThrown',
  'passesIntercepted',
  'fumblesRecovered',
  'thirdDownAttempts',
  'thirdDownConversions',
  'thirdDownPct',
  'fourthDownAttempts',
  'fourthDownConversions',
  'penaltyCount',
  'penaltyYards',
  'possessionSeconds',
  'interceptionReturnYards',
  'interceptionReturnTDs',
  'kickReturnYards',
  'kickReturnTDs',
  'puntReturnYards',
  'puntReturnTDs',
] as const;

/**
 * The approved PUBLIC `raw` categories — exactly the recognized contract
 * categories (`RECOGNIZED_GAME_STAT_CATEGORIES`). An unrecognized provider
 * category (future wire additions, injected internal keys) is dropped by
 * construction, never copied through because it happens to be string-valued.
 */
const PUBLIC_RAW_CATEGORIES: ReadonlySet<string> = new Set(RECOGNIZED_GAME_STAT_CATEGORIES);

/** Construct the public `raw` map from the recognized-category allowlist ONLY. */
function buildPublicRaw(raw: unknown): Record<string, string> {
  const publicRaw: Record<string, string> = {};
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as Record<string, unknown>;
    // Iterate the allowlist (not the untrusted object's keys) so nothing
    // outside the contract can appear, and prototype-member keys are never
    // reachable.
    for (const category of PUBLIC_RAW_CATEGORIES) {
      if (!Object.prototype.hasOwnProperty.call(record, category)) continue;
      const value = record[category];
      if (typeof value === 'string') publicRaw[category] = value;
    }
  }
  return publicRaw;
}

/** Construct the public team object from the explicit allowlist ONLY. */
function buildPublicTeam(team: TeamGameStats): TeamGameStats {
  const source = team as unknown as Record<string, unknown>;
  const publicTeam = {
    school: team.school,
    conference: team.conference,
    homeAway: team.homeAway,
    raw: buildPublicRaw(source.raw),
  } as TeamGameStats;
  for (const field of PUBLIC_TEAM_NUMERIC_FIELDS) {
    (publicTeam as Record<string, unknown>)[field] = source[field];
  }
  return publicTeam;
}

/** Construct the public row from the explicit row allowlist ONLY (legacy and
 * v2 alike — no row is ever returned by reference). */
function buildPublicRow(row: GameStats): GameStats {
  return {
    providerGameId: row.providerGameId,
    week: row.week,
    seasonType: row.seasonType,
    home: buildPublicTeam(row.home),
    away: buildPublicTeam(row.away),
  };
}

/** Strict optional partition-field agreement (malformed ≠ absent). */
function rowPartitionMismatch(
  row: GameStats,
  target: { year?: number; week: number; seasonType: CfbdSeasonType }
): boolean {
  const record = row as unknown as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'week')) {
    if (typeof record.week !== 'number' || record.week !== target.week) return true;
  }
  if (Object.prototype.hasOwnProperty.call(record, 'seasonType')) {
    if (
      (record.seasonType !== 'regular' && record.seasonType !== 'postseason') ||
      record.seasonType !== target.seasonType
    ) {
      return true;
    }
  }
  if (target.year !== undefined && Object.prototype.hasOwnProperty.call(record, 'year')) {
    if (typeof record.year !== 'number' || record.year !== target.year) return true;
  }
  return false;
}

type Approved = { original: GameStats; isV2: boolean; publicRow: GameStats };

/**
 * Choose the public copy for one provider game id, or withhold the whole
 * group as a conflict. H1 format precedence chooses the winning CLASS
 * (eligible v2 supersedes an equivalent legacy copy); then EVERY copy of that
 * winning class must project to an indistinguishable public row — otherwise
 * the copies disagree on public data and are all withheld. Two copies that
 * agree for analytics but differ in a public-only field (e.g. return yards)
 * therefore conflict, and array order never picks a winner.
 */
function selectPublicCopy(copies: Approved[]): { row: GameStats } | { conflict: true } {
  const v2Copies = copies.filter((c) => c.isV2);
  const winningClass = v2Copies.length > 0 ? v2Copies : copies;
  const serialized = winningClass.map((c) => JSON.stringify(c.publicRow));
  if (serialized.every((s) => s === serialized[0])) {
    return { row: winningClass[0]!.publicRow };
  }
  return { conflict: true };
}

/**
 * Build the schema-safe public view of one weekly partition. Pure and
 * exception-free for arbitrary stored shapes: every row is classified before
 * any field access, and only allowlisted rows are projected. Envelope
 * validation happens at the read boundary before this is called.
 */
export function buildPublicWeeklyGameStats(
  record: WeeklyGameStats,
  target?: { year?: number; week: number; seasonType: CfbdSeasonType }
): PublicWeeklyGameStatsView {
  const withheld = {
    unsupportedSchema: 0,
    malformed: 0,
    defective: 0,
    partitionMismatch: 0,
    conflictingDuplicates: 0,
  };

  // Pass 1: classify and gate each row (no field access before approval),
  // then build its public projection.
  const approved: Approved[] = [];
  for (const row of record.games) {
    const state = classifyGameStatsRow(row).state;
    if (state === 'unaddressable') {
      withheld.malformed += 1;
      continue;
    }
    if (state === 'unsupported-version' || state === 'malformed-v2') {
      // Never laundered into legacy-looking data.
      withheld.unsupportedSchema += 1;
      continue;
    }
    if (DEFECTIVE_STATES.has(state) || !PUBLIC_APPROVED_STATES.has(state)) {
      // Defective evidence — and, defensively, any future classifier state —
      // is withheld, not served.
      withheld.defective += 1;
      continue;
    }
    const typed = row as GameStats;
    if (target && rowPartitionMismatch(typed, target)) {
      withheld.partitionMismatch += 1;
      continue;
    }
    approved.push({
      original: typed,
      isV2: Object.prototype.hasOwnProperty.call(typed, 'schemaVersion'),
      publicRow: buildPublicRow(typed),
    });
  }

  // Pass 2: the PUBLIC DUPLICATE AUTHORITY decides which copy is authoritative.
  const byId = new Map<number, Approved[]>();
  const order: number[] = [];
  for (const entry of approved) {
    const id = entry.original.providerGameId;
    const existing = byId.get(id);
    if (existing) existing.push(entry);
    else {
      byId.set(id, [entry]);
      order.push(id);
    }
  }

  const games: GameStats[] = [];
  for (const id of order) {
    const copies = byId.get(id)!;
    if (copies.length === 1) {
      games.push(copies[0]!.publicRow);
      continue;
    }
    const decision = selectPublicCopy(copies);
    if ('conflict' in decision) {
      withheld.conflictingDuplicates += 1; // per conflicted GAME id
      continue;
    }
    games.push(decision.row);
  }

  // The public envelope is ALWAYS constructed explicitly — internal envelope
  // metadata (commitRevision, anything future) never reaches the wire, and no
  // persisted object is ever returned by reference.
  return {
    record: {
      year: record.year,
      week: record.week,
      seasonType: record.seasonType,
      fetchedAt: record.fetchedAt,
      games,
    },
    withheld,
  };
}
