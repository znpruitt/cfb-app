import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyEmptyOddsResponse,
  ODDS_EXPECTED_KICKOFF_HORIZON_MS,
  type OddsScheduleEvidenceItem,
} from '../odds/emptyOddsClassifier.ts';

const NOW = Date.parse('2026-10-15T18:00:00.000Z');
const IN_3_DAYS = new Date(NOW + 3 * 24 * 60 * 60 * 1000).toISOString();
const IN_30_DAYS = new Date(NOW + 30 * 24 * 60 * 60 * 1000).toISOString();
const KICKED_OFF = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();

function scheduleItem(overrides: Partial<OddsScheduleEvidenceItem> = {}): OddsScheduleEvidenceItem {
  return { startDate: IN_3_DAYS, status: 'scheduled', ...overrides };
}

test('no evidence at all → valid absence', () => {
  assert.deepEqual(classifyEmptyOddsResponse({ priorEvents: [], scheduleItems: null, now: NOW }), {
    kind: 'valid-absence',
  });
});

test('a prior-good event that has not kicked off yet → unexpected empty', () => {
  const result = classifyEmptyOddsResponse({
    priorEvents: [{ commenceTime: IN_3_DAYS }],
    scheduleItems: null,
    now: NOW,
  });
  assert.equal(result.kind, 'unexpected-empty');
  assert.equal(result.kind === 'unexpected-empty' && result.priorUpcomingEventCount, 1);
});

test('prior events that already kicked off are legitimately absent → valid absence', () => {
  assert.deepEqual(
    classifyEmptyOddsResponse({
      priorEvents: [{ commenceTime: KICKED_OFF }, { commenceTime: null }],
      scheduleItems: null,
      now: NOW,
    }),
    { kind: 'valid-absence' }
  );
});

test('a non-disrupted schedule game within the 7-day horizon → unexpected empty', () => {
  const result = classifyEmptyOddsResponse({
    priorEvents: [],
    scheduleItems: [scheduleItem()],
    now: NOW,
  });
  assert.equal(result.kind, 'unexpected-empty');
  assert.equal(result.kind === 'unexpected-empty' && result.nearHorizonGameCount, 1);
});

test('schedule games beyond the horizon create no expectation → valid absence', () => {
  assert.deepEqual(
    classifyEmptyOddsResponse({
      priorEvents: [],
      scheduleItems: [scheduleItem({ startDate: IN_30_DAYS })],
      now: NOW,
    }),
    { kind: 'valid-absence' }
  );
});

test('a game exactly at the horizon boundary still counts; one past it does not', () => {
  const atHorizon = new Date(NOW + ODDS_EXPECTED_KICKOFF_HORIZON_MS).toISOString();
  const pastHorizon = new Date(NOW + ODDS_EXPECTED_KICKOFF_HORIZON_MS + 60_000).toISOString();
  assert.equal(
    classifyEmptyOddsResponse({
      priorEvents: [],
      scheduleItems: [scheduleItem({ startDate: atHorizon })],
      now: NOW,
    }).kind,
    'unexpected-empty'
  );
  assert.equal(
    classifyEmptyOddsResponse({
      priorEvents: [],
      scheduleItems: [scheduleItem({ startDate: pastHorizon })],
      now: NOW,
    }).kind,
    'valid-absence'
  );
});

test('kicked-off and disrupted schedule games never create an expectation', () => {
  const items = [
    scheduleItem({ startDate: KICKED_OFF }),
    scheduleItem({ status: 'canceled' }),
    scheduleItem({ status: 'STATUS_POSTPONED' }),
    scheduleItem({ startDate: null }),
    scheduleItem({ startDate: 'not-a-date' }),
  ];
  assert.deepEqual(classifyEmptyOddsResponse({ priorEvents: [], scheduleItems: items, now: NOW }), {
    kind: 'valid-absence',
  });
});

test('null scheduleItems (filtered target or failed read) contributes no evidence', () => {
  // Identical near-horizon game, but the caller withheld schedule evidence —
  // e.g. a filtered bookmaker subset that may legitimately be empty.
  assert.deepEqual(classifyEmptyOddsResponse({ priorEvents: [], scheduleItems: null, now: NOW }), {
    kind: 'valid-absence',
  });
});

test('either evidence source alone is sufficient, and both are reported', () => {
  const result = classifyEmptyOddsResponse({
    priorEvents: [{ commenceTime: IN_3_DAYS }, { commenceTime: KICKED_OFF }],
    scheduleItems: [scheduleItem(), scheduleItem({ startDate: IN_30_DAYS })],
    now: NOW,
  });
  assert.equal(result.kind, 'unexpected-empty');
  assert.equal(result.kind === 'unexpected-empty' && result.priorUpcomingEventCount, 1);
  assert.equal(result.kind === 'unexpected-empty' && result.nearHorizonGameCount, 1);
});
