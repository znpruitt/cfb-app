import { NextResponse } from 'next/server';

import { getAppStateStorageStatus } from '@/lib/server/appStateStore';
import { isAdminTokenConfigured } from '@/lib/server/adminAuth';

export async function GET() {
  return NextResponse.json({
    storage: getAppStateStorageStatus(),
    adminTokenConfigured: isAdminTokenConfigured(),
  });
}
