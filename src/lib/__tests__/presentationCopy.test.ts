import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveActiveSurfaceCopy } from '../presentationCopy';

test('active surface copy returns null subtitles for standard surfaces', () => {
  assert.equal(deriveActiveSurfaceCopy('overview').subtitle, null);
  assert.equal(deriveActiveSurfaceCopy('schedule').subtitle, null);
  assert.equal(deriveActiveSurfaceCopy('matchups').subtitle, null);
});
