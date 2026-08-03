import { requireAdminAuth } from '@/lib/server/adminAuth';
import { initializeMissingLifecycleStatus, isValidSlug } from '@/lib/leagueRegistry';

/**
 * PLATFORM-086F2H1 — the explicit legacy missing-status recovery operation the
 * F2B lifecycle work deferred.
 *
 * This is NOT a generic lifecycle setter. It exposes exactly one authority
 * (`initializeMissingLifecycleStatus`), which installs the read-only
 * compatibility interpretation a legacy record already renders under
 * (`{ state: 'season', year: league.year }`) on a league whose `status` property
 * is genuinely absent — and refuses everything else. There is no season/
 * preseason/offseason selection, no year edit, no archive, and no rollover
 * bypass; a league with any existing status (valid or malformed) is refused, as
 * is the `test` league, whose lifecycle stays owned by its own test controls.
 *
 * There is deliberately no GET: F2H3's Season Management UI reads lifecycle
 * state server-side from the registry. No UI invokes this route in F2H1 — it is
 * a dormant, tested authority until F2H3 presents the required explanation and
 * confirmation.
 *
 * Every response is rebuilt field-by-field from an allowlist. The league record
 * carries credential material (`passwordHash` / `passwordSalt`) and is never
 * spread into a response, and a store fault is reported as one stable code with
 * no thrown-error text, stack, or storage detail.
 */

type RecoveryErrorCode =
  | 'lifecycle-recovery-invalid-request'
  | 'lifecycle-recovery-league-not-found'
  | 'lifecycle-status-already-present'
  | 'test-league-lifecycle-managed-separately'
  | 'lifecycle-recovery-invalid-legacy-record'
  | 'lifecycle-recovery-unavailable';

function failure(error: RecoveryErrorCode, detail: string, status: number): Response {
  return Response.json({ error, detail }, { status });
}

export async function POST(req: Request): Promise<Response> {
  // Authenticate before any registry read or write.
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return failure('lifecycle-recovery-invalid-request', 'Body must be valid JSON.', 400);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return failure('lifecycle-recovery-invalid-request', 'Body must be an object.', 400);
  }
  const body = raw as Record<string, unknown>;

  const leagueSlug = body.leagueSlug;
  if (typeof leagueSlug !== 'string' || !isValidSlug(leagueSlug)) {
    return failure(
      'lifecycle-recovery-invalid-request',
      'leagueSlug must be a canonical league slug.',
      400
    );
  }
  // Literal `true` only — a truthy value is not confirmation for a durable
  // lifecycle write.
  if (body.confirmed !== true) {
    return failure(
      'lifecycle-recovery-invalid-request',
      'confirmed must be exactly true to initialize a missing lifecycle status.',
      400
    );
  }

  let result: Awaited<ReturnType<typeof initializeMissingLifecycleStatus>>;
  try {
    result = await initializeMissingLifecycleStatus(leagueSlug);
  } catch {
    // Store read/write failure — the registry is unchanged (the authority writes
    // inside one transaction). The underlying error is never surfaced.
    return failure(
      'lifecycle-recovery-unavailable',
      'The league registry could not be read or written. No lifecycle status was installed.',
      503
    );
  }

  switch (result.outcome) {
    case 'initialized':
      // Allowlisted success body — slug plus the installed public status/year.
      return Response.json({
        leagueSlug,
        status: { state: 'season' as const, year: result.league.year },
        year: result.league.year,
      });
    case 'league-not-found':
      return failure(
        'lifecycle-recovery-league-not-found',
        `No league is registered with the slug '${leagueSlug}'.`,
        404
      );
    case 'test-league-managed-separately':
      return failure(
        'test-league-lifecycle-managed-separately',
        'The test league lifecycle is managed by its own test controls.',
        409
      );
    case 'status-already-present':
      return failure(
        'lifecycle-status-already-present',
        'This league already has a lifecycle status. Recovery only initializes a genuinely absent status.',
        409
      );
    case 'invalid-existing-status':
    case 'invalid-legacy-year':
      return failure(
        'lifecycle-recovery-invalid-legacy-record',
        'This league record cannot be interpreted for recovery. Recovery never repairs a malformed status or invents a season year.',
        409
      );
  }
}
