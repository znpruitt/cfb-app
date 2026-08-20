import assert from 'node:assert/strict';
import test from 'node:test';

import { selectSeasonContext } from '../selectors/seasonContext';
import type { StandingsHistory } from '../standingsHistory';

/**
 * PLATFORM-105 — `playedWeeks` is now a separate axis from `resolvedWeeks`.
 *
 * These fixtures used to express "this week has not happened" as *unresolved
 * coverage*, which is the exact conflation the slice removes: an unplayed week
 * has no missing scores, so its real coverage is `complete`. A week that has not
 * been played is now said with `played: false`, and coverage says only whether
 * scores are missing for games that WERE played.
 *
 * `playedWeeks` defaults to every week, so a fixture that says nothing about it
 * describes a season whose weeks have all happened.
 */
function createHistory(args: {
  weeks: number[];
  resolvedWeeks: number[];
  playedWeeks?: number[];
}): StandingsHistory {
  const { weeks, resolvedWeeks } = args;
  const playedWeeks = args.playedWeeks ?? weeks;

  const byWeek: StandingsHistory['byWeek'] = {};
  const byOwner: StandingsHistory['byOwner'] = {
    Alice: [],
  };

  for (const week of weeks) {
    const resolved = resolvedWeeks.includes(week);
    byWeek[week] = {
      week,
      standings: resolved
        ? [
            {
              owner: 'Alice',
              wins: week,
              losses: 0,
              ties: 0,
              winPct: 1,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 0,
              finalGames: week,
            },
          ]
        : [],
      coverage: {
        state: resolved ? 'complete' : 'partial',
        message: null,
      },
      played: playedWeeks.includes(week),
      // PLATFORM-105 — season-over is now a question about GAMES. An unplayed
      // week carries a real game that has not concluded, with a kickoff in the
      // FUTURE so it is pending rather than abandoned.
      pending: playedWeeks.includes(week)
        ? []
        : [{ key: `w${week}`, week, kickoff: '2099-01-01T00:00:00.000Z' }],
    };

    if (resolved) {
      byOwner.Alice.push({
        week,
        wins: week,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 0,
      });
    }
  }

  return {
    weeks,
    byWeek,
    byOwner,
  };
}

test('returns in-season when future postseason weeks are scheduled but unresolved', () => {
  const standingsHistory = createHistory({
    weeks: [12, 13, 14, 16, 17],
    resolvedWeeks: [12, 13, 14],
    // 16 and 17 are SCHEDULED, not played. Said directly now rather than
    // implied through coverage.
    playedWeeks: [12, 13, 14],
  });

  assert.equal(selectSeasonContext({ standingsHistory }), 'in-season');
});

test('returns postseason when latest resolved week is postseason and season is not complete', () => {
  const standingsHistory = createHistory({
    weeks: [14, 15, 16, 17],
    resolvedWeeks: [14, 15, 16],
    playedWeeks: [14, 15, 16],
  });

  assert.equal(selectSeasonContext({ standingsHistory }), 'postseason');
});

test('returns final when all weeks are resolved', () => {
  const standingsHistory = createHistory({
    weeks: [14, 15, 16],
    resolvedWeeks: [14, 15, 16],
  });

  assert.equal(selectSeasonContext({ standingsHistory }), 'final');
});

test('returns in-season when nothing has been played yet', () => {
  // PLATFORM-105 — this used to say `resolvedWeeks: []` and mean "nothing has
  // happened". Those were the same thing only while progress and coverage
  // shared a value: a season whose weeks were all PLAYED but whose scores never
  // attached also had no resolved weeks, and read as in-season months later.
  // Progress is now said directly, and the coverage-gap case is asserted
  // separately below.
  const standingsHistory = createHistory({
    weeks: [1, 2, 3],
    resolvedWeeks: [],
    playedWeeks: [],
  });

  assert.equal(selectSeasonContext({ standingsHistory }), 'in-season');
});

test('PLATFORM-105: a season with weeks still to play is IN-SEASON, not final', () => {
  // The defect, stated as a test. Week 1 has been played; weeks 2-14 have not.
  // Before this slice every unplayed week counted as resolved — an unplayed week
  // has no missing scores, so its coverage read `complete` — and the season
  // reported itself `final` from the first Saturday. Reproduced against
  // production data on 2026-08-19: real 2026 schedule, real roster, only week 1
  // final, and the app served `lifecycleState: postseason` with a champion and a
  // last-place finisher named.
  const weeks = Array.from({ length: 14 }, (_, i) => i + 1);
  const standingsHistory = createHistory({
    weeks,
    resolvedWeeks: [1],
    playedWeeks: [1],
  });

  assert.equal(selectSeasonContext({ standingsHistory }), 'in-season');
});

test('PLATFORM-105: a finished season is FINAL even with a week missing scores', () => {
  // The other direction, and item 52's original complaint. Every week has been
  // played, but week 13's scores never attached. Season-over is a question about
  // football remaining, not about our data being whole, so this is `final` —
  // and the coverage gap stays reported through its own channel.
  const standingsHistory = createHistory({
    weeks: [11, 12, 13],
    resolvedWeeks: [11, 12],
    playedWeeks: [11, 12, 13],
  });

  assert.equal(selectSeasonContext({ standingsHistory }), 'final');
});

test('PLATFORM-105: a season with no pending games is over, whatever the weeks say', () => {
  // Season-over is a question about GAMES (owner ruling, 2026-08-20). An
  // all-bracket playoff week contributes no real games to wait on, so it can no
  // longer block a season that has actually finished — the failure that took
  // three attempts to stop reappearing.
  const standingsHistory = createHistory({
    weeks: [13, 14, 15],
    resolvedWeeks: [13, 14],
    playedWeeks: [13, 14],
  });
  // Week 15 is an unresolved bracket shell: not played, and nothing pending.
  standingsHistory.byWeek[15]!.pending = [];

  assert.equal(selectSeasonContext({ standingsHistory }), 'final');
});
