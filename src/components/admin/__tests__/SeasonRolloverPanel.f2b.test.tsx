import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import React from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import SeasonRolloverPanel from '../SeasonRolloverPanel';
import type {
  ManualRolloverPreviewResponse,
  ManualRolloverStatusResponse,
  ManualRolloverYearStatus,
} from '@/lib/manualRollover';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — the panel consumes the per-year contract: every year renders
// its own eligibility state and requests carry the row's explicit year.
//
// PLATFORM-086F2H3A — it is now the ONE rollover surface, and it is READ-ONLY.
// Manual execution is retired, so no control here writes anything. What the
// panel owes an operator: current readiness that loads automatically, an empty
// state that stays VISIBLE (proof the check ran), a deliberate preview that
// never fires on render, and a warning when production leagues disagree on
// their season year.
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

type Recorded = { method: string; body: { year?: number; confirmed?: unknown } | null };

let requests: Recorded[] = [];
let statusPayload: ManualRolloverStatusResponse;
let previewResponder: (body: { year?: number }) => Response;
const originalFetch = globalThis.fetch;

function makeYearStatus(
  year: number,
  eligibility: ManualRolloverYearStatus['eligibility'],
  overrides: Partial<ManualRolloverYearStatus> = {}
): ManualRolloverYearStatus {
  return {
    year,
    eligibility,
    reason:
      eligibility === 'eligible'
        ? null
        : eligibility === 'unavailable'
          ? 'read-failed'
          : 'waiting-period',
    championshipDate: eligibility === 'eligible' ? `${year + 1}-01-09T00:00:00.000Z` : null,
    rolloverDate: eligibility === 'eligible' ? `${year + 1}-01-16T00:00:00.000Z` : null,
    leagues: [
      {
        slug: `alpha-${year}`,
        displayName: `Alpha ${year}`,
        year,
        createdAt: '2022-01-01T00:00:00.000Z',
        status: { state: 'season', year },
      },
      {
        slug: `bravo-${year}`,
        displayName: `Bravo ${year}`,
        year,
        createdAt: '2022-01-01T00:00:00.000Z',
        status: { state: 'season', year },
      },
    ],
    ...overrides,
  };
}

/** A preview whose league has NO existing archive — the fresh-write case. */
function previewResponse(year: number): ManualRolloverPreviewResponse {
  return {
    invalidLifecycleTargets: 0,
    preview: {
      year,
      championshipDate: `${year + 1}-01-09T00:00:00.000Z`,
      rolloverDate: `${year + 1}-01-16T00:00:00.000Z`,
      leagues: [
        {
          leagueSlug: `alpha-${year}`,
          displayName: `Alpha ${year}`,
          status: { state: 'season', year },
          hasExistingArchive: false,
          champion: 'Alice',
          top3: [{ position: 1, owner: 'Alice', wins: 10, losses: 2, ties: 0 }],
          diff: null,
          error: null,
        },
      ],
    },
  };
}

/**
 * A preview whose league DOES have an existing archive, carrying the diff detail
 * that only the retired `RolloverPanel` used to render. This fixture is what
 * makes the consolidation's central claim testable: merging by capability, not
 * by deleting a component.
 */
function overwritePreviewResponse(year: number): ManualRolloverPreviewResponse {
  const base = previewResponse(year);
  return {
    ...base,
    preview: {
      ...base.preview,
      leagues: [
        {
          ...base.preview.leagues[0]!,
          hasExistingArchive: true,
          diff: {
            scoresChanged: 3,
            outcomesFlipped: 2,
            ownersAffectedByFlip: ['Dana', 'Ellis'],
            standingsOrderChanged: true,
            standingsMovement: [
              { ownerName: 'Dana', previousPosition: 4, newPosition: 2 },
              { ownerName: 'Ellis', previousPosition: 2, newPosition: 4 },
            ],
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  requests = [];
  previewResponder = (body) => Response.json(previewResponse(body.year!));
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Recorded['body']) : null;
    requests.push({ method, body });
    if (method === 'GET') return Response.json(statusPayload);
    return previewResponder(body!);
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('ineligible and unavailable years expose reasons but never a preview or execute control', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'not-eligible'), makeYearStatus(2024, 'unavailable')],
  };

  const { getByText, queryByRole } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText('Season 2023'));
  getByText('Season 2024');
  getByText('The seven-day waiting period after the national championship has not elapsed.');
  getByText('Eligibility unavailable');
  getByText(/durable store read failed/);
  // Negative DOM assertions compare to `null` via `assert.ok(x === null)`, never
  // `assert.equal(node, null)`. On FAILURE the latter hands a live JSDOM element
  // to node:assert's diff renderer, which walks the node's circular structure
  // until the runner is SIGKILLed — so the mutation that should name this test
  // instead hangs the file. A negative assertion that cannot report which test
  // caught the defect is a bad kill signal.
  assert.ok(queryByRole('button', { name: /Preview/i }) === null, 'no preview control');
  assert.ok(queryByRole('button', { name: /Execute|Confirm|Run/i }) === null, 'no execute control');
});

// PLATFORM-086F2H3A — the empty state stays VISIBLE: it is the operator's proof
// that the check ran and succeeded, not a section that vanishes.
//
// This IS the demo-only case. `groupRolloverTargets` excludes the demo upstream,
// so a season where only the demo is active reaches the panel as an empty
// `years` array — indistinguishable, by design, from no league being in season.
//
// The "the demo is never named" half is deliberately NOT asserted here. With
// `years: []` the panel renders no league rows at all, so any loop over rows
// would be vacuous and would pass against a panel that named the demo loudly.
// The guarantee is real and is proven where it can fail: the route suite feeds a
// registry whose ONLY in-season league is the demo, asserts the slug never
// reaches the response, and pairs it with a positive control showing a
// production league on the same fixture DOES. Adding a redundant UI-side filter
// purely to make an assertion possible here would be the wrong fix.
test('no production rollover target renders the visible empty state', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    years: [],
    invalidLifecycleTargets: 0,
  };
  const { container, getByText } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText('No production leagues are waiting for rollover.'));
  // The section itself survives — hiding it would leave an operator unable to
  // tell a successful empty check from a panel that failed to render.
  assert.ok(container.querySelector('section'), 'the section stays mounted');
  getByText('Season Rollover');
});

// REGRESSION TEST (PLATFORM-086F2H1R4) — an all-refused registry must NOT read
// as "no production leagues are waiting". Leagues ARE in season; they are merely
// unusable, and the remedy is a data repair.
test('refused production records replace the empty message with the repair message', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    years: [],
    invalidLifecycleTargets: 2,
  };
  const { getByText, queryByText } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText(/2 league record\(s\) in season carry an unusable season year/));
  assert.equal(
    queryByText('No production leagues are waiting for rollover.'),
    null,
    'the two empty states are exclusive — the refusal is the truthful one here'
  );
});

test('a single production year renders simply, with no disagreement warning', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible')],
  };
  const { getByText, queryByText } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText('Season 2023'));
  assert.ok(queryByText(/disagree on their season year/) === null, 'no disagreement warning');
});

// PLATFORM-086F2H3A — different production years are not a supported workflow.
// They appear after a partial rollover, a lifecycle failure, stale stored data,
// or a league created mid-rollover. Warn, then keep both groups inspectable —
// the warning is for diagnosis, so hiding the evidence would defeat it.
test('multiple production years warn AND stay separately inspectable', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible'), makeYearStatus(2024, 'not-eligible')],
  };
  const { getAllByRole, getByText } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText(/disagree on their season year/));
  getByText(/2023, 2024/);

  getByText('Season 2023');
  getByText('Season 2024');
  getByText('The seven-day waiting period after the national championship has not elapsed.');
  assert.equal(
    getAllByRole('button', { name: /Preview archive changes/ }).length,
    1,
    'the eligible year keeps its preview; the ineligible one has none'
  );
});

// The two abnormal conditions are independent and can co-occur: a registry can
// hold both a year disagreement and refused records, each separately actionable.
test('a year disagreement and refused records render together', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 1,
    years: [makeYearStatus(2023, 'eligible'), makeYearStatus(2024, 'eligible')],
  };
  const { getByText, queryByText } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText(/disagree on their season year/));
  // The refusal message is bound to the EMPTY state, so with groups present the
  // count does not render here — pinning that so the composition is deliberate
  // rather than discovered later as a missing signal.
  assert.ok(queryByText(/unusable season year/) === null, 'refusal count is empty-state-bound');
  getByText('Season 2023');
  getByText('Season 2024');
});

// PLATFORM-086F2H3A — status loads automatically; preview does NOT. Building a
// preview walks the full scored season for every league in the group, and an
// inspection nobody asked for is work nobody reads.
test('initial render loads status once and previews nothing', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible'), makeYearStatus(2024, 'eligible')],
  };
  const { getByText } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText('Season 2023'));

  assert.equal(requests.filter((r) => r.method === 'GET').length, 1, 'exactly one status read');
  assert.deepEqual(
    requests.filter((r) => r.method === 'POST'),
    [],
    'no preview was built on render'
  );
});

// REGRESSION TEST — the ported diff detail. Owner NAMES and standings movement
// existed only on the deleted `RolloverPanel`; this panel previously showed bare
// counts. Consolidating by deleting a component would have destroyed the
// preview's most specific information, which is why the merge was by capability.
test('preview carries overwrite warning, affected owners by name, and standings movement', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible')],
  };
  previewResponder = (body) => Response.json(overwritePreviewResponse(body.year!));

  const { getByRole, getByText, queryByRole } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText('Season 2023'));

  fireEvent.click(getByRole('button', { name: 'Preview archive changes' }));
  await waitFor(() => getByText(/Previewing rollover for season/));

  // The request carries the explicit year and NO `confirmed` — a body that still
  // sent `confirmed: true` would now be refused as a retired capability.
  const post = requests.find((r) => r.method === 'POST');
  assert.deepEqual(post?.body, { year: 2023 });

  getByText('Existing 2023 archive will be overwritten');
  getByText(/Score changes: 3 owner records affected/);
  getByText(/Dana, Ellis/);
  getByText(/Dana 4→2, Ellis 2→4/);
  // Retained from this panel's own preview — the archive's CONTENT, not just
  // what changed about it.
  getByText(/Champion:/);
  getByText(/Alice — 10-2/);

  // The preview is an inspection report, not a confirmation screen.
  assert.ok(
    queryByRole('button', { name: /Execute|Confirm|Run/i }) === null,
    'the preview is an inspection report, not a confirmation screen'
  );
});

// REGRESSION TEST (PLATFORM-086F2H3A) — `standingsOrderChanged` compares the
// joined owner SEQUENCE, but `standingsMovement` only carries owners present in
// BOTH archives whose position changed. An owner added to (or removed from) the
// tail therefore sets the flag with an EMPTY movement list, and the inherited
// markup rendered "changed — " with nothing after the dash: an assertion of
// change with no evidence. Reproduced with the exact shape `diffSeasonArchives`
// produces for that case.
test('a changed standings order with no shared-owner movement still explains itself', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible')],
  };
  previewResponder = (body) => {
    const base = overwritePreviewResponse(body.year!);
    return Response.json({
      ...base,
      preview: {
        ...base.preview,
        leagues: [
          {
            ...base.preview.leagues[0]!,
            diff: {
              ...base.preview.leagues[0]!.diff!,
              outcomesFlipped: 0,
              ownersAffectedByFlip: [],
              standingsOrderChanged: true,
              standingsMovement: [],
            },
          },
        ],
      },
    });
  };

  const { getByRole, getByText, queryByText } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText('Season 2023'));
  fireEvent.click(getByRole('button', { name: 'Preview archive changes' }));

  await waitFor(() => getByText(/the ranked owners differ; no owner in both archives moved/));
  assert.ok(
    queryByText(/Final standings order: changed —\s*$/) === null,
    'never a dangling dash with no evidence after it'
  );
});

test('a preview of a league with no existing archive reports a fresh write', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible')],
  };
  const { getByRole, getByText } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText('Season 2023'));

  fireEvent.click(getByRole('button', { name: 'Preview archive changes' }));
  await waitFor(() => getByText(/New archive — the 2023 season would be written fresh/));
});

test('a gate refusal on preview shows the stable reason and resyncs status', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible')],
  };
  previewResponder = () =>
    Response.json({ error: 'rollover-not-eligible', reason: 'not-final' }, { status: 409 });

  const { getByRole, getByText, queryByText } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText('Season 2023'));

  fireEvent.click(getByRole('button', { name: 'Preview archive changes' }));

  await waitFor(() => getByText(/Rollover refused: .*not final yet/));
  assert.ok(queryByText(/Previewing rollover for season/) === null, 'no preview rendered');
  assert.equal(requests.filter((r) => r.method === 'GET').length, 2, 'the refusal resynced status');
});

// PLATFORM-086F2H3A — a stale client that still sends the retired verb gets a
// typed refusal; the panel must render it as a retired capability rather than a
// transient error worth retrying.
test('the retired-execution refusal renders operator-readable language', async () => {
  statusPayload = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    invalidLifecycleTargets: 0,
    years: [makeYearStatus(2023, 'eligible')],
  };
  previewResponder = () => Response.json({ error: 'rollover-execution-retired' }, { status: 409 });

  const { getByRole, getByText } = render(<SeasonRolloverPanel />);
  await waitFor(() => getByText('Season 2023'));

  fireEvent.click(getByRole('button', { name: 'Preview archive changes' }));
  await waitFor(() => getByText(/execution has been retired/));
});
