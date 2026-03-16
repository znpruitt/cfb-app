const CFBD_LIMIT_BY_TIER: Record<number, number> = {
  0: 1000,
  1: 3000,
  2: 30000,
  3: 75000,
  4: 125000,
  5: 200000,
  6: 500000,
};

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
  // Unknown tiers intentionally fall back to Tier 0 and should be reviewed when CFBD adds new tiers.
  const limit = CFBD_LIMIT_BY_TIER[patronLevel] ?? CFBD_LIMIT_BY_TIER[0];
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
