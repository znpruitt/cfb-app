import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveSessionFacts } from '../adminAuth.ts';

// ---------------------------------------------------------------------------
// PLATFORM-088 — the homepage's two session facts come from ONE resolution.
//
// The first attempt resolved them separately, and the identity half skipped the
// blank-secret precondition the admin half applies. With `CLERK_SECRET_KEY`
// unset, Clerk's header-signature check degrades to an HMAC over the empty
// string: the admin decision refuses while a naive identity check reports a
// session. The homepage would then tell a LEGITIMATE ADMIN their account lacks
// the role.
//
// HONEST LIMITS OF THIS FILE, stated because a mutation pass exposed them:
//
//  - The two behavioural tests below assert the right thing but CANNOT
//    discriminate. Removing the secret precondition entirely leaves them green,
//    because `auth()` throws in this environment anyway (no Clerk request
//    context) and the catch returns the same both-false result. They document
//    intent; they do not catch regression.
//  - The STRUCTURAL test is what actually pins the guard, and it is the one that
//    fails when the precondition is deleted.
//  - The signed-in paths need a real Clerk request context and are not covered
//    at all.
//
// Recording this rather than reporting three passing tests as three tests' worth
// of coverage.
// ---------------------------------------------------------------------------

const ORIGINAL = process.env.CLERK_SECRET_KEY;

test.afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CLERK_SECRET_KEY;
  else process.env.CLERK_SECRET_KEY = ORIGINAL;
});

// REGRESSION TEST — both facts fail CLOSED together, so they cannot contradict
// each other and the page falls back to the plain public landing.
test('an unset Clerk secret yields neither identity nor role', async () => {
  delete process.env.CLERK_SECRET_KEY;
  assert.deepEqual(await resolveSessionFacts(), { isSignedIn: false, isPlatformAdmin: false });
});

test('a blank Clerk secret is treated the same as an unset one', async () => {
  for (const blank of ['', '   ']) {
    process.env.CLERK_SECRET_KEY = blank;
    assert.deepEqual(
      await resolveSessionFacts(),
      { isSignedIn: false, isPlatformAdmin: false },
      `secret ${JSON.stringify(blank)} must not be trusted`
    );
  }
});

// CONTRACT PIN — a signed-in fact is never reported without the admin fact having
// been evaluated under the same precondition. Asserted structurally because the
// authorized paths need a Clerk request context: the two booleans are returned
// from one object literal, so they cannot come from different resolutions.
test('both facts are produced by a single resolution', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/server/adminAuth.ts'), 'utf8');
  const body = source.slice(source.indexOf('export async function resolveSessionFacts'));
  const fn = body.slice(0, body.indexOf('\n}\n') + 3);
  assert.equal((fn.match(/await auth\(\)/g) ?? []).length, 1, 'exactly one auth() call');
  assert.match(fn, /CLERK_SECRET_KEY/, 'guarded by the same secret precondition');
});
