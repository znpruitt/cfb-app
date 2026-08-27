import assert from 'node:assert/strict';
import test from 'node:test';

import type { CanonicalGame } from '../../gameStats/canonicalSlate.ts';
import type { LiveScoreContext, LiveScoreGame } from '../../liveScores/canonicalContext.ts';
import type { ScorePack } from '../../scores/types.ts';
import type { TeamIdentityResolver } from '../../teamIdentity.ts';
import { deriveCompletedScoreCoverage, describeScoreGapGame } from '../scoreGapDiagnostics.ts';

const COMPLETED_SLATE = [{ week: 1, seasonType: 'regular' as const }];

function canonical(providerGameId: number, overrides: Partial<CanonicalGame> = {}): CanonicalGame {
  return {
    providerGameId,
    key: `game-${providerGameId}`,
    eventId: String(providerGameId),
    providerWeek: 1,
    seasonType: 'regular',
    neutral: false,
    applicability: 'expected',
    notExpectedReason: null,
    home: { identityKey: `home-${providerGameId}`, canonicalName: `Home ${providerGameId}` },
    away: { identityKey: `away-${providerGameId}`, canonicalName: `Away ${providerGameId}` },
    homeId: providerGameId * 10 + 1,
    awayId: providerGameId * 10 + 2,
    kickoff: '2026-10-11T20:00:00.000Z',
    rawStatus: 'STATUS_FINAL',
    status: 'final',
    completed: true,
    ...overrides,
  };
}

function score(
  providerGameId: number,
  status: string,
  home: number | null = 21,
  away: number | null = 14
): ScorePack {
  return {
    id: String(providerGameId),
    week: 1,
    seasonType: 'regular',
    startDate: '2026-10-11T20:00:00.000Z',
    status,
    home: { team: `Home ${providerGameId}`, score: home },
    away: { team: `Away ${providerGameId}`, score: away },
    time: null,
  };
}

function liveGame(game: CanonicalGame, cachedScore: ScorePack | null): LiveScoreGame {
  return {
    canonical: game,
    cachedStatus: null,
    cachedScore,
    cachedScoreAt: cachedScore ? Date.parse('2026-10-15T12:00:00.000Z') : null,
    pendingConfirmation: false,
  };
}

function coverage(games: LiveScoreGame[]) {
  const context: LiveScoreContext = {
    year: 2026,
    games,
    resolver: {} as TeamIdentityResolver,
  };
  return deriveCompletedScoreCoverage({ context, completedSlates: COMPLETED_SLATE });
}

test('a final game cannot cover an in-progress sibling', () => {
  const result = coverage([
    liveGame(canonical(101), score(101, 'STATUS_FINAL')),
    liveGame(canonical(102), score(102, 'STATUS_IN_PROGRESS', 10, 7)),
  ]);
  assert.equal(result.expectedGameCount, 2);
  assert.deepEqual(
    result.gaps.map((gap) => gap.providerGameId),
    [102]
  );
  assert.equal(result.gaps[0].reason, 'score-nonterminal');
});

test('a final row with one missing score remains a gap', () => {
  const result = coverage([liveGame(canonical(101), score(101, 'STATUS_FINAL', 21, null))]);
  assert.equal(result.expectedGameCount, 1);
  assert.equal(result.gaps[0].reason, 'final-score-incomplete');
});

test('a canceled game is scoreless-terminal unless stronger completion evidence conflicts', () => {
  const canceled = canonical(101, {
    applicability: 'not-expected',
    notExpectedReason: 'disrupted',
    rawStatus: 'STATUS_CANCELED',
    status: 'scheduled',
    completed: false,
  });
  assert.deepEqual(coverage([liveGame(canceled, null)]), { expectedGameCount: 0, gaps: [] });

  const conflicting = { ...canceled, completed: true };
  const result = coverage([liveGame(conflicting, null)]);
  assert.equal(result.expectedGameCount, 1);
  assert.deepEqual(
    result.gaps.map((gap) => gap.providerGameId),
    [101]
  );
});

test('a postponed game without stronger evidence does not owe a final', () => {
  const game = canonical(101, {
    applicability: 'not-expected',
    notExpectedReason: 'disrupted',
    rawStatus: 'STATUS_POSTPONED',
    status: 'scheduled',
    completed: false,
  });
  assert.deepEqual(coverage([liveGame(game, null)]), { expectedGameCount: 0, gaps: [] });
});

test('a pending game owes no final unless stronger conclusion evidence exists', () => {
  const pending = canonical(101, {
    applicability: 'pending',
    kickoff: null,
    rawStatus: 'STATUS_SCHEDULED',
    status: 'scheduled',
    completed: false,
  });
  assert.deepEqual(coverage([liveGame(pending, null)]), { expectedGameCount: 0, gaps: [] });

  const completed = { ...pending, completed: true };
  const result = coverage([liveGame(completed, null)]);
  assert.equal(result.expectedGameCount, 1);
  assert.deepEqual(
    result.gaps.map((gap) => gap.providerGameId),
    [101]
  );
});

test('a full placeholder shell never becomes a score gap', () => {
  const placeholder = canonical(101, {
    applicability: 'not-expected',
    notExpectedReason: 'placeholder',
    home: null,
    away: null,
    completed: true,
  });
  assert.deepEqual(coverage([liveGame(placeholder, null)]), { expectedGameCount: 0, gaps: [] });
});

test('score-gap identities sanitize and bound untrusted canonical labels', () => {
  const result = coverage([
    liveGame(
      canonical(101, {
        home: { identityKey: 'home-101', canonicalName: '\u0000\n\t' },
        away: {
          identityKey: 'away-101',
          canonicalName: `Away\t\u202e${'X'.repeat(200)}\u2028`,
        },
        kickoff: `2026-10-11T20:00:00.000Z${'X'.repeat(100)}`,
      }),
      null
    ),
  ]);

  const gap = result.gaps[0]!;
  assert.equal(gap.homeTeam, null);
  assert.equal(Array.from(gap.awayTeam ?? '').length, 80);
  assert.doesNotMatch(gap.awayTeam ?? '', /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
  assert.equal(gap.kickoff, null);
  assert.match(describeScoreGapGame(gap), /^CFBD game 101 /);
});
