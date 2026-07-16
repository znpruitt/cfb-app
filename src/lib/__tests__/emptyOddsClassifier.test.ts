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
// attachment layer uses), backed by a tiny catalog + one alias so real labels
// reach `resolved` status while placeholders and UNKNOWN labels do not.
// Deliberately NO observedNames (identity-uncertainty remediation): seeding
// them registers arbitrary labels as resolved identities, which is exactly the
// production defect under test.
const RESOLVER = createTeamIdentityResolver({
  aliasMap: { UGA: 'Georgia' },
  teams: [{ school: 'Georgia' }, { school: 'Auburn' }, { school: 'Texas' }, { school: 'Rice' }],
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
    // Positive schedule expectation now requires identity inputs, so the
    // resolver is present by default; fallback tests pass `resolver: null`.
    resolver: params.resolver === undefined ? RESOLVER : params.resolver,
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
  // Moved up within the matcher's 24h tolerance and already kicked off: the
  // cached commence is still (barely) future, but the slate's current
  // startDate has passed — the event attaches and the authoritative kickoff
  // governs. (A larger commence-vs-kickoff gap is a date_mismatch and stays
  // INDETERMINATE — covered below.)
  const inTenHours = new Date(NOW + 10 * 60 * 60 * 1000).toISOString();
  const result = classify({
    priorEvents: [priorEvent({ commenceTime: inTenHours })],
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

// ---------------------------------------------------------------------------
// Unresolved-matchup remediation — dated postseason placeholders (TBD, bracket
// slots, "Winner of …") cannot have posted odds, so they never create positive
// expectation; fully resolved matchups still do. Delegated to the canonical
// placeholder classifier (buildPlaceholderParticipant), never raw string checks.
// ---------------------------------------------------------------------------

test('a dated placeholder with both participants TBD creates no positive expectation', () => {
  assert.deepEqual(
    classify({ scheduleItems: [scheduleItem({ homeTeam: 'TBD', awayTeam: 'TBD' })] }),
    VALID_ABSENCE
  );
});

test('one resolved and one unresolved participant is still not a positive expectation', () => {
  assert.deepEqual(classify({ scheduleItems: [scheduleItem({ awayTeam: 'TBD' })] }), VALID_ABSENCE);
});

test('blank participants create no positive expectation', () => {
  assert.deepEqual(
    classify({ scheduleItems: [scheduleItem({ homeTeam: '', awayTeam: 'Auburn' })] }),
    VALID_ABSENCE
  );
});

test('bracket-style and "Winner of …" placeholders create no positive expectation', () => {
  const items = [
    scheduleItem({ homeTeam: 'CFP Quarterfinal 1', awayTeam: 'CFP Quarterfinal 2' }),
    scheduleItem({ homeTeam: 'Winner of Sugar Bowl', awayTeam: 'Winner of Rose Bowl' }),
  ];
  assert.deepEqual(classify({ scheduleItems: items }), VALID_ABSENCE);
});

test('a fully RESOLVED matchup inside the horizon still makes an empty payload unexpected', () => {
  const result = classify({
    scheduleItems: [scheduleItem({ homeTeam: 'Georgia', awayTeam: 'Texas' })],
  });
  assert.equal(result.kind, 'unexpected-empty');
  assert.equal(result.kind === 'unexpected-empty' && result.nearHorizonGameCount, 1);
});

// ---------------------------------------------------------------------------
// Identity-uncertainty remediation — ambiguous or unavailable identity
// evidence authorizes neither an unexpected-empty failure nor destructive
// clearing; only confident matches and confident absences carry verdicts, and
// unknown labels never auto-resolve into real teams.
// ---------------------------------------------------------------------------

test('a repeated matchup with missing commence time is AMBIGUOUS: no evidence, no clearing', () => {
  const result = classify({
    priorEvents: [priorEvent({ commenceTime: null })],
    // Same pair twice, both future and beyond the horizon — the matcher has no
    // date signal and refuses to guess.
    scheduleItems: [
      scheduleItem({ startDate: IN_10_DAYS }),
      scheduleItem({ startDate: IN_30_DAYS }),
    ],
  });
  assert.deepEqual(result, VALID_ABSENCE, 'ambiguous candidacy must stay indeterminate');
});

test('a cached commence matching NO candidate kickoff (date_mismatch) is indeterminate, not obsolete', () => {
  const result = classify({
    priorEvents: [priorEvent({ commenceTime: IN_3_DAYS })],
    scheduleItems: [scheduleItem({ startDate: IN_30_DAYS })],
  });
  assert.deepEqual(result, VALID_ABSENCE, 'a tolerance miss is uncertainty, not proof of absence');
});

test('an ambiguous event with an EXPIRED cached commence still proves obsolescence', () => {
  const result = classify({
    priorEvents: [priorEvent({ commenceTime: KICKED_OFF })],
    scheduleItems: [
      scheduleItem({ startDate: IN_10_DAYS }),
      scheduleItem({ startDate: IN_30_DAYS }),
    ],
  });
  assert.deepEqual(
    result,
    VALID_ABSENCE_OBSOLETE,
    'an already-kicked-off line is legitimately gone from the feed regardless of matching'
  );
});

test('unknown labels like "Home Team TBA" never auto-resolve into positive evidence', () => {
  assert.deepEqual(
    classify({
      scheduleItems: [scheduleItem({ homeTeam: 'Home Team TBA', awayTeam: 'Away Team TBA' })],
    }),
    VALID_ABSENCE
  );
});

test('one resolved and one UNKNOWN participant is not a positive expectation', () => {
  assert.deepEqual(
    classify({ scheduleItems: [scheduleItem({ awayTeam: 'Home Team TBA' })] }),
    VALID_ABSENCE
  );
});

test('alias-resolved participants still create positive evidence', () => {
  const result = classify({
    scheduleItems: [scheduleItem({ homeTeam: 'UGA', awayTeam: 'Auburn' })],
  });
  assert.equal(result.kind, 'unexpected-empty', 'scoped aliases are genuine canonical identity');
  assert.equal(result.kind === 'unexpected-empty' && result.nearHorizonGameCount, 1);
});

// ---------------------------------------------------------------------------
// State-model remediation — failure to match is not proof of absence unless
// BOTH event and slate identities were confidently resolved. Only then may an
// unmatched row prove obsolescence.
// ---------------------------------------------------------------------------

test('an unresolved provider spelling is identity-unresolved: retained, never proof of absence', () => {
  const result = classify({
    priorEvents: [priorEvent({ homeTeam: 'Zzz Unknown Home', awayTeam: 'Zzz Unknown Away' })],
    scheduleItems: [scheduleItem({ homeTeam: 'Texas', awayTeam: 'Rice', startDate: IN_30_DAYS })],
  });
  assert.deepEqual(result, VALID_ABSENCE, 'identity failure must not read as confident absence');
});

test('placeholder slate rows conceal games: a resolved unmatched event is NOT confidently absent', () => {
  const result = classify({
    priorEvents: [priorEvent({ commenceTime: IN_10_DAYS })], // Georgia/Auburn, resolved
    // The only slate row is an unreachable placeholder slot the event's game
    // may resolve into once participants are announced.
    scheduleItems: [scheduleItem({ homeTeam: 'TBD', awayTeam: 'TBD', startDate: IN_10_DAYS })],
  });
  assert.deepEqual(result, VALID_ABSENCE, 'a concealing placeholder blocks confident absence');
});

test('one unresolved participant anywhere in the slate suppresses unmatched clearing', () => {
  const result = classify({
    priorEvents: [priorEvent()], // Georgia/Auburn, resolved
    scheduleItems: [
      scheduleItem({ homeTeam: 'Texas', awayTeam: 'Zzz Unknown Spelling', startDate: IN_30_DAYS }),
    ],
  });
  assert.deepEqual(result, VALID_ABSENCE, 'an unreachable slate row blocks confident absence');
});
