import { NextResponse } from 'next/server';

import { getApiUsageSnapshot } from '@/lib/server/apiUsageBudget';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json({
    snapshot: getApiUsageSnapshot(),
    diagnostics: {
      persistence: 'ephemeral-process-memory',
      authoritative: false,
      sharedAcrossInstances: false,
      note: 'Counters reset on process restart or instance rotation.',
    },
  });
}
