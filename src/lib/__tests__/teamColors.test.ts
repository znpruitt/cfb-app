import assert from 'node:assert/strict';
import test from 'node:test';

import { getSafeScoreboardTeamColor, getSafeScoreboardTeamColorById } from '../teamColors.ts';

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastAgainstDarkSurface(hex: string): number {
  const normalized = hex.replace('#', '');
  const rgb = {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
  const luminance =
    0.2126 * channelToLinear(rgb.r) +
    0.7152 * channelToLinear(rgb.g) +
    0.0722 * channelToLinear(rgb.b);
  const darkSurfaceLuminance =
    0.2126 * channelToLinear(10) + 0.7152 * channelToLinear(10) + 0.0722 * channelToLinear(10);
  const lighter = Math.max(luminance, darkSurfaceLuminance);
  const darker = Math.min(luminance, darkSurfaceLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

test('safe primary color is used when available', () => {
  const result = getSafeScoreboardTeamColor({ color: '#BF5700', altColor: '#FFFFFF' });

  assert.equal(result.source, 'primary');
  assert.match(result.baseColor, /^#[0-9A-F]{6}$/);
  assert.match(result.rowAccentColor, /^rgba\(/);
  assert.match(result.winnerAccentColor, /^rgba\(/);
  assert.match(result.winnerScoreColor, /^#[0-9A-F]{6}$/);
});

test('very dark team colors are lifted into a readable dark-theme-safe primary accent before falling back', () => {
  const result = getSafeScoreboardTeamColor({ color: '#3C0969', altColor: '#FFFFFF' });

  assert.equal(result.source, 'primary');
  assert.notEqual(result.baseColor, '#139A70');
  assert.ok(contrastAgainstDarkSurface(result.winnerScoreColor) >= 3);
  assert.equal(
    result.rowAccentColor,
    `rgba(${parseInt(result.baseColor.slice(1, 3), 16)}, ${parseInt(result.baseColor.slice(3, 5), 16)}, ${parseInt(result.baseColor.slice(5, 7), 16)}, 0.45)`
  );
  assert.equal(
    result.winnerAccentColor,
    `rgba(${parseInt(result.baseColor.slice(1, 3), 16)}, ${parseInt(result.baseColor.slice(3, 5), 16)}, ${parseInt(result.baseColor.slice(5, 7), 16)}, 0.92)`
  );
});

test('bright yellow primaries are safely softened without losing team identity', () => {
  const result = getSafeScoreboardTeamColor({ color: '#FFF200', altColor: '#154734' });

  assert.equal(result.source, 'primary');
  assert.notEqual(result.baseColor, '#139A70');
  assert.ok(contrastAgainstDarkSurface(result.winnerScoreColor) >= 3);
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
