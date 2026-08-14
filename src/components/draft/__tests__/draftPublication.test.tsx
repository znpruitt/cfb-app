import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DraftSummaryClient from '../DraftSummaryClient';
import DraftHeaderArea from '../DraftHeaderArea';
import { type DraftState, type DraftPick } from '@/lib/draft';
import { draftPicksSignature } from '@/lib/selectors/draftPublication';

// ---------------------------------------------------------------------------
// PLATFORM-095 — the label is exactly `Confirm draft`, matched precisely rather
// than loosely. The owner ruled it must not say "review": the review IS the
// page, so a button asking the reader to review what they are looking at is
// noise. Pinning the exact string means a silent rename fails here.
//
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

function render(
  draft: DraftState,
  isAdmin = true,
  opts: { publishedRosterExists?: boolean } = {}
): string {
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
      publishedRosterExists={opts.publishedRosterExists ?? true}
      isAdmin={isAdmin}
    />
  );
}

test('a draft that finished its last pick can still be published', () => {
  // The regression: `phase: 'complete'` with nothing published — exactly what
  // the pick route writes on the final selection.
  const html = render(draftWith({ publishedPicks: null }));

  assert.match(html, /Confirm draft/, 'the publish button is reachable');
  assert.doesNotMatch(html, /Reopen draft/, 'nothing to reopen — it never published');
});

test('a published draft offers Reopen instead of Confirm', () => {
  const html = render(published());

  assert.match(html, /Reopen draft/);
  assert.doesNotMatch(html, /Confirm draft/, 'already published — no second publish');
});

test('a draft whose picks changed since publishing can be published again', () => {
  // How Reset and Undo retract publication without knowing the field exists:
  // the digest is computed over the picks, so changing them stops it matching.
  // The Confirm button returning is the visible consequence — under a flag the
  // app instead claimed the league was ready against the old roster.
  const stale = published();
  const html = render({ ...stale, picks: picks(['Michigan', 'Ohio State']) });

  assert.match(html, /Confirm draft/, 'the changed draft can be published again');
  assert.doesNotMatch(html, /Reopen draft/);
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

  assert.doesNotMatch(html, /Confirm draft/, '1 of 2 picks made');
  assert.doesNotMatch(html, /Reopen draft/);
});

test('a REOPENED draft can still be published', () => {
  // Both reviewers, P1/HIGH. Reopen preserves every pick and sets `phase: 'live'`,
  // so a condition requiring `complete` withheld Confirm, while Reopen was
  // withheld because publication had lapsed — leaving NEITHER control on the
  // only screen that can call POST /confirm. A commissioner who reopened to fix
  // one pick had no way back: the same dead end this work exists to remove.
  const reopened = { ...published(), phase: 'live' as const };
  const html = render(reopened);

  assert.match(html, /Confirm draft/, 'the way back to publication is open');
  assert.doesNotMatch(html, /Reopen draft/, 'already reopened');
});

test('a reopened draft whose picks were then edited can still be published', () => {
  // The realistic sequence: reopen, fix a pick, publish. The edit deliberately
  // does NOT rewrite live ownership, so Confirm is the only thing that can.
  const reopened = {
    ...published(),
    phase: 'live' as const,
    picks: picks(['Michigan', 'Ohio State']),
  };

  assert.match(render(reopened), /Confirm draft/);
});

test('neither control is offered to a non-admin', () => {
  const html = render(draftWith({ publishedPicks: null }), false);

  assert.doesNotMatch(html, /Confirm draft/);
  assert.doesNotMatch(html, /Reopen draft/);
});

test('a published draft whose roster was cleared can be published again', () => {
  // Review finding. `PUT /api/owners` can blank `owners:{slug}:{year}` without
  // touching the draft, and the picks still match their signature — so the draft
  // read as published, Confirm stayed hidden, and the checklist blocked setup
  // with `published-roster-missing`, a blocker whose stated next step had no
  // control that performed it. Recovery was Reopen then Confirm: the two-step
  // workaround this work exists to remove.
  const html = render(published(), true, { publishedRosterExists: false });

  assert.match(html, /Confirm draft/, 'the way to restore the roster is offered');
  assert.doesNotMatch(html, /Reopen draft/, 'there is nothing to reopen');
});

test('a published draft with its roster intact still offers only Reopen', () => {
  // The control: the same render with the roster present must NOT offer Confirm,
  // so the test above is pinning the roster fact rather than passing vacuously.
  const html = render(published(), true, { publishedRosterExists: true });

  assert.match(html, /Reopen draft/);
  assert.doesNotMatch(html, /Confirm draft/);
});

// ---------------------------------------------------------------------------
// PLATFORM-095 — "Continue Setup" appears only AFTER publication.
//
// Found by the owner walking a two-round draft on preview: the flow worked, but
// the post-draft surfaces offered the after-you-are-finished action before the
// commissioner had finished, and following it landed on a checklist that could
// not proceed. Every surface points at Confirm until the results are published.
// ---------------------------------------------------------------------------

test('the summary page offers Continue Setup only once published', () => {
  // It sat directly beneath the Confirm button and pointed away from it.
  assert.doesNotMatch(
    render(draftWith({ publishedPicks: null })),
    /Continue Setup/,
    'unpublished: the only thing to do here is confirm'
  );
  assert.match(render(published()), /Continue Setup/, 'published: setup is genuinely next');
});

test('the summary banner says the results are not yet the rosters', () => {
  // The publish control moved to the top of the page, and it carries the reason
  // it is there — a finished draft is not a published one.
  const html = render(draftWith({ publishedPicks: null }));
  assert.match(html, /not yet the league&#x2019;s rosters|not yet the league’s rosters/);
  assert.match(html, /Confirm draft/);
});

test('the draft board banner offers Continue Setup only once published', () => {
  const header = (draft: DraftState): string =>
    renderToStaticMarkup(
      <DraftHeaderArea
        draft={draft}
        isAdmin
        slug="tsc"
        leagueStatus={{ state: 'preseason', year: 2026 }}
        localTimerStartRef={{ current: null }}
        onPause={() => {}}
        onResume={() => {}}
        onUndo={() => {}}
        onAutoPick={() => {}}
        onSelectManually={() => {}}
        onStartRound={() => {}}
        summaryHref="/league/tsc/draft/summary"
      />
    );

  const unpublished = header(draftWith({ publishedPicks: null }));
  assert.doesNotMatch(unpublished, /Continue Setup/, 'the road to nowhere is closed');
  assert.match(unpublished, /View Draft Summary/, 'and the way forward is offered');
  assert.match(
    unpublished,
    /Draft complete — confirm the results to assign teams/,
    'the banner names the action, not a status qualifier'
  );

  assert.match(header(published()), /Continue Setup/, 'published: setup is genuinely next');
});

test('confirming redirects somewhere that EXISTS', () => {
  // The bug the owner found in ~90 seconds of clicking, live since long before
  // this campaign: `handleConfirm` sent the browser to `/league/{slug}/overview`,
  // and there is no `overview` route — the league root is `/league/{slug}`. So
  // the final step of publishing always landed on a 404. Nobody hit it because
  // until PLATFORM-094 the Confirm button was unreachable, so the dead end hid
  // the broken landing behind it.
  //
  // Structural, because the redirect is a `window.location` assignment inside an
  // async handler that this static harness cannot fire. Pinned against the ROUTE
  // TREE so it fails if either the target or the routes move.
  const source = readFileSync(new URL('../DraftSummaryClient.tsx', import.meta.url), 'utf8');
  const targets = [...source.matchAll(/window\.location\.href =\s*([^;]+);/g)].map((m) => m[1]!);
  assert.ok(targets.length > 0, 'the confirm handler navigates somewhere');

  assert.ok(
    !targets.some((t) => t.includes('/overview')),
    'no route named `overview` exists under /league/[slug]'
  );
  for (const dir of ['admin/[slug]/preseason', 'league/[slug]']) {
    assert.ok(
      existsSync(new URL(`../../../app/${dir}/page.tsx`, import.meta.url)),
      `redirect target /${dir} must exist as a route`
    );
  }
  assert.match(
    targets.join(' '),
    /admin\/\$\{slug\}\/preseason/,
    'preseason returns to the checklist'
  );
});

test('the pick editor renders on the row being edited', () => {
  // Structural. The editor was a section near the page bottom, so clicking Edit
  // on a pick near the top answered off-screen — reported as "the edit button
  // does nothing". Firing the click needs a DOM harness this suite does not
  // have, so what is pinned is that the editor is rendered from inside the pick
  // table rather than as a sibling of it.
  const source = readFileSync(new URL('../DraftSummaryClient.tsx', import.meta.url), 'utf8');
  const tbody = source.slice(source.indexOf('<tbody>'), source.indexOf('</tbody>'));
  assert.match(tbody, /editingPickNumber === pick\.pickNumber/, 'gated per row');
  assert.match(tbody, /renderPickEditor\(\)/, 'and rendered inside the table');
});

test('a reopened draft is not told its rosters are gone', () => {
  // Reopen keeps the published CSV live until re-confirmation — the reopen
  // dialog on this same page says so. The banner told the commissioner the
  // opposite: "these results are not yet the league's rosters".
  const reopened = { ...published(), phase: 'live' as const };
  const html = render(reopened);

  assert.match(html, /Draft reopened — confirm again to apply your changes/);
  assert.doesNotMatch(html, /not yet the league/);
});

test('a never-published draft still says its results are not the rosters', () => {
  // The control for the test above: the original copy has to survive where it
  // is true, or the fix would just be a blanket rewrite.
  assert.match(render(draftWith({ publishedPicks: null })), /not yet the league/);
});

test('a spectator is not handed a commissioner instruction', () => {
  // `SpectatorBoardClient` mounts this header with no `isAdmin`, so the public
  // was reading "confirm the results to assign teams" — an action they cannot
  // take — and losing the pick count to get it.
  const header = (isAdmin: boolean): string =>
    renderToStaticMarkup(
      <DraftHeaderArea
        draft={draftWith({ publishedPicks: null })}
        isAdmin={isAdmin}
        slug="tsc"
        leagueStatus={{ state: 'preseason', year: 2026 }}
        localTimerStartRef={{ current: null }}
        onPause={() => {}}
        onResume={() => {}}
        onUndo={() => {}}
        onAutoPick={() => {}}
        onSelectManually={() => {}}
        onStartRound={() => {}}
        summaryHref="/league/tsc/draft/summary"
      />
    );

  assert.match(header(false), /all 2 picks made/, 'spectators keep the factual line');
  assert.doesNotMatch(header(false), /confirm the results/);
  assert.match(
    header(true),
    /confirm the results to assign teams/,
    'the commissioner still gets it'
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-096 — the editor can express the correction a commissioner needs.
// ---------------------------------------------------------------------------

test('the picker offers held teams, and names who holds them', () => {
  // Structural: the picker renders only while a pick is being edited, which this
  // static harness cannot trigger. What is checkable is that the candidate list
  // is no longer filtered by who holds a team — the filter was what made a
  // mis-entered draft uncorrectable — and that each entry carries its holder.
  const source = readFileSync(new URL('../DraftSummaryClient.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /pickedTeamsLower/, 'held teams are no longer filtered out');
  assert.match(source, /holderByTeam\.get\(name\.toLowerCase\(\)\) \?\? null/);
  assert.match(source, /\{heldBy\}\s*<\/span>/, 'and the holder is named');
  assert.match(
    source,
    /\(conferenceMap\[lower\] \?\? ''\)\.toLowerCase\(\)\.includes\(searchLower\)/,
    'search matches conference, as the draft board always has'
  );
});

test('an unassigned slot reads as unassigned, and blocks publication', () => {
  const withHole = draftWith({
    publishedPicks: null,
    picks: [picks()[0]!, { ...picks()[1]!, team: null }],
  });
  const html = render(withHole);

  // The chip, not italics: `DESIGN.md` reserves amber for champion/podium and
  // blue for interactivity, and says to reach for type before pigment when a
  // surface reads flat. A bordered token among plain names carries the weight.
  assert.match(html, /border-dashed[^"]*"[^>]*>\s*Unassigned/, 'the empty slot is a chip');
  assert.doesNotMatch(html, /Confirm draft/, 'and cannot be published');
});

test('a full draft can still be published', () => {
  // Control: the block above must come from the hole, not from the render.
  assert.match(render(draftWith({ publishedPicks: null })), /Confirm draft/);
});

test('a draft mid-correction says so, rather than showing nothing', () => {
  // The third state. `canPublish` is false because of the hole and `canReopen`
  // false because it never published, so the page rendered NO banner — the only
  // indication was one table row reading "Unassigned". A state with no control
  // and no explanation is the defect this campaign removes, and this one is
  // created by the correction feature itself.
  const withHole = draftWith({
    publishedPicks: null,
    picks: [picks()[0]!, { ...picks()[1]!, team: null }],
  });
  const html = render(withHole);

  assert.match(html, /Draft unfinished/);
  assert.match(html, /Every pick needs a team before this draft can be confirmed/);
  assert.doesNotMatch(html, /Confirm draft/, 'and still cannot be published');
});
