import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';

import { useForwardLook } from '../useForwardLook';
import { fixtureForwardContext } from '../../../test/forwardLookFixtures';
import { parseInsightsPayload, useInsightsFeed } from '../useInsightsFeed';
import { prepareForwardLookHistory } from '../../../lib/selectors/forwardLookRivalries';
import {
  forwardContext,
  forwardScore,
  addRivalry,
  FORWARD_NOW,
  FORWARD_SCOPE,
} from '../../../test/forwardLookFixtures';

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

const originalFetch = globalThis.fetch;
const ACTIVE_STATUS = { state: 'season', year: 2026 } as const;

function availableRecapPayload(week: number, owner = `Owner ${week}`) {
  return {
    status: 'available',
    week,
    weekLabel: `Week ${week}`,
    latestGameDate: week === 1 ? '2026-08-30' : '2026-09-06',
    headline: `${owner} takes the week at 1–0`,
    isIncomplete: false,
    ownerLines: [{ owner, recordLabel: '1–0', pointsLabel: '31 PF · 17 PA' }],
    leaderLines: [
      {
        id: 'best-record',
        label: 'Best record',
        value: '1–0',
        context: `${owner} · 31 PF`,
      },
    ],
    tileLeaderLines: [
      {
        id: 'best-record',
        label: 'Best record',
        value: '1–0',
        context: `${owner} · 31 PF`,
      },
    ],
    movementLines: [],
    recordChangeLines: [],
    headToHeadLines: [],
    notableResultLines: [],
    tileHighlights: [],
  };
}

function recapResponse(week: number, owner = `Owner ${week}`): Response {
  return new Response(
    JSON.stringify({
      insights: [{ id: `insight-${week}` }],
      lifecycleState: 'mid_season',
      generatedAt: '2026-09-01T00:00:00.000Z',
      weeklyRecap: availableRecapPayload(week, owner),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('Forward Look history survives same-scope failure but never crosses league scope', async () => {
  const look = prepareForwardLookHistory(forwardContext());
  let fail = false;
  globalThis.fetch = (async () => {
    if (fail) throw new Error('offline');
    return new Response(
      JSON.stringify({
        insights: [{ id: 'standing' }],
        weeklyRecap: availableRecapPayload(1),
        forwardLook: look,
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  const view = renderHook(
    ({ slug }) =>
      useInsightsFeed({
        leagueSlug: slug,
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        nowTick: FORWARD_NOW.getTime(),
      }),
    { initialProps: { slug: 'tsc' } }
  );
  await waitFor(() => assert.equal(view.result.current.forwardLook?.seasonYear, 2026));
  fail = true;
  act(() => view.result.current.refreshInsights());
  await waitFor(() => assert.equal(view.result.current.weeklyRecap.status, 'unavailable'));
  assert.deepEqual(view.result.current.forwardLook, look, 'same-scope failure retains history');
  assert.equal(view.result.current.insights.length, 1, 'standing feed is preserved');
  fail = false;
  act(() => view.result.current.refreshInsights());
  await waitFor(() => assert.ok(view.result.current.forwardLook));
  fail = true;
  view.rerender({ slug: 'other-league' });
  assert.equal(
    view.result.current.forwardLook,
    null,
    'scope change withholds the previous league history'
  );
  await waitFor(() => assert.equal(view.result.current.weeklyRecap.status, 'unavailable'));
  assert.equal(
    view.result.current.forwardLook,
    null,
    'failed new scope never inherits last-good history'
  );
  view.rerender({ slug: '' });
  assert.equal(
    view.result.current.forwardLook,
    null,
    'slugless surface cannot retain another league preview'
  );
});

test('invalid recap data cannot empty an otherwise healthy insights payload', () => {
  const parsed = parseInsightsPayload({
    insights: [{ id: 'healthy-insight' }],
    lifecycleState: 'mid_season',
    weeklyRecap: { status: 'available', week: 'not-a-number' },
  });

  assert.equal(parsed.insights.length, 1);
  assert.equal(parsed.lifecycleState, 'mid_season');
  assert.deepEqual(parsed.weeklyRecap, { status: 'unavailable' });
});

test('an older recap remains available when additive detail fields are absent', () => {
  const recap = availableRecapPayload(1, 'Alice');
  Reflect.deleteProperty(recap, 'leaderLines');
  Reflect.deleteProperty(recap, 'tileLeaderLines');
  Reflect.deleteProperty(recap, 'movementLines');
  Reflect.deleteProperty(recap, 'recordChangeLines');
  Reflect.deleteProperty(recap, 'headToHeadLines');
  Reflect.deleteProperty(recap, 'notableResultLines');
  Reflect.deleteProperty(recap, 'tileHighlights');
  const parsed = parseInsightsPayload({
    insights: [{ id: 'healthy-insight' }],
    weeklyRecap: recap,
  });

  assert.equal(parsed.weeklyRecap.status, 'available');
  if (parsed.weeklyRecap.status !== 'available') return;
  assert.deepEqual(parsed.weeklyRecap.leaderLines, []);
  assert.deepEqual(parsed.weeklyRecap.tileLeaderLines, []);
  assert.deepEqual(parsed.weeklyRecap.movementLines, []);
  assert.deepEqual(parsed.weeklyRecap.recordChangeLines, []);
  assert.deepEqual(parsed.weeklyRecap.headToHeadLines, []);
  assert.deepEqual(parsed.weeklyRecap.notableResultLines, []);
  assert.deepEqual(parsed.weeklyRecap.tileHighlights, []);
});

test('malformed present detail fields fail only the recap', () => {
  for (const [field, malformed] of [
    ['leaderLines', [{ id: 'best-record' }]],
    ['tileLeaderLines', 'not-an-array'],
    ['movementLines', [{ owner: 'Alice', direction: 'sideways' }]],
    ['recordChangeLines', [{ kind: 'record-change', id: 'record' }]],
    ['headToHeadLines', [{ kind: 'game', id: 'game' }]],
    ['notableResultLines', 'not-an-array'],
    ['tileHighlights', [{ kind: 'unknown' }]],
  ] as const) {
    const parsed = parseInsightsPayload({
      insights: [{ id: 'healthy-insight' }],
      lifecycleState: 'mid_season',
      weeklyRecap: { ...availableRecapPayload(1, 'Alice'), [field]: malformed },
    });

    assert.equal(parsed.insights.length, 1, `${field} must not empty the feed`);
    assert.deepEqual(parsed.weeklyRecap, { status: 'unavailable' });
  }
});

test('a stale response cannot overwrite a newer league request', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return calls === 1 ? first.promise : second.promise;
  }) as typeof fetch;

  const view = renderHook(
    ({ leagueSlug }) =>
      useInsightsFeed({
        leagueSlug,
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        nowTick: Date.parse('2026-09-07T16:00:00.000Z'),
      }),
    { initialProps: { leagueSlug: 'alpha' } }
  );

  view.rerender({ leagueSlug: 'beta' });
  await act(async () => {
    second.resolve(recapResponse(2, 'Beta'));
    await second.promise;
  });
  await waitFor(() => assert.equal(view.result.current.weeklyRecap.status, 'available'));
  assert.match(
    view.result.current.weeklyRecap.status === 'available'
      ? (view.result.current.weeklyRecap.headline ?? '')
      : '',
    /Beta/
  );

  await act(async () => {
    first.resolve(recapResponse(1, 'Alpha'));
    await first.promise;
  });
  assert.equal(calls, 2);
  assert.match(
    view.result.current.weeklyRecap.status === 'available'
      ? (view.result.current.weeklyRecap.headline ?? '')
      : '',
    /Beta/
  );
});

test('non-Overview surfaces skip the feed request until the Overview is entered', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return recapResponse(1);
  }) as typeof fetch;

  const view = renderHook(
    ({ enabled }) =>
      useInsightsFeed({
        leagueSlug: 'tsc',
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        nowTick: Date.parse('2026-09-07T16:00:00.000Z'),
        enabled,
      }),
    { initialProps: { enabled: false } }
  );

  await act(async () => Promise.resolve());
  assert.equal(calls, 0, 'disabled is the negative observation');
  assert.equal(view.result.current.weeklyRecap.status, 'inactive');

  view.rerender({ enabled: true });
  await waitFor(() => assert.equal(calls, 1));
  await waitFor(() => assert.equal(view.result.current.weeklyRecap.status, 'available'));
});

test('the open page refetches exactly once at 06:00 ET without a usable client schedule', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return recapResponse(calls === 1 ? 1 : 2);
  }) as typeof fetch;
  const view = renderHook(
    ({ nowTick }) =>
      useInsightsFeed({
        leagueSlug: 'tsc',
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        nowTick,
      }),
    { initialProps: { nowTick: Date.parse('2026-09-07T09:59:00.000Z') } }
  );

  await waitFor(() => {
    assert.equal(view.result.current.weeklyRecap.status, 'available');
    if (view.result.current.weeklyRecap.status === 'available') {
      assert.equal(view.result.current.weeklyRecap.week, 1);
    }
  });
  assert.equal(calls, 1);

  view.rerender({ nowTick: Date.parse('2026-09-07T10:00:00.000Z') });
  await waitFor(() => {
    assert.equal(view.result.current.weeklyRecap.status, 'available');
    if (view.result.current.weeklyRecap.status === 'available') {
      assert.equal(view.result.current.weeklyRecap.week, 2);
    }
  });
  assert.equal(calls, 2);

  view.rerender({ nowTick: Date.parse('2026-09-07T10:01:00.000Z') });
  await act(async () => Promise.resolve());
  assert.equal(calls, 2);
});

test('a failed boundary refresh preserves the healthy standing feed', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1)
      return new Response(
        JSON.stringify({
          weeklyRecap: availableRecapPayload(1),
          insights: [{ id: 'standing' }],
          lifecycleState: 'mid_season',
          forwardLook: prepareForwardLookHistory(forwardContext()),
        })
      );
    throw new Error('temporary network failure');
  }) as typeof fetch;

  const view = renderHook(
    ({ nowTick }) =>
      useInsightsFeed({
        leagueSlug: 'tsc',
        seasonYear: 2026,
        leagueStatus: ACTIVE_STATUS,
        nowTick,
      }),
    { initialProps: { nowTick: Date.parse('2026-09-07T09:59:00.000Z') } }
  );

  await waitFor(() => {
    assert.equal(view.result.current.weeklyRecap.status, 'available');
    assert.equal(view.result.current.insights.length, 1);
  });

  view.rerender({ nowTick: Date.parse('2026-09-07T10:00:00.000Z') });
  await waitFor(() => assert.equal(calls, 2));
  await waitFor(() => assert.equal(view.result.current.weeklyRecap.status, 'unavailable'));
  assert.equal(calls, 2);
  assert.equal(view.result.current.insights.length, 1);
  assert.equal(view.result.current.lifecycleState, 'mid_season');
  assert.equal(
    view.result.current.forwardLook?.seasonYear,
    2026,
    'boundary failure retains history'
  );
});

for (const arrival of ['scores-first', 'history-first'] as const) {
  test(`local composition has no bootstrap absorption or result refetch (${arrival})`, async () => {
    const context = forwardContext();
    addRivalry(context, ['Alice', 'Alice', 'Alice', 'Alice', 'Alice']);
    const client = fixtureForwardContext(context);
    let calls = 0;
    const response = deferred<Response>();
    globalThis.fetch = (() => {
      calls++;
      return response.promise;
    }) as typeof fetch;
    const initialScores = arrival === 'scores-first' ? client.scoresByKey : {};
    const view = renderHook(
      ({ scores, ready, tick }) => {
        const feed = useInsightsFeed({ leagueSlug: 'tsc', ...FORWARD_SCOPE, nowTick: tick });
        const look = useForwardLook({
          ...client,
          ...FORWARD_SCOPE,
          scoresByKey: scores,
          history: feed.forwardLook,
          scheduleLoaded: true,
          scoresReady: ready,
          enabled: true,
          nowTick: tick,
        });
        return { feed, look };
      },
      {
        initialProps: {
          scores: initialScores,
          ready: arrival === 'scores-first',
          tick: FORWARD_NOW.getTime(),
        },
      }
    );
    await act(async () =>
      response.resolve(new Response(JSON.stringify({ forwardLook: client.history })))
    );
    view.rerender({ scores: client.scoresByKey, ready: true, tick: FORWARD_NOW.getTime() });
    assert.equal(
      view.result.current.look?.lines.some((line) => line.value === '6 straight'),
      true,
      'initial finals compose without another generation'
    );
    assert.equal(calls, 1, 'initial final requires zero refreshes');
    view.rerender({
      scores: { ...client.scoresByKey, prior: forwardScore(7, 21) },
      ready: true,
      tick: FORWARD_NOW.getTime(),
    });
    assert.equal(
      view.result.current.look?.lines.some((line) => line.family === 'rivalry'),
      false,
      'score correction immediately breaks the held streak'
    );
    assert.equal(calls, 1, 'corrected final requires zero Insights refreshes');
    view.rerender({
      scores: client.scoresByKey,
      ready: true,
      tick: FORWARD_NOW.getTime() + 60_000,
    });
    assert.equal(
      view.result.current.look?.lines.some((line) => line.value === '6 straight'),
      true,
      'returning result restores the claim from displayed scores'
    );
    assert.equal(calls, 1, 'ordinary clock ticks require zero Insights refreshes');
    view.rerender({
      scores: { ...client.scoresByKey, collision: forwardScore() },
      ready: true,
      tick: FORWARD_NOW.getTime() + 120_000,
    });
    assert.deepEqual(
      view.result.current.look?.lines,
      [],
      'displayed final immediately removes its upcoming claims'
    );
    assert.equal(calls, 1, 'new final requires zero Insights refreshes');
    act(() => view.result.current.feed.refreshInsights());
    await waitFor(() =>
      assert.equal(calls, 2, 'positive control: explicit refresh still issues a request')
    );
  });
}

test('client boundary contains preparation and composition faults, skips hidden composition, and reuses preparation across odds changes', async () => {
  const { build } = await import('esbuild');
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { createRequire } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  const React = await import('react');
  const { render } = await import('@testing-library/react');
  const { default: RecapTile } = await import('../../recap/RecapTile');
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../useForwardLook.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['react'],
    plugins: [
      {
        name: 'observe-composition',
        setup(builder) {
          builder.onLoad(
            { filter: /\/(forwardLook|composeForwardLook)\.ts$/ },
            async ({ path }) => {
              const name = path.endsWith('/composeForwardLook.ts')
                ? 'composeForwardLook'
                : 'prepareForwardLook';
              const source = await readFile(path, 'utf8');
              return {
                loader: 'ts',
                contents:
                  source.replace(`export function ${name}(`, `function actual_${name}(`) +
                  `\nexport function ${name}(...args) { globalThis.probe.${name}++; if(globalThis.probe.fault === '${name}') throw new Error('injected '+ '${name}'); return actual_${name}(...args); }`,
              };
            }
          );
        },
      },
    ],
  });
  const probe = { prepareForwardLook: 0, composeForwardLook: 0, fault: '' };
  const bundledModule = { exports: {} as { useForwardLook: typeof useForwardLook } };
  runInNewContext(bundle.outputFiles[0].text, {
    module: bundledModule,
    exports: bundledModule.exports,
    require: createRequire(import.meta.url),
    process,
    probe,
  });
  const client = fixtureForwardContext(forwardContext());
  const args: Parameters<typeof useForwardLook>[0] = {
    ...client,
    ...FORWARD_SCOPE,
    enabled: true,
    scheduleLoaded: true,
    scoresReady: true,
    nowTick: FORWARD_NOW.getTime(),
  };
  let look: ReturnType<typeof useForwardLook> = null;
  function Harness({ input }: { input: typeof args }) {
    look = bundledModule.exports.useForwardLook(input);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(RecapTile, {
        recap: availableRecapPayload(1) as Parameters<typeof RecapTile>[0]['recap'],
      }),
      React.createElement('p', null, 'Standing Insights remain'),
      React.createElement('output', null, look?.weekLabel ?? 'no look')
    );
  }
  const view = render(
    React.createElement(Harness, { input: { ...args, nowTick: FORWARD_NOW.getTime() - 60_000 } })
  );
  assert.equal(probe.composeForwardLook, 0, 'hidden tile does not compose');
  view.rerender(React.createElement(Harness, { input: args }));
  assert.equal(probe.composeForwardLook, 1, 'visible positive control composes');
  const preparations = probe.prepareForwardLook;
  view.rerender(React.createElement(Harness, { input: { ...args, oddsByKey: {} } }));
  assert.equal(
    probe.prepareForwardLook,
    preparations,
    'odds arrival never repeats schedule preparation'
  );
  assert.equal(probe.composeForwardLook, 2, 'odds change recomposes');
  probe.fault = 'composeForwardLook';
  let compositionThrew = false;
  try {
    view.rerender(
      React.createElement(Harness, { input: { ...args, nowTick: args.nowTick + 60_000 } })
    );
  } catch {
    compositionThrew = true;
  }
  assert.equal(
    !compositionThrew && view.queryByText('Weekly recap') !== null,
    true,
    'recap still renders after composition throws'
  );
  assert.equal(
    view.queryByText('no look') !== null,
    true,
    'composition fault withholds only Forward Look'
  );
  assert.equal(
    view.getByText('Standing Insights remain') !== null,
    true,
    'feed still renders after composition throws'
  );
  probe.fault = 'prepareForwardLook';
  view.rerender(React.createElement(Harness, { input: { ...args, games: [...args.games] } }));
  assert.equal(
    view.getByText('Weekly recap') !== null,
    true,
    'recap still renders after preparation throws'
  );
  assert.equal(
    probe.prepareForwardLook,
    preparations + 1,
    'explicit schedule update repeats preparation'
  );
  probe.fault = '';
  view.rerender(
    React.createElement(Harness, { input: { ...args, games: [...args.games], history: null } })
  );
  assert.equal(
    view.queryByText('Week 6') !== null,
    true,
    'history absence permits healthy families'
  );
  view.rerender(
    React.createElement(Harness, { input: { ...args, scoresReady: false, scoresByKey: {} } })
  );
  assert.equal(view.queryByText('no look') !== null, true, 'unread empty scores remain loading');
});

test('the production hook changes over at both Eastern boundaries and recomposes expired games and prices', () => {
  const client = fixtureForwardContext(forwardContext());
  const args = {
    ...client,
    ...FORWARD_SCOPE,
    scheduleLoaded: true,
    scoresReady: true,
    enabled: true,
    nowTick: FORWARD_NOW.getTime() - 60_000,
  };
  const view = renderHook((input) => useForwardLook(input), { initialProps: args });
  assert.equal(view.result.current === null, true, 'hook stays hidden before 06:00 ET');
  view.rerender({ ...args, nowTick: FORWARD_NOW.getTime() });
  assert.equal(view.result.current?.weekLabel, 'Week 6', 'hook reveals the preview at 06:00 ET');
  assert.equal(
    view.result.current?.lines.some((line) => line.family === 'upset'),
    true,
    'fresh price control renders'
  );
  view.rerender({ ...args, nowTick: Date.parse('2026-10-09T09:00:00Z') });
  assert.equal(
    view.result.current?.lines.some((line) => line.family === 'upset'),
    false,
    'hook removes a price at its exact expiry'
  );
  assert.equal(
    view.result.current?.lines.some((line) => line.family === 'standings'),
    true,
    'price expiry retains the unstarted game'
  );
  view.rerender({ ...args, nowTick: Date.parse('2026-10-10T19:00:00Z') });
  assert.deepEqual(view.result.current?.lines, [], 'hook removes all game claims at kickoff');
  view.rerender({ ...args, nowTick: Date.parse('2026-10-11T10:00:00Z') });
  assert.equal(
    view.result.current === null,
    true,
    'hook ends the preview at next recap eligibility'
  );
});

test('late or malformed history leaves healthy families available and a later history response recomposes', () => {
  const context = forwardContext();
  addRivalry(context, ['Alice', 'Alice', 'Alice', 'Alice', 'Alice']);
  const client = fixtureForwardContext(context);
  const args = {
    ...client,
    ...FORWARD_SCOPE,
    scheduleLoaded: true,
    scoresReady: true,
    enabled: true,
    nowTick: FORWARD_NOW.getTime(),
  };
  const view = renderHook((input) => useForwardLook(input), {
    initialProps: { ...args, history: null as typeof client.history | null },
  });
  assert.deepEqual(
    view.result.current?.lines.map((line) => line.family),
    ['standings', 'upset'],
    'history loading preserves the independent families'
  );
  const parsed = parseInsightsPayload({
    forwardLook: {
      ...client.history,
      rivalries: [{ owners: ['Bob', 'Alice'], wins: [3, 0], streak: null }],
    },
  });
  view.rerender({ ...args, history: parsed.forwardLook });
  assert.deepEqual(
    view.result.current?.lines.map((line) => line.family),
    ['standings', 'upset'],
    'malformed history suppresses only rivalries through parser and hook'
  );
  view.rerender(args);
  assert.equal(
    view.result.current?.lines.some((line) => line.value === '6 straight'),
    true,
    'later history adds the verified rivalry'
  );
});
