import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveStandingsHistory,
  hasGameBeenAbandoned,
  isConcludedByEvidence,
  isPlannedGame,
  isRealGame,
} from '../standingsHistory';
import type { ScorePack } from '../scores';
import type { AppGame } from '../schedule';

// ---------------------------------------------------------------------------
// PLATFORM-105 — a week is played only when its games have concluded.
//
// The model is `docs/architecture/week-resolution.md`. The elapsed-time clause
// exists because CFBD cannot tell us a game was cancelled: `/games` carries no
// status field, and a cancelled game keeps `completed: false` with null scores
// permanently — `Liberty @ App State` (week 5, 2024, Hurricane Helene) still
// returned `completed: false` when CFBD was queried directly on 2026-08-19.
// A future game and an abandoned one differ only in which side of now their
// kickoff falls on.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-09-12T18:00:00.000Z');

function game(over: Partial<AppGame> & { key: string; week: number }): AppGame {
  return {
    eventId: over.key,
    providerWeek: over.week,
    canonicalWeek: over.week,
    date: null,
    stage: 'regular',
    status: 'scheduled',
    stageOrder: 0,
    slotOrder: 0,
    eventKey: over.key,
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    participants: {
      home: {
        kind: 'team',
        teamId: 'h',
        displayName: 'Home',
        canonicalName: 'Alabama',
        rawName: 'Alabama',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: 'Away',
        canonicalName: 'Auburn',
        rawName: 'Auburn',
      },
    },
    csvHome: 'Alabama',
    csvAway: 'Auburn',
    canHome: 'Alabama',
    canAway: 'Auburn',
    homeConf: '',
    awayConf: '',
    ...over,
  } as AppGame;
}

test('a result concludes a game, whatever the schedule says', () => {
  // The production shape: schedule status `scheduled`, result in the score
  // cache. `game.status` is effectively never `final` for CFBD data.
  const g = game({ key: 'g', week: 1, date: '2026-09-12T16:00:00.000Z' });
  assert.equal(g.status, 'scheduled', 'the fixture must reach the production shape');
  assert.equal(isConcludedByEvidence(g, finalScore as unknown as ScorePack), true);
});

test("the provider's completed flag concludes a game", () => {
  const g = game({ key: 'g', week: 1, completed: true });
  assert.equal(isConcludedByEvidence(g, undefined), true);
});

test('a CANCELLED game is terminal, and the label comes from the score', () => {
  const g = game({ key: 'g', week: 1, date: '2026-09-19T18:00:00.000Z' });
  const canceled = { status: 'Canceled', home: { score: null }, away: { score: null } };
  assert.equal(isConcludedByEvidence(g, canceled as unknown as ScorePack), true);
});

test('nothing else is concluded by evidence', () => {
  const g = game({ key: 'g', week: 1, date: '2026-09-05T18:00:00.000Z' });
  assert.equal(isConcludedByEvidence(g, undefined), false);
});

// A REAL game has both teams known; a PLANNED game also has a determined time.

test('a bracket shell is not a real game', () => {
  const shell = game({
    key: 'shell',
    week: 15,
    participants: {
      home: { kind: 'placeholder', slotId: 'cfp-1', displayName: 'Winner of A' },
      away: { kind: 'placeholder', slotId: 'cfp-2', displayName: 'Winner of B' },
    },
  });
  assert.equal(isRealGame(shell), false);
  assert.equal(isRealGame(game({ key: 'g', week: 1 })), true);
});

test('a real game with no determined time was never PLANNED', () => {
  // "A game can only not happen if it was ever planned to occur." A bowl
  // matchup announced without a kickoff is an incomplete dataset, not a stuck
  // game — so the abandonment inference does not apply to it.
  assert.equal(isPlannedGame(game({ key: 'g', week: 1, date: null })), false);
  assert.equal(
    isPlannedGame(
      game({ key: 'g', week: 1, date: '2026-09-05T18:00:00.000Z', startTimeTBD: true })
    ),
    false
  );
  assert.equal(isPlannedGame(game({ key: 'g', week: 1, date: '2026-09-05T18:00:00.000Z' })), true);
});

// Abandonment is evaluated at REQUEST time, never cached.

test('a kickoff in the future is not abandoned', () => {
  assert.equal(
    hasGameBeenAbandoned({ key: 'g', week: 3, kickoff: '2026-09-19T18:00:00.000Z' }, NOW),
    false
  );
});

test('a game in progress is not abandoned', () => {
  // Ninety minutes in — the case the eight-hour window exists for.
  assert.equal(
    hasGameBeenAbandoned({ key: 'g', week: 2, kickoff: '2026-09-12T16:30:00.000Z' }, NOW),
    false
  );
});

test('a kickoff long past with no result is abandoned', () => {
  // The Liberty @ App State case: CFBD will never resolve it.
  assert.equal(
    hasGameBeenAbandoned({ key: 'g', week: 1, kickoff: '2026-09-05T18:00:00.000Z' }, NOW),
    true
  );
});

test('a game that was never planned to a moment is never abandoned', () => {
  assert.equal(hasGameBeenAbandoned({ key: 'g', week: 1, kickoff: null }, NOW), false);
});

// ---------------------------------------------------------------------------

const ROSTER = { Alabama: 'Alice', Auburn: 'Bob' };

/**
 * A final score for a played game. Coverage is CUMULATIVE, so without this a
 * later week reads `partial` because an EARLIER week's final game is missing its
 * score — which would let the assertion below pass for the wrong reason.
 */
const finalScore = { status: 'final', home: { score: 31 }, away: { score: 17 } };
const scored = (...keys: string[]): Record<string, never> =>
  Object.fromEntries(keys.map((k) => [k, finalScore])) as Record<string, never>;

test('an unplayed week is NOT played, even though its coverage is complete', () => {
  // The whole defect in one assertion. Week 2 has a game next Saturday: no final
  // game, therefore no MISSING final score, therefore complete coverage. That is
  // what made every future week count as resolved.
  const history = deriveStandingsHistory({
    games: [
      game({ key: 'w1', week: 1, status: 'final', date: '2026-09-05T18:00:00.000Z' }),
      game({ key: 'w2', week: 2, date: '2026-09-19T18:00:00.000Z' }),
    ],
    rosterByTeam: ROSTER,
    scoresByKey: scored('w1'),
  });

  assert.equal(history.byWeek[1]?.played, true);
  assert.equal(history.byWeek[2]?.played, false);
  assert.equal(
    history.byWeek[2]?.coverage.state,
    'complete',
    'and its coverage is still complete — that is why played had to be its own fact'
  );
});

test('a week is played only when EVERY game in it has concluded', () => {
  const history = deriveStandingsHistory({
    games: [
      game({ key: 'a', week: 1, status: 'final', date: '2026-09-12T13:00:00.000Z' }),
      // Kicks off tonight — the week is not done.
      game({ key: 'b', week: 1, date: '2026-09-12T23:00:00.000Z' }),
    ],
    rosterByTeam: ROSTER,
    scoresByKey: {},
  });

  assert.equal(history.byWeek[1]?.played, false);
});

test('an abandoned game does not hold the SEASON open forever', async () => {
  // The guarantee moved. `played` is evidence-only now, so the week stays
  // false — but the season is a question about GAMES, and a game planned for a
  // kickoff long past that nothing will ever resolve does not keep it open.
  // This is the Hurricane Helene case, and it is evaluated at request time
  // rather than baked into the cached snapshot.
  const { selectSeasonContext } = await import('@/lib/selectors/seasonContext');
  const history = deriveStandingsHistory({
    games: [
      game({ key: 'a', week: 1, date: '2026-09-05T18:00:00.000Z', completed: true }),
      game({ key: 'b', week: 1, date: '2026-09-05T20:00:00.000Z' }),
    ],
    rosterByTeam: ROSTER,
    scoresByKey: {},
  });

  assert.equal(history.byWeek[1]?.played, false, 'no evidence concluded game b');
  assert.equal(
    selectSeasonContext({ standingsHistory: history, now: NOW }),
    'final',
    'but the season is over: nothing will ever resolve game b'
  );
  // And before the eight-hour mark it is NOT over.
  assert.equal(
    selectSeasonContext({ standingsHistory: history, now: new Date('2026-09-05T21:00:00.000Z') }),
    'in-season'
  );
});

test('an FBS-vs-FCS game still to come keeps its week open', () => {
  // The first round required BOTH participants in the FBS catalogue, which
  // dropped exactly this game. `buildScheduleFromApi` keeps FBS-vs-FCS
  // deliberately and it moves the standings, so a week could read played on
  // Sunday while an owned team's Monday-night game against an FCS opponent was
  // still ahead — and Monday's result would rewrite a week already treated as
  // settled. The non-FBS noise that filter was written for never reaches
  // `games` at all: `isTrackedGame` excludes both-non-FBS games upstream.
  const history = deriveStandingsHistory({
    games: [
      game({ key: 'a', week: 1, status: 'final', date: '2026-09-05T18:00:00.000Z' }),
      game({
        key: 'fcs',
        week: 1,
        date: '2026-09-14T23:00:00.000Z',
        participants: {
          home: {
            kind: 'team',
            teamId: 'h',
            displayName: 'Alabama',
            canonicalName: 'Alabama',
            rawName: 'Alabama',
          },
          away: {
            kind: 'team',
            teamId: 'y',
            displayName: 'Mercer',
            canonicalName: 'Mercer',
            rawName: 'Mercer',
          },
        },
      }),
    ],
    rosterByTeam: ROSTER,
    scoresByKey: scored('a'),
  });

  assert.equal(history.byWeek[1]?.played, false);
});

// ---------------------------------------------------------------------------
// Evidence ordering. The first round tested only `status === 'final'`, which
// BOTH reviewers found production never produces — CFBD supplies no status
// string, so every game arrives `scheduled` and the week was decided purely by
// the wall clock.
// ---------------------------------------------------------------------------

test('a POSTPONED game stays pending, with NO kickoff to measure against', () => {
  // Its cached kickoff is the one it no longer has, so carrying it forward would
  // let the abandonment rule close the week tomorrow. The label comes from the
  // score — the schedule's status is always `scheduled`.
  const postponed = { status: 'Postponed', home: { score: null }, away: { score: null } };
  const history = deriveStandingsHistory({
    games: [game({ key: 'p', week: 1, date: '2026-09-05T18:00:00.000Z' })],
    rosterByTeam: ROSTER,
    scoresByKey: { p: postponed } as never,
  });

  assert.equal(history.byWeek[1]?.played, false);
  assert.deepEqual(history.byWeek[1]?.pending, [{ key: 'p', week: 1, kickoff: null }]);
});

test('pending carries the planned kickoff, so a consumer can apply the clock', () => {
  // The cached snapshot stores WHEN, never WHETHER — AGENTS.md invariant 3
  // forbids caching a clock-dependent verdict, and earlier rounds of this slice
  // did exactly that.
  const history = deriveStandingsHistory({
    games: [
      game({ key: 'done', week: 1, date: '2026-09-05T18:00:00.000Z', completed: true }),
      game({ key: 'gone', week: 1, date: '2026-09-05T20:00:00.000Z' }),
      game({ key: 'tbd', week: 1, date: '2026-09-05T21:00:00.000Z', startTimeTBD: true }),
    ],
    rosterByTeam: ROSTER,
    scoresByKey: {},
  });

  assert.deepEqual(history.byWeek[1]?.pending, [
    { key: 'gone', week: 1, kickoff: '2026-09-05T20:00:00.000Z' },
    { key: 'tbd', week: 1, kickoff: null },
  ]);
  assert.equal(history.byWeek[1]?.played, false, 'evidence only — nothing is abandoned here');
});

test('an all-bracket week does not block a finished season', async () => {
  // The WIRING, not just the predicate. Mutation-proved: counting shells as real
  // games left every suite green, so the derivation could have gone on waiting
  // for "winner of A vs winner of B" with nothing to catch it — and that is the
  // failure this model exists to end.
  const { selectSeasonContext } = await import('@/lib/selectors/seasonContext');
  const shell = (key: string) =>
    game({
      key,
      week: 15,
      date: null,
      participants: {
        home: { kind: 'placeholder', slotId: `${key}-h`, displayName: 'Winner of A' },
        away: { kind: 'placeholder', slotId: `${key}-a`, displayName: 'Winner of B' },
      },
    });

  const history = deriveStandingsHistory({
    games: [
      game({ key: 'played', week: 1, date: '2026-09-05T18:00:00.000Z', completed: true }),
      shell('cfp1'),
      shell('cfp2'),
    ],
    rosterByTeam: ROSTER,
    scoresByKey: {},
  });

  assert.deepEqual(history.byWeek[15]?.pending, [], 'a shell is nothing to wait on');
  assert.equal(history.byWeek[15]?.played, false, 'and it is not a played week either');
  assert.equal(
    selectSeasonContext({ standingsHistory: history, now: NOW }),
    'final',
    'the season is over: every REAL game has a result'
  );
});

test('the GB chart domain is the last RESOLVED weeks, not the last scheduled ones', async () => {
  const { sliceStandingsHistoryToRecentWeeks } = await import('@/components/OverviewPanel');
  // `standings` must be NON-EMPTY: resolved requires a usable snapshot as well
  // as a played week, and an empty fixture would make this pass for the wrong
  // reason by resolving nothing at all.
  const snapshot = (week: number, played: boolean) => ({
    week,
    standings: [{ owner: 'Alice' }],
    coverage: { state: 'complete' as const, message: null },
    played,
  });
  const history = {
    weeks: [1, 2, 3, 4, 5, 6, 7],
    byWeek: {
      1: snapshot(1, true),
      2: snapshot(2, true),
      3: snapshot(3, true),
      4: snapshot(4, false),
      5: snapshot(5, false),
      6: snapshot(6, false),
      7: snapshot(7, false),
    },
    byOwner: { Alice: [1, 2, 3, 4, 5, 6, 7].map((week) => ({ week }) as never) },
  };

  const sliced = sliceStandingsHistoryToRecentWeeks(history as never, 5);
  // RESOLVED, not merely played: a played week with incomplete coverage is
  // dropped by the trend selectors, so slicing on `played` alone would still
  // leave a labelled column with no series.
  // Taking the last five SCHEDULED weeks gives [3,4,5,6,7] — four of them empty,
  // which is the empty GB Race review reported.
  assert.deepEqual(sliced.weeks, [1, 2, 3]);
  assert.deepEqual(
    sliced.byOwner.Alice?.map((p) => p.week),
    [1, 2, 3]
  );
});
