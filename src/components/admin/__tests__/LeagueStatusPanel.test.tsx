import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

// MUST precede `@testing-library/react` — installs the JSDOM globals before
// `react-dom` is evaluated. See `src/test/domEnvironment.ts`.
import '../../../test/domEnvironment.ts';

import { render, cleanup } from '@testing-library/react';

import LeagueStatusPanel from '../LeagueStatusPanel';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-833 — the panel derived health from RECORD presence, not row content.
//
// `hasSchedule = Boolean(scheduleRecord)` and `hasScores = Boolean(scoresRecord)`
// meant a durable record holding `items: []` rendered a GREEN dot and a freshness
// age for a season with no games. `hasRoster`, nine lines above, already derived
// from content — so the correct shape was in the same function as the defect.
//
// A third instance was in the READ itself: the fallback from `-all-all` to
// `-all-regular` used `r ?? …`, which is record absence, so an empty aggregate
// record blocked the fallback and the panel reported on the wrong key entirely.
//
// Unreachable in production today (nothing writes a zero-row schedule aggregate),
// so these fixtures are the only evidence.
// ---------------------------------------------------------------------------

const SLUG = 'alpha';
const YEAR = 2031;

function scheduleRow(id: string) {
  return { id, week: 1, homeTeam: 'Texas', awayTeam: 'Rice' };
}

beforeEach(async () => {
  cleanup();
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

async function renderPanel(): Promise<HTMLElement> {
  const element = await LeagueStatusPanel({ slug: SLUG, year: YEAR });
  assert.ok(element, 'the panel renders');
  return render(element!).container;
}

/** The Schedule row's text, so a test can assert what the operator actually sees. */
function rowText(container: HTMLElement, label: string): string {
  const row = [...container.querySelectorAll('div')].find((el) => {
    const span = el.querySelector('span.w-20');
    return span?.textContent?.trim() === label;
  });
  assert.ok(row, `a ${label} row is rendered`);
  return row.textContent ?? '';
}

test('a ZERO-ROW schedule record is not presented as healthy', async () => {
  // The record EXISTS and is fresh. Only its content says there is no schedule.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items: [],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  const container = await renderPanel();
  const text = rowText(container, 'Schedule');

  assert.match(text, /not cached/i, 'a zero-row record must read as not cached');
  assert.equal(
    /(just now|\d+[mhd] ago)/.test(text),
    false,
    'a zero-row record must not be given a freshness age — that is the green-dot claim'
  );
});

test('a ZERO-ROW scores record is not presented as healthy either', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items: [scheduleRow('1')],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  await setAppState('scores', `${YEAR}-all-regular`, {
    at: Date.now(),
    items: [],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  const container = await renderPanel();
  // Schedule is genuinely populated — the positive control that proves this test
  // can tell the two rows apart rather than just finding "not cached" anywhere.
  assert.match(rowText(container, 'Schedule'), /(just now|\d+[mhd] ago)/);
  assert.match(rowText(container, 'Scores'), /not cached/i);
});

test('an EMPTY aggregate record does not block the fallback to a populated partition', async () => {
  // The read-level instance. `-all-all` exists but is empty; `-all-regular` has the
  // season. Before the fix `r ?? …` kept the empty record and the panel reported on
  // the wrong key.
  //
  // THE TWO DEFECTS COMPENSATED, WHICH IS WHY NEITHER WAS VISIBLE. Against the
  // fully-unfixed panel this test PASSES: the read kept the empty aggregate, and the
  // presence-based flag then called that empty record healthy, so the row looked
  // right by accident. It fails only once the FLAG is content-based and the read is
  // not — verified by reverting the read alone, where it fires on "the populated
  // partition must be found through the fallback". Recorded because a test that
  // cannot fail against the original code is usually vacuous, and this one is
  // instead evidence that two bugs were cancelling.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items: [],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  await setAppState('schedule', `${YEAR}-all-regular`, {
    at: Date.now(),
    items: [scheduleRow('7')],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  const container = await renderPanel();
  const text = rowText(container, 'Schedule');
  assert.match(
    text,
    /(just now|\d+[mhd] ago)/,
    'the populated partition must be found through the fallback'
  );
  assert.equal(/not cached/i.test(text), false);
});

test('a populated schedule and scores record still read as healthy', async () => {
  // The positive control for the whole file: a guard that reported "not cached"
  // unconditionally would satisfy every assertion above.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items: [scheduleRow('1')],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  await setAppState('scores', `${YEAR}-all-regular`, {
    at: Date.now(),
    items: [{ id: '1', homepoints: 21, awaypoints: 17 }],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  const container = await renderPanel();
  assert.match(rowText(container, 'Schedule'), /(just now|\d+[mhd] ago)/);
  assert.match(rowText(container, 'Scores'), /(just now|\d+[mhd] ago)/);
});

test('a genuinely absent schedule record still reads as not cached', async () => {
  const container = await renderPanel();
  assert.match(rowText(container, 'Schedule'), /not cached/i);
});
