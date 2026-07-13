import assert from 'node:assert/strict';
import test from 'node:test';

import {
  combineOutcomes,
  controlModeLabel,
  datasetControlMode,
  interpretRefreshResponse,
  isCurrentStatusResponse,
  isSelectedYear,
  manualActionKey,
  manualRefreshUrls,
  scoresAggregateRefreshUrl,
  shouldApplyStatusResponse,
} from '../manualRefresh.ts';
import { getProviderDatasetDescriptor } from '../../../lib/providerDatasets.ts';

// ---- Finding #2: manual game-stats refresh targets the right season type ----

test('game-stats manual refresh includes the selected season type', () => {
  const regular = manualRefreshUrls('game-stats', { year: 2026, week: 3, seasonType: 'regular' });
  assert.equal(regular.length, 1);
  assert.match(regular[0], /seasonType=regular/);
  assert.match(regular[0], /week=3/);

  const post = manualRefreshUrls('game-stats', { year: 2026, week: 1, seasonType: 'postseason' });
  assert.match(post[0], /seasonType=postseason/);
  assert.match(post[0], /week=1/);
  assert.doesNotMatch(post[0], /seasonType=regular/);
});

// ---- Finding #4 + 7th-review #1: ONE aggregate request, server-authoritative ----

test('scores manual refresh issues ONE ordinary aggregate request with NO client seasonTypes', () => {
  // Server-authoritative applicability (7th review): the ordinary refresh omits
  // seasonTypes so the SERVER derives applicable partitions cache-only — the client
  // can never force an unnecessary (doomed postseason) partition.
  const urls = manualRefreshUrls('scores', { year: 2026 });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /aggregate=1/);
  assert.match(urls[0], /refresh=1/);
  assert.doesNotMatch(urls[0], /seasonTypes=/);
});

test('scoresAggregateRefreshUrl: ordinary form omits seasonTypes (server derives)', () => {
  const url = scoresAggregateRefreshUrl(2026);
  assert.match(url, /aggregate=1/);
  assert.doesNotMatch(url, /seasonTypes=/);
});

test('scoresAggregateRefreshUrl: explicit targeted repair carries only the requested partition', () => {
  const post = scoresAggregateRefreshUrl(2026, ['postseason']);
  assert.match(post, /seasonTypes=postseason/);
  assert.doesNotMatch(post, /regular/);

  const both = scoresAggregateRefreshUrl(2026, ['regular', 'postseason']);
  assert.match(both, /seasonTypes=regular,postseason/);
});

test('regular success plus skipped postseason combines to overall success', () => {
  // With postseason skipped, the action issues one request; a single success is
  // an overall success (no inapplicable partition drags it to failure).
  const outcome = combineOutcomes([{ ok: true }]);
  assert.equal(outcome.ok, true);
});

// ---- 7th-review finding #2: year-race guard for the provider-status feed ----

test('isCurrentStatusResponse: the latest matching-year response is applied', () => {
  assert.equal(
    isCurrentStatusResponse({
      requestSeq: 3,
      latestSeq: 3,
      requestedYear: 2026,
      responseYear: 2026,
    }),
    true
  );
});

test('isCurrentStatusResponse: a superseded (older seq) response is dropped', () => {
  // request A (seq 2, year 2025) resolves AFTER request B (seq 3, year 2026).
  assert.equal(
    isCurrentStatusResponse({
      requestSeq: 2,
      latestSeq: 3,
      requestedYear: 2025,
      responseYear: 2025,
    }),
    false,
    'an older year request resolving last must not overwrite the newer feed'
  );
});

test('isCurrentStatusResponse: a year-mismatched response is dropped even if it is the latest', () => {
  // Defense in depth: the newest request, but the server echoed a different year.
  assert.equal(
    isCurrentStatusResponse({
      requestSeq: 4,
      latestSeq: 4,
      requestedYear: 2026,
      responseYear: 2025,
    }),
    false
  );
});

test('isCurrentStatusResponse: an older failure cannot replace a newer success', () => {
  // Modeled as the older request (seq 1) never being current once seq 2 is latest.
  assert.equal(
    isCurrentStatusResponse({
      requestSeq: 1,
      latestSeq: 2,
      requestedYear: 2025,
      responseYear: 2025,
    }),
    false
  );
});

// ---- Hotfix requirement 10: manual action state keyed by year + dataset ----

test('manual action state keyed by year + dataset', () => {
  assert.equal(manualActionKey(2025, 'scores'), '2025:scores');
  assert.equal(manualActionKey(2026, 'scores'), '2026:scores');
});

test('A success not displayed under B: the 2025 key differs from the 2026 key', () => {
  const actions: Record<string, string> = {};
  actions[manualActionKey(2025, 'scores')] = 'success';
  // Rendering the 2026 Scores card reads the 2026-keyed slot, which is empty.
  assert.equal(actions[manualActionKey(2026, 'scores')], undefined);
});

test('switching back to A restores only A’s keyed result', () => {
  const actions: Record<string, string> = {};
  actions[manualActionKey(2025, 'scores')] = 'success';
  actions[manualActionKey(2026, 'scores')] = 'error';
  assert.equal(actions[manualActionKey(2025, 'scores')], 'success');
  assert.equal(actions[manualActionKey(2026, 'scores')], 'error');
});

// ---- Hotfix requirements 7–9: current-year isolation ----

test('request A resolves after year B becomes current → dropped', () => {
  // Newest request, echoed year matches its request, but the user is now on B.
  assert.equal(
    shouldApplyStatusResponse({
      requestSeq: 5,
      latestSeq: 5,
      requestedYear: 2025,
      responseYear: 2025,
      currentYear: 2026,
    }),
    false,
    'a matching-echo response for an abandoned year must not replace B’s feed'
  );
});

test('shouldApplyStatusResponse applies only when seq, echoed year, and current year all agree', () => {
  assert.equal(
    shouldApplyStatusResponse({
      requestSeq: 5,
      latestSeq: 5,
      requestedYear: 2026,
      responseYear: 2026,
      currentYear: 2026,
    }),
    true
  );
});

test('stale A callback cannot abort/replace B: isSelectedYear gates on the live selection', () => {
  // A manual-refresh/settings callback captured under 2025, completing while 2026
  // is selected, must not start an old-year load or reload the old year.
  assert.equal(isSelectedYear(2025, 2026), false);
  // The settings mutation reloads whatever year is current at completion.
  assert.equal(isSelectedYear(2026, 2026), true);
});

// ---- Finding #6: fallback responses are NOT treated as success ----

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('interpretRefreshResponse: plain 2xx is success', async () => {
  const outcome = await interpretRefreshResponse(jsonResponse({ meta: { source: 'cfbd_live' } }));
  assert.equal(outcome.ok, true);
});

test('interpretRefreshResponse: non-2xx is an http failure', async () => {
  const outcome = await interpretRefreshResponse(jsonResponse({ error: 'boom' }, 502));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'http');
});

test('interpretRefreshResponse: 200 with fallbackUsed is a failure', async () => {
  const outcome = await interpretRefreshResponse(
    jsonResponse({ meta: { source: 'local_snapshot', fallbackUsed: true } })
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'fallback');
});

test('interpretRefreshResponse: 200 with local_snapshot source is a failure even without the flag', async () => {
  const outcome = await interpretRefreshResponse(
    jsonResponse({ meta: { source: 'local_snapshot' } })
  );
  assert.equal(outcome.ok, false);
});

// ---- Finding #5: stale prior-good rankings fallback is a failed refresh ----

test('interpretRefreshResponse: 200 with meta.stale (rankings prior-good) is a failure', async () => {
  // The rankings loader returns HTTP 200 + { stale, rebuildRequired } when it
  // REJECTS an empty/drifted replacement and keeps serving prior-good rankings.
  const outcome = await interpretRefreshResponse(
    jsonResponse({ meta: { source: 'cfbd', cache: 'hit', stale: true, rebuildRequired: true } })
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'fallback');
});

test('interpretRefreshResponse: 200 with meta.rebuildRequired alone is a failure', async () => {
  const outcome = await interpretRefreshResponse(
    jsonResponse({ meta: { source: 'cfbd', rebuildRequired: true } })
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'fallback');
});

test('interpretRefreshResponse: a fresh rankings success (no stale markers) stays a success', async () => {
  const outcome = await interpretRefreshResponse(
    jsonResponse({ meta: { source: 'cfbd', cache: 'miss' } })
  );
  assert.equal(outcome.ok, true);
});

test('combineOutcomes: any failure makes the whole action a failure', () => {
  assert.equal(combineOutcomes([{ ok: true }, { ok: true }]).ok, true);
  const combined = combineOutcomes([{ ok: true }, { ok: false, kind: 'http', status: 500 }]);
  assert.equal(combined.ok, false);
});

// ---- Finding #7: controls are interactive only when consumed ----

test('datasetControlMode: game-stats is interactive (consumed today)', () => {
  assert.equal(datasetControlMode(getProviderDatasetDescriptor('game-stats')), 'interactive');
});

test('datasetControlMode: schedule is lifecycle-exempt', () => {
  assert.equal(datasetControlMode(getProviderDatasetDescriptor('schedule')), 'lifecycle-exempt');
});

test('datasetControlMode: planned datasets are not interactive', () => {
  for (const dataset of ['scores', 'odds', 'rankings', 'conferences'] as const) {
    assert.equal(datasetControlMode(getProviderDatasetDescriptor(dataset)), 'planned');
  }
});

test('controlModeLabel: exempt and planned modes have honest read-only text', () => {
  assert.match(controlModeLabel('lifecycle-exempt'), /exempt/i);
  assert.match(controlModeLabel('planned'), /not active yet/i);
  assert.equal(controlModeLabel('interactive'), '');
});
