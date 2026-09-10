import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScoreboardTeamColorsById, getSafeScoreboardTeamColor } from '../teamColors.ts';

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function rgbFromHex(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function luminance(hex: string): number {
  const rgb = rgbFromHex(hex);
  return (
    0.2126 * channelToLinear(rgb.r) +
    0.7152 * channelToLinear(rgb.g) +
    0.0722 * channelToLinear(rgb.b)
  );
}

function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = luminance(hexA);
  const luminanceB = luminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);

  return (lighter + 0.05) / (darker + 0.05);
}

function oklch(hex: string): { c: number; h: number } {
  const rgb = rgbFromHex(hex);
  const linearR = channelToLinear(rgb.r);
  const linearG = channelToLinear(rgb.g);
  const linearB = channelToLinear(rgb.b);
  const lRoot = Math.cbrt(0.4122214708 * linearR + 0.5363325363 * linearG + 0.0514459929 * linearB);
  const mRoot = Math.cbrt(0.2119034982 * linearR + 0.6806995451 * linearG + 0.1073969566 * linearB);
  const sRoot = Math.cbrt(0.0883024619 * linearR + 0.2817188376 * linearG + 0.6299787005 * linearB);
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const b = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;

  return {
    c: Math.hypot(a, b),
    h: (Math.atan2(b, a) * 180) / Math.PI + (b < 0 ? 360 : 0),
  };
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

test('safe primary color is used when available', () => {
  const result = getSafeScoreboardTeamColor({ color: '#BF5700', altColor: '#FFFFFF' });

  assert.equal(result.source, 'primary');
  assert.match(result.baseColor, /^#[0-9A-F]{6}$/);
  assert.match(result.rowAccentColor, /^rgba\(/);
  assert.match(result.winnerAccentColor, /^rgba\(/);
  assert.match(result.winnerScoreColor, /^#[0-9A-F]{6}$/);
});

test('dark team colours clear the 2.5 floor against the lightest scoreboard underlay', () => {
  const result = getSafeScoreboardTeamColor({ color: '#3C0969', altColor: '#FFFFFF' });

  assert.equal(result.source, 'primary');
  assert.notEqual(result.baseColor, '#139A70');
  assert.ok(contrastRatio(result.winnerScoreColor, '#333336') >= 2.5);
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

test('bright team colours stay below the 5.5 ceiling against the darkest scoreboard underlay', () => {
  const result = getSafeScoreboardTeamColor({ color: '#FFF200', altColor: '#154734' });

  assert.equal(result.source, 'primary');
  assert.notEqual(result.baseColor, '#139A70');
  assert.ok(contrastRatio(result.winnerScoreColor, '#09090B') <= 5.5);
});

test('fixed OKLCH remap keeps the four Overview reds distinct instead of clamping them to one floor', () => {
  const colors = [
    ['Louisville', '#C9001F'],
    ['Ohio State', '#BA0C2F'],
    ['Indiana', '#990000'],
    ['Oklahoma', '#841617'],
  ].map(([team, color]) => ({
    team,
    output: getSafeScoreboardTeamColor({ color, altColor: null }).baseColor,
  }));
  const ratios = colors.map(({ output }) => contrastRatio(output, '#333336'));

  assert.equal(new Set(colors.map(({ output }) => output)).size, 4);
  assert.deepEqual(
    colors.map(({ output }) => output),
    ['#CD504C', '#CC4E54', '#C94D3F', '#C0514A']
  );
  assert.ok(ratios[0] > ratios[1]);
  assert.ok(ratios[1] > ratios[2]);
  assert.ok(ratios[2] > ratios[3]);
});

test('near-neutral provider colour stays near-neutral after band normalisation', () => {
  const input = oklch('#8A8D8F');
  const result = getSafeScoreboardTeamColor({ color: '#8A8D8F', altColor: null });
  const output = oklch(result.baseColor);

  assert.equal(result.source, 'primary');
  assert.ok(output.c <= input.c + 0.001, `expected chroma <= ${input.c}, received ${output.c}`);
  assert.ok(output.c < 0.01, `expected a near-neutral output, received chroma ${output.c}`);
});

test('band normalisation preserves the hue of an unambiguous chromatic input', () => {
  const input = oklch('#154733');
  const result = getSafeScoreboardTeamColor({ color: '#154733', altColor: null });
  const output = oklch(result.baseColor);

  assert.equal(result.source, 'primary');
  assert.ok(hueDistance(input.h, output.h) <= 1, `expected hue ${input.h}, received ${output.h}`);
});

test('reserved amber is desaturated without shifting its hue', () => {
  const input = oklch('#BA7517');
  const result = getSafeScoreboardTeamColor({ color: '#BA7517', altColor: null });
  const output = oklch(result.baseColor);

  assert.ok(output.c <= 0.081, `expected reserved amber chroma <= 0.081, received ${output.c}`);
  assert.ok(hueDistance(input.h, output.h) <= 1, `expected hue ${input.h}, received ${output.h}`);
});

test('fallback accent is used when neither primary nor alt colour is usable', () => {
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
  assert.match(colorsById.get('oregon') ?? '', /^#[0-9A-F]{6}$/);
  assert.equal(
    colorsById.has('oregon-ducks'),
    false,
    'the memo uses the same normalized school key as scoreboard consumers'
  );
  assert.equal(colorsById.has('portlandstate'), false, 'fallback treatments are not memoized');
  assert.equal(primaryReads, 2, 'each catalog team primary is read once');
  assert.equal(altReads, 1, 'alt is read only when the primary cannot resolve');

  for (let lookup = 0; lookup < 20; lookup += 1) {
    colorsById.get('oregon');
    colorsById.get('portlandstate');
  }
  assert.equal(primaryReads, 2, 'row lookups must not repeat primary normalization');
  assert.equal(altReads, 1, 'row lookups must not repeat alternate normalization');
});

test('alternate-outline prototype keeps the provider alternate as a 1px-edge input', () => {
  const colorsById = buildScoreboardTeamColorsById(
    [{ school: 'App State', color: '#000000', altColor: '#FFCD00' }],
    'alternate-outline'
  );

  assert.deepEqual(colorsById.get('appstate'), {
    fillColor: '#4E4E4E',
    outlineColor: '#FFCD00',
  });
});

test('alternate-outline prototype preserves the settled no-accent fallback population', () => {
  const colorsById = buildScoreboardTeamColorsById(
    [{ school: 'Penn State', color: '#001E44', altColor: '#FFFFFF' }],
    'alternate-outline'
  );

  assert.equal(colorsById.has('pennstate'), false);
});
