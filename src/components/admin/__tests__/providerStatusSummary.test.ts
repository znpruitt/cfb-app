import assert from 'node:assert/strict';
import test from 'node:test';

import { INTERRUPTED_ATTEMPT_AFTER_MS, summarizeProviderState } from '../providerStatusSummary.ts';
import {
  emptyProviderRefreshStatus,
  type ProviderRefreshStatus,
} from '../../../lib/server/providerRefreshStatus.ts';
import { getProviderDatasetDescriptor } from '../../../lib/providerDatasets.ts';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const scores = getProviderDatasetDescriptor('scores');
const gameStats = getProviderDatasetDescriptor('game-stats');
const conferences = getProviderDatasetDescriptor('conferences');

function status(overrides: Partial<ProviderRefreshStatus> = {}): ProviderRefreshStatus {
  return { ...emptyProviderRefreshStatus('scores'), ...overrides };
}

function summarize(
  s: ProviderRefreshStatus,
  opts: {
    globalPause?: boolean;
    enabled?: boolean;
    descriptor?: typeof scores;
    cacheState?: 'available' | 'absent' | 'unknown';
  } = {}
) {
  return summarizeProviderState(s, opts.descriptor ?? scores, {
    globalPause: opts.globalPause ?? false,
    enabled: opts.enabled ?? true,
    now: NOW,
    cacheState: opts.cacheState,
  });
}

// ---- No PLATFORM-086A refresh history: distinguish from missing data (requirement 6) ----

test('no history + cached data → "Serving cached data · no refresh history recorded"', () => {
  assert.deepEqual(summarize(status(), { cacheState: 'available' }), {
    label: 'Serving cached data · no refresh history recorded',
    tone: 'muted',
  });
});

test('no history + no cached data → "No cached data or refresh history"', () => {
  assert.deepEqual(summarize(status(), { cacheState: 'absent' }), {
    label: 'No cached data or refresh history',
    tone: 'muted',
  });
});

test('no history + unknown cache state → conservative "No refresh history recorded"', () => {
  // Never asserts absence when availability could not be proven.
  assert.deepEqual(summarize(status(), { cacheState: 'unknown' }), {
    label: 'No refresh history recorded',
    tone: 'muted',
  });
  // Defaulting (no cacheState provided) is the same conservative wording.
  assert.deepEqual(summarize(status()), { label: 'No refresh history recorded', tone: 'muted' });
});

test('in-progress (recent) → "Refresh in progress", not a success/failure', () => {
  const s = status({
    lastAttemptAt: new Date(NOW - 30_000).toISOString(),
    latestAttemptOutcome: 'in-progress',
    // A prior success + prior error exist but must NOT drive the summary.
    lastSuccessAt: new Date(NOW - 3_600_000).toISOString(),
    lastError: { message: 'earlier boom' },
  });
  assert.deepEqual(summarize(s), { label: 'Refresh in progress', tone: 'muted' });
});

test('in-progress older than the interrupted threshold → "Attempt appears interrupted"', () => {
  const s = status({
    lastAttemptAt: new Date(NOW - INTERRUPTED_ATTEMPT_AFTER_MS - 60_000).toISOString(),
    latestAttemptOutcome: 'in-progress',
  });
  assert.deepEqual(summarize(s), { label: 'Attempt appears interrupted', tone: 'warn' });
});

// ---- Failed-refresh messaging is cache-state-aware (v2 finding #1) ----

test('failed + cache available → bad, "prior-good cached data is still serving"', () => {
  const s = status({
    lastAttemptAt: new Date(NOW - 60_000).toISOString(),
    latestAttemptOutcome: 'failed',
    lastError: { message: 'upstream 502', status: 502 },
    lastSuccessAt: new Date(NOW - 3_600_000).toISOString(),
  });
  const summary = summarize(s, { cacheState: 'available' });
  assert.equal(summary.tone, 'bad');
  assert.match(summary.label, /prior-good cached data is still serving/i);
});

test('failed + cache absent → bad, "no cached data is available" (cold failure never claims prior-good)', () => {
  const s = status({
    lastAttemptAt: new Date(NOW - 60_000).toISOString(),
    latestAttemptOutcome: 'failed',
    lastError: { message: 'missing api key' },
  });
  const summary = summarize(s, { cacheState: 'absent' });
  assert.equal(summary.tone, 'bad');
  assert.match(summary.label, /no cached data is available/i);
  assert.doesNotMatch(summary.label, /prior-good/i);
});

test('failed + cache absent + historical lastSuccessAt → still "no cached data" (history does not override current absence)', () => {
  const s = status({
    lastAttemptAt: new Date(NOW - 60_000).toISOString(),
    latestAttemptOutcome: 'failed',
    lastError: { message: 'upstream 502' },
    // A previous success exists historically, but the cache is currently absent.
    lastSuccessAt: new Date(NOW - 3_600_000).toISOString(),
  });
  const summary = summarize(s, { cacheState: 'absent' });
  assert.match(summary.label, /no cached data is available/i);
  assert.doesNotMatch(summary.label, /still serving/i);
});

test('failed + cache unknown → bad, "could not be determined"', () => {
  const s = status({
    lastAttemptAt: new Date(NOW - 60_000).toISOString(),
    latestAttemptOutcome: 'failed',
    lastError: { message: 'upstream 502' },
  });
  const summary = summarize(s, { cacheState: 'unknown' });
  assert.equal(summary.tone, 'bad');
  assert.match(summary.label, /could not be determined/i);
});

test('failed + no cacheState supplied → conservative "availability is unknown"', () => {
  const s = status({
    lastAttemptAt: new Date(NOW - 60_000).toISOString(),
    latestAttemptOutcome: 'failed',
    lastError: { message: 'upstream 502' },
  });
  const summary = summarize(s);
  assert.equal(summary.tone, 'bad');
  assert.match(summary.label, /availability is unknown/i);
});

test('no-op → muted "no applicable data", never a failure', () => {
  const s = status({
    lastAttemptAt: new Date(NOW - 60_000).toISOString(),
    latestAttemptOutcome: 'no-op',
    lastSuccessAt: new Date(NOW - 3_600_000).toISOString(),
  });
  const summary = summarize(s);
  assert.equal(summary.tone, 'muted');
  assert.match(summary.label, /no applicable data/i);
});

test('partial → warn', () => {
  const s = status({
    lastAttemptAt: new Date(NOW - 60_000).toISOString(),
    latestAttemptOutcome: 'partial',
    lastSuccessAt: new Date(NOW - 60_000).toISOString(),
    partialFailure: true,
  });
  assert.equal(summarize(s).tone, 'warn');
});

test('succeeded (recent) → ok "Successfully refreshed"', () => {
  const s = status({
    lastAttemptAt: new Date(NOW - 60_000).toISOString(),
    latestAttemptOutcome: 'succeeded',
    lastSuccessAt: new Date(NOW - 60_000).toISOString(),
  });
  assert.deepEqual(summarize(s), { label: 'Successfully refreshed', tone: 'ok' });
});

test('succeeded but old → warn "Successfully refreshed but now stale"', () => {
  const s = status({
    lastAttemptAt: new Date(NOW - 5 * 86_400_000).toISOString(),
    latestAttemptOutcome: 'succeeded',
    lastSuccessAt: new Date(NOW - 5 * 86_400_000).toISOString(),
  });
  assert.equal(summarize(s).tone, 'warn');
  assert.match(summarize(s).label, /stale/i);
});

test('a consumed dataset shows pause/disabled before any outcome', () => {
  const s = status({
    latestAttemptOutcome: 'succeeded',
    lastSuccessAt: new Date(NOW).toISOString(),
  });
  assert.match(summarize(s, { descriptor: gameStats, globalPause: true }).label, /paused/i);
  assert.match(summarize(s, { descriptor: gameStats, enabled: false }).label, /disabled/i);
});

test('pause/disabled are NOT shown for a non-consumed dataset (would imply a runtime effect)', () => {
  const s = status({
    latestAttemptOutcome: 'succeeded',
    lastSuccessAt: new Date(NOW).toISOString(),
  });
  // scores is a planned/unconsumed dataset: a global pause must not relabel it.
  assert.equal(summarize(s, { globalPause: true }).label, 'Successfully refreshed');
});

test('the stale window is per-dataset: a 5-day-old success is stale for scores but fresh for conferences (finding #8)', () => {
  const fiveDaysAgo = new Date(NOW - 5 * 86_400_000).toISOString();
  const s = status({
    lastAttemptAt: fiveDaysAgo,
    latestAttemptOutcome: 'succeeded',
    lastSuccessAt: fiveDaysAgo,
  });
  // scores window is 2 days → 5 days is stale.
  assert.equal(summarize(s, { descriptor: scores }).tone, 'warn');
  assert.match(summarize(s, { descriptor: scores }).label, /stale/i);
  // conferences window is 30 days → 5 days is still fresh.
  assert.deepEqual(summarize(s, { descriptor: conferences }), {
    label: 'Successfully refreshed',
    tone: 'ok',
  });
});

test('legacy record (no outcome) falls back to historical-field inference', () => {
  const failed = status({
    lastAttemptAt: new Date(NOW - 60_000).toISOString(),
    latestAttemptOutcome: null,
    lastError: { message: 'legacy failure' },
  });
  assert.equal(summarize(failed).tone, 'bad');

  const ok = status({
    lastAttemptAt: new Date(NOW - 60_000).toISOString(),
    latestAttemptOutcome: null,
    lastSuccessAt: new Date(NOW - 60_000).toISOString(),
  });
  assert.equal(summarize(ok).tone, 'ok');
});
