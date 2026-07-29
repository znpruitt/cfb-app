/**
 * PLATFORM-086E1C1 — normalized schedule PRESENTATION models (game media + venue
 * catalog) and their provider-payload normalization.
 *
 * These are OPTIONAL presentation overlays on the canonical schedule: the
 * canonical schedule remains authoritative for game existence, identity,
 * participants, kickoff, lifecycle, postseason structure, standings, and
 * rollover. Media attaches ONLY through the exact numeric CFBD game id; venue
 * details attach ONLY through the exact numeric `venueId` — never team labels,
 * aliases, kickoff, venue name, array position, or fuzzy identity.
 *
 * Persistence allowlist: ONLY the normalized fields below are ever persisted —
 * never raw provider rows, request/response objects, headers, URLs, errors, or
 * environment values, and never weather, attendance, scores, betting,
 * highlights, coordinates, ZIP code, elevation, or construction year. Media
 * `startTime`/`isStartTimeTBD` are deliberately NOT modeled: the canonical
 * `/games` schedule fields remain the only kickoff-time truth.
 *
 * This module is intentionally free of server-only imports so the pure models
 * and normalizers are shareable with tests and (types only) the client.
 */

/** Closed media-type union. Anything else is structurally unusable. */
export type ScheduleMediaType = 'tv' | 'radio' | 'web' | 'ppv' | 'mobile';

export type ScheduleMediaItem = {
  /** Canonical decimal string of the CFBD numeric game id (matches `ScheduleItem.id`). */
  gameId: string;
  mediaType: ScheduleMediaType;
  outlet: string;
};

export type VenueCatalogItem = {
  id: number;
  name: string | null;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  timezone: string | null;
  capacity: number | null;
  grass: boolean | null;
  dome: boolean | null;
};

export type ScheduleMediaCacheEntry = {
  at: number;
  items: ScheduleMediaItem[];
};

export type VenueCatalogCacheEntry = {
  at: number;
  items: VenueCatalogItem[];
};

/** Durable app-state scope/key layout: `schedule-media/<year>-all`. */
export const SCHEDULE_MEDIA_STATE_SCOPE = 'schedule-media';
export function scheduleMediaStateKey(year: number): string {
  return `${year}-all`;
}

/** Durable app-state scope/key layout: `venue-catalog/current`. */
export const VENUE_CATALOG_STATE_SCOPE = 'venue-catalog';
export const VENUE_CATALOG_STATE_KEY = 'current';

const MEDIA_TYPES: readonly ScheduleMediaType[] = ['tv', 'radio', 'web', 'ppv', 'mobile'];

/**
 * Deterministic display priority for choosing ONE primary outlet
 * (tv → web → ppv → mobile → radio). Shared by the presentation helper.
 */
export const MEDIA_TYPE_DISPLAY_PRIORITY: readonly ScheduleMediaType[] = [
  'tv',
  'web',
  'ppv',
  'mobile',
  'radio',
];

function normalizeMediaType(value: unknown): ScheduleMediaType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return (MEDIA_TYPES as readonly string[]).includes(normalized)
    ? (normalized as ScheduleMediaType)
    : null;
}

/**
 * Normalize a provider numeric id to its canonical decimal-string form, or null.
 * Strict grammar (mirrors the canonical schedule's participant-id rule): a
 * positive safe-integer number, or a canonical decimal-digit string collapsing
 * to one. Zero, negatives, fractions, exponent/hex/signed forms, unsafe
 * integers, and blanks are rejected.
 */
function normalizeProviderIdString(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
  }
  return null;
}

function normalizeProviderIdNumber(value: unknown): number | null {
  const asString = normalizeProviderIdString(value);
  return asString == null ? null : Number(asString);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeCapacity(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Raw CFBD `/games/media` row — documented camelCase plus defensive snake_case. */
type RawMediaRow = {
  id?: unknown;
  gameId?: unknown;
  game_id?: unknown;
  mediaType?: unknown;
  media_type?: unknown;
  outlet?: unknown;
};

/**
 * Normalize ONE raw media row to the allowlisted model, or null when it is
 * structurally unusable (no valid numeric game id, unknown/blank media type, or
 * a blank outlet).
 */
export function normalizeScheduleMediaRow(raw: unknown): ScheduleMediaItem | null {
  if (!isPlainObject(raw)) return null;
  const row = raw as RawMediaRow;
  const gameId = normalizeProviderIdString(row.id ?? row.gameId ?? row.game_id);
  if (gameId == null) return null;
  const mediaType = normalizeMediaType(row.mediaType ?? row.media_type);
  if (mediaType == null) return null;
  const outlet = normalizeOptionalString(row.outlet);
  if (outlet == null) return null;
  return { gameId, mediaType, outlet };
}

export type ScheduleMediaNormalization =
  | { kind: 'rows'; items: ScheduleMediaItem[]; usableRows: number }
  | { kind: 'invalid-payload' }
  | { kind: 'schema-drift' };

function compareMediaItems(a: ScheduleMediaItem, b: ScheduleMediaItem): number {
  const byGame = Number(a.gameId) - Number(b.gameId);
  if (byGame !== 0) return byGame;
  const byType =
    MEDIA_TYPE_DISPLAY_PRIORITY.indexOf(a.mediaType) -
    MEDIA_TYPE_DISPLAY_PRIORITY.indexOf(b.mediaType);
  if (byType !== 0) return byType;
  return a.outlet.toLowerCase().localeCompare(b.outlet.toLowerCase());
}

/**
 * Normalize a full CFBD `/games/media` payload against the canonical schedule's
 * eligible game-id set:
 *   - a non-array payload is `invalid-payload` (uncertainty, never absence);
 *   - a NONEMPTY payload with ZERO structurally usable rows is `schema-drift`
 *     (assessed BEFORE the eligibility filter, so a shape change is never
 *     misread as "no tracked games had media");
 *   - otherwise `rows`: usable rows filtered to EXACT canonical game ids,
 *     deduplicated by `(gameId, mediaType, case-insensitive outlet)` — the first
 *     occurrence's outlet casing wins — and deterministically sorted. Multiple
 *     legitimate outlets for one game all survive.
 * `usableRows` reports the structurally usable rows received PRE-filter (the
 * authority's `rowsReceived`); `items` is the post-filter committed target.
 */
export function normalizeScheduleMediaPayload(
  payload: unknown,
  eligibleGameIds: ReadonlySet<string>
): ScheduleMediaNormalization {
  if (!Array.isArray(payload)) return { kind: 'invalid-payload' };
  const usable: ScheduleMediaItem[] = [];
  for (const raw of payload) {
    const normalized = normalizeScheduleMediaRow(raw);
    if (normalized) usable.push(normalized);
  }
  if (payload.length > 0 && usable.length === 0) return { kind: 'schema-drift' };

  const seen = new Set<string>();
  const items: ScheduleMediaItem[] = [];
  for (const item of usable) {
    if (!eligibleGameIds.has(item.gameId)) continue;
    const dedupeKey = `${item.gameId}|${item.mediaType}|${item.outlet.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    items.push(item);
  }
  items.sort(compareMediaItems);
  return { kind: 'rows', items, usableRows: usable.length };
}

/** Raw CFBD `/venues` row — documented camelCase plus defensive snake_case. */
type RawVenueRow = {
  id?: unknown;
  name?: unknown;
  city?: unknown;
  state?: unknown;
  countryCode?: unknown;
  country_code?: unknown;
  timezone?: unknown;
  capacity?: unknown;
  grass?: unknown;
  dome?: unknown;
};

/**
 * Normalize ONE raw venue row to the allowlisted model, or null when it has no
 * valid numeric id. Excluded provider fields (zip, coordinates, elevation,
 * construction year, …) are simply never read.
 */
export function normalizeVenueCatalogRow(raw: unknown): VenueCatalogItem | null {
  if (!isPlainObject(raw)) return null;
  const row = raw as RawVenueRow;
  const id = normalizeProviderIdNumber(row.id);
  if (id == null) return null;
  return {
    id,
    name: normalizeOptionalString(row.name),
    city: normalizeOptionalString(row.city),
    state: normalizeOptionalString(row.state),
    countryCode: normalizeOptionalString(row.countryCode ?? row.country_code),
    timezone: normalizeOptionalString(row.timezone),
    capacity: normalizeCapacity(row.capacity),
    grass: normalizeOptionalBoolean(row.grass),
    dome: normalizeOptionalBoolean(row.dome),
  };
}

export type VenueCatalogNormalization =
  | { kind: 'rows'; items: VenueCatalogItem[]; usableRows: number }
  | { kind: 'invalid-payload' }
  | { kind: 'schema-drift' };

function venueRowsEqual(a: VenueCatalogItem, b: VenueCatalogItem): boolean {
  return (
    a.name === b.name &&
    a.city === b.city &&
    a.state === b.state &&
    a.countryCode === b.countryCode &&
    a.timezone === b.timezone &&
    a.capacity === b.capacity &&
    a.grass === b.grass &&
    a.dome === b.dome
  );
}

/**
 * Normalize a full CFBD `/venues` payload:
 *   - a non-array payload is `invalid-payload`;
 *   - a NONEMPTY payload with ZERO structurally usable rows is `schema-drift`;
 *   - IDENTICAL duplicate rows for one venue id collapse to one; CONFLICTING
 *     rows for the same venue id make the whole payload `invalid-payload` —
 *     the normalizer never chooses between contradictory provider rows;
 *   - otherwise `rows`, sorted by venue id. The GLOBAL catalog is stored, not
 *     only the venues a particular year references.
 */
export function normalizeVenueCatalogPayload(payload: unknown): VenueCatalogNormalization {
  if (!Array.isArray(payload)) return { kind: 'invalid-payload' };
  const usable: VenueCatalogItem[] = [];
  for (const raw of payload) {
    const normalized = normalizeVenueCatalogRow(raw);
    if (normalized) usable.push(normalized);
  }
  if (payload.length > 0 && usable.length === 0) return { kind: 'schema-drift' };

  const byId = new Map<number, VenueCatalogItem>();
  for (const item of usable) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    if (!venueRowsEqual(existing, item)) return { kind: 'invalid-payload' };
  }
  const items = Array.from(byId.values()).sort((a, b) => a.id - b.id);
  return { kind: 'rows', items, usableRows: usable.length };
}

/** A stored value is a usable media cache entry only with a real items array. */
export function normalizeScheduleMediaCacheEntry(value: unknown): ScheduleMediaCacheEntry | null {
  if (!isPlainObject(value)) return null;
  const candidate = value as Partial<ScheduleMediaCacheEntry>;
  if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) return null;
  if (!Array.isArray(candidate.items)) return null;
  return { at: candidate.at, items: candidate.items };
}

/** A stored value is a usable venue cache entry only with a real items array. */
export function normalizeVenueCatalogCacheEntry(value: unknown): VenueCatalogCacheEntry | null {
  if (!isPlainObject(value)) return null;
  const candidate = value as Partial<VenueCatalogCacheEntry>;
  if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) return null;
  if (!Array.isArray(candidate.items)) return null;
  return { at: candidate.at, items: candidate.items };
}
