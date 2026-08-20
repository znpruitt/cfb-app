import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveSeasonRunInsights } from '@/lib/selectors/insights';
import type { StandingsHistory, StandingsHistoryWeekSnapshot } from '@/lib/standingsHistory';
import type { OwnerStandingsRow } from '@/lib/standings';

// ---------------------------------------------------------------------------
// INSIGHTS-033 — season-scale movement.
//
// The derivation is pure, so it is tested directly rather than through a seeded
// league: the fixture is a rank ORDER per week, which is the only input the
// claim depends on. Building it through `buildLeagueInsightContext` would add a
// durable standings-history record to every case and test the store instead.
//
// The model is `docs/architecture/insight-movement-model.md`. The property that
// distinguishes this card from every other movement card is its BASELINE: an
// owner's own low this season, not week 1 and not the previous week.
// ---------------------------------------------------------------------------

function row(owner: string): OwnerStandingsRow {
  return {
    owner,
    wins: 5,
    losses: 3,
    ties: 0,
    winPct: 0.625,
    pointsFor: 200,
    pointsAgainst: 150,
    pointDifferential: 50,
    gamesBack: 0,
    finalGames: 8,
  } as OwnerStandingsRow;
}

/** `orders[week]` is the standings order for that week, best first. */
function historyOf(orders: Record<number, string[]>): {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
} {
  const weeks = Object.keys(orders)
    .map(Number)
    .sort((a, b) => a - b);
  const byWeek: Record<number, StandingsHistoryWeekSnapshot> = {};
  for (const week of weeks) {
    byWeek[week] = {
      week,
      standings: orders[week]!.map(row),
    } as StandingsHistoryWeekSnapshot;
  }
  return { standingsHistory: { weeks, byWeek, byOwner: {} }, resolvedWeeks: weeks };
}

test('climb: the baseline is the owner OWN low, not week 1', async () => {
  // Alice starts 2nd, collapses to 9th by week 4, and is 2nd again now. Measured
  // from week 1 her net move is ZERO and this card would never fire; measured
  // from her own low it is the comeback of the season, which is the reading the
  // owner chose (2026-08-19).
  const { standingsHistory, resolvedWeeks } = historyOf({
    1: ['Bob', 'Alice', 'Carol', 'Dave', 'Erin', 'Frank', 'Gina', 'Hank', 'Ivy'],
    4: ['Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Gina', 'Hank', 'Ivy', 'Alice'],
    8: ['Bob', 'Alice', 'Carol', 'Dave', 'Erin', 'Frank', 'Gina', 'Hank', 'Ivy'],
  });

  const insights = deriveSeasonRunInsights({ standingsHistory, resolvedWeeks });
  const climb = insights.find((i) => i.type === 'season_climb');
  assert.ok(climb, 'the climb card must fire');
  assert.equal(climb.description, 'Alice has climbed from 9th in week 4 to 2nd.');
  assert.equal(climb.title, 'Biggest climb of the season');
  assert.equal(climb.statValue, 7);
});

test('slide: the baseline is the owner own high', async () => {
  const { standingsHistory, resolvedWeeks } = historyOf({
    1: ['Alice', 'Bob', 'Carol', 'Dave', 'Erin'],
    3: ['Alice', 'Bob', 'Carol', 'Dave', 'Erin'],
    7: ['Bob', 'Carol', 'Dave', 'Erin', 'Alice'],
  });

  const insights = deriveSeasonRunInsights({ standingsHistory, resolvedWeeks });
  const slide = insights.find((i) => i.type === 'season_slide');
  assert.ok(slide, 'the slide card must fire');
  // Week 3, not week 1. Alice was 1st in both, and the baseline is the MOST
  // RECENT time she was at her extreme — a run is measured from where it
  // started, not from the first time that rank was ever held.
  assert.equal(slide.description, 'Alice has slid from 1st in week 3 to 5th.');
  assert.equal(slide.statValue, 4);
});

test('an owner is never their own baseline', async () => {
  // Every week identical: nobody has moved, so neither card may fire.
  //
  // This test does NOT prove the latest week is excluded from the baseline —
  // mutation showed that swapping the loop for the full week list leaves it
  // green, because a zero distance fails `MIN_SEASON_RUN` either way. Stated
  // here so the exclusion is not mistaken for a tested guarantee.
  const { standingsHistory, resolvedWeeks } = historyOf({
    1: ['Alice', 'Bob', 'Carol', 'Dave'],
    2: ['Alice', 'Bob', 'Carol', 'Dave'],
    3: ['Alice', 'Bob', 'Carol', 'Dave'],
  });

  assert.deepEqual(deriveSeasonRunInsights({ standingsHistory, resolvedWeeks }), []);
});

test('a move smaller than the floor is not a run', async () => {
  // Two places. `deriveMovementInsights` already reports week-scale movement of
  // two; a season-scale card that fired on the same distance would be a second
  // voice saying the same thing.
  const { standingsHistory, resolvedWeeks } = historyOf({
    1: ['Alice', 'Bob', 'Carol', 'Dave'],
    2: ['Bob', 'Carol', 'Alice', 'Dave'],
    3: ['Alice', 'Bob', 'Carol', 'Dave'],
  });

  const insights = deriveSeasonRunInsights({ standingsHistory, resolvedWeeks });
  assert.deepEqual(
    insights.filter((i) => i.type === 'season_climb'),
    []
  );
});

test('two resolved weeks produce nothing — that is the week-scale card', async () => {
  // With two weeks the owner's low IS the previous week, so this card would be
  // `deriveMovementInsights` wearing a season label.
  const { standingsHistory, resolvedWeeks } = historyOf({
    1: ['Bob', 'Carol', 'Dave', 'Erin', 'Alice'],
    2: ['Alice', 'Bob', 'Carol', 'Dave', 'Erin'],
  });

  assert.deepEqual(deriveSeasonRunInsights({ standingsHistory, resolvedWeeks }), []);
});

test('a tie names everyone level, and too many level suppresses the card', async () => {
  const tied = historyOf({
    1: ['Carol', 'Dave', 'Erin', 'Alice', 'Bob'],
    2: ['Carol', 'Dave', 'Erin', 'Alice', 'Bob'],
    3: ['Alice', 'Bob', 'Carol', 'Dave', 'Erin'],
  });
  const climb = deriveSeasonRunInsights(tied).find((i) => i.type === 'season_climb');
  assert.ok(climb, 'two owners level at three places must still produce a card');
  // Each owner keeps their own baseline and week; the tie branch must not
  // collapse them into a bare distance, which drops the week the model requires
  // every climb to name.
  assert.equal(
    climb.description,
    'Alice has climbed from 4th in week 2 to 1st. Bob has climbed from 5th in week 2 to 2nd.'
  );
  assert.deepEqual(climb.relatedOwners, ['Bob']);

  // The other half the name promises. Four owners level is not a story about
  // anyone, so the card is withheld rather than listing the whole league.
  const crowded = historyOf({
    1: ['Erin', 'Frank', 'Alice', 'Bob', 'Carol', 'Dave'],
    2: ['Erin', 'Frank', 'Alice', 'Bob', 'Carol', 'Dave'],
    3: ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank'],
  });
  assert.deepEqual(
    deriveSeasonRunInsights(crowded).filter((i) => i.type === 'season_climb'),
    []
  );
});
