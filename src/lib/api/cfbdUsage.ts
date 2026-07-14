import { cfbdCanonicalLimitForTier } from './providerQuota.ts';

type CfbdInfoResponse = {
  patronLevel?: unknown;
  remainingCalls?: unknown;
};

export type CfbdUsage = {
  patronLevel: number;
  used: number;
  remaining: number;
  limit: number;
};

export function resolveCfbdUsage(data: CfbdInfoResponse): CfbdUsage {
  const patronLevel = Number(data.patronLevel ?? 0);
  const remaining = Number(data.remainingCalls ?? 0);
  // The canonical tier→limit map is the single source of truth (unknown tiers
  // fall back to Tier 0). Tier 1 is 5,000 monthly calls.
  const limit = cfbdCanonicalLimitForTier(patronLevel);
  const used = Math.max(0, limit - remaining);

  return {
    patronLevel,
    used,
    remaining,
    limit,
  };
}

export async function fetchCfbdUsage(): Promise<CfbdUsage> {
  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    throw new Error('CFBD_API_KEY missing');
  }

  const res = await fetch('https://api.collegefootballdata.com/info', {
    headers: {
      Authorization: `Bearer ${cfbdApiKey}`,
      Accept: 'application/json',
    },
    next: { revalidate: 600 },
  });

  if (!res.ok) {
    throw new Error(`CFBD usage fetch failed: ${res.status}`);
  }

  const data = (await res.json()) as CfbdInfoResponse;
  return resolveCfbdUsage(data);
}
