import type { AliasMap } from '../teamNames.ts';
import {
  createTeamIdentityResolver,
  resolveTeamIdentityKey,
  type TeamCatalogItem,
  type TeamIdentityResolver,
} from '../teamIdentity.ts';
import { effectiveRowTimestamp, type CacheEntry } from '../scores/cache.ts';
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
   * (`contributorCount === 0`). Callers use its `source`/`cfbdFallbackReason` for
   * source reporting. Prefer {@link newestEffectiveAt} for freshness — the
   * entry's `at` can be newer than any row it actually changed once a live merge
   * preserves untouched rows.
   */
  newest: CacheEntry | null;
  /**
   * The newest EFFECTIVE (per-row) timestamp among the winning deduped rows
   * (PLATFORM-086B1). This is the correct freshness signal for served scores: a
   * live merge that rewrites an entry only to preserve prior-good rows or clear
   * confirmation metadata advances the entry's `at` but changes no row, so this
   * value stays put and freshness does not become artificially fresh. `null`
   * exactly when no row contributed (every contributing entry was empty, or
   * nothing is cached).
   */
  newestEffectiveAt: number | null;
  /**
   * The EFFECTIVE timestamp of each winning row that carries a provider game id,
   * keyed by that id (PLATFORM-086B1). Lets a downstream durable merge know how
   * fresh the currently-served value for a game is — so its monotonic/null
   * protection references the reconciled winner (which may live in the
   * season-wide aggregate) rather than a possibly-staler exact child row.
   */
  effectiveAtById: Record<string, number>;
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
    return {
      items: [],
      newest: null,
      newestEffectiveAt: null,
      effectiveAtById: {},
      contributorCount: 0,
    };
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

  // Dedupe rows by canonical game identity, newest EFFECTIVE (per-row) timestamp
  // winning. Process oldest-entry-first and keep a row on a `>=` effective
  // comparison so that, on a tie, the later-iterated (newer enclosing entry)
  // wins — exactly the pre-per-row newest-entry-wins behavior for legacy entries
  // whose rows all fall back to `at`. Comparing the per-row effective timestamp
  // (not the enclosing `at`) is the fix: a preserved untouched row carries its
  // OLD effective timestamp, so it can no longer out-rank a genuinely newer copy
  // of the same game in another entry. Empty entries contribute nothing.
  const oldestFirst = [...contributors].sort((a, b) => a.at - b.at);
  const byIdentity = new Map<string, { item: ScorePack; effectiveAt: number }>();
  for (const entry of oldestFirst) {
    for (const item of entry.items) {
      const key = scoreIdentityKey(resolver, item);
      const effectiveAt = effectiveRowTimestamp(entry, item);
      const existing = byIdentity.get(key);
      if (!existing || effectiveAt >= existing.effectiveAt) {
        byIdentity.set(key, { item, effectiveAt });
      }
    }
  }

  const winners = [...byIdentity.values()];
  // Served-score freshness comes from the newest EFFECTIVE contributing-row
  // timestamp, never the enclosing entry's `at` — see `newestEffectiveAt`. Null
  // only when no row contributed (every contributing entry was empty).
  const newestEffectiveAt =
    winners.length > 0
      ? winners.reduce(
          (max, w) => (w.effectiveAt > max ? w.effectiveAt : max),
          Number.NEGATIVE_INFINITY
        )
      : null;

  // Per-provider-game effective timestamp of each winning row, so a downstream
  // merge can compare a game's served freshness against its own child row.
  const effectiveAtById: Record<string, number> = {};
  for (const { item, effectiveAt } of winners) {
    const id = item.id?.trim();
    if (!id) continue;
    const existing = effectiveAtById[id];
    if (existing === undefined || effectiveAt > existing) effectiveAtById[id] = effectiveAt;
  }

  // `newest` (the enclosing entry) still carries source/cfbdFallbackReason. Take
  // the newest entry that actually contributed rows so an empty-but-newer
  // fallback does not report a misleading source.
  const withRows = contributors.filter((entry) => entry.items.length > 0);
  const newest = (withRows.length > 0 ? withRows : contributors).reduce((a, b) =>
    b.at >= a.at ? b : a
  );

  return {
    items: winners.map((w) => w.item),
    newest,
    newestEffectiveAt,
    effectiveAtById,
    contributorCount: contributors.length,
  };
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
