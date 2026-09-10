// PRODUCTION CONSUMER — `CFBScheduleApp` memoises scoreboard colours from the
// runtime catalog and threads them through the shared `CompactGameScoreboard`
// consumers across Overview, Matchups and Schedule. Keep normalization here so a
// full-slate render pays once per catalog row rather than once per game row.

import { toTeamIdentityKey, type TeamCatalogItem } from './teamIdentity';

export type TeamColorSource = 'primary' | 'alt' | 'fallback';

// The lightest real underlay constrains visibility; the darkest constrains
// excess brightness. A single surface cannot define both ends of this band.
const SCOREBOARD_FLOOR_SURFACE = '#333336';
const SCOREBOARD_CEILING_SURFACE = '#09090B';
const MIN_SCOREBOARD_CONTRAST = 2.5;
const MAX_SCOREBOARD_CONTRAST = 5.5;
const MIN_SCOREBOARD_INPUT_LIGHTNESS = 0.25;
const MAX_SCOREBOARD_INPUT_LIGHTNESS = 0.85;
const MAX_SCOREBOARD_CHROMA = 0.16;
const RESERVED_AMBER_HUE_MIN = 60;
const RESERVED_AMBER_HUE_MAX = 110;
const RESERVED_AMBER_MAX_CHROMA = 0.08;

// PLATFORM-198 REVIEW PROTOTYPE — remove this mode and its URL seam before merge.
// The 1.5 fill floor is exercised only when the raw alternate supplies at least
// 3:1 on the Overview surface. It is not a settled production treatment.
const OUTLINED_FILL_MIN_CONTRAST = 1.5;
const OUTLINE_REFERENCE_SURFACE = '#09090B';
const MIN_RAW_OUTLINE_CONTRAST = 3;

type TeamColorRoles = {
  subtleAccent: string;
  strongAccent: string;
  borderAccent: string;
};

export type ScoreboardTeamColorTreatment = TeamColorRoles & {
  source: TeamColorSource;
  baseColor: string;
  rowAccentColor: string;
  winnerAccentColor: string;
  winnerScoreColor: string;
};

export type ScoreboardTeamColorPrototypeMode = 'remap-only' | 'alternate-outline';

export type ScoreboardTeamColorBar =
  | string
  | {
      fillColor: string;
      outlineColor: string;
    };

export type ScoreboardTeamColorsById = ReadonlyMap<string, ScoreboardTeamColorBar>;

export const EMPTY_SCOREBOARD_TEAM_COLORS_BY_ID: ScoreboardTeamColorsById = new Map();

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
type LinearRgb = { r: number; g: number; b: number };
type Oklch = { l: number; c: number; h: number };

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

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function channelFromLinear(value: number): number {
  const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const linearR = channelToLinear(r);
  const linearG = channelToLinear(g);
  const linearB = channelToLinear(b);
  const lRoot = Math.cbrt(0.4122214708 * linearR + 0.5363325363 * linearG + 0.0514459929 * linearB);
  const mRoot = Math.cbrt(0.2119034982 * linearR + 0.6806995451 * linearG + 0.1073969566 * linearB);
  const sRoot = Math.cbrt(0.0883024619 * linearR + 0.2817188376 * linearG + 0.6299787005 * linearB);
  const l = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const bAxis = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;

  return {
    l,
    c: Math.hypot(a, bAxis),
    h: (Math.atan2(bAxis, a) * 180) / Math.PI + (bAxis < 0 ? 360 : 0),
  };
}

function oklchToLinearRgb({ l, c, h }: Oklch): LinearRgb {
  const hueRadians = (h * Math.PI) / 180;
  const a = c * Math.cos(hueRadians);
  const bAxis = c * Math.sin(hueRadians);
  const lRoot = l + 0.3963377774 * a + 0.2158037573 * bAxis;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * bAxis;
  const sRoot = l - 0.0894841775 * a - 1.291485548 * bAxis;
  const lLinear = lRoot ** 3;
  const mLinear = mRoot ** 3;
  const sLinear = sRoot ** 3;

  return {
    r: 4.0767416621 * lLinear - 3.3077115913 * mLinear + 0.2309699292 * sLinear,
    g: -1.2684380046 * lLinear + 2.6097574011 * mLinear - 0.3413193965 * sLinear,
    b: -0.0041960863 * lLinear - 0.7034186147 * mLinear + 1.707614701 * sLinear,
  };
}

function isInSrgbGamut({ r, g, b }: LinearRgb): boolean {
  return r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1;
}

function gamutMapOklch(color: Oklch): Rgb {
  let linear = oklchToLinearRgb(color);
  if (!isInSrgbGamut(linear)) {
    let lowChroma = 0;
    let highChroma = color.c;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const candidateChroma = (lowChroma + highChroma) / 2;
      const candidate = oklchToLinearRgb({ ...color, c: candidateChroma });
      if (isInSrgbGamut(candidate)) {
        lowChroma = candidateChroma;
        linear = candidate;
      } else {
        highChroma = candidateChroma;
      }
    }
  }

  return {
    r: channelFromLinear(linear.r),
    g: channelFromLinear(linear.g),
    b: channelFromLinear(linear.b),
  };
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

const SCOREBOARD_CEILING_LUMINANCE =
  MAX_SCOREBOARD_CONTRAST * (relativeLuminance(hexToRgb(SCOREBOARD_CEILING_SURFACE)) + 0.05) - 0.05;

function floorLuminance(minimumContrast: number): number {
  return minimumContrast * (relativeLuminance(hexToRgb(SCOREBOARD_FLOOR_SURFACE)) + 0.05) - 0.05;
}

function isUnusableRawColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb);
  const luminance = relativeLuminance(rgb);
  const isExtremeNeutral = hsl.s < 0.08 && (hsl.l < 0.12 || hsl.l > 0.88);

  return luminance < 0.015 || luminance > 0.97 || isExtremeNeutral;
}

function renderOklch(color: Oklch): string {
  return rgbToHex(gamutMapOklch(color));
}

function findLightnessForLuminance(color: Oklch, target: number, preferLighter: boolean): number {
  let lowerLightness = 0;
  let upperLightness = 1;

  for (let iteration = 0; iteration < 32; iteration += 1) {
    const candidateLightness = (lowerLightness + upperLightness) / 2;
    const candidateHex = renderOklch({ ...color, l: candidateLightness });
    if (relativeLuminance(hexToRgb(candidateHex)) < target) {
      lowerLightness = candidateLightness;
    } else {
      upperLightness = candidateLightness;
    }
  }

  return preferLighter ? upperLightness : lowerLightness;
}

function normalizeForScoreboard(hex: string, minimumContrast = MIN_SCOREBOARD_CONTRAST): string {
  const input = rgbToOklch(hexToRgb(hex));
  const isReservedAmber = input.h >= RESERVED_AMBER_HUE_MIN && input.h <= RESERVED_AMBER_HUE_MAX;
  const normalized: Oklch = {
    ...input,
    // Never add chroma. That invariant is what keeps Nevada's 2% cast neutral.
    c: Math.min(input.c, isReservedAmber ? RESERVED_AMBER_MAX_CHROMA : MAX_SCOREBOARD_CHROMA),
  };
  const lowerLightness = findLightnessForLuminance(
    normalized,
    floorLuminance(minimumContrast),
    true
  );
  const upperLightness = findLightnessForLuminance(normalized, SCOREBOARD_CEILING_LUMINANCE, false);
  const remapPosition = clamp(
    (input.l - MIN_SCOREBOARD_INPUT_LIGHTNESS) /
      (MAX_SCOREBOARD_INPUT_LIGHTNESS - MIN_SCOREBOARD_INPUT_LIGHTNESS),
    0,
    1
  );
  return renderOklch({
    ...normalized,
    l: lowerLightness + remapPosition * (upperLightness - lowerLightness),
  });
}

function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(2)})`;
}

function buildAccentRoles(hex: string): TeamColorRoles {
  return {
    subtleAccent: withAlpha(hex, 0.52),
    strongAccent: withAlpha(hex, 0.92),
    borderAccent: withAlpha(hex, 0.38),
  };
}

function buildTreatment(hex: string, source: TeamColorSource): ScoreboardTeamColorTreatment {
  const safeBase = normalizeForScoreboard(hex);
  const roles = buildAccentRoles(safeBase);

  return {
    ...roles,
    source,
    baseColor: safeBase,
    rowAccentColor: roles.subtleAccent,
    winnerAccentColor: roles.strongAccent,
    winnerScoreColor: safeBase,
  };
}

function resolveTeamColorCandidate(
  hex: string | null,
  source: TeamColorSource
): ScoreboardTeamColorTreatment | null {
  if (!hex) return null;
  return isUnusableRawColor(hex) ? null : buildTreatment(hex, source);
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

export function buildScoreboardTeamColorsById(
  teams: readonly TeamCatalogItem[]
): ReadonlyMap<string, string>;
export function buildScoreboardTeamColorsById(
  teams: readonly TeamCatalogItem[],
  prototypeMode: 'remap-only'
): ReadonlyMap<string, string>;
export function buildScoreboardTeamColorsById(
  teams: readonly TeamCatalogItem[],
  prototypeMode: ScoreboardTeamColorPrototypeMode
): ScoreboardTeamColorsById;
export function buildScoreboardTeamColorsById(
  teams: readonly TeamCatalogItem[],
  prototypeMode: ScoreboardTeamColorPrototypeMode = 'remap-only'
): ScoreboardTeamColorsById {
  const colorsById = new Map<string, ScoreboardTeamColorBar>();

  for (const team of teams) {
    // Scoreboard consumers use resolver identity keys, which normalize the
    // canonical display name rather than trusting an optional provider id.
    const teamId = toTeamIdentityKey(team.school);
    if (!teamId) continue;

    const treatment = getSafeScoreboardTeamColor(team);
    if (treatment.source === 'fallback') continue;

    if (prototypeMode === 'alternate-outline') {
      const primary = normalizeHexColor(team.color);
      const alternate = normalizeHexColor(team.altColor);
      if (primary && alternate) {
        const alternateSuppliesEdge =
          contrastRatio(primary, OUTLINE_REFERENCE_SURFACE) < MIN_RAW_OUTLINE_CONTRAST &&
          contrastRatio(alternate, OUTLINE_REFERENCE_SURFACE) >= MIN_RAW_OUTLINE_CONTRAST;
        colorsById.set(teamId, {
          fillColor: alternateSuppliesEdge
            ? normalizeForScoreboard(primary, OUTLINED_FILL_MIN_CONTRAST)
            : treatment.baseColor,
          // Keep the prototype edge honest: it is the provider alternate itself.
          // A black alternate therefore contributes nothing, as in Louisville's case.
          outlineColor: alternate,
        });
        continue;
      }
    }

    colorsById.set(teamId, treatment.baseColor);
  }

  return colorsById;
}
