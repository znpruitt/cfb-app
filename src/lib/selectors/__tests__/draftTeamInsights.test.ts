import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame } from '@/lib/schedule';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import {
  selectDraftTeamInsights,
  compareDraftInsightsAlphabetical,
  type DraftTeamInsights,
} from '@/lib/selectors/draftTeamInsights';

// ---------------------------------------------------------------------------
// PLATFORM-086F2G1 — the draft insight selector retired SP+ ratings and win
// totals. It now derives only neutral factual context and produces one
// deterministic, recommendation-free ordering (alphabetical + stable team-id
// tie-break) shared by the commissioner and spectator boards.
// ---------------------------------------------------------------------------

function team(overrides: Partial<TeamCatalogItem> & { school: string }): TeamCatalogItem {
  return {
    displayName: overrides.school,
    shortDisplayName: overrides.school,
    abbreviation: overrides.school.slice(0, 4).toUpperCase(),
    level: 'FBS',
    conference: 'Big Ten',
    ...overrides,
  } as TeamCatalogItem;
}

/** Minimal AppGame carrying only the fields the selector reads. */
function game(canHome: string, canAway: string, neutral = false): AppGame {
  return {
    key: `${canHome}-${canAway}`,
    canHome,
    canAway,
    neutral,
    isPlaceholder: false,
  } as unknown as AppGame;
}

test('output carries no SP+/win-total-derived fields', () => {
  const insights = selectDraftTeamInsights({
    teams: [team({ school: 'Ohio State' })],
    schedule: [],
    apPoll: null,
    year: 2026,
  });
  const insight = insights[0]!;
  for (const retired of [
    'spRating',
    'spTier',
    'winTotalLow',
    'winTotalHigh',
    'sosTier',
    'awaitingRatings',
  ]) {
    assert.ok(!(retired in insight), `retired field ${retired} must be absent`);
  }
});

test('SP+ ratings are not accepted by the selector signature', () => {
  selectDraftTeamInsights({
    teams: [team({ school: 'Ohio State' })],
    schedule: [],
    apPoll: null,
    year: 2026,
    // @ts-expect-error — SP+ ratings are no longer an accepted input (retired).
    spRatings: [],
  });
});

test('win totals are not accepted by the selector signature', () => {
  selectDraftTeamInsights({
    teams: [team({ school: 'Ohio State' })],
    schedule: [],
    apPoll: null,
    year: 2026,
    // @ts-expect-error — win totals are no longer an accepted input (retired).
    winTotals: [],
  });
});

test('neutral factual context is intact (identity, conference, color, rank, schedule shape)', () => {
  const insights = selectDraftTeamInsights({
    teams: [team({ school: 'Ohio State', conference: 'Big Ten' })],
    schedule: [game('Ohio State', 'Michigan'), game('Penn State', 'Ohio State', true)],
    apPoll: [
      { teamName: 'Ohio State', rank: 3 },
      { teamName: 'Michigan', rank: 10 },
    ],
    year: 2026,
  });
  const osu = insights.find((i) => i.teamId === 'Ohio State')!;
  assert.equal(osu.teamName, 'Ohio State');
  assert.equal(osu.conference, 'Big Ten');
  assert.equal(typeof osu.teamColor, 'string');
  assert.equal(osu.preseasonRank, 3);
  assert.equal(osu.shortName, 'Ohio State');
  // One home game (vs Michigan) + one neutral game (at Penn State).
  assert.equal(osu.homeGames, 1);
  assert.equal(osu.neutralGames, 1);
  assert.equal(osu.awayGames, 0);
  // Michigan (AP #10) is a ranked opponent on the schedule.
  assert.equal(osu.rankedOpponentCount, 1);
});

test('available teams are alphabetical by name with a stable team-id tie-break', () => {
  const insights = selectDraftTeamInsights({
    teams: [
      team({ school: 'Zeta State' }),
      team({ school: 'alpha tech' }),
      team({ school: 'dup-b', displayName: 'Mid Name' }),
      team({ school: 'dup-a', displayName: 'Mid Name' }),
    ],
    schedule: [],
    apPoll: null,
    year: 2026,
  });
  assert.deepEqual(
    insights.map((i) => i.teamId),
    ['alpha tech', 'dup-a', 'dup-b', 'Zeta State']
  );
});

test('the shared comparator is a total order: alphabetical, then team-id', () => {
  const a = { teamName: 'Mid Name', teamId: 'dup-a' } as DraftTeamInsights;
  const b = { teamName: 'Mid Name', teamId: 'dup-b' } as DraftTeamInsights;
  const c = { teamName: 'Zeta', teamId: 'aaa' } as DraftTeamInsights;
  assert.ok(compareDraftInsightsAlphabetical(a, b) < 0, 'equal names → team-id tie-break');
  assert.ok(compareDraftInsightsAlphabetical(b, a) > 0, 'antisymmetric');
  assert.ok(compareDraftInsightsAlphabetical(a, c) < 0, 'name dominates the tie-break');
  assert.equal(compareDraftInsightsAlphabetical(a, a), 0, 'reflexive');
});

test('ordering is independent of team input order (deterministic)', () => {
  const forward = selectDraftTeamInsights({
    teams: [team({ school: 'Alpha' }), team({ school: 'Beta' }), team({ school: 'Gamma' })],
    schedule: [],
    apPoll: null,
    year: 2026,
  }).map((i) => i.teamId);
  const reversed = selectDraftTeamInsights({
    teams: [team({ school: 'Gamma' }), team({ school: 'Beta' }), team({ school: 'Alpha' })],
    schedule: [],
    apPoll: null,
    year: 2026,
  }).map((i) => i.teamId);
  assert.deepEqual(forward, reversed, 'same order regardless of input order');
  assert.deepEqual(forward, ['Alpha', 'Beta', 'Gamma']);
});
