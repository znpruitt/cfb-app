import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { beforeEach } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

import { addLeague } from '@/lib/leagueRegistry';
import { savePreseasonOwners } from '@/lib/preseasonOwnerStore';
import {
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';

import { draftScope, type DraftPick } from '@/lib/draft';
import { resolveDraftSetupGate } from '../setup/draftSetupGate';
import PreseasonPage from '../../../../admin/[slug]/preseason/page';
import { draftPicksSignature } from '@/lib/selectors/draftPublication';

// ---------------------------------------------------------------------------
// PLATFORM-092 — AGENTS.md: "Every surface a PR touches must carry its own
// tests... if deleting the new guard leaves the suite green, the guard is not in
// the PR's acceptance contract."
//
// HONEST LIMIT: the draft-setup RSC is NOT rendered here. It is gated by
// `canAccessDraftBoard` → `isPlatformAdminSession`, which has no authorizing
// path without a Request, so rendering it under this runner only ever produces
// `NEXT_REDIRECT`. Its decision lives in `setup/draftSetupGate.ts` and is pinned
// below; the JSX consuming it is not covered, and this note exists so that is
// not mistaken for coverage.
// ---------------------------------------------------------------------------

const SLUG = 'gate-surface-league';
const YEAR = 2026;

async function seedLeague(): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Gate Surface League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: YEAR },
    assignmentMethod: 'draft',
  });
}

async function renderChecklist(): Promise<string> {
  const page = (await PreseasonPage({ params: Promise.resolve({ slug: SLUG }) })) as ReactElement;
  return renderToStaticMarkup(page);
}

/**
 * The ✓/○ marker belonging to ONE checklist row.
 *
 * A proximity regex (`/✓[\s\S]{0,400}Teams assigned/`) does not work here and
 * passes in both directions: every row carries a marker, so the ✓ from "Owners
 * confirmed" sits well inside any window that reaches "Teams assigned". The
 * marker immediately BEFORE the label is the row's own.
 */
function markerFor(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  assert.ok(at > 0, `checklist row "${label}" not rendered`);
  const before = html.slice(0, at);
  return before.lastIndexOf('✓') > before.lastIndexOf('○') ? '✓' : '○';
}

function picksFor(teams: string[]): DraftPick[] {
  return teams.map((team, i) => ({
    pickNumber: i + 1,
    round: 0,
    roundPick: i,
    owner: ['Alice', 'Bob'][i]!,
    team,
    pickedAt: '2026-08-01T00:00:00.000Z',
    autoSelected: false,
  }));
}

test('the checklist ticks Teams assigned only when the draft PUBLISHED', async () => {
  // PLATFORM-094 — `draftPhase === 'complete'` alone was not evidence: it fires
  // on the final pick, while the roster is written separately at confirmation.
  // This checklist ticked for that, letting setup be completed for a league
  // whose teams were never assigned to anyone.
  await seedLeague();
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  const picks = picksFor(['Texas', 'Ohio State']);
  await setAppState(draftScope(SLUG), String(YEAR), {
    phase: 'complete',
    picks,
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake',
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
  });

  assert.equal(
    markerFor(await renderChecklist(), 'Teams assigned'),
    '○',
    'a complete draft that never published is NOT assigned'
  );

  // A roster alone does not tick it either — this CSV could be a repair import
  // that predates the draft and describes assignments it never made.
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nOhio State,Bob');
  assert.equal(
    markerFor(await renderChecklist(), 'Teams assigned'),
    '○',
    'a roster the draft did not publish is not evidence'
  );

  await setAppState(draftScope(SLUG), String(YEAR), {
    phase: 'complete',
    picks,
    publishedPicks: draftPicksSignature(picks),
  });
  assert.equal(
    markerFor(await renderChecklist(), 'Teams assigned'),
    '✓',
    'published, with the roster still in place'
  );

  // And a later change to the picks unticks it again, with nothing maintaining
  // the field — this is how Reset and Undo retract.
  await setAppState(draftScope(SLUG), String(YEAR), {
    phase: 'complete',
    picks: picksFor(['Michigan', 'Ohio State']),
    publishedPicks: draftPicksSignature(picks),
  });
  assert.equal(markerFor(await renderChecklist(), 'Teams assigned'), '○');
});

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// --- The admin checklist -----------------------------------------------------

test('the Teams assigned link points where the publish control actually is', async () => {
  // Review finding. The step now stays ○ for the normal post-draft state — every
  // pick made, nothing confirmed — which made this link render there for the
  // first time. It pointed at the draft SETUP page, a settings screen with no
  // Confirm control, so a commissioner whose draft had just finished was sent to
  // configure it. Confirm lives on the summary page.
  await seedLeague();
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  const picks = picksFor(['Texas', 'Ohio State']);

  const hrefFor = async (): Promise<string> =>
    (await renderChecklist()).match(/href="[^"]*\/draft\/[^"]*"/)?.[0] ?? '(no draft link)';

  // No draft yet — setup is right, because there is a draft to create.
  assert.equal(await hrefFor(), `href="/league/${SLUG}/draft/setup"`);

  // Finished but never published — the one remaining step is Confirm.
  await setAppState(draftScope(SLUG), String(YEAR), {
    phase: 'complete',
    picks,
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake',
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
  });
  assert.equal(
    await hrefFor(),
    `href="/league/${SLUG}/draft/summary"`,
    'a finished draft points at the page that can publish it'
  );

  // Still running — setup again; there is nothing to confirm yet.
  //
  // Seeded as a COMPLETE record. The first version omitted `settings`/`owners`,
  // which made the derivation throw, the page's catch swallow it, and the href
  // fall through to setup — passing for a reason unrelated to routing. It could
  // not have failed.
  await setAppState(draftScope(SLUG), String(YEAR), {
    phase: 'live',
    picks: picks.slice(0, 1),
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake',
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
  });
  assert.equal(await hrefFor(), `href="/league/${SLUG}/draft/setup"`);
});

test('the summary page reads the published roster and passes it down', () => {
  // Structural pin, labelled as one. The publish controls need a fact the client
  // cannot see — whether `owners:{slug}:{year}` still holds a usable roster,
  // since `PUT /api/owners` can blank it without touching the draft. Rendering
  // the real page cannot check it: the admin controls are gated on a session
  // this harness has none of, so every control is absent either way. The
  // CONTROL behavior is pinned behaviorally in
  // `components/draft/__tests__/draftPublication.test.tsx`; what remains
  // uncheckable at runtime is that the server actually supplies the fact.
  const source = readFileSync(new URL('../summary/page.tsx', import.meta.url), 'utf8');

  assert.match(source, /getAppState<unknown>\(`owners:\$\{slug\}:\$\{year\}`, 'csv'\)/);
  assert.match(source, /hasUsableOfficialRoster\(ownersCsvRecord\?\.value \?\? null\)/);
  assert.match(
    source,
    /publishedRosterExists=\{publishedRosterExists\}/,
    'and hands it to the summary client'
  );
});

test('a reopened draft still points at the publish control', async () => {
  // Both reviewers. Reopen keeps every pick and sets `live`, which read as
  // `draft-incomplete` and routed here to the SETUP screen — while
  // `selectDraftPublicationControls` deliberately makes that state publishable
  // and Confirm lives only on the summary page. The same dead end the previous
  // fix closed, reached through the reopen door.
  await seedLeague();
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  const picks = picksFor(['Texas', 'Ohio State']);
  await setAppState(draftScope(SLUG), String(YEAR), {
    phase: 'live',
    picks,
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake',
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
    publishedPicks: draftPicksSignature(picks),
  });

  const html = await renderChecklist();
  assert.equal(
    html.match(/href="[^"]*\/draft\/[^"]*"/)?.[0],
    `href="/league/${SLUG}/draft/summary"`
  );
});

test('the checklist reports owners unconfirmed until a real roster exists', async () => {
  await seedLeague();
  assert.match(await renderChecklist(), /○[\s\S]{0,400}Owners confirmed/);

  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  assert.match(await renderChecklist(), /✓[\s\S]{0,400}Owners confirmed/);
});

test('the checklist does not accept a CSV that parses to fewer than two owners', async () => {
  // It previously counted newlines, so a header plus two rows read as a roster
  // regardless of what those rows contained.
  await seedLeague();
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nAir Force,NoClaim');

  assert.match(await renderChecklist(), /○[\s\S]{0,400}Owners confirmed/);
});

test("the checklist does not accept a PRIOR season's roster", async () => {
  await seedLeague();
  await savePreseasonOwners(SLUG, YEAR - 1, ['Alice', 'Bob']);

  assert.match(await renderChecklist(), /○[\s\S]{0,400}Owners confirmed/);
});

// --- The draft-setup page's blocked state ------------------------------------

const GATE = { draftPhase: null, isPreseason: true, slug: SLUG, year: YEAR } as const;

test('an unconfirmed season with no draft is blocked, and pointed at confirmation', () => {
  const gate = resolveDraftSetupGate({ ...GATE, isConfirmed: false });
  assert.equal(gate?.href, `/admin/${SLUG}/preseason/owners`);
  assert.equal(gate?.cta, 'Confirm 2026 owners');
});

test('a non-preseason league is sent somewhere that does not redirect away', () => {
  // `/admin/[slug]/preseason/owners` bounces to the admin home unless the league
  // is in preseason, and this page is not lifecycle-gated — every league created
  // through the admin API is born `season`. Linking there unconditionally would
  // leave the only remedy silently dead.
  const gate = resolveDraftSetupGate({ ...GATE, isConfirmed: false, isPreseason: false });
  assert.equal(gate?.href, `/admin/${SLUG}/roster`);
  assert.equal(gate?.cta, 'Upload the 2026 roster');
});

test('a confirmed roster is never blocked, whatever the draft is doing', () => {
  for (const draftPhase of [
    null,
    'setup',
    'settings',
    'preview',
    'live',
    'paused',
    'complete',
  ] as const) {
    assert.equal(
      resolveDraftSetupGate({ ...GATE, draftPhase, isConfirmed: true }),
      null,
      String(draftPhase)
    );
  }
});

test('a draft that has not started is blocked — nothing is lost by doing so', () => {
  for (const draftPhase of ['setup', 'settings', 'preview'] as const) {
    assert.equal(
      resolveDraftSetupGate({ ...GATE, draftPhase, isConfirmed: false })?.cta,
      'Confirm 2026 owners',
      draftPhase
    );
  }
});

test('a RUNNING or finished draft is never blocked, even with no confirmed roster', () => {
  // This page carries the only Reset Draft button and pick-timer control in the
  // app — `DraftControls` has no importers, and the board links here from four
  // places. Blocking it strands a draft that is already running.
  //
  // The state is reachable on the demo league, whose year-clearing control
  // deletes both owner records while a draft may still exist — precisely when
  // Reset is the button you need.
  //
  // The earlier version of this test asserted the same thing as the first test
  // above, because the function took no draft input at all. It read like
  // coverage of exactly this case and could not have failed for it.
  for (const draftPhase of ['live', 'paused', 'complete'] as const) {
    assert.equal(
      resolveDraftSetupGate({ ...GATE, draftPhase, isConfirmed: false }),
      null,
      draftPhase
    );
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-095 — wayfinding. Every surface points at Confirm before publication;
// `Continue Setup` appears only after it, and only there.
// ---------------------------------------------------------------------------

test('the checklist names the actual outstanding step, not the category', async () => {
  // The old copy was generated from a blocker LIST and read identically whether
  // the draft had not started, had finished without being confirmed, or had lost
  // its roster — telling a commissioner who had just finished a draft to
  // "complete team assignment".
  await seedLeague();
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  const picks = picksFor(['Texas', 'Ohio State']);
  const full = {
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake' as const,
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt' as const,
      totalRounds: 1,
      scheduledAt: null,
    },
  };

  // No draft yet.
  assert.match(await renderChecklist(), /Finish the draft to assign teams\./);

  // Finished, never confirmed — the case the old copy got exactly backwards.
  await setAppState(draftScope(SLUG), String(YEAR), { phase: 'complete', picks, ...full });
  const finished = await renderChecklist();
  assert.match(finished, /Your draft is complete\. Confirm the results to assign teams\./);
  assert.doesNotMatch(finished, /Complete team assignment/);

  // Published, then the roster was blanked.
  await setAppState(draftScope(SLUG), String(YEAR), {
    phase: 'complete',
    picks,
    ...full,
    publishedPicks: draftPicksSignature(picks),
  });
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', null);
  assert.match(
    await renderChecklist(),
    /The published roster is missing\. Confirm the draft again\./
  );
});

test('the assignment-method switcher disappears once every pick is in', async () => {
  // It stayed visible through the finished-but-unpublished window — the screen
  // the commissioner is on to go and publish — and switching to manual reached a
  // blocker with no writer.
  await seedLeague();
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  const picks = picksFor(['Texas', 'Ohio State']);
  const full = {
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake' as const,
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt' as const,
      totalRounds: 1,
      scheduledAt: null,
    },
  };

  // Mid-draft the commissioner may still change their mind.
  await setAppState(draftScope(SLUG), String(YEAR), {
    phase: 'live',
    picks: picks.slice(0, 1),
    ...full,
  });
  assert.match(await renderChecklist(), /Assignment method/i);

  // Every pick in — the draft's assignment must not be discardable by a click.
  await setAppState(draftScope(SLUG), String(YEAR), { phase: 'complete', picks, ...full });
  assert.doesNotMatch(await renderChecklist(), /Assignment method/i);
});

test('changing method mid-draft warns that it discards the draft', async () => {
  // Owner's ruling: switching IS allowed while a draft is in progress, but only
  // behind a warning that says what it costs. The card asks; the action enforces.
  await seedLeague();
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  await setAppState(draftScope(SLUG), String(YEAR), {
    phase: 'live',
    picks: picksFor(['Texas']),
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake',
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
  });

  // The card is still offered — a half-run draft may be abandoned.
  assert.match(await renderChecklist(), /Assignment method/i);

  // The WARNING itself is client state raised by a click, which a static render
  // cannot reach, so it is pinned two ways instead — neither of them by matching
  // page text, which would pass on the word "Change" alone:
  //   1. the page passes the fact (structural, below);
  //   2. the ACTION refuses a finished draft outright, covered behaviorally in
  //      `admin/[slug]/__tests__/actions.test.ts`. That is the guard; the dialog
  //      is the courtesy.
  const pageSource = readFileSync(
    new URL('../../../../admin/[slug]/preseason/page.tsx', import.meta.url),
    'utf8'
  );
  assert.match(pageSource, /draftHasPicks=\{draftHasPicks\}/, 'the card is told what is at stake');
  assert.match(
    pageSource,
    /draftHasPicks = Array\.isArray\(draftRecord\?\.picks\) && draftRecord\.picks\.length > 0;/,
    'and the fact is derived from the stored draft'
  );
});
