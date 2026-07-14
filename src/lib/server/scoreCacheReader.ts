import type { AliasMap } from '../teamNames.ts';
import {
  createTeamIdentityResolver,
  resolveTeamIdentityKey,
  type TeamCatalogItem,
  type TeamIdentityResolver,
} from '../teamIdentity.ts';
import type { CacheEntry } from '../scores/cache.ts';
import type { ScorePack, SeasonType } from '../scores/types.ts';
import { getAppStateEntries } from './appStateStore.ts';

/**
 * Shared cache-only season score reconciler (PLATFORM-084B).
 *
 * ONE reader used by both public score display (`/api/scores` season-wide) and
 * the canonical consumers (standings selector, season-rollover archive build),
 * so a week-specific score cache refreshed after the season snapshot is visible
 * everywhere instead of only on `/api/scores`. It reconciles the season-wide
 * (`${year}-all-${seasonType}`) and per-week (`${year}-<week>-${seasonType}`)
 * `scores` cache entries into one deduped row set, newest cache entry winning
 * per canonical game identity.
 *
 * **Cache-only.** This never contacts CFBD and never writes — it is a pure
 * durable-store read. Provider fetches remain exclusively on the authorized
 * `refresh=1` path in `/api/scores` (PLATFORM-075). Identity resolution routes
 * through `teamIdentity.ts`; it never constructs game identity from raw provider
 * labels.
 *
 * **Failure vs absence (PLATFORM-084A).** `getAppStateEntries` returns an empty
 * list only for a genuine miss (no cached score entries) and throws on a real
 * store error. This reader does NOT catch that error — a failed read propagates
 * so a canonical consumer rejects rather than caching an empty/default result;
 * genuine absence (no scores before kickoff) returns `contributorCount: 0`.
 */

export type ReconciledSeasonScores = {
  /** Deduped score rows, newest contributing cache entry winning per game. */
  items: ScorePack[];
  /**
   * The newest cache entry that contributed rows (or, if none contributed rows,
   * the newest matching entry overall). `null` only when nothing is cached
   * (`contributorCount === 0`). Callers use its `at`/`source`/`cfbdFallbackReason`
   * for freshness/source reporting.
   */
  newest: CacheEntry | null;
  /** Number of matching cache entries found (including empty ones). */
  contributorCount: number;
};

/**
 * Whether an app-state `scores` key is a season-wide or week-scoped entry for
 * this (year, seasonType) — `${year}-all-${seasonType}` or
 * `${year}-<week>-${seasonType}`.
 */
export function isScoresKeyForSeason(key: string, year: number, seasonType: SeasonType): boolean {
  const prefix = `${year}-`;
  const suffix = `-${seasonType}`;
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return false;
  const middle = key.slice(prefix.length, key.length - suffix.length);
  return middle === 'all' || /^\d+$/.test(middle);
}

/**
 * Canonical game-identity key for a cached score row: the resolved (via
 * teamIdentity) home/away pair plus the UTC calendar date. This routes identity
 * through `teamIdentity.ts` per the canonical-identity guardrail rather than raw
 * provider labels, and it keys on the DATE rather than the week so a postseason
 * game contributed under its provider week (e.g. 1) reconciles with the same
 * game contributed under its canonical week (e.g. 16). Rows lacking a resolvable
 * pair or date fall back to a stable per-row key so they are never merged away.
 */
export function scoreIdentityKey(resolver: TeamIdentityResolver, item: ScorePack): string {
  const homeKey = resolveTeamIdentityKey(resolver, item.home.team);
  const awayKey = resolveTeamIdentityKey(resolver, item.away.team);
  const date = item.startDate ? item.startDate.slice(0, 10) : '';
  if (homeKey && awayKey && date) {
    return `pair:${[homeKey, awayKey].sort().join('|')}|${date}`;
  }
  // Not confidently identifiable across entries — keep it distinct so a
  // partially-populated row cannot swallow a different game.
  const id = item.id?.trim();
  if (id) return `id:${id}`;
  return `raw:${item.home.team}|${item.away.team}|${item.startDate ?? ''}|${item.week ?? ''}`;
}

/**
 * Reconcile an already-filtered set of contributing cache entries (one
 * `seasonType`) into a deduped row set. Pure — no I/O — so a single durable read
 * can feed multiple season types (see `loadReconciledSeasonScoresByType`). The
 * `teams`/`aliasMap` supply the identity resolver used for dedup; callers pass
 * whatever catalog/alias source they already resolve identity with. Aliases are
 * league-agnostic, so they resolve identically across surfaces; the team catalog
 * may differ (public route: bundled `teams.json`; canonical consumers: the
 * synced team-DB catalog), which affects only how duplicate rows GROUP — the
 * downstream schedule attachment re-keys by canonical game, so a difference in
 * grouping cannot double-count.
 */
function reconcileContributors(
  contributors: CacheEntry[],
  teams: TeamCatalogItem[],
  aliasMap: AliasMap
): ReconciledSeasonScores {
  if (contributors.length === 0) {
    return { items: [], newest: null, contributorCount: 0 };
  }

  // Build a canonical team-identity resolver over every label observed across
  // the contributing entries so cross-entry duplicates reconcile by identity.
  const observedNames = new Set<string>();
  for (const entry of contributors) {
    for (const item of entry.items) {
      observedNames.add(item.home.team);
      observedNames.add(item.away.team);
    }
  }
  const resolver = createTeamIdentityResolver({
    teams,
    aliasMap,
    observedNames: [...observedNames],
  });

  // Dedupe rows by canonical game identity, newest cache entry winning. Process
  // oldest-first so a fresher entry's row overwrites an older one for the same
  // game (empty entries contribute nothing and thus cannot mask populated rows).
  const oldestFirst = [...contributors].sort((a, b) => a.at - b.at);
  const byIdentity = new Map<string, ScorePack>();
  for (const entry of oldestFirst) {
    for (const item of entry.items) {
      byIdentity.set(scoreIdentityKey(resolver, item), item);
    }
  }

  // Freshness/source come from the newest entry that actually contributed rows,
  // so an empty-but-newer fallback does not report a misleading source/time.
  const withRows = contributors.filter((entry) => entry.items.length > 0);
  const newest = (withRows.length > 0 ? withRows : contributors).reduce((a, b) =>
    b.at >= a.at ? b : a
  );

  return { items: [...byIdentity.values()], newest, contributorCount: contributors.length };
}

/**
 * Read and reconcile every cached `scores` entry for (year, seasonType) —
 * season-wide + per-week — into a single deduped row set. Cache-only; no
 * provider call. Used by the public `/api/scores` season read (which is scoped
 * to one `seasonType` per request). Canonical consumers that need BOTH season
 * types should use `loadReconciledSeasonScoresByType` to avoid a second scan.
 */
export async function loadReconciledSeasonScores(params: {
  year: number;
  seasonType: SeasonType;
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
}): Promise<ReconciledSeasonScores> {
  const { year, seasonType, teams, aliasMap } = params;

  const records = await getAppStateEntries<CacheEntry>('scores', `${year}-`);
  const contributors: CacheEntry[] = [];
  for (const record of records) {
    if (!record.value) continue;
    if (isScoresKeyForSeason(record.key, year, seasonType)) contributors.push(record.value);
  }

  return reconcileContributors(contributors, teams, aliasMap);
}

/**
 * Reconcile BOTH the regular and postseason season score views from a SINGLE
 * `${year}-` prefix read, partitioning the entries in memory. Canonical
 * standings and the season-rollover archive build need both season types, so
 * this avoids the redundant second full-year scan two `loadReconciledSeasonScores`
 * calls would incur. Cache-only; a store-read failure propagates unchanged
 * (PLATFORM-084A) — genuine absence yields empty results per season type.
 */
export async function loadReconciledSeasonScoresByType(params: {
  year: number;
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
}): Promise<{ regular: ReconciledSeasonScores; postseason: ReconciledSeasonScores }> {
  const { year, teams, aliasMap } = params;

  const records = await getAppStateEntries<CacheEntry>('scores', `${year}-`);
  const regular: CacheEntry[] = [];
  const postseason: CacheEntry[] = [];
  for (const record of records) {
    if (!record.value) continue;
    if (isScoresKeyForSeason(record.key, year, 'regular')) regular.push(record.value);
    else if (isScoresKeyForSeason(record.key, year, 'postseason')) postseason.push(record.value);
  }

  return {
    regular: reconcileContributors(regular, teams, aliasMap),
    postseason: reconcileContributors(postseason, teams, aliasMap),
  };
}
