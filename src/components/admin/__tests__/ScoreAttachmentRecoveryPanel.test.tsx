import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import ScoreAttachmentRecoveryPanel, {
  describeScoreAttachmentTarget,
} from '../ScoreAttachmentRecoveryPanel';
import { seasonYearForToday } from '@/lib/scores/normalizers';

// ---------------------------------------------------------------------------
// PLATFORM-086F2D2 — the relocated score-attachment tool is an explicitly
// confirmed, emergency-class recovery action: one captured target drives the
// disclosure, confirmation, request, and result label; invalid scope never
// silently broadens; cancellation performs no request; stale responses never
// overwrite current feedback; results carry the does-not-prove caveat.
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://example.test/',
});
(globalThis as { window: Window }).window = dom.window as unknown as Window;
(globalThis as { document: Document }).document = dom.window.document;
(globalThis as { self: Window }).self = dom.window as unknown as Window;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

type Recorded = { url: string; init: RequestInit | undefined };

let requests: Recorded[] = [];
let confirmMessages: string[] = [];
let confirmAnswer = true;
let responder: () => Response | Promise<Response>;
const originalFetch = globalThis.fetch;

const TRACE_FIXTURE = {
  year: 2019,
  week: null,
  seasonType: null,
  summary: {
    providerRowCount: 42,
    attachedCount: 40,
    actionableCount: 1,
    ignoredCount: 1,
    actionableReasons: { unresolved_home_team: 1 },
    ignoredReasons: { non_fbs: 1 },
  },
  schedule: { indexedGameCount: 39 },
  diagnostics: {
    actionable: [
      {
        reason: 'unresolved_home_team',
        userMessage: 'Home team could not be resolved.',
        provider: { week: 4, homeTeamRaw: 'Alpha U', awayTeamRaw: 'Beta U' },
        resolution: { homeCanonical: null, awayCanonical: 'Beta U' },
        trace: { candidateCount: 0, plausibleScheduledGameCount: null, finalNote: null },
      },
    ],
    ignored: [],
  },
};

function setControl(element: Element, value: string): void {
  const propsKey = Object.keys(element).find((k) => k.startsWith('__reactProps$'))!;
  const props = (element as unknown as Record<string, unknown>)[propsKey] as {
    onChange: (e: { target: { value: string } }) => void;
  };
  act(() => props.onChange({ target: { value } }));
}

beforeEach(() => {
  requests = [];
  confirmMessages = [];
  confirmAnswer = true;
  responder = () => Response.json(TRACE_FIXTURE);
  dom.window.confirm = (message?: string) => {
    confirmMessages.push(message ?? '');
    return confirmAnswer;
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return responder();
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('describeScoreAttachmentTarget covers every scope shape', () => {
  assert.equal(
    describeScoreAttachmentTarget(2026, null, ''),
    '2026 full season (regular + postseason)'
  );
  assert.equal(describeScoreAttachmentTarget(2026, null, 'regular'), '2026 regular full season');
  assert.equal(
    describeScoreAttachmentTarget(2026, 4, ''),
    '2026 canonical week 4 (all season types)'
  );
  assert.equal(
    describeScoreAttachmentTarget(2026, 17, 'postseason'),
    '2026 postseason canonical week 17'
  );
});

test('emergency classification is visible at page rest; target copy tracks the controls', () => {
  const year = seasonYearForToday();
  const { container, getByText, getAllByText } = render(<ScoreAttachmentRecoveryPanel />);

  getByText(/Cost and scope \(emergency — high provider cost\)/);
  // The ONE captured target renders in both the control row and the disclosure.
  assert.equal(getAllByText(`${year} full season (regular + postseason)`).length, 2);

  const [weekInput] = Array.from(container.querySelectorAll('input')).filter(
    (i) => i.getAttribute('placeholder') === 'all'
  );
  setControl(weekInput!, '4');
  assert.equal(getAllByText(`${year} canonical week 4 (all season types)`).length, 2);

  setControl(container.querySelector('select')!, 'postseason');
  assert.equal(getAllByText(`${year} postseason canonical week 4`).length, 2);
});

test('an invalid nonblank week shows an inline error and performs no confirmation or request', () => {
  const { container, getByRole, getByText, getAllByText } = render(
    <ScoreAttachmentRecoveryPanel />
  );
  const weekInput = Array.from(container.querySelectorAll('input')).find(
    (i) => i.getAttribute('placeholder') === 'all'
  )!;
  setControl(weekInput, 'x7');

  // While the week is invalid, the target copy is honest — it never displays
  // the broader all-season description beneath invalid controls.
  assert.equal(
    getAllByText('invalid target — correct the controls before running').length,
    2,
    'invalid target shown in the control row and the disclosure'
  );

  fireEvent.click(getByRole('button', { name: 'Refresh scores and run attachment trace' }));
  getByText('Week must be blank (all weeks) or a whole number between 0 and 99.');
  assert.deepEqual(confirmMessages, [], 'no confirmation for an invalid target');
  assert.deepEqual(requests, [], 'no request');
});

test('a huge digit-string week is invalid — never silently broadened to a season run', () => {
  const { container, getByRole, getByText } = render(<ScoreAttachmentRecoveryPanel />);
  const weekInput = Array.from(container.querySelectorAll('input')).find(
    (i) => i.getAttribute('placeholder') === 'all'
  )!;
  // Would parse to 1e+22, serialize exponentially, and be rejected server-side
  // into an all-season scope if it ever reached the request.
  setControl(weekInput, '9999999999999999999999');

  fireEvent.click(getByRole('button', { name: 'Refresh scores and run attachment trace' }));
  getByText('Week must be blank (all weeks) or a whole number between 0 and 99.');
  assert.deepEqual(confirmMessages, []);
  assert.deepEqual(requests, []);
});

test('cancelling the confirmation performs zero requests and mutates no feedback', () => {
  confirmAnswer = false;
  const { container, getByRole, queryByText } = render(<ScoreAttachmentRecoveryPanel />);

  fireEvent.click(getByRole('button', { name: 'Refresh scores and run attachment trace' }));
  assert.equal(confirmMessages.length, 1, 'confirmation shown');
  assert.deepEqual(requests, [], 'cancel → zero fetches');
  assert.equal(queryByText(/Refreshing scores and building/), null, 'no loading state');
  assert.equal(queryByText(/Trace loaded/), null);
  assert.equal(container.querySelector('table'), null);
});

test('the confirmation names the captured target and the mutation consequences', () => {
  const year = seasonYearForToday();
  confirmAnswer = false;
  const { container, getByRole } = render(<ScoreAttachmentRecoveryPanel />);
  const weekInput = Array.from(container.querySelectorAll('input')).find(
    (i) => i.getAttribute('placeholder') === 'all'
  )!;
  setControl(weekInput, '17');
  setControl(container.querySelector('select')!, 'postseason');

  fireEvent.click(getByRole('button', { name: 'Refresh scores and run attachment trace' }));
  const message = confirmMessages[0]!;
  assert.match(message, new RegExp(`for ${year} postseason canonical week 17\\?`));
  assert.match(message, /update score caches and provider-refresh status/);
  assert.match(message, /invalidate standings when scores change/);
  assert.match(message, /fall back to provider-week requests/);
});

test('a confirmed all-season run uses exactly year-only params with admin headers, no-store', async () => {
  const year = seasonYearForToday();
  dom.window.sessionStorage.setItem('cfb_admin_token', 'test-token');
  try {
    const { getByRole, getByText } = render(<ScoreAttachmentRecoveryPanel />);
    fireEvent.click(getByRole('button', { name: 'Refresh scores and run attachment trace' }));

    await waitFor(() => getByText(/Trace loaded/));
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, `/api/debug/scores-attachment?year=${year}`);
    assert.equal(requests[0]!.init?.cache, 'no-store');
    assert.equal(
      (requests[0]!.init?.headers as Record<string, string>)['x-admin-token'],
      'test-token'
    );
  } finally {
    dom.window.sessionStorage.removeItem('cfb_admin_token');
  }
});

test('a confirmed targeted run carries the exact week and seasonType params; result renders counts + caveat', async () => {
  const year = seasonYearForToday();
  const { container, getByRole, getByText } = render(<ScoreAttachmentRecoveryPanel />);
  const weekInput = Array.from(container.querySelectorAll('input')).find(
    (i) => i.getAttribute('placeholder') === 'all'
  )!;
  setControl(weekInput, '4');
  setControl(container.querySelector('select')!, 'postseason');

  fireEvent.click(getByRole('button', { name: 'Refresh scores and run attachment trace' }));
  await waitFor(() => getByText(`Trace loaded — ${year} postseason canonical week 4`));

  assert.equal(
    requests[0]!.url,
    `/api/debug/scores-attachment?year=${year}&week=4&seasonType=postseason`
  );
  getByText('Provider rows: 42');
  getByText('Attached: 40');
  getByText('Actionable: 1');
  getByText('Ignored: 1');
  getByText('Indexed games: 39');
  getByText('unresolved_home_team: 1');
  getByText(/does not independently prove that every upstream refresh/);
  getByText(/Stage alias repairs on the Aliases page/);
});

test('controls and the submit button are disabled while an attempt is pending', async () => {
  let resolveFetch: ((r: Response) => void) | null = null;
  responder = () =>
    new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

  const { container, getByRole, getByText } = render(<ScoreAttachmentRecoveryPanel />);
  fireEvent.click(getByRole('button', { name: 'Refresh scores and run attachment trace' }));
  await waitFor(() => getByText(/Refreshing scores and building the attachment trace/));

  for (const input of Array.from(container.querySelectorAll('input, select, button'))) {
    assert.equal(
      (input as HTMLInputElement).disabled,
      true,
      `${input.tagName} disabled while pending`
    );
  }

  await act(async () => {
    resolveFetch!(Response.json(TRACE_FIXTURE));
    await new Promise((r) => setTimeout(r, 0));
  });
  await waitFor(() => getByText(/Trace loaded/));
});

test('one attempt at a time: a disabled re-click starts nothing, and a post-unmount response is inert', async () => {
  const pending: Array<(r: Response) => void> = [];
  responder = () =>
    new Promise<Response>((resolve) => {
      pending.push(resolve);
    });

  const { getByRole, getByText, unmount } = render(<ScoreAttachmentRecoveryPanel />);
  const button = getByRole('button', { name: 'Refresh scores and run attachment trace' });

  // Attempt 1 in flight — the submit button is disabled, so a second click can
  // neither confirm nor request (one active attempt at a time by design).
  fireEvent.click(button);
  await waitFor(() => getByText(/Refreshing scores and building/));
  fireEvent.click(button);
  assert.equal(confirmMessages.length, 1, 'no second confirmation while pending');
  assert.equal(pending.length, 1, 'no second request while pending');

  // The response resolving AFTER unmount is dropped by the attempt guard —
  // no state write, no thrown error.
  unmount();
  await act(async () => {
    pending[0]!(Response.json(TRACE_FIXTURE));
    await new Promise((r) => setTimeout(r, 0));
  });
});

test('a non-2xx response renders only the generic client error', async () => {
  responder = () => new Response('secret upstream body', { status: 502 });
  const { getByRole, getByText, queryByText } = render(<ScoreAttachmentRecoveryPanel />);
  fireEvent.click(getByRole('button', { name: 'Refresh scores and run attachment trace' }));

  await waitFor(() => getByText('Debug scores endpoint failed (502)'));
  assert.equal(queryByText(/secret upstream body/), null, 'no raw body exposure');
  assert.equal(queryByText(/Trace loaded/), null);
});

test('changing a target control after completion clears the prior result', async () => {
  const { container, getByRole, getByText, queryByText } = render(<ScoreAttachmentRecoveryPanel />);
  fireEvent.click(getByRole('button', { name: 'Refresh scores and run attachment trace' }));
  await waitFor(() => getByText(/Trace loaded/));

  const weekInput = Array.from(container.querySelectorAll('input')).find(
    (i) => i.getAttribute('placeholder') === 'all'
  )!;
  setControl(weekInput, '9');
  assert.equal(
    queryByText(/Trace loaded/),
    null,
    'a prior target’s trace never renders beneath new controls'
  );
});
