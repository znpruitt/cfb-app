import type { League, PublicLeague } from '@/lib/league';

/**
 * Strip credential fields (`passwordHash`, `passwordSalt`) from a `League`
 * before it crosses a server→client RSC boundary or is returned from an API
 * route. Uses explicit destructuring rather than JSON serialization so the
 * shape change is enforced by the type system.
 */
export function sanitizeLeague(league: League): PublicLeague {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, passwordSalt, ...publicFields } = league;
  return publicFields;
}

export function sanitizeLeagues(leagues: League[]): PublicLeague[] {
  return leagues.map(sanitizeLeague);
}
