export type ApiUsageSnapshot = {
  startedAt: string;
  budgets: {
    cfbd: number;
    'odds-api': number;
  };
  upstreamCalls: {
    cfbd: number;
    'odds-api': number;
  };
  routeRequests: {
    schedule: number;
    scores: number;
    odds: number;
  };
  routeCache: {
    schedule: { hit: number; miss: number };
    scores: { hit: number; miss: number };
    odds: { hit: number; miss: number };
  };
};

export async function fetchApiUsageSnapshot(): Promise<ApiUsageSnapshot> {
  const res = await fetch('/api/usage', { cache: 'no-store' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`usage ${res.status} ${detail}`);
  }

  return (await res.json()) as ApiUsageSnapshot;
}
