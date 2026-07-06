import { promises as fs } from 'node:fs';
import path from 'node:path';

import { cache } from 'react';

import type { TeamCatalogItem } from '../teamIdentity.ts';
import type { TeamDatabaseFile } from '../teamDatabase.ts';
import { normalizeTeamName } from '../teamNormalization.ts';
import { deleteAppState, getAppState, setAppState } from './appStateStore.ts';

type TeamCatalogSourceFile = {
  year?: number;
  items?: unknown;
};

let writeQueue: Promise<void> = Promise.resolve();

function teamDatabaseScope(): string {
  return 'team-database';
}

function sourceTeamsCatalogFile(): string {
  return path.join(process.cwd(), 'src', 'data', 'teams.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)
    : [];
}

function deriveCanonicalTeamId(school: string): string | null {
  // Storage-key normalization for catalog persistence only.
  // Team equivalence/matching should go through teamIdentity resolver helpers.
  return normalizeTeamName(school);
}

function toTeamCatalogItem(value: unknown): TeamCatalogItem | null {
  if (!isRecord(value)) return null;

  const school = toNullableString(value.school);
  if (!school) return null;

  return {
    id: toNullableString(value.id) ?? deriveCanonicalTeamId(school),
    providerId:
      typeof value.providerId === 'number' && Number.isFinite(value.providerId)
        ? value.providerId
        : null,
    school,
    displayName: toNullableString(value.displayName),
    shortDisplayName: toNullableString(value.shortDisplayName),
    abbreviation: toNullableString(value.abbreviation),
    mascot: toNullableString(value.mascot),
    level: toNullableString(value.level),
    subdivision: toNullableString(value.subdivision),
    conference: toNullableString(value.conference),
    classification: toNullableString(value.classification),
    color: toNullableString(value.color),
    altColor: toNullableString(value.altColor),
    logos: toStringArray(value.logos),
    alts: toStringArray(value.alts),
  };
}

function toTeamDatabaseFile(value: unknown): TeamDatabaseFile | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;

  const items = value.items
    .map(toTeamCatalogItem)
    .filter((item): item is TeamCatalogItem => !!item);

  return {
    source: value.source === 'cfbd' ? 'cfbd' : 'cfbd',
    updatedAt: toNullableString(value.updatedAt) ?? new Date(0).toISOString(),
    items,
  };
}

async function readSourceCatalogFallback(): Promise<TeamDatabaseFile> {
  try {
    const raw = await fs.readFile(sourceTeamsCatalogFile(), 'utf8');
    const parsed = JSON.parse(raw) as TeamCatalogSourceFile;
    const items = Array.isArray(parsed.items)
      ? parsed.items.map(toTeamCatalogItem).filter((item): item is TeamCatalogItem => !!item)
      : [];

    return {
      source: 'cfbd',
      updatedAt: new Date(0).toISOString(),
      items,
    };
  } catch {
    return {
      source: 'cfbd',
      updatedAt: new Date(0).toISOString(),
      items: [],
    };
  }
}

async function readStoreFile(): Promise<TeamDatabaseFile> {
  const record = await getAppState<TeamDatabaseFile>(teamDatabaseScope(), 'current');
  return toTeamDatabaseFile(record?.value) ?? (await readSourceCatalogFallback());
}

/**
 * Per-request memoization of the durable catalog read. `cache` dedups repeated
 * reads within a single render (standings, matchups, insights, etc. all resolve
 * to one durable read) while still re-reading the store on every NEW request.
 *
 * This intentionally replaces a former module-level singleton that cached the
 * catalog for the process lifetime. On a multi-instance deployment that singleton
 * let a warm instance keep serving its pre-sync catalog after ANOTHER instance
 * ran `POST /api/admin/team-database` — so a standings recompute (triggered by the
 * sync's tag invalidation) would repopulate the cache with stale team data,
 * defeating the invalidation (PLATFORM-070). `getAppState` reads the durable
 * store on every call, so a per-request cache observes cross-instance syncs on
 * the next request.
 */
const readTeamDatabaseFileForRequest = cache(readStoreFile);

export async function getTeamDatabaseFile(): Promise<TeamDatabaseFile> {
  return readTeamDatabaseFileForRequest();
}

export async function getTeamDatabaseItems(): Promise<TeamCatalogItem[]> {
  const file = await getTeamDatabaseFile();
  return file.items;
}

export async function setTeamDatabaseFile(file: TeamDatabaseFile): Promise<void> {
  // Writes go straight to the durable store. There is no process-local snapshot
  // to update — readers re-read the durable store per request (see
  // getTeamDatabaseFile), so cross-instance syncs are observed without a shared
  // in-memory cache to keep coherent.
  const writeOperation = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await setAppState(teamDatabaseScope(), 'current', file);
    });

  writeQueue = writeOperation.then(
    () => undefined,
    () => undefined
  );

  await writeOperation;
}

export function __resetTeamDatabaseStoreForTests(): void {
  // No process-local catalog cache remains; outside a React request `cache` does
  // not memoize, so each read already hits the durable store. Only the write
  // serialization queue needs resetting between tests.
  writeQueue = Promise.resolve();
}

export async function __deleteTeamDatabaseStoreFileForTests(): Promise<void> {
  await deleteAppState(teamDatabaseScope(), 'current');
}

export function __getTeamDatabaseStoreFilePathForTests(): string {
  return path.join(process.cwd(), 'data', 'team-database.json');
}

export function __setTeamDatabaseWriteImplForTests(
  impl?: (filePath: string, value: unknown) => Promise<void>
): void {
  void impl;
  // no-op: durability is abstracted through appStateStore in production hardening mode
}
