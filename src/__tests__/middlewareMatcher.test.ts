import assert from 'node:assert/strict';
import test from 'node:test';

import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server.js';

import { config } from '../middleware.ts';
import nextConfig from '../../next.config.ts';
import { PLATFORM_ADMIN_PAGE_PREFIXES } from '../lib/auth/platformAdmin.ts';

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

// BOTH inputs are the real shipped ones. Matching depends on `nextConfig` too —
// with `basePath: '/app'` the same matcher stops covering `/admin/audit.css` —
// so hardcoding `{}` here would reintroduce, on the second input, exactly the
// fidelity failure this file exists to prevent.
function matches(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config, nextConfig, url });
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

// The added prefix matchers must not widen the STATIC-ASSET surface. (Whether
// `requiresPlatformAdminPage` treats these as protected is already owned by
// `src/lib/auth/__tests__/platformAdmin.test.ts`; asserting it again here would
// give one contract two owners.)
test('the added matchers do not pull neighbouring static assets into the middleware', () => {
  assert.equal(
    matches('/admin-x/page.css'),
    false,
    '/admin-x is not a protected prefix, so its assets stay excluded'
  );
  assert.equal(matches('/debug-tools/logo.svg'), false, '/debug-tools is not a protected prefix');
});

// Guard the fix against the way it will actually regress: a THIRD protected
// prefix added to `PLATFORM_ADMIN_PAGE_PREFIXES` without a matcher entry falls
// back to the exclusion and is unauthenticated again. Order is NOT asserted —
// Next ORs the matcher entries, so position carries no meaning.
test('every protected page prefix has a matcher entry, whatever the order', () => {
  for (const prefix of PLATFORM_ADMIN_PAGE_PREFIXES) {
    assert.ok(
      config.matcher.includes(`${prefix}/:path*`),
      `${prefix} is gated by requiresPlatformAdminPage but has no matcher entry — ` +
        `a dotted path under it would skip middleware entirely`
    );
    // And it holds end to end through Next's own evaluator.
    assert.equal(matches(`${prefix}/probe.css`), true, `${prefix}/probe.css`);
    assert.equal(matches(prefix), true, prefix);
  }
});

// The root cause, closed by the `$` anchor: the exclusion was a substring rule.
test('a dotted segment mid-path no longer skips the middleware', () => {
  for (const url of ['/foo/bar.css/baz', '/league/my.team.zip/roster', '/x.png/y']) {
    assert.equal(matches(url), true, `${url} must not be mistaken for a static asset`);
  }
});
