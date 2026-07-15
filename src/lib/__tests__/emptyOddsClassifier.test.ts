import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyEmptyOddsResponse,
  ODDS_EXPECTED_KICKOFF_HORIZON_MS,
  type OddsScheduleEvidenceItem,
  type PriorOddsEventEvidence,
} from '../odds/emptyOddsClassifier.ts';
import { createTeamIdentityResolver } from '../teamIdentity.ts';

const NOW = Date.parse('2026-10-15T18:00:00.000Z');
const IN_3_DAYS = new Date(NOW + 3 * 24 * 60 * 60 * 1000).toISOString();
const IN_10_DAYS = new Date(NOW + 10 * 24 * 60 * 60 * 1000).toISOString();
const IN_30_DAYS = new Date(NOW + 30 * 24 * 60 * 60 * 1000).toISOString();
const KICKED_OFF = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
const DAYS_AGO_20 = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString();

// A minimal but REAL resolver (the same canonical identity machinery the
// attachment layer uses) — labels resolve to themselves via observedNames.
const RESOLVER = createTeamIdentityResolver({
  aliasMap: {},
  teams: [],
  observedNames: ['Georgia', 'Auburn', 'Texas', 'Rice'],
});

function scheduleItem(overrides: Partial<OddsScheduleEvidenceItem> = {}): OddsScheduleEvidenceItem {
  return {
    homeTeam: 'Georgia',
    awayTeam: 'Auburn',
    startDate: IN_3_DAYS,
    status: 'scheduled',
    ...overrides,
  };
}

function priorEvent(overrides: Partial<PriorOddsEventEvidence> = {}): PriorOddsEventEvidence {
  return { homeTeam: 'Georgia', awayTeam: 'Auburn', commenceTime: IN_3_DAYS, ...overrides };
}

function classify(params: {
  priorEvents?: PriorOddsEventEvidence[];
  scheduleItems?: OddsScheduleEvidenceItem[] | null;
  resolver?: typeof RESOLVER | null;
  includeScheduleExpectation?: boolean;
}) {
  return classifyEmptyOddsResponse({
    priorEvents: params.priorEvents ?? [],
    scheduleItems: params.scheduleItems ?? null,
    resolver: params.resolver ?? null,
    includeScheduleExpectation: params.includeScheduleExpectation ?? true,
    now: NOW,
  });
}

const VALID_ABSENCE = { kind: 'valid-absence', priorRowsProvablyObsolete: false };
const VALID_ABSENCE_OBSOLETE = { kind: 'valid-absence', priorRowsProvablyObsolete: true };

// ---------------------------------------------------------------------------
// Fallback path — schedule or identity inputs unavailable: the original
// conservative cached-commence rule, and nothing is ever provably obsolete.
// ---------------------------------------------------------------------------

test('no evidence at all → valid absence (nothing provably obsolete)', () => {
  assert.deepEqual(classify({}), VALID_ABSENCE);
});

test('fallback: a future cached commence counts when the schedule read failed', () => {
  const result = classify({ priorEvents: [priorEvent()], scheduleItems: null });
  assert.equal(result.kind, 'unexpected-empty');
  assert.equal(result.kind === 'unexpected-empty' && result.priorUpcomingEventCount, 1);
});

test('fallback: expired or unparseable cached commence is never evidence', () => {
  assert.deepEqual(
    classify({
      priorEvents: [priorEvent({ commenceTime: KICKED_OFF }), priorEvent({ commenceTime: null })],
      scheduleItems: null,
    }),
    VALID_ABSENCE
  );
});

test('fallback: an EMPTY loaded slate proves nothing — cached commence still counts, nothing obsolete', () => {
  const result = classify({
    priorEvents: [priorEvent()],
    scheduleItems: [],
    resolver: RESOLVER,
  });
  assert.equal(result.kind, 'unexpected-empty');
});

test('fallback: missing resolver inputs behave like a failed schedule read', () => {
  const result = classify({
    priorEvents: [priorEvent()],
    scheduleItems: [scheduleItem({ status: 'canceled' })],
    resolver: null,
  });
  assert.equal(result.kind, 'unexpected-empty', 'no identity inputs → no exculpation');
});

// ---------------------------------------------------------------------------
// Near-horizon schedule expectation (canonical targets only).
// ---------------------------------------------------------------------------

test('a non-disrupted schedule game within the 7-day horizon → unexpected empty', () => {
  const result = classify({ scheduleItems: [scheduleItem()] });
  assert.equal(result.kind, 'unexpected-empty');
  assert.equal(result.kind === 'unexpected-empty' && result.nearHorizonGameCount, 1);
});

test('a game exactly at the horizon boundary still counts; one past it does not', () => {
  const atHorizon = new Date(NOW + ODDS_EXPECTED_KICKOFF_HORIZON_MS).toISOString();
  const pastHorizon = new Date(NOW + ODDS_EXPECTED_KICKOFF_HORIZON_MS + 60_000).toISOString();
  assert.equal(
    classify({ scheduleItems: [scheduleItem({ startDate: atHorizon })] }).kind,
    'unexpected-empty'
  );
  assert.deepEqual(
    classify({ scheduleItems: [scheduleItem({ startDate: pastHorizon })] }),
    VALID_ABSENCE
  );
});

test('kicked-off, disrupted, and unparseable schedule games never create an expectation', () => {
  const items = [
    scheduleItem({ startDate: KICKED_OFF }),
    scheduleItem({ status: 'canceled' }),
    scheduleItem({ status: 'STATUS_POSTPONED' }),
    scheduleItem({ startDate: null }),
    scheduleItem({ startDate: 'not-a-date' }),
  ];
  assert.deepEqual(classify({ scheduleItems: items }), VALID_ABSENCE);
});

test('filtered targets gain no positive schedule expectation', () => {
  assert.deepEqual(
    classify({ scheduleItems: [scheduleItem()], includeScheduleExpectation: false }),
    VALID_ABSENCE
  );
});

// ---------------------------------------------------------------------------
// Prior-event reconciliation against the canonical slate (seam-audit
// remediation): disruption, current kickoff, and slate membership govern —
// via the SAME identity/pair/date matcher the attachment layer uses.
// ---------------------------------------------------------------------------

test('a prior event matched to a DISRUPTED game is exculpated and provably obsolete', () => {
  for (const status of ['canceled', 'Cancelled', 'STATUS_POSTPONED', 'suspended', 'delayed']) {
    const result = classify({
      priorEvents: [priorEvent()],
      scheduleItems: [scheduleItem({ status })],
      resolver: RESOLVER,
    });
    assert.deepEqual(result, VALID_ABSENCE_OBSOLETE, `status=${status}`);
  }
});

test('a cached-future event whose matched game already STARTED per the authoritative kickoff is obsolete', () => {
  // Rescheduled earlier / already played: cached commence still future, but the
  // slate's current startDate has passed.
  const result = classify({
    priorEvents: [priorEvent({ commenceTime: IN_3_DAYS })],
    scheduleItems: [scheduleItem({ startDate: KICKED_OFF, status: 'final' })],
    resolver: RESOLVER,
  });
  assert.deepEqual(result, VALID_ABSENCE_OBSOLETE);
});

test('a prior event UNMATCHED against a successfully loaded slate is obsolete, never evidence', () => {
  const result = classify({
    priorEvents: [priorEvent()], // Georgia/Auburn
    // Slate exists but holds a different (far-out, non-disrupted) game.
    scheduleItems: [scheduleItem({ homeTeam: 'Texas', awayTeam: 'Rice', startDate: IN_30_DAYS })],
    resolver: RESOLVER,
  });
  assert.deepEqual(result, VALID_ABSENCE_OBSOLETE);
});

test('a matched healthy game keeps prior evidence even BEYOND the 7-day horizon', () => {
  const result = classify({
    priorEvents: [priorEvent({ commenceTime: IN_10_DAYS })],
    scheduleItems: [scheduleItem({ startDate: IN_10_DAYS })],
    resolver: RESOLVER,
  });
  assert.equal(result.kind, 'unexpected-empty', 'early-line regression protection preserved');
  assert.equal(result.kind === 'unexpected-empty' && result.priorUpcomingEventCount, 1);
});

test('mixed evidence: one obsolete event does not mask a healthy future match', () => {
  const result = classify({
    priorEvents: [
      priorEvent(), // Georgia/Auburn — canceled below
      priorEvent({ homeTeam: 'Texas', awayTeam: 'Rice', commenceTime: IN_10_DAYS }),
    ],
    scheduleItems: [
      scheduleItem({ status: 'canceled' }),
      scheduleItem({ homeTeam: 'Texas', awayTeam: 'Rice', startDate: IN_10_DAYS }),
    ],
    resolver: RESOLVER,
  });
  assert.equal(result.kind, 'unexpected-empty');
  assert.equal(result.kind === 'unexpected-empty' && result.priorUpcomingEventCount, 1);
});

test('a matched game with no parseable kickoff is indeterminate: not evidence, and blocks the obsolete flag', () => {
  const result = classify({
    priorEvents: [priorEvent({ commenceTime: IN_3_DAYS })],
    scheduleItems: [scheduleItem({ startDate: null })],
    resolver: RESOLVER,
  });
  assert.deepEqual(result, VALID_ABSENCE, 'future cached commence + unknown kickoff → no clear');
});

test('an EXPIRED cached commence on an unknown-kickoff match still proves obsolescence', () => {
  const result = classify({
    priorEvents: [priorEvent({ commenceTime: KICKED_OFF })],
    scheduleItems: [scheduleItem({ startDate: null })],
    resolver: RESOLVER,
  });
  assert.deepEqual(result, VALID_ABSENCE_OBSOLETE);
});

test('repeat-team matchups disambiguate by kickoff proximity (existing attachment tolerance)', () => {
  // Same pair twice: a long-finished earlier meeting and the healthy upcoming
  // rematch. The event's commence time selects the rematch → healthy evidence.
  const result = classify({
    priorEvents: [priorEvent({ commenceTime: IN_10_DAYS })],
    scheduleItems: [
      scheduleItem({ startDate: DAYS_AGO_20, status: 'final' }),
      scheduleItem({ startDate: IN_10_DAYS }),
    ],
    resolver: RESOLVER,
  });
  assert.equal(result.kind, 'unexpected-empty', 'the rematch, not the played meeting, governs');
});
