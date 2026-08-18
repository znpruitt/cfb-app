import { getCachedGameStats, listCachedGameStatsWeeks } from '../gameStats/cache';
import {
  assembleArchiveAnalyticsProvenance,
  assembleLiveAnalyticsProvenance,
  type AnalyticsProvenanceUnavailableReason,
} from '../gameStats/analyticsProvenance';
import type { AnalyticsGameStats, SeasonRelation } from '../gameStats/contract';
import { aggregateOwnerSeasonStats } from '../gameStats/ownerStats';
import { projectAnalyticsPartition } from '../gameStats/publicProjection';
import { MIN_CONFIRMED_OWNERS, type ConfirmedRosterSource } from '../selectors/confirmedRoster';
import type { League } from '../league';
import { identityKey } from './membershipHistory';
import { parseOwnersCsv } from '../parseOwnersCsv';
import type { RankingsResponse } from '../rankings';
import type { AppGame } from '../schedule';
import { getSeasonArchive, listSeasonArchives, type SeasonArchive } from '../seasonArchive';
import { getScopedAliasMap } from '../server/globalAliasStore';
import { getTeamDatabaseItems } from '../server/teamDatabaseStore';
import type { SeasonContext } from '../selectors/seasonContext';
import type { OwnerStandingsRow } from '../standings';
import type { StandingsHistoryWeekSnapshot } from '../standingsHistory';
import { createTeamIdentityResolver, type TeamCatalogItem } from '../teamIdentity';
import type { AliasMap } from '../teamNames';
import { chooseDefaultWeek, deriveRegularWeeks } from '../weekSelection';
import { deriveLifecycleState, deriveTotalRegularSeasonWeeks } from './lifecycle';
import { selectAllRecords } from '../selectors/leagueRecords';
import type {
  InsightContext,
  LeagueMembersSource,
  OwnerCareerStats,
  OwnerSeasonStats,
} from './types';

const NO_CLAIM_OWNER = 'NoClaim';

async function loadArchives(leagueSlug: string): Promise<SeasonArchive[]> {
  const years = await listSeasonArchives(leagueSlug);
  const archives = await Promise.all(years.map((year) => getSeasonArchive(leagueSlug, year)));
  return archives.filter((archive): archive is SeasonArchive => archive !== null);
}

function buildHistoricalRosters(archives: SeasonArchive[]): Record<number, Map<string, string>> {
  const result: Record<number, Map<string, string>> = {};
  for (const archive of archives) {
    const rows = parseOwnersCsv(archive.ownerRosterSnapshot);
    result[archive.year] = new Map(rows.map((row) => [row.team, row.owner]));
  }
  return result;
}

/** The paired provenance a season-stats load runs against. */
export type OwnerSeasonStatsSource = { kind: 'live' } | { kind: 'archive'; archive: SeasonArchive };

export type OwnerSeasonStatsUnavailableReason =
  | AnalyticsProvenanceUnavailableReason
  | 'identity-load-failed'
  | 'no-cached-partitions';

export type OwnerSeasonStatsLoad =
  | { status: 'available'; stats: OwnerSeasonStats[] }
  | { status: 'unavailable'; reason: OwnerSeasonStatsUnavailableReason };

/**
 * PLATFORM-086H3E3 — owner season stats consume ONLY the final-and-complete
 * analytics projection over ONE paired provenance:
 *
 *   - `live`: the league-scoped scored build assembled once, cache-only, with
 *     the slate derived from that exact build;
 *   - `archive`: the archive's own `gameStatSlate` snapshot paired with the
 *     archive's own `scoresByKey` — absent/malformed snapshots FAIL CLOSED
 *     with a distinct reason (no live rebuild, no cross-provenance fallback).
 *
 * Committed weekly records are read cache-only; each partition projects
 * through `projectAnalyticsPartition` (final canonical score + complete,
 * participant-verified evidence, per game, sibling-independent) and only the
 * projected rows aggregate.
 */
export async function loadOwnerSeasonStats(
  leagueSlug: string,
  year: number,
  currentRoster: Map<string, string>,
  source: OwnerSeasonStatsSource
): Promise<OwnerSeasonStatsLoad> {
  const provenance =
    source.kind === 'live'
      ? await assembleLiveAnalyticsProvenance({ leagueSlug, year, now: new Date() })
      : assembleArchiveAnalyticsProvenance(source.archive);
  if (provenance.status === 'unavailable') {
    return { status: 'unavailable', reason: provenance.reason };
  }

  const weekKeys = await listCachedGameStatsWeeks(year);
  if (weekKeys.length === 0) return { status: 'unavailable', reason: 'no-cached-partitions' };

  // Owner attribution resolves against the SAME identity inputs the provenance
  // was built from (live: the exact build's teams/aliases — never a second,
  // possibly-concurrent read). Archives carry no identity snapshot, so the
  // archive path loads identity ONCE, fail-closed: a read failure is typed
  // unavailability, never an escaping exception.
  let teams: TeamCatalogItem[];
  let aliasMap: AliasMap;
  if (provenance.identity !== null) {
    ({ teams, aliasMap } = provenance.identity);
  } else {
    try {
      [teams, aliasMap] = await Promise.all([
        getTeamDatabaseItems(),
        getScopedAliasMap(leagueSlug, year),
      ]);
    } catch {
      return { status: 'unavailable', reason: 'identity-load-failed' };
    }
  }
  // Observed names seed from the provenance slate's SETTLED participants —
  // never from raw provider labels of another build.
  const observedNames = Array.from(
    new Set(
      provenance.input.slate.games
        .flatMap((game) => [game.home?.canonicalName, game.away?.canonicalName])
        .filter((name): name is string => Boolean(name))
    )
  );
  const resolver = createTeamIdentityResolver({ teams, aliasMap, observedNames });

  // Season relation only disambiguates DEFECTIVE evidence (current → absent /
  // recoverable, historical → manual-only); neither state ever aggregates.
  const seasonRelation: SeasonRelation = source.kind === 'archive' ? 'historical' : 'current';

  const weeklyGames: AnalyticsGameStats[][] = [];
  for (const key of weekKeys) {
    const parts = key.split(':');
    if (parts.length !== 3) continue;
    const week = Number(parts[1]);
    if (!Number.isFinite(week)) continue;
    const seasonType = parts[2];
    if (seasonType !== 'regular' && seasonType !== 'postseason') continue;
    const stats = await getCachedGameStats(year, week, seasonType);
    const rows = projectAnalyticsPartition(
      provenance.input,
      week,
      seasonType,
      stats,
      seasonRelation
    );
    if (rows.length > 0) weeklyGames.push(rows);
  }

  return {
    status: 'available',
    stats: aggregateOwnerSeasonStats(weeklyGames, currentRoster, resolver, year),
  };
}

export type CareerStatsDiagnostic = {
  totalGames: number;
  resolvedGames: number;
  unresolvedGames: number;
  gameStatsCacheAvailable: boolean;
  /** Set when game stats are unavailable — the distinct fail-closed reason. */
  gameStatsUnavailableReason?: OwnerSeasonStatsUnavailableReason;
  ownersInFinalStandings: number;
};

export type CareerStatsBuildResult = {
  ownerCareerStats: OwnerCareerStats[];
  diagnosticsByYear: Record<number, CareerStatsDiagnostic>;
};

type CareerAccumulator = {
  owner: string;
  seasons: number;
  totalWins: number;
  totalLosses: number;
  totalPoints: number;
  totalPointsAgainst: number;
  totalYards: number;
  totalTurnovers: number;
  totalTurnoversForced: number;
  titles: number;
  titleYears: number[];
  finishHistory: { year: number; rank: number }[];
  firstSeason: number | null;
};

function emptyCareerAccumulator(owner: string): CareerAccumulator {
  return {
    owner,
    seasons: 0,
    totalWins: 0,
    totalLosses: 0,
    totalPoints: 0,
    totalPointsAgainst: 0,
    totalYards: 0,
    totalTurnovers: 0,
    totalTurnoversForced: 0,
    titles: 0,
    titleYears: [],
    finishHistory: [],
    firstSeason: null,
  };
}

function countUnresolvedGames(archive: SeasonArchive, roster: Map<string, string>): number {
  let unresolved = 0;
  for (const game of archive.games) {
    const homeOwner = roster.get(game.csvHome) ?? roster.get(game.canHome);
    const awayOwner = roster.get(game.csvAway) ?? roster.get(game.canAway);
    if (!homeOwner && !awayOwner) unresolved += 1;
  }
  return unresolved;
}

function countResolvedGames(archive: SeasonArchive, roster: Map<string, string>): number {
  let resolved = 0;
  for (const game of archive.games) {
    const homeOwner = roster.get(game.csvHome) ?? roster.get(game.canHome);
    const awayOwner = roster.get(game.csvAway) ?? roster.get(game.canAway);
    if (homeOwner || awayOwner) resolved += 1;
  }
  return resolved;
}

export async function buildOwnerCareerStats(params: {
  leagueSlug: string;
  currentYear: number;
  archives: SeasonArchive[];
  historicalRosters: Record<number, Map<string, string>>;
  currentRoster: Map<string, string>;
  /**
   * INSIGHTS-023a — the league's membership. Career history is accumulated for
   * THESE owners.
   *
   * Review (Codex, P1) found the first version of that slice was only half a
   * fix: it filtered departed owners downstream, but this function had already
   * seeded and filtered its accumulators from `currentRoster` — which before a
   * draft is last season's borrowed roster. So a confirmed member who sat out a
   * season had no career stats built at all, and no downstream membership check
   * could restore them. Removing departed owners worked; ADDING returning ones
   * did not.
   *
   * Optional so the debug route and any other caller keep their prior behaviour
   * by falling back to the roster map.
   */
  leagueMembers?: ReadonlySet<string>;
}): Promise<CareerStatsBuildResult> {
  const { leagueSlug, currentYear, archives, historicalRosters, currentRoster } = params;

  // EVERY owner who appears in the archives, plus the current membership.
  //
  // Both reviewers landed on the same principle: membership is the
  // eligibility-to-NAME filter, not the population a comparison is computed
  // over. Seeding these accumulators from members alone narrowed the YARDSTICK
  // as well as the guest list — so `volatility` could say nobody swings harder
  // when a departed owner swung harder, and `milestones` could call someone
  // "first to the mark" when the archives disprove it. False claims.
  //
  // Widening also subsumes the earlier fix for a returning member: she has
  // career history because she PLAYED, not because anyone threaded her through.
  //
  // Safe only because every consumer filters by `context.leagueMembers` before
  // naming anyone — verified by reading each call site.
  //
  // NOT pinned by the guard test, and an earlier version of this comment claimed
  // it was. That guard greps for `currentRoster.values(`, so an unfiltered
  // superlative over the now-wider stats passes it untouched — `trending` was
  // the live example. Superlative claims computed over a member-filtered subset
  // are a documented open class; see docs/next-tasks.md.
  const activeOwners = new Set<string>();
  for (const archive of archives) {
    for (const row of archive.finalStandings) {
      if (row.owner && row.owner !== NO_CLAIM_OWNER) activeOwners.add(row.owner);
    }
  }
  for (const owner of params.leagueMembers ?? currentRoster.values()) {
    if (owner && owner !== NO_CLAIM_OWNER) activeOwners.add(owner);
  }

  const accumulators = new Map<string, CareerAccumulator>();
  for (const owner of activeOwners) {
    accumulators.set(owner, emptyCareerAccumulator(owner));
  }

  const diagnosticsByYear: Record<number, CareerStatsDiagnostic> = {};
  const sortedArchives = [...archives].sort((a, b) => a.year - b.year);

  for (const archive of sortedArchives) {
    const yearRoster = historicalRosters[archive.year] ?? new Map<string, string>();
    const standings = archive.finalStandings;
    const eligibleRows = standings.filter(
      (row) => row.owner && row.owner !== NO_CLAIM_OWNER && activeOwners.has(row.owner)
    );

    const eligibleStandings = standings.filter((row) => row.owner && row.owner !== NO_CLAIM_OWNER);
    for (let i = 0; i < eligibleStandings.length; i++) {
      const row = eligibleStandings[i]!;
      if (!activeOwners.has(row.owner)) continue;

      const acc = accumulators.get(row.owner)!;
      acc.seasons += 1;
      acc.totalWins += row.wins;
      acc.totalLosses += row.losses;
      acc.totalPoints += row.pointsFor;
      acc.totalPointsAgainst += row.pointsAgainst;
      const rank = i + 1;
      acc.finishHistory.push({ year: archive.year, rank });
      if (rank === 1) {
        acc.titles += 1;
        acc.titleYears.push(archive.year);
      }
      if (acc.firstSeason === null || archive.year < acc.firstSeason) {
        acc.firstSeason = archive.year;
      }
    }

    // Archived-year game stats consume the archive's OWN paired provenance
    // (gameStatSlate + scoresByKey); a pre-E1 archive without a snapshot fails
    // closed here with a distinct reason until it is backfilled.
    const yearStats = await loadOwnerSeasonStats(leagueSlug, archive.year, yearRoster, {
      kind: 'archive',
      archive,
    });
    if (yearStats.status === 'available') {
      for (const stats of yearStats.stats) {
        if (!activeOwners.has(stats.owner)) continue;
        const acc = accumulators.get(stats.owner)!;
        acc.totalYards += stats.totalYards;
        acc.totalTurnovers += stats.turnovers;
        acc.totalTurnoversForced += stats.turnoversForced;
      }
    }

    diagnosticsByYear[archive.year] = {
      totalGames: archive.games.length,
      resolvedGames: countResolvedGames(archive, yearRoster),
      unresolvedGames: countUnresolvedGames(archive, yearRoster),
      gameStatsCacheAvailable: yearStats.status === 'available',
      ...(yearStats.status === 'unavailable'
        ? { gameStatsUnavailableReason: yearStats.reason }
        : {}),
      ownersInFinalStandings: eligibleRows.length,
    };
  }

  const ownerCareerStats: OwnerCareerStats[] = [];
  for (const acc of accumulators.values()) {
    const firstSeason = acc.firstSeason ?? currentYear;
    ownerCareerStats.push({
      owner: acc.owner,
      seasons: acc.seasons,
      totalWins: acc.totalWins,
      totalLosses: acc.totalLosses,
      totalPoints: acc.totalPoints,
      totalPointsAgainst: acc.totalPointsAgainst,
      totalYards: acc.totalYards,
      totalTurnovers: acc.totalTurnovers,
      totalTurnoversForced: acc.totalTurnoversForced,
      totalTurnoverMargin: acc.totalTurnoversForced - acc.totalTurnovers,
      titles: acc.titles,
      titleYears: acc.titleYears,
      finishHistory: acc.finishHistory.sort((a, b) => a.year - b.year),
      firstSeason,
      isRookie: firstSeason === currentYear,
    });
  }

  ownerCareerStats.sort((a, b) => b.totalWins - a.totalWins);
  return { ownerCareerStats, diagnosticsByYear };
}

/**
 * Who is IN the league, for the purposes of "should we speak about this owner".
 *
 * Exported for testing. Pure.
 */
export function resolveLeagueMembers(params: {
  confirmedOwners: readonly string[];
  /**
   * Where `confirmedOwners` came from, straight from `selectConfirmedRoster`.
   *
   * Re-inferring it from a non-empty array reported `confirmed` for any league
   * with a plain owners CSV and no confirmation record — so the diagnostics page
   * said "a new roster has been named for this season" when none had been, and
   * `current-roster` was unreachable for an ordinary roster. The selector is the
   * authority on its own answer; take it rather than reconstruct it.
   */
  confirmedSource: ConfirmedRosterSource;
  resolvedRoster: Map<string, string>;
  usingArchivedRoster: boolean;
}): { members: ReadonlySet<string>; source: LeagueMembersSource } {
  const { confirmedOwners, confirmedSource, resolvedRoster, usingArchivedRoster } = params;
  const clean = (names: Iterable<string>): string[] =>
    [...names].filter((o) => o && o !== NO_CLAIM_OWNER);

  // CONFIRMED FIRST. `confirmedRoster.ts` documents why, and it is the single
  // answer to "who is in the league": re-confirming owners must take effect
  // immediately, because a CSV-first rule makes adding an owner a silent no-op
  // for the rest of the season.
  //
  // An earlier version of this function inverted that to fix a mid-season freeze
  // — the confirmation screen is preseason-only, so a repaired roster never
  // reached Insights. That solved one freeze by creating its mirror image, and
  // did it by overturning a documented decision in the module whose whole
  // purpose is being the single answer. The freeze is real and is recorded as
  // its own fix (make the confirmation list writable in-season); it is not this
  // function's to work around.
  //
  // The threshold is re-checked AFTER cleaning, and that is the whole point.
  // `selectConfirmedRoster` counts `NoClaim` toward `MIN_CONFIRMED_OWNERS` on
  // the confirmation path — deliberately, because `NoClaim` in typed input is a
  // mistake to refuse (`findOwnerListProblem`), not a value to filter. `clean()`
  // strips it here. Doing that after the selector had already counted it meant a
  // legacy or hand-edited record of `['Alice', 'NoClaim']` cleared a two-owner
  // bar, beat a full four-owner CSV on precedence, and produced a ONE-member
  // league labelled `confirmed` — with the three real owners invisible to every
  // generator. Stripping a name silently lowers the bar it was counted toward,
  // so the bar has to be applied again to what survived.
  const fromConfirmed = clean(confirmedOwners);
  if (fromConfirmed.length >= MIN_CONFIRMED_OWNERS) {
    return {
      members: new Set(fromConfirmed),
      // `owners-csv` means the selector fell back to the season's roster record
      // because no confirmation record exists. Saying "confirmed" there is the
      // false claim this field was added to prevent.
      source: confirmedSource === 'preseason-owners' ? 'confirmed' : 'official-roster',
    };
  }

  // No usable confirmation record, but a current-year roster parsed. Two ways to
  // arrive: no confirmation record was ever written, or one was and it failed the
  // re-check above.
  //
  // The label is MEASURED, not deduced from which branch we are in. It was
  // deduced at first — "reaching here means the record named fewer than
  // `MIN_CONFIRMED_OWNERS`" — and the very next fix falsified that: refusing a
  // `NoClaim`-padded confirmation record drops a league with a FULL four-owner
  // roster into this branch, which would then have been reported as
  // `partial-roster`. Counting what is actually here cannot go stale that way.
  if (!usingArchivedRoster) {
    const fromCurrent = clean(resolvedRoster.values());
    if (fromCurrent.length > 0) {
      return {
        members: new Set(fromCurrent),
        // DISTINCT owners, not team rows. `resolvedRoster.values()` yields one
        // entry per TEAM and this is a multi-round snake draft, so one owner
        // holding two teams counted as two and a one-person roster reported as a
        // full one. Found in INSIGHTS-023a and deferred as a mislabelled caption
        // — which stopped being true when `membershipIsKnown` began reading this
        // label to decide whether copy may name who is playing. A partially
        // entered roster then licensed "Alice leads active owners" while the
        // real owners sat unentered.
        source:
          new Set(fromCurrent).size >= MIN_CONFIRMED_OWNERS ? 'official-roster' : 'partial-roster',
      };
    }
  }

  // No new roster named yet, so last season's owners are still the league
  // (owner framing: nobody has left until preseason names a new roster).
  const fromPrevious = clean(resolvedRoster.values());
  return {
    members: new Set(fromPrevious),
    source: fromPrevious.length > 0 ? 'previous-roster' : 'none',
  };
}

// Pure: exported for testing. Resolves the effective roster for insight
// generation, borrowing from the most recent archive when the current-year CSV
// is empty (fresh_offseason rollover window).
export function computeRosterFallback(
  currentRoster: Map<string, string>,
  archives: SeasonArchive[]
): { resolvedRoster: Map<string, string>; usingArchivedRoster: boolean } {
  if (currentRoster.size > 0 || archives.length === 0) {
    return { resolvedRoster: currentRoster, usingArchivedRoster: false };
  }
  const mostRecent = [...archives].sort((a, b) => b.year - a.year)[0]!;
  const rows = parseOwnersCsv(mostRecent.ownerRosterSnapshot);
  return {
    resolvedRoster: new Map(rows.map((r) => [r.team, r.owner])),
    usingArchivedRoster: true,
  };
}

export async function buildInsightContext(
  leagueSlug: string,
  league: League,
  currentStandings: OwnerStandingsRow[],
  weeklyStandings: StandingsHistoryWeekSnapshot[],
  games: AppGame[],
  seasonContext: SeasonContext,
  rankings: RankingsResponse | null,
  currentRoster: Map<string, string>,
  currentDate: Date,
  /**
   * The league's confirmed owner names. Passed in rather than read here so this
   * module keeps doing no store access of its own.
   */
  confirmedOwners: readonly string[] = [],
  confirmedSource: ConfirmedRosterSource = 'none',
  /**
   * Owners named by this season's CONFIRMED DRAFT, or null if none is confirmed.
   * Passed in rather than read here so this module keeps doing no store access.
   */
  seasonOwners: { year: number; owners: string[] } | null = null,
  /**
   * The season this context DESCRIBES.
   *
   * `league.year` is the league's current projection, but the standings, weekly
   * history and games passed in above are built for the year the CALLER
   * resolved, and `/api/insights/[slug]?year=` lets those differ. Everything
   * keyed off `currentYear` — league records, rookie detection, and the recap's
   * own title — would otherwise describe one season using another's number.
   * Defaults to `league.year`, so the ordinary path is unchanged.
   */
  describedYear: number = league.year
): Promise<InsightContext> {
  const regularWeeks = deriveRegularWeeks(games);
  const currentWeek = chooseDefaultWeek({ games, regularWeeks });
  const totalRegularSeasonWeeks = deriveTotalRegularSeasonWeeks(games);
  const leagueStatus = league.status ?? { state: 'season', year: league.year };
  const lifecycleState = deriveLifecycleState(
    leagueStatus,
    seasonContext,
    currentWeek,
    totalRegularSeasonWeeks,
    currentDate
  );

  const archives = await loadArchives(leagueSlug);
  const historicalRosters = buildHistoricalRosters(archives);

  const { resolvedRoster, usingArchivedRoster } = computeRosterFallback(currentRoster, archives);

  let ownerGameStats: OwnerSeasonStats[] | null = null;
  if (lifecycleState !== 'preseason' && lifecycleState !== 'offseason') {
    // Provenance must match the year. `loadOwnerSeasonStats` pairs a season with
    // ONE source, and `{ kind: 'live' }` rebuilds analytics from mutable
    // schedule and score caches. For an ARCHIVED year that would let a later
    // cache or identity change make historical cards disagree with the immutable
    // archive they sit beside, so an archived year loads against its archive.
    // Scoped to a year OTHER than the league's own. Rollover archives year Y
    // while `league.year` STAYS at Y, so matching on the year alone flips
    // `fresh_offseason` from live to archive provenance — and archives written
    // before PLATFORM-086H3E1 legitimately carry no `gameStatSlate`, so that
    // returns `archive-slate-missing` and blanks every stats generator in a
    // state where the live caches are still populated. A historical request is
    // the only case where live provenance would be wrong.
    const archiveForYear =
      describedYear === league.year
        ? null
        : (archives.find((entry) => entry.year === describedYear) ?? null);
    const load = await loadOwnerSeasonStats(
      leagueSlug,
      describedYear,
      resolvedRoster,
      archiveForYear ? { kind: 'archive', archive: archiveForYear } : { kind: 'live' }
    );
    ownerGameStats = load.status === 'available' ? load.stats : null;
  }

  // Resolved BEFORE career stats, which are seeded from it — see the P1 note on
  // `buildOwnerCareerStats`.
  const { members: leagueMembers, source: leagueMembersSource } = resolveLeagueMembers({
    confirmedOwners,
    confirmedSource,
    resolvedRoster,
    usingArchivedRoster,
  });

  // Resolved ONCE, here, so the generator and the diagnostics page cannot
  // disagree about why a feed is silent.
  // Computed here because it is the one place both records are in scope. Compared
  // on NORMALIZED identity, matching `buildMembershipHistory` — a case drift
  // between the confirmation screen and the draft is not a disagreement about WHO
  // is playing, and treating it as one would silence the feature for a typo.
  const draftedKeys = new Set((seasonOwners?.owners ?? []).map(identityKey));
  const membershipDisagreement =
    seasonOwners === null
      ? []
      : [...leagueMembers]
          .filter((owner) => owner && owner !== NO_CLAIM_OWNER && owner.trim())
          .filter((owner) => !draftedKeys.has(identityKey(owner)))
          .sort((a, b) => a.localeCompare(b));

  const { ownerCareerStats } = await buildOwnerCareerStats({
    leagueSlug,
    currentYear: describedYear,
    archives,
    historicalRosters,
    currentRoster: resolvedRoster,
    leagueMembers,
  });

  const records = selectAllRecords({
    archives,
    historicalRosters,
    currentYear: describedYear,
    currentRoster: resolvedRoster,
  });

  return {
    leagueSlug,
    currentYear: describedYear,
    lifecycleState,
    seasonOwners,
    membershipDisagreement,
    seasonContext,
    currentWeek,
    currentStandings,
    weeklyStandings,
    games,
    ownerGameStats,
    ownerCareerStats,
    archives,
    historicalRosters,
    rankings,
    currentRoster: resolvedRoster,
    usingArchivedRoster,
    // INSIGHTS-023a — the confirmed list once it exists; last season's owners
    // before that. Owner's framing (2026-08-16): "no one has left the league
    // until we've entered preseason and have a new roster of owners" —
    // offseason is the rear-looking phase and its members are the people who
    // played the season being looked back at, so the previous roster is the
    // ANSWER there, not stale data.
    //
    // An earlier version used the confirmed list unconditionally. Measured, that
    // emptied the feed entirely — 6 insights to 0 in offseason — for every
    // league between rollover and owner confirmation.
    //
    // NoClaim is filtered on both paths: `selectConfirmedRoster` drops it from
    // the CSV, but not from a legacy typed `preseason-owners` record, and the
    // roster map carries it as the absorber for unowned teams.
    leagueMembers,
    leagueMembersSource,
    records,
  };
}
