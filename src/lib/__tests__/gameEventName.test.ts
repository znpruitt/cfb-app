import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveDisplayEventName } from '../gameEventName.ts';

test('deriveDisplayEventName returns display-worthy notes', () => {
  assert.equal(
    deriveDisplayEventName('  Vrbo Fiesta Bowl  ', 'Texas @ Ohio State'),
    'Vrbo Fiesta Bowl'
  );
});

test('deriveDisplayEventName suppresses empty and non-display-worthy notes', () => {
  assert.equal(deriveDisplayEventName('', 'Texas @ Ohio State'), null);
  assert.equal(deriveDisplayEventName('TBD', 'Texas @ Ohio State'), null);
  assert.equal(deriveDisplayEventName('Atlanta, GA', 'Texas @ Ohio State'), null);
  assert.equal(deriveDisplayEventName('Texas @ Ohio State', 'Texas @ Ohio State'), null);
});
