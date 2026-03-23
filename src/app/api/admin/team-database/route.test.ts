import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteTeamDatabaseStoreFileForTests,
  __resetTeamDatabaseStoreForTests,
} from '@/lib/server/teamDatabaseStore';

import { POST } from './route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../../lib/server/appStateStore.ts';

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

test.beforeEach(async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  __resetTeamDatabaseStoreForTests();
  await __deleteTeamDatabaseStoreFileForTests();
});

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('team database sync route fetches CFBD teams, persists them, and returns summary', async () => {
  setMockFetch(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    assert.equal(url.origin, 'https://api.collegefootballdata.com');
    assert.equal(url.pathname, '/teams/fbs');
    assert.equal(
      init?.headers ? (init.headers as Record<string, string>).Authorization : '',
      'Bearer test-cfbd-token'
    );

    return new Response(
      JSON.stringify([
        {
          id: 42,
          school: 'Texas',
          abbreviation: 'TEX',
          mascot: 'Longhorns',
          conference: 'SEC',
          color: 'bf5700',
          altColor: 'ffffff',
        },
        {
          id: 13,
          school: 'Rice',
          abbreviation: 'RICE',
          mascot: 'Owls',
          conference: 'American Athletic',
          color: null,
          altColor: null,
        },
      ]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  });

  const res = await POST();
  const payload = (await res.json()) as {
    ok: boolean;
    summary: {
      fetchedCount: number;
      writtenCount: number;
      withColorCount: number;
      missingColorCount: number;
    };
  };

  assert.equal(res.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.summary.fetchedCount, 2);
  assert.equal(payload.summary.writtenCount, 2);
  assert.equal(payload.summary.withColorCount, 1);
  assert.equal(payload.summary.missingColorCount, 1);
});
