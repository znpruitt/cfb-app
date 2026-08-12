import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

// MUST precede `@testing-library/react`: it installs the JSDOM globals before
// `react-dom` is evaluated. See the module for why a late setup silently breaks
// multi-field forms.
import { dom } from '../../../../test/domEnvironment.ts';

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';

import AdminLeaguesPage from '../page';
import type { PublicLeague } from '@/lib/league';

// ---------------------------------------------------------------------------
// PLATFORM-086F2I — this page is the REGISTRY surface: create, list, delete.
// Configuration moved to `/admin/[slug]/settings`, and the irreversible delete
// now requires typing the league's slug.
//
// The typed value is the SLUG, not a fixed word: a fixed word is identical on
// every row, so it defends against a stray click but not against acting on the
// WRONG league. The browser check is convenience only — the route enforces it,
// because a static ADMIN_API_TOKEN reaches the endpoint without this form.
// ---------------------------------------------------------------------------

dom.window.sessionStorage.setItem('adminToken', 'test-token');

function router(): AppRouterInstance {
  return {
    back: () => {},
    forward: () => {},
    prefetch: () => {},
    push: () => {},
    replace: () => {},
    refresh: () => {},
  } as unknown as AppRouterInstance;
}

function league(slug: string): PublicLeague {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2025,
    createdAt: '2022-01-01T00:00:00.000Z',
    status: { state: 'season', year: 2025 },
  };
}

let requests: Array<{ method: string; url: string }> = [];
let bodies: Array<Record<string, unknown>> = [];
let adoptOffered = false;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  bodies = [];
  adoptOffered = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ method, url });
    if (init?.body) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    if (method === 'GET') return Response.json({ leagues: [league('alpha'), league('bravo')] });
    if (method === 'DELETE') return Response.json({ leagues: [league('bravo')] });
    if (method === 'POST' && !adoptOffered) {
      adoptOffered = true;
      return new Response('Stored data still exists for slug "ghost" (2 record group(s)).', {
        status: 409,
      });
    }
    return Response.json({});
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('the league overview offers no configuration editing', async () => {
  const { getByText, queryAllByRole } = render(
    React.createElement(AppRouterContext.Provider, { value: router() }, <AdminLeaguesPage />)
  );
  await waitFor(() => getByText('League alpha'));

  assert.equal(
    queryAllByRole('button', { name: /^Edit$/ }).length,
    0,
    'renaming belongs to the league settings page'
  );
  assert.equal(queryAllByRole('button', { name: /^Save$/ }).length, 0);

  // POSITIVE CONTROL — the registry actions this page DOES own are present, so
  // the absences above are not an empty render.
  assert.equal(
    queryAllByRole('button', { name: /^Delete$/ }).length,
    2,
    'one delete control per league — the page still owns deletion'
  );

  // Removing the inline editor must not strand the operator: each row routes to
  // the page that DOES own configuration. Without this, deleting the link would
  // be silent.
  const settingsLinks = queryAllByRole('link', { name: /^Settings$/ });
  assert.equal(settingsLinks.length, 2, 'each league links to its settings page');
  assert.equal(
    settingsLinks[0]!.getAttribute('href'),
    '/admin/alpha/settings',
    'and it points at that league'
  );
});

test('delete stays disabled until the exact slug is typed, then sends it to the route', async () => {
  // `userEvent`, not `fireEvent.change`: React's value tracker means assigning
  // `target.value` can update the DOM without ever running `onChange`, so the
  // control stays disabled and a naive "still disabled" assertion passes for the
  // wrong reason. This test was written that way first and proved nothing.
  const user = userEvent.setup({ document: dom.window.document });
  const { getAllByRole, getByText, getByRole } = render(
    React.createElement(AppRouterContext.Provider, { value: router() }, <AdminLeaguesPage />)
  );
  await waitFor(() => getByText('League alpha'));

  await user.click(getAllByRole('button', { name: /^Delete$/ })[0]!);

  const input = () =>
    getByRole('textbox', { name: 'Type alpha to confirm deletion' }) as HTMLInputElement;
  const confirm = () => getByRole('button', { name: 'Delete alpha' }) as HTMLButtonElement;

  assert.equal(confirm().disabled, true, 'armed but not yet confirmed');

  // The WRONG league's slug must not unlock it — the accident this design exists
  // for, and the case a fixed confirmation word would have accepted.
  await user.type(input(), 'bravo');
  assert.equal(input().value, 'bravo', 'the wrong slug really was entered');
  assert.equal(confirm().disabled, true, 'and it did NOT unlock the button');

  await user.clear(input());
  await user.type(input(), 'alpha');
  assert.equal(input().value, 'alpha');
  assert.equal(confirm().disabled, false, 'the exact slug unlocks it');

  await user.click(confirm());
  await waitFor(() => assert.ok(requests.some((r) => r.method === 'DELETE')));

  const del = requests.find((r) => r.method === 'DELETE')!;
  assert.match(
    del.url,
    /\/api\/admin\/leagues\/alpha\?confirm=alpha$/,
    'the confirmation travels IN THE REQUEST — the route is the authority, not this form'
  );
});

test('no DELETE is issued before a confirmation is typed', async () => {
  const { getAllByRole, getByText } = render(
    React.createElement(AppRouterContext.Provider, { value: router() }, <AdminLeaguesPage />)
  );
  await waitFor(() => getByText('League alpha'));

  fireEvent.click(getAllByRole('button', { name: /^Delete$/ })[0]!);
  assert.deepEqual(
    requests.filter((r) => r.method === 'DELETE'),
    [],
    'arming the control is not a request'
  );
});

// PLATFORM-086F2J — GAP, recorded rather than papered over.
//
// The create form's restore-year wiring has NO test. `userEvent.type` updates the
// DOM value of the create-form inputs but does not reach React state — the
// submit handler still sees an empty slug and refuses — while the identical
// approach works on the delete-confirmation input a few tests above. The cause
// is specific to this form and was not identified.
//
// Rather than ship a test that passes for the wrong reason or drives the form
// through an artificial path, the wiring is left uncovered and said so. What IS
// covered is the contract that matters: the route requires `restoreFoundedYear`
// whenever `adoptExistingData` is sent, refuses it on ordinary creation,
// validates its range, and still freezes the value afterwards — seven tests in
// `src/app/api/admin/leagues/__tests__/route.test.ts`, including positive
// controls. A form that failed to send the year would refuse every restoration
// loudly and immediately, which is the mitigating factor.

// ---------------------------------------------------------------------------
// PLATFORM-086F2J round 2 — the adopt/restore flow, finally covered.
//
// The first attempt at these tests was abandoned with a note claiming
// `userEvent` could not drive this form. That diagnosis was WRONG. The cause was
// import order: the suite installed its JSDOM globals in the module body, after
// the hoisted `react-dom` import had already captured `canUseDOM === false`, so
// React fell back to its legacy IE change-detection path and threw on every
// focus transition. Whichever field was typed SECOND lost its state. Importing
// `domEnvironment.ts` first fixes it, and the flow is testable after all.
// ---------------------------------------------------------------------------

async function fillCreateForm(
  container: HTMLElement,
  user: ReturnType<typeof userEvent.setup>,
  values: { slug: string; name: string }
) {
  await waitFor(() => assert.ok(container.querySelector('#create-slug')));
  await user.clear(container.querySelector('#create-slug') as HTMLInputElement);
  await user.type(container.querySelector('#create-slug') as HTMLInputElement, values.slug);
  await user.clear(container.querySelector('#create-name') as HTMLInputElement);
  await user.type(container.querySelector('#create-name') as HTMLInputElement, values.name);
}

function submitCreate(container: HTMLElement) {
  const button = [...container.querySelectorAll('button')].find((b) =>
    /Create league/i.test(b.textContent ?? '')
  );
  assert.ok(button, 'the create button is present');
  fireEvent.click(button);
}

function renderPage() {
  return render(
    React.createElement(
      AppRouterContext.Provider,
      { value: router() },
      React.createElement(AdminLeaguesPage, {})
    )
  );
}

test('the residue refusal offers adoption, and adopting sends the restored year', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const { container } = renderPage();

  await fillCreateForm(container, user, { slug: 'ghost', name: 'Ghost' });
  submitCreate(container);

  // The acknowledgement appears only after the refusal — it is never offered up
  // front, so it cannot be ticked by an operator who was warned about nothing.
  const checkbox = await waitFor(() => {
    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    assert.ok(box, 'the adoption acknowledgement appears after the 409');
    return box;
  });

  await user.click(checkbox);
  // PLATFORM-093 — ticking adopt reveals BOTH years. Ordinary creation derives
  // the season and sends none; a restoration must state the season its data
  // belongs to, because filing old material under the current season cannot be
  // corrected afterwards.
  const seasonField = await waitFor(() => {
    const field = container.querySelector('#restore-season-year') as HTMLInputElement | null;
    assert.ok(field, 'ticking it reveals the season field');
    return field;
  });
  await user.type(seasonField, '2024');

  const yearField = container.querySelector('#restore-founded-year') as HTMLInputElement | null;
  assert.ok(yearField, 'ticking it reveals the founding-year field');
  await user.type(yearField, '2019');

  submitCreate(container);
  await waitFor(() => assert.ok(bodies.length >= 2, 'a second POST was issued'));

  assert.deepEqual(bodies[1], {
    slug: 'ghost',
    displayName: 'Ghost',
    year: 2024,
    adoptExistingData: true,
    restoreFoundedYear: 2019,
  });
});

test('ordinary creation sends no year at all, and states the season it derived', async () => {
  // The route refuses a supplied year on ordinary creation, so a form that kept
  // sending one would fail every create. The season is shown rather than asked:
  // a surface that quietly decides something this consequential should say what
  // it decided.
  const user = userEvent.setup({ document: dom.window.document });
  const { container } = renderPage();

  const expected = new Date().getUTCFullYear();
  assert.match(
    container.textContent ?? '',
    new RegExp(`This league will be set up for the\\s*${expected}\\s*season`),
    'the derived season is stated on the form'
  );
  assert.equal(container.querySelector('#create-year'), null, 'the editable year field is gone');

  await fillCreateForm(container, user, { slug: 'fresh', name: 'Fresh' });
  submitCreate(container);
  await waitFor(() => assert.ok(bodies.length >= 1, 'a POST was issued'));

  assert.deepEqual(bodies[0], { slug: 'fresh', displayName: 'Fresh' });
});

// REGRESSION TEST — the acknowledgement is granted for ONE slug.
//
// It used to survive a slug edit, so an operator who hit the refusal on `ghost`,
// ticked adopt, then changed their mind and typed a different slug carried the
// flag with them. The route skipped the residue guard for a slug nobody had been
// warned about and stamped it with a founding year that PATCH then froze.
test('editing the slug retracts the adoption acknowledgement', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const { container } = renderPage();

  await fillCreateForm(container, user, { slug: 'ghost', name: 'Ghost' });
  submitCreate(container);

  const checkbox = await waitFor(() => {
    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    assert.ok(box);
    return box;
  });
  await user.click(checkbox);
  await waitFor(() => assert.ok(container.querySelector('#restore-founded-year')));

  // The operator realises it is a different league and changes the slug.
  await user.clear(container.querySelector('#create-slug') as HTMLInputElement);
  await user.type(container.querySelector('#create-slug') as HTMLInputElement, 'other');

  await waitFor(() => {
    assert.ok(
      container.querySelector('input[type="checkbox"]') === null,
      'the acknowledgement is withdrawn with the slug it was granted for'
    );
    assert.ok(
      container.querySelector('#restore-founded-year') === null,
      'and the founding-year field goes with it'
    );
  });

  submitCreate(container);
  await waitFor(() => assert.ok(bodies.length >= 2));
  assert.equal(bodies[1]!.slug, 'other');
  assert.ok(
    !('adoptExistingData' in bodies[1]!),
    'the new slug is created ordinarily, so the route surveys it'
  );
  assert.ok(!('restoreFoundedYear' in bodies[1]!));
});

// A blank founding year is an explicit "none recorded", sent as null. Omission is
// what the route refuses, so the form must distinguish the two: leagues predating
// the field have no founding year, and restoring one must not invent one.
test('a blank founding year is sent as an explicit null', async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const { container } = renderPage();

  await fillCreateForm(container, user, { slug: 'ghost', name: 'Ghost' });
  submitCreate(container);

  const checkbox = await waitFor(() => {
    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    assert.ok(box);
    return box;
  });
  await user.click(checkbox);
  await waitFor(() => assert.ok(container.querySelector('#restore-founded-year')));

  submitCreate(container);
  await waitFor(() => assert.ok(bodies.length >= 2));
  assert.equal(bodies[1]!.adoptExistingData, true);
  assert.equal(bodies[1]!.restoreFoundedYear, null, 'null, not 0 and not omitted');
});
