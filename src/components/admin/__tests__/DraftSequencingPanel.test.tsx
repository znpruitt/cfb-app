import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

// MUST precede `@testing-library/react` — installs the JSDOM globals before
// `react-dom` is evaluated. See `src/test/domEnvironment.ts`.
import '../../../test/domEnvironment.ts';

import { render, cleanup } from '@testing-library/react';

import DraftSequencingPanel from '../DraftSequencingPanel';
import { TEST_LEAGUE_SLUG, type League } from '../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2J round 2 — the rollover guidance must not promise automation
// that will not run.
//
// The panel flags a league whose active year is behind the calendar, then told
// every such league "Rollover is automatic — see System Health". That is false
// in exactly the two cases the flag fires for. `groupRolloverTargets` selects
// NON-TEST leagues whose lifecycle status is `season` (AGENTS.md, "Season
// rollover is per-year and strict"), so:
//   - the demo league is excluded from automatic rollover outright, and
//   - a league already in offseason holding its outgoing year is not a target.
// Both stay behind forever while the panel points the operator at a job that
// will never touch them.
//
// F2J surfaced this panel on `/admin`, which is what made the claim reachable.
// ---------------------------------------------------------------------------

const CURRENT_YEAR = new Date().getUTCFullYear();
const BEHIND = CURRENT_YEAR - 1;

function league(slug: string, year: number, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

beforeEach(async () => {
  cleanup();
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

async function renderPanel(leagues: League[]) {
  await setAppState('leagues', 'registry', leagues);
  const element = await DraftSequencingPanel();
  return render(element).container;
}

function rowText(container: HTMLElement, slug: string): string {
  const row = [...container.querySelectorAll('li, div')].find((el) =>
    el.textContent?.includes(`/${slug}`)
  );
  assert.ok(row, `a row for ${slug} is rendered`);
  return row.textContent ?? '';
}

test('a production league in season is told rollover is automatic', async () => {
  const container = await renderPanel([league('alpha', BEHIND, { state: 'season', year: BEHIND })]);

  const text = rowText(container, 'alpha');
  assert.match(text, /Rollover is automatic/i, 'this league IS a rollover target');
});

// REGRESSION TEST — the demo league is excluded from automatic rollover, so it
// sits behind indefinitely. Telling the operator to wait for a job that skips it
// is guidance that never comes true.
test('the demo league is not told to wait for automation', async () => {
  const container = await renderPanel([
    league(TEST_LEAGUE_SLUG, BEHIND, { state: 'season', year: BEHIND }),
  ]);

  const text = rowText(container, TEST_LEAGUE_SLUG);
  assert.ok(
    !/Rollover is automatic/i.test(text),
    `the demo league must not be promised automatic rollover; got: ${text}`
  );
  assert.match(text, /excluded from automatic rollover/i, 'and it must say why');
});

// REGRESSION TEST — the job targets `season` only. A league that has already
// entered offseason while retaining its outgoing year still trips the
// behind-the-calendar check and still will not be advanced.
test('a league outside a season is not told to wait for automation', async () => {
  const container = await renderPanel([league('bravo', BEHIND, { state: 'offseason' })]);

  const text = rowText(container, 'bravo');
  assert.ok(
    !/Rollover is automatic/i.test(text),
    `a non-season league must not be promised automatic rollover; got: ${text}`
  );
  assert.match(text, /not in a season/i, 'and it must say why');
});

// POSITIVE CONTROL — a league whose year matches the calendar reports no
// rollover need at all, so the three assertions above are about the guidance and
// not about the panel failing to render a status line.
test('a current league reports no rollover need', async () => {
  const container = await renderPanel([
    league('current', CURRENT_YEAR, { state: 'season', year: CURRENT_YEAR }),
  ]);

  const text = rowText(container, 'current');
  assert.match(text, /matches calendar year/i);
  assert.ok(!/Rollover is automatic/i.test(text), 'nothing to roll over');
});
