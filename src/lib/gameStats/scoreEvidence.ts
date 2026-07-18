import { selectAnalyticsRows, type AnalyticsGameStats } from './contract.ts';
import type { GameStats } from './types.ts';

/**
 * PLATFORM-086H3 — H1-approved score evidence for archive integrity.
 *
 * The archive-integrity score comparison consumes ONLY the canonical
 * analytics projection: eligible rows (strict v2-complete with structural
 * points evidence, or bounded legacy-compatible stored points) project;
 * a v2 row with `pointsProvided: false` or compatibility-defaulted points,
 * unsupported schema versions, malformed rows, and conflicting duplicates
 * all project to NOTHING and can never appear as a "real score" in a diff.
 * Identical duplicates resolve deterministically to one projection.
 */
export function buildScoreEvidenceByProviderId(
  rows: readonly GameStats[]
): Map<number, AnalyticsGameStats> {
  const map = new Map<number, AnalyticsGameStats>();
  for (const projection of selectAnalyticsRows(rows).selected) {
    map.set(projection.providerGameId, projection);
  }
  return map;
}
