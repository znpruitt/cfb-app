/**
 * Shared owner color utility.
 *
 * Every owner gets a single persistent color. This is the sole source
 * of owner color across the entire app — charts, tables, and any future
 * owner references must use these functions.
 *
 * Preferred: buildOwnerColorMap(owners) sorts alphabetically and
 * assigns colors 1:1 from the palette — collision-free for ≤14 owners.
 *
 * Fallback: getOwnerColor(name) uses a hash for one-off lookups where
 * the full owner list isn't available. May produce collisions.
 */

const PALETTE_SIZE = 14;
const SATURATION = 70;
const BASE_LIGHTNESS = 52;
const LIGHTNESS_STEP = 6;
const LIGHTNESS_VARIANTS = 4;

/**
 * Generates the canonical HSL color for a given palette slot index.
 */
function colorAtIndex(index: number, total: number): string {
  const normalizedTotal = Math.max(1, total);
  const normalizedIndex = ((index % normalizedTotal) + normalizedTotal) % normalizedTotal;
  const hue = (normalizedIndex / normalizedTotal) * 360;
  const lightness = BASE_LIGHTNESS + (normalizedIndex % LIGHTNESS_VARIANTS) * LIGHTNESS_STEP;
  return `hsl(${hue.toFixed(2)}, ${SATURATION}%, ${lightness}%)`;
}

/** Pre-computed 14-color palette — evenly distributed HSL hues with lightness variation. */
const PALETTE: readonly string[] = Array.from({ length: PALETTE_SIZE }, (_, i) =>
  colorAtIndex(i, PALETTE_SIZE)
);

/**
 * Builds a Map of owner name → color for a list of owners.
 *
 * Sorts owners alphabetically and assigns palette colors in order.
 * Collision-free for up to 14 owners; wraps for larger sets.
 * This is the preferred API — use wherever the full owner list is known.
 */
export function buildOwnerColorMap(owners: string[]): Map<string, string> {
  const sorted = [...owners].sort((a, b) => a.localeCompare(b));
  const map = new Map<string, string>();
  sorted.forEach((owner, i) => {
    map.set(owner, PALETTE[i % PALETTE_SIZE]);
  });
  return map;
}

/**
 * Returns a deterministic color for a single owner name via hash.
 *
 * Fallback for contexts where the full owner list isn't available.
 * May produce collisions with 14 palette slots — prefer buildOwnerColorMap.
 */
export function getOwnerColor(ownerName: string): string {
  const normalized = ownerName.trim().toLowerCase();
  if (!normalized) return PALETTE[0];
  // djb2 hash — good distribution across small bucket counts.
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  const index = ((hash % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  return PALETTE[index];
}

/** The full 14-color palette, exported for components that need direct access. */
export { PALETTE as OWNER_COLOR_PALETTE };
