/**
 * Shared owner color utility.
 *
 * Every owner gets a single persistent color. This is the sole source
 * of owner color across the entire app — charts, tables, and any future
 * owner references must use these functions.
 *
 * Colors are hardcoded per TSC League owner so the same name always
 * maps to the same color regardless of which owners appear in a given
 * component's dataset. Unknown names fall back to a deterministic hash.
 */

/**
 * Hardcoded owner → color map.
 *
 * Colors are the original Standings page HSL palette (14-slot hue-distributed,
 * lightness-varied) assigned in alphabetical order, plus a distinct 15th color
 * for Whited to avoid the palette wrap collision.
 */
const OWNER_COLORS: Record<string, string> = {
  Ballard:   'hsl(0.00, 70%, 52%)',    // red
  BHooper:   'hsl(25.71, 70%, 58%)',   // orange
  Carter:    'hsl(51.43, 70%, 64%)',   // yellow
  Chumley:   'hsl(77.14, 70%, 70%)',   // yellow-green
  Ciprys:    'hsl(102.86, 70%, 52%)',  // green
  Jackson:   'hsl(128.57, 70%, 58%)',  // green
  Jordan:    'hsl(154.29, 70%, 64%)',  // teal
  LHooper:   'hsl(180.00, 70%, 70%)',  // cyan
  Maleski:   'hsl(205.71, 70%, 52%)',  // blue
  NoClaim:   'hsl(231.43, 70%, 58%)',  // indigo
  Pruitt:    'hsl(257.14, 70%, 64%)',  // purple
  Shambaugh: 'hsl(282.86, 70%, 70%)', // violet
  Stevens:   'hsl(308.57, 70%, 52%)',  // magenta
  Surowiec:  'hsl(334.29, 70%, 58%)', // rose
  Whited:    'hsl(345, 70%, 46%)',     // deep crimson (distinct 15th slot)
};

/** Fallback palette for unknown owner names — same 14-slot HSL distribution. */
const FALLBACK_PALETTE: readonly string[] = [
  'hsl(0.00, 70%, 52%)',
  'hsl(25.71, 70%, 58%)',
  'hsl(51.43, 70%, 64%)',
  'hsl(77.14, 70%, 70%)',
  'hsl(102.86, 70%, 52%)',
  'hsl(128.57, 70%, 58%)',
  'hsl(154.29, 70%, 64%)',
  'hsl(180.00, 70%, 70%)',
  'hsl(205.71, 70%, 52%)',
  'hsl(231.43, 70%, 58%)',
  'hsl(257.14, 70%, 64%)',
  'hsl(282.86, 70%, 70%)',
  'hsl(308.57, 70%, 52%)',
  'hsl(334.29, 70%, 58%)',
];

const FALLBACK_SIZE = FALLBACK_PALETTE.length;

/**
 * Returns a deterministic color for a single owner name.
 *
 * Known TSC League owners get their hardcoded color. Unknown names
 * fall back to a djb2 hash into the 14-slot palette.
 */
export function getOwnerColor(ownerName: string): string {
  const trimmed = ownerName.trim();
  if (!trimmed) return FALLBACK_PALETTE[0];

  // Direct lookup — case-sensitive match on canonical owner names
  const direct = OWNER_COLORS[trimmed];
  if (direct) return direct;

  // Hash fallback for unknown names
  const normalized = trimmed.toLowerCase();
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  const index = ((hash % FALLBACK_SIZE) + FALLBACK_SIZE) % FALLBACK_SIZE;
  return FALLBACK_PALETTE[index];
}

/**
 * Builds a Map of owner name → color for a list of owners.
 *
 * Delegates to getOwnerColor() per owner so colors are stable
 * regardless of which owners appear in the list.
 */
export function buildOwnerColorMap(owners: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const owner of owners) {
    map.set(owner, getOwnerColor(owner));
  }
  return map;
}

/** The full 14-color fallback palette, exported for components that need direct access. */
export { FALLBACK_PALETTE as OWNER_COLOR_PALETTE };
