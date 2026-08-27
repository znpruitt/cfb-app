import type { CfbdSeasonType } from '../cfbd.ts';
import { classifyGameConclusionEvidence, classifyScorePackStatus } from '../gameStatus.ts';
import type { LiveScoreContext } from '../liveScores/canonicalContext.ts';

/** A provider-addressable game whose completed-slate score evidence is incomplete. */
export type ScoreGapGameRef = {
  providerGameId: number;
  week: number;
  seasonType: CfbdSeasonType;
  homeTeam: string | null;
  awayTeam: string | null;
  kickoff: string | null;
  reason: 'score-absent' | 'score-nonterminal' | 'final-score-incomplete';
};

export type CompletedScoreCoverage = {
  /** Games in completed slates that require a terminal numeric result. */
  expectedGameCount: number;
  /** Every expected game whose own attached score is not a usable final. */
  gaps: ScoreGapGameRef[];
};

function slateKey(week: number, seasonType: CfbdSeasonType): string {
  return `${week}:${seasonType}`;
}

/**
 * PLATFORM-112 — game-granular completed-score coverage.
 *
 * The caller owns the completed-slate timing policy. This function owns only
 * per-game evidence: each addressable canonical game is checked against the
 * score attached to THAT game's canonical key by `loadLiveScoreContext`.
 * Cancellation is accepted through the shared conclusion classifier; a final
 * requires both numeric scores. One good row can therefore never cover a
 * sibling game in the same provider partition.
 */
export function deriveCompletedScoreCoverage(input: {
  context: LiveScoreContext;
  completedSlates: ReadonlyArray<{ week: number; seasonType: CfbdSeasonType }>;
}): CompletedScoreCoverage {
  const completed = new Set(
    input.completedSlates.map((slate) => slateKey(slate.week, slate.seasonType))
  );
  const gaps: ScoreGapGameRef[] = [];
  let expectedGameCount = 0;

  for (const game of input.context.games) {
    const { canonical, cachedScore } = game;
    if (!completed.has(slateKey(canonical.providerWeek, canonical.seasonType))) continue;

    // A full placeholder shell is not a game yet. Disrupted and pending real
    // games still flow through the shared conclusion classifier so stronger
    // evidence (`completed: true` or a final) can win.
    if (canonical.notExpectedReason === 'placeholder') continue;

    const conclusion = classifyGameConclusionEvidence(
      {
        status: canonical.status ?? 'scheduled',
        rawStatus: canonical.rawStatus,
        completed: canonical.completed,
      },
      cachedScore ?? undefined
    );
    if (conclusion === 'scoreless-terminal') continue;

    // Canonical applicability is the evidence-expectation authority. A
    // postponed/suspended/delayed game, or one whose kickoff cannot yet prove it
    // old enough, owes no final unless stronger conclusion evidence says it was
    // played. This also makes a concurrent schedule replacement harmless: a
    // future row from the newer snapshot cannot inherit the older snapshot's
    // completed-slate expectation.
    if (
      (canonical.notExpectedReason === 'disrupted' || canonical.applicability === 'pending') &&
      conclusion !== 'score-required'
    ) {
      continue;
    }

    expectedGameCount += 1;
    const isFinal = classifyScorePackStatus(cachedScore ?? undefined) === 'final';
    const hasBothScores = cachedScore?.home.score != null && cachedScore.away.score != null;
    if (isFinal && hasBothScores) continue;

    gaps.push({
      providerGameId: canonical.providerGameId,
      week: canonical.providerWeek,
      seasonType: canonical.seasonType,
      homeTeam: canonical.home?.canonicalName ?? null,
      awayTeam: canonical.away?.canonicalName ?? null,
      kickoff: canonical.kickoff,
      reason: !cachedScore
        ? 'score-absent'
        : isFinal
          ? 'final-score-incomplete'
          : 'score-nonterminal',
    });
  }

  return { expectedGameCount, gaps };
}

export function describeScoreGapGame(game: ScoreGapGameRef): string {
  const matchup =
    game.awayTeam && game.homeTeam
      ? `${game.awayTeam} at ${game.homeTeam}`
      : `CFBD game ${game.providerGameId}`;
  return `${matchup} (id ${game.providerGameId}, week ${game.week} ${game.seasonType})`;
}
