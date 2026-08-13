import assert from 'node:assert/strict';
import test from 'node:test';

import { draftPicksDigest, type DraftPick, type DraftState } from '../../draft.ts';
import { selectTeamAssignment, type TeamAssignmentInput } from '../teamAssignment.ts';

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
function draft(
  overrides: Partial<Pick<DraftState, 'phase' | 'picks' | 'publishedPicks'>> = {}
): Pick<DraftState, 'phase' | 'picks' | 'publishedPicks'> {
  const base = picks();
  return {
    phase: 'complete',
    picks: base,
    publishedPicks: draftPicksDigest(base),
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

  // Reset — picks cleared.
  assert.equal(
    selectTeamAssignment(input({ draft: { ...published, picks: [] } })).blocker,
    'draft-not-published'
  );

  // Undo last pick — one fewer.
  assert.equal(
    selectTeamAssignment(input({ draft: { ...published, picks: published.picks.slice(0, 1) } }))
      .blocker,
    'draft-not-published'
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
  for (const phase of ['setup', 'settings', 'preview', 'live', 'paused'] as const) {
    const result = selectTeamAssignment(input({ draft: draft({ phase }) }));
    assert.equal(result.isAssigned, false, phase);
    assert.equal(result.blocker, 'draft-incomplete', phase);
  }
  assert.equal(selectTeamAssignment(input({ draft: null })).blocker, 'draft-incomplete');
});

test('a reopened draft is not assigned even though its picks are unchanged', () => {
  // Reopening moves the phase to `live` while the previously confirmed roster
  // deliberately stays in effect. The picks still match the digest, so the phase
  // is what says "this is being edited" — and the checklist must stop ticking.
  const reopened = draft({ phase: 'live' });
  assert.equal(selectTeamAssignment(input({ draft: reopened })).blocker, 'draft-incomplete');
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

test('the blocker names the step the operator actually has to take', () => {
  // Three situations a single boolean would collapse into one dead end. The
  // ORDER matters: an unfinished draft must not be told to publish, and an
  // unpublished one must not be told its roster is missing.
  assert.equal(
    selectTeamAssignment(
      input({ draft: draft({ phase: 'live', publishedPicks: null }), officialRosterCsv: null })
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
  assert.equal(draftPicksDigest(base), draftPicksDigest(picks()), 'deterministic');

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
    assert.notEqual(draftPicksDigest(variant), draftPicksDigest(base), label);
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
  assert.equal(draftPicksDigest(restamped), draftPicksDigest(base));
});

test('adding a pick cannot collide with editing one', () => {
  // The pick COUNT is carried alongside the hash precisely so a longer draft can
  // never be mistaken for a re-ordered one of the same length.
  const two = draftPicksDigest(picks());
  const three = draftPicksDigest(
    picks([
      ['Alice', 'Texas'],
      ['Bob', 'Ohio State'],
      ['Carol', 'Michigan'],
    ])
  );
  assert.notEqual(two, three);
  assert.match(two, /^2-/);
  assert.match(three, /^3-/);
});
