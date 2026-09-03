import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const DIRECT_CONSUMERS = [
  'CompactGameScoreboard.tsx',
  'MatchupsWeekPanel.tsx',
  'OwnerPanel.tsx',
] as const;

test('in-scope game surfaces consume the shared status label directly or through the scoreboard', () => {
  for (const file of DIRECT_CONSUMERS) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /gameStatusLabelPresentation\(/, `${file} must invoke the shared label`);
  }

  const gameUiSource = readFileSync(new URL('../../lib/gameUi.ts', import.meta.url), 'utf8');
  const ownerSource = readFileSync(new URL('../OwnerPanel.tsx', import.meta.url), 'utf8');
  const overviewSource = readFileSync(new URL('../OverviewPanel.tsx', import.meta.url), 'utf8');
  const matchupsSource = readFileSync(new URL('../MatchupsWeekPanel.tsx', import.meta.url), 'utf8');

  assert.match(
    overviewSource,
    /<CompactGameScoreboard\b/,
    'OverviewPanel.tsx must delegate its game states to the shared scoreboard'
  );
  assert.doesNotMatch(
    overviewSource,
    /gameStatusLabelPresentation\(/,
    'OverviewPanel.tsx must not rebuild the shared scoreboard status treatment'
  );
  assert.doesNotMatch(gameUiSource, /function statusClasses/);
  assert.doesNotMatch(ownerSource, /function toneClasses/);
  assert.doesNotMatch(overviewSource, /function stateBadgeClasses/);
  assert.doesNotMatch(matchupsSource, /function performanceClasses/);
});
