import { requireAdminAuthHeaders } from '@/lib/adminAuth';

export type CfbdUsageSnapshot = {
  patronLevel: number;
  used: number;
  remaining: number;
  limit: number;
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
