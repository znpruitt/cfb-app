import assert from 'node:assert/strict';
import test from 'node:test';

import { type DraftPick, type DraftState } from '../../draft.ts';
import { selectTeamAssignment, type TeamAssignmentInput } from '../teamAssignment.ts';
import { draftPicksSignature } from '../draftPublication.ts';

// ---------------------------------------------------------------------------
// PLATFORM-094 — the checklist and the Complete Setup action decided this
// differently: the checklist read `draftPhase === 'complete'`, the action
// checked nothing and relied on a disabled button. One derivation now answers
// it, and these pin the answer.
//
// Two facts the defect turned on:
//   - `complete` fires on the FINAL PICK, before anything is written.
//   - the roster record has writers unrelated to this draft (the repair import,
//     and the demo year-migration that copies one season's roster to the next),
//     so its existence proves nothing about who drafted what.
// ---------------------------------------------------------------------------

const ROSTER = 'team,owner\nTexas,Alice\nOhio State,Bob';

function picks(
  teams: [string, string][] = [
    ['Alice', 'Texas'],
    ['Bob', 'Ohio State'],
  ]
): DraftPick[] {
  return teams.map(([owner, team], i) => ({
    pickNumber: i + 1,
    round: 0,
    roundPick: i,
    owner,
    team,
    pickedAt: '2026-08-01T00:00:00.000Z',
    autoSelected: false,
  }));
}

/** A draft slice. Published means the digest matches the picks it holds. */
type DraftSlice = NonNullable<TeamAssignmentInput['draft']>;

const OWNERS = ['Alice', 'Bob'];
const SETTINGS: DraftState['settings'] = {
  style: 'snake',
  draftOrder: [...OWNERS],
  pickTimerSeconds: null,
  timerExpiryBehavior: 'pause-and-prompt',
  totalRounds: 1,
  scheduledAt: null,
};

function draft(overrides: Partial<DraftSlice> = {}): DraftSlice {
  const base = picks();
  return {
    phase: 'complete',
    picks: base,
    publishedPicks: draftPicksSignature(base),
    owners: [...OWNERS],
    settings: SETTINGS,
    ...overrides,
  };
}

function input(overrides: Partial<TeamAssignmentInput> = {}): TeamAssignmentInput {
  return {
    assignmentMethod: 'draft',
    draft: draft(),
    officialRosterCsv: ROSTER,
    manualAssignmentComplete: undefined,
    ...overrides,
  };
}

test('a published draft with its roster still in place is assigned', () => {
  assert.deepEqual(selectTeamAssignment(input()), { isAssigned: true, blocker: null });
});

test('a complete draft that never published is not assigned', () => {
  // The shape the phase-only check admitted — and the state EVERY draft is in
  // the instant its final pick lands.
  for (const publishedPicks of [null, undefined, '']) {
    const result = selectTeamAssignment(input({ draft: draft({ publishedPicks }) }));
    assert.equal(result.isAssigned, false, JSON.stringify(publishedPicks));
    assert.equal(result.blocker, 'draft-not-published', JSON.stringify(publishedPicks));
  }
});

test('a roster that predates the draft is not proof the draft published it', () => {
  // A current-year owners CSV can exist BEFORE any draft: the repair import at
  // `/admin/{slug}/roster` writes exactly this record, and the demo
  // year-migration copies one season's roster onto the next. The final pick then
  // flips the phase to `complete` without writing anything, and a
  // presence-only check reads that stale roster as the draft's output.
  const result = selectTeamAssignment(
    input({ draft: draft({ publishedPicks: null }), officialRosterCsv: ROSTER })
  );
  assert.equal(result.isAssigned, false);
  assert.equal(result.blocker, 'draft-not-published');
});

test('changing the picks retracts publication, with no writer maintaining it', () => {
  // THE reason publication digests the picks rather than setting a flag.
  // `phase: 'complete'` is not a resting state — Undo last pick, Reset and the
  // pick-timer control are all live on a completed draft. A flag survived all
  // three: reset a published draft, run it again, and the final pick restored
  // `complete` beside a marker pointing at the PREVIOUS draft's roster, so the
  // checklist ticked and Confirm hid itself.
  const published = draft();

  // Reset — picks cleared. The blocker names the REAL next step: this draft has
  // to be run, not published. Phase-first ordering used to answer
  // `draft-not-published` here and route the commissioner at a publish control
  // that had nothing to publish.
  assert.equal(
    selectTeamAssignment(input({ draft: { ...published, picks: [] } })).blocker,
    'draft-incomplete'
  );

  // Undo last pick — one short, so likewise incomplete rather than unpublished.
  assert.equal(
    selectTeamAssignment(input({ draft: { ...published, picks: published.picks.slice(0, 1) } }))
      .blocker,
    'draft-incomplete'
  );

  // A pick edited to a different team.
  const edited = picks([
    ['Alice', 'Michigan'],
    ['Bob', 'Ohio State'],
  ]);
  assert.equal(
    selectTeamAssignment(input({ draft: { ...published, picks: edited } })).blocker,
    'draft-not-published'
  );

  // Re-completing after a reset does not resurrect it: the digest is computed
  // over whatever picks exist now.
  const rerun = picks([
    ['Alice', 'Georgia'],
    ['Bob', 'Oregon'],
  ]);
  assert.equal(
    selectTeamAssignment(input({ draft: { ...published, picks: rerun } })).blocker,
    'draft-not-published'
  );
});

test('publication survives changes that do not touch the picks', () => {
  // The other half, and the reason a timestamp was wrong. The setup screen still
  // offers the pick timer on a COMPLETED draft; under a version keyed to the
  // draft's `updatedAt`, changing it unticked "Teams assigned" and blocked
  // Complete Setup until the commissioner confirmed the draft all over again.
  // The picks are what the roster describes, so only the picks matter.
  const published = draft();
  assert.equal(selectTeamAssignment(input({ draft: { ...published } })).isAssigned, true);
});

test('a published draft whose roster was later blanked is not assigned', () => {
  // Publication records a past event; `PUT /api/owners` can clear the CSV
  // afterwards without touching the draft, so the digest alone outlives its data.
  for (const officialRosterCsv of [null, undefined, '', 'team,owner', 42, { a: 1 }]) {
    const result = selectTeamAssignment(input({ officialRosterCsv }));
    assert.equal(result.isAssigned, false, String(officialRosterCsv));
    assert.equal(result.blocker, 'published-roster-missing', String(officialRosterCsv));
  }
});

test('a roster naming fewer than two real owners is not a published assignment', () => {
  // Same parsing and floor as `selectConfirmedRoster` — NoClaim absorbs
  // unclaimed teams, and one owner holding two teams is one person.
  for (const csv of [
    'team,owner\nTexas,Alice',
    'team,owner\nTexas,Alice\nAir Force,NoClaim',
    'team,owner\nTexas,Alice\nOhio State,Alice',
  ]) {
    assert.equal(selectTeamAssignment(input({ officialRosterCsv: csv })).isAssigned, false, csv);
  }
});

test('an unfinished draft is not assigned, whatever the roster says', () => {
  // Genuinely unfinished — one of the two configured picks made. The phase alone
  // is not what makes a draft incomplete; the missing picks are.
  const partial = picks([['Alice', 'Texas']]);
  for (const phase of ['setup', 'settings', 'preview', 'live', 'paused'] as const) {
    const result = selectTeamAssignment(input({ draft: draft({ phase, picks: partial }) }));
    assert.equal(result.isAssigned, false, phase);
    assert.equal(result.blocker, 'draft-incomplete', phase);
  }
  assert.equal(selectTeamAssignment(input({ draft: null })).blocker, 'draft-incomplete');
});

test('a reopened draft reads as UNPUBLISHED, not incomplete', () => {
  // Reopening moves the phase to `live` while keeping every pick, so the
  // checklist must stop ticking — but calling it "incomplete" is false, and it
  // sent the commissioner to the setup screen when the only publish control is
  // on the summary page. It is a draft awaiting publication, and the blocker
  // says so, which is what routes the link correctly.
  const reopened = draft({ phase: 'live' });
  const result = selectTeamAssignment(input({ draft: reopened }));
  assert.equal(result.isAssigned, false);
  assert.equal(result.blocker, 'draft-not-published');
});

test('a league with no assignment method is not assigned', () => {
  for (const assignmentMethod of [null, undefined] as const) {
    const result = selectTeamAssignment(input({ assignmentMethod }));
    assert.equal(result.isAssigned, false);
    assert.equal(result.blocker, 'no-assignment-method');
  }
});

test('a manual league answers from its own flag, never from the roster', () => {
  // `manualAssignmentComplete` has no writer today, so this is permanently false
  // in practice. Deriving an answer from the roster instead would let a manual
  // league complete setup on assignments nothing recorded.
  const manual = { assignmentMethod: 'manual' as const, draft: null };
  assert.equal(
    selectTeamAssignment(input({ ...manual, manualAssignmentComplete: undefined })).blocker,
    'manual-assignment-incomplete'
  );
  assert.equal(
    selectTeamAssignment(input({ ...manual, manualAssignmentComplete: false })).isAssigned,
    false
  );
  assert.equal(
    selectTeamAssignment(input({ ...manual, manualAssignmentComplete: true })).isAssigned,
    true
  );
  // A usable roster does NOT make a manual league assigned.
  assert.equal(
    selectTeamAssignment(input({ ...manual, officialRosterCsv: ROSTER })).isAssigned,
    false
  );
});

test('a malformed draft record produces a blocker, never a crash', () => {
  // `getAppState` performs no runtime validation — the reason the roster input is
  // typed `unknown` here. The same had to apply to the DRAFT record and briefly
  // did not: `allPicksAreIn` dereferenced `settings.totalRounds` and
  // `owners.length`, so a partial row threw `TypeError`. On the checklist that
  // was swallowed and read as "not assigned"; in `completeSetup` there is no
  // catch, so the commissioner got a raw crash instead of the refusal.
  const shapes: unknown[] = [
    { phase: 'live', picks: [] },
    { phase: 'complete', picks: [] },
    { phase: 'complete' },
    { phase: 'complete', picks: 'not-an-array', owners: 7, settings: null },
    { phase: 'complete', picks: [null, undefined], owners: ['Alice'], settings: {} },
    // Reaches `draftPicksSignature` specifically: a stamp is present, so the
    // publication check gets past its type guard and tries to hash the picks.
    // Mutation proved the shapes above never reach it.
    {
      phase: 'complete',
      publishedPicks: 'a-stamp',
      picks: 'not-an-array',
      owners: ['Alice', 'Bob'],
      settings: { totalRounds: 1 },
    },
    {},
  ];
  for (const shape of shapes) {
    const result = selectTeamAssignment(input({ draft: shape as TeamAssignmentInput['draft'] }));
    assert.equal(result.isAssigned, false, JSON.stringify(shape));
    assert.ok(result.blocker, `a blocker, not a throw: ${JSON.stringify(shape)}`);
  }
});

test('a malformed record cannot MATCH its way to published', () => {
  // Codex P2, and the sharpest shape in this campaign. Making
  // `draftPicksSignature` total was right; the degraded value chosen for it was
  // not — it returned `'[]'`, which is ALSO the honest signature of an empty
  // pick list. So a row of `{ phase: 'complete', publishedPicks: '[]' }` with no
  // picks compared EQUAL and read as published, and with any usable roster
  // present the league reported fully assigned and setup could be completed.
  //
  // The previous malformed-shape test missed it by enumerating shapes without
  // asking which stamp VALUE would defeat the comparison.
  const roster = 'team,owner\nTexas,Alice\nOhio State,Bob';
  for (const publishedPicks of ['[]', JSON.stringify([])]) {
    for (const picks of [undefined, null, 'not-an-array', []]) {
      const result = selectTeamAssignment(
        input({
          draft: {
            phase: 'complete',
            publishedPicks,
            picks,
          } as unknown as TeamAssignmentInput['draft'],
          officialRosterCsv: roster,
        })
      );
      assert.equal(
        result.isAssigned,
        false,
        `stamp ${publishedPicks} vs picks ${JSON.stringify(picks)}`
      );
      assert.equal(result.blocker, 'draft-incomplete');
    }
  }
});

test('the blocker names the step the operator actually has to take', () => {
  // Three situations a single boolean would collapse into one dead end. The
  // ORDER matters: an unfinished draft must not be told to publish, and an
  // unpublished one must not be told its roster is missing.
  assert.equal(
    selectTeamAssignment(
      input({
        draft: draft({ phase: 'live', publishedPicks: null, picks: picks([['Alice', 'Texas']]) }),
        officialRosterCsv: null,
      })
    ).blocker,
    'draft-incomplete'
  );
  assert.equal(
    selectTeamAssignment(input({ draft: draft({ publishedPicks: null }), officialRosterCsv: null }))
      .blocker,
    'draft-not-published'
  );
  assert.equal(
    selectTeamAssignment(input({ officialRosterCsv: null })).blocker,
    'published-roster-missing'
  );
});

// ---------------------------------------------------------------------------
// The digest itself
// ---------------------------------------------------------------------------

test('the digest distinguishes every edit that changes who owns what', () => {
  const base = picks();
  assert.equal(draftPicksSignature(base), draftPicksSignature(picks()), 'deterministic');

  const variants: [string, DraftPick[]][] = [
    ['a removed pick', base.slice(0, 1)],
    ['no picks', []],
    [
      'a different team',
      picks([
        ['Alice', 'Michigan'],
        ['Bob', 'Ohio State'],
      ]),
    ],
    [
      'a different owner',
      picks([
        ['Carol', 'Texas'],
        ['Bob', 'Ohio State'],
      ]),
    ],
    [
      'swapped owners',
      picks([
        ['Bob', 'Texas'],
        ['Alice', 'Ohio State'],
      ]),
    ],
  ];
  for (const [label, variant] of variants) {
    assert.notEqual(draftPicksSignature(variant), draftPicksSignature(base), label);
  }
});

test('the digest ignores metadata that does not change ownership', () => {
  // `pickedAt` and `autoSelected` move when a pick is re-made or auto-selected,
  // but neither changes who owns which team, so neither may retract a valid
  // publication.
  const base = picks();
  const restamped = base.map((p) => ({
    ...p,
    pickedAt: '2027-01-01T00:00:00.000Z',
    autoSelected: true,
  }));
  assert.equal(draftPicksSignature(restamped), draftPicksSignature(base));
});

test('adding a pick cannot collide with editing one', () => {
  const two = draftPicksSignature(picks());
  const three = draftPicksSignature(
    picks([
      ['Alice', 'Texas'],
      ['Bob', 'Ohio State'],
      ['Carol', 'Michigan'],
    ])
  );
  assert.notEqual(two, three);
});

test('two different real drafts never share a signature', () => {
  // Regression for a DEMONSTRATED collision. The signature was a 32-bit FNV-1a
  // hash whose comment claimed it was "practically collision-free for this
  // domain"; review found these two catalog-real pick sets, which both hashed to
  // `3-5a8e6545`. Publish the first, reset, run the draft again into the second,
  // and the retained value matched — so readiness passed against the OLD roster
  // and Confirm stayed hidden. The representation is injective now, so this is
  // not a question of probability.
  const a = picks([
    ['Alice', 'App State'],
    ['Bob', 'Buffalo'],
    ['Carol', 'South Carolina'],
  ]);
  const b = picks([
    ['Alice', 'Arkansas'],
    ['Bob', 'Bowling Green'],
    ['Carol', 'Fresno State'],
  ]);
  assert.notEqual(draftPicksSignature(a), draftPicksSignature(b));
});

test('the signature is unambiguous for names containing its own punctuation', () => {
  // An injective encoding has to survive names that look like delimiters —
  // otherwise "A,B" + "C" and "A" + "B,C" would be indistinguishable.
  const left = picks([
    ['Alice', 'Texas A&M'],
    ['Bob"X', 'Ohio State'],
  ]);
  const right = picks([
    ['Alice', 'Texas A&M'],
    ['Bob', 'X","Ohio State'],
  ]);
  assert.notEqual(draftPicksSignature(left), draftPicksSignature(right));
});

test('a draft with an empty slot is not merely "incomplete"', () => {
  // PLATFORM-096 round 1. Every pick EXISTS; one is temporarily empty, and only
  // the summary editor can show or fill it. Reporting `draft-incomplete` routed
  // the commissioner to the board, where a vacated slot renders exactly like a
  // pick never made and `POST /pick` refuses — the defect PLATFORM-095 closed,
  // reappearing through the correction window this feature opens.
  const base = draft();
  const withHole = { ...base, picks: [base.picks[0]!, { ...base.picks[1]!, team: null }] };

  const result = selectTeamAssignment(input({ draft: withHole }));
  assert.equal(result.isAssigned, false);
  assert.equal(result.blocker, 'draft-has-unassigned-picks');
});

test('a genuinely short draft is still incomplete', () => {
  // The control: the blocker above must come from the HOLE, not from any draft
  // that fails the completeness check.
  const base = draft();
  assert.equal(
    selectTeamAssignment(input({ draft: { ...base, picks: [base.picks[0]!] } })).blocker,
    'draft-incomplete'
  );
});

test('a draft that is BOTH short and holed is reported as short', () => {
  // Order matters. A hole routes to the summary, which is right for a
  // fully-slotted draft mid-correction — but a draft that is genuinely short has
  // its outstanding work on the board, and reporting the hole first sent the
  // commissioner to the wrong page and only surfaced "Finish the draft →" after a
  // second round-trip.
  const base = draft();
  const shortAndHoled = { ...base, picks: [{ ...base.picks[0]!, team: null }] };

  assert.equal(selectTeamAssignment(input({ draft: shortAndHoled })).blocker, 'draft-incomplete');
});
