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

const MAX_DIAGNOSTIC_TEAM_LABEL_CODE_POINTS = 80;
const MAX_DIAGNOSTIC_KICKOFF_LENGTH = 64;
const DIAGNOSTIC_CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

function slateKey(week: number, seasonType: CfbdSeasonType): string {
  return `${week}:${seasonType}`;
}

/**
 * Provider and durable labels are untrusted at the diagnostic boundary. Keep a
 * useful human identity while preventing one malformed name from making the
 * admin response/render unbounded or injecting control characters.
 */
function sanitizeDiagnosticTeamLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(DIAGNOSTIC_CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const codePoints = Array.from(normalized);
  if (codePoints.length <= MAX_DIAGNOSTIC_TEAM_LABEL_CODE_POINTS) return normalized;
  return `${codePoints.slice(0, MAX_DIAGNOSTIC_TEAM_LABEL_CODE_POINTS - 1).join('')}…`;
}

function normalizeDiagnosticKickoff(value: string | null): string | null {
  if (!value || value.length > MAX_DIAGNOSTIC_KICKOFF_LENGTH) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function safeProviderGameId(value: number): string {
  return Number.isSafeInteger(value) && value > 0 ? String(value) : 'unknown';
}

function safeProviderWeek(value: number): string {
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : 'unknown';
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
      homeTeam: sanitizeDiagnosticTeamLabel(canonical.home?.canonicalName),
      awayTeam: sanitizeDiagnosticTeamLabel(canonical.away?.canonicalName),
      kickoff: normalizeDiagnosticKickoff(canonical.kickoff),
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
  // Defend the final presentation boundary too: System Health can receive a
  // separately constructed diagnostics fact in tests or future integrations.
  const homeTeam = sanitizeDiagnosticTeamLabel(game.homeTeam);
  const awayTeam = sanitizeDiagnosticTeamLabel(game.awayTeam);
  const providerGameId = safeProviderGameId(game.providerGameId);
  const week = safeProviderWeek(game.week);
  const seasonType =
    game.seasonType === 'regular' || game.seasonType === 'postseason' ? game.seasonType : 'unknown';
  const matchup =
    awayTeam && homeTeam ? `${awayTeam} at ${homeTeam}` : `CFBD game ${providerGameId}`;
  return `${matchup} (id ${providerGameId}, week ${week} ${seasonType})`;
}
