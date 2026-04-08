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
 * Hardcoded owner → color map (dark mode / dark backgrounds).
 *
 * Colors are the original Standings page HSL palette (14-slot hue-distributed,
 * lightness-varied) assigned in alphabetical order, plus a distinct 15th color
 * for Whited to avoid the palette wrap collision.
 */
const OWNER_COLORS_DARK: Record<string, string> = {
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

/**
 * Light mode owner → color map.
 *
 * Same hues as dark mode to preserve owner identity, but with reduced
 * lightness to ensure sufficient contrast on white backgrounds.
 * Owners whose dark-mode lightness exceeds 60% get the largest reduction.
 */
const OWNER_COLORS_LIGHT: Record<string, string> = {
  Ballard:   'hsl(0.00, 75%, 40%)',    // red — 52→40
  BHooper:   'hsl(25.71, 75%, 42%)',   // orange — 58→42
  Carter:    'hsl(51.43, 80%, 36%)',   // yellow — 64→36 (high lightness, big reduction)
  Chumley:   'hsl(77.14, 70%, 34%)',   // yellow-green — 70→34 (highest lightness, biggest reduction)
  Ciprys:    'hsl(102.86, 70%, 36%)',  // green — 52→36
  Jackson:   'hsl(128.57, 70%, 36%)',  // green — 58→36
  Jordan:    'hsl(154.29, 70%, 34%)',  // teal — 64→34
  LHooper:   'hsl(180.00, 70%, 32%)',  // cyan — 70→32
  Maleski:   'hsl(205.71, 75%, 40%)',  // blue — 52→40
  NoClaim:   'hsl(231.43, 70%, 44%)',  // indigo — 58→44
  Pruitt:    'hsl(257.14, 65%, 44%)',  // purple — 64→44
  Shambaugh: 'hsl(282.86, 60%, 42%)', // violet — 70→42
  Stevens:   'hsl(308.57, 70%, 40%)',  // magenta — 52→40
  Surowiec:  'hsl(334.29, 70%, 42%)', // rose — 58→42
  Whited:    'hsl(345, 75%, 38%)',     // deep crimson — 46→38
};

/** Fallback palette for unknown owner names — same 14-slot HSL distribution. */
const FALLBACK_PALETTE_DARK: readonly string[] = [
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

const FALLBACK_PALETTE_LIGHT: readonly string[] = [
  'hsl(0.00, 75%, 40%)',
  'hsl(25.71, 75%, 42%)',
  'hsl(51.43, 80%, 36%)',
  'hsl(77.14, 70%, 34%)',
  'hsl(102.86, 70%, 36%)',
  'hsl(128.57, 70%, 36%)',
  'hsl(154.29, 70%, 34%)',
  'hsl(180.00, 70%, 32%)',
  'hsl(205.71, 75%, 40%)',
  'hsl(231.43, 70%, 44%)',
  'hsl(257.14, 65%, 44%)',
  'hsl(282.86, 60%, 42%)',
  'hsl(308.57, 70%, 40%)',
  'hsl(334.29, 70%, 42%)',
];

/** Backward-compatible alias. */
const FALLBACK_PALETTE = FALLBACK_PALETTE_DARK;

const FALLBACK_SIZE = FALLBACK_PALETTE.length;

/**
 * Detect whether the user prefers dark mode via media query.
 * Returns true for dark mode, false for light mode.
 * Server-side (SSR) defaults to dark to match prior behavior.
 */
function prefersDarkMode(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Returns a deterministic color for a single owner name.
 *
 * Known TSC League owners get their hardcoded color. Unknown names
 * fall back to a djb2 hash into the 14-slot palette.
 *
 * When called without a mode parameter, auto-detects via prefers-color-scheme.
 */
export function getOwnerColor(ownerName: string, mode?: 'light' | 'dark'): string {
  const isDark = mode ? mode === 'dark' : prefersDarkMode();
  const colorMap = isDark ? OWNER_COLORS_DARK : OWNER_COLORS_LIGHT;
  const fallback = isDark ? FALLBACK_PALETTE_DARK : FALLBACK_PALETTE_LIGHT;

  const trimmed = ownerName.trim();
  if (!trimmed) return fallback[0];

  // Direct lookup — case-sensitive match on canonical owner names
  const direct = colorMap[trimmed];
  if (direct) return direct;

  // Hash fallback for unknown names
  const normalized = trimmed.toLowerCase();
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  const index = ((hash % FALLBACK_SIZE) + FALLBACK_SIZE) % FALLBACK_SIZE;
  return fallback[index];
}

/**
 * Builds a Map of owner name → color for a list of owners.
 *
 * Delegates to getOwnerColor() per owner so colors are stable
 * regardless of which owners appear in the list.
 */
export function buildOwnerColorMap(owners: string[], mode?: 'light' | 'dark'): Map<string, string> {
  const map = new Map<string, string>();
  for (const owner of owners) {
    map.set(owner, getOwnerColor(owner, mode));
  }
  return map;
}

/** The full 14-color fallback palette, exported for components that need direct access. */
export { FALLBACK_PALETTE as OWNER_COLOR_PALETTE };
