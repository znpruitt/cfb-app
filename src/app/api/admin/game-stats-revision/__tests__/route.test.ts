import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, POST } from '../route';
import {
  getAppState,
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../../../lib/server/appStateStore.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

const YEAR = 2024;
const WEEK = 6;
const KEY = `${YEAR}:${WEEK}:regular`;
const PARTITION = {
  year: YEAR,
  week: WEEK,
  seasonType: 'regular' as const,
  fetchedAt: '2024-10-06T00:00:00.000Z',
  games: [],
  commitStamp: { lineage: 'L', revision: 3 },
};

function getReq(): Request {
  return new Request(
    `http://localhost/api/admin/game-stats-revision?year=${YEAR}&week=${WEEK}&seasonType=regular`
  );
}
function postReq(body: unknown): Request {
  return new Request('http://localhost/api/admin/game-stats-revision', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
async function ledger(): Promise<unknown> {
  return (await getAppState('game-stats-revision', KEY))?.value ?? null;
}
async function audit(): Promise<unknown> {
  return (await getAppState('game-stats-revision-audit', KEY))?.value ?? null;
}

test('GET inspects and returns an expected-state digest + audit trail', async () => {
  await setAppState('game-stats', KEY, PARTITION);
  const res = await GET(getReq());
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    inspection: { expectedStateDigest: string; state: { partition: { stampClass: string } } };
    audit: unknown[];
  };
  assert.equal(body.inspection.state.partition.stampClass, 'valid');
  assert.ok(body.inspection.expectedStateDigest.length > 0);
  assert.deepEqual(body.audit, []);
});

test('POST dry-run returns a plan and writes nothing', async () => {
  await setAppState('game-stats', KEY, PARTITION);
  const inspect = (await (await GET(getReq())).json()) as {
    inspection: { expectedStateDigest: string };
  };
  const res = await POST(
    postReq({
      identity: { year: YEAR, week: WEEK, seasonType: 'regular' },
      action: { kind: 'rebuild-ledger' },
      expectedStateDigest: inspect.inspection.expectedStateDigest,
      reason: 'plan only',
      // no `apply` → dry-run
    })
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { result: { ok: boolean; dryRun: boolean } };
  assert.equal(body.result.ok, true);
  assert.equal(body.result.dryRun, true);
  assert.equal(await ledger(), null); // planning wrote nothing
});

test('POST apply is refused (dormant) and mutates NOTHING', async () => {
  await setAppState('game-stats', KEY, PARTITION);
  const before = {
    partition: (await getAppState('game-stats', KEY))?.value,
    ledger: await ledger(),
    audit: await audit(),
  };
  const res = await POST(
    postReq({
      identity: { year: YEAR, week: WEEK, seasonType: 'regular' },
      action: { kind: 'rebuild-ledger' },
      expectedStateDigest: 'anything',
      reason: 'attempt apply',
      apply: true,
    })
  );
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'revision-repair-application-not-active');
  // Durable state is byte-for-byte unchanged: no ledger, no audit, partition intact.
  assert.deepEqual((await getAppState('game-stats', KEY))?.value, before.partition);
  assert.equal(await ledger(), null);
  assert.equal(await audit(), null);
});

test('a legacy partition cannot acquire a commit stamp through the route', async () => {
  // A legacy (stampless) partition + an apply request must never stamp it.
  const legacy = {
    year: YEAR,
    week: WEEK,
    seasonType: 'regular' as const,
    fetchedAt: '2024-10-06T00:00:00.000Z',
    games: [],
  };
  await setAppState('game-stats', KEY, legacy);
  const res = await POST(
    postReq({
      identity: { year: YEAR, week: WEEK, seasonType: 'regular' },
      action: { kind: 'establish-new-lineage', floor: 5 },
      expectedStateDigest: 'anything',
      reason: 'attempt apply',
      apply: true,
      acknowledgeEvidenceLoss: true,
    })
  );
  assert.equal(res.status, 409);
  const stored = (await getAppState('game-stats', KEY))?.value as { commitStamp?: unknown };
  assert.equal('commitStamp' in stored, false);
  assert.equal(await ledger(), null);
});
