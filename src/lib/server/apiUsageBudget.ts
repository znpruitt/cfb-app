export type UsageRouteName = 'schedule' | 'scores' | 'odds' | 'conferences';

type UsageCounterMap = Record<string, number>;

export type ApiUsageSnapshot = {
  startedAt: string;
  routeRequests: Record<UsageRouteName, number>;
  routeCache: Record<UsageRouteName, { hit: number; miss: number }>;
};

const usageStore: {
  startedAtMs: number;
  routeRequests: UsageCounterMap;
  routeCacheHits: UsageCounterMap;
  routeCacheMisses: UsageCounterMap;
} = {
  startedAtMs: Date.now(),
  routeRequests: {},
  routeCacheHits: {},
  routeCacheMisses: {},
};

function inc(counter: UsageCounterMap, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
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

  return {
    startedAt: new Date(usageStore.startedAtMs).toISOString(),
    routeRequests,
    routeCache,
  };
}
