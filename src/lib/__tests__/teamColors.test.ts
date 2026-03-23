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

test('very dark team colors are lifted into a readable primary accent before falling back', () => {
  const result = getSafeScoreboardTeamColor({ color: '#3C0969', altColor: '#FFFFFF' });

  assert.equal(result.source, 'primary');
  assert.equal(result.baseColor, '#5B139A');
  assert.equal(result.rowAccentColor, 'rgba(91, 19, 154, 0.45)');
  assert.equal(result.winnerAccentColor, 'rgba(91, 19, 154, 0.92)');
});

test('bright yellow primaries are safely softened without losing team identity', () => {
  const result = getSafeScoreboardTeamColor({ color: '#FFF200', altColor: '#154734' });

  assert.equal(result.source, 'primary');
  assert.equal(result.baseColor, '#98921F');
  assert.equal(result.winnerScoreColor, '#98921F');
});

test('fallback accent is used when neither primary nor alt color is usable even after lifting', () => {
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
