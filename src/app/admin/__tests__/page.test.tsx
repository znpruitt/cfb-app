import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import AdminHubPage from '../page';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H4 — `/admin/season` is retired.
//
// Rollover is executed solely by the daily cron, with no operator-reachable
// controls since F2H3A and no automation-pause gate at all — so a destination
// there represented machinery rather than a decision. Its observable state is
// the `season-rollover` row on System Health, and archived seasons are navigable
// per league from `/league/<slug>/history`.
// ---------------------------------------------------------------------------

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props) {
      collectStrings(props.children, out);
      for (const [key, value] of Object.entries(props)) {
        if (key !== 'children' && typeof value === 'string') out.push(value);
      }
    }
  }
  return out;
}

test('the admin hub offers no Season Management destination', async () => {
  await setAppState('leagues', 'registry', []);
  const strings = collectStrings(await AdminHubPage());

  assert.ok(!strings.includes('/admin/season'), 'no link to the retired route');
  assert.ok(!strings.includes('Season Management'), 'and no card naming it');

  // POSITIVE CONTROL — the surviving destinations still render, so the absences
  // above are a real observation rather than a collector that sees nothing.
  for (const href of [
    '/admin/diagnostics',
    '/admin/leagues',
    '/admin/data/cache',
    '/admin/aliases',
    // PLATFORM-086F2J — `/admin/draft` existed with NO inbound link from
    // anywhere and was reachable only by typing the URL. It is cross-league and
    // read-only, so it is surfaced here rather than retired.
    '/admin/draft',
  ]) {
    assert.ok(strings.includes(href), `${href} still offered`);
  }
  assert.ok(strings.includes('Draft Sequencing'), 'and it is named');
});

// A behavioural test can only observe the pages it renders. This is the one
// thing it cannot reach: a link left behind on some OTHER surface would 404 for
// an operator and no rendering assertion would see it. Scoped to repository
// source, excluding tests and this file's own literals.
test('no surviving source links to the retired route', () => {
  const root = join(process.cwd(), 'src');
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__') walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      // Matches a LINK, not prose. The route is still named in comments that
      // explain why it was retired, and forbidding that would push the
      // reasoning out of the code rather than keeping the route gone.
      const text = readFileSync(full, 'utf8');
      if (text.includes(`'/admin/season'`) || text.includes(`"/admin/season"`)) {
        offenders.push(full);
      }
    }
  };
  walk(root);

  assert.deepEqual(
    offenders,
    [],
    `these still reference the retired route: ${offenders.join(', ')}`
  );
});
