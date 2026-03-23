import aliasOverrides from '@/data/alias-overrides.json';

import { normalizeTeamName } from './teamNormalization.ts';
import type { TeamCatalogItem } from './teamIdentity.ts';

export type CfbdTeamRecord = {
  id?: number | null;
  school?: string | null;
  displayName?: string | null;
  shortDisplayName?: string | null;
  abbreviation?: string | null;
  mascot?: string | null;
  conference?: string | null;
  classification?: string | null;
  division?: string | null;
  color?: string | null;
  altColor?: string | null;
  logos?: string[] | null;
};

export type TeamDatabaseSyncSummary = {
  fetchedCount: number;
  writtenCount: number;
  updatedCount: number;
  withColorCount: number;
  withAltColorCount: number;
  missingColorCount: number;
  skippedCount: number;
  errors: string[];
};

export type TeamDatabaseFile = {
  source: 'cfbd';
  updatedAt: string;
  items: TeamCatalogItem[];
};

type AliasOverrideItem = {
  school: string;
  add?: string[];
  remove?: string[];
};

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function soft(value: string): string {
  return stripDiacritics(value).toLowerCase().trim();
}

function withoutUniversityPhrases(value: string): string {
  return value
    .replace(/\b(university|univ)\b/gi, ' ')
    .replace(/\bof\b/gi, ' ')
    .replace(/\band\b/gi, ' ')
    .replace(/&/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function swapStateAbbrev(value: string): string[] {
  if (!/state/i.test(value)) return [];
  const base = value
    .replace(/\bstate\b/gi, 'st')
    .replace(/\s+/g, ' ')
    .trim();
  return [base, base.replace(/\bst\b/gi, 'st.')];
}

function amVariants(value: string): string[] {
  if (!/a&m/i.test(value)) return [];
  return [value.replace(/a&m/gi, 'a and m'), value.replace(/a&m/gi, 'am')];
}

function knownShorts(school: string): string[] {
  const variants = new Map<string, string[]>([
    ['appalachian state', ['app state', 'app st']],
    ['san jose state', ['sjsu']],
    ['connecticut', ['uconn']],
    ['massachusetts', ['umass']],
    ['central florida', ['ucf']],
    ['brigham young', ['byu']],
    ['southern methodist', ['smu']],
    ['texas san antonio', ['utsa']],
    ['louisiana monroe', ['ul monroe']],
    ['southeastern louisiana', ['se louisiana']],
    ['albany', ['ualbany']],
    ['washington state', ['wash st']],
    ['colorado state', ['colorado st']],
  ]);

  return variants.get(soft(school)) ?? [];
}

export function buildDerivedTeamAliases(school: string, mascot?: string | null): string[] {
  const schoolSoft = soft(school);
  const schoolCompact = soft(withoutUniversityPhrases(school));
  const accentless = soft(stripDiacritics(school));
  const mascotSoft = mascot?.trim() ? soft(mascot) : null;

  const aliases = new Set<string>([
    schoolSoft,
    accentless,
    schoolCompact,
    ...knownShorts(school),
    ...swapStateAbbrev(school).map(soft),
    ...swapStateAbbrev(schoolCompact).map(soft),
    ...amVariants(school).map(soft),
    ...amVariants(schoolCompact).map(soft),
  ]);

  if (mascotSoft) {
    aliases.add(`${schoolSoft} ${mascotSoft}`);
    aliases.add(`${schoolCompact} ${mascotSoft}`);
  }

  for (const value of [...aliases]) {
    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) aliases.add(tokens.slice(0, 2).join(''));
    if (tokens.length >= 3) aliases.add(tokens.slice(0, 3).join(''));
  }

  return [...aliases].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function mergeAliasOverrides(items: TeamCatalogItem[]): TeamCatalogItem[] {
  const overrides = aliasOverrides as AliasOverrideItem[];
  if (!Array.isArray(overrides) || overrides.length === 0) return items;

  const bySchool = new Map(items.map((item) => [soft(item.school), item]));

  for (const override of overrides) {
    const target = bySchool.get(soft(override.school));
    if (!target) continue;

    const aliases = new Set((target.alts ?? []).map(soft));
    for (const value of override.add ?? []) aliases.add(soft(value));
    for (const value of override.remove ?? []) aliases.delete(soft(value));
    target.alts = [...aliases].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  return items;
}

function normalizeColor(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withoutHash = trimmed.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(withoutHash)) return null;
  return `#${withoutHash.toUpperCase()}`;
}

function pickLevel(record: CfbdTeamRecord): string | null {
  const candidates = [record.classification, record.division];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function normalizeCfbdTeamRecord(record: CfbdTeamRecord): {
  item: TeamCatalogItem | null;
  error?: string;
} {
  const school = record.school?.trim();
  if (!school) {
    return { item: null, error: 'missing school name' };
  }

  const canonicalId = normalizeTeamName(school);
  if (!canonicalId) {
    return { item: null, error: `unable to normalize team id for ${school}` };
  }

  return {
    item: {
      id: canonicalId,
      providerId: typeof record.id === 'number' && Number.isFinite(record.id) ? record.id : null,
      school,
      displayName: record.displayName?.trim() || null,
      shortDisplayName: record.shortDisplayName?.trim() || null,
      abbreviation: record.abbreviation?.trim() || null,
      mascot: record.mascot?.trim() || null,
      conference: record.conference?.trim() || null,
      level: pickLevel(record),
      classification: record.classification?.trim() || record.division?.trim() || null,
      color: normalizeColor(record.color),
      altColor: normalizeColor(record.altColor),
      logos: Array.isArray(record.logos)
        ? record.logos.map((logo) => logo?.trim()).filter((logo): logo is string => Boolean(logo))
        : [],
      alts: buildDerivedTeamAliases(school, record.mascot),
    },
  };
}

export function buildTeamDatabaseFile(params: {
  records: CfbdTeamRecord[];
  previousItems?: TeamCatalogItem[];
  updatedAt?: string;
}): { file: TeamDatabaseFile; summary: TeamDatabaseSyncSummary } {
  const previousById = new Map(
    (params.previousItems ?? []).map((item) => [item.id ?? normalizeTeamName(item.school), item])
  );
  const items: TeamCatalogItem[] = [];
  const errors: string[] = [];
  let withColorCount = 0;
  let withAltColorCount = 0;

  for (const [index, record] of params.records.entries()) {
    const normalized = normalizeCfbdTeamRecord(record);
    if (!normalized.item) {
      errors.push(`row ${index + 1}: ${normalized.error ?? 'unknown normalization failure'}`);
      continue;
    }

    if (normalized.item.color) withColorCount += 1;
    if (normalized.item.altColor) withAltColorCount += 1;
    items.push(normalized.item);
  }

  mergeAliasOverrides(items);
  items.sort((a, b) => a.school.localeCompare(b.school));

  let updatedCount = 0;
  for (const item of items) {
    const previous = previousById.get(item.id ?? normalizeTeamName(item.school));
    if (!previous || JSON.stringify(previous) !== JSON.stringify(item)) {
      updatedCount += 1;
    }
  }

  return {
    file: {
      source: 'cfbd',
      updatedAt: params.updatedAt ?? new Date().toISOString(),
      items,
    },
    summary: {
      fetchedCount: params.records.length,
      writtenCount: items.length,
      updatedCount,
      withColorCount,
      withAltColorCount,
      missingColorCount: items.length - withColorCount,
      skippedCount: params.records.length - items.length,
      errors,
    },
  };
}
