import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScoreboardTeamColorsById, getSafeScoreboardTeamColor } from '../teamColors.ts';

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
    `rgba(${parseInt(result.baseColor.slice(1, 3), 16)}, ${parseInt(result.baseColor.slice(3, 5), 16)}, ${parseInt(result.baseColor.slice(5, 7), 16)}, 0.52)`
  );
  assert.equal(
    result.winnerAccentColor,
    `rgba(${parseInt(result.baseColor.slice(1, 3), 16)}, ${parseInt(result.baseColor.slice(3, 5), 16)}, ${parseInt(result.baseColor.slice(5, 7), 16)}, 0.92)`
  );
  assert.equal(
    result.borderAccent,
    `rgba(${parseInt(result.baseColor.slice(1, 3), 16)}, ${parseInt(result.baseColor.slice(3, 5), 16)}, ${parseInt(result.baseColor.slice(5, 7), 16)}, 0.38)`
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

test('catalog memo input normalizes each team once and makes repeated row lookups color-math-free', () => {
  let primaryReads = 0;
  let altReads = 0;
  const coloredTeam = {
    id: 'oregon-ducks',
    school: 'Oregon',
    get color(): string {
      primaryReads += 1;
      return '#154733';
    },
    get altColor(): string {
      altReads += 1;
      return '#FEE123';
    },
  };
  const missingTeam = {
    school: 'Portland State',
    get color(): null {
      primaryReads += 1;
      return null;
    },
    get altColor(): null {
      altReads += 1;
      return null;
    },
  };

  const colorsById = buildScoreboardTeamColorsById([coloredTeam, missingTeam]);
  assert.match(colorsById.get('oregon-ducks') ?? '', /^#[0-9A-F]{6}$/);
  assert.equal(colorsById.has('oregon'), false, 'an explicit catalog id remains canonical');
  assert.equal(colorsById.has('portlandstate'), false, 'fallback treatments are not memoized');
  assert.equal(primaryReads, 2, 'each catalog team primary is read once');
  assert.equal(altReads, 1, 'alt is read only when the primary cannot resolve');

  for (let lookup = 0; lookup < 20; lookup += 1) {
    colorsById.get('oregon-ducks');
    colorsById.get('portlandstate');
  }
  assert.equal(primaryReads, 2, 'row lookups must not repeat primary normalization');
  assert.equal(altReads, 1, 'row lookups must not repeat alternate normalization');
});
