import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DraftSummaryClient from '../DraftSummaryClient';
import { type DraftState, type DraftPick } from '@/lib/draft';
import { draftPicksSignature } from '@/lib/selectors/draftPublication';

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
  return { ...draft, publishedPicks: draftPicksSignature(draft.picks) };
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

test('a draft with picks still outstanding offers neither control', () => {
  // Mid-draft the summary is a results view, not a publication screen. The test
  // that stood here seeded a `live` draft with a FULL pick set and asserted no
  // controls — which described the reopen dead end rather than an unfinished
  // draft, and passed while the bug was live. What makes a draft publishable is
  // that every configured pick is in.
  const html = render(
    draftWith({
      phase: 'live',
      publishedPicks: null,
      picks: picks(['Texas']),
      settings: {
        style: 'snake',
        draftOrder: [...OWNERS],
        pickTimerSeconds: 60,
        timerExpiryBehavior: 'pause-and-prompt',
        totalRounds: 1,
        scheduledAt: null,
      },
    })
  );

  assert.doesNotMatch(html, /Confirm Draft/, '1 of 2 picks made');
  assert.doesNotMatch(html, /Reopen Draft/);
});

test('a REOPENED draft can still be published', () => {
  // Both reviewers, P1/HIGH. Reopen preserves every pick and sets `phase: 'live'`,
  // so a condition requiring `complete` withheld Confirm, while Reopen was
  // withheld because publication had lapsed — leaving NEITHER control on the
  // only screen that can call POST /confirm. A commissioner who reopened to fix
  // one pick had no way back: the same dead end this work exists to remove.
  const reopened = { ...published(), phase: 'live' as const };
  const html = render(reopened);

  assert.match(html, /Confirm Draft/, 'the way back to publication is open');
  assert.doesNotMatch(html, /Reopen Draft/, 'already reopened');
});

test('a reopened draft whose picks were then edited can still be published', () => {
  // The realistic sequence: reopen, fix a pick, publish. The edit deliberately
  // does NOT rewrite live ownership, so Confirm is the only thing that can.
  const reopened = {
    ...published(),
    phase: 'live' as const,
    picks: picks(['Michigan', 'Ohio State']),
  };

  assert.match(render(reopened), /Confirm Draft/);
});

test('neither control is offered to a non-admin', () => {
  const html = render(draftWith({ publishedPicks: null }), false);

  assert.doesNotMatch(html, /Confirm Draft/);
  assert.doesNotMatch(html, /Reopen Draft/);
});
