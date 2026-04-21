import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

import { getLeague } from './leagueRegistry.ts';
import { isAuthorizedAdminCaller } from './server/adminAuth.ts';

/**
 * Server-side helpers for the per-league password gate.
 *
 * Bridge toward eventual Clerk-based per-user authorization (Phase 8):
 * `isAuthorizedForLeague` is the single bypass check called from every
 * `/league/[slug]/*` page. New conditions (commissioner-per-league,
 * owner-per-league) can be added inside that function without restructuring
 * any page-level code.
 */

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_COST = 16384;
const SALT_LENGTH_BYTES = 16;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const COOKIE_PREFIX = 'league_auth_';

export type LeaguePasswordHash = {
  hash: string;
  salt: string;
};

function getSigningSecret(): string {
  const secret = process.env.LEAGUE_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error(
      'LEAGUE_AUTH_SECRET is not configured. Set it to a long random value (e.g. `openssl rand -hex 32`) before the league password gate can function.'
    );
  }
  return secret;
}

export function hashLeaguePassword(plaintext: string): LeaguePasswordHash {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const salt = randomBytes(SALT_LENGTH_BYTES).toString('hex');
  const hashBuffer = scryptSync(plaintext, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
  });
  return { hash: hashBuffer.toString('hex'), salt };
}

export function verifyLeaguePassword(plaintext: string, hash: string, salt: string): boolean {
  if (
    typeof plaintext !== 'string' ||
    typeof hash !== 'string' ||
    typeof salt !== 'string' ||
    plaintext.length === 0 ||
    hash.length === 0 ||
    salt.length === 0
  ) {
    return false;
  }
  let candidate: Buffer;
  let expected: Buffer;
  try {
    candidate = scryptSync(plaintext, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_COST,
    });
    expected = Buffer.from(hash, 'hex');
  } catch {
    return false;
  }
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function leagueAuthCookieName(slug: string): string {
  return `${COOKIE_PREFIX}${slug}`;
}

function signToken(payload: string): string {
  return createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
}

const FINGERPRINT_LENGTH = 16;

/**
 * Derives a short, non-reversible fingerprint of the stored password hash.
 * Rotating the password (new hash + new salt) changes the fingerprint, which
 * invalidates previously issued cookies without requiring any revocation list.
 * We fingerprint the hash — not the plaintext — so the signing secret is the
 * only thing that can forge cookies; the fingerprint merely binds the cookie
 * to a specific password version.
 */
function computePasswordFingerprint(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex').slice(0, FINGERPRINT_LENGTH);
}

/**
 * Cookie token format: `<expirationMs>.<slug>.<passwordFingerprint>.<hexSignature>`
 * The signature is HMAC-SHA256 over `<expirationMs>.<slug>.<passwordFingerprint>`
 * keyed by `LEAGUE_AUTH_SECRET`. Including the slug binds the cookie to the
 * league; including the fingerprint binds it to the current password version,
 * so rotating the password auto-invalidates all previously issued cookies.
 */
export async function createLeagueAuthCookie(slug: string): Promise<string> {
  const league = await getLeague(slug);
  if (!league || !leagueHasPassword(league)) {
    // Programming error: callers must only mint cookies for leagues that have
    // a password set. The POST /auth route already verified the password, so
    // this can only fire if a commissioner removed the password between the
    // verify step and the cookie mint — extremely unlikely, but fail loud.
    throw new Error(`Cannot mint league auth cookie: league '${slug}' has no password set`);
  }
  const fingerprint = computePasswordFingerprint(league.passwordHash!);
  const expiresAt = Date.now() + COOKIE_MAX_AGE_SECONDS * 1000;
  const payload = `${expiresAt}.${slug}.${fingerprint}`;
  const signature = signToken(payload);
  return `${payload}.${signature}`;
}

export async function verifyLeagueAuthCookie(slug: string, cookieValue: string): Promise<boolean> {
  if (typeof cookieValue !== 'string' || cookieValue.length === 0) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 4) return false;
  const [expiresAtStr, cookieSlug, cookieFingerprint, providedSignature] = parts;

  // Timing-safe slug comparison. Pad to equal length so timingSafeEqual doesn't throw;
  // a length mismatch is a definitive denial but we still do constant-time work.
  try {
    const maxLen = Math.max(Buffer.byteLength(cookieSlug, 'utf8'), Buffer.byteLength(slug, 'utf8'));
    const aBuf = Buffer.alloc(maxLen);
    const bBuf = Buffer.alloc(maxLen);
    aBuf.write(cookieSlug, 'utf8');
    bBuf.write(slug, 'utf8');
    if (!timingSafeEqual(aBuf, bBuf)) return false;
  } catch {
    return false;
  }

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  // Verify the fingerprint matches the league's current password. This is the
  // rotation binding: if the commissioner has changed the password since this
  // cookie was minted, the fingerprints will differ and the cookie is rejected.
  const league = await getLeague(slug);
  if (!league || !leagueHasPassword(league)) return false;
  const expectedFingerprint = computePasswordFingerprint(league.passwordHash!);
  try {
    const maxLen = Math.max(
      Buffer.byteLength(cookieFingerprint, 'utf8'),
      Buffer.byteLength(expectedFingerprint, 'utf8')
    );
    const aBuf = Buffer.alloc(maxLen);
    const bBuf = Buffer.alloc(maxLen);
    aBuf.write(cookieFingerprint, 'utf8');
    bBuf.write(expectedFingerprint, 'utf8');
    if (!timingSafeEqual(aBuf, bBuf)) return false;
  } catch {
    return false;
  }

  const expectedSignature = signToken(`${expiresAtStr}.${cookieSlug}.${cookieFingerprint}`);
  if (expectedSignature.length !== providedSignature.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(providedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

export function leagueHasPassword(league: {
  passwordHash?: string;
  passwordSalt?: string;
}): boolean {
  return Boolean(
    league.passwordHash &&
      league.passwordSalt &&
      league.passwordHash.length > 0 &&
      league.passwordSalt.length > 0
  );
}

/**
 * Single source of truth for whether a request is authorized to view a given league.
 *
 * Bypass conditions (in order, short-circuiting on first match):
 *   1. League has no password set (public mode — current default).
 *   2. Caller is an authorized platform admin (Clerk platform_admin session
 *      OR valid ADMIN_API_TOKEN via request header). Delegated to the shared
 *      `isAuthorizedAdminCaller` helper so the token-fallback logic lives in
 *      exactly one place (AGENTS.md invariant #6).
 *   3. Request carries a valid, unexpired signed cookie for this league
 *      (cookie is bound to the current password fingerprint so rotation
 *      invalidates older cookies automatically).
 *
 * Phase 8 will add additional conditions (commissioner-per-league bypass,
 * owner-per-league bypass via Clerk roster) — extend this function in place,
 * keeping the short-circuit chain ordered cheapest-to-most-expensive.
 */
export async function isAuthorizedForLeague(slug: string): Promise<boolean> {
  const league = await getLeague(slug);
  if (!league) return false; // unknown league — deny; pages call notFound() after the gate

  // 1. Public league — no password configured
  if (!leagueHasPassword(league)) return true;

  // 2. Platform admin bypass (Clerk session or ADMIN_API_TOKEN)
  if (await isAuthorizedAdminCaller()) return true;

  // 3. Valid signed cookie for this league (bound to current password fingerprint)
  const jar = await cookies();
  const cookieValue = jar.get(leagueAuthCookieName(slug))?.value ?? '';
  if (cookieValue && (await verifyLeagueAuthCookie(slug, cookieValue))) return true;

  return false;
}
