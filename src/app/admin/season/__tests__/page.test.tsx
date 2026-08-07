import assert from 'node:assert/strict';
import test from 'node:test';

import AdminSeasonPage from '../page';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H3A — Season Management ends with exactly ONE rollover panel.
// F2C moved the per-year status panel here; the eligible-year execution panel
// (`RolloverPanel`) was deleted alongside manual rollover execution, after its
// unique preview detail was ported into the survivor.
//
// The assertion counts occurrences rather than testing presence: "one panel" is
// the requirement, and a presence check would still pass if a second rollover
// surface were mounted beside it — which is the exact state this slice exists
// to end.
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

test('Season Management renders exactly one rollover panel', async () => {
  await setAppState('leagues', 'registry', []);
  const element = await AdminSeasonPage();
  const components = collectComponents(element);

  const rolloverPanels = components.filter((name) => name.includes('RolloverPanel'));
  assert.deepEqual(
    rolloverPanels,
    ['SeasonRolloverPanel'],
    'one rollover surface, and it is the consolidated one'
  );
  // POSITIVE CONTROL — the collector can see sibling panels on this page, so
  // the single-match result above is a real count and not a blind matcher.
  assert.ok(components.includes('ArchiveListPanel'), 'the collector observes other panels');
});
