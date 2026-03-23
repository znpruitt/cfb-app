import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveDisplayEventName } from '../gameEventName.ts';

test('deriveDisplayEventName prefers canonical label over notes', () => {
  assert.equal(
    deriveDisplayEventName('Rose Bowl', 'Some raw provider string', 'Texas @ Ohio State'),
    'Rose Bowl'
  );
});

test('deriveDisplayEventName falls back to notes when label is missing', () => {
  assert.equal(
    deriveDisplayEventName('', 'Vrbo Fiesta Bowl', 'Texas @ Ohio State'),
    'Vrbo Fiesta Bowl'
  );
});

test('deriveDisplayEventName suppresses empty and non-display-worthy label or notes', () => {
  assert.equal(deriveDisplayEventName('', '', 'Texas @ Ohio State'), null);
  assert.equal(deriveDisplayEventName('TBD', 'n/a', 'Texas @ Ohio State'), null);
  assert.equal(deriveDisplayEventName('Atlanta, GA', null, 'Texas @ Ohio State'), null);
  assert.equal(deriveDisplayEventName('Texas @ Ohio State', null, 'Texas @ Ohio State'), null);
  assert.equal(deriveDisplayEventName('', 'Texas @ Ohio State', 'Texas @ Ohio State'), null);
});

test('deriveDisplayEventName allows valid notes when label is suppressed', () => {
  assert.equal(
    deriveDisplayEventName(
      'Florida @ Georgia',
      'Aer Lingus College Football Classic',
      'Florida @ Georgia'
    ),
    'Aer Lingus College Football Classic'
  );
});

test('deriveDisplayEventName treats neutral-site separator variants as duplicate matchup text', () => {
  assert.equal(
    deriveDisplayEventName(
      'Notre Dame @ Navy',
      'Aer Lingus College Football Classic',
      'Notre Dame vs Navy'
    ),
    'Aer Lingus College Football Classic'
  );
});

test('deriveDisplayEventName keeps distinct labels even when matchup is neutral-site', () => {
  assert.equal(
    deriveDisplayEventName(
      'Aer Lingus College Football Classic',
      'Navy-Marine Corps Memorial Stadium',
      'Notre Dame vs Navy'
    ),
    'Aer Lingus College Football Classic'
  );
});
