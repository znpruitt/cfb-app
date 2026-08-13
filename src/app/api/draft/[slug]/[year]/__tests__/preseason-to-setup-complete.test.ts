import './_setup/installAsyncLocalStorage';
import { runWithRevalidateContext } from './_setup/revalidateContext';

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

import { POST as CREATE_DRAFT, PUT as UPDATE_DRAFT } from '../route';
import { POST as MAKE_PICK } from '../pick/route';
import { POST as CONFIRM_DRAFT } from '../confirm/route';
import { addLeague } from '@/lib/leagueRegistry';
import { savePreseasonOwners } from '@/lib/preseasonOwnerStore';
import {
  getAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import { __withAdminActionAuthorizerForTests } from '@/lib/auth/requireAdminAction';
import { type DraftState, draftScope, getDraftEligibleTeams } from '@/lib/draft';
import { isDraftPublished } from '@/lib/selectors/draftPublication';
import { getTeamAssignment } from '@/lib/server/teamAssignmentStore';
import { completeSetup } from '../../../../../admin/[slug]/actions';
import PreseasonPage from '../../../../../admin/[slug]/preseason/page';
import type { League } from '@/lib/league';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import teamsData from '@/data/teams.json';

// ---------------------------------------------------------------------------
// PLATFORM-094 — the JOURNEY, not the seams.
//
// Every other suite on this campaign seeds its starting state directly, so each
// step was verified against records written by hand. That is exactly how the
// original defect survived: the pieces all passed, and the path between them was
// broken — a finished draft had no reachable publish control, and the checklist
// ticked for a league whose teams were never assigned.
//
// This drives the REAL handlers end to end, in the order a commissioner uses
// them, and asserts only on state the production code produced:
//
//   confirm owners → create draft → start → make every pick → confirm →
//   checklist ticks → Complete Setup succeeds
//
// Nothing here is seeded past step one.
// ---------------------------------------------------------------------------

type TeamsJson = { items: TeamCatalogItem[] };

const SLUG = 'e2e-league';
const YEAR = 2026;
const TOKEN = 'test-admin-token';
const OWNERS = ['Alice', 'Bob'];

const ELIGIBLE = getDraftEligibleTeams((teamsData as TeamsJson).items);
const params = Promise.resolve({ slug: SLUG, year: String(YEAR) });

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

function adminRequest(path: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}${path}`, {
    method,
    headers: body
      ? { 'content-type': 'application/json', 'x-admin-token': TOKEN }
      : { 'x-admin-token': TOKEN },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function renderChecklist(): Promise<string> {
  const page = (await PreseasonPage({ params: Promise.resolve({ slug: SLUG }) })) as ReactElement;
  return renderToStaticMarkup(page);
}

/** The ✓/○ marker belonging to one checklist row — see ownerGateSurfaces. */
function markerFor(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  assert.ok(at > 0, `checklist row "${label}" not rendered`);
  const before = html.slice(0, at);
  return before.lastIndexOf('✓') > before.lastIndexOf('○') ? '✓' : '○';
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = TOKEN;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) delete process.env.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
});

test('a commissioner can go from preseason to setup complete without seeded state', async () => {
  // --- the league exists and is in preseason (PLATFORM-093's birth state) ---
  await addLeague({
    slug: SLUG,
    displayName: 'End To End League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: YEAR },
    assignmentMethod: 'draft',
  });

  // --- step 1: owners confirmed (PLATFORM-092's precondition for a draft) ---
  await savePreseasonOwners(SLUG, YEAR, OWNERS);
  assert.equal(markerFor(await renderChecklist(), 'Owners confirmed'), '✓');
  assert.equal(
    markerFor(await renderChecklist(), 'Teams assigned'),
    '○',
    'nothing is assigned before a draft has run'
  );

  // --- step 2: create the draft, one round so the run is short ---
  const created = await CREATE_DRAFT(
    adminRequest('', 'POST', { owners: OWNERS, settings: { totalRounds: 1 } }),
    { params }
  );
  assert.equal(created.status, 201, await created.text());

  // --- step 3: start it. A draft is born in `setup` and the transition map is
  // setup → settings → live, so this is two steps, not one. ---
  const configured = await runWithRevalidateContext(() =>
    UPDATE_DRAFT(adminRequest('', 'PUT', { phase: 'settings' }), { params })
  );
  assert.equal(configured.status, 200, await configured.text());
  const started = await runWithRevalidateContext(() =>
    UPDATE_DRAFT(adminRequest('', 'PUT', { phase: 'live' }), { params })
  );
  assert.equal(started.status, 200, await started.text());

  // --- step 4: make every pick through the real pick route ---
  const totalPicks = OWNERS.length; // totalRounds 1 × 2 owners
  for (let i = 0; i < totalPicks; i++) {
    const res = await runWithRevalidateContext(() =>
      MAKE_PICK(adminRequest('/pick', 'POST', { team: ELIGIBLE[i]!.school }), { params })
    );
    assert.equal(res.status, 200, `pick ${i + 1}: ${await res.text()}`);
  }

  const afterPicks = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(afterPicks?.phase, 'complete', 'the final pick completes the draft');
  assert.equal(
    isDraftPublished(afterPicks),
    false,
    'and completing it publishes NOTHING — the defect this campaign exists for'
  );

  // The checklist must NOT tick here. Before this work it did, and Complete
  // Setup would have written `setupComplete` for a league with no rosters.
  assert.equal(markerFor(await renderChecklist(), 'Teams assigned'), '○');
  const blocked = await getTeamAssignment(SLUG, YEAR, {
    assignmentMethod: 'draft',
    manualAssignmentComplete: undefined,
  });
  assert.equal(blocked.blocker, 'draft-not-published');

  // ...and the checklist points at the page that can fix it.
  assert.equal(
    (await renderChecklist()).match(/href="[^"]*\/draft\/[^"]*"/)?.[0],
    `href="/league/${SLUG}/draft/summary"`,
    'the one actionable link goes where Confirm lives'
  );

  // --- step 5: publish ---
  const confirmed = await runWithRevalidateContext(() =>
    CONFIRM_DRAFT(adminRequest('/confirm', 'POST'), { params })
  );
  assert.equal(confirmed.status, 200, await confirmed.text());

  const published = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(isDraftPublished(published), true, 'the draft records what it published');
  const roster = (await getAppState<string>(`owners:${SLUG}:${YEAR}`, 'csv'))?.value;
  assert.ok(typeof roster === 'string' && roster.includes('Alice'), 'the roster was written');

  // --- step 6: the checklist agrees ---
  assert.equal(markerFor(await renderChecklist(), 'Teams assigned'), '✓');

  // --- step 7: Complete Setup succeeds on state the real code produced ---
  await __withAdminActionAuthorizerForTests(
    () => true,
    () =>
      runWithRevalidateContext(async () => {
        try {
          await completeSetup(SLUG, YEAR);
        } catch (error) {
          // The action ends in redirect(), which throws NEXT_REDIRECT. Anything
          // else is a real failure and must surface.
          const digest = (error as { digest?: string })?.digest ?? '';
          if (!String(digest).startsWith('NEXT_REDIRECT')) throw error;
        }
      })
  );

  const registry = (await getAppState<League[]>('leagues', 'registry'))?.value;
  const status = registry?.find((l) => l.slug === SLUG)?.status;
  assert.ok(
    status?.state === 'preseason' && status.setupComplete === true,
    `setup did not complete: ${JSON.stringify(status)}`
  );
});

test('the same journey is REFUSED at the last step if the draft is never confirmed', async () => {
  // The positive control for the walk above: identical up to publication, and
  // stopping there must block. Without this, the end-to-end test could pass on a
  // build where `completeSetup` checks nothing at all.
  await addLeague({
    slug: SLUG,
    displayName: 'End To End League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: YEAR },
    assignmentMethod: 'draft',
  });
  await savePreseasonOwners(SLUG, YEAR, OWNERS);

  const created = await CREATE_DRAFT(
    adminRequest('', 'POST', { owners: OWNERS, settings: { totalRounds: 1 } }),
    { params }
  );
  assert.equal(created.status, 201, await created.text());
  await runWithRevalidateContext(() =>
    UPDATE_DRAFT(adminRequest('', 'PUT', { phase: 'settings' }), { params })
  );
  await runWithRevalidateContext(() =>
    UPDATE_DRAFT(adminRequest('', 'PUT', { phase: 'live' }), { params })
  );
  for (let i = 0; i < OWNERS.length; i++) {
    await runWithRevalidateContext(() =>
      MAKE_PICK(adminRequest('/pick', 'POST', { team: ELIGIBLE[i]!.school }), { params })
    );
  }

  await assert.rejects(
    () =>
      __withAdminActionAuthorizerForTests(
        () => true,
        () => runWithRevalidateContext(() => completeSetup(SLUG, YEAR))
      ),
    /draft-not-published/,
    'an unpublished draft cannot complete setup'
  );

  const registry = (await getAppState<League[]>('leagues', 'registry'))?.value;
  const status = registry?.find((l) => l.slug === SLUG)?.status;
  assert.notEqual(
    status?.state === 'preseason' ? status.setupComplete : undefined,
    true,
    'and nothing was written'
  );
});
