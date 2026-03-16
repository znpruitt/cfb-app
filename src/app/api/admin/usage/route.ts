import { NextResponse } from 'next/server';

import { fetchCfbdUsage } from '@/lib/api/cfbdUsage';

export async function GET() {
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
