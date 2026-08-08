import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getLeague, updateLeague, removeLeague } from '@/lib/leagueRegistry';
import { sanitizeLeague, sanitizeLeagues } from '@/lib/leagueSanitize';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const { slug } = await params;

  const existing = await getLeague(slug);
  if (!existing) {
    return new Response(`League "${slug}" not found`, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return new Response('Body must be an object', { status: 400 });
  }

  const obj = body as Record<string, unknown>;

  // PLATFORM-086F2B — the season year and lifecycle status are managed only by
  // the guarded lifecycle operations in `leagueRegistry.ts`; this configuration
  // route must not offer a second, competing year authority. Reject explicitly
  // rather than silently ignoring the field.
  if ('year' in obj) {
    return Response.json(
      {
        error: 'league-year-lifecycle-managed',
        detail: 'Season year is managed through league lifecycle operations.',
      },
      { status: 409 }
    );
  }
  if ('status' in obj) {
    return Response.json(
      {
        error: 'league-status-lifecycle-managed',
        detail: 'League lifecycle status is managed through league lifecycle operations.',
      },
      { status: 409 }
    );
  }

  // PLATFORM-086F2J — the founding year is set once, at creation, and never
  // edited afterwards.
  //
  // Refused BEFORE any field is applied, exactly as the lifecycle fields above
  // are: a body mixing `foundedYear` with a valid `displayName` writes NOTHING.
  // A partial apply would leave the operator with a name change they did not ask
  // for in isolation and a silent refusal of the field they did.
  //
  // A DISTINCT code from the lifecycle refusals, because it is a different rule:
  // `year` and `status` are managed by lifecycle OPERATIONS and keep changing;
  // this value is frozen from the moment the record exists.
  if ('foundedYear' in obj) {
    return Response.json(
      {
        error: 'league-founded-year-immutable',
        detail:
          'The founding year is set when the league is created and cannot be changed afterwards.',
      },
      { status: 409 }
    );
  }

  const updates: { displayName?: string } = {};

  if ('displayName' in obj) {
    if (typeof obj.displayName !== 'string' || !obj.displayName.trim()) {
      return new Response('displayName must be a non-empty string', { status: 400 });
    }
    updates.displayName = obj.displayName.trim();
  }

  if (Object.keys(updates).length === 0) {
    return new Response('No updatable fields provided (displayName)', {
      status: 400,
    });
  }

  const updated = await updateLeague(slug, updates);
  if (!updated) {
    return new Response(`League "${slug}" not found`, { status: 404 });
  }
  return Response.json({ league: sanitizeLeague(updated) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const { slug } = await params;

  const existing = await getLeague(slug);
  if (!existing) {
    return new Response(`League "${slug}" not found`, { status: 404 });
  }

  // PLATFORM-086F2I — the delete is IRREVERSIBLE and had no confirmation the
  // server could see. `requireAdminRequest` accepts a static `ADMIN_API_TOKEN`
  // alongside the Clerk session, so anyone holding that token can call this
  // endpoint directly; a confirmation living only in the browser is decoration.
  // Enforced here for the same reason F2H1SB moved authorization into the Server
  // Actions: routing is never the authority, and neither is the UI.
  //
  // The confirmation is the SLUG, not a fixed word. A fixed word is identical on
  // every row, so it defends against a stray click but not against acting on the
  // WRONG LEAGUE — which is the accident this guard exists for.
  const confirmation = new URL(req.url).searchParams.get('confirm');
  //
  // PLAIN TEXT, matching every other error on this route. The only client does
  // `await res.text()` and renders it verbatim, so a JSON body would put a raw
  // `{"error":...}` blob in front of an operator. The stable code stays as the
  // first token so it is still greppable and assertable.
  if (confirmation === null) {
    return new Response(
      `league-delete-confirmation-required: deleting a league is irreversible. ` +
        `Re-send with ?confirm=${slug} to proceed.`,
      { status: 400 }
    );
  }
  if (confirmation !== slug) {
    // Deliberately DISTINCT from the absent case. "You did not confirm" and
    // "you confirmed a different league" are different operator conditions, and
    // the second is the dangerous one.
    return new Response(
      `league-delete-confirmation-mismatch: the confirmation did not match "${slug}". ` +
        `Nothing was deleted.`,
      { status: 400 }
    );
  }

  const { leagues } = await removeLeague(slug);
  return Response.json({
    leagues: sanitizeLeagues(leagues),
    note: 'Registry entry removed. League-scoped storage data (owners, aliases, overrides) is not deleted — clean up manually if needed.',
  });
}
