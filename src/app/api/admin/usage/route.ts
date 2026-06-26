import { NextResponse } from 'next/server';

import { fetchCfbdUsage } from '@/lib/api/cfbdUsage';
import { requireAdminAuth } from '@/lib/server/adminAuth';

export async function GET(req: Request) {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  try {
    const usage = await fetchCfbdUsage();
    return NextResponse.json(usage);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'usage-fetch-failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
