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

/**
 * Pick the FRESHER of two odds-usage snapshots by `capturedAt` (PLATFORM-086C3
 * remediation). A `null` incoming never overwrites a known snapshot, and an OLDER
 * snapshot never overwrites a newer one — so the two concurrent writers of the
 * shared client `oddsUsage` state (`useAdminOddsUsage` from the durable admin
 * reading, and `useOddsHydration` from the public cache meta, which after 086C2 can
 * be a staler `responseEntry.usage` or null) converge on the newest reading
 * regardless of which resolves last. A validly-timestamped snapshot always beats an
 * untimestamped one; a same-or-newer timestamp applies so a genuine refresh still
 * lands.
 */
export function mergeFresherOddsUsage(
  prev: OddsUsageSnapshot | null,
  next: OddsUsageSnapshot | null
): OddsUsageSnapshot | null {
  if (!next) return prev;
  if (!prev) return next;
  const prevMs = Date.parse(prev.capturedAt);
  const nextMs = Date.parse(next.capturedAt);
  const prevValid = Number.isFinite(prevMs);
  const nextValid = Number.isFinite(nextMs);
  if (prevValid && !nextValid) return prev;
  if (!prevValid && nextValid) return next;
  if (!prevValid && !nextValid) return next;
  return nextMs >= prevMs ? next : prev;
}

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
