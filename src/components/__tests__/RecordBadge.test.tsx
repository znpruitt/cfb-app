import assert from 'node:assert/strict';
import test from 'node:test';

import { STROKE_COLORS } from '../history/RecordBadge.tsx';

test('RecordBadge: career stroke color is teal #0F6E56', () => {
  assert.equal(STROKE_COLORS.career, '#0F6E56');
});

test('RecordBadge: season stroke color is purple #534AB7', () => {
  assert.equal(STROKE_COLORS.season, '#534AB7');
});

test('RecordBadge: rivalry stroke color is coral #993C1D', () => {
  assert.equal(STROKE_COLORS.rivalry, '#993C1D');
});

test('RecordBadge: event stroke color is blue #185FA5', () => {
  assert.equal(STROKE_COLORS.event, '#185FA5');
});

test('RecordBadge: all four categories are defined', () => {
  const categories = ['career', 'season', 'rivalry', 'event'] as const;
  for (const cat of categories) {
    assert.ok(STROKE_COLORS[cat], `stroke color for ${cat} should be defined`);
    assert.match(STROKE_COLORS[cat], /^#[0-9A-Fa-f]{6}$/, `${cat} color should be a valid hex`);
  }
});
