import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { UpstreamFetchError, type UpstreamErrorKind } from '../fetchUpstream.ts';
import {
  classifyUpstreamFault,
  isStoredUpstreamFaultClass,
  rebuildUpstreamFaultClass,
  upstreamFaultLabel,
  UPSTREAM_FAULT_KINDS,
} from '../upstreamFaultClass.ts';

// PLATFORM-126B — the shared closed upstream vocabulary that replaces the
// `fetch-failed` collapse in BOTH multi-year jobs. This suite owns the
// classifier's contract; the two route suites prove it survives to the store.

/** A credential-shaped URL and a response body, the two things that must never escape. */
const SECRET_URL = 'https://api.collegefootballdata.com/games?year=2026&apiKey=SUPER-SECRET-KEY';
const SECRET_BODY = '{"error":"quota exceeded for token tok_live_MARKER"}';

function upstreamError(kind: UpstreamErrorKind, status?: number): UpstreamFetchError {
  return new UpstreamFetchError({
    kind,
    message: `boom at ${SECRET_URL}`,
    ...(status === undefined ? {} : { status, statusText: 'Service Unavailable' }),
    url: SECRET_URL,
    responseBody: SECRET_BODY,
  });
}

test('the closed class mirrors UpstreamErrorKind exactly — read from the AUTHORITY, not a copy', () => {
  // The item's prose named four and omitted `aborted`. `fetchUpstream.ts` is the
  // authority and says five; collapsing `aborted` onto `network` is exactly the
  // lossy mapping this work removes (owner ruling, 2026-09-07).
  //
  // This used to compare two independently hard-coded lists, which proved nothing
  // in the direction that matters: a SIXTH kind added to `UpstreamErrorKind` would
  // have left it green while `classifyUpstreamFault` silently returned `null` for
  // that kind, quietly losing exactly the evidence this item adds. The expected
  // set is now read from the source union. (Review finding.)
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../fetchUpstream.ts'),
    'utf8'
  );
  const declaration = /export type UpstreamErrorKind =([^;]+);/.exec(source);
  assert.ok(declaration, 'UpstreamErrorKind is declared in fetchUpstream.ts');
  const authority = [...declaration[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
  assert.ok(authority.length > 0, 'the scan found its members');

  assert.deepEqual(
    [...UPSTREAM_FAULT_KINDS].sort(),
    [...authority].sort(),
    'the closed class and the upstream authority name exactly the same kinds'
  );
  // And every one of them actually classifies — parity of names is not parity of
  // behaviour if the classifier drops one.
  for (const kind of authority) {
    const classified = classifyUpstreamFault(upstreamError(kind as UpstreamErrorKind));
    assert.ok(classified, `${kind} is classifiable, not silently null`);
    assert.equal(classified.kind, kind);
  }
});

test('every one of the five kinds classifies to itself', () => {
  for (const kind of UPSTREAM_FAULT_KINDS) {
    const classified = classifyUpstreamFault(
      upstreamError(kind, kind === 'http' ? 503 : undefined)
    );
    assert.ok(classified, `${kind} classifies`);
    assert.equal(classified.kind, kind);
  }
});

test('the status is carried ONLY for `http`, and only when it is a real status code', () => {
  assert.deepEqual(classifyUpstreamFault(upstreamError('http', 503)), {
    kind: 'http',
    status: 503,
  });
  // A non-`http` member has no status to report even when the error carries one:
  // a status on a timeout would assert the provider answered, which it did not.
  assert.deepEqual(classifyUpstreamFault(upstreamError('timeout', 503)), {
    kind: 'timeout',
    status: null,
  });
  for (const bogus of [99, 600, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      classifyUpstreamFault(upstreamError('http', bogus)),
      { kind: 'http', status: null },
      `status ${bogus} is not a real status code`
    );
  }
});

test('an unrecognized throw classifies to null, NOT to a fabricated `network`', () => {
  // Defaulting an unknown throw to a member would manufacture exactly the kind of
  // confident-but-wrong evidence the September 1, 2026 postmortem lacked.
  for (const thrown of [new Error('boom'), 'boom', null, undefined, { kind: 'timeout' }]) {
    assert.equal(classifyUpstreamFault(thrown), null);
  }
});

test('SECRET SCAN: no message, URL, status text, or response body reaches the class', () => {
  for (const kind of UPSTREAM_FAULT_KINDS) {
    const classified = classifyUpstreamFault(upstreamError(kind, 503));
    const serialized = JSON.stringify(classified);
    assert.ok(!serialized.includes('SUPER-SECRET-KEY'), `${kind}: no credential`);
    assert.ok(!serialized.includes('MARKER'), `${kind}: no response body`);
    assert.ok(!serialized.includes('collegefootballdata'), `${kind}: no URL`);
    assert.ok(!serialized.includes('Service Unavailable'), `${kind}: no status text`);
    assert.deepEqual(Object.keys(classified!).sort(), ['kind', 'status']);
  }
});

test('POSITIVE CONTROL: the same scan SEES those secrets in the unclassified error', () => {
  // Without this the scan above proves only that the instrument is blind. The
  // error the classifier was handed genuinely carries all four.
  const serialized = JSON.stringify(upstreamError('http', 503).details);
  assert.ok(serialized.includes('SUPER-SECRET-KEY'));
  assert.ok(serialized.includes('MARKER'));
  assert.ok(serialized.includes('collegefootballdata'));
  assert.ok(serialized.includes('Service Unavailable'));
});

test('stored-shape validation accepts the closed set and rejects everything else', () => {
  for (const kind of UPSTREAM_FAULT_KINDS) {
    assert.equal(isStoredUpstreamFaultClass({ kind, status: null }), true, kind);
    assert.equal(isStoredUpstreamFaultClass({ kind }), true, `${kind} without a status`);
  }
  assert.equal(isStoredUpstreamFaultClass({ kind: 'http', status: 503 }), true);
  for (const bad of [
    null,
    undefined,
    'timeout',
    42,
    [],
    {},
    { kind: 'TIMEOUT' },
    { kind: 'dns' },
    { kind: '' },
  ]) {
    assert.equal(isStoredUpstreamFaultClass(bad), false, JSON.stringify(bad));
  }
});

test('a corrupt STATUS never rejects a record — it is accepted and normalized away', () => {
  // Round 2. These four used to be in the reject list above. Rejecting fails the
  // WHOLE receipt (`isValidStoredYearOutcome` → `isValidYearEntries` →
  // `parseSchedulerExecutionReceipt` → null), so the run loses `result`,
  // `reason`, `target` and both timestamps — discarding the forensic surface this
  // item exists to preserve, over an observability-only integer that the rebuild
  // was going to drop regardless.
  //
  // The assertion is not weakened, it is INVERTED and strengthened: each case is
  // now asserted to be accepted AND to normalize to a truthful `status: null`,
  // which the old test never checked.
  for (const corrupt of [
    { kind: 'http', status: '503' },
    { kind: 'http', status: 99 },
    { kind: 'http', status: 600 },
    { kind: 'http', status: 1.5 },
    { kind: 'timeout', status: 503 },
    { kind: 'parse', status: 99999 },
  ]) {
    assert.equal(isStoredUpstreamFaultClass(corrupt), true, JSON.stringify(corrupt));
    const rebuilt = rebuildUpstreamFaultClass(corrupt as never);
    assert.deepEqual(rebuilt, { kind: corrupt.kind, status: null }, JSON.stringify(corrupt));
    // And it renders as the bare, truthful kind — never a fabricated status.
    assert.equal(upstreamFaultLabel(rebuilt!), corrupt.kind);
  }
  // The KIND still rejects. Strictness stays where a bad value could mislead.
  assert.equal(isStoredUpstreamFaultClass({ kind: 'dns', status: 503 }), false);
});

test('the rebuild drops extra properties and any status a non-http member claims', () => {
  const rebuilt = rebuildUpstreamFaultClass({
    kind: 'http',
    status: 429,
    // Not in the type — the shape a corrupt or foreign writer could store.
    responseBody: SECRET_BODY,
    url: SECRET_URL,
  } as never);
  assert.deepEqual(rebuilt, { kind: 'http', status: 429 });
  assert.deepEqual(rebuildUpstreamFaultClass({ kind: 'timeout', status: 503 } as never), {
    kind: 'timeout',
    status: null,
  });
  assert.equal(rebuildUpstreamFaultClass(null), null);
  assert.equal(rebuildUpstreamFaultClass(undefined), null);
});

test('GENERATED: every kind × status pair round-trips through classify → validate → rebuild', () => {
  // The space is the CONTRACT — every member crossed with the status values the
  // type admits and the ones it must reject — not the pairs a caller happens to
  // produce today.
  const statuses = [undefined, 100, 200, 404, 429, 503, 599, 99, 600, -1, 0, 1.5, Number.NaN];
  let checked = 0;
  for (const kind of UPSTREAM_FAULT_KINDS) {
    for (const status of statuses) {
      const classified = classifyUpstreamFault(upstreamError(kind, status));
      assert.ok(classified);
      assert.equal(classified.kind, kind);
      const expectStatus =
        kind === 'http' &&
        status !== undefined &&
        Number.isInteger(status) &&
        status >= 100 &&
        status <= 599;
      assert.equal(classified.status, expectStatus ? status : null, `${kind}/${String(status)}`);
      assert.equal(isStoredUpstreamFaultClass(classified), true);
      assert.deepEqual(rebuildUpstreamFaultClass(classified), classified, 'rebuild is idempotent');
      assert.ok(!JSON.stringify(classified).includes('SECRET'));
      checked += 1;
    }
  }
  assert.equal(checked, UPSTREAM_FAULT_KINDS.length * statuses.length);
});

test('the label is bounded and names the status only when there is one', () => {
  assert.equal(upstreamFaultLabel({ kind: 'http', status: 503 }), 'http 503');
  assert.equal(upstreamFaultLabel({ kind: 'http', status: null }), 'http');
  assert.equal(upstreamFaultLabel({ kind: 'timeout', status: null }), 'timeout');
  assert.equal(upstreamFaultLabel({ kind: 'aborted', status: null }), 'aborted');
  assert.equal(upstreamFaultLabel({ kind: 'network', status: null }), 'network');
  assert.equal(upstreamFaultLabel({ kind: 'parse', status: null }), 'parse');
});
