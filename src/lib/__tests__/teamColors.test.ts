import assert from 'node:assert/strict';
import test from 'node:test';

import { getSafeScoreboardTeamColor, getSafeScoreboardTeamColorById } from '../teamColors.ts';

test('safe primary color is used when available', () => {
  const result = getSafeScoreboardTeamColor({ color: '#BF5700', altColor: '#FFFFFF' });

  assert.equal(result.source, 'primary');
  assert.match(result.baseColor, /^#[0-9A-F]{6}$/);
  assert.match(result.rowAccentColor, /^rgba\(/);
  assert.match(result.winnerAccentColor, /^rgba\(/);
  assert.match(result.winnerScoreColor, /^#[0-9A-F]{6}$/);
});

test('alt color is used when primary is unsafe for scoreboard treatment', () => {
  const result = getSafeScoreboardTeamColor({ color: '#FFF200', altColor: '#154734' });

  assert.equal(result.source, 'alt');
  assert.match(result.winnerScoreColor, /^#[0-9A-F]{6}$/);
});

test('fallback accent is used when neither primary nor alt color is usable', () => {
  const result = getSafeScoreboardTeamColor({ color: '#FFFFFF', altColor: '#000000' });

  assert.equal(result.source, 'fallback');
  assert.match(result.winnerScoreColor, /^#[0-9A-F]{6}$/);
});

test('canonical team-id lookup uses the local team database before falling back', () => {
  const result = getSafeScoreboardTeamColorById(
    'texas',
    new Map([
      ['texas', { id: 'texas', school: 'Texas', color: '#BF5700', altColor: '#FFFFFF', alts: [] }],
    ])
  );

  assert.equal(result.source, 'primary');
});
