import { isDisruptedStatusLabel } from '../gameStatus.ts';

/**
 * Whether a canonical schedule game is EXPECTED to produce team stats. Disrupted
 * games (canceled/postponed/suspended/delayed, via `gameStatus.ts`) never do — a
 * slate composed only of them is not applicable for game-stats retrieval, so it
 * must not trigger a missing-stats diagnostic or a cron provider retry (5th-review
 * findings #1/#3). Shared by slate-expectation derivation AND recovery planning
 * so both use ONE definition of a stat-producing game (no duplicate status
 * parsing).
 *
 * PLATFORM-086H3 note: every other coverage/usability judgement lives in the
 * shared committed-state model (`partitionCoverage.ts`, over the H1 typed
 * classification). The former content-based "usable row" helpers were retired
 * with it — a names-and-id shell is not availability, and no consumer may keep
 * a parallel interpretation of usability or recoverability.
 */
export function expectsGameStats(status: string | null | undefined): boolean {
  return !isDisruptedStatusLabel(status);
}
