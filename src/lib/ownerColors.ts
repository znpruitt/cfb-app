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

/**
 * Handpicked 14-color palette — visually distinct in both light and dark mode.
 * Covers the full spectrum with clear separation; no near-duplicate pairs.
 */
const PALETTE: readonly string[] = [
  '#FF6B6B', // coral red
  '#FF9F43', // orange
  '#FECA57', // yellow
  '#1DD1A1', // teal green
  '#48DBFB', // cyan
  '#54A0FF', // blue
  '#0652DD', // royal blue
  '#5F27CD', // purple
  '#9B59B6', // violet
  '#FF9FF3', // pink
  '#EE5A24', // burnt orange
  '#00D2D3', // aqua
  '#8395A7', // slate
  '#C8D6E5', // light gray
];

const PALETTE_SIZE = PALETTE.length;

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
