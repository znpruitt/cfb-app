import { NextResponse } from 'next/server';

import { getApiUsageSnapshot } from '@/lib/server/apiUsageBudget';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(getApiUsageSnapshot());
}
