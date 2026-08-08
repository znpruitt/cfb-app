import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildHomeView } from '../homeView.tsx';
import PublicLanding from '../../components/home/PublicLanding.tsx';
import AdminLeagueDashboard from '../../components/home/AdminLeagueDashboard.tsx';
import type { League } from '../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-088 — the homepage had NO tests at all, on the surface every visitor
// reaches first.
//
// The load-bearing property is ORDERING: the registry read and every owner-count
// read must happen strictly inside the platform-admin branch. Previously they ran
// unconditionally in the RSC and were handed to a `'use client'` component that
// branched with Clerk's `<Show>` — so an anonymous visitor received the entire
// league directory in the payload, the landing markup did not exist in server
// HTML at all (blank page with JavaScript disabled), and signed-in non-admins
// fell into the dashboard.
// ---------------------------------------------------------------------------

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

function league(slug: string, year: number, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props) {
      collectStrings(props.children, out);
      for (const [key, value] of Object.entries(props)) {
        if (key !== 'children' && typeof value === 'string') out.push(value);
      }
    }
  }
  return out;
}

async function seedTwoLeagues() {
  await setAppState('leagues', 'registry', [
    league('alpha', 2026, { state: 'season', year: 2026 }),
    league('bravo', 2025, { state: 'offseason' }),
  ]);
  await setAppState('owners:alpha:2026', 'csv', 'Team,Owner\nAlabama,Dana\nGeorgia,Sam');
  await setAppState('owners:bravo:2025', 'csv', 'Team,Owner\nOhio State,Kim\nTexas,Lee\nUtah,Max');
}

// REGRESSION TEST — a non-admin gets the public landing and NOTHING crosses with
// it. Asserting the props are empty is the point: `<Show>` used to hide the
// league list in the browser after the server had already serialized it.
test('a non-admin receives the public landing with no league data attached', async () => {
  await seedTwoLeagues();

  const view = await buildHomeView({ isPlatformAdmin: false, isSignedIn: false });

  assert.equal(view.type, PublicLanding, 'the public branch, not the dashboard');
  // The exact prop SET, not just "no leagues". `deepEqual` against a fixed shape
  // fails the moment anyone reintroduces league data here, which is the property
  // worth pinning — `<Show>` used to hide that data in the browser after the
  // server had already serialized it.
  //
  // An earlier version of this test also ran `collectStrings(view)` looking for
  // slugs. That was VACUOUS: `view` is an unrendered element whose children are
  // undefined, so the walk always returned [] and the assertion could never fail.
  assert.deepEqual(
    view.props,
    { isSignedIn: false },
    'identity only — no leagues, no owner counts, nothing derived'
  );
});

// REGRESSION TEST — the ordering, proved by poisoning the registry. A `null`
// member throws on the first property access, so if the public branch touched the
// registry at all this would fail.
test('a broken registry cannot break the public landing', async () => {
  await setAppState('leagues', 'registry', [null]);

  const view = await buildHomeView({ isPlatformAdmin: false, isSignedIn: false });
  assert.equal(view.type, PublicLanding, 'the public branch never reads the registry');

  // POSITIVE CONTROL — the same poison DOES reach the admin branch, so the
  // assertion above is about ordering and not about a harmless fixture.
  await assert.rejects(
    () => buildHomeView({ isPlatformAdmin: true, isSignedIn: true }),
    'the admin branch reads the registry, so it must fail on the same data'
  );
});

test('a platform admin receives the dashboard', async () => {
  await seedTwoLeagues();

  const view = await buildHomeView({ isPlatformAdmin: true, isSignedIn: true });

  assert.equal(view.type, AdminLeagueDashboard);
  const props = view.props as { leagues: Array<{ slug: string }> };
  assert.deepEqual(
    props.leagues.map((l) => l.slug),
    ['alpha', 'bravo']
  );
});

// REGRESSION TEST — owner counts resolve PER LEAGUE.
//
// `bravo` is in offseason holding 2025 while `alpha` is on 2026. The previous
// implementation applied one calendar-derived year to both, so whichever league
// was not on that year read a roster it does not have and reported "No owners"
// with a full roster in storage. Both years here come from the fixture rather
// than the clock, so this cannot pass or fail by the date it runs on.
test('each league reads its own season roster', async () => {
  await seedTwoLeagues();

  const view = await buildHomeView({ isPlatformAdmin: true, isSignedIn: true });
  const props = view.props as { ownerCountBySlug: Record<string, number | null> };

  assert.equal(props.ownerCountBySlug.alpha, 2, 'alpha is on 2026');
  assert.equal(props.ownerCountBySlug.bravo, 3, 'bravo is in offseason holding 2025');
});

// The shared header-aware parser, not a positional split on the first comma:
// a reordered header must still count the owner column, and `NoClaim` is a
// sentinel rather than a person.
test('owner counting uses the shared parser and ignores the NoClaim sentinel', async () => {
  await setAppState('leagues', 'registry', [
    league('alpha', 2026, { state: 'season', year: 2026 }),
  ]);
  await setAppState(
    'owners:alpha:2026',
    'csv',
    'Owner,Team\nDana,Alabama\nNoClaim,Georgia\nDana,Utah'
  );

  const view = await buildHomeView({ isPlatformAdmin: true, isSignedIn: true });
  const props = view.props as { ownerCountBySlug: Record<string, number | null> };

  assert.equal(props.ownerCountBySlug.alpha, 1, 'one distinct real owner, columns reversed');
});

test('a league with no stored roster reports zero rather than failing', async () => {
  await setAppState('leagues', 'registry', [
    league('alpha', 2026, { state: 'season', year: 2026 }),
  ]);

  const view = await buildHomeView({ isPlatformAdmin: true, isSignedIn: true });
  const props = view.props as { ownerCountBySlug: Record<string, number | null> };
  assert.equal(props.ownerCountBySlug.alpha, 0);
});

// ---------------------------------------------------------------------------
// The public landing itself.
// ---------------------------------------------------------------------------

test('the landing explains the product and points members at their shared link', () => {
  const strings = collectStrings(PublicLanding({ isSignedIn: false })).join(' ');

  assert.match(strings, /Turf War/);
  assert.match(strings, /college football pool/i, 'it says what this is');
  assert.match(strings, /link your commissioner shared/i, 'and how an invited member gets in');
  assert.ok(
    !/Enter your league URL/i.test(strings),
    'the old instruction promised an input this page does not have'
  );
});

// REGRESSION TEST — the landing must stay a SERVER component. Marking it
// `'use client'` reintroduces the original defect exactly: the branch moves back
// into the browser and the page renders blank with JavaScript disabled.
test('the landing is server-rendered', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/home/PublicLanding.tsx'), 'utf8');
  assert.ok(
    !/^\s*['"]use client['"]/m.test(source),
    'PublicLanding must not be a client component'
  );

  const viewSource = readFileSync(join(process.cwd(), 'src/app/homeView.tsx'), 'utf8');
  assert.ok(
    !/from '@clerk\/nextjs'/.test(viewSource),
    'the branch is not a Clerk render-time gate'
  );

  // The branch module must stay OUT of `src/components/`: it transitively imports
  // `appStateStore`, which imports `pg`. Under `src/components/` a client
  // component could import it and pull a database driver into the browser bundle,
  // and this repo has no `server-only` guard to prevent that.
  assert.ok(
    !existsSync(join(process.cwd(), 'src/components/home/homeView.tsx')),
    'homeView must not live under src/components/'
  );
});

// A guard, not a measurement. Automated contrast checking is not available here,
// so this pins the specific tokens that FAILED: `text-gray-400` on white measured
// ~2.6:1 and `text-zinc-600` on `zinc-950` is worse. The chosen replacements
// (`gray-600` ≈ 6.5:1, `zinc-400` on `zinc-950` ≈ 7.9:1) clear 4.5:1; that ratio
// itself is verified visually on preview, not here.
test('the landing avoids the text tokens that failed contrast', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/home/PublicLanding.tsx'), 'utf8');
  for (const token of [
    'text-gray-400',
    'text-gray-500',
    'dark:text-zinc-500',
    'dark:text-zinc-600',
  ]) {
    assert.ok(!source.includes(token), `${token} does not meet 4.5:1 for normal text here`);
  }
});

// REGRESSION TEST — a signed-in non-admin must not be TRAPPED.
//
// The first version of this slice gave them the landing whose only control was a
// link to `/login`, which redirects to `/admin`, which middleware bounces back
// here: a closed loop with no sign-out and no explanation. They previously
// reached the dashboard and its account menu, so this was a regression the slice
// introduced — it withheld the data correctly and removed the exit with it.
test('a signed-in non-admin is given a way out and a reason', () => {
  const strings = collectStrings(PublicLanding({ isSignedIn: true })).join(' ');

  assert.match(strings, /doesn.t have platform admin access/i, 'it says why they are refused');
  assert.ok(
    !/Platform admin sign-in/i.test(strings),
    'and does not offer sign-in to someone already signed in'
  );
});

// POSITIVE CONTROL — a signed-OUT visitor still gets the sign-in affordance and
// no session copy, so the assertions above discriminate rather than describing
// the page in every state.
test('a signed-out visitor is offered sign-in, not sign-out', () => {
  const strings = collectStrings(PublicLanding({ isSignedIn: false })).join(' ');

  assert.match(strings, /Platform admin sign-in/i);
  assert.ok(!/doesn.t have platform admin access/i.test(strings));
});

// The landing still carries NO league data in either state — the exit is an
// account control, not a relaxation of the entry contract.
test('the signed-in landing still shows no league data', async () => {
  await seedTwoLeagues();
  const view = await buildHomeView({ isPlatformAdmin: false, isSignedIn: true });

  assert.equal(view.type, PublicLanding);
  assert.deepEqual(view.props, { isSignedIn: true });
});

// REGRESSION TEST — the OTHER half of the sign-in loop.
//
// The landing now gives a signed-in non-admin a way out, but the loop had two
// halves: `/login` sent every successful sign-in to `/admin`, which middleware
// bounces back to `/` for anyone who is not a platform admin. Asserted against
// the source because rendering Clerk's `<SignIn>` here would require Clerk
// itself; the value is a one-word config that silently reopens the loop if it
// regresses.
test('the login page returns to the root, not to /admin', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/login/[[...sign-in]]/page.tsx'), 'utf8');
  assert.match(source, /forceRedirectUrl="\/"/, 'sign-in returns to the root');
  assert.ok(
    !/forceRedirectUrl="\/admin"/.test(source),
    'sending a non-admin to /admin is half of the sign-in loop'
  );
});
