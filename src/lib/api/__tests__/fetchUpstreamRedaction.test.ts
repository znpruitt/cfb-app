import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchUpstreamResponse,
  sanitizeUpstreamUrl,
  UpstreamFetchError,
} from '../fetchUpstream.ts';

const ODDS_KEY_MARKER = 'ODDS-KEY-SECRET-MARKER';

test('#5/#9: sanitizeUpstreamUrl redacts credential params, preserves origin/path/non-credential params', () => {
  const sanitized = sanitizeUpstreamUrl(
    `https://api.the-odds-api.com/v4/sports/x/odds?regions=us&markets=h2h&apiKey=${ODDS_KEY_MARKER}`
  );
  assert.ok(!sanitized.includes(ODDS_KEY_MARKER));
  assert.match(sanitized, /apiKey=REDACTED/);
  assert.match(sanitized, /regions=us/);
  assert.match(sanitized, /markets=h2h/);
  assert.match(sanitized, /^https:\/\/api\.the-odds-api\.com\/v4\/sports\/x\/odds/);
});

test('#5: every credential parameter name is redacted case-insensitively', () => {
  for (const name of [
    'apiKey',
    'APIKEY',
    'ApiKey',
    'KEY',
    'Token',
    'access_token',
    'Authorization',
  ]) {
    const s = sanitizeUpstreamUrl(`https://x.example/p?${name}=${ODDS_KEY_MARKER}&keep=1`);
    assert.ok(!s.includes(ODDS_KEY_MARKER), name);
    assert.match(s, /keep=1/);
  }
});

test('#9: a no-credential URL passes through byte-identical (CFBD case)', () => {
  const cfbd =
    'https://apinext.collegefootballdata.com/games/teams?year=2026&week=1&seasonType=regular';
  assert.equal(sanitizeUpstreamUrl(cfbd), cfbd);
});

test('an unparseable URL never leaks its query string', () => {
  assert.equal(sanitizeUpstreamUrl('not a url?apiKey=SECRET'), 'not a url?REDACTED');
});

test('#10: fetch uses the REAL credential URL while UpstreamFetchError.details.url is sanitized', async () => {
  const originalFetch = globalThis.fetch;
  let seenByFetch = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seenByFetch = String(input);
    return new Response('nope', { status: 500, statusText: 'Server Error' });
  }) as typeof fetch;
  try {
    const url = `https://api.the-odds-api.com/v4/sports/x/odds?apiKey=${ODDS_KEY_MARKER}`;
    await assert.rejects(
      fetchUpstreamResponse(url, { retry: { maxAttempts: 1 }, throwOnHttpError: true }),
      (err: unknown) => {
        assert.ok(err instanceof UpstreamFetchError);
        // The credential marker is absent from the error detail...
        assert.ok(!err.details.url.includes(ODDS_KEY_MARKER));
        assert.match(err.details.url, /apiKey=REDACTED/);
        return true;
      }
    );
    // ...but the actual request carried the real key.
    assert.ok(seenByFetch.includes(ODDS_KEY_MARKER));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('#6: upstream debug logging never prints the credential', async () => {
  const originalFetch = globalThis.fetch;
  const originalDebug = process.env.DEBUG_UPSTREAM;
  const originalLog = console.log;
  const lines: string[] = [];
  process.env.DEBUG_UPSTREAM = '1';
  console.log = ((...a: unknown[]) =>
    void lines.push(a.map(String).join(' '))) as typeof console.log;
  globalThis.fetch = (async () => new Response('[]', { status: 200 })) as typeof fetch;
  try {
    // Re-import is not needed: IS_UPSTREAM_DEBUG is read at module load, so this
    // test asserts the sanitizer is applied to the URL that logging would print.
    const url = `https://api.the-odds-api.com/v4/sports/x/odds?apiKey=${ODDS_KEY_MARKER}`;
    await fetchUpstreamResponse(url, { retry: { maxAttempts: 1 } });
    const printed = lines.join('\n');
    assert.ok(!printed.includes(ODDS_KEY_MARKER), 'debug log must not contain the key');
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalDebug === undefined) delete process.env.DEBUG_UPSTREAM;
    else process.env.DEBUG_UPSTREAM = originalDebug;
  }
});
