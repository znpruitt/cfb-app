import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../route';
import type { League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../../../../../lib/server/teamDatabaseStore.ts';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ADMIN_TOKEN = 'test-admin-token';
const SLUG = 'test-league';
const YEAR = 2025;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  delete MUTABLE_ENV.ADMIN_API_TOKEN;
});

function makeLeague(): League {
  return { slug: SLUG, displayName: 'Test', year: YEAR, createdAt: '2024-01-01T00:00:00.000Z' };
}

// Team DB has Hawaii but NOT Houston, so `uh` resolves ONLY via the scoped
// `uh`→Hawaii repair. The static seed `uh`→houston would leave it unresolved.
async function seedTeamDbWithHawaiiOnly(): Promise<void> {
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2025-01-01T00:00:00.000Z',
    items: [{ school: 'Hawaii', conference: 'Mountain West' }],
  });
}

function validateRequest(csvText: string): Request {
  return new Request(`https://example.com/api/owners/validate?league=${SLUG}&year=${YEAR}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({ csvText }),
  });
}

test('owner validation honors a scoped uh→Hawaii repair over the static seed uh→houston', async () => {
  await setAppState('leagues', 'registry', [makeLeague()]);
  await seedTeamDbWithHawaiiOnly();
  // Persisted scoped repair for the ambiguous `uh`.
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { uh: 'Hawaii' });

  const res = await POST(validateRequest('team,owner\nuh,Alice'));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    resolved: Array<{ inputName: string; canonicalName: string; method: string }>;
    needsConfirmation: Array<{ inputName: string }>;
  };
  const uh = body.resolved.find((r) => r.inputName === 'uh');
  assert.ok(uh, '`uh` resolved');
  assert.equal(uh!.canonicalName, 'Hawaii', 'scoped repair (Hawaii) used, not the seed (houston)');
  assert.equal(uh!.method, 'alias');
  assert.equal(
    body.needsConfirmation.some((u) => u.inputName === 'uh'),
    false
  );
});

test('owner validation: without the scoped repair, the seed uh→houston does not resolve to Hawaii', async () => {
  // Control: no scoped alias. Only the seed applies (uh→houston); Houston is not
  // in the team DB, so `uh` is NOT resolved to Hawaii — proving the previous test
  // passes because of the scoped repair, not incidental fuzzy matching.
  await setAppState('leagues', 'registry', [makeLeague()]);
  await seedTeamDbWithHawaiiOnly();

  const res = await POST(validateRequest('team,owner\nuh,Alice'));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    resolved: Array<{ inputName: string; canonicalName: string }>;
  };
  const uh = body.resolved.find((r) => r.inputName === 'uh');
  assert.notEqual(uh?.canonicalName, 'Hawaii', 'seed alone must not resolve uh to Hawaii');
});
