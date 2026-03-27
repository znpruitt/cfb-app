import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { TeamCatalogItem } from '../teamIdentity.ts';
import type { TeamDatabaseFile } from '../teamDatabase.ts';
import { normalizeTeamName } from '../teamNormalization.ts';
import { deleteAppState, getAppState, setAppState } from './appStateStore.ts';

type TeamCatalogSourceFile = {
  year?: number;
  items?: unknown;
};

let memoryStore: TeamDatabaseFile | null | undefined;
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

export async function getTeamDatabaseFile(): Promise<TeamDatabaseFile> {
  if (memoryStore !== undefined && memoryStore !== null) return memoryStore;
  const loaded = await readStoreFile();
  memoryStore = loaded;
  return loaded;
}

export async function getTeamDatabaseItems(): Promise<TeamCatalogItem[]> {
  const file = await getTeamDatabaseFile();
  return file.items;
}

export async function setTeamDatabaseFile(file: TeamDatabaseFile): Promise<void> {
  const writeOperation = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await setAppState(teamDatabaseScope(), 'current', file);
      memoryStore = file;
    });

  writeQueue = writeOperation.then(
    () => undefined,
    () => undefined
  );

  await writeOperation;
}

export function __resetTeamDatabaseStoreForTests(): void {
  memoryStore = undefined;
  writeQueue = Promise.resolve();
}

export async function __deleteTeamDatabaseStoreFileForTests(): Promise<void> {
  memoryStore = undefined;
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
