import assert from 'node:assert/strict';
import test from 'node:test';

import AdminSeasonPage from '../page';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2C — Season Management owns lifecycle rollover: the per-year
// rollover status/maintenance panel (SeasonRolloverPanel) renders HERE after
// its removal from Data Maintenance & Recovery, alongside the eligible-year
// execution panel (RolloverPanel). Without this, ineligible/unavailable
// rollover status would render nowhere.
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

test('Season Management renders BOTH rollover surfaces (execution + per-year status)', async () => {
  await setAppState('leagues', 'registry', []);
  const element = await AdminSeasonPage();
  const components = collectComponents(element);

  assert.ok(components.includes('RolloverPanel'), 'eligible-year execution panel');
  assert.ok(
    components.includes('SeasonRolloverPanel'),
    'per-year status/maintenance panel relocated from Data Maintenance & Recovery'
  );
});
