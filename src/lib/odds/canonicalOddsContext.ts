/**
 * PLATFORM-086C1 — the cache-only canonical Odds context (DORMANT: built and
 * tested for the FUTURE PLATFORM-086C2 cron, wired to NO runtime route in C1).
 *
 * Resolves the current canonical-season Odds target's games in ONE
 * `buildScheduleFromApi` build from DURABLE-CACHE inputs only — it NEVER contacts
 * CFBD, The Odds API, or an internal refresh endpoint. It derives the season
 * through the same `resolveDefaultSeason(now)` policy (including
 * `NEXT_PUBLIC_SEASON`) the ordinary Odds route uses, exposes the built games and
 * the shared team-identity resolver for Odds attachment, and carries each game's
 * RAW schedule status (the built `AppGame.status` enum collapses disruption
 * labels) so the polling policy can classify disruption. Centralized team identity
 * and the existing event/date-aware attachment remain authoritative — this adds no
 * second matcher.
 *
 * A schedule / catalog / alias / build read failure is
 * `canonical-context-unavailable` — NEVER "no games". A genuinely empty schedule
 * (loaded successfully, zero rows) is an AVAILABLE context with no games.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { defaultOddsCacheKey, resolveDefaultSeason } from '@/app/api/odds/routeInternals';

import { buildScheduleFromApi, type AppGame, type ScheduleWireItem } from '../schedule.ts';
import { loadCachedScheduleItems } from '../server/canonicalScheduleCache.ts';
import { getScopedAliasMap } from '../server/globalAliasStore.ts';
import {
  createTeamIdentityResolver,
  type TeamCatalogItem,
  type TeamIdentityResolver,
} from '../teamIdentity.ts';
import type { AliasMap } from '../teamNames.ts';
import type { OddsCanonicalGame } from './pollingPolicy.ts';

export type CanonicalOddsContext = {
  year: number;
  /** The season-scoped `odds-cache`/lease/status key for the canonical target. */
  seasonScopedKey: string;
  /** The built canonical games (one `buildScheduleFromApi` output). */
  games: AppGame[];
  /** Per-game polling signals (resolved participants, kickoff, raw status). */
  pollingGames: OddsCanonicalGame[];
  /** Shared identity resolver for Odds attachment. */
  resolver: TeamIdentityResolver;
  /** Identity inputs, so the automatic caller can rebuild a resolver that also
   * observes the provider event labels (parity with the manual attachment). */
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
};

export type CanonicalOddsContextResult =
  | { status: 'available'; context: CanonicalOddsContext }
  | { status: 'unavailable'; reason: 'canonical-context-unavailable' };

async function readBundledTeamsCatalog(): Promise<TeamCatalogItem[]> {
  const raw = await fs.readFile(path.join(process.cwd(), 'src/data/teams.json'), 'utf8');
  const parsed = JSON.parse(raw) as { items?: TeamCatalogItem[] };
  return Array.isArray(parsed.items) ? parsed.items : [];
}

const UNAVAILABLE: CanonicalOddsContextResult = {
  status: 'unavailable',
  reason: 'canonical-context-unavailable',
};

/**
 * Load the cache-only canonical Odds context. `now` is injected for deterministic
 * season resolution. Any read/build failure maps to `canonical-context-unavailable`;
 * a genuinely empty schedule yields an available, empty context.
 */
export async function loadCanonicalOddsContext(input: {
  now: Date;
}): Promise<CanonicalOddsContextResult> {
  const year = resolveDefaultSeason(input.now);
  const seasonScopedKey = defaultOddsCacheKey(year);

  let scheduleItems: ScheduleWireItem[];
  try {
    scheduleItems = await loadCachedScheduleItems(year);
  } catch {
    return UNAVAILABLE;
  }

  let teams: TeamCatalogItem[];
  try {
    teams = await readBundledTeamsCatalog();
  } catch {
    return UNAVAILABLE;
  }
  // The catalog is REQUIRED identity authority — an empty catalog would let the
  // schedule build seed identity from labels alone. Treat as unavailable, never
  // as "no games".
  if (teams.length === 0) return UNAVAILABLE;

  let aliasMap: AliasMap;
  try {
    // League-agnostic effective aliases, matching the ordinary Odds route.
    aliasMap = await getScopedAliasMap('', year);
  } catch {
    return UNAVAILABLE;
  }

  let games: AppGame[];
  try {
    games = buildScheduleFromApi({ scheduleItems, teams, aliasMap, season: year }).games;
  } catch {
    return UNAVAILABLE;
  }

  const observedNames = Array.from(
    new Set(games.flatMap((game) => [game.canHome, game.canAway]).filter(Boolean))
  );
  const resolver = createTeamIdentityResolver({ teams, aliasMap, observedNames });

  // Raw schedule status by provider id (AppGame.providerGameId === item.id), so
  // the polling policy classifies disruption on the schedule row's raw label.
  const rawStatusById = new Map<string, string | null>();
  for (const item of scheduleItems) rawStatusById.set(item.id, item.status ?? null);

  const pollingGames: OddsCanonicalGame[] = games.map((game) => ({
    key: game.key,
    homeResolved: game.participants.home.kind === 'team',
    awayResolved: game.participants.away.kind === 'team',
    kickoff: game.date,
    rawStatus:
      game.providerGameId !== null ? (rawStatusById.get(game.providerGameId) ?? null) : null,
  }));

  return {
    status: 'available',
    context: { year, seasonScopedKey, games, pollingGames, resolver, teams, aliasMap },
  };
}
