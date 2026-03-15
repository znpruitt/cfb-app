import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FBS_CONFERENCE_HINTS,
  FCS_CONFERENCE_HINTS,
  inferSubdivisionFromConference,
} from '../conferenceSubdivision';

test('canonical conference hint sets include critical FBS and FCS markers', () => {
  assert.equal(FBS_CONFERENCE_HINTS.has('sec'), true);
  assert.equal(FBS_CONFERENCE_HINTS.has('big ten'), true);
  assert.equal(FCS_CONFERENCE_HINTS.has('big sky'), true);
  assert.equal(FCS_CONFERENCE_HINTS.has('mvfc'), true);
});

test('conference subdivision inference preserves FCS fail-closed behavior', () => {
  assert.equal(inferSubdivisionFromConference('Big Sky'), 'FCS');
  assert.equal(inferSubdivisionFromConference('MVFC'), 'FCS');
  assert.equal(inferSubdivisionFromConference('SEC'), 'FBS');
  assert.equal(inferSubdivisionFromConference('Independent'), 'FBS');
  assert.equal(inferSubdivisionFromConference('FCS Independent'), 'FCS');
  assert.equal(inferSubdivisionFromConference(''), 'UNKNOWN');
  assert.equal(inferSubdivisionFromConference('Some Unknown League'), 'OTHER');
});
