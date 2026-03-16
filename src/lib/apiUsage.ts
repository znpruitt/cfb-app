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
  const res = await fetch('/api/admin/usage', { cache: 'no-store' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`usage ${res.status} ${detail}`);
  }

  return (await res.json()) as CfbdUsageSnapshot;
}

export async function fetchLatestOddsUsageSnapshot(): Promise<OddsUsageSnapshot | null> {
  const res = await fetch('/api/admin/odds-usage', { cache: 'no-store' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`odds usage ${res.status} ${detail}`);
  }

  const payload = (await res.json()) as { usage?: OddsUsageSnapshot | null };
  return payload.usage ?? null;
}
