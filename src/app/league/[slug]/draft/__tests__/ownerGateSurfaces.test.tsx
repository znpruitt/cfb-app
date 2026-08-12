import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

import { addLeague } from '@/lib/leagueRegistry';
import { savePreseasonOwners } from '@/lib/preseasonOwnerStore';
import {
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';

import { resolveDraftSetupGate } from '../setup/draftSetupGate';
import PreseasonPage from '../../../../admin/[slug]/preseason/page';

// ---------------------------------------------------------------------------
// PLATFORM-092 — AGENTS.md: "Every surface a PR touches must carry its own
// tests... if deleting the new guard leaves the suite green, the guard is not in
// the PR's acceptance contract."
//
// HONEST LIMIT: the draft-setup RSC is NOT rendered here. It is gated by
// `canAccessDraftBoard` → `isPlatformAdminSession`, which has no authorizing
// path without a Request, so rendering it under this runner only ever produces
// `NEXT_REDIRECT`. Its decision lives in `setup/draftSetupGate.ts` and is pinned
// below; the JSX consuming it is not covered, and this note exists so that is
// not mistaken for coverage.
// ---------------------------------------------------------------------------

const SLUG = 'gate-surface-league';
const YEAR = 2026;

async function seedLeague(): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Gate Surface League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: YEAR },
    assignmentMethod: 'draft',
  });
}

async function renderChecklist(): Promise<string> {
  const page = (await PreseasonPage({ params: Promise.resolve({ slug: SLUG }) })) as ReactElement;
  return renderToStaticMarkup(page);
}

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// --- The admin checklist -----------------------------------------------------

test('the checklist reports owners unconfirmed until a real roster exists', async () => {
  await seedLeague();
  assert.match(await renderChecklist(), /○[\s\S]{0,400}Owners confirmed/);

  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  assert.match(await renderChecklist(), /✓[\s\S]{0,400}Owners confirmed/);
});

test('the checklist does not accept a CSV that parses to fewer than two owners', async () => {
  // It previously counted newlines, so a header plus two rows read as a roster
  // regardless of what those rows contained.
  await seedLeague();
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nAir Force,NoClaim');

  assert.match(await renderChecklist(), /○[\s\S]{0,400}Owners confirmed/);
});

test("the checklist does not accept a PRIOR season's roster", async () => {
  await seedLeague();
  await savePreseasonOwners(SLUG, YEAR - 1, ['Alice', 'Bob']);

  assert.match(await renderChecklist(), /○[\s\S]{0,400}Owners confirmed/);
});

// --- The draft-setup page's blocked state ------------------------------------

const GATE = { draftPhase: null, isPreseason: true, slug: SLUG, year: YEAR } as const;

test('an unconfirmed season with no draft is blocked, and pointed at confirmation', () => {
  const gate = resolveDraftSetupGate({ ...GATE, isConfirmed: false });
  assert.equal(gate?.href, `/admin/${SLUG}/preseason/owners`);
  assert.equal(gate?.cta, 'Confirm 2026 owners');
});

test('a non-preseason league is sent somewhere that does not redirect away', () => {
  // `/admin/[slug]/preseason/owners` bounces to the admin home unless the league
  // is in preseason, and this page is not lifecycle-gated — every league created
  // through the admin API is born `season`. Linking there unconditionally would
  // leave the only remedy silently dead.
  const gate = resolveDraftSetupGate({ ...GATE, isConfirmed: false, isPreseason: false });
  assert.equal(gate?.href, `/admin/${SLUG}/roster`);
  assert.equal(gate?.cta, 'Upload the 2026 roster');
});

test('a confirmed roster is never blocked, whatever the draft is doing', () => {
  for (const draftPhase of [
    null,
    'setup',
    'settings',
    'preview',
    'live',
    'paused',
    'complete',
  ] as const) {
    assert.equal(
      resolveDraftSetupGate({ ...GATE, draftPhase, isConfirmed: true }),
      null,
      String(draftPhase)
    );
  }
});

test('a draft that has not started is blocked — nothing is lost by doing so', () => {
  for (const draftPhase of ['setup', 'settings', 'preview'] as const) {
    assert.equal(
      resolveDraftSetupGate({ ...GATE, draftPhase, isConfirmed: false })?.cta,
      'Confirm 2026 owners',
      draftPhase
    );
  }
});

test('a RUNNING or finished draft is never blocked, even with no confirmed roster', () => {
  // This page carries the only Reset Draft button and pick-timer control in the
  // app — `DraftControls` has no importers, and the board links here from four
  // places. Blocking it strands a draft that is already running.
  //
  // The state is reachable on the demo league, whose year-clearing control
  // deletes both owner records while a draft may still exist — precisely when
  // Reset is the button you need.
  //
  // The earlier version of this test asserted the same thing as the first test
  // above, because the function took no draft input at all. It read like
  // coverage of exactly this case and could not have failed for it.
  for (const draftPhase of ['live', 'paused', 'complete'] as const) {
    assert.equal(
      resolveDraftSetupGate({ ...GATE, draftPhase, isConfirmed: false }),
      null,
      draftPhase
    );
  }
});
