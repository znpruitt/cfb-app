import type { CfbdSeasonType } from '../cfbd.ts';
import {
  classifyGameStatsRow,
  selectAnalyticsRows,
  type GameStatsRowClassificationState,
} from './contract.ts';
import type { GameStats, TeamGameStats, WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H3 — schema-safe public wire projection for game-stats reads
 * (ACTIVE).
 *
 * The public boundary publishes ONLY rows on an EXPLICIT H1-approved
 * allowlist, and v2 output is CONSTRUCTED from explicit field allowlists —
 * never by spreading a persisted object and deleting a short list of
 * internal names. Unknown persisted fields are dropped by construction, so
 * internal metadata (`schemaVersion`, `fetchStartedAt`, `pointsProvided`,
 * `commitRevision`, transaction/recovery bookkeeping, or anything added
 * later) can never reach the wire through a v2 row. LEGACY rows (no own
 * `schemaVersion`) pass BY REFERENCE — the documented byte-equivalence
 * compatibility contract for pre-activation data.
 *
 *   PUBLISHED (public-compatible states):
 *     - `legacy-compatible` — by reference;
 *     - `v2-complete` / `v2-sparse` — explicit-allowlist construction
 *       (sparse rows still carry the full participant identity and public
 *       structural shape; classification runs BEFORE any field access, so
 *       sparse never means malformed).
 *
 *   WITHHELD (typed, counted, never served):
 *     - `unsupported-version` / `malformed-v2` — never laundered;
 *     - defective legacy states, `unusable-identity`, `non-persistable-*`,
 *       and any unknown future classifier state;
 *     - `unaddressable` structurally malformed rows;
 *     - rows whose OWN `year`/`week`/`seasonType` are malformed or disagree
 *       with the requested partition (a malformed value is NOT "absent");
 *     - duplicate conflicts per the H1 DUPLICATE AUTHORITY (below).
 *
 * Duplicate authority (shared with coverage/analytics/archive-integrity):
 * `selectAnalyticsRows` decides. An analytics-selected game publishes the
 * winning class's first copy (eligible v2 supersedes equivalent compatible
 * legacy per H1 precedence; superseded copies collapse); an analytics
 * CONFLICT withholds every copy. Groups with no analytics-eligible copy
 * (e.g. v2-sparse duplicates) publish only when their PUBLIC projections
 * are indistinguishable; divergent copies are withheld as conflicts. No
 * surface disagrees on which game is authoritative.
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
    /** Duplicate rows withheld under the H1 conflict policy (every copy). */
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
 * The approved PUBLIC team fields — the exact public API surface. Everything
 * else on a persisted team object (including future internal additions) is
 * dropped by construction.
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

/** Construct the public team object from the explicit allowlist ONLY. */
function buildPublicTeam(team: TeamGameStats): TeamGameStats {
  const raw: Record<string, string> = {};
  if (typeof team.raw === 'object' && team.raw !== null) {
    for (const [category, value] of Object.entries(team.raw)) {
      if (typeof value === 'string') raw[category] = value;
    }
  }
  const publicTeam = {
    school: team.school,
    conference: team.conference,
    homeAway: team.homeAway,
    raw,
  } as TeamGameStats;
  for (const field of PUBLIC_TEAM_NUMERIC_FIELDS) {
    (publicTeam as Record<string, unknown>)[field] = team[field];
  }
  return publicTeam;
}

/** Construct the public VERSION-2 row from the explicit row allowlist ONLY. */
function buildPublicV2Row(row: GameStats): GameStats {
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

  // Pass 1: classify and gate each row (no field access before approval).
  type Approved = { original: GameStats; isV2: boolean };
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
    });
  }

  // Pass 2: the H1 DUPLICATE AUTHORITY decides which copy is authoritative.
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

  const projectPublic = (entry: Approved): GameStats =>
    entry.isV2 ? buildPublicV2Row(entry.original) : entry.original;

  const games: GameStats[] = [];
  for (const id of order) {
    const copies = byId.get(id)!;
    if (copies.length === 1) {
      games.push(projectPublic(copies[0]!));
      continue;
    }
    // Same selection function coverage/analytics/archive-integrity use.
    const selection = selectAnalyticsRows(copies.map((c) => c.original));
    if (selection.conflicts.some((c) => c.providerGameId === id)) {
      withheld.conflictingDuplicates += copies.length;
      continue;
    }
    const selected = selection.selected.find((p) => p.providerGameId === id);
    if (selected) {
      // Publish the first copy of the H1-winning class (eligible v2
      // supersedes equivalent compatible legacy); superseded copies collapse.
      const winner =
        selected.source === 'v2' ? copies.find((c) => c.isV2) : copies.find((c) => !c.isV2);
      games.push(projectPublic(winner ?? copies[0]!));
      continue;
    }
    // No analytics-eligible copy (e.g. v2-sparse duplicates): publish only
    // when the PUBLIC projections are indistinguishable.
    const projections = copies.map(projectPublic);
    const serialized = projections.map((p) => JSON.stringify(p));
    if (serialized.every((s) => s === serialized[0])) {
      games.push(projections[0]!);
    } else {
      withheld.conflictingDuplicates += copies.length;
    }
  }

  // The public envelope is constructed explicitly — internal envelope
  // metadata (commitRevision, anything future) never reaches the wire.
  const rowsUnchanged =
    !Object.prototype.hasOwnProperty.call(record, 'commitRevision') &&
    games.length === record.games.length &&
    games.every((game, i) => game === record.games[i]);
  if (rowsUnchanged) {
    return { record, withheld };
  }
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
