import assert from 'node:assert/strict';
import test from 'node:test';

import AdminDiagnosticsPage from '../page';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2D1 — Diagnostics (System Health) composition after the
// operational-mutation relocation: the team-database sync no longer renders
// here (it lives on Data Maintenance & Recovery → Reference data); the
// remaining composition is provider status/gates, API usage, storage, and —
// until F2D2 — the score tool.
// ---------------------------------------------------------------------------

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

function collectComponents(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectComponents(child, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const el = node as { type?: unknown; props?: { children?: unknown } };
    if (typeof el.type === 'function' && el.type.name) out.push(el.type.name);
    if (el.props) collectComponents(el.props.children, out);
  }
  return out;
}

test('Diagnostics no longer composes the team-database mutation panel', async () => {
  await setAppState('leagues', 'registry', []);
  const element = await AdminDiagnosticsPage();
  const components = collectComponents(element);

  assert.ok(!components.includes('AdminTeamDatabasePanel'), 'team-database sync relocated');
  for (const name of [
    'ProviderDataStatusPanel',
    'AdminUsagePanel',
    'AdminStorageStatusPanel',
    'DiagnosticsScorePanel',
  ]) {
    assert.ok(components.includes(name), `${name} still composed`);
  }
});
