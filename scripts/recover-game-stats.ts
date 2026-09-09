// Operator CLI for the bounded game-stat recovery (PLATFORM-110A / Item 110A).
//
// Recovers NAMED game-stat records that ordinary polling can no longer reach.
// The 15-minute cron drops a game once it is more than 24 hours past kickoff
// (`POLLING_MAX_KICKOFF_AGE_MS`) and drops a partition whose window games are
// all `satisfied` (`selectPollingTarget`) — but satisfaction establishes
// usability, not an immutable final provider revision, so a record can sit
// permanently behind a newer CFBD observation.
//
// This tool is a REPAIR for an explicitly named set of games. It is NOT the
// recurring reconciliation over satisfied partitions (Item 110B, separately
// designed and reviewed), and it is NOT a widening of the polling window
// (Item 131). It cannot become either: it refuses to run without an explicit,
// nonempty `--game-ids`, and it never derives its own target.
//
// It writes through the EXISTING authority — `ingestGameStatsPartitionResponse`
// → `mergeGameStatsPartitionDurable` — so canonical identity, writer-control
// authorization, per-game observation fencing, prior-good retention and the
// typed outcome vocabulary all apply unchanged. It builds on that authority,
// never around it.
//
// Usage:
//   # 1. CAPTURE — the CFBD usage probe + ONE partition request; no durable
//   #    write of any kind. `--quota-override` is the only way past the reserve.
//   tsx scripts/recover-game-stats.ts capture \
//       --year 2026 --week 1 --season-type regular \
//       --game-ids 401868170,401858212 --out /some/path/outside/the/repo.json
//
//   # 2. APPLY — replays the CAPTURED payload; makes NO further CFBD call.
//   tsx scripts/recover-game-stats.ts apply --capture <path> --apply
//
// Capture-then-apply is deliberate. It halves the provider cost (one call, not
// one per phase) and it keeps the observation fence honest: the fence is
// defined as when the provider fetch STARTED, and the capture records exactly
// that. If another writer advances the partition in between, H2 classifies the
// replayed observations `stale` or `conflict` and refuses — truthfully.
//
// The capture file holds a full raw CFBD partition response. It is written
// OUTSIDE the repository by construction — a path inside the working tree is
// refused, so a provider payload can never be committed by accident.
//
// Exit codes: 0 = capture written / dry run valid / merge COMMITTED;
//             2 = refused (bad arguments, empty or unmatched game-id set,
//                 capture path inside the repo, malformed capture, quota
//                 reserve — nothing fetched and nothing written) OR a merge
//                 that did not repair anything (`stale` / `unchanged`);
//             3 = store or provider unavailable (no durable change occurred);
//             4 = INDETERMINATE durability — the merge transaction's fate is
//                 unknown. REREAD the partition before any further action;
//                 never retry blindly;
//             1 = unexpected error.
//
// Exit 0 means the named games were repaired. A `stale` or `unchanged` merge
// exits NONZERO even though H2 calls it a no-op: for a REPAIR, "the partition
// already holds this" means the repair did not happen, and a caller chaining
// `--apply && …` must not read that as success.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import dotenv from 'dotenv';

import { fetchCfbdUsage } from '../src/lib/api/cfbdUsage.ts';
import { fetchUpstreamJson, UpstreamFetchError } from '../src/lib/api/fetchUpstream.ts';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '../src/lib/cfbd.ts';
import { GAME_STATS_SCOPE, getGameStatsKey } from '../src/lib/gameStats/cache.ts';
import { parseV2GameObservation } from '../src/lib/gameStats/contract.ts';
import { ingestGameStatsPartitionResponse } from '../src/lib/gameStats/ingestionCoordinator.ts';
import type { GameStatsIngestionResult } from '../src/lib/gameStats/ingestionCoordinator.ts';
import { validateGameStatsEnvelope } from '../src/lib/gameStats/publicProjection.ts';
import { evaluateManualQuota, type CfbdUsageSnapshot } from '../src/lib/gameStats/quotaPolicy.ts';
import { interpretGameStatsRefreshOutcome } from '../src/lib/gameStats/refreshOutcome.ts';
import type { GameStatsRefreshInterpretation } from '../src/lib/gameStats/refreshOutcome.ts';
import { weekPartitionScope } from '../src/lib/providerRefreshScope.ts';
import type { ProviderRefreshScope } from '../src/lib/providerRefreshScope.ts';
import { getAppState, getAppStateStorageStatus } from '../src/lib/server/appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '../src/lib/server/providerRefreshStatus.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE =
  'usage: tsx scripts/recover-game-stats.ts capture --year <n> --week <n> ' +
  '--season-type <regular|postseason> --game-ids <id,id,...> --out <path outside the repo> ' +
  '[--quota-override]\n' +
  '       tsx scripts/recover-game-stats.ts apply --capture <path> [--apply]';

// ONE provider request per capture — no transport retries. A retried request is
// a second CFBD call this tool's stated cost does not account for.
const CFBD_RETRY_POLICY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitterRatio: 0,
  retryOnHttpStatuses: [],
} as const;

const CFBD_PACING_POLICY = { key: 'cfbd', minIntervalMs: 150 } as const;

// === Arguments ===

export type CaptureArgs = {
  mode: 'capture';
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  /** Sorted, deduplicated, every member a valid provider game id. Never empty. */
  gameIds: number[];
  out: string;
  /** Explicit operator override of the CFBD reserve — never a default. */
  quotaOverride: boolean;
};

export type ApplyArgs = {
  mode: 'apply';
  capture: string;
  /** False is a dry run: the capture is validated and diffed, nothing is written. */
  apply: boolean;
};

export type RecoveryArgs = CaptureArgs | ApplyArgs;

function parsePositiveInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Strict parsing with NO defaults for anything that selects data. In capture
 * mode `--game-ids` is required and must be nonempty: there is deliberately no
 * spelling of this command that means "recover whatever needs it". That is the
 * property which keeps this tool from becoming Item 110B.
 */
export function parseRecoveryArgs(argv: readonly string[]): RecoveryArgs | { error: string } {
  const mode = argv[0];
  if (mode !== 'capture' && mode !== 'apply') {
    return { error: 'first argument must be `capture` or `apply`' };
  }
  const rest = argv.slice(1);
  const values = new Map<string, string>();
  let applyFlag = false;
  let quotaOverrideFlag = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--apply') {
      applyFlag = true;
      continue;
    }
    if (arg === '--quota-override') {
      quotaOverrideFlag = true;
      continue;
    }
    if (!arg.startsWith('--')) return { error: `unknown argument: ${arg}` };
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return { error: `${arg} requires a value` };
    }
    if (values.has(arg)) return { error: `${arg} given more than once` };
    values.set(arg, value);
    i += 1;
  }

  if (mode === 'apply') {
    const capture = values.get('--capture');
    if (capture === undefined) return { error: '--capture is required in apply mode' };
    for (const key of values.keys()) {
      if (key !== '--capture') return { error: `unknown argument for apply mode: ${key}` };
    }
    if (quotaOverrideFlag) {
      return { error: '--quota-override is meaningless in apply mode (apply makes no CFBD call)' };
    }
    return { mode: 'apply', capture, apply: applyFlag };
  }

  if (applyFlag) return { error: '--apply is meaningless in capture mode (capture never writes)' };
  for (const key of values.keys()) {
    if (!['--year', '--week', '--season-type', '--game-ids', '--out'].includes(key)) {
      return { error: `unknown argument for capture mode: ${key}` };
    }
  }
  const yearRaw = values.get('--year');
  const weekRaw = values.get('--week');
  const seasonTypeRaw = values.get('--season-type');
  const gameIdsRaw = values.get('--game-ids');
  const out = values.get('--out');
  if (yearRaw === undefined) return { error: '--year is required' };
  if (weekRaw === undefined) return { error: '--week is required' };
  if (seasonTypeRaw === undefined) return { error: '--season-type is required' };
  if (gameIdsRaw === undefined) return { error: '--game-ids is required' };
  if (out === undefined) return { error: '--out is required' };

  const year = parsePositiveInt(yearRaw);
  if (year === null || year < 2001) return { error: '--year must be an integer >= 2001' };
  const week = parsePositiveInt(weekRaw);
  if (week === null) return { error: '--week must be a positive integer' };
  if (seasonTypeRaw !== 'regular' && seasonTypeRaw !== 'postseason') {
    return { error: "--season-type must be 'regular' or 'postseason'" };
  }

  const rawIds = gameIdsRaw.split(',').map((part) => part.trim());
  if (rawIds.some((part) => part.length === 0)) {
    return { error: '--game-ids must be a comma-separated list with no empty entries' };
  }
  const ids: number[] = [];
  for (const part of rawIds) {
    const id = parsePositiveInt(part);
    if (id === null) return { error: `--game-ids contains an invalid provider game id: ${part}` };
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return { error: '--game-ids must name at least one provider game id' };

  return {
    mode: 'capture',
    year,
    week,
    seasonType: seasonTypeRaw,
    gameIds: ids.sort((a, b) => a - b),
    out,
    quotaOverride: quotaOverrideFlag,
  };
}

/**
 * A capture holds a full raw provider payload, so it must not land in the
 * working tree where a `git add` could sweep it up. Refuse any path inside the
 * repository root — including the root itself — rather than trusting
 * `.gitignore` to be right forever.
 */
export function checkCapturePathOutsideRepo(
  outPath: string,
  repoRoot: string = REPO_ROOT,
  realpath: (p: string) => string = defaultRealpath
): { error: string } | null {
  // Resolve BOTH sides through the filesystem before comparing. A lexical
  // comparison alone is defeated by a symlink OUTSIDE the tree pointing back
  // into it: the check passes and `writeFileSync` follows the link, landing the
  // payload in the working tree anyway.
  const root = realpath(path.resolve(repoRoot));
  const resolved = path.resolve(outPath);
  for (const candidate of candidateRealPaths(resolved, realpath)) {
    const relative = path.relative(root, candidate);
    // macOS and Windows are case-insensitive by default, so `/REPO/x.json`
    // reaches the same directory as `/repo/x.json`; compare case-folded too.
    const caseFolded = path.relative(root.toLowerCase(), candidate.toLowerCase());
    for (const rel of [relative, caseFolded]) {
      if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        return {
          error:
            `--out resolves inside the repository (${candidate}). A captured CFBD payload ` +
            'must never be committable: write it outside the working tree.',
        };
      }
    }
  }
  return null;
}

function defaultRealpath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    // A path that does not exist yet resolves to itself; the ancestor walk in
    // `candidateRealPaths` still reaches whichever ancestor DOES exist.
    return target;
  }
}

/**
 * The destination as written, plus the same destination rebuilt through every
 * ancestor the filesystem resolves differently. The capture file does not exist
 * yet, so its own `realpath` says nothing — its directory chain is what carries
 * a symlink.
 */
function candidateRealPaths(resolved: string, realpath: (p: string) => string): string[] {
  const candidates = [resolved];
  const below: string[] = [];
  const tail = path.basename(resolved);
  let dir = path.dirname(resolved);
  for (;;) {
    const real = realpath(dir);
    if (real !== dir) candidates.push(path.join(real, ...below, tail));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    below.unshift(path.basename(dir));
    dir = parent;
  }
  return candidates;
}

// === Capture file ===

export type RecoveryCapture = {
  kind: 'game-stats-recovery-capture';
  version: 1;
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  /**
   * When the provider fetch STARTED. Replayed verbatim as the observation
   * fence, so an apply carries the freshness of the observation itself and not
   * of the replay.
   */
  fetchStartedAt: string;
  gameIds: number[];
  payload: unknown;
};

/** Validate an untrusted capture file: the stored value proves nothing. */
export function parseCaptureFile(value: unknown): RecoveryCapture | { error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'capture file is not an object' };
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== 'game-stats-recovery-capture' || record.version !== 1) {
    return { error: 'capture file is not a version-1 game-stats recovery capture' };
  }
  const { year, week, seasonType, fetchStartedAt, gameIds } = record;
  if (typeof year !== 'number' || !Number.isSafeInteger(year)) {
    return { error: 'capture year is not an integer' };
  }
  if (typeof week !== 'number' || !Number.isSafeInteger(week)) {
    return { error: 'capture week is not an integer' };
  }
  if (seasonType !== 'regular' && seasonType !== 'postseason') {
    return { error: 'capture seasonType is not a provider partition' };
  }
  if (typeof fetchStartedAt !== 'string' || fetchStartedAt.length === 0) {
    return { error: 'capture fetchStartedAt is missing' };
  }
  if (
    !Array.isArray(gameIds) ||
    gameIds.length === 0 ||
    !gameIds.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
  ) {
    return { error: 'capture gameIds is not a nonempty list of provider game ids' };
  }
  return {
    kind: 'game-stats-recovery-capture',
    version: 1,
    year,
    week,
    seasonType,
    fetchStartedAt,
    gameIds: [...(gameIds as number[])],
    payload: record.payload,
  };
}

// === Evidence ===

/**
 * Evidence is built from the RAW category dictionaries, because those are the
 * unit H2 actually merges: a category is replaced only by a strictly
 * parse-valid newer value, and a category the newer observation OMITS is
 * preserved. Comparing normalized rows instead would be doubly wrong on the one
 * artifact the owner approves — `buildV2GameStats` falls absent categories back
 * to 0, so an omitted category would render as a real "1718 → 0" revision that
 * the merge will never perform; and the normalized surface covers a fraction of
 * the fields a merge can rewrite, so the table would also UNDERSTATE the write.
 *
 * Raw values are shown verbatim (`possessionTime` as `28:38`, not seconds) so
 * the report says exactly what is stored, with no derivation between the
 * evidence and the eye.
 */

export type CategoryDelta = {
  category: string;
  /** `null` when the category is absent from the stored row. */
  stored: string | null;
  /** `null` when the observation did not carry it — H2 PRESERVES the stored value. */
  observed: string | null;
};

export type SideEvidence = {
  side: 'home' | 'away';
  school: string;
  /** Present only when the points evidence itself differs. */
  points: { stored: number | null; observed: number | null } | null;
  deltas: CategoryDelta[];
};

export type GameEvidenceStatus =
  | 'differs'
  | 'identical'
  /** Stored, but the response carried no parseable row — nothing will change. */
  | 'not-observed'
  /** Not stored, but the response carries it — the merge will INSERT this game. */
  | 'will-insert'
  /** Neither stored nor observed. */
  | 'unknown';

export type GameEvidence = {
  providerGameId: number;
  status: GameEvidenceStatus;
  storedFence: string | null;
  label: string;
  sides: SideEvidence[];
};

type ObservedSide = { school: string; raw: Record<string, string>; points: number | null };
type ObservedGame = { home: ObservedSide; away: ObservedSide };

function sideDeltas(
  storedRaw: Record<string, string>,
  observedRaw: Record<string, string>
): CategoryDelta[] {
  const categories = [...new Set([...Object.keys(storedRaw), ...Object.keys(observedRaw)])].sort();
  const deltas: CategoryDelta[] = [];
  for (const category of categories) {
    const stored = Object.prototype.hasOwnProperty.call(storedRaw, category)
      ? storedRaw[category]!
      : null;
    const observed = Object.prototype.hasOwnProperty.call(observedRaw, category)
      ? observedRaw[category]!
      : null;
    if (stored !== observed) deltas.push({ category, stored, observed });
  }
  return deltas;
}

/**
 * A stored row read from untyped durable state proves nothing about its own
 * shape, so every access is guarded: a malformed element must never crash a
 * capture that has already spent a provider call.
 */
function storedSide(
  row: unknown,
  side: 'home' | 'away'
): { school: string; raw: Record<string, string>; points: number | null } | null {
  if (typeof row !== 'object' || row === null) return null;
  const value = (row as Record<string, unknown>)[side];
  if (typeof value !== 'object' || value === null) return null;
  const team = value as Record<string, unknown>;
  const raw: Record<string, string> = {};
  if (typeof team.raw === 'object' && team.raw !== null && !Array.isArray(team.raw)) {
    for (const [category, stat] of Object.entries(team.raw as Record<string, unknown>)) {
      if (typeof stat === 'string') raw[category] = stat;
    }
  }
  return {
    school: typeof team.school === 'string' ? team.school : '(unknown)',
    raw,
    points: team.pointsProvided === true && typeof team.points === 'number' ? team.points : null,
  };
}

function storedGameId(row: unknown): number | null {
  if (typeof row !== 'object' || row === null) return null;
  const id = (row as Record<string, unknown>).providerGameId;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function buildEvidence(params: {
  storedGames: readonly unknown[];
  payload: unknown;
  requestedIds: readonly number[];
}): GameEvidence[] {
  const { storedGames, payload, requestedIds } = params;

  const observedById = new Map<number, ObservedGame>();
  if (Array.isArray(payload)) {
    for (const row of payload) {
      const parsed = parseV2GameObservation(row);
      if (!parsed.ok) continue;
      const { observation } = parsed;
      if (!requestedIds.includes(observation.providerGameId)) continue;
      observedById.set(observation.providerGameId, {
        home: {
          school: observation.home.school,
          raw: observation.home.raw,
          points: observation.home.pointsProvided ? observation.home.points : null,
        },
        away: {
          school: observation.away.school,
          raw: observation.away.raw,
          points: observation.away.pointsProvided ? observation.away.points : null,
        },
      });
    }
  }

  const evidence: GameEvidence[] = [];
  for (const id of requestedIds) {
    const storedRow = storedGames.find((row) => storedGameId(row) === id) ?? null;
    const observed = observedById.get(id) ?? null;
    const storedHome = storedRow === null ? null : storedSide(storedRow, 'home');
    const storedAway = storedRow === null ? null : storedSide(storedRow, 'away');
    const label =
      storedHome && storedAway
        ? `${storedAway.school} at ${storedHome.school}`
        : observed
          ? `${observed.away.school} at ${observed.home.school}`
          : '(unknown)';
    const storedFence =
      storedRow !== null &&
      typeof (storedRow as Record<string, unknown>).fetchStartedAt === 'string'
        ? ((storedRow as Record<string, unknown>).fetchStartedAt as string)
        : null;

    if (storedHome === null || storedAway === null) {
      evidence.push({
        providerGameId: id,
        // A game the partition does not hold but the response carries is an
        // INSERT, not an unreachable row — the write does more than "nothing".
        status: observed === null ? 'unknown' : 'will-insert',
        storedFence,
        label,
        sides: [],
      });
      continue;
    }
    if (observed === null) {
      evidence.push({ providerGameId: id, status: 'not-observed', storedFence, label, sides: [] });
      continue;
    }

    const sides: SideEvidence[] = [];
    for (const side of ['home', 'away'] as const) {
      const stored = side === 'home' ? storedHome : storedAway;
      const deltas = sideDeltas(stored.raw, observed[side].raw);
      const storedPoints = stored.points;
      const observedPoints = observed[side].points;
      const points =
        storedPoints === observedPoints ? null : { stored: storedPoints, observed: observedPoints };
      if (deltas.length > 0 || points !== null) {
        sides.push({ side, school: stored.school, points, deltas });
      }
    }
    evidence.push({
      providerGameId: id,
      status: sides.length > 0 ? 'differs' : 'identical',
      storedFence,
      label,
      sides,
    });
  }
  return evidence;
}

export function renderEvidence(evidence: readonly GameEvidence[]): string {
  const lines: string[] = [];
  for (const game of evidence) {
    lines.push(`${game.providerGameId}  ${game.label}  [${game.status}]`);
    lines.push(`    stored fence: ${game.storedFence ?? '(none — legacy or absent row)'}`);
    if (game.status === 'not-observed') {
      lines.push('    the response carried no parseable row — this game will NOT change');
    }
    if (game.status === 'will-insert') {
      lines.push('    not in the durable partition — the merge will INSERT this game');
    }
    if (game.status === 'unknown') {
      lines.push('    neither stored nor observed — nothing to compare and nothing to write');
    }
    for (const side of game.sides) {
      if (side.points !== null) {
        lines.push(
          `    ${side.side.padEnd(4)} ${side.school}: points ` +
            `${side.points.stored ?? '(none)'} → ${side.points.observed ?? '(not observed)'}`
        );
      }
      for (const delta of side.deltas) {
        const observed =
          delta.observed === null ? '(not re-observed — stored value preserved)' : delta.observed;
        lines.push(
          `    ${side.side.padEnd(4)} ${side.school}: ${delta.category} ` +
            `${delta.stored ?? '(absent)'} → ${observed}`
        );
      }
    }
  }
  const count = (status: GameEvidenceStatus) =>
    evidence.filter((game) => game.status === status).length;
  lines.push(
    `\n${evidence.length} requested — ${count('differs')} differ, ${count('identical')} identical, ` +
      `${count('will-insert')} will be inserted, ${count('not-observed')} not re-observed, ` +
      `${count('unknown')} unknown`
  );
  return lines.join('\n');
}

// === Apply outcome ===

/**
 * Map the interpreter's verdict to an operator line and exit code. Every
 * outcome is reported for what it is: a failed observation reports as FAILED,
 * never as a no-op, and `indeterminate` is never collapsed into either.
 */
export function describeApplyOutcome(interpretation: GameStatsRefreshInterpretation): {
  line: string;
  code: number;
} {
  if (interpretation.durabilityUnknown) {
    return {
      line:
        `[apply] INDETERMINATE (${interpretation.reason}): the merge transaction's fate is ` +
        'unknown — the partition MAY have changed. REREAD it before any further action; do ' +
        'not retry and do not assume either state.',
      code: 4,
    };
  }
  if (interpretation.kind === 'failure') {
    return {
      line:
        `[apply] FAILED (${interpretation.reason}): nothing was committed and the prior-good ` +
        'partition is preserved.',
      code: interpretation.httpStatus === 503 ? 3 : 2,
    };
  }
  if (interpretation.kind === 'no-op') {
    // H2 calls this a no-op; for a REPAIR it is a refusal. `stale-clean` means
    // a newer observation already won and the replayed capture lost;
    // `unchanged-clean` means the named games hold this evidence already.
    // Either way nothing was repaired, so exit NONZERO — an operator chaining
    // `--apply && …` must not read an unperformed repair as a performed one.
    return {
      line:
        `[apply] NOT REPAIRED (${interpretation.reason}): nothing was written. ` +
        (interpretation.reason === 'stale-clean'
          ? 'The capture is OLDER than the stored observation — a newer writer got there first. ' +
            'Re-capture before retrying.'
          : 'The durable partition already carries exactly this evidence.'),
      code: 2,
    };
  }
  if (interpretation.kind === 'partial') {
    return {
      line:
        `[apply] PARTIAL (${interpretation.reason}): a durable commit occurred, but NOT every ` +
        'named game was repaired — check `unmatched` and the per-game lists above before ' +
        'treating this as done.',
      code: 2,
    };
  }
  return { line: `[apply] COMMITTED (${interpretation.reason}).`, code: 0 };
}

/**
 * Resolve the scoped provider-refresh attempt for one recovery, exactly once.
 *
 * Mirrors the manual route's resolution rules rather than inventing a second
 * vocabulary: only a CONFIRMED durable commit advances last-success, a partial
 * commit records `partialFailure`, a genuine no-op clears a stale error without
 * advancing last-success, and everything else is a truthful failure. Exported
 * so the binding status rule can be tested rather than assumed.
 */
export async function recordRecoveryAttemptOutcome(
  scope: ProviderRefreshScope,
  attempt: Awaited<ReturnType<typeof beginProviderRefreshAttempt>>,
  interpretation: GameStatsRefreshInterpretation,
  result: GameStatsIngestionResult
): Promise<void> {
  if (interpretation.advanceLastSuccess) {
    const merge = result.kind === 'merge-result' ? result.merge : null;
    const committedGames = merge
      ? merge.inserted.length + merge.updated.length + merge.refreshed.length
      : 0;
    const committedAt = new Date().toISOString();
    const commitSeq = nextProviderCommitSeq();
    if (interpretation.partialFailure) {
      await recordProviderRefreshSuccess('game-stats', scope, {
        attempt,
        committedAt,
        commitSeq,
        source: 'cfbd',
        rowsCommitted: committedGames,
        partialFailure: true,
      });
      return;
    }
    await recordProviderRefreshSuccess('game-stats', scope, {
      attempt,
      committedAt,
      commitSeq,
      source: 'cfbd',
      rowsCommitted: committedGames,
    });
    return;
  }
  if (interpretation.kind === 'no-op') {
    await recordProviderRefreshNoop('game-stats', scope, { attempt, source: 'cfbd' });
    return;
  }
  await recordProviderRefreshFailure('game-stats', scope, {
    attempt,
    error: `game-stats recovery failed: ${interpretation.reason}`,
    code: `game-stats-${interpretation.reason}`,
    status: interpretation.httpStatus,
  });
}

// === Durable read ===

type StoredRead =
  | { kind: 'ok'; games: readonly unknown[]; fetchedAt: string }
  /** The partition itself is unreadable or absent — a refusal, exit 2. */
  | { kind: 'unreadable'; detail: string }
  /** The STORE is down. Distinct from an unreadable record, and exit 3. */
  | { kind: 'store-unavailable'; detail: string };

async function readStoredGames(
  year: number,
  week: number,
  seasonType: CfbdSeasonType
): Promise<StoredRead> {
  let record: { value: unknown } | null;
  try {
    record = await getAppState<unknown>(GAME_STATS_SCOPE, getGameStatsKey(year, week, seasonType));
  } catch (error) {
    // `getAppState` THROWS on an unconfigured or failing store rather than
    // returning null. Without this catch the failure escaped to `main`'s
    // handler and exited 1, contradicting the documented exit 3.
    return {
      kind: 'store-unavailable',
      detail: error instanceof Error ? error.message : 'unknown store error',
    };
  }
  const validation = validateGameStatsEnvelope(record?.value ?? null, year, week, seasonType);
  if (validation.status !== 'ok') {
    return { kind: 'unreadable', detail: validation.status };
  }
  // `validateGameStatsEnvelope` proves `games` is an array, NOT that its
  // elements are well-formed rows — every consumer below guards element-wise.
  return {
    kind: 'ok',
    games: validation.record.games as readonly unknown[],
    fetchedAt: validation.record.fetchedAt,
  };
}

// === Modes ===

async function runCapture(args: CaptureArgs): Promise<number> {
  const pathError = checkCapturePathOutsideRepo(args.out);
  if (pathError) {
    console.error(`REFUSED: ${pathError.error}`);
    return 2;
  }

  const apiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!apiKey) {
    console.error('REFUSED: CFBD_API_KEY is not configured. No provider call was made.');
    return 3;
  }

  const stored = await readStoredGames(args.year, args.week, args.seasonType);
  if (stored.kind === 'store-unavailable') {
    console.error(
      `FAILED: durable store unavailable (${stored.detail}). No provider call was made.`
    );
    return 3;
  }
  if (stored.kind === 'unreadable') {
    console.error(
      `REFUSED: durable partition is not readable (${stored.detail}). No provider call was made.`
    );
    return 2;
  }

  // Quota gate BEFORE the partition request, through the shared policy the
  // admin route uses. Provider-reported usage is the truth and unknown usage is
  // never fabricated in either direction; the reserve's own 2-call margin
  // accounts for this `/info` probe. `--quota-override` is the only way past a
  // refusal, and it is recorded in the output rather than assumed.
  let usageSnapshot: CfbdUsageSnapshot;
  try {
    const usage = await fetchCfbdUsage({ fresh: true });
    usageSnapshot = { remainingCalls: usage.remaining, monthlyLimit: usage.limit };
  } catch {
    usageSnapshot = { remainingCalls: null };
  }
  const quota = evaluateManualQuota(usageSnapshot, args.quotaOverride);
  if (quota.kind === 'refused') {
    console.error(
      `REFUSED: CFBD quota policy (${quota.reason}); remaining ${quota.remaining ?? 'unknown'}. ` +
        'No partition request was made. Re-run with --quota-override to spend the reserve.'
    );
    return 2;
  }
  console.log(
    `[capture] quota: remaining ${quota.remaining ?? 'unknown'}` +
      (quota.kind === 'allowed-with-override' ? ` (OVERRIDDEN: ${quota.reason})` : '')
  );

  const url = buildCfbdGameTeamStatsUrl({
    year: args.year,
    week: args.week,
    seasonType: args.seasonType,
  });
  console.log(`[capture] partition request: ${url.toString()}`);
  const fetchStartedAt = new Date().toISOString();
  let payload: unknown;
  try {
    payload = await fetchUpstreamJson<unknown>(url.toString(), {
      cache: 'no-store',
      timeoutMs: 20_000,
      headers: { Authorization: `Bearer ${apiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    });
  } catch (error) {
    const detail =
      error instanceof UpstreamFetchError ? JSON.stringify(error.details) : String(error);
    console.error(`[capture] FAILED: provider request failed — ${detail}. Nothing was written.`);
    return 3;
  }

  const capture: RecoveryCapture = {
    kind: 'game-stats-recovery-capture',
    version: 1,
    year: args.year,
    week: args.week,
    seasonType: args.seasonType,
    fetchStartedAt,
    gameIds: args.gameIds,
    payload,
  };
  writeFileSync(path.resolve(args.out), `${JSON.stringify(capture, null, 2)}\n`, 'utf8');

  const rowCount = Array.isArray(payload) ? payload.length : 0;
  console.log(`[capture] observation fence: ${fetchStartedAt}`);
  console.log(
    `[capture] response rows: ${rowCount}; stored partition rows: ${stored.games.length}`
  );
  console.log(`[capture] written to ${path.resolve(args.out)} (outside the repository)`);
  console.log(`[capture] stored partition fetchedAt: ${stored.fetchedAt}`);
  console.log('\n=== before → after (raw provider categories vs cache) ===\n');
  console.log(
    renderEvidence(
      buildEvidence({ storedGames: stored.games, payload, requestedIds: args.gameIds })
    )
  );
  console.log('\nNo durable write occurred. Apply with: apply --capture <path> --apply');
  return 0;
}

async function runApply(args: ApplyArgs): Promise<number> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.resolve(args.capture), 'utf8'));
  } catch (error) {
    console.error(`REFUSED: capture file unreadable — ${String(error)}`);
    return 2;
  }
  const capture = parseCaptureFile(raw);
  if ('error' in capture) {
    console.error(`REFUSED: ${capture.error}`);
    return 2;
  }

  const stored = await readStoredGames(capture.year, capture.week, capture.seasonType);
  if (stored.kind === 'store-unavailable') {
    console.error(`FAILED: durable store unavailable (${stored.detail}). Nothing was written.`);
    return 3;
  }
  if (stored.kind === 'unreadable') {
    console.error(
      `REFUSED: durable partition is not readable (${stored.detail}). Nothing was written.`
    );
    return 2;
  }

  console.log(
    `[${args.apply ? 'apply' : 'dry-run'}] target ${GAME_STATS_SCOPE}/` +
      `${getGameStatsKey(capture.year, capture.week, capture.seasonType)}; ` +
      `bounded to ${capture.gameIds.length} game(s): ${capture.gameIds.join(', ')}`
  );
  console.log(`[${args.apply ? 'apply' : 'dry-run'}] replayed fence: ${capture.fetchStartedAt}`);
  console.log('\n=== before → after (raw provider categories vs cache) ===\n');
  console.log(
    renderEvidence(
      buildEvidence({
        storedGames: stored.games,
        payload: capture.payload,
        requestedIds: capture.gameIds,
      })
    )
  );

  if (!args.apply) {
    console.log('\n[dry-run] nothing was written. Re-run with --apply to commit.');
    return 0;
  }

  const mode = getAppStateStorageStatus().mode;
  console.log(`\nstorage mode: ${mode}`);
  if (mode !== 'postgres') {
    console.error('REFUSED: --apply requires a writable PostgreSQL store. Nothing was written.');
    return 3;
  }

  // This is a game-stats refresh ENTRY POINT, so it records a truthful scoped
  // attempt exactly like the route and cron (AGENTS.md → truthful
  // provider-refresh status). Without it a recovery commit, refusal, or
  // indeterminate result would leave the admin feed showing the last cron
  // outcome as current. The attempt begins BEFORE the merge and resolves
  // exactly once.
  const scope = weekPartitionScope(capture.year, capture.week, capture.seasonType);
  const attempt = await beginProviderRefreshAttempt('game-stats', scope, {
    startedAt: new Date().toISOString(),
  });

  const result = await ingestGameStatsPartitionResponse({
    year: capture.year,
    week: capture.week,
    seasonType: capture.seasonType,
    fetchStartedAt: capture.fetchStartedAt,
    payload: capture.payload,
    restrictToProviderGameIds: new Set(capture.gameIds),
  });
  const interpretation = interpretGameStatsRefreshOutcome(result);

  await recordRecoveryAttemptOutcome(scope, attempt, interpretation, result);

  if (result.kind === 'merge-result') {
    const { merge } = result;
    console.log(`merge outcome: ${merge.outcome}`);
    console.log(`  inserted:  ${merge.inserted.join(', ') || '(none)'}`);
    console.log(`  updated:   ${merge.updated.join(', ') || '(none)'}`);
    console.log(`  refreshed: ${merge.refreshed.join(', ') || '(none)'}`);
    console.log(`  unchanged: ${merge.unchanged.join(', ') || '(none)'}`);
    console.log(`  stale:     ${merge.stale.join(', ') || '(none)'}`);
    console.log(`  conflicts: ${JSON.stringify(merge.conflicts)}`);
    console.log(`  retained untouched: ${merge.retainedExisting.length} game(s)`);
    const unmatched = result.diagnostics.restriction?.unmatchedProviderGameIds ?? [];
    if (unmatched.length > 0) {
      console.log(`  NOT RE-OBSERVED (still unrepaired): ${unmatched.join(', ')}`);
    }
  }
  const described = describeApplyOutcome(interpretation);
  console.log(described.line);
  return described.code;
}

async function main(): Promise<void> {
  // `.env.local` carries CFBD_API_KEY; the production connection string lives in
  // `.env.operator.local`. Neither is created here and neither is printed.
  dotenv.config({ path: path.join(process.cwd(), '.env.local') });
  dotenv.config({ path: path.join(process.cwd(), '.env.operator.local') });
  dotenv.config();

  const parsed = parseRecoveryArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`REFUSED: ${parsed.error}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const code = parsed.mode === 'capture' ? await runCapture(parsed) : await runApply(parsed);
  // `process.exitCode`, never `process.exit`: on POSIX a stdout write to a pipe
  // or file is asynchronous and `process.exit` does not flush it, so
  // `… | tee capture.log` could lose the tail of the evidence table — the one
  // artifact this tool exists to produce.
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
