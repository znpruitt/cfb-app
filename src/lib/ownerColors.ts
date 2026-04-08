/**
 * Shared owner color utility.
 *
 * Every owner gets a single persistent color derived from their name.
 * This is the sole source of owner color across the entire app — charts,
 * tables, and any future owner references must call getOwnerColor().
 *
 * Colors are fixed by name, not by standings position or render order.
 */

const SATURATION = 70;
const BASE_LIGHTNESS = 52;
const LIGHTNESS_STEP = 6;
const LIGHTNESS_VARIANTS = 4;
const PALETTE_SIZE = 14;

/**
 * Pre-computed 14-color palette using the same HSL distribution as the
 * Standings page — evenly spaced hues with lightness variation.
 */
const PALETTE: readonly string[] = Array.from({ length: PALETTE_SIZE }, (_, i) => {
  const hue = (i / PALETTE_SIZE) * 360;
  const lightness = BASE_LIGHTNESS + (i % LIGHTNESS_VARIANTS) * LIGHTNESS_STEP;
  return `hsl(${hue.toFixed(1)}, ${SATURATION}%, ${lightness}%)`;
});

/**
 * Simple string hash — deterministic, reasonably distributed.
 */
function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Returns a deterministic color for the given owner name.
 *
 * Maps the owner name to one of 14 visually distinct HSL colors.
 * The same name always returns the same color regardless of context.
 */
export function getOwnerColor(ownerName: string): string {
  const normalized = ownerName.trim().toLowerCase();
  if (!normalized) return PALETTE[0];
  const index = hashName(normalized) % PALETTE_SIZE;
  return PALETTE[index];
}

/**
 * Builds a Map of owner name → color for a list of owners.
 */
export function buildOwnerColorMap(owners: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const owner of owners) {
    map.set(owner, getOwnerColor(owner));
  }
  return map;
}

/** The full 14-color palette, exported for components that need direct access. */
export { PALETTE as OWNER_COLOR_PALETTE };
