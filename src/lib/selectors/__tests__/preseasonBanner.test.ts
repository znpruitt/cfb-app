import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatDraftScheduleDetail,
  selectPreseasonBannerState,
  type PreseasonBannerInput,
} from '../preseasonBanner.ts';

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
    currentSeasonOwnerCount: 0,
    assignmentMethod: null,
    draftPhase: null,
    draftScheduledAt: null,
    draftCurrentRound: null,
    bannerYear: 2026,
    week1HasStarted: false,
    ...overrides,
  };
}

/**
 * A confirmed roster is TWO facts, never one. Every call site states both so a
 * source tag can never stand in for an owner count, which is the defect that
 * let a NoClaim-only CSV read as a confirmed roster.
 */
function roster(
  ownersRosterSource: 'csv' | 'preseason-owners',
  currentSeasonOwnerCount = 2
): Partial<PreseasonBannerInput> {
  return { ownersRosterSource, currentSeasonOwnerCount };
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
      input({ draftPhase, ...roster('preseason-owners') })
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
  const confirmed = selectPreseasonBannerState(input({ ...roster('preseason-owners') }));
  assert.equal(confirmed?.kind, 'roster-confirmed');
  assert.equal(confirmed?.headline, 'Roster confirmed · Season setup in progress');

  // `csv` — a real owners roster exists for the preseason year.
  const csv = selectPreseasonBannerState(input({ ...roster('csv') }));
  assert.equal(csv?.kind, 'roster-confirmed');

  // With no draft record at all the banner must not promise a draft: the league
  // may be assigning teams manually.
  assert.doesNotMatch(confirmed!.headline, /[Dd]raft/);
});

test('an unconfirmed roster outranks a scheduled draft date, but does not erase it', () => {
  // A date can be set before owners are confirmed — `owners:{slug}:{year}` is
  // written only when the draft FINISHES, so a commissioner who opens
  // `/league/[slug]/draft/setup` first has a real dated draft and no roster.
  // The roster gap leads, because that is the stage that explains the wait; the
  // date survives as detail rather than as a claim.
  const state = selectPreseasonBannerState(
    input({
      draftPhase: 'preview',
      ownersRosterSource: 'none',
      draftScheduledAt: '2026-08-20T23:00:00.000Z',
    })
  );

  assert.equal(state?.kind, 'awaiting-roster-draft-dated');
  assert.equal(state?.headline, 'Awaiting 2026 roster confirmation');
  assert.doesNotMatch(state!.headline, /[Dd]raft scheduled/);
  assert.equal(
    state?.kind === 'awaiting-roster-draft-dated' ? state.scheduledAt : null,
    '2026-08-20T23:00:00.000Z'
  );
});

test('a NoClaim-only roster is a source without owners, and must not read as confirmed', () => {
  // `resolvePreseason` returns `ownersRosterSource: 'csv'` for a current-year CSV
  // holding only NoClaim rows, while `rows` is empty — pinned by
  // `selectors-leagueStandings.test.ts`. The source tag says WHERE a roster came
  // from; only the owner count says WHETHER there is one.
  const state = selectPreseasonBannerState(input({ ...roster('csv', 0) }));
  assert.equal(state?.kind, 'awaiting-roster');

  // And it must not be rescued by a stale setupComplete either.
  const withSetupComplete = selectPreseasonBannerState(
    input({
      leagueStatus: { state: 'preseason', year: 2026, setupComplete: true },
      ...roster('csv', 0),
    })
  );
  assert.equal(withSetupComplete?.kind, 'awaiting-roster');

  // One real owner is enough; the gate is "any", not a quorum.
  assert.equal(
    selectPreseasonBannerState(input({ ...roster('csv', 1) }))?.kind,
    'roster-confirmed'
  );
});

test('a count without a current-season source proves nothing', () => {
  // The two facts are independent: `archive` carries a perfectly healthy row
  // count for LAST season. Neither fact alone may open the gate.
  const state = selectPreseasonBannerState(
    input({ ownersRosterSource: 'archive', currentSeasonOwnerCount: 12 })
  );
  assert.equal(state?.kind, 'awaiting-roster');

  const noCount = selectPreseasonBannerState(
    input({ ownersRosterSource: 'csv', currentSeasonOwnerCount: undefined })
  );
  assert.equal(noCount?.kind, 'awaiting-roster');
});

// ---------------------------------------------------------------------------
// Assignment method — a draft record is not proof a draft is still the plan
// ---------------------------------------------------------------------------

test('manual assignment silences a stale draft record, dated or not', () => {
  // `setAssignmentMethod` writes only `League.assignmentMethod` and leaves any
  // existing DraftState intact, so a commissioner who configures a draft and
  // then switches to manual leaves `preview` behind. The banner must not keep
  // promising a draft that will never run.
  const dated = selectPreseasonBannerState(
    input({
      assignmentMethod: 'manual',
      ...roster('csv'),
      draftPhase: 'preview',
      draftScheduledAt: '2026-08-20T23:00:00.000Z',
    })
  );
  assert.equal(dated?.kind, 'roster-confirmed');
  assert.doesNotMatch(dated!.headline, /[Dd]raft/);

  const undated = selectPreseasonBannerState(
    input({ assignmentMethod: 'manual', ...roster('csv'), draftPhase: 'preview' })
  );
  assert.equal(undated?.kind, 'roster-confirmed');

  // Manual + no roster still leads with the roster gap, and no penciled-in date.
  const noRoster = selectPreseasonBannerState(
    input({
      assignmentMethod: 'manual',
      draftPhase: 'preview',
      draftScheduledAt: '2026-08-20T23:00:00.000Z',
    })
  );
  assert.equal(noRoster?.kind, 'awaiting-roster');
});

test('an explicit draft method and an undecided one both let the draft record speak', () => {
  for (const assignmentMethod of ['draft', null, undefined] as const) {
    const state = selectPreseasonBannerState(
      input({
        assignmentMethod,
        ...roster('csv'),
        draftPhase: 'preview',
        draftScheduledAt: '2026-08-20T23:00:00.000Z',
      })
    );
    assert.equal(state?.kind, 'draft-scheduled', String(assignmentMethod));
  }
});

test('manual assignment never suppresses a draft that is actually running', () => {
  // Live/paused/complete are observed events. Whatever the method now says, the
  // draft in front of the league is real.
  assert.equal(
    selectPreseasonBannerState(input({ assignmentMethod: 'manual', draftPhase: 'live' }))?.kind,
    'draft-live'
  );
  assert.equal(
    selectPreseasonBannerState(input({ assignmentMethod: 'manual', draftPhase: 'complete' }))?.kind,
    'draft-complete'
  );
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
      ...roster('preseason-owners'),
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
      input({ ...roster('csv'), draftPhase: 'preview', draftScheduledAt })
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
      ...roster('csv'),
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
// `setupComplete` is NOT an input, and there is no readiness state.
//
// An earlier version had `ready-for-kickoff`, justified as the last preseason
// stage for a league that assigns teams manually. That flow does not exist:
// `League.manualAssignmentComplete` is read by the admin checklist and written
// NOWHERE, so a manual league can never reach `teamsAssigned`. Two review
// rounds each found a different live signal the flag outlived — a reset draft
// phase, then a method switch — which is the signal that the INPUT was wrong
// rather than a guard missing.
//
// These tests pin the ABSENCE of the claim across every shape that used to
// produce it, so reinstating it means confronting them.
// ---------------------------------------------------------------------------

const SETUP_COMPLETE = { state: 'preseason', year: 2026, setupComplete: true } as const;

test('a recorded setupComplete never produces a readiness claim on its own', () => {
  // Was `ready-for-kickoff`. A league with owners and no draft is mid-setup as
  // far as any fact the banner can see.
  const noDraft = selectPreseasonBannerState(
    input({ leagueStatus: SETUP_COMPLETE, ...roster('csv') })
  );
  assert.equal(noDraft?.kind, 'roster-confirmed');
  assert.doesNotMatch(noDraft!.headline, /[Rr]eady for kickoff/);
  assert.doesNotMatch(noDraft!.headline, /setup complete/);

  // The flag changes nothing: same league without it lands identically.
  const withoutFlag = selectPreseasonBannerState(
    input({ leagueStatus: PRESEASON_2026, ...roster('csv') })
  );
  assert.deepEqual(noDraft, withoutFlag);
});

test('a draft reset does not leave a readiness claim behind', () => {
  // `POST /api/draft/[slug]/[year]/reset` accepts a COMPLETE draft, returns it
  // to `setup`, and clears its picks, while nothing clears `setupComplete`.
  for (const draftPhase of ['setup', 'settings', 'preview'] as const) {
    const state = selectPreseasonBannerState(
      input({
        leagueStatus: SETUP_COMPLETE,
        ...roster('csv'),
        assignmentMethod: 'draft',
        draftPhase,
      })
    );
    assert.equal(state?.kind, 'draft-unscheduled', draftPhase);
    assert.doesNotMatch(state!.headline, /[Rr]eady for kickoff/, draftPhase);
  }
});

test('switching to manual after completing a draft does not claim readiness', () => {
  // `setAssignmentMethod` preserves `setupComplete` while
  // `manualAssignmentComplete` stays false, so the admin checklist computes
  // `teamsAssigned === false`. The banner must not disagree with it.
  const state = selectPreseasonBannerState(
    input({
      leagueStatus: SETUP_COMPLETE,
      ...roster('csv'),
      assignmentMethod: 'manual',
      draftPhase: 'preview',
    })
  );
  assert.equal(state?.kind, 'roster-confirmed');
  assert.equal(state?.headline, 'Roster confirmed · Season setup in progress');
  assert.doesNotMatch(state!.headline, /[Rr]eady for kickoff/);
  // Manual still silences the stale draft record — that guard is unaffected.
  assert.doesNotMatch(state!.headline, /[Dd]raft/);
});

test('a recorded setupComplete never outranks a roster that is actually gone', () => {
  const state = selectPreseasonBannerState(
    input({ leagueStatus: SETUP_COMPLETE, ownersRosterSource: 'none' })
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
      selectPreseasonBannerState(input({ leagueStatus, draftPhase: 'preview', ...roster('csv') })),
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

// ---------------------------------------------------------------------------
// The date detail. `formatDateTime` is injected so the JOIN — the part that
// decides what a member actually reads — is provable without pinning
// `toLocaleString`, whose output varies by locale, timezone, and ICU build.
// This arm previously had no test at any layer: the selector test stopped at
// `scheduledAt`, and the component test cannot reach it because the draft facts
// arrive from a client fetch effect that never runs under static rendering.
// ---------------------------------------------------------------------------

const AT = '2026-08-20T23:00:00.000Z';
const stamp = (): string => 'Aug 20, 2026, 7:00 PM';

test('a firm draft date renders the date, and the countdown only when there is one', () => {
  const scheduled = selectPreseasonBannerState(
    input({ ...roster('csv'), draftPhase: 'preview', draftScheduledAt: AT })
  )!;

  assert.equal(
    formatDraftScheduleDetail({
      state: scheduled,
      formatDateTime: stamp,
      countdown: '3 days away',
    }),
    ' · Aug 20, 2026, 7:00 PM · 3 days away'
  );

  // A past date yields no countdown; the date still stands alone, never `TBD`.
  assert.equal(
    formatDraftScheduleDetail({ state: scheduled, formatDateTime: stamp, countdown: null }),
    ' · Aug 20, 2026, 7:00 PM'
  );
});

test('a penciled-in date is shown as provisional and never counts down', () => {
  // Counting down would restate the certainty the roster gate just withheld.
  const penciled = selectPreseasonBannerState(
    input({ draftPhase: 'preview', draftScheduledAt: AT })
  )!;
  assert.equal(penciled.kind, 'awaiting-roster-draft-dated');

  assert.equal(
    formatDraftScheduleDetail({
      state: penciled,
      formatDateTime: stamp,
      countdown: '3 days away',
    }),
    ' · Draft penciled in for Aug 20, 2026, 7:00 PM'
  );
});

test('states that carry no date produce no detail', () => {
  for (const state of [
    selectPreseasonBannerState(input())!,
    selectPreseasonBannerState(input({ ...roster('csv') }))!,
    selectPreseasonBannerState(input({ ...roster('csv'), draftPhase: 'preview' }))!,
    selectPreseasonBannerState(input({ draftPhase: 'live' }))!,
    selectPreseasonBannerState(input({ draftPhase: 'complete' }))!,
  ]) {
    assert.equal(
      formatDraftScheduleDetail({ state, formatDateTime: stamp, countdown: '3 days away' }),
      null,
      state.kind
    );
  }
});
