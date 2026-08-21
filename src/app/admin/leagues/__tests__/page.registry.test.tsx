import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminLeaguesPage,
  AppRouterContext,
  dom,
  fireEvent,
  React,
  render,
  requests,
  router,
  userEvent,
  waitFor,
} from './_pageHarness.tsx';

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
