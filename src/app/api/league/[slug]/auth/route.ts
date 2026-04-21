import { cookies } from 'next/headers';

import { getLeague } from '@/lib/leagueRegistry';
import {
  createLeagueAuthCookie,
  leagueAuthCookieName,
  leagueHasPassword,
  verifyLeaguePassword,
} from '@/lib/leagueAuth';

export const runtime = 'nodejs';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const FAILURE_DELAY_MS = 500;

function startDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  // Start the minimum failure delay immediately so all failure paths share the
  // same floor wall-clock time regardless of whether scrypt ran (cheap paths
  // naturally finish first and then wait for the delay; expensive scrypt paths
  // run concurrently and the delay adds only what remains).
  const failureDelay = startDelay(FAILURE_DELAY_MS);
  const { slug } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    await failureDelay;
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  const password =
    body && typeof body === 'object' && 'password' in body
      ? (body as { password?: unknown }).password
      : undefined;

  if (typeof password !== 'string' || password.length === 0) {
    await failureDelay;
    return Response.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const league = await getLeague(slug);
  if (!league || !leagueHasPassword(league)) {
    await failureDelay;
    return Response.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const ok = verifyLeaguePassword(password, league.passwordHash!, league.passwordSalt!);
  if (!ok) {
    await failureDelay;
    return Response.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const jar = await cookies();
  jar.set(leagueAuthCookieName(slug), createLeagueAuthCookie(slug), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return Response.json({ ok: true });
}
