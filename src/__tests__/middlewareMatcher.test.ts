import assert from 'node:assert/strict';
import test from 'node:test';

import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server.js';

import { config } from '../middleware.ts';
import { requiresPlatformAdminPage } from '../lib/auth/platformAdmin.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1SA — the protected page families must actually reach the
// middleware.
//
// The generic static-file exclusion is a SUBSTRING rule, not a suffix rule
// about real assets: any path CONTAINING one of the listed extensions was
// skipped. `/admin/audit.css` therefore bypassed `clerkMiddleware` entirely
// while still resolving to `app/admin/[slug]/page` — a worker where every
// Server Action is registered — so an unauthenticated caller could invoke them.
//
// These tests exercise the REAL exported `config` through Next's own matcher
// evaluator. A hand-copied regex would keep passing while the shipped matcher
// stayed broken, which is exactly the failure this slice exists to prevent.
// ---------------------------------------------------------------------------

function matches(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });
}

// The bypass itself: dotted paths under the protected prefixes.
test('a protected path with a static-looking extension still reaches the middleware', () => {
  for (const url of [
    '/admin/audit.css',
    '/admin/test.css',
    '/admin/x.png',
    '/admin/x.js',
    '/admin/x.svg',
    '/admin/x.webmanifest',
    '/admin/x.zip',
    '/debug/y.svg',
    '/debug/y.css',
    '/debug/y.ico',
  ]) {
    assert.equal(matches(url), true, `${url} must be matched — it resolves to a protected route`);
  }
});

test('nested and multi-segment dotted protected paths are matched', () => {
  for (const url of [
    '/admin/a/b.css',
    '/admin/test/preseason.png',
    '/admin/a/b/c.js',
    '/debug/a/b.svg',
    '/admin/weird.name.css',
  ]) {
    assert.equal(matches(url), true, url);
  }
});

test('a query string cannot smuggle a protected path past the matcher', () => {
  for (const url of ['/admin/test?x=1', '/admin/test.css?v=2', '/debug?f=a.css']) {
    assert.equal(matches(url), true, url);
  }
});

// The ordinary cases must be unaffected.
test('plain protected paths and their roots are matched', () => {
  for (const url of ['/admin', '/admin/', '/admin/test', '/admin/test/preseason', '/debug']) {
    assert.equal(matches(url), true, url);
  }
});

test('genuine static assets outside the protected prefixes are still skipped', () => {
  for (const url of [
    '/styles.css',
    '/assets/image.png',
    '/fonts/x.woff2',
    '/favicon.ico',
    '/site.webmanifest',
    '/logo.svg',
  ]) {
    assert.equal(matches(url), false, `${url} must stay skipped — the exclusion still applies`);
  }
});

test('API routes are still matched, including dotted ones', () => {
  for (const url of ['/api/admin/leagues', '/api/foo.css', '/trpc/x']) {
    assert.equal(matches(url), true, url);
  }
});

// The new positive matchers must not widen the protected surface.
test('the added matchers do not overmatch neighbouring prefixes', () => {
  // These are NOT protected routes. Whether the matcher runs for them is
  // incidental — what must hold is that the middleware's own predicate does not
  // treat them as protected, so no unrelated path gains a redirect.
  for (const pathname of ['/admin-x/page.css', '/administrator', '/debugger', '/debug-tools/a']) {
    assert.equal(
      requiresPlatformAdminPage(pathname),
      false,
      `${pathname} must not be treated as a protected page family`
    );
  }

  // And the genuinely protected ones still are.
  for (const pathname of ['/admin', '/admin/test', '/admin/audit.css', '/debug', '/debug/y.svg']) {
    assert.equal(requiresPlatformAdminPage(pathname), true, pathname);
  }
});

// Guard the fix itself: the positive matchers must be present and ordered ahead
// of the exclusion, since the exclusion cannot be repaired by anchoring.
test('the protected prefixes are matched explicitly, ahead of the static exclusion', () => {
  const patterns = config.matcher;
  const adminIndex = patterns.indexOf('/admin/:path*');
  const debugIndex = patterns.indexOf('/debug/:path*');
  const exclusionIndex = patterns.findIndex((p) => p.includes('_next'));

  assert.notEqual(adminIndex, -1, 'the /admin matcher is present');
  assert.notEqual(debugIndex, -1, 'the /debug matcher is present');
  assert.ok(adminIndex < exclusionIndex, 'the /admin matcher precedes the static exclusion');
  assert.ok(debugIndex < exclusionIndex, 'the /debug matcher precedes the static exclusion');
});
