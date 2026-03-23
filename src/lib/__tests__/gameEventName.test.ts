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
