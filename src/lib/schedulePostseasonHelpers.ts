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
 *   - DISTINCT non-null numeric provider ids are DIFFERENT provider games,
 *     period — never merged, whatever their resolution state (a pid-bearing
 *     fragment can no more join a differently-numbered full than a second
 *     full can);
 *   - a row with a COMPLETE settled team pair is contradicted by any settled
 *     team slot on the other row naming a team outside that pair — routed
 *     away instead of hydrating the wrong game (symmetric, pid or not).
 *
 * Everything else keeps today's merge behavior: placeholder hydration,
 * same-provider-id duplicates, and fragments whose settled slots agree.
 */
function isIncompatibleCollision(a: CollectionIdentity, b: CollectionIdentity): boolean {
  if (a.pid !== null && b.pid !== null && a.pid !== b.pid) return true;
  for (const [pairSide, slotSide] of [
    [a, b],
    [b, a],
  ] as const) {
    if (pairSide.home === null || pairSide.away === null) continue;
    const pair = new Set([pairSide.home, pairSide.away]);
    for (const id of [slotSide.home, slotSide.away]) {
      if (id !== null && !pair.has(id)) return true;
    }
  }
  return false;
}

export function buildAuthoritativeGameCollection(
  regularGames: AppGame[],
  postseasonGames: AppGame[],
  overrides?: Record<string, Partial<AppGame>>
): AppGame[] {
  const toMergeKey = (game: AppGame): string =>
    [game.eventId, game.stage, String(game.week), game.date ?? 'unknown'].join('::');

  // Phase A: group by merge key WITHOUT merging, preserving arrival order.
  // Deferring resolution is what makes collision handling permutation-
  // invariant: no attachment decision is made until the key's full membership
  // is known.
  const groups = new Map<string, AppGame[]>();
  for (const game of [...regularGames, ...postseasonGames]) {
    const mergeKey = toMergeKey(game);
    const group = groups.get(mergeKey);
    if (group) group.push(game);
    else groups.set(mergeKey, [game]);
  }

  const mergeInto = (existing: AppGame, game: AppGame): AppGame => {
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

    return {
      ...existing,
      ...preferred,
      participants: mergedParticipants,
      csvHome: participantCsvValue(mergedParticipants.home),
      csvAway: participantCsvValue(mergedParticipants.away),
      canHome: participantCanonicalValue(mergedParticipants.home),
      canAway: participantCanonicalValue(mergedParticipants.away),
      sources: { ...existing.sources, ...preferred.sources },
    };
  };

  /**
   * CONTENT order for candidates and fragment folds — numeric provider id
   * ascending, id-less rows last, then participant pair and csv labels — so
   * every canonical fold and the final key disambiguation are identical
   * whatever order the inputs arrived in. Rows identical on every component
   * are interchangeable, so a residual tie cannot change output content.
   */
  const contentCompare = (a: AppGame, b: AppGame): number => {
    const ia = collectionIdentity(a);
    const ib = collectionIdentity(b);
    if (ia.pid !== null && ib.pid !== null && ia.pid !== ib.pid) return ia.pid - ib.pid;
    if (ia.pid !== null && ib.pid === null) return -1;
    if (ia.pid === null && ib.pid !== null) return 1;
    const byPair = participantPairKey(ia).localeCompare(participantPairKey(ib));
    if (byPair !== 0) return byPair;
    const byCsv = `${a.csvHome}::${a.csvAway}`.localeCompare(`${b.csvHome}::${b.csvAway}`);
    if (byCsv !== 0) return byCsv;
    return String(a.label ?? '').localeCompare(String(b.label ?? ''));
  };

  // Phase B: resolve each group content-deterministically.
  //   1. FULLS (settled team pair + numeric pid) place first, arrival order:
  //      same-pid duplicates merge exactly as before; distinct pids are
  //      distinct games and never merge.
  //   2. Fragment ATTACH decisions evaluate against the FIXED fulls-only set:
  //      a pid-bearing fragment attaches only to its same-pid full; an
  //      id-less fragment attaches only when exactly ONE full is compatible;
  //      ambiguity (or no compatible full) FAILS CLOSED — the fragment is
  //      preserved, never attached by arrival order. Attachments fold into
  //      their full in content order.
  //   3. Preserved fragments fold among THEMSELVES in content order under the
  //      same exactly-one-compatible rule.
  // Every decision depends only on group membership and identity content, so
  // the resolved output is permutation-invariant.
  const byMergeKey = new Map<string, AppGame[]>();
  for (const [mergeKey, group] of groups.entries()) {
    const fulls: AppGame[] = [];
    const fragments: AppGame[] = [];
    for (const game of group) {
      if (isFullyResolved(collectionIdentity(game))) fulls.push(game);
      else fragments.push(game);
    }

    const fullCandidates: AppGame[] = [];
    for (const game of fulls) {
      const pid = collectionIdentity(game).pid;
      const index = fullCandidates.findIndex(
        (candidate) => collectionIdentity(candidate).pid === pid
      );
      if (index === -1) fullCandidates.push(game);
      else fullCandidates[index] = mergeInto(fullCandidates[index]!, game);
    }

    const attachedByFull = new Map<number, AppGame[]>();
    const preserved: AppGame[] = [];
    for (const fragment of fragments) {
      const identity = collectionIdentity(fragment);
      const compatibleIndexes = fullCandidates
        .map((candidate, index) => ({ candidate, index }))
        .filter(
          ({ candidate }) => !isIncompatibleCollision(collectionIdentity(candidate), identity)
        );
      const target =
        identity.pid !== null
          ? compatibleIndexes.find(
              ({ candidate }) => collectionIdentity(candidate).pid === identity.pid
            )
          : compatibleIndexes.length === 1
            ? compatibleIndexes[0]
            : undefined;
      if (target === undefined) {
        preserved.push(fragment);
        continue;
      }
      const list = attachedByFull.get(target.index);
      if (list) list.push(fragment);
      else attachedByFull.set(target.index, [fragment]);
    }
    for (const [index, attachments] of attachedByFull.entries()) {
      for (const fragment of [...attachments].sort(contentCompare)) {
        fullCandidates[index] = mergeInto(fullCandidates[index]!, fragment);
      }
    }

    const fragmentCandidates: AppGame[] = [];
    for (const fragment of [...preserved].sort(contentCompare)) {
      const identity = collectionIdentity(fragment);
      const compatible = fragmentCandidates.filter(
        (candidate) => !isIncompatibleCollision(collectionIdentity(candidate), identity)
      );
      if (compatible.length === 1) {
        const index = fragmentCandidates.indexOf(compatible[0]!);
        fragmentCandidates[index] = mergeInto(fragmentCandidates[index]!, fragment);
      } else {
        fragmentCandidates.push(fragment);
      }
    }

    byMergeKey.set(mergeKey, [...fullCandidates, ...fragmentCandidates]);
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
    for (const game of [...candidates].sort(contentCompare)) {
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
