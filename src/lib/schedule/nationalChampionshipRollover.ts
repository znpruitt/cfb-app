/**
 * PLATFORM-086E1A — the authoritative national-championship rollover boundary.
 *
 * Season rollover (season → offseason, archive write) must fire ONLY off a
 * genuinely finished national championship, never off a text-name guess or "the
 * latest postseason game." This module is the single decision authority the
 * season-rollover cron consults per year. It:
 *
 *   1. reads the canonical schedule state cache-only;
 *   2. resolves the authoritative championship game — an exact canonical schedule
 *      game with a real CFBD provider game id, a STRUCTURED CFBD playoff
 *      competition identifying the CFP, a STRUCTURED round identifying the national
 *      championship, a valid kickoff, and `playoffRoundSource === 'cfbd-structured'`
 *      (text/name inference NEVER qualifies);
 *   3. reads reconciled scores via `loadReconciledSeasonScoresByType` and attaches
 *      them through the centralized schedule/score identity helpers;
 *   4. requires that exact game to be canonically final (a complete final with both
 *      scores present, not disrupted);
 *   5. requires the seven-day post-kickoff waiting period.
 *
 * Any missing/ambiguous/not-final/disrupted/unattached condition SKIPS rollover
 * without mutation. A genuine durable READ failure surfaces as `read-failed` (a
 * failure) rather than being treated as ordinary absence, so a store outage can
 * never masquerade as "no championship yet."
 *
 * Cache-only: it never contacts CFBD. Scores remain owned by the score cache.
 */

import { getScopedAliasMap } from '../server/globalAliasStore.ts';
import { loadReconciledSeasonScoresByType } from '../server/scoreCacheReader.ts';
import { getTeamDatabaseItems } from '../server/teamDatabaseStore.ts';
import { loadCachedScheduleItems } from '../server/canonicalScheduleCache.ts';
import { buildScheduleFromApi, type ScheduleWireItem } from '../schedule.ts';
import { createTeamIdentityResolver } from '../teamIdentity.ts';
import {
  attachScoresToSchedule,
  buildScheduleIndex,
  type NormalizedScoreRow,
} from '../scoreAttachment.ts';
import { isLikelyInvalidTeamLabel } from '../teamNormalization.ts';
import { classifyScorePackStatus } from '../gameStatus.ts';
// The FULL reconciled ScorePack (carries id/seasonType/startDate/week) — a
// structural superset of the narrow `scores.ts` ScorePack the status classifier
// accepts, so it satisfies both the normalized-row mapping and the finality check.
import type { ScorePack } from '../scores/types.ts';

/** Seven days after kickoff — the existing rollover waiting period. */
export const ROLLOVER_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export type ChampionshipRolloverSkipReason =
  | 'no-season-schedule' // the schedule cache is genuinely absent for this year
  | 'no-structured-championship' // no game carries a structured CFP national-championship identity
  | 'score-missing' // no reconciled score attached to the championship game
  | 'not-final' // the championship game is not (completely) final
  | 'disrupted' // the championship game is canceled/postponed/suspended/delayed
  | 'waiting-period'; // final, but championship + 7 days has not elapsed

export type ChampionshipRolloverDecision =
  | { kind: 'eligible'; year: number; championshipDate: string; rolloverDate: string }
  | { kind: 'skip'; year: number; reason: ChampionshipRolloverSkipReason }
  | { kind: 'read-failed'; year: number; detail: string };

/** Whether a structured competition string identifies the College Football Playoff. */
function competitionIdentifiesCfp(competition: string | undefined): boolean {
  if (!competition) return false;
  return /college football playoff|\bcfp\b/i.test(competition);
}

/** A usable ISO kickoff → epoch ms, or null. */
function kickoffMs(startDate: string | null | undefined): number | null {
  if (typeof startDate !== 'string' || startDate.length === 0) return null;
  const ms = Date.parse(startDate);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Resolve THE authoritative championship schedule item for a year, or null. The
 * gate is deliberately strict: a real numeric CFBD provider game id, a structured
 * CFP competition, a structured `national_championship` round, a valid kickoff,
 * and `playoffRoundSource === 'cfbd-structured'`. When more than one qualifies
 * (should not happen), the latest kickoff wins.
 */
export function resolveStructuredChampionshipItem(
  items: ScheduleWireItem[]
): ScheduleWireItem | null {
  const candidates = items.filter(
    (item) =>
      item.playoffRoundSource === 'cfbd-structured' &&
      item.playoffRound === 'national_championship' &&
      competitionIdentifiesCfp(
        typeof item.playoffCompetition === 'string' ? item.playoffCompetition : undefined
      ) &&
      typeof item.id === 'string' &&
      /^\d+$/.test(item.id) &&
      kickoffMs(item.startDate) !== null
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, item) =>
    (kickoffMs(item.startDate) ?? 0) > (kickoffMs(latest.startDate) ?? 0) ? item : latest
  );
}

/** A complete, terminal final: classified `final` with BOTH scores present. */
function isCompleteFinal(pack: ScorePack): boolean {
  return (
    classifyScorePackStatus(pack) === 'final' &&
    pack.home.score !== null &&
    pack.away.score !== null
  );
}

function scoresCacheItemToNormalizedRow(
  item: ScorePack,
  defaultSeasonType: 'regular' | 'postseason'
): NormalizedScoreRow {
  const seasonType =
    item.seasonType === 'regular' || item.seasonType === 'postseason'
      ? item.seasonType
      : defaultSeasonType;
  return {
    week: item.week,
    seasonType,
    providerEventId: item.id ?? null,
    status: item.status,
    time: item.time,
    date: item.startDate ?? null,
    home: item.home,
    away: item.away,
  };
}

/**
 * Decide whether one year is eligible for national-championship rollover at `now`.
 * Every branch is cache-only and mutation-free. See the module doc for the gate.
 */
export async function resolveNationalChampionshipRollover(
  year: number,
  now: number
): Promise<ChampionshipRolloverDecision> {
  // 1. Canonical schedule state, cache-only. A store READ failure surfaces as a
  //    failure; genuine absence (`[]`) is an ordinary skip.
  let scheduleItems: ScheduleWireItem[];
  try {
    scheduleItems = await loadCachedScheduleItems(year);
  } catch (error) {
    return {
      kind: 'read-failed',
      year,
      detail: error instanceof Error ? error.message : 'schedule cache read failed',
    };
  }
  if (scheduleItems.length === 0) {
    return { kind: 'skip', year, reason: 'no-season-schedule' };
  }

  // 2. Authoritative championship game (structured identity only).
  const championshipItem = resolveStructuredChampionshipItem(scheduleItems);
  if (!championshipItem) {
    return { kind: 'skip', year, reason: 'no-structured-championship' };
  }
  const championshipDate = championshipItem.startDate as string; // validated above

  // 3-4. Build canonical games + attach reconciled scores through the centralized
  //      helpers, then read the championship game's attached score. A store read
  //      failure anywhere here is a durable read failure (surface as failure); a
  //      genuine data absence yields no attached score (an ordinary skip).
  let score: ScorePack | undefined;
  try {
    const teams = await getTeamDatabaseItems();
    const aliasMap = await getScopedAliasMap('', year);
    const { games } = buildScheduleFromApi({ scheduleItems, teams, aliasMap, season: year });

    const observedNames = Array.from(
      new Set(
        scheduleItems
          .flatMap((item) => [item.homeTeam, item.awayTeam])
          .filter(
            (name): name is string => typeof name === 'string' && !isLikelyInvalidTeamLabel(name)
          )
      )
    );
    const resolver = createTeamIdentityResolver({ teams, aliasMap, observedNames });

    const { regular, postseason } = await loadReconciledSeasonScoresByType({
      year,
      teams,
      aliasMap,
    });
    const normalizedRows: NormalizedScoreRow[] = [
      ...regular.items.map((item) => scoresCacheItemToNormalizedRow(item, 'regular')),
      ...postseason.items.map((item) => scoresCacheItemToNormalizedRow(item, 'postseason')),
    ];

    const scheduleIndex = buildScheduleIndex(games, resolver);
    const { scoresByKey } = attachScoresToSchedule({
      rows: normalizedRows,
      scheduleIndex,
      resolver,
    });

    // Match the championship game by its exact CFBD provider game id, then read the
    // score the centralized attachment placed on that game's canonical key.
    const championshipGame = games.find((game) => game.providerGameId === championshipItem.id);
    if (championshipGame) {
      score = (scoresByKey as Record<string, ScorePack>)[championshipGame.key];
    }
  } catch (error) {
    return {
      kind: 'read-failed',
      year,
      detail: error instanceof Error ? error.message : 'rollover score attachment failed',
    };
  }

  if (!score) {
    return { kind: 'skip', year, reason: 'score-missing' };
  }
  if (classifyScorePackStatus(score) === 'disrupted') {
    return { kind: 'skip', year, reason: 'disrupted' };
  }
  if (!isCompleteFinal(score)) {
    return { kind: 'skip', year, reason: 'not-final' };
  }

  // 5-6. Final — enforce the seven-day post-kickoff waiting period.
  const championshipMs = kickoffMs(championshipDate);
  if (championshipMs === null) {
    // Unreachable (validated in resolveStructuredChampionshipItem); defensive skip.
    return { kind: 'skip', year, reason: 'no-structured-championship' };
  }
  const rolloverMs = championshipMs + ROLLOVER_DELAY_MS;
  if (now < rolloverMs) {
    return { kind: 'skip', year, reason: 'waiting-period' };
  }

  return {
    kind: 'eligible',
    year,
    championshipDate,
    rolloverDate: new Date(rolloverMs).toISOString(),
  };
}
