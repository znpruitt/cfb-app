export type UsageRouteName = 'schedule' | 'scores' | 'odds' | 'conferences';
export type UpstreamProviderName = 'cfbd' | 'odds-api';

type UsageCounterMap = Record<string, number>;

export type ApiUsageSnapshot = {
  startedAt: string;
  budgets: Record<UpstreamProviderName, number>;
  upstreamCalls: Record<UpstreamProviderName, number>;
  routeRequests: Record<UsageRouteName, number>;
  routeCache: Record<UsageRouteName, { hit: number; miss: number }>;
};

const MONTHLY_BUDGETS: Record<UpstreamProviderName, number> = {
  cfbd: 1000,
  'odds-api': 500,
};

const usageStore: {
  startedAtMs: number;
  upstreamCalls: UsageCounterMap;
  routeRequests: UsageCounterMap;
  routeCacheHits: UsageCounterMap;
  routeCacheMisses: UsageCounterMap;
} = {
  startedAtMs: Date.now(),
  upstreamCalls: {},
  routeRequests: {},
  routeCacheHits: {},
  routeCacheMisses: {},
};

function inc(counter: UsageCounterMap, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

export function recordUpstreamCall(provider: UpstreamProviderName): void {
  inc(usageStore.upstreamCalls, provider);
}

export function recordRouteRequest(route: UsageRouteName): void {
  inc(usageStore.routeRequests, route);
}

export function recordRouteCacheHit(route: UsageRouteName): void {
  inc(usageStore.routeCacheHits, route);
}

export function recordRouteCacheMiss(route: UsageRouteName): void {
  inc(usageStore.routeCacheMisses, route);
}

function readCounter(counter: UsageCounterMap, key: string): number {
  return counter[key] ?? 0;
}

export function getApiUsageSnapshot(): ApiUsageSnapshot {
  const routes: UsageRouteName[] = ['schedule', 'scores', 'odds', 'conferences'];
  const providers: UpstreamProviderName[] = ['cfbd', 'odds-api'];

  const routeRequests = Object.fromEntries(
    routes.map((route) => [route, readCounter(usageStore.routeRequests, route)])
  ) as Record<UsageRouteName, number>;

  const routeCache = Object.fromEntries(
    routes.map((route) => [
      route,
      {
        hit: readCounter(usageStore.routeCacheHits, route),
        miss: readCounter(usageStore.routeCacheMisses, route),
      },
    ])
  ) as Record<UsageRouteName, { hit: number; miss: number }>;

  const upstreamCalls = Object.fromEntries(
    providers.map((provider) => [provider, readCounter(usageStore.upstreamCalls, provider)])
  ) as Record<UpstreamProviderName, number>;

  return {
    startedAt: new Date(usageStore.startedAtMs).toISOString(),
    budgets: MONTHLY_BUDGETS,
    upstreamCalls,
    routeRequests,
    routeCache,
  };
}
