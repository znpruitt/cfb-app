import { assembleSeasonScoredBuild, SeasonScheduleCacheUnavailableError } from '../seasonBuild.ts';
import type { SeasonArchive } from '../seasonArchive.ts';
import { deriveCanonicalGameStatsSlateFromBuild } from './canonicalSlate.ts';
import type { CanonicalAnalyticsReadInput } from './publicProjection.ts';
import { parseGameStatSlateSnapshot, snapshotToCanonicalSlate } from './slateSnapshot.ts';

/**
 * PLATFORM-086H3E3 — the paired analytics provenance assemblies.
 *
 * Every owner/Insights/history/career game-stat value consumes ONLY
 * `projectAnalyticsPartition` output, and that projection's `{slate,
 * scoresByKey}` input must be ONE provenance — never a slate from one build
 * paired with scores from another.
 *
 * LIVE: the league-scoped scored build is assembled exactly once
 * (`assembleSeasonScoredBuild` — the same assembly archive construction uses:
 * cache-only schedule/teams/league-year-aliases/postseason-overrides/
 * reconciled-scores, ONE `buildScheduleFromApi` invocation, scores attached to
 * that same build), and the slate derives from that EXACT build's games + wire
 * rows. No league-agnostic rebuild, no provider access.
 *
 * ARCHIVE: the archive's OWN `gameStatSlate` snapshot (strictly parsed with
 * the archive's year as the pairing check) is paired ONLY with that archive's
 * own `scoresByKey`. An archive without a valid snapshot FAILS CLOSED with a
 * distinct reason — never a silent live rebuild, never cross-provenance
 * fallback; the established preview/confirm backfill is the only repair.
 */

export type AnalyticsProvenanceUnavailableReason =
  | 'schedule-cache-unavailable'
  | 'build-failed'
  | 'slate-derivation-failed'
  | 'archive-slate-missing'
  | 'archive-slate-malformed';

export type AnalyticsProvenanceResult =
  | { status: 'available'; input: CanonicalAnalyticsReadInput }
  | { status: 'unavailable'; reason: AnalyticsProvenanceUnavailableReason };

/**
 * Assemble the LIVE paired provenance for one league season, cache-only.
 * Failures are typed unavailability — never valid absence, never a partial
 * pairing.
 */
export async function assembleLiveAnalyticsProvenance(params: {
  leagueSlug: string;
  year: number;
  now: Date;
}): Promise<AnalyticsProvenanceResult> {
  const { leagueSlug, year, now } = params;

  let build;
  try {
    build = await assembleSeasonScoredBuild(leagueSlug, year);
  } catch (error) {
    return {
      status: 'unavailable',
      reason:
        error instanceof SeasonScheduleCacheUnavailableError
          ? 'schedule-cache-unavailable'
          : 'build-failed',
    };
  }

  try {
    const slate = deriveCanonicalGameStatsSlateFromBuild({
      year,
      games: build.games,
      scheduleItems: build.scheduleItems,
      teams: build.teams,
      aliasMap: build.aliasMap,
      now,
    });
    return { status: 'available', input: { slate, scoresByKey: build.scoresByKey } };
  } catch {
    // Empty catalog / ambiguous duplicate ids / unassociated provider ids —
    // unverifiable context, never served as absence.
    return { status: 'unavailable', reason: 'slate-derivation-failed' };
  }
}

/**
 * Assemble the ARCHIVE paired provenance from the archive's own snapshot and
 * scores. Pure; fails closed on a missing or malformed snapshot with distinct
 * reasons.
 */
export function assembleArchiveAnalyticsProvenance(
  archive: SeasonArchive
): AnalyticsProvenanceResult {
  const parsed = parseGameStatSlateSnapshot(archive.gameStatSlate, archive.year);
  if (parsed.status === 'absent') {
    return { status: 'unavailable', reason: 'archive-slate-missing' };
  }
  if (parsed.status === 'malformed') {
    return { status: 'unavailable', reason: 'archive-slate-malformed' };
  }
  return {
    status: 'available',
    input: {
      slate: snapshotToCanonicalSlate(parsed.snapshot),
      scoresByKey: archive.scoresByKey,
    },
  };
}
