import { NextResponse } from 'next/server';

import {
  getAmbiguousConferenceDiagnostics,
  getPresentDayPolicyConferenceDiagnostics,
  getUnresolvedConferenceDiagnostics,
} from '@/lib/conferenceDiagnostics';

export const dynamic = 'force-dynamic';

export async function GET() {
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
