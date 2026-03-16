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

export type OddsUsageContext = {
  sportKey?: string;
  markets?: string[];
  regions?: string[];
  endpointType?: string;
  cacheStatus?: 'hit' | 'miss' | 'unknown';
};

export type OddsQuotaGuardState = {
  warning: boolean;
  disableAutoRefresh: boolean;
  manualWarningOnly: boolean;
};

const ODDS_USAGE_LIMIT = 500;

function parseHeaderNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOddsUsageHeaders(headers: Headers): {
  used: number;
  remaining: number;
  lastCost: number;
} | null {
  const used = parseHeaderNumber(headers.get('x-requests-used'));
  const remaining = parseHeaderNumber(headers.get('x-requests-remaining'));
  const lastCost = parseHeaderNumber(headers.get('x-requests-last'));

  if (used === null || remaining === null || lastCost === null) {
    return null;
  }

  return { used, remaining, lastCost };
}

export function buildOddsUsageSnapshot(
  headers: Headers,
  context: OddsUsageContext = {}
): OddsUsageSnapshot | null {
  const parsed = parseOddsUsageHeaders(headers);
  if (!parsed) return null;

  return {
    ...parsed,
    limit: ODDS_USAGE_LIMIT,
    capturedAt: new Date().toISOString(),
    source: 'odds-response-headers',
    sportKey: context.sportKey,
    markets: context.markets,
    regions: context.regions,
    endpointType: context.endpointType,
    cacheStatus: context.cacheStatus,
  };
}

export function getOddsQuotaGuardState(remaining: number | null | undefined): OddsQuotaGuardState {
  const r = typeof remaining === 'number' && Number.isFinite(remaining) ? remaining : null;

  return {
    warning: r !== null && r <= 25,
    disableAutoRefresh: r !== null && r <= 10,
    manualWarningOnly: r !== null && r <= 5,
  };
}
