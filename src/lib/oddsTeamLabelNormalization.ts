import oddsTeamLabelAliases from '@/data/odds-team-label-aliases.json';
import { CFBD_ODDS_TEAM_MASCOTS } from '@/data/odds-team-mascots.ts';

import { hasTeamParticipants, type ScheduleAttachmentGame } from './gameAttachment.ts';
import { toTeamIdentityKey, type TeamIdentityResolver } from './teamIdentity.ts';

type OddsTeamLabelAlias = {
  provider: string;
  schedule: string;
};

export type OddsTeamLabelNormalizer = {
  normalize: (providerLabel: string) => string;
};

const aliases = oddsTeamLabelAliases.aliases as OddsTeamLabelAlias[];

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
    normalize: (providerLabel) =>
      replacements.get(toTeamIdentityKey(providerLabel)) ?? providerLabel,
  };
}
