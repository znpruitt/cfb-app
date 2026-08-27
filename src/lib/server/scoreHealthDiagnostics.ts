import type { CfbdSeasonType } from '../cfbd.ts';
import type { LiveScoreContext } from '../liveScores/canonicalContext.ts';
import { deriveElapsedTimeConclusionCoverage } from './elapsedTimeConclusionDiagnostics.ts';
import {
  deriveCompletedScoreCoverage,
  describeProviderDiagnosticGame,
  type ProviderDiagnosticGameRef,
} from './scoreGapDiagnostics.ts';

export type ScoreHealthDiagnostic = {
  severity: 'warning' | 'error';
  code:
    | 'scores-terminal-coverage-missing'
    | 'scores-terminal-coverage-partial'
    | 'scores-elapsed-time-conclusions';
  message: string;
  gameRefs: ProviderDiagnosticGameRef[];
  affectedGameCount: number;
};

function boundedGameSummary(
  games: readonly ProviderDiagnosticGameRef[],
  affectedGameCount: number,
  maxGameRefs: number
): { shown: ProviderDiagnosticGameRef[]; summary: string; suffix: string } {
  const shown = games.slice(0, maxGameRefs);
  return {
    shown,
    summary: shown.map(describeProviderDiagnosticGame).join('; '),
    suffix: affectedGameCount > shown.length ? `; +${affectedGameCount - shown.length} more` : '',
  };
}

/** Build every score-health diagnostic from one canonical context snapshot. */
export function deriveScoreHealthDiagnostics(input: {
  context: LiveScoreContext;
  completedSlates: ReadonlyArray<{ week: number; seasonType: CfbdSeasonType }>;
  now: Date;
  maxGameRefs: number;
}): ScoreHealthDiagnostic[] {
  const diagnostics: ScoreHealthDiagnostic[] = [];
  const coverage = deriveCompletedScoreCoverage(input);
  const affected = coverage.gaps.length;
  const gapSummary = boundedGameSummary(coverage.gaps, affected, input.maxGameRefs);

  if (affected > 0) {
    diagnostics.push({
      severity: affected === coverage.expectedGameCount ? 'error' : 'warning',
      code:
        affected === coverage.expectedGameCount
          ? 'scores-terminal-coverage-missing'
          : 'scores-terminal-coverage-partial',
      message:
        affected === coverage.expectedGameCount
          ? `No usable terminal score for any of ${affected} completed game(s): ${gapSummary.summary}${gapSummary.suffix}.`
          : `${affected} of ${coverage.expectedGameCount} completed game(s) lack a usable terminal score: ${gapSummary.summary}${gapSummary.suffix}.`,
      gameRefs: gapSummary.shown,
      affectedGameCount: affected,
    });
  }

  const elapsed = deriveElapsedTimeConclusionCoverage(input);
  if (elapsed.affectedGameCount > 0) {
    const elapsedSummary = boundedGameSummary(
      elapsed.games,
      elapsed.affectedGameCount,
      input.maxGameRefs
    );
    const identities = elapsedSummary.summary
      ? `: ${elapsedSummary.summary}${elapsedSummary.suffix}`
      : '';
    diagnostics.push({
      severity: 'warning',
      code: 'scores-elapsed-time-conclusions',
      message: `Canonical score diagnostics found ${elapsed.affectedGameCount} unresolved game(s) where every pending canonical game clears the eight-hour elapsed-time allowance${identities}. Review whether this reflects a genuine disruption or missing score evidence.`,
      gameRefs: elapsedSummary.shown,
      affectedGameCount: elapsed.affectedGameCount,
    });
  }

  return diagnostics;
}
