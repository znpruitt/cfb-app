import { buildSchedulePairIndex, type ScheduleAttachmentGame } from './gameAttachment.ts';
import type { TeamIdentityResolver } from './teamIdentity.ts';

export type OddsAttachmentEventBase = {
  homeTeam: string;
  awayTeam: string;
  // Upstream Odds API kickoff (`commence_time`), carried through normalization so
  // attachment can disambiguate repeated meetings of the same team pair.
  commenceTime?: string | null;
};

export type AttachedOddsEvent<TEvent extends OddsAttachmentEventBase> = {
  gameKey: string;
  event: TEvent;
};

export type OddsAttachmentReason =
  | 'unmatched_pair'
  | 'ambiguous_pair'
  | 'date_mismatch'
  | 'consumed_or_duplicate';

export type OddsAttachmentDiagnostic = {
  reason: OddsAttachmentReason;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string | null;
  candidateGameKeys: string[];
};

// Schedule kickoff vs upstream commence-time can drift (TV windows, late kicks),
// but same-pair rematches are days/weeks apart, so a generous same-window
// tolerance cleanly separates a meeting from its rematch without false rejects.
const ATTACH_DATE_TOLERANCE_HOURS = 24;

function withinDateToleranceHours(
  leftIso: string,
  rightIso: string,
  toleranceHours: number
): boolean {
  const leftMs = Date.parse(leftIso);
  const rightMs = Date.parse(rightIso);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return false;
  return Math.abs(leftMs - rightMs) <= toleranceHours * 60 * 60 * 1000;
}

/**
 * Event-centric, schedule-canonical odds attachment.
 *
 * For each upstream odds event we resolve its team pair through the centralized
 * identity resolver, find the canonical schedule games for that pair, optionally
 * narrow by commence-time/date tolerance, and attach only when exactly one
 * candidate remains. Zero or multiple candidates are skipped (never guessed), and
 * a canonical game already claimed by an earlier event is never overwritten — so
 * one event maps to at most one game, and one game is claimed at most once.
 *
 * Odds never create canonical identities: only games present in `games` (the
 * canonical schedule) can ever be returned. Optional `diagnostics` collects a
 * reason code for every event that does not attach.
 */
export function attachOddsEventsToSchedule<TEvent extends OddsAttachmentEventBase>(params: {
  games: ScheduleAttachmentGame[];
  events: TEvent[];
  resolver: TeamIdentityResolver;
  diagnostics?: OddsAttachmentDiagnostic[];
}): AttachedOddsEvent<TEvent>[] {
  const { games, events, resolver, diagnostics } = params;

  const schedulePairIndex = buildSchedulePairIndex({ games, resolver });
  const attached: AttachedOddsEvent<TEvent>[] = [];
  const consumedGameKeys = new Set<string>();

  const report = (
    reason: OddsAttachmentReason,
    event: TEvent,
    candidateGameKeys: string[]
  ): void => {
    diagnostics?.push({
      reason,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      commenceTime: event.commenceTime ?? null,
      candidateGameKeys,
    });
  };

  for (const event of events) {
    const pairKey = resolver.buildPairKey(event.homeTeam, event.awayTeam);
    const indexed = schedulePairIndex.get(pairKey) ?? [];

    // A game can be indexed under more than one pair key (canonical + csv);
    // dedupe to distinct candidate games.
    const candidateGames = new Map<string, ScheduleAttachmentGame>();
    for (const { game } of indexed) candidateGames.set(game.key, game);

    if (candidateGames.size === 0) {
      report('unmatched_pair', event, []);
      continue;
    }

    // One-to-one safety: never overwrite a game already claimed by an event.
    const available = [...candidateGames.values()].filter((g) => !consumedGameKeys.has(g.key));
    if (available.length === 0) {
      report('consumed_or_duplicate', event, [...candidateGames.keys()]);
      continue;
    }

    // Date-aware narrowing: when the event carries a commence time and any
    // candidate is dated, trust the date window. (When no candidate is dated we
    // cannot use the date signal and fall back to pure pair candidacy.)
    let narrowed = available;
    if (event.commenceTime) {
      const commenceTime = event.commenceTime;
      if (available.some((g) => Boolean(g.date))) {
        narrowed = available.filter(
          (g) =>
            g.date != null &&
            withinDateToleranceHours(g.date, commenceTime, ATTACH_DATE_TOLERANCE_HOURS)
        );
      }
    }

    if (narrowed.length === 1) {
      const game = narrowed[0];
      consumedGameKeys.add(game.key);
      attached.push({ gameKey: game.key, event });
      continue;
    }

    if (narrowed.length === 0) {
      report(
        'date_mismatch',
        event,
        available.map((g) => g.key)
      );
      continue;
    }

    // Multiple plausible candidates remain (e.g. same-pair rematch with no date
    // signal) — refuse to guess rather than fan out.
    report(
      'ambiguous_pair',
      event,
      narrowed.map((g) => g.key)
    );
  }

  return attached;
}
