import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, POST, type WinTotalEntry } from '../route';
import {
  setAppState,
  getAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';

// ---------------------------------------------------------------------------
// PLATFORM-069 — win-totals import must resolve team names through the shared
// scoped alias source (getScopedAliasMap: stored global > year > SEED), the
// same map canonical runtime resolution uses.
//
// The import route previously built its alias map from year-scoped + SEED
// aliases only, silently bypassing stored global aliases. These tests lock the
// import to honor stored global aliases, and confirm year/seed fallbacks still
// work. The control (no stored global alias) proves the alias is what makes the
// label resolve — the old year+seed-only path would have left it unresolved.
// ---------------------------------------------------------------------------

const YEAR = 2026;
const TOKEN = 'test-admin-token';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

const GLOBAL_ALIAS_SCOPE = 'aliases:global';
const GLOBAL_ALIAS_KEY = 'map';
// A label that is NOT a seed alias and NOT a catalog team; only a stored global
// alias maps it to 'Texas' (an eligible FBS catalog team).
const STORED_GLOBAL_LABEL = 'bevo nation';

function postCsv(csv: string): Request {
  return new Request(`http://localhost/api/admin/win-totals?year=${YEAR}`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-admin-token': TOKEN },
    body: csv,
  });
}

function getRequest(): Request {
  return new Request(`http://localhost/api/admin/win-totals?year=${YEAR}`, {
    method: 'GET',
    headers: { 'x-admin-token': TOKEN },
  });
}

async function setStoredGlobalAlias(map: Record<string, string>): Promise<void> {
  await setAppState<Record<string, string>>(GLOBAL_ALIAS_SCOPE, GLOBAL_ALIAS_KEY, map);
}

async function readStored(): Promise<WinTotalEntry[]> {
  const record = await getAppState<WinTotalEntry[]>('win-totals', String(YEAR));
  return record?.value ?? [];
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
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

type PostBody = { resolvedCount: number; unresolvedTeams: string[] };

test('POST leaves a stored-global-only label unresolved when no stored global alias is set (control)', async () => {
  const res = await POST(postCsv(`Team,Low,High\n${STORED_GLOBAL_LABEL},9.5,10.5`));
  const body = (await res.json()) as PostBody;
  assert.equal(res.status, 200, JSON.stringify(body));

  assert.equal(body.resolvedCount, 0, 'label must be unresolvable without a stored global alias');
  assert.deepEqual(body.unresolvedTeams, [STORED_GLOBAL_LABEL]);
  assert.equal((await readStored()).length, 0, 'nothing should persist when nothing resolves');
});

test('POST honors a stored global alias, persisting the canonical school', async () => {
  await setStoredGlobalAlias({ [STORED_GLOBAL_LABEL]: 'texas' });

  const res = await POST(postCsv(`Team,Low,High\n${STORED_GLOBAL_LABEL},9.5,10.5`));
  const body = (await res.json()) as PostBody;
  assert.equal(res.status, 200, JSON.stringify(body));

  assert.equal(body.resolvedCount, 1, 'stored global alias must resolve the label');
  assert.deepEqual(body.unresolvedTeams, []);

  const stored = await readStored();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.school, 'Texas', 'must persist the canonical catalog school');
  assert.equal(stored[0]!.winTotalLow, 9.5);
  assert.equal(stored[0]!.winTotalHigh, 10.5);

  // GET returns the persisted canonical entries.
  const getRes = await GET(getRequest());
  const getBody = (await getRes.json()) as { entries: WinTotalEntry[] };
  assert.equal(getBody.entries[0]!.school, 'Texas');
});

test('POST still resolves seed aliases (fallback preserved)', async () => {
  // 'uh' -> 'houston' is a SEED alias; 'uh' is not a catalog alt, so this label
  // resolves ONLY via the seed layer (no stored global / year alias set).
  const res = await POST(postCsv('Team,Low,High\nuh,7,8'));
  const body = (await res.json()) as PostBody;
  assert.equal(res.status, 200, JSON.stringify(body));

  assert.equal(body.resolvedCount, 1, 'seed alias fallback must still resolve');
  assert.deepEqual(body.unresolvedTeams, []);
  assert.equal((await readStored())[0]!.school, 'Houston');
});

test('POST still resolves year-scoped aliases (fallback preserved)', async () => {
  // Year-scoped alias for a label that is neither a seed nor a catalog team.
  await setAppState<Record<string, string>>(`aliases:${YEAR}`, GLOBAL_ALIAS_KEY, {
    'year only label': 'georgia',
  });

  const res = await POST(postCsv('Team,Low,High\nyear only label,10,11'));
  const body = (await res.json()) as PostBody;
  assert.equal(res.status, 200, JSON.stringify(body));

  assert.equal(body.resolvedCount, 1, 'year-scoped alias fallback must still resolve');
  assert.equal((await readStored())[0]!.school, 'Georgia');
});
