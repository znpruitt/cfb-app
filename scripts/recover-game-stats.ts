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
//   # 1. CAPTURE — exactly ONE CFBD call, no durable write of any kind.
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
// Exit codes: 0 = capture written / dry run valid / merge committed;
//             2 = refused (bad arguments, empty or unmatched game-id set,
//                 capture path inside the repo, malformed capture — nothing
//                 fetched and nothing written);
//             3 = store or provider unavailable (no durable change occurred);
//             4 = INDETERMINATE durability — the merge transaction's fate is
//                 unknown. REREAD the partition before any further action;
//                 never retry blindly;
//             1 = unexpected error.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import dotenv from 'dotenv';

import { fetchUpstreamJson, UpstreamFetchError } from '../src/lib/api/fetchUpstream.ts';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '../src/lib/cfbd.ts';
import { GAME_STATS_SCOPE, getGameStatsKey } from '../src/lib/gameStats/cache.ts';
import { buildV2GameStats, parseV2GameObservation } from '../src/lib/gameStats/contract.ts';
import { ingestGameStatsPartitionResponse } from '../src/lib/gameStats/ingestionCoordinator.ts';
import { validateGameStatsEnvelope } from '../src/lib/gameStats/publicProjection.ts';
import { interpretGameStatsRefreshOutcome } from '../src/lib/gameStats/refreshOutcome.ts';
import type { GameStatsRefreshInterpretation } from '../src/lib/gameStats/refreshOutcome.ts';
import type { GameStats, TeamGameStats } from '../src/lib/gameStats/types.ts';
import { getAppState, getAppStateStorageStatus } from '../src/lib/server/appStateStore.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE =
  'usage: tsx scripts/recover-game-stats.ts capture --year <n> --week <n> ' +
  '--season-type <regular|postseason> --game-ids <id,id,...> --out <path outside the repo>\n' +
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
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--apply') {
      applyFlag = true;
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
  repoRoot: string = REPO_ROOT
): { error: string } | null {
  const resolved = path.resolve(outPath);
  const root = path.resolve(repoRoot);
  const relative = path.relative(root, resolved);
  const inside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (!inside) return null;
  return {
    error:
      `--out resolves inside the repository (${resolved}). A captured CFBD payload must ` +
      'never be committable: write it outside the working tree.',
  };
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

/** The normalized fields the evidence table compares, in report order. */
const COMPARED_FIELDS = [
  'points',
  'totalYards',
  'rushingYards',
  'passingYards',
  'rushingAttempts',
  'passingAttempts',
  'passingCompletions',
  'firstDowns',
  'turnovers',
  'possessionSeconds',
] as const satisfies ReadonlyArray<keyof TeamGameStats>;

export type FieldDelta = { field: string; stored: number; observed: number };

export type SideEvidence = {
  side: 'home' | 'away';
  school: string;
  deltas: FieldDelta[];
};

export type GameEvidence = {
  providerGameId: number;
  /** `absent` when the response carried no parseable row for this requested id. */
  status: 'differs' | 'identical' | 'absent' | 'unstored';
  storedFence: string | null;
  label: string;
  sides: SideEvidence[];
};

function sideDeltas(stored: TeamGameStats, observed: TeamGameStats): FieldDelta[] {
  const deltas: FieldDelta[] = [];
  for (const field of COMPARED_FIELDS) {
    const before = stored[field];
    const after = observed[field];
    if (typeof before === 'number' && typeof after === 'number' && before !== after) {
      deltas.push({ field, stored: before, observed: after });
    }
  }
  return deltas;
}

/**
 * Compare each requested game's STORED normalized row against the row H1 builds
 * from the newly observed provider payload.
 *
 * This is a provider-observation-versus-cache comparison, NOT a prediction of
 * the row the merge will write: H2's field-level merge is conservative and
 * preserves categories the newer observation omits, so an accepted update can
 * legitimately retain a stored value this table shows as differing. The table
 * establishes that the cache disagrees with the newer authoritative
 * observation — the same claim the audit made — and nothing more.
 */
export function buildEvidence(params: {
  storedGames: readonly GameStats[];
  payload: unknown;
  requestedIds: readonly number[];
  week: number;
  seasonType: CfbdSeasonType;
}): GameEvidence[] {
  const { storedGames, payload, requestedIds, week, seasonType } = params;
  const observedById = new Map<number, GameStats>();
  if (Array.isArray(payload)) {
    for (const row of payload) {
      const parsed = parseV2GameObservation(row);
      if (!parsed.ok) continue;
      if (!requestedIds.includes(parsed.observation.providerGameId)) continue;
      observedById.set(
        parsed.observation.providerGameId,
        buildV2GameStats(parsed.observation, week, seasonType)
      );
    }
  }

  const evidence: GameEvidence[] = [];
  for (const id of requestedIds) {
    const stored = storedGames.find((game) => game.providerGameId === id) ?? null;
    const observed = observedById.get(id) ?? null;
    const label = stored
      ? `${stored.away.school} at ${stored.home.school}`
      : observed
        ? `${observed.away.school} at ${observed.home.school}`
        : '(unknown)';
    if (stored === null) {
      evidence.push({
        providerGameId: id,
        status: 'unstored',
        storedFence: null,
        label,
        sides: [],
      });
      continue;
    }
    if (observed === null) {
      evidence.push({
        providerGameId: id,
        status: 'absent',
        storedFence: stored.fetchStartedAt ?? null,
        label,
        sides: [],
      });
      continue;
    }
    const sides: SideEvidence[] = [];
    for (const side of ['home', 'away'] as const) {
      const deltas = sideDeltas(stored[side], observed[side]);
      if (deltas.length > 0) {
        sides.push({ side, school: stored[side].school, deltas });
      }
    }
    evidence.push({
      providerGameId: id,
      status: sides.length > 0 ? 'differs' : 'identical',
      storedFence: stored.fetchStartedAt ?? null,
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
    lines.push(`    stored fence: ${game.storedFence ?? '(none — legacy row)'}`);
    if (game.status === 'absent') {
      lines.push('    the response carried no parseable row for this id');
    }
    if (game.status === 'unstored') {
      lines.push('    no stored row for this id in the durable partition');
    }
    for (const side of game.sides) {
      for (const delta of side.deltas) {
        lines.push(
          `    ${side.side.padEnd(4)} ${side.school}: ${delta.field} ` +
            `${delta.stored} → ${delta.observed}`
        );
      }
    }
  }
  const differing = evidence.filter((game) => game.status === 'differs').length;
  const identical = evidence.filter((game) => game.status === 'identical').length;
  const missing = evidence.filter(
    (game) => game.status === 'absent' || game.status === 'unstored'
  ).length;
  lines.push(
    `\n${evidence.length} requested — ${differing} differ, ${identical} identical, ${missing} unreachable`
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
    return {
      line:
        `[apply] NO-OP (${interpretation.reason}): the durable partition already carries this ` +
        'evidence. Nothing was written.',
      code: 0,
    };
  }
  if (interpretation.kind === 'partial') {
    return {
      line:
        `[apply] PARTIAL (${interpretation.reason}): a durable commit occurred, but the batch ` +
        'did not merge cleanly. Reread the partition and check the per-game lists above.',
      code: 0,
    };
  }
  return { line: `[apply] COMMITTED (${interpretation.reason}).`, code: 0 };
}

// === Durable read ===

async function readStoredGames(
  year: number,
  week: number,
  seasonType: CfbdSeasonType
): Promise<{ games: GameStats[]; fetchedAt: string } | { error: string }> {
  const record = await getAppState<unknown>(
    GAME_STATS_SCOPE,
    getGameStatsKey(year, week, seasonType)
  );
  const validation = validateGameStatsEnvelope(record?.value ?? null, year, week, seasonType);
  if (validation.status !== 'ok') {
    return { error: `durable partition is not readable (${validation.status})` };
  }
  return { games: validation.record.games, fetchedAt: validation.record.fetchedAt };
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
  if ('error' in stored) {
    console.error(`REFUSED: ${stored.error}. No provider call was made.`);
    return 2;
  }

  const url = buildCfbdGameTeamStatsUrl({
    year: args.year,
    week: args.week,
    seasonType: args.seasonType,
  });
  console.log(`[capture] ONE CFBD request: ${url.toString()}`);
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
  console.log('\n=== before → after (provider observation vs cache) ===\n');
  console.log(
    renderEvidence(
      buildEvidence({
        storedGames: stored.games,
        payload,
        requestedIds: args.gameIds,
        week: args.week,
        seasonType: args.seasonType,
      })
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
  if ('error' in stored) {
    console.error(`REFUSED: ${stored.error}. Nothing was written.`);
    return 2;
  }

  console.log(
    `[${args.apply ? 'apply' : 'dry-run'}] target ${GAME_STATS_SCOPE}/` +
      `${getGameStatsKey(capture.year, capture.week, capture.seasonType)}; ` +
      `bounded to ${capture.gameIds.length} game(s): ${capture.gameIds.join(', ')}`
  );
  console.log(`[${args.apply ? 'apply' : 'dry-run'}] replayed fence: ${capture.fetchStartedAt}`);
  console.log('\n=== before → after (provider observation vs cache) ===\n');
  console.log(
    renderEvidence(
      buildEvidence({
        storedGames: stored.games,
        payload: capture.payload,
        requestedIds: capture.gameIds,
        week: capture.week,
        seasonType: capture.seasonType,
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

  const result = await ingestGameStatsPartitionResponse({
    year: capture.year,
    week: capture.week,
    seasonType: capture.seasonType,
    fetchStartedAt: capture.fetchStartedAt,
    payload: capture.payload,
    restrictToProviderGameIds: new Set(capture.gameIds),
  });
  const interpretation = interpretGameStatsRefreshOutcome(result);
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
    process.exit(2);
  }
  const code = parsed.mode === 'capture' ? await runCapture(parsed) : await runApply(parsed);
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
