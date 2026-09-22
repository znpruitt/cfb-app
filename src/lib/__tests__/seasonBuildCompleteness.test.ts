import assert from 'node:assert/strict';
import test from 'node:test';

import { assembleSeasonScoredBuild } from '../seasonBuild.ts';
import { SeasonScheduleIncompleteError } from '../server/durableScheduleRow.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';
import { setTeamDatabaseFile } from '../server/teamDatabaseStore.ts';

/**
 * PLATFORM-813 v3 acceptance 1 — a durable writer never records a season as complete
 * when rows were discarded.
 *
 * **THIS TEST FAILS AGAINST `ff79e1a6`**, and the reason is the whole slice. v2 gated on
 * `droppedRowCount`, which counts NON-OBJECT rows. The likelier corruption is an object
 * row whose participant name is non-string: the boundary coerces it to `''`,
 * `classifyScheduleRow` then discards it as `invalid_row`, and `assembleSeasonScoredBuild`
 * destructured only `{ games }` — so the gate never fired and the season-rollover cron
 * wrote a durable archive recording an incomplete season as complete. Both reviewers
 * found it independently. **On `main` that same row threw**, so v2 converted a loud
 * failure into silent durable loss.
 *
 * The fix reads `issues`, the channel `buildScheduleFromApi` already publishes with a
 * reason per discarded row (`schedule.ts:227/648/896`).
 */

const SLUG = 'alpha';
const YEAR = 2031;

function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g-ok',
    week: 1,
    startDate: `${YEAR}-09-01T18:00:00.000Z`,
    neutralSite: false,
    conferenceGame: true,
    homeTeam: 'Alpha U',
    awayTeam: 'Beta U',
    homeConference: 'SEC',
    awayConference: 'Big Ten',
    status: 'final',
    seasonType: 'regular',
    gamePhase: 'regular',
    ...overrides,
  };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: `${YEAR}-01-01T00:00:00.000Z`,
    items: [
      { school: 'Alpha U', conference: 'SEC' },
      { school: 'Beta U', conference: 'Big Ten' },
    ],
  });
});

test('a coerced participant name makes the build REFUSE rather than record', async () => {
  // `homeTeam: 7` — an OBJECT row, so `droppedRowCount` stays 0 and v2's gate was blind
  // to it. The boundary coerces the name to '', `looksEmptyRow` sees an empty participant,
  // and `classifyScheduleRow` discards the row with `invalid_row`.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items: [scheduleRow(), scheduleRow({ id: 'g-bad', homeTeam: 7 })],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  await assert.rejects(
    () => assembleSeasonScoredBuild(SLUG, YEAR),
    (error: Error) => {
      assert.equal(error.name, 'SeasonScheduleIncompleteError');
      assert.match(error.message, /schedule row\(s\) were discarded by the build/);
      // The REASON travels, which a count could not carry. This is why `issues` is the
      // right channel and the parallel count was the wrong one.
      assert.match(error.message, /invalid-schedule-row:/);
      assert.match(error.message, /refusing to record or cache this season as complete/);
      return true;
    }
  );
});

test('a null participant name refuses too — the required-field path reaches the same gate', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items: [scheduleRow(), scheduleRow({ id: 'g-bad', awayTeam: null })],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  await assert.rejects(
    () => assembleSeasonScoredBuild(SLUG, YEAR),
    (error: Error) => error instanceof SeasonScheduleIncompleteError
  );
});

test('a CLEAN season still builds — the discriminating control', async () => {
  // Without this, a gate that refused unconditionally would satisfy both tests above
  // while making every archive impossible. It is also what proves the refusal is about
  // discarded rows rather than about any schedule at all.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items: [scheduleRow(), scheduleRow({ id: 'g-2', week: 2 })],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  const build = await assembleSeasonScoredBuild(SLUG, YEAR);
  assert.equal(build.games.length, 2, 'both clean rows become games');
  assert.equal(build.scheduleItems.length, 2);
});

test('a row coerced only in a NON-participant field still builds', async () => {
  // The other boundary of the refusal: coercion alone is not loss. A numeric `label` is
  // repaired at the boundary and the row still classifies, so nothing is discarded and
  // the archive is honest. Gating on "any coercion" would have refused this.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items: [scheduleRow(), scheduleRow({ id: 'g-2', week: 2, label: 99, bowlName: 7 })],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  const build = await assembleSeasonScoredBuild(SLUG, YEAR);
  assert.equal(build.games.length, 2, 'a repaired non-participant field loses no game');
});
