import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { auth } from '@clerk/nextjs/server';

import { getLeague } from './leagueRegistry.ts';

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

/**
 * Cookie token format: `<expirationMs>.<slug>.<hexSignature>`
 * The signature is HMAC-SHA256 over `<expirationMs>.<slug>` keyed by
 * `LEAGUE_AUTH_SECRET`. Including the slug binds the cookie to the league.
 */
export function createLeagueAuthCookie(slug: string): string {
  const expiresAt = Date.now() + COOKIE_MAX_AGE_SECONDS * 1000;
  const payload = `${expiresAt}.${slug}`;
  const signature = signToken(payload);
  return `${payload}.${signature}`;
}

export function verifyLeagueAuthCookie(slug: string, cookieValue: string): boolean {
  if (typeof cookieValue !== 'string' || cookieValue.length === 0) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return false;
  const [expiresAtStr, cookieSlug, providedSignature] = parts;

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
  const expectedSignature = signToken(`${expiresAtStr}.${cookieSlug}`);
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

async function isPlatformAdmin(): Promise<boolean> {
  try {
    const { userId, sessionClaims } = await auth();
    if (!userId) return false;
    const claims = sessionClaims as Record<string, unknown> & {
      publicMetadata?: Record<string, unknown>;
    };
    return claims?.publicMetadata?.role === 'platform_admin';
  } catch {
    return false;
  }
}

/**
 * Single source of truth for whether a request is authorized to view a given league.
 *
 * Bypass conditions (in order, short-circuiting on first match):
 *   1. League has no password set (public mode — current default).
 *   2. Caller is a platform admin (Clerk publicMetadata.role === 'platform_admin').
 *   3. Request carries a valid, unexpired signed cookie for this league.
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

  // 2. Platform admin bypass
  if (await isPlatformAdmin()) return true;

  // 3. Valid signed cookie for this league
  const jar = await cookies();
  const cookieValue = jar.get(leagueAuthCookieName(slug))?.value ?? '';
  if (cookieValue && verifyLeagueAuthCookie(slug, cookieValue)) return true;

  return false;
}
