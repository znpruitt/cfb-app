import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateRankingsPublicationWindow,
  type RankingsPublicationContext,
} from '../publicationPolicy.ts';

// Season fixture: first kickoff Saturday 2026-08-29 18:00 UTC → the 45-day
// discovery lead begins 2026-07-15 18:00 UTC. Structured championship kickoff
// Monday 2027-01-11 00:30 UTC (weekday facts asserted below).
const YEAR = 2026;
const FIRST_KICKOFF = '2026-08-29T18:00:00.000Z';
const CHAMPIONSHIP = '2027-01-11T00:30:00.000Z';

function context(overrides: Partial<RankingsPublicationContext> = {}): RankingsPublicationContext {
  return {
    scheduledAt: new Date('2026-09-06T22:00:00.000Z'),
    year: YEAR,
    lifecycle: 'season',
    firstKickoffAt: FIRST_KICKOFF,
    structuredChampionshipKickoffAt: null,
    hasAp: false,
    hasCoaches: false,
    hasCfp: false,
    ...overrides,
  };
}

function at(iso: string): Date {
  return new Date(iso);
}

test('fixture weekdays are what the policy tests assume', () => {
  assert.equal(at(FIRST_KICKOFF).getUTCDay(), 6, 'first kickoff is a Saturday');
  assert.equal(at('2026-07-20T22:00:00.000Z').getUTCDay(), 1, 'Monday');
  assert.equal(at('2026-09-06T22:00:00.000Z').getUTCDay(), 0, 'Sunday');
  assert.equal(at('2026-09-01T22:00:00.000Z').getUTCDay(), 2, 'Tuesday');
  assert.equal(at('2026-11-04T04:00:00.000Z').getUTCDay(), 3, 'Wednesday');
  assert.equal(at(CHAMPIONSHIP).getUTCDay(), 1, 'championship is a Monday');
});

// 34/35 — preseason discovery: Monday 22:00, from 45 days before kickoff, while
// AP or Coaches is still absent.
test('preseason discovery fires on Mondays inside the 45-day lead while polls are absent', () => {
  const decision = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-07-20T22:00:00.000Z'), lifecycle: 'preseason' })
  );
  assert.deepEqual(decision, {
    due: true,
    kind: 'preseason-discovery',
    key: '2026:preseason-discovery:2026-07-20',
  });
});

test('preseason discovery does not fire before the 45-day boundary', () => {
  // Monday 2026-07-13 22:00 precedes the 2026-07-15 18:00 boundary.
  const decision = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-07-13T22:00:00.000Z'), lifecycle: 'preseason' })
  );
  assert.deepEqual(decision, { due: false, reason: 'no-window-due' });
});

test('preseason discovery stops once both AP and Coaches data exist', () => {
  const decision = evaluateRankingsPublicationWindow(
    context({
      scheduledAt: at('2026-07-20T22:00:00.000Z'),
      lifecycle: 'preseason',
      hasAp: true,
      hasCoaches: true,
    })
  );
  assert.deepEqual(decision, { due: false, reason: 'no-window-due' });
});

test('preseason discovery still fires while exactly one poll is absent', () => {
  const decision = evaluateRankingsPublicationWindow(
    context({
      scheduledAt: at('2026-07-20T22:00:00.000Z'),
      lifecycle: 'preseason',
      hasAp: true,
      hasCoaches: false,
    })
  );
  assert.equal(decision.due && decision.kind, 'preseason-discovery');
});

// 34 — weekly AP/Coaches: Sunday 22:00 during the late-preseason/active interval.
test('weekly AP/Coaches fires on Sundays from the 45-day lead through the season', () => {
  const preseasonSunday = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-07-19T22:00:00.000Z'), lifecycle: 'preseason' })
  );
  assert.deepEqual(preseasonSunday, {
    due: true,
    kind: 'weekly-ap-coaches',
    key: '2026:weekly-ap-coaches:2026-07-19',
  });

  const seasonSunday = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-09-06T22:00:00.000Z') })
  );
  assert.equal(seasonSunday.due && seasonSunday.kind, 'weekly-ap-coaches');
});

test('weekly AP/Coaches does not fire before the 45-day lead', () => {
  const decision = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-07-12T22:00:00.000Z'), lifecycle: 'preseason' })
  );
  assert.deepEqual(decision, { due: false, reason: 'no-window-due' });
});

test('weekly AP/Coaches ends seven days after the structured championship kickoff', () => {
  const inside = evaluateRankingsPublicationWindow(
    context({
      scheduledAt: at('2027-01-17T22:00:00.000Z'), // Sunday, championship + ~6.9d
      structuredChampionshipKickoffAt: CHAMPIONSHIP,
    })
  );
  assert.equal(inside.due && inside.kind, 'weekly-ap-coaches');

  const after = evaluateRankingsPublicationWindow(
    context({
      scheduledAt: at('2027-01-24T22:00:00.000Z'), // Sunday, championship + ~13d
      structuredChampionshipKickoffAt: CHAMPIONSHIP,
    })
  );
  assert.deepEqual(after, { due: false, reason: 'no-window-due' });
});

// 36 — opening-week exception: Tuesday 22:00 within 14 days after first kickoff.
test('the opening-week exception fires on Tuesdays within 14 days of the first kickoff', () => {
  const first = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-09-01T22:00:00.000Z') })
  );
  assert.deepEqual(first, {
    due: true,
    kind: 'opening-week-exception',
    key: '2026:opening-week-exception:2026-09-01',
  });

  const second = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-09-08T22:00:00.000Z') })
  );
  assert.equal(second.due && second.kind, 'opening-week-exception');
});

test('the opening-week exception stops after day 14', () => {
  // Tuesday 2026-09-15 22:00 is past 2026-08-29 18:00 + 14d (2026-09-12 18:00).
  const decision = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-09-15T22:00:00.000Z') })
  );
  assert.deepEqual(decision, { due: false, reason: 'no-window-due' });
});

// 37 — CFP publication: Wednesday 04:00, November 1 through December 10.
test('CFP publication fires on Wednesdays 04:00 UTC from November 1 through December 10', () => {
  const early = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-11-04T04:00:00.000Z') })
  );
  assert.deepEqual(early, {
    due: true,
    kind: 'cfp-publication',
    key: '2026:cfp-publication:2026-11-04',
  });

  const late = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-12-09T04:00:00.000Z') })
  );
  assert.equal(late.due && late.kind, 'cfp-publication');
});

test('CFP publication does not fire outside November 1 – December 10', () => {
  const before = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-10-28T04:00:00.000Z') })
  );
  assert.deepEqual(before, { due: false, reason: 'no-window-due' });

  const after = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-12-16T04:00:00.000Z') })
  );
  assert.deepEqual(after, { due: false, reason: 'no-window-due' });
});

// 38 — final AP/Coaches: Wednesday 04:00 within seven days after the structured
// championship kickoff; requires the structured kickoff.
test('the final-poll window requires the structured championship kickoff', () => {
  const withoutChampionship = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2027-01-13T04:00:00.000Z') })
  );
  assert.deepEqual(withoutChampionship, { due: false, reason: 'no-window-due' });

  const withChampionship = evaluateRankingsPublicationWindow(
    context({
      scheduledAt: at('2027-01-13T04:00:00.000Z'),
      structuredChampionshipKickoffAt: CHAMPIONSHIP,
    })
  );
  assert.deepEqual(withChampionship, {
    due: true,
    kind: 'final-ap-coaches',
    key: '2026:final-ap-coaches:2027-01-13',
  });
});

test('the final-poll window expires seven days after the championship kickoff', () => {
  const decision = evaluateRankingsPublicationWindow(
    context({
      scheduledAt: at('2027-01-20T04:00:00.000Z'), // Wednesday, championship + ~9d
      structuredChampionshipKickoffAt: CHAMPIONSHIP,
    })
  );
  assert.deepEqual(decision, { due: false, reason: 'no-window-due' });
});

// 39 — precedence: a Wednesday 04:00 slot inside BOTH the CFP window and a
// final-poll window resolves to final-ap-coaches.
test('final-ap-coaches takes precedence over cfp-publication on an overlapping slot', () => {
  // Hypothetical early championship (Sunday 2026-12-06) puts Wednesday
  // 2026-12-09 04:00 inside both windows.
  const decision = evaluateRankingsPublicationWindow(
    context({
      scheduledAt: at('2026-12-09T04:00:00.000Z'),
      structuredChampionshipKickoffAt: '2026-12-06T01:00:00.000Z',
    })
  );
  assert.equal(decision.due && decision.kind, 'final-ap-coaches');
});

// Slot hygiene — a non-heartbeat instant is refused deterministically.
test('a non-heartbeat slot is refused as not-a-heartbeat-slot', () => {
  const wrongHour = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-09-06T21:00:00.000Z') })
  );
  assert.deepEqual(wrongHour, { due: false, reason: 'not-a-heartbeat-slot' });

  const wrongMinutes = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-09-06T22:30:00.000Z') })
  );
  assert.deepEqual(wrongMinutes, { due: false, reason: 'not-a-heartbeat-slot' });
});

// Missing schedule context never fabricates a kickoff-derived window.
test('kickoff-derived windows require a first kickoff', () => {
  const weekly = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-09-06T22:00:00.000Z'), firstKickoffAt: null })
  );
  assert.deepEqual(weekly, { due: false, reason: 'no-window-due' });

  // The CFP calendar window is calendar-derived and remains available.
  const cfp = evaluateRankingsPublicationWindow(
    context({ scheduledAt: at('2026-11-04T04:00:00.000Z'), firstKickoffAt: null })
  );
  assert.equal(cfp.due && cfp.kind, 'cfp-publication');
});

// Determinism — identical context yields the identical decision and key.
test('the classifier is deterministic for identical context', () => {
  const ctx = context({ scheduledAt: at('2026-09-06T22:00:00.000Z') });
  assert.deepEqual(
    evaluateRankingsPublicationWindow(ctx),
    evaluateRankingsPublicationWindow(context({ scheduledAt: at('2026-09-06T22:00:00.000Z') }))
  );
});
