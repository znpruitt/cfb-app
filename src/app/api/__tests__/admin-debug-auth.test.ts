import assert from 'node:assert/strict';
import test from 'node:test';

import { GET as usageGet } from '../admin/usage/route';
import { GET as storageGet } from '../admin/storage/route';
import { GET as oddsUsageGet } from '../admin/odds-usage/route';
import { GET as winTotalsGet } from '../admin/win-totals/route';
import { GET as confDiagGet } from '../debug/conference-diagnostics/route';
import { GET as resolveTeamGet } from '../debug/resolve-team/route';
import { GET as scheduleGet } from '../debug/schedule/route';
import { GET as scheduleEligGet } from '../debug/schedule-eligibility/route';
import { GET as scoresGet } from '../debug/scores/route';
import { GET as scoresAttachGet } from '../debug/scores-attachment/route';
import { GET as postseasonGet } from '../debug/postseason-score-attachment/route';

// ---------------------------------------------------------------------------
// PLATFORM-020 — admin/debug API routes require admin authorization.
//
// These routes expose diagnostics / storage / API-usage state, and several can
// trigger quota-bearing internal fetches. They must reject unauthenticated
// callers BEFORE doing any of that work. With ADMIN_API_TOKEN configured and no
// (or wrong) token on the request, requireAdminAuth returns 401.
// ---------------------------------------------------------------------------

const TOKEN = 'test-admin-token';
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

type RouteHandler = (req: Request) => Promise<Response>;

const GATED_ROUTES: Array<{ name: string; handler: RouteHandler; path: string }> = [
  { name: 'admin/usage', handler: usageGet, path: '/api/admin/usage' },
  { name: 'admin/storage', handler: storageGet, path: '/api/admin/storage' },
  { name: 'admin/odds-usage', handler: oddsUsageGet, path: '/api/admin/odds-usage' },
  { name: 'admin/win-totals', handler: winTotalsGet, path: '/api/admin/win-totals?year=2025' },
  {
    name: 'debug/conference-diagnostics',
    handler: confDiagGet,
    path: '/api/debug/conference-diagnostics',
  },
  {
    name: 'debug/resolve-team',
    handler: resolveTeamGet,
    path: '/api/debug/resolve-team?name=Texas',
  },
  { name: 'debug/schedule', handler: scheduleGet, path: '/api/debug/schedule?year=2025' },
  {
    name: 'debug/schedule-eligibility',
    handler: scheduleEligGet,
    path: '/api/debug/schedule-eligibility?year=2025',
  },
  { name: 'debug/scores', handler: scoresGet, path: '/api/debug/scores?year=2025' },
  {
    name: 'debug/scores-attachment',
    handler: scoresAttachGet,
    path: '/api/debug/scores-attachment?year=2025',
  },
  {
    name: 'debug/postseason-score-attachment',
    handler: postseasonGet,
    path: '/api/debug/postseason-score-attachment?year=2025',
  },
];

function reqNoAuth(path: string): Request {
  return new Request(`http://localhost${path}`);
}

function reqAuth(path: string): Request {
  return new Request(`http://localhost${path}`, { headers: { 'x-admin-token': TOKEN } });
}

test.beforeEach(() => {
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = TOKEN;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) {
    delete process.env.ADMIN_API_TOKEN;
  } else {
    MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
  }
});

for (const route of GATED_ROUTES) {
  test(`${route.name} GET returns 401 without admin auth`, async () => {
    const res = await route.handler(reqNoAuth(route.path));
    assert.equal(res.status, 401, `${route.name} must require admin auth`);
  });
}

test('unauthorized debug route returns before any internal fetch (no quota burn)', async () => {
  // schedule-eligibility fans out to /api/schedule, /api/teams, /api/aliases,
  // /api/conferences via global fetch. An unauthorized call must not reach them.
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    fetchCalls += 1;
    return realFetch(...args);
  }) as typeof fetch;

  try {
    const res = await scheduleEligGet(reqNoAuth('/api/debug/schedule-eligibility?year=2025'));
    assert.equal(res.status, 401);
    assert.equal(fetchCalls, 0, 'no internal fetch should fire for an unauthorized request');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('authorized request still succeeds for representative diagnostic routes', async () => {
  // These three read in-memory / stored state only (no live CFBD/Odds calls).
  const storageRes = await storageGet(reqAuth('/api/admin/storage'));
  assert.equal(storageRes.status, 200, await storageRes.text());

  const oddsRes = await oddsUsageGet(reqAuth('/api/admin/odds-usage'));
  assert.equal(oddsRes.status, 200, await oddsRes.text());

  const confRes = await confDiagGet(reqAuth('/api/debug/conference-diagnostics'));
  assert.equal(confRes.status, 200, await confRes.text());
});
