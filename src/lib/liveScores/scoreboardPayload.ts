import { isValidProviderGameId } from '@/lib/gameStats/contract';

/**
 * PLATFORM-086B1 — CFBD `/scoreboard` payload normalization.
 *
 * A focused, defensive normalizer so the raw provider shape never reaches the
 * route, cache, or UI. The audited scoreboard contract supplies, per game: a
 * provider game id, start time, a coarse status (`scheduled` | `in_progress` |
 * `completed`), period + clock, home/away numeric team ids and labels, and
 * home/away points. This module extracts ONLY those fields — weather, betting,
 * possession, situation, and last-play are intentionally dropped and never
 * persisted. Canonical year, provider week, canonical week, season type,
 * participants, and ownership are NEVER derived here (schedule owns them).
 */

export type ScoreboardStatus = 'scheduled' | 'in_progress' | 'completed';

export type NormalizedScoreboardRow = {
  /** Positive safe-integer CFBD provider game id — the only addressable form. */
  providerGameId: number;
  startDate: string | null;
  status: ScoreboardStatus;
  /** Live period (quarter) when the provider supplied a usable value, else null. */
  period: number | null;
  /** Live game clock string when supplied, else null. */
  clock: string | null;
  /** CFBD numeric home/away team ids (positive safe int) or null (legacy/absent). */
  homeId: number | null;
  awayId: number | null;
  homeTeam: string;
  awayTeam: string;
  homePoints: number | null;
  awayPoints: number | null;
};

export type ScoreboardNormalization =
  | { topLevel: 'non-array' }
  | { topLevel: 'array'; rawCount: number; rows: NormalizedScoreboardRow[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function toStatus(value: unknown): ScoreboardStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'scheduled') return 'scheduled';
  if (normalized === 'in_progress' || normalized === 'in progress') return 'in_progress';
  if (normalized === 'completed') return 'completed';
  return null;
}

function toStr(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPoints(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function toPeriod(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function toTeamId(value: unknown): number | null {
  return isValidProviderGameId(value) ? value : null;
}

/**
 * The provider game id: CFBD supplies a numeric `id`. Only a positive safe
 * integer is addressable; a string/float/negative/zero id is unusable and the
 * row is dropped (it can never be matched to a canonical schedule game).
 */
function toProviderGameId(value: unknown): number | null {
  return isValidProviderGameId(value) ? value : null;
}

/**
 * A scoreboard side object: `{ id, name/school, points }`. The label reads from
 * `name`, `school`, or `team`; the numeric id from `id` or `teamId`.
 */
function readSide(value: unknown): {
  id: number | null;
  label: string | null;
  points: number | null;
} {
  const record = asRecord(value);
  if (!record) return { id: null, label: null, points: null };
  return {
    id: toTeamId(record.id ?? record.teamId),
    label: toStr(record.name ?? record.school ?? record.team),
    points: toPoints(record.points),
  };
}

/**
 * Normalize ONE raw scoreboard entry, or null when it is not structurally
 * usable (no addressable provider game id, no recognizable status, or a missing
 * team label). Points may be null (a scheduled game carries none). Both the
 * nested-object side shape (`homeTeam: { name, id, points }`) and a few flat
 * fallbacks are accepted so a minor wire variation does not silently drop rows.
 */
export function normalizeScoreboardRow(input: unknown): NormalizedScoreboardRow | null {
  const record = asRecord(input);
  if (!record) return null;

  const providerGameId = toProviderGameId(record.id ?? record.gameId);
  if (providerGameId === null) return null;

  const status = toStatus(record.status);
  if (status === null) return null;

  const home = readSide(record.homeTeam ?? record.home);
  const away = readSide(record.awayTeam ?? record.away);
  const homeTeam = home.label ?? toStr(record.homeTeam) ?? toStr(record.home_team);
  const awayTeam = away.label ?? toStr(record.awayTeam) ?? toStr(record.away_team);
  if (!homeTeam || !awayTeam) return null;

  return {
    providerGameId,
    startDate: toStr(record.startDate ?? record.start_date),
    status,
    period: toPeriod(record.period),
    clock: toStr(record.clock),
    homeId: home.id,
    awayId: away.id,
    homeTeam,
    awayTeam,
    homePoints: home.points ?? toPoints(record.homePoints),
    awayPoints: away.points ?? toPoints(record.awayPoints),
  };
}

/**
 * Normalize a raw scoreboard payload. A non-array top level is reported as
 * `non-array` (the route classifies it `scoreboard-invalid-payload`); an array
 * returns its raw length plus the subset of structurally usable rows so the
 * route can distinguish schema drift (rows present, none usable) from a
 * genuinely empty array.
 */
export function normalizeScoreboardPayload(payload: unknown): ScoreboardNormalization {
  if (!Array.isArray(payload)) return { topLevel: 'non-array' };
  const rows: NormalizedScoreboardRow[] = [];
  for (const entry of payload) {
    const row = normalizeScoreboardRow(entry);
    if (row) rows.push(row);
  }
  return { topLevel: 'array', rawCount: payload.length, rows };
}

/**
 * The display status label for a normalized scoreboard row's ScorePack. Live
 * labels route through the central status classifier at read time
 * (`gameStatus.ts`), so they must be recognizable there:
 *   - `scheduled`   → 'scheduled';
 *   - `in_progress` → a live label using period + clock (`Q3 8:14`), overtime
 *                     (`OT`) beyond regulation, else `In Progress`;
 *   - `completed`   → 'final' ONLY when BOTH scores are present; a completed row
 *                     missing a score cannot prove a final, so it falls back to
 *                     `In Progress` (never a fabricated final).
 */
export function scoreboardStatusLabel(row: NormalizedScoreboardRow): string {
  if (row.status === 'scheduled') return 'scheduled';
  if (row.status === 'completed') {
    return row.homePoints !== null && row.awayPoints !== null ? 'final' : 'In Progress';
  }
  // in_progress
  if (row.period !== null && row.period > 4) return 'OT';
  if (row.period !== null && row.clock) {
    // Strip a single leading zero from the minutes for a clean `Q3 8:14` label;
    // the classifier matches `q\d` regardless.
    const clock = row.clock.replace(/^0+(?=\d)/, '');
    return `Q${row.period} ${clock}`;
  }
  return 'In Progress';
}

/** Whether a normalized scoreboard row asserts a confirmed final (both scores). */
export function isScoreboardFinal(row: NormalizedScoreboardRow): boolean {
  return row.status === 'completed' && row.homePoints !== null && row.awayPoints !== null;
}
