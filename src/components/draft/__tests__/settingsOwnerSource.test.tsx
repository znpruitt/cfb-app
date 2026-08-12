import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DraftSettingsPanel from '../DraftSettingsPanel';
import OwnerConfirmationShell from '../../../app/admin/[slug]/preseason/owners/OwnerConfirmationShell';
import type { DraftState } from '@/lib/draft';

// ---------------------------------------------------------------------------
// PLATFORM-092 — these two components are where the gate's remedies live, and
// both were changed without coverage. A mutation run proved it: reverting the
// settings panel to read the draft's stale owner copy left the entire suite
// green, even though that revert restores the P1 both reviewers reported —
// "reopen settings to pick up the roster" being the one path that could not.
//
// Server tests cannot reach either: they exercise the route, and the defect is
// which list the SCREEN submits.
// ---------------------------------------------------------------------------

function draftWith(owners: string[]): DraftState {
  return {
    leagueSlug: 'tsc',
    year: 2026,
    phase: 'settings',
    owners,
    settings: {
      style: 'snake',
      draftOrder: [...owners],
      pickTimerSeconds: 60,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
    picks: [],
    currentPickIndex: 0,
    timerState: 'off',
    timerExpiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

test("the settings panel shows the CONFIRMED ROSTER, not the draft's stored copy", () => {
  // The reconciliation path: the draft was created for [Alice, Bob], the
  // commissioner has since confirmed [Alice, Bob, Carol], and reopening settings
  // is what is supposed to pick that up. Reading `draftState.owners` here made
  // the screen re-submit the old set and its old order, which the server — having
  // just re-derived owners from the roster — then rejected.
  const html = renderToStaticMarkup(
    <DraftSettingsPanel
      slug="tsc"
      year={2026}
      draftState={draftWith(['Alice', 'Bob'])}
      priorOwners={['Alice', 'Bob', 'Carol']}
      priorChampOrder={null}
      fbsTeamCount={136}
      onAdvance={() => {}}
    />
  );

  // `detectInitialMode` returns 'manual' for a non-empty stored draftOrder, so
  // the manual-order list renders — that list is built from `owners`, which is
  // exactly the value under test.
  assert.match(html, /Carol/, 'the newly confirmed owner must appear in the order list');
});

test('the settings panel falls back to the draft when no roster is supplied', () => {
  // Defensive: a caller that cannot resolve a roster still renders the draft it
  // has rather than an empty owner list.
  const html = renderToStaticMarkup(
    <DraftSettingsPanel
      slug="tsc"
      year={2026}
      draftState={draftWith(['Alice', 'Bob'])}
      priorOwners={[]}
      priorChampOrder={null}
      fbsTeamCount={136}
      onAdvance={() => {}}
    />
  );

  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
});

/**
 * Whether the SAVE button specifically is disabled.
 *
 * A bare `/disabled/` match is useless here — Cancel carries the attribute too,
 * so the assertion passed even with the rule reverted. Isolate the button that
 * owns the Save label.
 */
function saveButtonDisabled(html: string): boolean {
  const label = html.indexOf('>Save<');
  assert.notEqual(label, -1, 'Save button not found');
  const openingTag = html.lastIndexOf('<button', label);
  // The ATTRIBUTE, not the substring: the enabled variant's className carries
  // Tailwind's `disabled:opacity-50`, which made a naive `includes('disabled')`
  // report every state as disabled — and pass while the rule was reverted.
  return html.slice(openingTag, label).includes('disabled=""');
}

test('the confirm-owners Save button applies the same rule the Server Action does', () => {
  // `initialOwners` loads a previously saved list verbatim, and the pre-092
  // action validated nothing but length — so a stored list holding a duplicate or
  // `NoClaim` could reach an enabled Save and throw with no error surface.
  const blocked = renderToStaticMarkup(
    <OwnerConfirmationShell slug="tsc" year={2026} initialOwners={['Alice', 'NoClaim']} />
  );
  assert.match(blocked, /Cannot save/);
  assert.match(blocked, /reserved for unclaimed teams/);
  assert.equal(saveButtonDisabled(blocked), true, 'NoClaim must disable Save');

  const duplicate = renderToStaticMarkup(
    <OwnerConfirmationShell slug="tsc" year={2026} initialOwners={['Alice', 'Alice']} />
  );
  assert.match(duplicate, /listed more than once/);
  assert.equal(saveButtonDisabled(duplicate), true, 'a duplicate must disable Save');

  const ok = renderToStaticMarkup(
    <OwnerConfirmationShell slug="tsc" year={2026} initialOwners={['Alice', 'Bob']} />
  );
  assert.doesNotMatch(ok, /Cannot save/);
  assert.equal(saveButtonDisabled(ok), false, 'a valid list must leave Save enabled');
});

test('a departed owner drops out of the order, and the rest keep their sequence', () => {
  // The commissioner's chosen sequence is worth preserving for everyone still on
  // the roster; only the difference should move.
  const draft = draftWith(['Alice', 'Bob', 'Carol']);
  const html = renderToStaticMarkup(
    <DraftSettingsPanel
      slug="tsc"
      year={2026}
      draftState={{
        ...draft,
        settings: { ...draft.settings, draftOrder: ['Carol', 'Alice', 'Bob'] },
      }}
      priorOwners={['Carol', 'Alice', 'Dave']}
      priorChampOrder={null}
      fbsTeamCount={136}
      onAdvance={() => {}}
    />
  );

  assert.match(html, /Dave/, 'the newly confirmed owner is appended');
  assert.doesNotMatch(html, /Bob/, 'the departed owner is gone');
  // Carol kept her first position rather than the list being rebuilt from scratch.
  assert.ok(html.indexOf('Carol') < html.indexOf('Alice'), 'existing sequence preserved');
});
