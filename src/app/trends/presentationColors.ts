const OWNER_TREND_PALETTE = [
  '#2563eb',
  '#059669',
  '#ea580c',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#ca8a04',
  '#dc2626',
  '#4f46e5',
  '#16a34a',
  '#0f766e',
  '#9333ea',
] as const;

function hashOwnerId(ownerId: string): number {
  let hash = 0;
  for (let index = 0; index < ownerId.length; index += 1) {
    hash = (hash * 31 + ownerId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function getOwnerTrendColor(ownerId: string): string {
  const hash = hashOwnerId(ownerId.trim().toLowerCase());
  return OWNER_TREND_PALETTE[hash % OWNER_TREND_PALETTE.length];
}
