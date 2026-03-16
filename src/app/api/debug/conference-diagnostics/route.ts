import { NextResponse } from 'next/server';

import { getUnresolvedConferenceDiagnostics } from '@/lib/conferenceDiagnostics';

export const dynamic = 'force-dynamic';

export async function GET() {
  const unresolved = getUnresolvedConferenceDiagnostics();
  return NextResponse.json({
    count: unresolved.length,
    unresolved,
  });
}
