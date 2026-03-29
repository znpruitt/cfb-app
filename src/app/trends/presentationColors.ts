const DEFAULT_OWNER_SATURATION = 70;
const BASE_OWNER_LIGHTNESS = 52;
const OWNER_LIGHTNESS_STEP = 6;
const OWNER_LIGHTNESS_VARIANTS = 4;

export function getOwnerColor(owner: string, index: number, total: number): string {
  const normalizedOwner = owner.trim().toLowerCase();
  if (!normalizedOwner) return `hsl(0, ${DEFAULT_OWNER_SATURATION}%, ${BASE_OWNER_LIGHTNESS}%)`;

  const normalizedTotal = Math.max(1, total);
  const normalizedIndex = ((index % normalizedTotal) + normalizedTotal) % normalizedTotal;
  const hue = (normalizedIndex / normalizedTotal) * 360;
  const lightness =
    BASE_OWNER_LIGHTNESS + (normalizedIndex % OWNER_LIGHTNESS_VARIANTS) * OWNER_LIGHTNESS_STEP;

  return `hsl(${hue.toFixed(2)}, ${DEFAULT_OWNER_SATURATION}%, ${lightness}%)`;
}

export function buildOwnerColorMap(orderedOwners: string[]): Map<string, string> {
  const colorMap = new Map<string, string>();
  const total = Math.max(1, orderedOwners.length);
  orderedOwners.forEach((owner, index) => {
    colorMap.set(owner, getOwnerColor(owner, index, total));
  });
  return colorMap;
}
