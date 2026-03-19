import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyConferenceForSubdivision,
  inferSubdivisionFromConference,
  normalizeConferenceKey,
  resetConferenceClassificationRecords,
  resolvePresentDayConferencePolicy,
  setConferenceClassificationRecords,
} from '../conferenceSubdivision.ts';

test('normalizeConferenceKey normalizes punctuation and spacing', () => {
  assert.equal(normalizeConferenceKey(' C-USA '), 'cusa');
  assert.equal(normalizeConferenceKey('The American'), 'theamerican');
  assert.equal(normalizeConferenceKey('Mid-American Conference'), 'midamericanconference');
});

test('present-day policy resolves required FCS aliases', () => {
  for (const label of ['SWAC', 'Ivy', 'Southern', 'Southland', 'UAC', 'SoCon']) {
    const match = classifyConferenceForSubdivision(label);
    assert.equal(match.source, 'present_day_policy');
    assert.equal(match.subdivision, 'FCS');
    assert.equal(match.ambiguous, false);
    assert.equal(match.overrideApplied, true);
    assert.ok(match.matchedPolicyConference);
  }
});

test('present-day policy resolves required FBS aliases', () => {
  for (const label of ['SEC', 'AAC', 'The American', 'C-USA', 'Conference USA']) {
    const match = classifyConferenceForSubdivision(label);
    assert.equal(match.source, 'present_day_policy');
    assert.equal(match.subdivision, 'FBS');
  }
});

test('present-day policy resolves singular and plural independent aliases correctly', () => {
  const fbsSingular = classifyConferenceForSubdivision('FBS Independent');
  assert.equal(fbsSingular.source, 'present_day_policy');
  assert.equal(fbsSingular.subdivision, 'FBS');

  const fbsPlural = classifyConferenceForSubdivision('FBS Independents');
  assert.equal(fbsPlural.source, 'present_day_policy');
  assert.equal(fbsPlural.subdivision, 'FBS');

  const fcsSingular = classifyConferenceForSubdivision('FCS Independent');
  assert.equal(fcsSingular.source, 'present_day_policy');
  assert.equal(fcsSingular.subdivision, 'FCS');

  const fcsPlural = classifyConferenceForSubdivision('FCS Independents');
  assert.equal(fcsPlural.source, 'present_day_policy');
  assert.equal(fcsPlural.subdivision, 'FCS');
});

test('generic independent aliases remain non-colliding and resolve to FBS policy', () => {
  const independent = classifyConferenceForSubdivision('Independent');
  assert.equal(independent.source, 'present_day_policy');
  assert.equal(independent.subdivision, 'FBS');

  const independents = classifyConferenceForSubdivision('Independents');
  assert.equal(independents.source, 'present_day_policy');
  assert.equal(independents.subdivision, 'FBS');
});

test('resolvePresentDayConferencePolicy returns expected metadata', () => {
  const match = resolvePresentDayConferencePolicy('The American');
  assert.ok(match);
  assert.equal(match?.source, 'present_day_policy');
  assert.equal(match?.policy.name, 'American Athletic Conference');
  assert.equal(match?.policy.classification, 'fbs');
});

test('raw WAC without additional context does not resolve via present-day policy', () => {
  resetConferenceClassificationRecords();
  const policyMatch = resolvePresentDayConferencePolicy('WAC');
  assert.equal(policyMatch, null);

  const unresolved = classifyConferenceForSubdivision('WAC');
  assert.equal(unresolved.source, 'unresolved');
  assert.equal(unresolved.subdivision, 'OTHER');
});

test('raw WAC with conflicting CFBD candidates is classified as ambiguous and fail-closed', () => {
  setConferenceClassificationRecords([
    {
      id: 200,
      name: 'Western Athletic Conference',
      shortName: 'WAC',
      abbreviation: 'WAC',
      classification: 'fbs',
    },
    {
      id: 201,
      name: 'Western Athletic Conference',
      shortName: 'WAC',
      abbreviation: 'WAC',
      classification: 'fcs',
    },
  ]);

  const match = classifyConferenceForSubdivision('WAC');
  assert.equal(match.source, 'ambiguous');
  assert.equal(match.subdivision, 'OTHER');
  assert.equal(match.ambiguous, true);
  assert.equal(match.candidates.length, 2);

  resetConferenceClassificationRecords();
});

test('cfbd lookup is used only when unambiguous and no policy alias exists', () => {
  setConferenceClassificationRecords([
    {
      id: 1,
      name: 'Great American Conference',
      shortName: 'Great American',
      abbreviation: 'GAC',
      classification: 'ii',
    },
  ]);

  const match = classifyConferenceForSubdivision('Great American');
  assert.equal(match.source, 'cfbd_conference_lookup');
  assert.equal(match.subdivision, 'OTHER');
  assert.equal(match.matchedRecord?.abbreviation, 'GAC');

  resetConferenceClassificationRecords();
});

test('ambiguous CFBD duplicates without policy match fail closed', () => {
  setConferenceClassificationRecords([
    {
      id: 10,
      name: 'Independent Athletic Group',
      shortName: 'IAG',
      abbreviation: 'IAG',
      classification: 'fbs',
    },
    {
      id: 11,
      name: 'Independent Athletic Group (Historical)',
      shortName: 'IAG',
      abbreviation: 'IAG',
      classification: 'fcs',
    },
  ]);

  const match = classifyConferenceForSubdivision('IAG');
  assert.equal(match.source, 'ambiguous');
  assert.equal(match.subdivision, 'OTHER');
  assert.equal(match.ambiguous, true);
  assert.equal(match.candidates.length, 2);

  resetConferenceClassificationRecords();
});

test('policy takes precedence over ambiguous CFBD duplicates for SWAC', () => {
  setConferenceClassificationRecords([
    {
      id: 100,
      name: 'Southwestern Athletic Conference',
      shortName: 'SWAC',
      abbreviation: 'SWAC',
      classification: 'fbs',
    },
    {
      id: 101,
      name: 'Southwestern Athletic Conference',
      shortName: 'SWAC',
      abbreviation: 'SWAC',
      classification: 'fcs',
    },
  ]);

  const match = classifyConferenceForSubdivision('SWAC');
  assert.equal(match.source, 'present_day_policy');
  assert.equal(match.subdivision, 'FCS');
  assert.equal(match.ambiguous, false);

  resetConferenceClassificationRecords();
});

test('unresolved conference remains unresolved and fail-closed', () => {
  resetConferenceClassificationRecords();
  const match = classifyConferenceForSubdivision('Unknown Future League');
  assert.equal(match.source, 'unresolved');
  assert.equal(match.subdivision, 'OTHER');
  assert.equal(inferSubdivisionFromConference(''), 'UNKNOWN');
});
