import type { CfbdSeasonType } from '../cfbd.ts';
import { classifyGameStatsRow, type GameStatsRowClassificationState } from './contract.ts';
import type { GameStats, TeamGameStats, WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H3 — schema-safe public wire projection for game-stats reads
 * (ACTIVE).
 *
 * The public boundary publishes ONLY rows on an EXPLICIT H1-approved
 * allowlist — never "anything except unaddressable":
 *
 *   PUBLISHED (public-compatible states):
 *     - `legacy-compatible`  — the bounded legacy contract; BY REFERENCE, so
 *       public output for equivalent legacy data stays byte-equivalent;
 *     - `v2-complete` / `v2-sparse` — rows written by our own merge
 *       authority; shallow-copied with persistence metadata (`schemaVersion`,
 *       `fetchStartedAt`, per-side `pointsProvided`) removed.
 *
 *   WITHHELD (typed, counted, never served):
 *     - `unsupported-version` / `malformed-v2` — unsupported schema
 *       authority is never laundered into legacy-looking unversioned rows;
 *     - `legacy-statless`, `legacy-malformed`, `legacy-normalized-mismatch`,
 *       `unusable-identity`, and every `non-persistable-*` v2 state —
 *       H1-defective evidence is not public-compatible data;
 *     - `unaddressable` — structurally malformed rows (typed, no exceptions:
 *       classification runs BEFORE any field access);
 *     - rows whose OWN `week`/`seasonType` contradict the requested weekly
 *       partition (partition-identity mismatch);
 *     - conflicting duplicates — the H1 deterministic duplicate policy runs
 *       BEFORE the wire: structurally identical approved duplicates collapse
 *       to one row; divergent duplicates are withheld ENTIRELY (no copy is
 *       served), matching the coverage/analytics duplicate authority.
 *
 * The envelope-level persistence metadata (`commitRevision`) is always
 * stripped. Withheld counts ride the view so `meta.availability`,
 * `meta.withheld`, and the served `games` array agree.
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
    /** Rows whose own week/seasonType contradict the requested partition. */
    partitionMismatch: number;
    /** Divergent duplicate rows (every copy withheld). */
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

function stripTeamMetadata(team: TeamGameStats): TeamGameStats {
  if (!Object.prototype.hasOwnProperty.call(team, 'pointsProvided')) return team;
  const publicTeam = { ...team };
  delete publicTeam.pointsProvided;
  return publicTeam;
}

/** Public view of one VERSION-2 game row: persistence metadata removed. */
function toPublicV2Row(row: GameStats): GameStats {
  const publicRow = {
    ...row,
    home: stripTeamMetadata(row.home),
    away: stripTeamMetadata(row.away),
  };
  delete publicRow.schemaVersion;
  delete publicRow.fetchStartedAt;
  return publicRow;
}

/** Key-order-independent structural equality (for duplicate collapse). */
function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    return arrA.every((item, i) => structurallyEqual(item, arrB[i]));
  }
  const recA = a as Record<string, unknown>;
  const recB = b as Record<string, unknown>;
  const keysA = Object.keys(recA);
  const keysB = Object.keys(recB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(recB, key) && structurallyEqual(recA[key], recB[key])
  );
}

/**
 * Build the schema-safe public view of one weekly partition. Pure and
 * exception-free for arbitrary stored shapes: every row is classified before
 * any field access, and only allowlisted rows are projected. Envelope
 * validation happens at the read boundary before this is called.
 */
export function buildPublicWeeklyGameStats(
  record: WeeklyGameStats,
  target?: { week: number; seasonType: CfbdSeasonType }
): PublicWeeklyGameStatsView {
  const withheld = {
    unsupportedSchema: 0,
    malformed: 0,
    defective: 0,
    partitionMismatch: 0,
    conflictingDuplicates: 0,
  };

  // Pass 1: classify and gate each row (no field access before approval).
  type Approved = { row: GameStats; original: GameStats };
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
    if (DEFECTIVE_STATES.has(state)) {
      withheld.defective += 1;
      continue;
    }
    if (!PUBLIC_APPROVED_STATES.has(state)) {
      // Defensive: any future classification state is withheld, not served.
      withheld.defective += 1;
      continue;
    }
    // Partition identity: a row claiming a different week/seasonType than the
    // requested envelope is not served under this partition.
    const typed = row as GameStats;
    if (
      target &&
      ((typeof typed.week === 'number' && typed.week !== target.week) ||
        (typeof typed.seasonType === 'string' && typed.seasonType !== target.seasonType))
    ) {
      withheld.partitionMismatch += 1;
      continue;
    }
    const isV2 = Object.prototype.hasOwnProperty.call(typed, 'schemaVersion');
    approved.push({ row: isV2 ? toPublicV2Row(typed) : typed, original: typed });
  }

  // Pass 2: deterministic duplicate policy BEFORE the wire. Identical
  // approved duplicates collapse to their first copy; divergent duplicates
  // are withheld entirely (no copy reaches the wire).
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
      games.push(copies[0]!.row);
      continue;
    }
    const allIdentical = copies.every((c) => structurallyEqual(c.original, copies[0]!.original));
    if (allIdentical) {
      games.push(copies[0]!.row);
    } else {
      withheld.conflictingDuplicates += copies.length;
    }
  }

  // Envelope-level persistence metadata never reaches the wire.
  const hasEnvelopeMetadata = Object.prototype.hasOwnProperty.call(record, 'commitRevision');
  const rowsUnchanged =
    games.length === record.games.length && games.every((game, i) => game === record.games[i]);
  if (!hasEnvelopeMetadata && rowsUnchanged) {
    return { record, withheld };
  }
  const publicRecord: WeeklyGameStats = { ...record, games };
  delete publicRecord.commitRevision;
  return { record: publicRecord, withheld };
}
