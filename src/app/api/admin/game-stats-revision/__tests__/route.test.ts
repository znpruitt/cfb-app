import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, POST } from '../route';
import {
  getAppState,
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
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
    audit: { state: string };
  };
  assert.equal(body.inspection.state.partition.stampClass, 'valid');
  assert.ok(body.inspection.expectedStateDigest.length > 0);
  // No audit dataset was ever written → typed `absent`, never an empty array.
  assert.deepEqual(body.audit, { state: 'absent' });
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

// === PLATFORM-086H3B-REPAIR-SAFETY-DOCS: error redaction + audit availability ===

test('inspection/repair store errors are redacted — no raw storage text in responses', async () => {
  const secret =
    'postgres://user:SECRETPW@db.internal:5432/prod at /var/secrets/key.pem\n at Object.<anonymous>';
  __setAppStateReadFailureForTests(new Error(secret), 'game-stats');

  const getRes = await GET(getReq());
  assert.equal(getRes.status, 503);
  const getBody = JSON.stringify(await getRes.json());
  assert.ok(getBody.includes('revision-repair-inspection-unavailable'));
  assert.equal(getBody.includes('SECRETPW'), false);
  assert.equal(getBody.includes('/var/secrets'), false);
  assert.equal(getBody.includes('postgres://'), false);

  const postRes = await POST(
    postReq({
      identity: { year: YEAR, week: WEEK, seasonType: 'regular' },
      action: { kind: 'rebuild-ledger' },
      expectedStateDigest: 'anything',
      reason: 'attempt',
    })
  );
  assert.equal(postRes.status, 503);
  const postBody = JSON.stringify(await postRes.json());
  assert.ok(postBody.includes('revision-repair-planning-unavailable'));
  assert.equal(postBody.includes('SECRETPW'), false);
  assert.equal(postBody.includes('/var/secrets'), false);

  __setAppStateReadFailureForTests(null);
});

test('the route preserves typed audit availability (available / unavailable)', async () => {
  await setAppState('game-stats', KEY, PARTITION);
  await setAppState('game-stats-revision-audit', KEY, []); // valid empty history
  let body = (await (await GET(getReq())).json()) as {
    audit: { state: string; entries?: unknown[] };
  };
  assert.deepEqual(body.audit, { state: 'available', entries: [] });

  await setAppState('game-stats-revision-audit', KEY, { corrupt: true }); // malformed
  body = (await (await GET(getReq())).json()) as { audit: { state: string } };
  assert.equal(body.audit.state, 'unavailable');
});

test('the route never serializes arbitrary nested audit content (secret redaction)', async () => {
  // PLATFORM-086H3B-REPAIR-PRESENCE-H1-AUDIT: an audit entry carrying a secret in
  // an UNEXPECTED nested field makes the whole dataset `unavailable` — the corrupted
  // history is never trusted, and the secret text never reaches the route response.
  await setAppState('game-stats', KEY, PARTITION);
  const SECRET = 'postgres://user:SUPERSECRETPW@db.internal:5432/prod';
  await setAppState('game-stats-revision-audit', KEY, [
    {
      schemaVersion: 1,
      auditRef: 'a1',
      actor: 'clerk:admin-1',
      at: '2024-10-06T00:00:00.000Z',
      reason: 'operator recovery',
      beforeDigest: 'd1',
      action: { kind: 'rebuild-ledger' },
      afterState: {
        ledger: {
          schemaVersion: 1,
          year: YEAR,
          week: WEEK,
          seasonType: 'regular',
          lineage: 'L',
          revision: 3,
          initializedFrom: 'repair',
          initializedAt: '2024-10-06T00:00:00.000Z',
          connectionString: SECRET, // unexpected nested field
        },
        committedStamp: null,
        partitionStamp: null,
      },
    },
  ]);
  const res = await GET(getReq());
  const raw = await res.text();
  assert.equal(raw.includes('SUPERSECRETPW'), false, 'secret never in the response body');
  const body = JSON.parse(raw) as { audit: { state: string } };
  assert.equal(body.audit.state, 'unavailable'); // corrupted history is not trusted
});
