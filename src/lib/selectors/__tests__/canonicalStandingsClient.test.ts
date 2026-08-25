import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalStandingsClientProps } from '../canonicalStandingsClient.ts';
import type { CanonicalStandings } from '../leagueStandings.ts';
import { selectSeasonContext } from '../seasonContext.ts';
import type { StandingsHistory, StandingsHistoryWeekSnapshot } from '../../standingsHistory.ts';

// ---------------------------------------------------------------------------
// PLATFORM-109 — the server→client projection of canonical standings.
//
// `pending` exists for exactly one consumer (`selectSeasonContext`) and used to
// be serialized to the browser in full so the browser could reduce it to one of
// three strings. These tests pin both halves of the replacement: the reduction
// happens on the server and gives the SAME answer, and the list itself no longer
// crosses the boundary.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-09-06T12:00:00.000Z');

/** More than eight hours before NOW — `hasGameBeenAbandoned` is true. */
const LONG_PAST_KICKOFF = '2026-09-05T18:00:00.000Z';
/** Inside the eight-hour allowance — still waiting on a result. */
const RECENT_KICKOFF = '2026-09-06T11:00:00.000Z';

function historyWithPending(
  pendingByWeek: Record<number, Array<{ key: string; week: number; kickoff: string | null }>>
): StandingsHistory {
  const weeks = Object.keys(pendingByWeek).map(Number).sort();
  const byWeek: StandingsHistory['byWeek'] = {};
  for (const week of weeks) {
    byWeek[week] = {
      week,
      standings: [
        {
          owner: 'Alice',
          wins: 1,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 30,
          pointsAgainst: 10,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 1,
        },
      ],
      coverage: { state: 'complete', message: null },
      played: (pendingByWeek[week] ?? []).length === 0,
      pending: pendingByWeek[week],
    };
  }
  return {
    weeks,
    byWeek,
    byOwner: {
      Alice: weeks.map((week) => ({
        week,
        wins: 1,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 30,
        pointsAgainst: 10,
        pointDifferential: 20,
        gamesBack: 0,
      })),
    },
  };
}

function canonical(standingsHistory: StandingsHistory | null): CanonicalStandings {
  return {
    slug: 'tsc',
    year: 2026,
    source: 'live',
    lifecycle: 'mid_season',
    rows: [],
    noClaimRow: null,
    ownerColorOrder: ['Alice'],
    standingsHistory,
    coverage: { state: 'complete', message: null },
    ownersRosterSource: 'csv',
    archiveYearResolved: null,
    inferredSeasonStart: null,
    generatedAt: NOW.toISOString(),
  };
}

test('strips pending from every week snapshot', () => {
  const history = historyWithPending({
    1: [{ key: 'g1', week: 1, kickoff: RECENT_KICKOFF }],
    2: [
      { key: 'g2', week: 2, kickoff: LONG_PAST_KICKOFF },
      { key: 'g3', week: 2, kickoff: null },
    ],
    3: [],
  });

  const { canonicalStandings } = canonicalStandingsClientProps(canonical(history), NOW);
  const projected = canonicalStandings?.standingsHistory;
  assert.ok(projected, 'history must survive the projection');

  for (const week of projected.weeks) {
    const snapshot: StandingsHistoryWeekSnapshot | undefined = projected.byWeek[week];
    assert.ok(snapshot, `week ${week} must survive the projection`);
    assert.equal(
      Object.prototype.hasOwnProperty.call(snapshot, 'pending'),
      false,
      `week ${week} must not carry a pending list across the client boundary`
    );
  }
});

test('preserves every other field of every week snapshot', () => {
  const history = historyWithPending({
    1: [{ key: 'g1', week: 1, kickoff: RECENT_KICKOFF }],
    2: [],
  });

  const { canonicalStandings } = canonicalStandingsClientProps(canonical(history), NOW);
  const projected = canonicalStandings!.standingsHistory!;

  assert.deepEqual(projected.weeks, history.weeks);
  assert.deepEqual(projected.byOwner, history.byOwner);
  for (const week of history.weeks) {
    const expected = { ...history.byWeek[week]! };
    delete expected.pending;
    assert.deepEqual(projected.byWeek[week], expected, `week ${week} lost more than pending`);
  }
});

test('does not mutate the snapshot it was given', () => {
  const history = historyWithPending({
    1: [{ key: 'g1', week: 1, kickoff: RECENT_KICKOFF }],
  });
  const input = canonical(history);

  canonicalStandingsClientProps(input, NOW);

  assert.deepEqual(
    input.standingsHistory!.byWeek[1]!.pending,
    [{ key: 'g1', week: 1, kickoff: RECENT_KICKOFF }],
    'the cached snapshot must keep its pending list for server-side consumers'
  );
});

// The season-context half. Each case is asserted against `selectSeasonContext`
// over the ORIGINAL history — the exact computation the client used to run — so
// a divergence fails rather than being re-derived from the same code path twice.
test('season context matches the pre-projection computation — season still running', () => {
  const history = historyWithPending({
    1: [{ key: 'g1', week: 1, kickoff: RECENT_KICKOFF }],
  });

  const { seasonContext } = canonicalStandingsClientProps(canonical(history), NOW);

  assert.equal(seasonContext, 'in-season');
  assert.equal(seasonContext, selectSeasonContext({ standingsHistory: history, now: NOW }));
});

test('season context matches the pre-projection computation — every pending game abandoned', () => {
  // The whole reason `pending` was serialized: the eight-hour allowance has to
  // be applied at request time, and it is the ONLY input that turns this answer
  // `final` while games are still unconcluded.
  const history = historyWithPending({
    1: [{ key: 'g1', week: 1, kickoff: LONG_PAST_KICKOFF }],
  });

  const { seasonContext } = canonicalStandingsClientProps(canonical(history), NOW);

  assert.equal(seasonContext, 'final');
  assert.equal(seasonContext, selectSeasonContext({ standingsHistory: history, now: NOW }));
});

test('season context follows the clock it is given, not wall time', () => {
  const history = historyWithPending({
    1: [{ key: 'g1', week: 1, kickoff: LONG_PAST_KICKOFF }],
  });
  const beforeTheAllowanceElapses = new Date('2026-09-05T20:00:00.000Z');

  assert.equal(
    canonicalStandingsClientProps(canonical(history), beforeTheAllowanceElapses).seasonContext,
    'in-season'
  );
  assert.equal(canonicalStandingsClientProps(canonical(history), NOW).seasonContext, 'final');
});

test('an absent snapshot yields no standings and the empty-history context', () => {
  const { canonicalStandings, seasonContext } = canonicalStandingsClientProps(undefined, NOW);

  assert.equal(canonicalStandings, undefined);
  assert.equal(seasonContext, selectSeasonContext({ standingsHistory: null, now: NOW }));
});

test('a null history is passed through untouched', () => {
  const { canonicalStandings, seasonContext } = canonicalStandingsClientProps(canonical(null), NOW);

  assert.equal(canonicalStandings?.standingsHistory, null);
  assert.equal(seasonContext, 'in-season');
});
