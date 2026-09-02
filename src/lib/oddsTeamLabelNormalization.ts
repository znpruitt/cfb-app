import oddsTeamLabelAliases from '@/data/odds-team-label-aliases.json';
import { CFBD_ODDS_TEAM_MASCOTS } from '@/data/odds-team-mascots.ts';

import { hasTeamParticipants, type ScheduleAttachmentGame } from './gameAttachment.ts';
import { toTeamIdentityKey, type TeamIdentityResolver } from './teamIdentity.ts';

export type OddsTeamLabelAlias = {
  provider: string;
  schedule: string;
};

export type OddsTeamLabelNormalizer = {
  normalize: (providerLabel: string) => string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the small hand-maintained residual table at its data boundary. A
 * malformed row is ignored rather than reaching `toTeamIdentityKey` and
 * turning an odds read into a runtime error.
 */
export function parseOddsTeamLabelAliases(value: unknown): OddsTeamLabelAlias[] {
  if (!isRecord(value) || !Array.isArray(value.aliases)) return [];

  const parsed: OddsTeamLabelAlias[] = [];
  for (const alias of value.aliases) {
    if (!isRecord(alias)) continue;
    const provider = typeof alias.provider === 'string' ? alias.provider.trim() : '';
    const schedule = typeof alias.schedule === 'string' ? alias.schedule.trim() : '';
    if (!provider || !schedule) continue;
    parsed.push({ provider, schedule });
  }
  return parsed;
}

const aliases = parseOddsTeamLabelAliases(oddsTeamLabelAliases);

function labelVariants(school: string, alternateNames: readonly string[]): string[] {
  const variants = new Set([school, ...alternateNames]);
  for (const label of [...variants]) {
    const withoutLeadingThe = label.replace(/^the\s+/i, '').trim();
    if (withoutLeadingThe) variants.add(withoutLeadingThe);
  }
  return [...variants];
}

/**
 * Build an Odds-provider label preprocessor scoped to the current canonical
 * schedule. The static table is only a normalization aid: its target must
 * already resolve to a participant in `games`, so an alias can never add a
 * team to the identity registry or make an unscheduled team attach.
 *
 * If one provider label points at more than one scheduled identity, the label
 * is deliberately left unchanged. The attachment layer's existing zero/many
 * candidate refusal remains the final authority.
 */
export function createOddsTeamLabelNormalizer(params: {
  games: ScheduleAttachmentGame[];
  resolver: TeamIdentityResolver;
}): OddsTeamLabelNormalizer {
  const { games, resolver } = params;
  const scheduledLabelsByIdentity = new Map<string, Set<string>>();
  const scheduledIdentitiesByAliasKey = new Map<string, Set<string>>();

  for (const game of games) {
    if (!hasTeamParticipants(game)) continue;
    for (const label of [game.canHome, game.canAway, game.csvHome, game.csvAway]) {
      const resolution = resolver.resolveName(label);
      const identityKey = resolution.identityKey;
      if (!identityKey) continue;
      const labels = scheduledLabelsByIdentity.get(identityKey) ?? new Set<string>();
      labels.add(label);
      scheduledLabelsByIdentity.set(identityKey, labels);
      const aliasKeys = new Set([toTeamIdentityKey(label), identityKey]);
      if (resolution.canonicalName) aliasKeys.add(toTeamIdentityKey(resolution.canonicalName));
      for (const aliasKey of aliasKeys) {
        if (!aliasKey) continue;
        const identities = scheduledIdentitiesByAliasKey.get(aliasKey) ?? new Set<string>();
        identities.add(identityKey);
        scheduledIdentitiesByAliasKey.set(aliasKey, identities);
      }
    }
  }

  const targetIdentitiesByProvider = new Map<string, Set<string>>();
  const addProviderTargets = (providerLabel: string, targetIdentities: Iterable<string>): void => {
    const providerKey = toTeamIdentityKey(providerLabel);
    if (!providerKey) return;
    const targets = targetIdentitiesByProvider.get(providerKey) ?? new Set<string>();
    for (const targetIdentity of targetIdentities) targets.add(targetIdentity);
    targetIdentitiesByProvider.set(providerKey, targets);
  };

  for (const [school, mascot, , alternateNames] of CFBD_ODDS_TEAM_MASCOTS) {
    const teamLabels = labelVariants(school, alternateNames);
    const teamAliasKeys = new Set(teamLabels.map(toTeamIdentityKey).filter(Boolean));
    const targetIdentities = new Set<string>();
    for (const aliasKey of teamAliasKeys) {
      for (const identityKey of scheduledIdentitiesByAliasKey.get(aliasKey) ?? []) {
        targetIdentities.add(identityKey);
      }
    }
    if (targetIdentities.size === 0) continue;
    for (const teamLabel of teamLabels) {
      addProviderTargets(`${teamLabel} ${mascot}`, targetIdentities);
    }
  }

  for (const alias of aliases) {
    const targetIdentity = resolver.resolveName(alias.schedule).identityKey;
    if (!targetIdentity || !scheduledLabelsByIdentity.has(targetIdentity)) continue;
    addProviderTargets(alias.provider, [targetIdentity]);
  }

  const replacements = new Map<string, string>();
  for (const [providerKey, targetIdentities] of targetIdentitiesByProvider) {
    if (targetIdentities.size !== 1) continue;
    const [targetIdentity] = targetIdentities;
    const scheduledLabels = scheduledLabelsByIdentity.get(targetIdentity);
    const replacement = scheduledLabels?.values().next().value;
    if (replacement) replacements.set(providerKey, replacement);
  }

  return {
    normalize: (providerLabel) => {
      // Persisted/manual aliases are part of the identity resolver and take
      // precedence over this static provider-label aid. Only preserve an
      // existing resolution when it points at a participant in this schedule;
      // observed provider strings outside the slate must not suppress mascot
      // normalization.
      const existingIdentity = resolver.resolveName(providerLabel).identityKey;
      if (existingIdentity && scheduledLabelsByIdentity.has(existingIdentity)) {
        return providerLabel;
      }
      return replacements.get(toTeamIdentityKey(providerLabel)) ?? providerLabel;
    },
  };
}
