import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FBS_CONFERENCE_HINTS,
  FCS_CONFERENCE_HINTS,
  classifyConferenceForSubdivision,
  inferSubdivisionFromConference,
  resetConferenceClassificationRecords,
  setConferenceClassificationRecords,
} from '../conferenceSubdivision';

test('canonical conference fallback sets include critical FBS and FCS markers', () => {
  assert.equal(FBS_CONFERENCE_HINTS.has('sec'), true);
  assert.equal(FBS_CONFERENCE_HINTS.has('bigten'), true);
  assert.equal(FCS_CONFERENCE_HINTS.has('bigsky'), true);
  assert.equal(FCS_CONFERENCE_HINTS.has('mvfc'), true);
});

test('conference subdivision inference prefers CFBD conference records when available', () => {
  setConferenceClassificationRecords([
    {
      name: 'American Athletic Conference',
      shortName: 'American Athletic',
      abbreviation: 'AAC',
      classification: 'fbs',
    },
    {
      name: 'Great American Conference',
      shortName: 'Great American',
      abbreviation: 'GAC',
      classification: 'ii',
    },
  ]);

  assert.equal(inferSubdivisionFromConference('American'), 'FBS');
  assert.equal(inferSubdivisionFromConference('AAC'), 'FBS');
  assert.equal(inferSubdivisionFromConference('Great American'), 'OTHER');

  const greatAmerican = classifyConferenceForSubdivision('Great American');
  assert.equal(greatAmerican.source, 'cfbd_conference_lookup');
  assert.equal(greatAmerican.matchedRecord?.classification, 'OTHER');

  resetConferenceClassificationRecords();
});

test('conference subdivision inference preserves explicit fallback behavior when unresolved', () => {
  resetConferenceClassificationRecords();

  assert.equal(inferSubdivisionFromConference('Big Sky'), 'FCS');
  assert.equal(inferSubdivisionFromConference('MVFC'), 'FCS');
  assert.equal(inferSubdivisionFromConference('SEC'), 'FBS');
  assert.equal(inferSubdivisionFromConference('Independent'), 'FBS');
  assert.equal(inferSubdivisionFromConference('FCS Independent'), 'FCS');
  assert.equal(inferSubdivisionFromConference(''), 'UNKNOWN');
  assert.equal(inferSubdivisionFromConference('Some Unknown League'), 'OTHER');

  const unresolved = classifyConferenceForSubdivision('Some Unknown League');
  assert.equal(unresolved.source, 'unresolved');
});

test('normalization handles real conference variants without false-positive collisions', () => {
  setConferenceClassificationRecords([
    {
      name: 'Conference USA',
      shortName: 'Conference USA',
      abbreviation: 'C-USA',
      classification: 'fbs',
    },
    {
      name: 'Southeastern Conference',
      shortName: 'SEC',
      abbreviation: 'SEC',
      classification: 'fbs',
    },
    {
      name: 'Mid-American Conference',
      shortName: 'Mid-American',
      abbreviation: 'MAC',
      classification: 'fbs',
    },
    {
      name: 'Great American Conference',
      shortName: 'Great American',
      abbreviation: 'GAC',
      classification: 'ii',
    },
  ]);

  assert.equal(inferSubdivisionFromConference('C-USA'), 'FBS');
  assert.equal(inferSubdivisionFromConference('Conference USA'), 'FBS');
  assert.equal(inferSubdivisionFromConference('SEC'), 'FBS');
  assert.equal(inferSubdivisionFromConference('Southeastern Conference'), 'FBS');
  assert.equal(inferSubdivisionFromConference('MAC'), 'FBS');
  assert.equal(inferSubdivisionFromConference('Mid-American Conference'), 'FBS');
  assert.equal(inferSubdivisionFromConference('Great American'), 'OTHER');

  resetConferenceClassificationRecords();
});
