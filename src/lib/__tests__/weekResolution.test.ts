import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveStandingsHistory, isGameConcluded } from '../standingsHistory';
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

test('a final game is concluded regardless of when it started', () => {
  assert.equal(isGameConcluded(game({ key: 'g', week: 1, status: 'final' }), NOW), true);
});

test('a game kicking off in the future has not concluded', () => {
  const future = game({ key: 'g', week: 3, date: '2026-09-19T18:00:00.000Z' });
  assert.equal(isGameConcluded(future, NOW), false);
});

test('a game in progress has not concluded', () => {
  // Ninety minutes in. This is the case the eight-hour window exists for: a
  // shorter window would read a live game as abandoned.
  const live = game({ key: 'g', week: 2, date: '2026-09-12T16:30:00.000Z' });
  assert.equal(isGameConcluded(live, NOW), false);
});

test('a game still scheduled long after kickoff is concluded — it will never be played', () => {
  // The Liberty @ App State case. The provider will never resolve it, so
  // elapsed time is the only signal there is.
  const abandoned = game({ key: 'g', week: 1, date: '2026-09-05T18:00:00.000Z' });
  assert.equal(isGameConcluded(abandoned, NOW), true);
});

test('a game with no kickoff time is not concluded by inference', () => {
  // Nothing to measure against, so the inference is unavailable. It stays
  // unconcluded rather than being guessed either way.
  assert.equal(isGameConcluded(game({ key: 'g', week: 1, date: null }), NOW), false);
});

// ---------------------------------------------------------------------------

const ROSTER = { Alabama: 'Alice', Auburn: 'Bob' };
const CATALOG = new Set(['Alabama', 'Auburn', 'Akron', 'Army']);

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
    now: NOW,
    canonicalTeams: CATALOG,
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
    now: NOW,
    canonicalTeams: CATALOG,
  });

  assert.equal(history.byWeek[1]?.played, false);
});

test('an abandoned game does not hold its week open forever', () => {
  // One concluded game and one that kicked off a week ago and never resolved.
  // Without the elapsed-time clause this week — and therefore the season — never
  // closes, and the champion card never fires.
  const history = deriveStandingsHistory({
    games: [
      game({ key: 'a', week: 1, status: 'final', date: '2026-09-05T18:00:00.000Z' }),
      game({ key: 'b', week: 1, date: '2026-09-05T20:00:00.000Z' }),
    ],
    rosterByTeam: ROSTER,
    scoresByKey: {},
    now: NOW,
    canonicalTeams: CATALOG,
  });

  assert.equal(history.byWeek[1]?.played, true);
});

test('games outside the catalogue do not decide whether a week was played', () => {
  // Eleven of the twelve games that never resolved across six cached seasons
  // were non-FBS noise — six of them Alderson-Broaddus, a school that shut down
  // mid-2023. A week whose only unconcluded game is outside the catalogue is
  // still played.
  const history = deriveStandingsHistory({
    games: [
      game({ key: 'a', week: 1, status: 'final', date: '2026-09-05T18:00:00.000Z' }),
      game({
        key: 'junk',
        week: 1,
        date: '2026-09-19T18:00:00.000Z',
        participants: {
          home: {
            kind: 'team',
            teamId: 'x',
            displayName: 'Alderson-Broaddus',
            canonicalName: 'Alderson-Broaddus',
            rawName: 'Alderson-Broaddus',
          },
          away: {
            kind: 'team',
            teamId: 'y',
            displayName: 'Wheeling',
            canonicalName: 'Wheeling',
            rawName: 'Wheeling',
          },
        },
      }),
    ],
    rosterByTeam: ROSTER,
    scoresByKey: {},
    now: NOW,
    canonicalTeams: CATALOG,
  });

  assert.equal(history.byWeek[1]?.played, true);
});

test('a week with no games in the population is not played', () => {
  // It cannot be. Counting an empty week as played is how a season with nothing
  // in it could report itself complete.
  const history = deriveStandingsHistory({
    games: [
      game({
        key: 'junk',
        week: 1,
        date: '2026-09-05T18:00:00.000Z',
        status: 'final',
        participants: {
          home: {
            kind: 'team',
            teamId: 'x',
            displayName: 'Wheeling',
            canonicalName: 'Wheeling',
            rawName: 'Wheeling',
          },
          away: {
            kind: 'team',
            teamId: 'y',
            displayName: 'Bates',
            canonicalName: 'Bates',
            rawName: 'Bates',
          },
        },
      }),
    ],
    rosterByTeam: ROSTER,
    scoresByKey: {},
    now: NOW,
    canonicalTeams: CATALOG,
  });

  assert.equal(history.byWeek[1]?.played, false);
});
