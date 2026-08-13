import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DraftSummaryClient from '../DraftSummaryClient';
import { draftPicksDigest, type DraftState, type DraftPick } from '@/lib/draft';

// ---------------------------------------------------------------------------
// PLATFORM-094 — the dead end.
//
// "Confirm Draft — Write Rosters to League" is the ONLY caller of
// POST /api/draft/[slug]/[year]/confirm in the app, and it was gated on
// `draft.phase !== 'complete'`. The final pick sets `complete`. So the button
// vanished at the exact moment a draft became publishable, and a draft that
// ended normally could not be published at all — the only route was Reopen
// (back to `live`) then Confirm, which nothing documented and no link pointed
// at, while the same screen said "Ready to complete setup? → Continue Setup".
// ---------------------------------------------------------------------------

const OWNERS = ['Alice', 'Bob'];

function picks(teams: string[] = ['Texas', 'Ohio State']): DraftPick[] {
  return teams.map((team, i) => ({
    pickNumber: i + 1,
    round: 0,
    roundPick: i,
    owner: OWNERS[i]!,
    team,
    pickedAt: '2026-08-01T00:00:00.000Z',
    autoSelected: false,
  }));
}

function draftWith(overrides: Partial<DraftState> = {}): DraftState {
  const base = picks();
  return {
    leagueSlug: 'tsc',
    year: 2026,
    phase: 'complete',
    owners: OWNERS,
    settings: {
      style: 'snake',
      draftOrder: [...OWNERS],
      pickTimerSeconds: 60,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
    picks: base,
    currentPickIndex: 2,
    timerState: 'off',
    timerExpiresAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A draft that has published exactly the picks it currently holds. */
function published(overrides: Partial<DraftState> = {}): DraftState {
  const draft = draftWith(overrides);
  return { ...draft, publishedPicks: draftPicksDigest(draft.picks) };
}

function render(draft: DraftState, isAdmin = true): string {
  return renderToStaticMarkup(
    <DraftSummaryClient
      slug="tsc"
      year={2026}
      initialDraft={draft}
      allTeamNames={['Texas', 'Ohio State', 'Michigan']}
      conferenceMap={{}}
      displayNameMap={{}}
      facts={[]}
      leagueStatus={{ state: 'preseason', year: 2026 }}
      isAdmin={isAdmin}
    />
  );
}

test('a draft that finished its last pick can still be published', () => {
  // The regression: `phase: 'complete'` with nothing published — exactly what
  // the pick route writes on the final selection.
  const html = render(draftWith({ publishedPicks: null }));

  assert.match(html, /Confirm Draft/, 'the publish button is reachable');
  assert.doesNotMatch(html, /Reopen Draft/, 'nothing to reopen — it never published');
});

test('a published draft offers Reopen instead of Confirm', () => {
  const html = render(published());

  assert.match(html, /Reopen Draft/);
  assert.doesNotMatch(html, /Confirm Draft/, 'already published — no second publish');
});

test('a draft whose picks changed since publishing can be published again', () => {
  // How Reset and Undo retract publication without knowing the field exists:
  // the digest is computed over the picks, so changing them stops it matching.
  // The Confirm button returning is the visible consequence — under a flag the
  // app instead claimed the league was ready against the old roster.
  const stale = published();
  const html = render({ ...stale, picks: picks(['Michigan', 'Ohio State']) });

  assert.match(html, /Confirm Draft/, 'the changed draft can be published again');
  assert.doesNotMatch(html, /Reopen Draft/);
});

test('an unfinished draft offers neither control', () => {
  // Mid-draft the summary is a results view, not a publication screen.
  const html = render(draftWith({ phase: 'live', publishedPicks: null }));

  assert.doesNotMatch(html, /Confirm Draft/);
  assert.doesNotMatch(html, /Reopen Draft/);
});

test('neither control is offered to a non-admin', () => {
  const html = render(draftWith({ publishedPicks: null }), false);

  assert.doesNotMatch(html, /Confirm Draft/);
  assert.doesNotMatch(html, /Reopen Draft/);
});
