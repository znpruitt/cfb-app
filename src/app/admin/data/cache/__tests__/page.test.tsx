import assert from 'node:assert/strict';
import test from 'node:test';

import AdminDataCachePage from '../page';
import AdminPage from '../../../page';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2C — the stable /admin/data/cache route presents as Data
// Maintenance & Recovery: renamed heading/breadcrumb/landing card, three
// section groups in order, and NO rollover surface (Season Management owns it).
// ---------------------------------------------------------------------------

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

/** Collect every string and every component function name in a JSX tree. */
function walk(node: unknown, out: { strings: string[]; components: string[] }): void {
  if (typeof node === 'string') {
    out.strings.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return;
  }
  if (node && typeof node === 'object') {
    const el = node as { type?: unknown; props?: Record<string, unknown> };
    if (typeof el.type === 'function' && el.type.name) out.components.push(el.type.name);
    if (el.props) {
      walk(el.props.children, out);
      for (const [key, value] of Object.entries(el.props)) {
        if (key !== 'children' && typeof value === 'string') out.strings.push(value);
      }
    }
  }
}

test('page renders as Data Maintenance & Recovery with three ordered sections, no rollover', async () => {
  await setAppState('leagues', 'registry', []);
  const element = await AdminDataCachePage();
  const out = { strings: [] as string[], components: [] as string[] };
  walk(element, out);

  const text = out.strings.join(' | ');
  assert.match(text, /Data Maintenance & Recovery/);
  assert.match(text, /Provider maintenance & recovery/);
  assert.match(text, /Season inputs/);
  assert.match(text, /Historical recovery/);
  assert.match(text, /Season Management/, 'lifecycle link copy present');
  assert.match(text, /nominal per successful attempt/, 'shared cost caveat stated');

  // Sections appear in the intended order (Reference data added by F2D1,
  // Diagnostic recovery by F2D2).
  const provider = text.indexOf('Provider maintenance & recovery');
  const diagnostic = text.indexOf('Diagnostic recovery');
  const inputs = text.indexOf('Season inputs');
  const reference = text.indexOf('Reference data');
  const historical = text.indexOf('Historical recovery');
  assert.ok(
    provider < diagnostic && diagnostic < inputs && inputs < reference && reference < historical,
    'section order'
  );

  // Rollover is absent — Season Management owns it.
  assert.ok(!out.components.includes('SeasonRolloverPanel'), 'SeasonRolloverPanel not rendered');
  assert.ok(!text.includes('Season Rollover'), 'no rollover copy');

  // All maintenance panels are composed (F2D1 added the relocated Odds/
  // Rankings surface and the Reference Data section).
  for (const name of [
    'GlobalRefreshPanel',
    'GameStatsCachePanel',
    'ProviderMaintenancePanel',
    'ScoreAttachmentRecoveryPanel',
    'SpRatingsCachePanel',
    'WinTotalsUploadPanel',
    'ReferenceDataPanel',
    'HistoricalCachePanel',
  ]) {
    assert.ok(out.components.includes(name), `${name} rendered`);
  }
});

test('the /admin landing card uses the new name while the href stays /admin/data/cache', async () => {
  await setAppState('leagues', 'registry', []);
  const element = await AdminPage();
  const out = { strings: [] as string[], components: [] as string[] };
  walk(element, out);

  const text = out.strings.join(' | ');
  assert.match(text, /Data Maintenance & Recovery/);
  assert.ok(out.strings.includes('/admin/data/cache'), 'href unchanged');
  assert.ok(!out.strings.includes('Data Cache'), 'old card title retired');

  // F2D2 — the card no longer names the relocated score tool.
  assert.ok(!/score attachment/i.test(text), 'stale score-attachment wording removed');
  // F2G — the observability card is renamed System Health (route unchanged) and
  // its description now names the scheduler-delivery + provider-data axes.
  assert.match(text, /System Health/);
  assert.ok(out.strings.includes('/admin/diagnostics'), 'System Health href unchanged');
  assert.match(text, /Scheduler delivery, provider data health, automation controls, quota, and storage/);
});
