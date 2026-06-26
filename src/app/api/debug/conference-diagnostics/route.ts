import { NextResponse } from 'next/server';

import {
  getAmbiguousConferenceDiagnostics,
  getPresentDayPolicyConferenceDiagnostics,
  getUnresolvedConferenceDiagnostics,
} from '@/lib/conferenceDiagnostics';
import { requireAdminAuth } from '@/lib/server/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const unresolved = getUnresolvedConferenceDiagnostics();
  const ambiguous = getAmbiguousConferenceDiagnostics();
  const presentDayPolicy = getPresentDayPolicyConferenceDiagnostics();

  return NextResponse.json({
    count: unresolved.length + ambiguous.length + presentDayPolicy.length,
    unresolvedCount: unresolved.length,
    ambiguousCount: ambiguous.length,
    presentDayPolicyCount: presentDayPolicy.length,
    unresolved,
    ambiguous,
    presentDayPolicy,
  });
}
