/**
 * PLATFORM-086E1C1 — the CACHE-ONLY schedule-presentation response join.
 *
 * One shared helper enriches every successful `/api/schedule` response path —
 * fresh process hits, durable hits, stale prior-good responses, composed
 * week/all responses, targeted refresh responses, and full-year refresh
 * responses — from the durable presentation caches:
 *
 *   canonical ScheduleItem[]
 *   + schedule-media/<year>-all   (join by EXACT item.id)
 *   + venue-catalog/current      (join by EXACT item.venueId)
 *   → presentation-enriched schedule wire items
 *
 * Guarantees:
 *   - strictly provider-free: durable reads through a bounded (~120 s) process
 *     memo only — never a provider call, never a refresh;
 *   - the canonical `schedule/*` durable records and the input items are NEVER
 *     mutated — enrichment builds new objects;
 *   - a missing media/venue cache yields ordinary base schedule rows; a genuine
 *     presentation-cache read failure serves base rows and logs only a generic
 *     diagnostic (never failing `/api/schedule`);
 *   - the full venue catalog is never sent to the browser — only the joined
 *     per-item venue display fields (name/city/state/country code); cached
 *     capacity/surface/dome/timezone stay server-side for future use.
 */

import { getAppState } from '../server/appStateStore.ts';
import type { ScheduleItem, VenueInfo } from './cfbdSchedule.ts';
import {
  normalizeScheduleMediaCacheEntry,
  normalizeVenueCatalogCacheEntry,
  scheduleMediaStateKey,
  SCHEDULE_MEDIA_STATE_SCOPE,
  VENUE_CATALOG_STATE_KEY,
  VENUE_CATALOG_STATE_SCOPE,
  type ScheduleMediaCacheEntry,
  type ScheduleMediaItem,
  type VenueCatalogCacheEntry,
  type VenueCatalogItem,
} from './schedulePresentation.ts';

/**
 * The presentation-enriched wire shape `/api/schedule` serves. `media` is an
 * OPTIONAL wire/application-model field — it is never part of the durable
 * canonical {@link ScheduleItem} records.
 */
export type PresentationEnrichedScheduleItem = ScheduleItem & {
  media?: ScheduleMediaItem[];
};

/** Bounded cross-request memo so response joins stay cheap without going stale. */
export const SCHEDULE_PRESENTATION_MEMO_TTL_MS = 120_000;

type MemoSlot<T> = { at: number; value: T | null };

const mediaMemoByYear = new Map<number, MemoSlot<ScheduleMediaCacheEntry>>();
let venueCatalogMemo: MemoSlot<VenueCatalogCacheEntry> | null = null;

export function __resetSchedulePresentationMemoForTests(): void {
  mediaMemoByYear.clear();
  venueCatalogMemo = null;
}

/**
 * Publish a confirmed durable media entry into the memo. GUARDED so a
 * publication can never regress the memo below an already-published fresher
 * entry (two racing refreshes publish in commit order or better).
 */
export function publishScheduleMediaMemo(year: number, entry: ScheduleMediaCacheEntry): void {
  const current = mediaMemoByYear.get(year);
  if (current?.value && current.value.at > entry.at) return;
  mediaMemoByYear.set(year, { at: Date.now(), value: entry });
}

/** Publish a confirmed durable venue-catalog entry into the memo (guarded). */
export function publishVenueCatalogMemo(entry: VenueCatalogCacheEntry): void {
  if (venueCatalogMemo?.value && venueCatalogMemo.value.at > entry.at) return;
  venueCatalogMemo = { at: Date.now(), value: entry };
}

function isMemoFresh(slot: MemoSlot<unknown> | null | undefined, now: number): boolean {
  return Boolean(slot && now - slot.at < SCHEDULE_PRESENTATION_MEMO_TTL_MS);
}

async function loadScheduleMediaEntry(params: {
  year: number;
  now: number;
  forceDurable: boolean;
}): Promise<ScheduleMediaCacheEntry | null> {
  const { year, now, forceDurable } = params;
  const memo = mediaMemoByYear.get(year);
  if (!forceDurable && isMemoFresh(memo, now)) return memo!.value;
  try {
    const stored = await getAppState<unknown>(
      SCHEDULE_MEDIA_STATE_SCOPE,
      scheduleMediaStateKey(year)
    );
    const entry = normalizeScheduleMediaCacheEntry(stored?.value);
    // Regression-guarded like the publish helpers: a durable read that RACED an
    // in-flight commit (read began before, resolved after the guarded publish)
    // must not roll the memo back below the fresher published entry. A durable
    // ABSENCE (null) still wins — deletion is authoritative.
    const fresher = memo?.value && entry && memo.value.at > entry.at ? memo.value : entry;
    mediaMemoByYear.set(year, { at: now, value: fresher });
    return fresher;
  } catch {
    // Generic diagnostic only — no error detail, payload, or key material.
    console.warn('schedule-presentation: media cache read failed; serving base schedule rows');
    return memo?.value ?? null;
  }
}

async function loadVenueCatalogEntry(params: {
  now: number;
  forceDurable: boolean;
}): Promise<VenueCatalogCacheEntry | null> {
  const { now, forceDurable } = params;
  if (!forceDurable && isMemoFresh(venueCatalogMemo, now)) return venueCatalogMemo!.value;
  try {
    const stored = await getAppState<unknown>(VENUE_CATALOG_STATE_SCOPE, VENUE_CATALOG_STATE_KEY);
    const entry = normalizeVenueCatalogCacheEntry(stored?.value);
    // Same regression guard as the media loader (see above).
    const fresher =
      venueCatalogMemo?.value && entry && venueCatalogMemo.value.at > entry.at
        ? venueCatalogMemo.value
        : entry;
    venueCatalogMemo = { at: now, value: fresher };
    return fresher;
  } catch {
    console.warn('schedule-presentation: venue cache read failed; serving base schedule rows');
    return venueCatalogMemo?.value ?? null;
  }
}

function baseVenueInfo(venue: ScheduleItem['venue']): VenueInfo {
  if (venue && typeof venue === 'object') {
    return {
      stadium: venue.stadium ?? null,
      city: venue.city ?? null,
      state: venue.state ?? null,
      country: venue.country ?? null,
    };
  }
  if (typeof venue === 'string' && venue.trim().length > 0) {
    return { stadium: venue, city: null, state: null, country: null };
  }
  return { stadium: null, city: null, state: null, country: null };
}

/**
 * Fill the row's venue display fields from an exact catalog match. Nonblank
 * catalog values win; the schedule row's existing values are preserved wherever
 * the catalog has none. (Catalog values are null-or-nonblank by normalization.)
 */
function enrichVenue(venue: ScheduleItem['venue'], catalogItem: VenueCatalogItem): VenueInfo {
  const base = baseVenueInfo(venue);
  return {
    stadium: catalogItem.name ?? base.stadium,
    city: catalogItem.city ?? base.city,
    state: catalogItem.state ?? base.state,
    country: catalogItem.countryCode ?? base.country,
  };
}

/**
 * Enrich canonical schedule items with cached presentation data, cache-only.
 * Joins are EXACT-identity only: media by `item.id` (the canonical decimal
 * provider game id), venue by numeric `item.venueId`. Items with no
 * presentation data are returned UNCHANGED (same reference — proof nothing was
 * mutated); enriched items are new objects. Optional `now`/`forceDurable` are
 * deterministic-test seams; production callers pass only `year` + `items`.
 */
export async function enrichScheduleItemsWithPresentation(params: {
  year: number;
  items: ScheduleItem[];
  now?: number;
  forceDurable?: boolean;
}): Promise<PresentationEnrichedScheduleItem[]> {
  const { year, items } = params;
  if (items.length === 0) return items;
  const now = params.now ?? Date.now();
  const forceDurable = params.forceDurable ?? false;

  const [mediaEntry, venueEntry] = await Promise.all([
    loadScheduleMediaEntry({ year, now, forceDurable }),
    loadVenueCatalogEntry({ now, forceDurable }),
  ]);
  if (!mediaEntry && !venueEntry) return items;

  let mediaByGameId: Map<string, ScheduleMediaItem[]> | null = null;
  if (mediaEntry && mediaEntry.items.length > 0) {
    mediaByGameId = new Map();
    for (const row of mediaEntry.items) {
      const existing = mediaByGameId.get(row.gameId);
      if (existing) existing.push(row);
      else mediaByGameId.set(row.gameId, [row]);
    }
  }

  let venuesById: Map<number, VenueCatalogItem> | null = null;
  if (venueEntry && venueEntry.items.length > 0) {
    venuesById = new Map(venueEntry.items.map((venue) => [venue.id, venue]));
  }

  if (!mediaByGameId && !venuesById) return items;

  return items.map((item) => {
    const media = mediaByGameId?.get(item.id);
    const catalogItem =
      typeof item.venueId === 'number' ? (venuesById?.get(item.venueId) ?? null) : null;
    if (!media && !catalogItem) return item;
    const enriched: PresentationEnrichedScheduleItem = { ...item };
    if (media) enriched.media = media.map((row) => ({ ...row }));
    if (catalogItem) enriched.venue = enrichVenue(item.venue, catalogItem);
    return enriched;
  });
}
