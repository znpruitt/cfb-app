import assert from 'node:assert/strict';
import test from 'node:test';

import { selectPreseasonBannerState, type PreseasonBannerInput } from '../preseasonBanner.ts';

// ---------------------------------------------------------------------------
// PRESEASON-STATUS-BANNER-TRUTHFULNESS
//
// The defect: `leagueStatus.state === 'preseason'` was used as evidence for a
// DRAFT-STATUS claim. Every preseason league that was not live/paused/complete
// rendered `{year} Draft scheduled`, and a null `scheduledAt` — an explicitly
// legitimate unscheduled state — was papered over with `· Date TBD`.
//
// These tests are the claim ledger: each state names the fact that licenses it,
// and the negative assertions prove that a claim never outruns its fact. The
// copy is pinned here rather than through rendering because this module is
// where the claim is decided; a component test would pin the same strings one
// layer further from the decision.
// ---------------------------------------------------------------------------

const PRESEASON_2026 = { state: 'preseason', year: 2026 } as const;

function input(overrides: Partial<PreseasonBannerInput> = {}): PreseasonBannerInput {
  return {
    leagueStatus: PRESEASON_2026,
    ownersRosterSource: 'none',
    draftPhase: null,
    draftScheduledAt: null,
    draftCurrentRound: null,
    bannerYear: 2026,
    week1HasStarted: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The regression: production showed `2026 Draft scheduled · Date TBD` on a
// league whose own overview simultaneously said it wasn't set up yet.
// ---------------------------------------------------------------------------

test('preseason with no current-season roster and no draft date never claims a scheduled draft', () => {
  const state = selectPreseasonBannerState(input());

  assert.equal(state?.kind, 'awaiting-roster');
  assert.equal(state?.headline, 'Awaiting 2026 roster confirmation · Contact your commissioner');
  assert.doesNotMatch(state!.headline, /[Dd]raft scheduled/);
  assert.doesNotMatch(state!.headline, /TBD/);
});

test('the earlier preseason states are reached through every pre-draft phase, not just a null draft', () => {
  // `setup`, `settings`, and `preview` are draft CONFIGURATION phases. None of
  // them carries a date, so none of them may license a scheduling claim — this
  // is the exact set the old code collapsed onto `Draft scheduled`.
  for (const draftPhase of ['setup', 'settings', 'preview'] as const) {
    const withoutRoster = selectPreseasonBannerState(input({ draftPhase }));
    assert.equal(withoutRoster?.kind, 'awaiting-roster', draftPhase);

    const withRoster = selectPreseasonBannerState(
      input({ draftPhase, ownersRosterSource: 'preseason-owners' })
    );
    assert.equal(withRoster?.kind, 'draft-unscheduled', draftPhase);
    assert.equal(withRoster?.headline, 'Roster confirmed · Draft to be scheduled');
    assert.doesNotMatch(withRoster!.headline, /scheduled ·/);
  }
});

// ---------------------------------------------------------------------------
// Roster readiness — the canonical current-season ownership authority
// ---------------------------------------------------------------------------

test('both current-season roster sources count as confirmed, and a draft record decides the wording', () => {
  // `preseason-owners` — commissioner confirmed owners, no CSV written yet.
  const confirmed = selectPreseasonBannerState(input({ ownersRosterSource: 'preseason-owners' }));
  assert.equal(confirmed?.kind, 'roster-confirmed');
  assert.equal(confirmed?.headline, 'Roster confirmed · Season setup in progress');

  // `csv` — a real owners roster exists for the preseason year.
  const csv = selectPreseasonBannerState(input({ ownersRosterSource: 'csv' }));
  assert.equal(csv?.kind, 'roster-confirmed');

  // With no draft record at all the banner must not promise a draft: the league
  // may be assigning teams manually.
  assert.doesNotMatch(confirmed!.headline, /[Dd]raft/);
});

test('a PRIOR season roster is not current-season readiness', () => {
  // `archive` is last season's roster. The draft-setup page seeds a new draft
  // from archive owners when no preseason-owners record exists, so historical
  // roster data reaching this derivation is a live hazard, not a hypothetical.
  const archive = selectPreseasonBannerState(input({ ownersRosterSource: 'archive' }));
  assert.equal(archive?.kind, 'awaiting-roster');

  // A route that passed no canonical snapshot proves nothing either.
  const missing = selectPreseasonBannerState(input({ ownersRosterSource: undefined }));
  assert.equal(missing?.kind, 'awaiting-roster');
});

// ---------------------------------------------------------------------------
// `Draft scheduled` — licensed only by a parseable `scheduledAt`
// ---------------------------------------------------------------------------

test('a real scheduled date is the only thing that produces the scheduled claim', () => {
  const state = selectPreseasonBannerState(
    input({
      draftPhase: 'preview',
      ownersRosterSource: 'preseason-owners',
      draftScheduledAt: '2026-08-20T23:00:00.000Z',
    })
  );

  assert.equal(state?.kind, 'draft-scheduled');
  assert.equal(state?.headline, '2026 Draft scheduled');
  assert.equal(
    state?.kind === 'draft-scheduled' ? state.scheduledAt : null,
    '2026-08-20T23:00:00.000Z'
  );
});

test('an unusable scheduledAt is no evidence at all', () => {
  // The value crosses an HTTP boundary as untyped JSON. Anything that does not
  // parse to a real instant must fall back to an earlier state rather than
  // render `Invalid Date` under a `scheduled` headline.
  for (const draftScheduledAt of ['', '   ', 'sometime in August', 'not-a-date']) {
    const state = selectPreseasonBannerState(
      input({ ownersRosterSource: 'csv', draftPhase: 'preview', draftScheduledAt })
    );
    assert.equal(state?.kind, 'draft-unscheduled', JSON.stringify(draftScheduledAt));
  }
});

test('a scheduled date still reads as scheduled once it has passed', () => {
  // The date is rendered alongside the claim, so a past date is self-evident.
  // Suppressing it would lose the only fact the league has about its draft.
  const state = selectPreseasonBannerState(
    input({
      draftPhase: 'preview',
      ownersRosterSource: 'csv',
      draftScheduledAt: '2020-01-01T00:00:00.000Z',
    })
  );
  assert.equal(state?.kind, 'draft-scheduled');
});

// ---------------------------------------------------------------------------
// Draft engine phases — observed events outrank every inference
// ---------------------------------------------------------------------------

test('live and paused report the draft engine phase, with the round only when known', () => {
  const live = selectPreseasonBannerState(input({ draftPhase: 'live', draftCurrentRound: 3 }));
  assert.equal(live?.kind, 'draft-live');
  assert.equal(live?.headline, 'Draft is live · Round 3 in progress');

  const liveNoRound = selectPreseasonBannerState(input({ draftPhase: 'live' }));
  assert.equal(liveNoRound?.headline, 'Draft is live');

  const paused = selectPreseasonBannerState(input({ draftPhase: 'paused', draftCurrentRound: 2 }));
  assert.equal(paused?.kind, 'draft-paused');
  assert.equal(paused?.headline, 'Draft paused · Round 2');

  const pausedNoRound = selectPreseasonBannerState(input({ draftPhase: 'paused' }));
  assert.equal(pausedNoRound?.headline, 'Draft paused');
});

test('a live draft outranks an unconfirmed roster', () => {
  // The draft record carries its own owners; a running draft is observed, not
  // inferred, so the roster snapshot cannot contradict it.
  const state = selectPreseasonBannerState(
    input({ draftPhase: 'live', ownersRosterSource: 'none', draftCurrentRound: 1 })
  );
  assert.equal(state?.kind, 'draft-live');
});

test('draft complete shows results until kickoff, then stands down', () => {
  const before = selectPreseasonBannerState(input({ draftPhase: 'complete' }));
  assert.equal(before?.kind, 'draft-complete');
  assert.equal(before?.headline, '2026 Draft complete — view results');

  const after = selectPreseasonBannerState(
    input({ draftPhase: 'complete', week1HasStarted: true })
  );
  assert.equal(after, null);
});

// ---------------------------------------------------------------------------
// Setup complete — the existing durable preseason authority
// ---------------------------------------------------------------------------

test('setupComplete reports readiness for a league that never drafts', () => {
  // `completeSetup` requires owners AND team assignment, so for a manual league
  // this is the last preseason state. There is no draft record to talk about.
  const state = selectPreseasonBannerState(
    input({
      leagueStatus: { state: 'preseason', year: 2026, setupComplete: true },
      ownersRosterSource: 'csv',
    })
  );
  assert.equal(state?.kind, 'ready-for-kickoff');
  assert.equal(state?.headline, '2026 setup complete · Ready for kickoff');
});

test('a stale setupComplete never outranks a roster that is actually gone', () => {
  // `setupComplete` is an operator assertion recorded earlier; the canonical
  // snapshot is the live fact. If the owners it was based on are gone, the
  // truthful state is the earlier one.
  const state = selectPreseasonBannerState(
    input({
      leagueStatus: { state: 'preseason', year: 2026, setupComplete: true },
      ownersRosterSource: 'none',
    })
  );
  assert.equal(state?.kind, 'awaiting-roster');
});

// ---------------------------------------------------------------------------
// Lifecycle boundaries
// ---------------------------------------------------------------------------

test('readiness claims are made only for a league the lifecycle authority calls preseason', () => {
  for (const leagueStatus of [
    { state: 'season', year: 2026 } as const,
    { state: 'offseason' } as const,
    undefined,
  ]) {
    // No draft record — nothing to say.
    assert.equal(selectPreseasonBannerState(input({ leagueStatus })), null);

    // A draft parked in a configuration phase licenses no readiness claim
    // outside preseason either.
    assert.equal(
      selectPreseasonBannerState(
        input({ leagueStatus, draftPhase: 'preview', ownersRosterSource: 'csv' })
      ),
      null
    );

    // A scheduled date does not resurrect the banner outside preseason.
    assert.equal(
      selectPreseasonBannerState(
        input({ leagueStatus, draftPhase: 'preview', draftScheduledAt: '2026-08-20T23:00:00.000Z' })
      ),
      null
    );

    // An in-flight draft is still reported — it is an observed event.
    assert.equal(
      selectPreseasonBannerState(input({ leagueStatus, draftPhase: 'live' }))?.kind,
      'draft-live'
    );
  }
});

test('the banner year comes from the caller, not from the draft record', () => {
  const state = selectPreseasonBannerState(
    input({ leagueStatus: { state: 'preseason', year: 2027 }, bannerYear: 2027 })
  );
  assert.equal(state?.headline, 'Awaiting 2027 roster confirmation · Contact your commissioner');
});
