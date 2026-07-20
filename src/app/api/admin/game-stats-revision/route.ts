import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { requireAdminAuth } from '@/lib/server/adminAuth';
import {
  inspectRevisionState,
  isCfbdSeasonType,
  planRevisionRepair,
  readRevisionAuditTrail,
  type RevisionRepairAction,
  type RevisionRepairDryRunRequest,
} from '@/lib/gameStats/revisionRepairInspection';
import type { PartitionIdentity } from '@/lib/gameStats/revisionAuthority';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-086H3B — admin-only revision inspection & repair route.
 *
 * The frozen contract §14 operator surface. Platform-admin authorization is
 * required for BOTH verbs. GET inspects (read-only) and returns the
 * expected-current-state digest an operator must echo back to authorize a
 * repair. POST repairs, defaulting to `dryRun: true` (plan only). This route is
 * the ONE sanctioned production connection to the dormant revision authority; it
 * never activates the automatic lifecycle, arms/activates the fence, or touches
 * game-stat rows.
 */

function parseIdentity(url: URL): PartitionIdentity | null {
  const year = Number(url.searchParams.get('year'));
  const week = Number(url.searchParams.get('week'));
  const seasonType = url.searchParams.get('seasonType');
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isSafeInteger(week) || week < 0 || week > 60) return null;
  if (!isCfbdSeasonType(seasonType)) return null;
  return { year, week, seasonType };
}

function identityFromBody(value: unknown): PartitionIdentity | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { year, week, seasonType } = record;
  if (typeof year !== 'number' || !Number.isSafeInteger(year) || year < 2000 || year > 2100) {
    return null;
  }
  if (typeof week !== 'number' || !Number.isSafeInteger(week) || week < 0 || week > 60) return null;
  if (!isCfbdSeasonType(seasonType)) return null;
  return { year, week, seasonType };
}

function parseAction(value: unknown): RevisionRepairAction | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  switch (record.kind) {
    case 'rebuild-ledger':
      return { kind: 'rebuild-ledger' };
    case 'adopt-lineage':
      if (typeof record.lineage !== 'string' || typeof record.floor !== 'number') return null;
      return { kind: 'adopt-lineage', lineage: record.lineage, floor: record.floor };
    case 'establish-new-lineage':
      return {
        kind: 'establish-new-lineage',
        ...(typeof record.floor === 'number' ? { floor: record.floor } : {}),
      };
    default:
      return null;
  }
}

async function resolveActor(req: Request): Promise<string> {
  try {
    const { userId } = await auth();
    if (userId) return `clerk:${userId}`;
  } catch {
    // Clerk unavailable — fall through to the token actor.
  }
  return req.headers.get('x-admin-token') ? 'admin-token' : 'admin';
}

export async function GET(req: Request): Promise<Response> {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const identity = parseIdentity(url);
  if (!identity) {
    return NextResponse.json(
      {
        error: 'invalid-partition',
        detail: 'year, week, and seasonType (regular|postseason) required',
      },
      { status: 400 }
    );
  }

  const inspection = await inspectRevisionState(identity);
  if ('ok' in inspection && inspection.ok === false) {
    // Redacted: only the stable typed code — never a raw storage message.
    return NextResponse.json({ error: inspection.code }, { status: 503 });
  }
  // Typed audit availability (available | absent | unavailable) is preserved in
  // the response so an operator never sees a failed read as an empty history.
  const audit = await readRevisionAuditTrail(identity);
  return NextResponse.json({ generatedAt: new Date().toISOString(), inspection, audit });
}

export async function POST(req: Request): Promise<Response> {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid-json-body' }, { status: 400 });
  }

  const identity = identityFromBody(body.identity);
  if (!identity) {
    return NextResponse.json({ error: 'invalid-partition' }, { status: 400 });
  }
  const action = parseAction(body.action);
  if (!action) {
    return NextResponse.json({ error: 'invalid-action' }, { status: 400 });
  }
  if (typeof body.expectedStateDigest !== 'string' || body.expectedStateDigest.length === 0) {
    return NextResponse.json({ error: 'expectedStateDigest-required' }, { status: 400 });
  }
  if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    return NextResponse.json({ error: 'reason-required' }, { status: 400 });
  }

  // APPLIED repair is production-DORMANT for prerequisite B
  // (PLATFORM-086H3B-ACTIVATION-DORMANCY-REMEDIATION): the live route may not
  // execute a repair plan while the blind legacy writer and raw public
  // projection are still active. An apply request is refused with a stable typed
  // code and writes NOTHING (no partition stamp, no ledger, no status stamp, no
  // audit record). Inspection (GET) and dry-run planning (below) remain. A later
  // prerequisite that strips public metadata and activates ownership enables it.
  if (body.apply === true) {
    return NextResponse.json(
      {
        error: 'revision-repair-application-not-active',
        detail:
          'Applied revision repair is not active in prerequisite B — inspection and dry-run only. No durable state was changed.',
      },
      { status: 409 }
    );
  }

  // Dormant: the route builds a DRY-RUN request (the flag is not even part of the
  // facade's request type) and plans through the inspection facade — it has no
  // reachable applied-repair capability. `planRevisionRepair` forces `dryRun`.
  const request: RevisionRepairDryRunRequest = {
    identity,
    action,
    expectedStateDigest: body.expectedStateDigest,
    reason: body.reason,
    actor: await resolveActor(req),
    acknowledgeEvidenceLoss: body.acknowledgeEvidenceLoss === true,
    acknowledgeLineageConflict: body.acknowledgeLineageConflict === true,
  };

  const result = await planRevisionRepair(request);
  if (!result.ok) {
    // `detail` is an authored SAFE string for every typed refusal (never a raw
    // storage error); a store failure is 503, every other typed refusal is 409.
    const status = result.code === 'revision-repair-planning-unavailable' ? 503 : 409;
    return NextResponse.json({ error: result.code, detail: result.detail }, { status });
  }
  return NextResponse.json({ result });
}
