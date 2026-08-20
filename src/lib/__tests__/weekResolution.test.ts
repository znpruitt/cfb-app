import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveStandingsHistory, isGameConcluded } from '../standingsHistory';
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

test('a final game is concluded regardless of when it started', () => {
  assert.equal(isGameConcluded(game({ key: 'g', week: 1, status: 'final' }), undefined, NOW), true);
});

test('a game kicking off in the future has not concluded', () => {
  const future = game({ key: 'g', week: 3, date: '2026-09-19T18:00:00.000Z' });
  assert.equal(isGameConcluded(future, undefined, NOW), false);
});

test('a game in progress has not concluded', () => {
  // Ninety minutes in. This is the case the eight-hour window exists for: a
  // shorter window would read a live game as abandoned.
  const live = game({ key: 'g', week: 2, date: '2026-09-12T16:30:00.000Z' });
  assert.equal(isGameConcluded(live, undefined, NOW), false);
});

test('a game still scheduled long after kickoff is concluded — it will never be played', () => {
  // The Liberty @ App State case. The provider will never resolve it, so
  // elapsed time is the only signal there is.
  const abandoned = game({ key: 'g', week: 1, date: '2026-09-05T18:00:00.000Z' });
  assert.equal(isGameConcluded(abandoned, undefined, NOW), true);
});

test('a game with no kickoff time is not concluded by inference', () => {
  // Nothing to measure against, so the inference is unavailable. It stays
  // unconcluded rather than being guessed either way.
  assert.equal(isGameConcluded(game({ key: 'g', week: 1, date: null }), undefined, NOW), false);
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
    now: NOW,
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
  });

  assert.equal(history.byWeek[1]?.played, true);
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
    now: NOW,
  });

  assert.equal(history.byWeek[1]?.played, false);
});

// ---------------------------------------------------------------------------
// Evidence ordering. The first round tested only `status === 'final'`, which
// BOTH reviewers found production never produces — CFBD supplies no status
// string, so every game arrives `scheduled` and the week was decided purely by
// the wall clock.
// ---------------------------------------------------------------------------

test('a cached FINAL SCORE concludes the game, whatever the schedule says', () => {
  // The production shape: schedule status `scheduled`, result in the score
  // cache. Without this a Saturday's games are all final and cached by 11:30pm
  // and the week stays unplayed until 4am.
  const g = game({ key: 'g', week: 1, date: '2026-09-12T16:00:00.000Z' });
  assert.equal(g.status, 'scheduled', 'the fixture must reach the production shape');
  assert.equal(isGameConcluded(g, finalScore as unknown as ScorePack, NOW), true);
});

test("the provider's completed flag concludes the game", () => {
  const g = game({ key: 'g', week: 1, date: '2026-09-12T16:00:00.000Z', completed: true });
  assert.equal(isGameConcluded(g, undefined, NOW), true);
});

test('a CANCELLED game is terminal', () => {
  // Narrower than "disrupted" on purpose — the repo already draws this line.
  const g = game({ key: 'g', week: 1, date: '2026-09-19T18:00:00.000Z', rawStatus: 'Canceled' });
  assert.equal(isGameConcluded(g, undefined, NOW), true);
});

test('a POSTPONED game is not concluded, even long after its old kickoff', () => {
  // It is still coming, and its cached kickoff is the one it no longer has.
  // Order matters: falling through to the elapsed clause closes its week
  // tomorrow.
  const g = game({ key: 'g', week: 1, date: '2026-09-05T18:00:00.000Z', rawStatus: 'Postponed' });
  assert.equal(isGameConcluded(g, undefined, NOW), false);
});

test('only elapsed-time conclusions are reported, and they are reported', () => {
  // One is a hurricane; twenty is a broken feed. The first round declared this
  // type and never populated it, while every production game was concluding by
  // elapsed time — the missing signal was exactly what would have surfaced that.
  const history = deriveStandingsHistory({
    games: [
      game({ key: 'scored', week: 1, date: '2026-09-05T18:00:00.000Z' }),
      game({ key: 'flagged', week: 1, date: '2026-09-05T18:00:00.000Z', completed: true }),
      game({ key: 'abandoned', week: 1, date: '2026-09-05T20:00:00.000Z' }),
    ],
    rosterByTeam: ROSTER,
    scoresByKey: scored('scored'),
    now: NOW,
  });

  assert.equal(history.byWeek[1]?.played, true);
  assert.deepEqual(
    (history.inferredConclusions ?? []).map((c) => c.key),
    ['abandoned'],
    'a scored or provider-flagged game is not an inference'
  );
});

test('a POSTPONED game is recognised from the SCORE, which is where the label lives', () => {
  // The schedule's status is inert — all 22,691 cached items say `scheduled` —
  // so the first version of this guard, which asked only `game.rawStatus`, could
  // never fire. `toStatus` preserves an unrecognized provider label verbatim, so
  // the disruption arrives on the ScorePack instead.
  const g = game({ key: 'g', week: 1, date: '2026-09-05T18:00:00.000Z' });
  const postponed = { status: 'Postponed', home: { score: null }, away: { score: null } };
  assert.equal(isGameConcluded(g, postponed as unknown as ScorePack, NOW), false);
});

test('a CANCELLED game is recognised from the score too', () => {
  const g = game({ key: 'g', week: 1, date: '2026-09-19T18:00:00.000Z' });
  const canceled = { status: 'Canceled', home: { score: null }, away: { score: null } };
  assert.equal(isGameConcluded(g, canceled as unknown as ScorePack, NOW), true);
});

test('a TBD kickoff is not a kickoff', () => {
  // `startTimeTBD` marks a placeholder timestamp the app refuses to trust
  // elsewhere. Measuring elapsed time against it can conclude a game BEFORE it
  // is played.
  const tbd = game({ key: 'g', week: 1, date: '2026-09-05T18:00:00.000Z', startTimeTBD: true });
  assert.equal(isGameConcluded(tbd, undefined, NOW), false);
});

test('a placeholder row does not decide whether a week was played', () => {
  // A postseason bracket shell carries `startDate: null` and can never be final,
  // so under "every game must conclude" one of them pins its week to
  // `played: false` forever — and a live season could then never reach `final`.
  const history = deriveStandingsHistory({
    games: [
      game({ key: 'real', week: 1, status: 'final', date: '2026-09-05T18:00:00.000Z' }),
      game({ key: 'shell', week: 1, date: null, isPlaceholder: true }),
    ],
    rosterByTeam: ROSTER,
    scoresByKey: scored('real'),
    now: NOW,
  });

  assert.equal(history.byWeek[1]?.played, true);
});

// ---------------------------------------------------------------------------
// The chart domain. Review found a user-visible regression here that no test
// covered, because nothing in this repo exercised the Overview surface.
// ---------------------------------------------------------------------------

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
