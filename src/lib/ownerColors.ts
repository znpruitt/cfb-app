/**
 * Shared owner color utility.
 *
 * Every owner gets a single persistent color. This is the sole source
 * of owner color across the entire app — charts, tables, and any future
 * owner references must use these functions.
 *
 * Colors are assigned by sorted index (not by name) so the palette
 * supports any league with up to 20 owners. Beyond 20, colors wrap.
 */

/**
 * 20-color dark mode palette.
 *
 * Tableau-derived categorical palette extended to 20 colors.
 * Optimized for perceptual separation on dark backgrounds.
 */
export const PALETTE_DARK: readonly string[] = [
  '#4E79A7', // steel blue
  '#F28E2B', // orange
  '#E15759', // red
  '#76B7B2', // teal
  '#59A14F', // green
  '#EDC948', // yellow
  '#B07AA1', // purple
  '#FF9DA7', // pink
  '#9C755F', // brown
  '#BAB0AC', // gray
  '#D37295', // rose
  '#8CD17D', // light green
  '#B6992D', // dark yellow
  '#499894', // dark teal
  '#86BCB6', // light teal
  '#79706E', // dark gray
  '#D4A6C8', // lavender
  '#D7B5A6', // tan
  '#A0CBE8', // light blue
  '#FFBE7D', // light orange
];

/**
 * 20-color light mode palette.
 *
 * Same hues as PALETTE_DARK with reduced lightness (~25% darker)
 * for readable contrast on white backgrounds.
 */
export const PALETTE_LIGHT: readonly string[] = [
  '#2E5F8A', // steel blue
  '#C46D0A', // orange
  '#B83336', // red
  '#4A8C87', // teal
  '#357A2C', // green
  '#C9A000', // yellow
  '#8A5580', // purple
  '#E06070', // pink
  '#6E4F3A', // brown
  '#7A7573', // gray
  '#A84E72', // rose
  '#5EA852', // light green
  '#8A7010', // dark yellow
  '#27736F', // dark teal
  '#5A9993', // light teal
  '#534F4E', // dark gray
  '#A87BAA', // lavender
  '#A8836F', // tan
  '#5AAAD4', // light blue
  '#D4894A', // light orange
];

const PALETTE_SIZE = 20;

/**
 * Detect whether the user prefers dark mode via media query.
 * Returns true for dark mode, false for light mode.
 * Server-side (SSR) defaults to dark to match prior behavior.
 */
export function prefersDarkMode(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * djb2 hash — deterministic fallback for owners not in the sorted list.
 */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Returns a deterministic color for a single owner name.
 *
 * Sorts allOwners alphabetically (case-insensitive) and assigns
 * palette slots by index. If ownerName is not in allOwners, falls
 * back to a djb2 hash of the name for a stable index.
 */
export function getOwnerColor(ownerName: string, allOwners: string[], isDark: boolean): string {
  const palette = isDark ? PALETTE_DARK : PALETTE_LIGHT;
  const trimmed = ownerName.trim();
  if (!trimmed) return palette[0];

  const sorted = [...allOwners].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  const idx = sorted.findIndex(
    (o) => o.toLowerCase() === trimmed.toLowerCase()
  );

  if (idx >= 0) {
    return palette[idx % PALETTE_SIZE];
  }

  // Deterministic hash fallback for unknown names
  const hash = djb2(trimmed.toLowerCase());
  const fallbackIdx = ((hash % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  return palette[fallbackIdx];
}

/**
 * Builds a Record of owner name → color for a list of owners.
 *
 * Sorts owners alphabetically (case-insensitive) and assigns
 * palette slots by index.
 */
export function buildOwnerColorMap(owners: string[], isDark: boolean): Record<string, string> {
  const palette = isDark ? PALETTE_DARK : PALETTE_LIGHT;
  const sorted = [...owners].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
  const map: Record<string, string> = {};
  for (let i = 0; i < sorted.length; i++) {
    map[sorted[i]] = palette[i % PALETTE_SIZE];
  }
  return map;
}

