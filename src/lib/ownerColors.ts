/**
 * Shared owner color utility.
 *
 * Every owner gets a single persistent color. This is the sole source
 * of owner color across the entire app — charts, tables, and any future
 * owner references must use these functions.
 *
 * Colors are assigned by sorted index (not by name) so the palette
 * supports any league with up to 16 owners. Beyond 16, colors wrap.
 */

/**
 * 16-color dark mode palette.
 *
 * Generated from 16 evenly-distributed HSL hues (22.5° apart) with
 * high lightness (68–72%) and high saturation (82–85%) for readability
 * on dark backgrounds. Every adjacent pair is exactly 22.5° apart —
 * maximum perceptual separation for 16 slots.
 */
export const PALETTE_DARK: readonly string[] = [
  '#f36868', // 0   — red          (hue   0.0°)
  '#f1a374', // 1   — orange       (hue  22.5°)
  '#f4d67b', // 2   — gold         (hue  45.0°)
  '#e0f06a', // 3   — yellow-green (hue  67.5°)
  '#b3f471', // 4   — lime         (hue  90.0°)
  '#8cf27d', // 5   — green        (hue 112.5°)
  '#68f38b', // 6   — emerald      (hue 135.0°)
  '#74f1c2', // 7   — teal         (hue 157.5°)
  '#7bf4f4', // 8   — cyan         (hue 180.0°)
  '#6abef0', // 9   — sky          (hue 202.5°)
  '#7192f4', // 10  — blue         (hue 225.0°)
  '#8c7df2', // 11  — indigo       (hue 247.5°)
  '#ad68f3', // 12  — purple       (hue 270.0°)
  '#e274f1', // 13  — violet       (hue 292.5°)
  '#f47bd6', // 14  — magenta      (hue 315.0°)
  '#f06a9d', // 15  — rose         (hue 337.5°)
];

/**
 * 16-color light mode palette.
 *
 * Same hue distribution as PALETTE_DARK but with low lightness (35–37%)
 * and high saturation (78–80%) for readable contrast on white backgrounds.
 */
export const PALETTE_LIGHT: readonly string[] = [
  '#a11212', // 0   — red          (hue   0.0°)
  '#a84c15', // 1   — orange       (hue  22.5°)
  '#a17d12', // 2   — gold         (hue  45.0°)
  '#96a815', // 3   — yellow-green (hue  67.5°)
  '#59a112', // 4   — lime         (hue  90.0°)
  '#27a815', // 5   — green        (hue 112.5°)
  '#12a136', // 6   — emerald      (hue 135.0°)
  '#15a871', // 7   — teal         (hue 157.5°)
  '#12a1a1', // 8   — cyan         (hue 180.0°)
  '#1571a8', // 9   — sky          (hue 202.5°)
  '#1236a1', // 10  — blue         (hue 225.0°)
  '#2715a8', // 11  — indigo       (hue 247.5°)
  '#5912a1', // 12  — purple       (hue 270.0°)
  '#9615a8', // 13  — violet       (hue 292.5°)
  '#a1127d', // 14  — magenta      (hue 315.0°)
  '#a8154c', // 15  — rose         (hue 337.5°)
];

const PALETTE_SIZE = 16;

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

// TEMP: palette review — remove after approval
console.log('PALETTE_DARK', PALETTE_DARK);
console.log('PALETTE_LIGHT', PALETTE_LIGHT);
