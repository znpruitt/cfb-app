import type { AliasMap } from './teamNames';
import {
  isLikelyInvalidTeamLabel,
  normalizeAliasLookup,
  normalizeTeamName,
} from './teamNormalization';

export type TeamCatalogItem = {
  school: string;
  mascot?: string | null;
  level?: string | null;
  subdivision?: string | null;
  conference?: string | null;
  alts?: string[];
};

export type TeamSubdivision = 'FBS' | 'FCS' | 'OTHER' | 'UNKNOWN';

export type TeamIdentity = {
  id: string;
  displayName: string;
  subdivision: TeamSubdivision;
  conference?: string | null;
  isOwnable: boolean;
  owner?: string | null;
  aliases?: string[];
};

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

function inferSubdivisionFromConference(conference?: string | null): TeamSubdivision {
  const text = (conference ?? '').toLowerCase();
  if (!text) return 'OTHER';
  if (
    text.includes('sec') ||
    text.includes('big ten') ||
    text.includes('acc') ||
    text.includes('big 12')
  ) {
    return 'FBS';
  }
  if (
    text.includes('fcs') ||
    text.includes('ivy') ||
    text.includes('patriot') ||
    text.includes('swac')
  ) {
    return 'FCS';
  }
  return 'OTHER';
}

const REGISTRY_CACHE = new Map<string, Map<string, TeamIdentity>>();

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
    const id = normalizeTeamName(displayName);
    if (!id) continue;

    const subdivisionFromLevel = toSubdivision(team.level ?? team.subdivision);
    const subdivision =
      subdivisionFromLevel === 'OTHER' || subdivisionFromLevel === 'UNKNOWN'
        ? inferSubdivisionFromConference(team.conference)
        : subdivisionFromLevel;
    const owner = ownersByTeamId?.get(id) ?? null;
    registry.set(id, {
      id,
      displayName,
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
          displayName,
          subdivision,
          conference: team.conference ?? null,
          isOwnable: subdivision === 'FBS',
          owner,
          aliases: [displayName],
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
    const subdivision = inferSubdivisionFromConference(null);
    registry.set(id, {
      id,
      displayName: name,
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
    teams: teams.map((t) => [t.school, t.level, t.conference, t.alts?.join('|') ?? '']),
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
