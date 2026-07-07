import assert from 'node:assert/strict';
import test from 'node:test';

import { isPlatformAdminClaims, requiresPlatformAdminPage } from '../platformAdmin.ts';

// ---------------------------------------------------------------------------
// PLATFORM-074 — shared platform-admin predicate + page-family gate.
//
// The middleware gate over /admin/* and /debug/* is a thin wiring of two pure
// functions: isPlatformAdminClaims (who is a platform admin) and
// requiresPlatformAdminPage (which browser paths require it). These tests pin
// the fail-closed authorization decisions and the exact route families.
// ---------------------------------------------------------------------------

test('isPlatformAdminClaims grants only the platform_admin app role', () => {
  assert.equal(isPlatformAdminClaims({ publicMetadata: { role: 'platform_admin' } }), true);
});

test('isPlatformAdminClaims denies signed-in non-admin roles', () => {
  assert.equal(isPlatformAdminClaims({ publicMetadata: { role: 'user' } }), false);
  assert.equal(isPlatformAdminClaims({ publicMetadata: { role: 'commissioner' } }), false);
  assert.equal(isPlatformAdminClaims({ publicMetadata: {} }), false);
});

test('isPlatformAdminClaims fails closed on missing / empty claims', () => {
  assert.equal(isPlatformAdminClaims(null), false);
  assert.equal(isPlatformAdminClaims(undefined), false);
  assert.equal(isPlatformAdminClaims({}), false);
  // A stray top-level `role` must NOT be honored — only publicMetadata.role counts.
  assert.equal(isPlatformAdminClaims({ role: 'platform_admin' }), false);
});

test('requiresPlatformAdminPage gates the /debug and /admin browser families', () => {
  for (const path of ['/debug', '/debug/teams', '/debug/anything/deep', '/admin', '/admin/alpha']) {
    assert.equal(requiresPlatformAdminPage(path), true, `${path} must require platform admin`);
  }
});

test('requiresPlatformAdminPage does NOT match API routes (route-level gated instead)', () => {
  for (const path of ['/api/debug/schedule', '/api/debug/scores', '/api/admin/usage']) {
    assert.equal(requiresPlatformAdminPage(path), false, `${path} is gated at the route boundary`);
  }
});

test('requiresPlatformAdminPage leaves public / league paths open and avoids prefix over-match', () => {
  for (const path of ['/', '/login', '/league/alpha', '/debugger', '/administrator']) {
    assert.equal(requiresPlatformAdminPage(path), false, `${path} must stay ungated`);
  }
});
