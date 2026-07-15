import { NextResponse } from 'next/server';

import { fetchCfbdUsage } from '@/lib/api/cfbdUsage';
import { cfbdCanonicalLimitForTier, normalizeProviderQuota } from '@/lib/api/providerQuota';
import { requireAdminAuth } from '@/lib/server/adminAuth';

export async function GET(req: Request) {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  try {
    const usage = await fetchCfbdUsage();
    // Normalize once, server-side, so both quota surfaces consume the SAME
    // reconciled object and can never disagree or render an impossible
    // combination. `usage.limit` IS the canonical tier limit (or null when the
    // provider tier was unusable — PLATFORM-086G1 finding #7), so an unusable
    // observation normalizes to "unavailable" instead of a fabricated
    // zero-remaining exhaustion.
    const normalized = normalizeProviderQuota({
      used: usage.used,
      remaining: usage.remaining,
      limit: usage.limit,
      patronLevel: usage.patronLevel,
      canonicalLimit:
        usage.patronLevel !== null ? cfbdCanonicalLimitForTier(usage.patronLevel) : null,
      source: 'live provider observation',
    });
    return NextResponse.json({ ...usage, normalized });
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
