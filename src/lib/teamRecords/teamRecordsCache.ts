/** PLATFORM-117 — normalized, year-scoped CFBD team-record cache. */

import { getAppState } from '../server/appStateStore.ts';

export const TEAM_RECORDS_STATE_SCOPE = 'team-records';

export type TeamRecordClassification = 'fbs' | 'fcs' | 'ii' | 'iii';

export type TeamRecordTotal = {
  games: number;
  wins: number;
  losses: number;
  ties: number;
};

export type TeamRecordItem = {
  year: number;
  teamId: number;
  team: string;
  classification: TeamRecordClassification;
  conference: string | null;
  total: TeamRecordTotal;
};

export type TeamRecordsCacheEntry = {
  at: number;
  year: number;
  items: TeamRecordItem[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeClassification(value: unknown): TeamRecordClassification | null {
  return value === 'fbs' || value === 'fcs' || value === 'ii' || value === 'iii' ? value : null;
}

function normalizeTeamRecordItem(raw: unknown, year: number): TeamRecordItem | null {
  if (!isPlainObject(raw) || raw.year !== year) return null;
  const teamId = positiveInteger(raw.teamId);
  const team = optionalString(raw.team);
  const classification = normalizeClassification(raw.classification);
  if (teamId === null || team === null || classification === null || !isPlainObject(raw.total)) {
    return null;
  }
  const games = nonNegativeInteger(raw.total.games);
  const wins = nonNegativeInteger(raw.total.wins);
  const losses = nonNegativeInteger(raw.total.losses);
  const ties = nonNegativeInteger(raw.total.ties);
  if (games === null || wins === null || losses === null || ties === null) return null;
  if (wins + losses + ties > games) return null;
  return {
    year,
    teamId,
    team,
    classification,
    conference: optionalString(raw.conference),
    total: { games, wins, losses, ties },
  };
}

export type TeamRecordsPayloadNormalization =
  | { kind: 'rows'; items: TeamRecordItem[] }
  | { kind: 'invalid-payload' }
  | { kind: 'schema-drift' };

export function normalizeTeamRecordsPayload(
  payload: unknown,
  year: number
): TeamRecordsPayloadNormalization {
  if (!Array.isArray(payload)) return { kind: 'invalid-payload' };
  const byTeamId = new Map<number, TeamRecordItem>();
  for (const raw of payload) {
    const item = normalizeTeamRecordItem(raw, year);
    if (item && !byTeamId.has(item.teamId)) byTeamId.set(item.teamId, item);
  }
  if (payload.length > 0 && byTeamId.size === 0) return { kind: 'schema-drift' };
  return { kind: 'rows', items: [...byTeamId.values()].sort((a, b) => a.teamId - b.teamId) };
}

export function normalizeTeamRecordsCacheEntry(
  value: unknown,
  year: number
): TeamRecordsCacheEntry | null {
  if (!isPlainObject(value)) return null;
  if (
    value.year !== year ||
    typeof value.at !== 'number' ||
    !Number.isFinite(value.at) ||
    value.at < 0 ||
    !Array.isArray(value.items)
  ) {
    return null;
  }
  const items: TeamRecordItem[] = [];
  for (const raw of value.items) {
    const item = normalizeTeamRecordItem(raw, year);
    if (!item) return null;
    items.push(item);
  }
  return { at: value.at, year, items };
}

/** Cache-only future-consumer seam. Never calls CFBD. */
export async function readTeamRecordsCache(year: number): Promise<TeamRecordsCacheEntry | null> {
  const stored = await getAppState<unknown>(TEAM_RECORDS_STATE_SCOPE, String(year));
  return normalizeTeamRecordsCacheEntry(stored?.value, year);
}
