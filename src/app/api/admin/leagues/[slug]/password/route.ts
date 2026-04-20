import { requireAdminAuth } from '@/lib/server/adminAuth';
import { getLeague, updateLeague } from '@/lib/leagueRegistry';
import { hashLeaguePassword } from '@/lib/leagueAuth';

export const runtime = 'nodejs';

/** Set or change the league password. Body: { password: string } */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const { slug } = await params;
  const existing = await getLeague(slug);
  if (!existing) return new Response(`League "${slug}" not found`, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const password =
    body && typeof body === 'object' && 'password' in body
      ? (body as { password?: unknown }).password
      : undefined;

  if (typeof password !== 'string' || password.trim().length === 0) {
    return new Response('password must be a non-empty string', { status: 400 });
  }
  if (password.length < 4) {
    return new Response('password must be at least 4 characters', { status: 400 });
  }

  const { hash, salt } = hashLeaguePassword(password);
  await updateLeague(slug, { passwordHash: hash, passwordSalt: salt });

  // Never echo the hash, salt, or plaintext back to the client.
  return Response.json({ ok: true, hasPassword: true });
}

/** Remove the league password — reverts the league to public. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const { slug } = await params;
  const existing = await getLeague(slug);
  if (!existing) return new Response(`League "${slug}" not found`, { status: 404 });

  await updateLeague(slug, { passwordHash: undefined, passwordSalt: undefined });
  return Response.json({ ok: true, hasPassword: false });
}
