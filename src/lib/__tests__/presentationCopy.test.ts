import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveActiveSurfaceCopy, deriveOddsSummaryCopy } from '../presentationCopy';

test('active surface copy returns null subtitles for standard surfaces', () => {
  assert.equal(deriveActiveSurfaceCopy('overview').subtitle, null);
  assert.equal(deriveActiveSurfaceCopy('schedule').subtitle, null);
  assert.equal(deriveActiveSurfaceCopy('matchups').subtitle, null);
});

test('odds summary copy returns null for non-actionable no-odds states', () => {
  assert.equal(deriveOddsSummaryCopy({ gamesCount: 0, oddsAvailableCount: 0 }), null);
  assert.equal(deriveOddsSummaryCopy({ gamesCount: 3, oddsAvailableCount: 0 }), null);
  assert.equal(deriveOddsSummaryCopy({ gamesCount: 3, oddsAvailableCount: 3 }), null);
});

test('odds summary copy emits only actionable partial-coverage text', () => {
  assert.equal(
    deriveOddsSummaryCopy({ gamesCount: 3, oddsAvailableCount: 2 }),
    'Odds available for 2/3 games.'
  );
});
