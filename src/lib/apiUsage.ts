export type CfbdUsageSnapshot = {
  patronLevel: number;
  used: number;
  remaining: number;
  limit: number;
};

export async function fetchCfbdUsageSnapshot(): Promise<CfbdUsageSnapshot> {
  const res = await fetch('/api/admin/usage', { cache: 'no-store' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`usage ${res.status} ${detail}`);
  }

  return (await res.json()) as CfbdUsageSnapshot;
}
