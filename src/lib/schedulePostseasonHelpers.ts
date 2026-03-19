import { createTeamIdentityResolver } from './teamIdentity.ts';
import { isLikelyInvalidTeamLabel } from './teamNormalization.ts';
import type { AppGame, ParticipantSlot, ScheduleWireItem } from './schedule.ts';

function participantCsvValue(participant: ParticipantSlot): string {
  if (participant.kind === 'team') return participant.rawName;
  return participant.displayName;
}

function participantCanonicalValue(participant: ParticipantSlot): string {
  return participant.kind === 'team' ? participant.canonicalName : '';
}

function applyManualOverride(base: AppGame, override: Partial<AppGame>): AppGame {
  return {
    ...base,
    ...override,
    participants: {
      home: override.participants?.home ?? base.participants.home,
      away: override.participants?.away ?? base.participants.away,
    },
    sources: { ...base.sources, ...(override.sources ?? {}) },
  };
}

export function toPlaceholderDisplay(conference?: string | null): string {
  return conference ? `${conference} Team TBD` : 'Team TBD';
}

export function buildConferenceChampionshipEventKey(item: ScheduleWireItem): string {
  const normalizedEventKey = item.eventKey?.trim();
  if (normalizedEventKey) return normalizedEventKey;

  const normalizedConference = (item.conferenceChampionshipConference ?? '').trim().toLowerCase();
  if (normalizedConference) {
    const confSlug = normalizedConference.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (confSlug) return `${confSlug}-championship`;
  }

  const dateKey = (item.startDate ?? '').slice(0, 10).replace(/[^0-9-]/g, '');
  return [
    'conference-championship',
    `week-${item.week}`,
    dateKey || 'date-unknown',
    `id-${item.id}`,
  ].join('-');
}

export function buildPlaceholderParticipant(params: {
  resolver: ReturnType<typeof createTeamIdentityResolver>;
  raw: string;
  slotId: string;
  defaultDisplay: string;
}): ParticipantSlot {
  const { resolver, raw, slotId, defaultDisplay } = params;
  const trimmed = raw.trim();

  if (/^winner of /i.test(trimmed)) {
    return {
      kind: 'derived',
      slotId,
      displayName: trimmed,
      sourceEventId: slotId.replace(/-(home|away)$/, ''),
      derivation: 'winner',
    };
  }

  const isSyntheticPostseasonSlotLabel =
    /(college football playoff|\bcfp\b|quarterfinal|semifinal|championship|\bbowl\b)/i.test(
      trimmed
    ) && /\b\d+\b/.test(trimmed);

  if (isSyntheticPostseasonSlotLabel) {
    return {
      kind: 'placeholder',
      slotId,
      displayName: defaultDisplay,
      source: 'postseason-classifier',
    };
  }

  if (trimmed && !/\btbd\b/i.test(trimmed) && !isLikelyInvalidTeamLabel(trimmed)) {
    const resolved = resolver.resolveName(trimmed);
    if (resolved.status === 'resolved') {
      const canonical = resolved.canonicalName ?? trimmed;
      return {
        kind: 'team',
        teamId: resolved.identityKey ?? canonical,
        displayName: canonical,
        canonicalName: canonical,
        rawName: trimmed,
      };
    }
  }

  return {
    kind: 'placeholder',
    slotId,
    displayName: defaultDisplay,
    source:
      trimmed.length === 0 || /\btbd\b/i.test(trimmed) || isLikelyInvalidTeamLabel(trimmed)
        ? 'postseason-classifier'
        : 'unresolved-team',
  };
}

export function buildAuthoritativeGameCollection(
  regularGames: AppGame[],
  postseasonGames: AppGame[],
  overrides?: Record<string, Partial<AppGame>>
): AppGame[] {
  const byMergeKey = new Map<string, AppGame>();

  const toMergeKey = (game: AppGame): string =>
    [game.eventId, game.stage, String(game.week), game.date ?? 'unknown'].join('::');

  for (const game of [...regularGames, ...postseasonGames]) {
    const mergeKey = toMergeKey(game);
    const existing = byMergeKey.get(mergeKey);
    if (!existing) {
      byMergeKey.set(mergeKey, game);
      continue;
    }

    const keepExistingConferenceChampionship =
      existing.stage === 'conference_championship' &&
      game.stage !== 'conference_championship' &&
      (game.postseasonRole === 'conference_championship' ||
        /conference[-\s]?championship/i.test([game.label ?? '', game.eventKey].join(' ')));

    const preferred = keepExistingConferenceChampionship
      ? existing
      : existing.isPlaceholder && !game.isPlaceholder
        ? game
        : !existing.isPlaceholder && game.isPlaceholder
          ? existing
          : game;

    const mergedParticipants = {
      home:
        existing.participants.home.kind === 'team'
          ? existing.participants.home
          : preferred.participants.home,
      away:
        existing.participants.away.kind === 'team'
          ? existing.participants.away
          : preferred.participants.away,
    };

    byMergeKey.set(mergeKey, {
      ...existing,
      ...preferred,
      participants: mergedParticipants,
      csvHome: participantCsvValue(mergedParticipants.home),
      csvAway: participantCsvValue(mergedParticipants.away),
      canHome: participantCanonicalValue(mergedParticipants.home),
      canAway: participantCanonicalValue(mergedParticipants.away),
      sources: { ...existing.sources, ...preferred.sources },
    });
  }

  for (const [eventId, override] of Object.entries(overrides ?? {})) {
    for (const [mergeKey, current] of byMergeKey.entries()) {
      if (current.eventId !== eventId) continue;
      byMergeKey.set(mergeKey, applyManualOverride(current, override));
    }
  }

  const gamesWithUniqueKeys: AppGame[] = [];
  const seenKeys = new Set<string>();

  for (const [mergeKey, game] of byMergeKey.entries()) {
    const baseKey = game.key || game.eventId || mergeKey;
    if (!seenKeys.has(baseKey)) {
      seenKeys.add(baseKey);
      gamesWithUniqueKeys.push(game);
      continue;
    }

    const disambiguator = [game.stage, `w${game.week}`, game.providerGameId ?? game.date ?? 'na']
      .join('::')
      .replace(/\s+/g, '-');
    let nextKey = `${baseKey}::${disambiguator}`;
    let counter = 2;
    while (seenKeys.has(nextKey)) {
      nextKey = `${baseKey}::${disambiguator}::${counter}`;
      counter += 1;
    }

    seenKeys.add(nextKey);
    gamesWithUniqueKeys.push({ ...game, key: nextKey });
  }

  return gamesWithUniqueKeys;
}
