import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { NormalizedProviderQuota } from '@/lib/api/providerQuota';

export type CfbdUsageSnapshot = {
  /**
   * Raw provider fields (retained for diagnostic detail only). Each is `null`
   * when the provider did not supply a usable value — unavailable is distinct
   * from a genuine 0 (PLATFORM-086G1 finding #7).
   */
  patronLevel: number | null;
  used: number | null;
  remaining: number | null;
  limit: number | null;
  /**
   * Authoritative reconciled quota shared by both quota surfaces. Panels must
   * render this rather than the raw fields, which may be internally inconsistent.
   */
  normalized: NormalizedProviderQuota;
};

export type OddsUsageSnapshot = {
  used: number;
  remaining: number;
  lastCost: number;
  limit: number;
  capturedAt: string;
  source: 'odds-response-headers' | 'quota-error-fallback';
  sportKey?: string;
  markets?: string[];
  regions?: string[];
  endpointType?: string;
  cacheStatus?: 'hit' | 'miss' | 'unknown';
};

export async function fetchCfbdUsageSnapshot(): Promise<CfbdUsageSnapshot> {
  // Admin-only endpoint — send the admin token (these snapshots are only ever
  // requested from admin surfaces).
  const res = await fetch('/api/admin/usage', {
    cache: 'no-store',
    headers: { ...(requireAdminAuthHeaders() as Record<string, string>) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`usage ${res.status} ${detail}`);
  }

  return (await res.json()) as CfbdUsageSnapshot;
}

export async function fetchLatestOddsUsageSnapshot(): Promise<OddsUsageSnapshot | null> {
  // Admin-only endpoint — send the admin token. Only admin surfaces call this
  // (CFBScheduleApp gates the call behind isAdmin).
  const res = await fetch('/api/admin/odds-usage', {
    cache: 'no-store',
    headers: { ...(requireAdminAuthHeaders() as Record<string, string>) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`odds usage ${res.status} ${detail}`);
  }

  const payload = (await res.json()) as { usage?: OddsUsageSnapshot | null };
  return payload.usage ?? null;
}
