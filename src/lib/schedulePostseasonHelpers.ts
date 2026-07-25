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
      const teamIdentity = resolver.getTeamIdentity(canonical);
      return {
        kind: 'team',
        teamId: resolved.identityKey ?? canonical,
        displayName: canonical,
        labels: teamIdentity
          ? {
              displayName: teamIdentity.displayName,
              shortDisplayName: teamIdentity.shortDisplayName,
              scoreboardName: teamIdentity.scoreboardName,
            }
          : undefined,
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

/**
 * The resolved identity a collection candidate asserts: canonical team ids of
 * settled 'team' slots (resolver-produced — never local raw-string matching)
 * plus the numeric CFBD provider id when the stored id is a plain decimal.
 */
type CollectionIdentity = {
  home: string | null;
  away: string | null;
  pid: number | null;
};

function collectionIdentity(game: AppGame): CollectionIdentity {
  const home = game.participants.home.kind === 'team' ? game.participants.home.teamId : null;
  const away = game.participants.away.kind === 'team' ? game.participants.away.teamId : null;
  const rawPid = typeof game.providerGameId === 'string' ? game.providerGameId.trim() : '';
  const pid = /^\d+$/.test(rawPid) ? Number(rawPid) : null;
  return { home, away, pid };
}

function isFullyResolved(identity: CollectionIdentity): boolean {
  return identity.home !== null && identity.away !== null && identity.pid !== null;
}

function participantPairKey(identity: CollectionIdentity): string {
  return [identity.home, identity.away].sort().join('::');
}

/**
 * Whether two rows that collide on event/stage/week/date metadata must NOT be
 * fieldwise merged (PLATFORM-086H3E4 — the 2024 archive hybrid combined one
 * game's provider id with another game's participants):
 *
 *   - two FULLY resolved games (both settled team slots + numeric provider
 *     ids) with DISTINCT provider ids and CONTRADICTORY canonical participant
 *     pairs are different real games — never merged;
 *   - a partially resolved row whose settled team slot names a team outside a
 *     fully resolved candidate's pair contradicts it — routed away instead of
 *     hydrating the wrong game.
 *
 * Everything else keeps today's merge behavior: placeholder hydration,
 * same-provider-id duplicates, and fragments whose settled slots agree.
 */
function isIncompatibleCollision(a: CollectionIdentity, b: CollectionIdentity): boolean {
  if (isFullyResolved(a) && isFullyResolved(b)) {
    return a.pid !== b.pid && participantPairKey(a) !== participantPairKey(b);
  }
  const [full, partial] = isFullyResolved(a) ? [a, b] : isFullyResolved(b) ? [b, a] : [null, null];
  if (full === null || partial === null) return false;
  const pair = new Set([full.home, full.away]);
  for (const id of [partial.home, partial.away]) {
    if (id !== null && !pair.has(id)) return true;
  }
  return false;
}

export function buildAuthoritativeGameCollection(
  regularGames: AppGame[],
  postseasonGames: AppGame[],
  overrides?: Record<string, Partial<AppGame>>
): AppGame[] {
  // Candidate LISTS per merge key: nearly always length 1 — a second candidate
  // exists only when an incompatible collision (above) forbids merging.
  const byMergeKey = new Map<string, AppGame[]>();

  const toMergeKey = (game: AppGame): string =>
    [game.eventId, game.stage, String(game.week), game.date ?? 'unknown'].join('::');

  /**
   * Candidates in DETERMINISTIC order — numeric provider id ascending, ids
   * before id-less fragments. This makes the two-fully-resolved collision
   * SPLIT (and its key disambiguation) permutation-invariant. Agreeing
   * partial fragments keep the legacy arrival-order merge behavior by
   * design, so a pathological three-way case (two incompatible fulls plus a
   * compatible fragment) may hydrate a different full depending on input
   * order — the split itself never varies.
   */
  const sortCandidates = (candidates: AppGame[]): AppGame[] =>
    [...candidates].sort((a, b) => {
      const pa = collectionIdentity(a).pid;
      const pb = collectionIdentity(b).pid;
      if (pa !== null && pb !== null) return pa - pb;
      if (pa !== null) return -1;
      if (pb !== null) return 1;
      return 0;
    });

  for (const game of [...regularGames, ...postseasonGames]) {
    const mergeKey = toMergeKey(game);
    const candidates = byMergeKey.get(mergeKey);
    if (!candidates) {
      byMergeKey.set(mergeKey, [game]);
      continue;
    }

    // Route to the first COMPATIBLE candidate in deterministic order; an
    // incompatible collision preserves the incoming game as its own candidate
    // and lets the existing unique-key disambiguation handle both.
    const incomingIdentity = collectionIdentity(game);
    const ordered = sortCandidates(candidates);
    const existing = ordered.find(
      (candidate) => !isIncompatibleCollision(collectionIdentity(candidate), incomingIdentity)
    );
    if (existing === undefined) {
      candidates.push(game);
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

    const merged: AppGame = {
      ...existing,
      ...preferred,
      participants: mergedParticipants,
      csvHome: participantCsvValue(mergedParticipants.home),
      csvAway: participantCsvValue(mergedParticipants.away),
      canHome: participantCanonicalValue(mergedParticipants.home),
      canAway: participantCanonicalValue(mergedParticipants.away),
      sources: { ...existing.sources, ...preferred.sources },
    };
    candidates[candidates.indexOf(existing)] = merged;
  }

  for (const [eventId, override] of Object.entries(overrides ?? {})) {
    for (const [mergeKey, candidates] of byMergeKey.entries()) {
      byMergeKey.set(
        mergeKey,
        candidates.map((candidate) =>
          candidate.eventId === eventId ? applyManualOverride(candidate, override) : candidate
        )
      );
    }
  }

  const gamesWithUniqueKeys: AppGame[] = [];
  const seenKeys = new Set<string>();

  for (const [mergeKey, candidates] of byMergeKey.entries()) {
    // Deterministic emission: for a split merge key, the lowest numeric
    // provider id keeps the base key and later candidates disambiguate —
    // identical output identities whichever order the inputs arrived in.
    for (const game of sortCandidates(candidates)) {
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
  }

  return gamesWithUniqueKeys;
}
