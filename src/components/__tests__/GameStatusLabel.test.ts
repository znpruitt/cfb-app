import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const CONSUMERS = [
  'CompactGameScoreboard.tsx',
  'MatchupsWeekPanel.tsx',
  'OwnerPanel.tsx',
  'OverviewPanel.tsx',
] as const;

test('in-scope game surfaces consume the shared status label with bespoke class helpers deleted', () => {
  for (const file of CONSUMERS) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /gameStatusLabelPresentation/, `${file} must consume the shared label`);
  }

  const gameUiSource = readFileSync(new URL('../../lib/gameUi.ts', import.meta.url), 'utf8');
  const ownerSource = readFileSync(new URL('../OwnerPanel.tsx', import.meta.url), 'utf8');
  const overviewSource = readFileSync(new URL('../OverviewPanel.tsx', import.meta.url), 'utf8');
  const matchupsSource = readFileSync(new URL('../MatchupsWeekPanel.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(gameUiSource, /function statusClasses/);
  assert.doesNotMatch(ownerSource, /function toneClasses/);
  assert.doesNotMatch(overviewSource, /function stateBadgeClasses/);
  assert.doesNotMatch(matchupsSource, /function performanceClasses/);
});
