import { requireAdminAuth } from '@/lib/server/adminAuth';
import { getLeague, updateLeague, clearLeaguePassword } from '@/lib/leagueRegistry';
import { assertSigningSecretConfigured, hashLeaguePassword } from '@/lib/leagueAuth';

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

  // Fail fast if the deployment is missing the signing secret. Without it,
  // a password hash could be persisted but no valid cookie could ever be
  // minted — the league would become inaccessible to non-admins. 503 (vs 500)
  // reflects the known recoverable server-config state.
  try {
    assertSigningSecretConfigured();
  } catch {
    return Response.json(
      {
        error:
          'LEAGUE_AUTH_SECRET is not configured on this deployment. Password-gated privacy cannot be enabled until the signing secret is set. Contact the platform admin.',
      },
      { status: 503 }
    );
  }

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
  if (password.length < 8) {
    return new Response('password must be at least 8 characters', { status: 400 });
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

  await clearLeaguePassword(slug);
  return Response.json({ ok: true, hasPassword: false });
}
