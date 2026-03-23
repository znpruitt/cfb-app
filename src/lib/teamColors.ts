import type { TeamCatalogItem } from './teamIdentity';

export type TeamColorSource = 'primary' | 'alt' | 'fallback';

const SCOREBOARD_MIN_LUMINANCE = 0.03;
const SCOREBOARD_MAX_LUMINANCE = 0.9;
const SCOREBOARD_DARK_SURFACE = '#0A0A0A';
const MIN_DARK_THEME_CONTRAST = 3;

export type ScoreboardTeamColorTreatment = {
  source: TeamColorSource;
  baseColor: string;
  rowAccentColor: string;
  winnerAccentColor: string;
  winnerScoreColor: string;
};

const FALLBACK_BASE = '#059669';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const raw = trimmed.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw)) return null;
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : raw;
  return `#${expanded.toUpperCase()}`;
}

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

function hexToRgb(hex: string): Rgb {
  const normalized = hex.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((value) =>
      Math.round(clamp(value, 0, 255))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase()}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));

  let hue = 0;
  if (max === rNorm) hue = ((gNorm - bNorm) / delta) % 6;
  else if (max === gNorm) hue = (bNorm - rNorm) / delta + 2;
  else hue = (rNorm - gNorm) / delta + 4;

  return {
    h: (hue * 60 + 360) % 360,
    s: saturation,
    l: lightness,
  };
}

function hueToChannel(p: number, q: number, t: number): number {
  let normalized = t;
  if (normalized < 0) normalized += 1;
  if (normalized > 1) normalized -= 1;
  if (normalized < 1 / 6) return p + (q - p) * 6 * normalized;
  if (normalized < 1 / 2) return q;
  if (normalized < 2 / 3) return p + (q - p) * (2 / 3 - normalized) * 6;
  return p;
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;

  return {
    r: Math.round(hueToChannel(p, q, hNorm + 1 / 3) * 255),
    g: Math.round(hueToChannel(p, q, hNorm) * 255),
    b: Math.round(hueToChannel(p, q, hNorm - 1 / 3) * 255),
  };
}

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * channelToLinear(rgb.r) +
    0.7152 * channelToLinear(rgb.g) +
    0.0722 * channelToLinear(rgb.b)
  );
}

function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexToRgb(hexA));
  const luminanceB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);

  return (lighter + 0.05) / (darker + 0.05);
}

function liftForDarkThemeContrast(hex: string): string | null {
  if (contrastRatio(hex, SCOREBOARD_DARK_SURFACE) >= MIN_DARK_THEME_CONTRAST) {
    return hex;
  }

  const adjusted = rgbToHsl(hexToRgb(hex));
  for (let lightness = adjusted.l + 0.01; lightness <= 0.76; lightness += 0.01) {
    const candidate = rgbToHex(hslToRgb({ ...adjusted, l: clamp(lightness, adjusted.l, 0.76) }));
    if (contrastRatio(candidate, SCOREBOARD_DARK_SURFACE) >= MIN_DARK_THEME_CONTRAST) {
      return candidate;
    }
  }

  return null;
}

function isUnsafeRawColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb);
  const luminance = relativeLuminance(rgb);

  if (luminance < SCOREBOARD_MIN_LUMINANCE || luminance > SCOREBOARD_MAX_LUMINANCE) return true;
  if (hsl.l < 0.16 || hsl.l > 0.84) return true;
  if (hsl.s < 0.08 && (hsl.l < 0.24 || hsl.l > 0.78)) return true;

  const isYellowGold = hsl.h >= 42 && hsl.h <= 72 && hsl.l > 0.42;
  if (isYellowGold) return true;

  return false;
}

function isReasonableScoreboardAccent(hex: string): boolean {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb);
  const luminance = relativeLuminance(rgb);

  if (luminance < SCOREBOARD_MIN_LUMINANCE || luminance > SCOREBOARD_MAX_LUMINANCE) return false;
  if (hsl.l < 0.22 || hsl.l > 0.76) return false;
  if (hsl.s < 0.12 && (hsl.l < 0.3 || hsl.l > 0.72)) return false;

  const isYellowGold = hsl.h >= 42 && hsl.h <= 72;
  if (isYellowGold && hsl.l > 0.42) return false;

  return true;
}

function softenForScoreboard(hex: string): string {
  const adjusted = rgbToHsl(hexToRgb(hex));
  const isYellowGold = adjusted.h >= 42 && adjusted.h <= 72;

  adjusted.s = clamp(adjusted.s, 0.32, isYellowGold ? 0.7 : 0.78);
  adjusted.l = clamp(adjusted.l, isYellowGold ? 0.28 : 0.34, 0.68);

  if (isYellowGold) {
    adjusted.l = Math.min(adjusted.l, 0.36);
    adjusted.s = Math.min(Math.max(adjusted.s, 0.42), 0.66);
  }

  return rgbToHex(hslToRgb(adjusted));
}

function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(2)})`;
}

function buildTreatment(hex: string, source: TeamColorSource): ScoreboardTeamColorTreatment {
  const safeBase = softenForScoreboard(hex);

  return {
    source,
    baseColor: safeBase,
    rowAccentColor: withAlpha(safeBase, 0.45),
    winnerAccentColor: withAlpha(safeBase, 0.92),
    winnerScoreColor: safeBase,
  };
}

function resolveTeamColorCandidate(
  hex: string | null,
  source: TeamColorSource
): ScoreboardTeamColorTreatment | null {
  if (!hex) return null;

  if (!isUnsafeRawColor(hex)) {
    return buildTreatment(hex, source);
  }

  const rawRgb = hexToRgb(hex);
  const rawHsl = rgbToHsl(rawRgb);
  const rawLuminance = relativeLuminance(rawRgb);
  const rawIsExtremeNeutral = rawHsl.s < 0.08 && (rawHsl.l < 0.12 || rawHsl.l > 0.88);
  if (rawLuminance < 0.015 || rawLuminance > 0.97 || rawIsExtremeNeutral) {
    return null;
  }

  const lifted = liftForDarkThemeContrast(softenForScoreboard(hex));
  if (lifted && isReasonableScoreboardAccent(lifted)) {
    return {
      source,
      baseColor: lifted,
      rowAccentColor: withAlpha(lifted, 0.45),
      winnerAccentColor: withAlpha(lifted, 0.92),
      winnerScoreColor: lifted,
    };
  }

  return null;
}

export function getSafeScoreboardTeamColor(
  team?: Pick<TeamCatalogItem, 'color' | 'altColor'> | null
): ScoreboardTeamColorTreatment {
  const primary = resolveTeamColorCandidate(normalizeHexColor(team?.color), 'primary');
  if (primary) return primary;

  const alt = resolveTeamColorCandidate(normalizeHexColor(team?.altColor), 'alt');
  if (alt) return alt;

  return buildTreatment(FALLBACK_BASE, 'fallback');
}

export function getSafeScoreboardTeamColorById(
  teamId: string | null | undefined,
  teamsById?: Map<string, TeamCatalogItem>
): ScoreboardTeamColorTreatment {
  if (!teamId || !teamsById) return getSafeScoreboardTeamColor(null);
  return getSafeScoreboardTeamColor(teamsById.get(teamId) ?? null);
}
