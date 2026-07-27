import type { CanonicalGame } from '@/lib/gameStats/canonicalSlate';
import type { ScorePack } from '@/lib/scores/types';
import type { TeamIdentityResolver } from '@/lib/teamIdentity';

import type { LiveScoreContext, LiveScoreGame } from '../canonicalContext';
import type { NormalizedScoreboardRow, ScoreboardStatus } from '../scoreboardPayload';

/** Build a canonical game with sensible defaults; override any field. */
export function makeCanonicalGame(
  overrides: Partial<CanonicalGame> & { providerGameId: number }
): CanonicalGame {
  const id = overrides.providerGameId;
  return {
    providerGameId: id,
    key: overrides.key ?? `k-${id}`,
    eventId: overrides.eventId ?? `e-${id}`,
    providerWeek: overrides.providerWeek ?? 3,
    seasonType: overrides.seasonType ?? 'regular',
    neutral: overrides.neutral ?? false,
    applicability: overrides.applicability ?? 'pending',
    notExpectedReason: overrides.notExpectedReason ?? null,
    home:
      overrides.home === undefined
        ? { identityKey: `home-${id}`, canonicalName: `Home ${id}` }
        : overrides.home,
    away:
      overrides.away === undefined
        ? { identityKey: `away-${id}`, canonicalName: `Away ${id}` }
        : overrides.away,
    homeId: overrides.homeId ?? null,
    awayId: overrides.awayId ?? null,
    kickoff: overrides.kickoff ?? null,
    rawStatus: overrides.rawStatus ?? 'scheduled',
  };
}

export function makeLiveGame(
  canonical: Partial<CanonicalGame> & { providerGameId: number },
  state: {
    cachedStatus?: LiveScoreGame['cachedStatus'];
    cachedScore?: ScorePack | null;
    cachedScoreAt?: number | null;
    pendingConfirmation?: boolean;
  } = {}
): LiveScoreGame {
  return {
    canonical: makeCanonicalGame(canonical),
    cachedStatus: state.cachedStatus ?? null,
    cachedScore: state.cachedScore ?? null,
    cachedScoreAt: state.cachedScoreAt ?? null,
    pendingConfirmation: state.pendingConfirmation ?? false,
  };
}

/** A resolver stub for modules that never call it (e.g. pollingTarget). */
export const NOOP_RESOLVER = {} as TeamIdentityResolver;

export function makeContext(
  games: LiveScoreGame[],
  opts: { year?: number; resolver?: TeamIdentityResolver } = {}
): LiveScoreContext {
  return { year: opts.year ?? 2025, games, resolver: opts.resolver ?? NOOP_RESOLVER };
}

export function makeScoreboardRow(
  overrides: Partial<NormalizedScoreboardRow> & { providerGameId: number; status: ScoreboardStatus }
): NormalizedScoreboardRow {
  const id = overrides.providerGameId;
  return {
    providerGameId: id,
    startDate: overrides.startDate ?? null,
    status: overrides.status,
    period: overrides.period ?? null,
    clock: overrides.clock ?? null,
    homeId: overrides.homeId ?? null,
    awayId: overrides.awayId ?? null,
    homeTeam: overrides.homeTeam ?? `Home ${id}`,
    awayTeam: overrides.awayTeam ?? `Away ${id}`,
    homePoints: overrides.homePoints ?? null,
    awayPoints: overrides.awayPoints ?? null,
  };
}
