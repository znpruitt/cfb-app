import type { CfbdSeasonType } from '../cfbd.ts';
import { isDisruptedStatusLabel } from '../gameStatus.ts';
import type { AppGame, ScheduleWireItem } from '../schedule.ts';
import { buildScheduleFromApi } from '../schedule.ts';
import { loadCachedScheduleItems } from '../server/canonicalScheduleCache.ts';
import { getScopedAliasMap } from '../server/globalAliasStore.ts';
import { getTeamDatabaseItems } from '../server/teamDatabaseStore.ts';
import {
  createTeamIdentityResolver,
  type TeamCatalogItem,
  type TeamIdentityResolver,
} from '../teamIdentity.ts';
import type { AliasMap } from '../teamNames.ts';
import { isValidProviderGameId } from './contract.ts';

/**
 * PLATFORM-086H3C1 — canonical game-stats slate/context (DORMANT).
 *
 * The schedule-authoritative expectation layer for the C1 evidence read model:
 * it decides WHICH games each weekly partition expects, WHICH canonical
 * participants belong to each game, and the resolver used to validate a stored
 * row's participants. It never fetches a provider, never writes, and is wired
 * into no live consumer (the recursive dormant-boundary guard enforces this).
 *
 * Design invariants (see the C1 handoff doc):
 *   - Canonical games are built ONLY through `buildScheduleFromApi`; schedule
 *     eligibility, postseason-week remapping, placeholder policy, and team
 *     matching are never re-derived here. FCS-vs-FCS and excluded games never
 *     enter the slate because the shared builder already drops them.
 *   - Teams load through `getTeamDatabaseItems()` and league-agnostic effective
 *     aliases through `getScopedAliasMap('', year)`. No league-specific
 *     postseason overrides are applied to league-agnostic game-stat evidence.
 *   - The provider partition of a game is `year : AppGame.providerWeek :
 *     scheduleItem.seasonType`; postseason provider week and canonical week stay
 *     distinct (the builder owns the canonical-week calculation).
 *   - Applicability derives from the ORIGINAL schedule kickoff + raw status —
 *     `AppGame.status` collapses several disrupted provider labels.
 *   - Attachment identity is seeded from the catalog, aliases, and canonical
 *     schedule participants ONLY. Arbitrary provider labels never create
 *     identity authority, so a stored row label outside that set stays
 *     unresolved and cannot attach.
 *   - Schedule / catalog / alias / canonical-build FAILURES are unavailable
 *     context — never valid absence.
 */

/** A game is expected only once its kickoff is at least six hours old. */
export const EXPECTED_KICKOFF_MIN_AGE_MS = 6 * 60 * 60 * 1000;

/** A resolved canonical participant: a non-empty identity key + canonical name. */
export type CanonicalParticipant = {
  identityKey: string;
  canonicalName: string;
};

export type CanonicalGameApplicability = 'expected' | 'pending' | 'not-expected';

export type CanonicalGameNotExpectedReason = 'placeholder' | 'disrupted';

export type CanonicalGame = {
  /** Positive CFBD provider game id — the only addressable form. */
  providerGameId: number;
  /** Canonical `AppGame` key/eventId, retained for reporting only. */
  eventId: string;
  /** Provider partition week (`AppGame.providerWeek`). */
  providerWeek: number;
  /** Provider partition season type (the schedule item's explicit season type). */
  seasonType: CfbdSeasonType;
  neutral: boolean;
  applicability: CanonicalGameApplicability;
  /** Set only when `applicability === 'not-expected'`. */
  notExpectedReason: CanonicalGameNotExpectedReason | null;
  /**
   * Name-resolved canonical participants — the schedule-authoritative
   * expectation of who is playing, retained for display/diagnostics and future
   * consumers. C1's evidence path associates rows by game id + partition and
   * does not validate against these (numeric participant validation is a
   * separate pre-activation prerequisite, deferred until schedule persistence
   * captures numeric `homeId`/`awayId`).
   */
  home: CanonicalParticipant | null;
  away: CanonicalParticipant | null;
  /** Original schedule kickoff (ISO) used for applicability. */
  kickoff: string | null;
  /** Original raw provider status label used for applicability. */
  rawStatus: string | null;
};

export type CanonicalSlate = {
  year: number;
  /**
   * Every ADDRESSABLE canonical game (positive numeric provider id). Placeholder
   * / synthetic-id games and schedule-excluded games are absent by construction;
   * duplicate provider game ids are rejected as a canonical-build failure.
   */
  games: CanonicalGame[];
};

export type CanonicalSlateUnavailableReason =
  | 'schedule-load-failed'
  | 'catalog-load-failed'
  | 'alias-load-failed'
  | 'canonical-build-failed';

export type CanonicalSlateResult =
  | { status: 'available'; slate: CanonicalSlate }
  | { status: 'unavailable'; reason: CanonicalSlateUnavailableReason };

function scheduleSeasonType(item: ScheduleWireItem | undefined): CfbdSeasonType {
  return item?.seasonType === 'postseason' ? 'postseason' : 'regular';
}

// CFBD schedule ids are plain decimal-digit strings. A digits-only grammar
// (applied to the trimmed value) rejects JavaScript numeric forms `Number`
// would otherwise coerce — `"1e3"`, `"0x10"`, `"+16"`, `"12.0"` — so a malformed
// cached id can never masquerade as an unrelated numeric provider game id.
const DECIMAL_PROVIDER_ID = /^\d+$/;

function toProviderGameId(raw: string | null): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!DECIMAL_PROVIDER_ID.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return isValidProviderGameId(parsed) ? parsed : null;
}

/**
 * Build the resolver used to validate participants. Observed names are seeded
 * from the SETTLED team participants of the games that survived
 * `buildScheduleFromApi` — the catalog, aliases, and canonical schedule
 * participants ONLY. A raw label on a schedule row the builder EXCLUDED (e.g. an
 * unknown-vs-unknown non-FBS matchup) is never a settled participant, so it
 * gains no identity authority and a stored row carrying it stays unresolved.
 */
function createGameStatsResolver(input: {
  games: AppGame[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
}): TeamIdentityResolver {
  const observedNames = new Set<string>();
  for (const game of input.games) {
    for (const slot of [game.participants.home, game.participants.away]) {
      if (slot.kind === 'team' && slot.canonicalName.trim().length > 0) {
        observedNames.add(slot.canonicalName);
      }
    }
  }
  return createTeamIdentityResolver({
    teams: input.teams,
    aliasMap: input.aliasMap,
    observedNames: [...observedNames],
  });
}

function resolveCanonicalParticipant(
  resolver: TeamIdentityResolver,
  game: AppGame,
  side: 'home' | 'away'
): CanonicalParticipant | null {
  const slot = game.participants[side];
  // Placeholder / derived slots carry no settled team identity.
  if (slot.kind !== 'team') return null;
  const resolved = resolver.resolveName(slot.canonicalName);
  if (resolved.status !== 'resolved' || !resolved.identityKey) return null;
  return {
    identityKey: resolved.identityKey,
    canonicalName: resolved.canonicalName ?? slot.canonicalName,
  };
}

function classifyApplicability(input: {
  game: AppGame;
  kickoff: string | null;
  rawStatus: string | null;
  nowMs: number;
}): {
  applicability: CanonicalGameApplicability;
  notExpectedReason: CanonicalGameNotExpectedReason | null;
} {
  const { game, kickoff, rawStatus, nowMs } = input;
  // Only a FULL placeholder shell (no known team on either side) defers. Under
  // the CFBD-id authority model, numeric participant identity governs a stored
  // row's integrity, not whether the game is expected — a half-set matchup (one
  // known team + one TBD/derived slot) or an unresolved-name pair is still an
  // addressable scheduled game whose rows attach as `unverified` when numeric
  // schedule ids are absent.
  if (game.isPlaceholder) {
    return { applicability: 'not-expected', notExpectedReason: 'placeholder' };
  }
  // Disrupted (canceled/postponed/suspended/delayed) games never produce stats.
  if (isDisruptedStatusLabel(rawStatus)) {
    return { applicability: 'not-expected', notExpectedReason: 'disrupted' };
  }
  const kickoffMs = typeof kickoff === 'string' ? Date.parse(kickoff) : Number.NaN;
  // Unknown/unparseable kickoff can never be proven ≥6h old → pending, never a gap.
  const expected = Number.isFinite(kickoffMs) && nowMs - kickoffMs >= EXPECTED_KICKOFF_MIN_AGE_MS;
  return expected
    ? { applicability: 'expected', notExpectedReason: null }
    : { applicability: 'pending', notExpectedReason: null };
}

/**
 * Pure canonical slate builder. `now` is injected (never ambient) so
 * applicability is deterministic and testable. Throws only if
 * `buildScheduleFromApi` throws over malformed inputs — the async wrapper below
 * translates that into `canonical-build-failed`.
 */
export function buildCanonicalGameStatsSlate(input: {
  year: number;
  scheduleItems: ScheduleWireItem[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
  now: Date;
}): CanonicalSlate {
  const { year, scheduleItems, teams, aliasMap, now } = input;
  // The team catalog is REQUIRED identity authority. Enforce the non-empty
  // precondition on THIS exported entry point too (not only the async loader):
  // an empty catalog would let `buildScheduleFromApi` seed identities from
  // schedule labels alone, marking stored rows verified without catalog
  // authority. A direct caller violating this fails loudly; the async wrapper
  // maps an empty catalog to `catalog-load-failed` before ever calling here.
  if (teams.length === 0) {
    throw new Error('buildCanonicalGameStatsSlate requires a non-empty team catalog');
  }
  // Build the canonical games FIRST so the attachment resolver can be seeded from
  // their settled participants (never from raw labels of excluded schedule rows).
  const { games } = buildScheduleFromApi({ scheduleItems, teams, aliasMap, season: year });
  const resolver = createGameStatsResolver({ games, teams, aliasMap });

  // Index raw schedule rows by their PARSED numeric CFBD provider id (first-wins),
  // and track ids that appear on MORE THAN ONE raw row. A surviving game reads its
  // source-item metadata (season type, status, kickoff) by id, so a reused id
  // makes that lookup ambiguous — first-wins could attach a discarded/excluded
  // row's metadata (e.g. a canceled postseason row's) to the surviving game and
  // misclassify its partition/applicability. Detection operates on the PARSED
  // numeric id (not the raw string) so alternate decimal spellings that
  // `toProviderGameId` collapses to the same provider game id — `"05001"` vs
  // `"5001"` — cannot slip past a raw-string comparison. Non-numeric ids
  // (synthetic placeholder-shell fallback rows) associate no durable row, so they
  // are ignored here. The CFBD id is the association authority, so a duplicate is
  // a canonical-build failure.
  const itemsByProviderId = new Map<number, ScheduleWireItem>();
  const duplicateProviderScheduleIds = new Set<number>();
  for (const item of scheduleItems) {
    const providerId = toProviderGameId(item.id);
    if (providerId === null) continue;
    if (itemsByProviderId.has(providerId)) duplicateProviderScheduleIds.add(providerId);
    else itemsByProviderId.set(providerId, item);
  }

  const nowMs = now.getTime();
  const canonicalGames: CanonicalGame[] = [];
  const seenIds = new Set<number>();
  for (const game of games) {
    const providerGameId = toProviderGameId(game.providerGameId);
    if (providerGameId === null) continue; // unaddressable (placeholder/synthetic id)

    // Reject an addressable game whose numeric CFBD id was reused on the schedule
    // — its source-item metadata is ambiguous — BEFORE that metadata is read. This
    // catches the case a surviving game's id collides with a DISCARDED row even
    // when only one game survives, INCLUDING an alternate raw spelling of the same
    // number (`"05001"`/`"5001"`) that a raw-string check would miss.
    if (duplicateProviderScheduleIds.has(providerGameId)) {
      throw new Error(`ambiguous duplicate CFBD schedule id: ${providerGameId}`);
    }
    // Redundant defensive invariant: the numeric association id must be unique
    // across the surviving slate. The duplicate-id detection above already rejects
    // any reused number (two survivors sharing a number both trace to raw rows), so
    // this is a belt-and-suspenders guard against a future builder that could
    // synthesize a providerGameId absent from the raw schedule rows.
    if (seenIds.has(providerGameId)) {
      throw new Error(`duplicate canonical CFBD game id in slate: ${providerGameId}`);
    }
    seenIds.add(providerGameId);

    const item = itemsByProviderId.get(providerGameId);
    const kickoff = item?.startDate ?? game.date ?? null;
    const rawStatus = item?.status ?? null;
    // Name-resolved participants: the schedule-authoritative expectation of who
    // is playing (display/diagnostics). C1's evidence path does not validate
    // against them.
    const home = resolveCanonicalParticipant(resolver, game, 'home');
    const away = resolveCanonicalParticipant(resolver, game, 'away');
    const { applicability, notExpectedReason } = classifyApplicability({
      game,
      kickoff,
      rawStatus,
      nowMs,
    });

    canonicalGames.push({
      providerGameId,
      eventId: game.eventId,
      providerWeek: game.providerWeek,
      seasonType: scheduleSeasonType(item),
      neutral: game.neutral,
      applicability,
      notExpectedReason,
      home,
      away,
      kickoff,
      rawStatus,
    });
  }

  return { year, games: canonicalGames };
}

/**
 * Cache-only, provider-free async wrapper. Any loader or build FAILURE is
 * reported as unavailable context (never valid absence); a genuinely empty
 * schedule cache yields an available, empty slate. `now` is injected for
 * determinism.
 */
export async function loadCanonicalGameStatsSlate(input: {
  year: number;
  now: Date;
}): Promise<CanonicalSlateResult> {
  const { year, now } = input;

  let scheduleItems: ScheduleWireItem[];
  try {
    scheduleItems = await loadCachedScheduleItems(year);
  } catch {
    return { status: 'unavailable', reason: 'schedule-load-failed' };
  }

  let teams: TeamCatalogItem[];
  try {
    teams = await getTeamDatabaseItems();
  } catch {
    return { status: 'unavailable', reason: 'catalog-load-failed' };
  }
  // The team catalog is a REQUIRED identity authority. `getTeamDatabaseItems`
  // returns an empty array (rather than throwing) when the durable record holds
  // `items: []` or the bundled fallback cannot be read/parsed — an empty catalog
  // would let `buildScheduleFromApi` seed identity from schedule labels and
  // conference inference alone, authorizing attachment without catalog authority.
  // Treat it as unavailable context, never valid absence.
  if (teams.length === 0) {
    return { status: 'unavailable', reason: 'catalog-load-failed' };
  }

  let aliasMap: AliasMap;
  try {
    // League-agnostic effective aliases only; no league-specific overrides.
    aliasMap = await getScopedAliasMap('', year);
  } catch {
    return { status: 'unavailable', reason: 'alias-load-failed' };
  }

  try {
    const slate = buildCanonicalGameStatsSlate({ year, scheduleItems, teams, aliasMap, now });
    return { status: 'available', slate };
  } catch {
    return { status: 'unavailable', reason: 'canonical-build-failed' };
  }
}

/**
 * The expected/pending/deferred games addressable within one weekly partition
 * of a slate. Coverage and projection consume this partition view.
 */
export type CanonicalPartition = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  expected: CanonicalGame[];
  pending: CanonicalGame[];
  deferredPlaceholders: CanonicalGame[];
};

/** Slice a slate down to one provider partition (`week` = provider week). */
export function selectCanonicalPartition(
  slate: CanonicalSlate,
  week: number,
  seasonType: CfbdSeasonType
): CanonicalPartition {
  const expected: CanonicalGame[] = [];
  const pending: CanonicalGame[] = [];
  const deferredPlaceholders: CanonicalGame[] = [];
  for (const game of slate.games) {
    if (game.providerWeek !== week || game.seasonType !== seasonType) continue;
    if (game.applicability === 'expected') expected.push(game);
    else if (game.applicability === 'pending') pending.push(game);
    else if (game.notExpectedReason === 'placeholder') deferredPlaceholders.push(game);
  }
  return { year: slate.year, week, seasonType, expected, pending, deferredPlaceholders };
}
