import type { AliasMap } from './teamNames.ts';
import {
  isLikelyInvalidTeamLabel,
  normalizeAliasLookup,
  normalizeTeamName,
} from './teamNormalization.ts';
import {
  inferSubdivisionFromConference as inferConferenceSubdivision,
  type ConferenceSubdivision,
} from './conferenceSubdivision.ts';

export type TeamCatalogItem = {
  id?: string | null;
  providerId?: number | null;
  school: string;
  displayName?: string | null;
  shortDisplayName?: string | null;
  abbreviation?: string | null;
  mascot?: string | null;
  level?: string | null;
  subdivision?: string | null;
  conference?: string | null;
  classification?: string | null;
  color?: string | null;
  altColor?: string | null;
  logos?: string[];
  alts?: string[];
};

export type TeamSubdivision = ConferenceSubdivision;

export type TeamIdentity = {
  id: string;
  displayName: string;
  shortDisplayName: string;
  scoreboardName: string;
  subdivision: TeamSubdivision;
  conference?: string | null;
  isOwnable: boolean;
  owner?: string | null;
  aliases?: string[];
};

export type TeamDisplayContext = 'default' | 'short' | 'scoreboard';

export type TeamDisplayInfo = Pick<
  TeamIdentity,
  'displayName' | 'shortDisplayName' | 'scoreboardName'
>;

export type ResolutionSource = 'invalid_label' | 'canonical' | 'alias' | 'unresolved';
export type ResolutionStatus = 'resolved' | 'unresolved';

export type TeamResolution = {
  rawInput: string;
  normalizedInput: string;
  canonicalName: string | null;
  identityKey: string | null;
  resolutionSource: ResolutionSource;
  status: ResolutionStatus;
  notes?: string;
  candidates?: string[];
  subdivision?: TeamSubdivision;
  isOwnable?: boolean;
};

export type TeamIdentityResolver = {
  resolveName: (raw: string) => TeamResolution;
  getTeamIdentity: (raw: string) => TeamIdentity | null;
  buildPairKey: (a: string, b: string) => string;
  buildGameKey: (params: { week: number; home: string; away: string; neutral: boolean }) => string;
  variantsForName: (raw: string) => string[];
  isFbsName: (raw: string) => boolean;
  isLikelyInvalidTeamLabel: (raw: string) => boolean;
  getRegistry: () => Map<string, TeamIdentity>;
};

function toSubdivision(level?: string | null): TeamSubdivision {
  const raw = (level ?? '').trim().toUpperCase();
  if (!raw) return 'UNKNOWN';
  if (raw.includes('FBS')) return 'FBS';
  if (raw.includes('FCS')) return 'FCS';
  return 'OTHER';
}

const REGISTRY_CACHE = new Map<string, Map<string, TeamIdentity>>();

const TEAM_DISPLAY_OVERRIDES: Record<string, Partial<TeamDisplayInfo>> = {
  mississippi: {
    displayName: 'Mississippi',
    shortDisplayName: 'Ole Miss',
    scoreboardName: 'OLE MISS',
  },
  'mississippi-state': {
    scoreboardName: 'MSST',
  },
  miami: {
    scoreboardName: 'MIAMI',
  },
  miamioh: {
    shortDisplayName: 'Miami (OH)',
    scoreboardName: 'M-OH',
  },
  louisiana: {
    shortDisplayName: 'Louisiana',
    scoreboardName: 'LOU',
  },
};

function pickDisplayLabel(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function buildTeamDisplayInfo(team: TeamCatalogItem, fallbackName: string): TeamDisplayInfo {
  const canonicalSchoolName = pickDisplayLabel(team.school, fallbackName) ?? fallbackName;
  const override = TEAM_DISPLAY_OVERRIDES[normalizeTeamName(canonicalSchoolName)] ?? {};
  const displayName =
    pickDisplayLabel(override.displayName, canonicalSchoolName) ?? canonicalSchoolName;
  const shortDisplayName =
    pickDisplayLabel(
      override.shortDisplayName,
      team.shortDisplayName,
      team.abbreviation,
      displayName
    ) ?? displayName;
  const scoreboardName =
    pickDisplayLabel(
      override.scoreboardName,
      team.shortDisplayName,
      team.abbreviation,
      displayName
    ) ?? displayName;

  return {
    displayName,
    shortDisplayName,
    scoreboardName,
  };
}

export function getTeamDisplayLabel(
  team: TeamDisplayInfo | null | undefined,
  context: TeamDisplayContext = 'default'
): string {
  if (!team) return '';
  if (context === 'scoreboard')
    return team.scoreboardName || team.shortDisplayName || team.displayName;
  if (context === 'short') return team.shortDisplayName || team.displayName;
  return team.displayName;
}

function buildCanonicalRegistry(params: {
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
  observedNames?: string[];
  ownersByTeamId?: Map<string, string>;
}): Map<string, TeamIdentity> {
  const registry = new Map<string, TeamIdentity>();
  const { teams, aliasMap, observedNames = [], ownersByTeamId } = params;

  for (const team of teams) {
    const displayName = team.school?.trim();
    if (!displayName) continue;
    const id = team.id?.trim() || normalizeTeamName(displayName);
    if (!id) continue;
    const teamDisplay = buildTeamDisplayInfo(team, displayName);

    const subdivisionFromLevel = toSubdivision(team.level ?? team.subdivision);
    const subdivision =
      subdivisionFromLevel === 'OTHER' || subdivisionFromLevel === 'UNKNOWN'
        ? inferConferenceSubdivision(team.conference)
        : subdivisionFromLevel;
    const owner = ownersByTeamId?.get(id) ?? null;
    registry.set(id, {
      id,
      ...teamDisplay,
      subdivision,
      conference: team.conference ?? null,
      isOwnable: subdivision === 'FBS',
      owner,
      aliases: Array.isArray(team.alts) ? [...team.alts] : [],
    });

    for (const alias of team.alts ?? []) {
      const aliasId = normalizeTeamName(alias);
      if (!aliasId) continue;
      if (!registry.has(aliasId)) {
        registry.set(aliasId, {
          id: aliasId,
          ...teamDisplay,
          subdivision,
          conference: team.conference ?? null,
          isOwnable: subdivision === 'FBS',
          owner,
          aliases: [teamDisplay.displayName],
        });
      }
    }
  }

  for (const [alias, target] of Object.entries(aliasMap)) {
    const aliasId = normalizeTeamName(alias);
    const canonicalId = normalizeTeamName(target);
    if (!canonicalId) continue;

    const canonical =
      registry.get(canonicalId) ??
      ({
        id: canonicalId,
        displayName: target,
        shortDisplayName: target,
        scoreboardName: target,
        subdivision: 'OTHER' as TeamSubdivision,
        conference: null,
        isOwnable: false,
        owner: ownersByTeamId?.get(canonicalId) ?? null,
        aliases: [],
      } satisfies TeamIdentity);

    if (!registry.has(canonicalId)) registry.set(canonicalId, canonical);
    if (aliasId && !registry.has(aliasId)) {
      registry.set(aliasId, {
        ...canonical,
        id: aliasId,
        aliases: [...(canonical.aliases ?? []), alias],
      });
    }
  }

  for (const name of observedNames) {
    const id = normalizeTeamName(name);
    if (!id || registry.has(id)) continue;
    const subdivision = inferConferenceSubdivision(null);
    registry.set(id, {
      id,
      displayName: name,
      shortDisplayName: name,
      scoreboardName: name,
      subdivision,
      conference: null,
      isOwnable: false,
      owner: ownersByTeamId?.get(id) ?? null,
      aliases: [],
    });
  }

  return registry;
}

export function createTeamIdentityResolver(params: {
  aliasMap: AliasMap;
  teams: TeamCatalogItem[];
  observedNames?: string[];
  ownersByTeamId?: Map<string, string>;
}): TeamIdentityResolver {
  const { aliasMap, teams, observedNames, ownersByTeamId } = params;
  const cacheKey = JSON.stringify({
    teams: teams.map((t) => [
      t.school,
      t.displayName,
      t.shortDisplayName,
      t.abbreviation,
      t.level,
      t.subdivision,
      t.conference,
      t.alts?.join('|') ?? '',
    ]),
    aliases: Object.entries(aliasMap).sort((a, b) => a[0].localeCompare(b[0])),
    observedNames: [...(observedNames ?? [])].sort((a, b) => a.localeCompare(b)),
  });

  const registry =
    REGISTRY_CACHE.get(cacheKey) ??
    buildCanonicalRegistry({ teams, aliasMap, observedNames, ownersByTeamId });
  REGISTRY_CACHE.set(cacheKey, registry);

  const resolveName = (rawInput: string): TeamResolution => {
    const raw = rawInput.trim();
    if (isLikelyInvalidTeamLabel(raw)) {
      return {
        rawInput,
        normalizedInput: '',
        canonicalName: null,
        identityKey: null,
        resolutionSource: 'invalid_label',
        status: 'unresolved',
        notes: 'invalid-schedule-row',
      };
    }

    const normalizedInput = normalizeTeamName(raw);
    const direct = registry.get(normalizedInput);
    if (direct) {
      return {
        rawInput,
        normalizedInput,
        canonicalName: direct.displayName,
        identityKey: normalizeTeamName(direct.displayName),
        resolutionSource: 'canonical',
        status: 'resolved',
        subdivision: direct.subdivision,
        isOwnable: direct.isOwnable,
      };
    }

    const aliasTarget = aliasMap[normalizeAliasLookup(raw)];
    if (aliasTarget) {
      const aliasCanonical = registry.get(normalizeTeamName(aliasTarget));
      if (aliasCanonical) {
        return {
          rawInput,
          normalizedInput,
          canonicalName: aliasCanonical.displayName,
          identityKey: normalizeTeamName(aliasCanonical.displayName),
          resolutionSource: 'alias',
          status: 'resolved',
          subdivision: aliasCanonical.subdivision,
          isOwnable: aliasCanonical.isOwnable,
        };
      }
    }

    return {
      rawInput,
      normalizedInput,
      canonicalName: null,
      identityKey: null,
      resolutionSource: 'unresolved',
      status: 'unresolved',
      notes: 'identity-unresolved',
    };
  };

  const buildPairKey = (a: string, b: string): string => {
    const left = resolveName(a);
    const right = resolveName(b);
    const l = left.identityKey ?? left.normalizedInput;
    const r = right.identityKey ?? right.normalizedInput;
    return [l, r].sort((x, y) => x.localeCompare(y)).join('__');
  };

  return {
    resolveName,
    getTeamIdentity: (raw) => {
      const resolved = resolveName(raw);
      if (!resolved.identityKey) return null;
      return registry.get(resolved.identityKey) ?? null;
    },
    buildPairKey,
    buildGameKey: ({ week, home, away, neutral }) => {
      const homeKey = resolveName(home).identityKey ?? normalizeTeamName(home);
      const awayKey = resolveName(away).identityKey ?? normalizeTeamName(away);
      return neutral
        ? `${week}-${[homeKey, awayKey].sort((x, y) => x.localeCompare(y)).join('-')}-N`
        : `${week}-${homeKey}-${awayKey}-H`;
    },
    variantsForName: (raw) => {
      const resolved = resolveName(raw);
      const base = resolved.identityKey ?? resolved.normalizedInput;
      return base ? [base] : [];
    },
    isFbsName: (raw) => resolveName(raw).subdivision === 'FBS',
    isLikelyInvalidTeamLabel,
    getRegistry: () => registry,
  };
}
