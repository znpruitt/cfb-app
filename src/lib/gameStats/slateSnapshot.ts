import type { AppGame, ScheduleWireItem } from '../schedule.ts';
import type { TeamCatalogItem } from '../teamIdentity.ts';
import type { AliasMap } from '../teamNames.ts';
import {
  deriveCanonicalGameStatsSlateFromBuild,
  type CanonicalGame,
  type CanonicalSlate,
} from './canonicalSlate.ts';

/**
 * PLATFORM-086H3E1 — archive-owned canonical game-stat slate snapshot.
 *
 * The persisted provenance pairing for archived analytics: a `SeasonArchive`
 * carries the slate derived from the EXACT canonical build that produced its
 * `games`/`scoresByKey`, so an archive consumer never rebuilds a live slate
 * and pairs it with archived scores (cross-provenance mixing). This module is
 * the single permitted season-archive crossing into the game-stats slate layer
 * (the slate derive-from-build entry only), enforced by the activation-invariant
 * guard's exact allowlist — which permits that name solely in the static
 * import statement and in direct call position, so this file cannot re-export
 * or alias that capability onward.
 *
 * The persisted schema is a MINIMAL STRICT ALLOWLIST — exactly the fields the
 * analytics projection consumes (association id, attachment key, partition,
 * name-resolved participants, numeric participant ids) — never a serialized
 * runtime `CanonicalGame`. Non-stat-applicable games (placeholder shells,
 * disrupted games) are not persisted at all, which also makes snapshot content
 * independent of the build instant: the expected/pending split (a 6-hour
 * kickoff-age concept) collapses because both classes persist identically.
 *
 * Consumers are live since the PLATFORM-086H3E (E3) activation. Absent or
 * malformed snapshots FAIL CLOSED in the analytics provenance path (distinct
 * unavailable reason, no live rebuild). The only repair is re-archiving the
 * year — a deliberate one-off since PLATFORM-086F2H2A retired the admin
 * backfill surface; the archive builders remain live and rollover-exercised.
 */

export const GAME_STAT_SLATE_SNAPSHOT_VERSION = 1 as const;

export type SlateSnapshotParticipant = {
  identityKey: string;
  canonicalName: string;
};

export type GameStatSlateSnapshotGame = {
  /** Positive CFBD provider game id — the association authority. */
  providerGameId: number;
  /** Canonical attachment key into this archive's own `scoresByKey`. */
  key: string;
  /** Provider partition week (postseason provider week, never canonical week). */
  providerWeek: number;
  seasonType: 'regular' | 'postseason';
  /** Name-resolved canonical participants as settled by the archive build. */
  home: SlateSnapshotParticipant | null;
  away: SlateSnapshotParticipant | null;
  /** CFBD numeric participant ids from the archive build's schedule rows. */
  homeId: number | null;
  awayId: number | null;
};

export type GameStatSlateSnapshot = {
  snapshotVersion: typeof GAME_STAT_SLATE_SNAPSHOT_VERSION;
  year: number;
  games: GameStatSlateSnapshotGame[];
};

export type GameStatSlateSnapshotParse =
  | { status: 'valid'; snapshot: GameStatSlateSnapshot }
  | { status: 'absent' }
  | { status: 'malformed' };

/**
 * Build the persisted snapshot from an EXACT canonical build. `games` must be
 * the unmodified `buildScheduleFromApi(...).games` output — with whatever
 * league-scoped aliases and manual postseason overrides that build applied —
 * and `scheduleItems` the exact wire rows fed to it. Throws (fail closed) on
 * an empty team catalog or a duplicate provider id, exactly like the slate
 * derivation itself: an archive must never be written with a snapshot built
 * without catalog authority or over ambiguous association ids.
 */
export function buildGameStatSlateSnapshot(input: {
  year: number;
  games: AppGame[];
  scheduleItems: ScheduleWireItem[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
  now: Date;
}): GameStatSlateSnapshot {
  const slate = deriveCanonicalGameStatsSlateFromBuild(input);
  const games: GameStatSlateSnapshotGame[] = [];
  for (const game of slate.games) {
    // Placeholder shells and disrupted games never produce stats — not persisted.
    if (game.applicability === 'not-expected') continue;
    // Explicit field-by-field projection (never a spread) so no runtime-only
    // field can leak into the persisted allowlist.
    games.push({
      providerGameId: game.providerGameId,
      key: game.key,
      providerWeek: game.providerWeek,
      seasonType: game.seasonType,
      home: game.home
        ? { identityKey: game.home.identityKey, canonicalName: game.home.canonicalName }
        : null,
      away: game.away
        ? { identityKey: game.away.identityKey, canonicalName: game.away.canonicalName }
        : null,
      homeId: game.homeId,
      awayId: game.awayId,
    });
  }
  const snapshot: GameStatSlateSnapshot = {
    snapshotVersion: GAME_STAT_SLATE_SNAPSHOT_VERSION,
    year: input.year,
    games,
  };
  // Self-verify against the strict parser BEFORE the snapshot can be
  // persisted: durable override maps receive no field-level validation, so an
  // override can inject a blank attachment key or an invalid provider week
  // into the exact build. Failing the archive build here is honest; writing a
  // snapshot the reader will call malformed later is not.
  if (parseGameStatSlateSnapshot(snapshot, input.year).status !== 'valid') {
    throw new Error('built game-stat slate snapshot failed strict validation');
  }
  return snapshot;
}

// Positive-safe-integer predicate, intentionally local: the canonical form
// lives in `contract.ts` (`isValidProviderGameId`); this module deliberately
// keeps a one-line local copy instead of importing the game-stats contract into
// the season-archive path.
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

const SNAPSHOT_KEYS = ['snapshotVersion', 'year', 'games'] as const;
const GAME_KEYS = [
  'providerGameId',
  'key',
  'providerWeek',
  'seasonType',
  'home',
  'away',
  'homeId',
  'awayId',
] as const;
const PARTICIPANT_KEYS = ['identityKey', 'canonicalName'] as const;

function parseParticipant(value: unknown): SlateSnapshotParticipant | null | 'malformed' {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return 'malformed';
  if (!hasExactKeys(value, PARTICIPANT_KEYS)) return 'malformed';
  const { identityKey, canonicalName } = value as Record<string, unknown>;
  if (!isNonEmptyString(identityKey) || !isNonEmptyString(canonicalName)) return 'malformed';
  return { identityKey, canonicalName };
}

function parseParticipantId(value: unknown): number | null | 'malformed' {
  if (value === null) return null;
  return isPositiveSafeInteger(value) ? value : 'malformed';
}

/**
 * Strict parse of a persisted snapshot. Durable app-state is untyped at rest,
 * so the stored value proves nothing: exact key sets, exact version, valid
 * ids, and unique provider game ids are all required. `absent` (the field is
 * missing on a pre-E1 archive) is distinguished from `malformed` so consumers
 * can fail closed with distinct reasons. When `expectedYear` is provided, a
 * year mismatch is `malformed` — a snapshot paired with the wrong archive is
 * a provenance violation, never usable context.
 */
export function parseGameStatSlateSnapshot(
  value: unknown,
  expectedYear?: number
): GameStatSlateSnapshotParse {
  // Only a MISSING field is absence (a pre-E1 archive never wrote the key). A
  // PRESENT `null` was written by something and is corrupt durable data —
  // malformed, never absence.
  if (value === undefined) return { status: 'absent' };
  if (value === null) return { status: 'malformed' };
  if (typeof value !== 'object' || Array.isArray(value)) return { status: 'malformed' };
  if (!hasExactKeys(value, SNAPSHOT_KEYS)) return { status: 'malformed' };

  const { snapshotVersion, year, games } = value as Record<string, unknown>;
  if (snapshotVersion !== GAME_STAT_SLATE_SNAPSHOT_VERSION) return { status: 'malformed' };
  if (!isPositiveSafeInteger(year)) return { status: 'malformed' };
  if (expectedYear !== undefined && year !== expectedYear) return { status: 'malformed' };
  if (!Array.isArray(games)) return { status: 'malformed' };

  const parsedGames: GameStatSlateSnapshotGame[] = [];
  const seenIds = new Set<number>();
  for (const raw of games) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { status: 'malformed' };
    }
    if (!hasExactKeys(raw, GAME_KEYS)) return { status: 'malformed' };
    const game = raw as Record<string, unknown>;

    const providerGameId = game.providerGameId;
    if (!isPositiveSafeInteger(providerGameId)) return { status: 'malformed' };
    if (seenIds.has(providerGameId)) return { status: 'malformed' };
    seenIds.add(providerGameId);

    if (!isNonEmptyString(game.key)) return { status: 'malformed' };
    const providerWeek = game.providerWeek;
    // Week 0 is a real CFBD regular-season partition — non-negative, not positive.
    if (
      typeof providerWeek !== 'number' ||
      !Number.isSafeInteger(providerWeek) ||
      providerWeek < 0
    ) {
      return { status: 'malformed' };
    }
    if (game.seasonType !== 'regular' && game.seasonType !== 'postseason') {
      return { status: 'malformed' };
    }

    const home = parseParticipant(game.home);
    if (home === 'malformed') return { status: 'malformed' };
    const away = parseParticipant(game.away);
    if (away === 'malformed') return { status: 'malformed' };
    const homeId = parseParticipantId(game.homeId);
    if (homeId === 'malformed') return { status: 'malformed' };
    const awayId = parseParticipantId(game.awayId);
    if (awayId === 'malformed') return { status: 'malformed' };

    parsedGames.push({
      providerGameId,
      key: game.key,
      providerWeek,
      seasonType: game.seasonType,
      home,
      away,
      homeId,
      awayId,
    });
  }

  return {
    status: 'valid',
    snapshot: { snapshotVersion: GAME_STAT_SLATE_SNAPSHOT_VERSION, year, games: parsedGames },
  };
}

/**
 * Reconstruct the projection-facing canonical slate from a parsed snapshot.
 * Every persisted game is stat-applicable by construction, so applicability is
 * `expected`. Fields the analytics projection never consumes carry fixed
 * reconstruction values (`eventId` = provider id string, `neutral` false,
 * `kickoff`/`rawStatus` null) and MUST NOT be treated as schedule truth.
 */
export function snapshotToCanonicalSlate(snapshot: GameStatSlateSnapshot): CanonicalSlate {
  return {
    year: snapshot.year,
    games: snapshot.games.map(
      (game): CanonicalGame => ({
        providerGameId: game.providerGameId,
        key: game.key,
        eventId: String(game.providerGameId),
        providerWeek: game.providerWeek,
        seasonType: game.seasonType,
        neutral: false,
        applicability: 'expected',
        notExpectedReason: null,
        home: game.home ? { ...game.home } : null,
        away: game.away ? { ...game.away } : null,
        homeId: game.homeId,
        awayId: game.awayId,
        kickoff: null,
        rawStatus: null,
      })
    ),
  };
}
