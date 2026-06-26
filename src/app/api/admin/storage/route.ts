import { NextResponse } from 'next/server';

import { getAppStateStorageStatus } from '@/lib/server/appStateStore';
import { isAdminTokenConfigured, requireAdminAuth } from '@/lib/server/adminAuth';

export async function GET(req: Request) {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  return NextResponse.json({
    storage: getAppStateStorageStatus(),
    adminTokenConfigured: isAdminTokenConfigured(),
    diagnostics: {
      appState: {
        persistence: 'shared-durable',
        authoritative: true,
      },
      routeCounters: {
        persistence: 'ephemeral-process-memory',
        authoritative: false,
      },
    },
  });
}
