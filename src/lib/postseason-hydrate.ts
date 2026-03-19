import type { AppGame, ParticipantSlot } from './schedule.ts';

export type HydrationDiagnostic = {
  eventId: string;
  action: 'hydrated' | 'inserted' | 'template-preserved';
  reason: string;
  fieldsUpdated: string[];
  confidence: 'high' | 'medium' | 'low';
};

function isTeam(p: ParticipantSlot): boolean {
  return p.kind === 'team';
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().trim();
}

function participantSummary(game: AppGame): string {
  return `${game.participants.away.displayName} @ ${game.participants.home.displayName}`;
}

function mergeGame(base: AppGame, incoming: AppGame): { merged: AppGame; fieldsUpdated: string[] } {
  const fieldsUpdated: string[] = [];
  let merged = { ...base };

  if (base.participants.home.kind !== 'team' && isTeam(incoming.participants.home)) {
    merged = {
      ...merged,
      participants: { ...merged.participants, home: incoming.participants.home },
      csvHome: incoming.csvHome,
      canHome: incoming.canHome,
    };
    fieldsUpdated.push('participants.home');
  }

  if (base.participants.away.kind !== 'team' && isTeam(incoming.participants.away)) {
    merged = {
      ...merged,
      participants: { ...merged.participants, away: incoming.participants.away },
      csvAway: incoming.csvAway,
      canAway: incoming.canAway,
    };
    fieldsUpdated.push('participants.away');
  }

  if ((!merged.date || merged.date === '') && incoming.date) {
    merged = { ...merged, date: incoming.date };
    fieldsUpdated.push('date');
  }

  if ((!merged.venue || merged.venue === '') && incoming.venue) {
    merged = { ...merged, venue: incoming.venue };
    fieldsUpdated.push('venue');
  }

  if (!merged.providerGameId && incoming.providerGameId) {
    merged = { ...merged, providerGameId: incoming.providerGameId };
    fieldsUpdated.push('providerGameId');
  }

  if (!merged.label && incoming.label) {
    merged = { ...merged, label: incoming.label };
    fieldsUpdated.push('label');
  }

  if (incoming.postseasonRole && incoming.postseasonRole !== merged.postseasonRole) {
    merged = { ...merged, postseasonRole: incoming.postseasonRole };
    fieldsUpdated.push('postseasonRole');
  }

  if (incoming.playoffRound && incoming.playoffRound !== merged.playoffRound) {
    merged = { ...merged, playoffRound: incoming.playoffRound };
    fieldsUpdated.push('playoffRound');
  }

  const bothTeamsKnown = isTeam(merged.participants.home) && isTeam(merged.participants.away);
  const nextStatus = bothTeamsKnown ? 'matchup_set' : merged.status;
  if (nextStatus !== merged.status) {
    merged = { ...merged, status: nextStatus, isPlaceholder: nextStatus === 'placeholder' };
    fieldsUpdated.push('status');
  }

  merged = {
    ...merged,
    sources: { ...base.sources, ...incoming.sources },
  };

  return { merged, fieldsUpdated };
}

function scoreSupportSignals(
  base: AppGame,
  incoming: AppGame
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (base.week === incoming.week) {
    score += 4;
    reasons.push('week');
  }

  if (base.neutral === incoming.neutral) {
    score += 2;
    reasons.push('neutral');
  }

  if (normalized(base.venue) && normalized(base.venue) === normalized(incoming.venue)) {
    score += 2;
    reasons.push('venue');
  }

  if (base.date && incoming.date && base.date.slice(0, 10) === incoming.date.slice(0, 10)) {
    score += 2;
    reasons.push('kickoffDate');
  }

  return { score, reasons };
}

function scoreCandidate(base: AppGame, incoming: AppGame): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  if (base.week === incoming.week) {
    score += 4;
    reasons.push('week');
  }
  if (base.stage === incoming.stage) {
    score += 4;
    reasons.push('stage');
  }

  if (normalized(base.label) && normalized(base.label) === normalized(incoming.label)) {
    score += 5;
    reasons.push('label');
  }
  if (
    normalized(base.conference) &&
    normalized(base.conference) === normalized(incoming.conference)
  ) {
    score += 4;
    reasons.push('conference');
  }
  if (normalized(base.bowlName) && normalized(base.bowlName) === normalized(incoming.bowlName)) {
    score += 6;
    reasons.push('bowl');
  }
  if (
    normalized(base.playoffRound) &&
    normalized(base.playoffRound) === normalized(incoming.playoffRound)
  ) {
    score += 4;
    reasons.push('playoffRound');
  }

  if (base.stageOrder === incoming.stageOrder && base.slotOrder === incoming.slotOrder) {
    score += 2;
    reasons.push('slotOrder');
  }

  const supportSignals = scoreSupportSignals(base, incoming);
  score += supportSignals.score;
  reasons.push(...supportSignals.reasons);

  return { score, reason: reasons.join('+') || 'none' };
}

function choosePrimaryPostseasonCandidate(
  candidates: AppGame[],
  incoming: AppGame
): AppGame | null {
  const incomingBowl = normalized(incoming.bowlName);
  if (incoming.stage === 'bowl' && incomingBowl) {
    const bowlMatch = candidates.filter(
      (candidate) => candidate.stage === 'bowl' && normalized(candidate.bowlName) === incomingBowl
    );
    if (bowlMatch.length === 1) return bowlMatch[0] ?? null;

    const seasonAligned = bowlMatch.filter((candidate) => candidate.week === incoming.week);
    if (seasonAligned.length === 1) return seasonAligned[0] ?? null;

    const bySupport = seasonAligned.length ? seasonAligned : bowlMatch;
    return (
      bySupport
        .map((candidate) => ({
          candidate,
          support: scoreSupportSignals(candidate, incoming).score,
        }))
        .sort((a, b) => b.support - a.support)[0]?.candidate ?? null
    );
  }

  return null;
}

export function hydrateEvents(params: { baseEvents: AppGame[]; providerEvents: AppGame[] }): {
  games: AppGame[];
  diagnostics: HydrationDiagnostic[];
} {
  const { baseEvents, providerEvents } = params;
  const byId = new Map<string, AppGame>(baseEvents.map((g) => [g.eventId, g]));
  const diagnostics: HydrationDiagnostic[] = [];

  for (const incoming of providerEvents) {
    const existing = byId.get(incoming.eventId);
    if (existing) {
      const { merged, fieldsUpdated } = mergeGame(existing, incoming);
      byId.set(incoming.eventId, merged);
      diagnostics.push({
        eventId: incoming.eventId,
        action: 'hydrated',
        reason: fieldsUpdated.length ? 'matched-by-event-id' : 'matched-by-event-id-no-change',
        fieldsUpdated,
        confidence: 'high',
      });
      continue;
    }

    const candidates = Array.from(byId.values()).filter(
      (candidate) =>
        candidate.stage !== 'regular' &&
        incoming.stage !== 'regular' &&
        (candidate.isPlaceholder ||
          !isTeam(candidate.participants.home) ||
          !isTeam(candidate.participants.away))
    );

    const primaryCandidate = choosePrimaryPostseasonCandidate(candidates, incoming);
    if (primaryCandidate) {
      const { merged, fieldsUpdated } = mergeGame(primaryCandidate, incoming);
      byId.set(primaryCandidate.eventId, merged);
      diagnostics.push({
        eventId: primaryCandidate.eventId,
        action: 'hydrated',
        reason: `matched-by-postseason-identity:bowlName (${participantSummary(incoming)})`,
        fieldsUpdated,
        confidence: 'high',
      });
      continue;
    }

    const metadataCandidates = candidates.filter((candidate) => {
      if (incoming.stage !== 'bowl') return true;

      // Bowl fallback matching must not hydrate into non-bowl placeholders
      // (e.g. CFP/conference slots) when support metadata happens to align.
      if (candidate.stage !== 'bowl') return false;

      const incomingBowl = normalized(incoming.bowlName);
      if (!incomingBowl) return true;

      const candidateBowl = normalized(candidate.bowlName);
      return Boolean(candidateBowl) && candidateBowl === incomingBowl;
    });

    const scoredCandidates = metadataCandidates
      .map((candidate) => ({ candidate, score: scoreCandidate(candidate, incoming) }))
      .sort((a, b) => b.score.score - a.score.score);

    const best = scoredCandidates[0];
    if (best && best.score.score >= 11) {
      const { merged, fieldsUpdated } = mergeGame(best.candidate, incoming);
      byId.set(best.candidate.eventId, merged);
      diagnostics.push({
        eventId: best.candidate.eventId,
        action: 'hydrated',
        reason: `matched-by-metadata:${best.score.reason} (${participantSummary(incoming)})`,
        fieldsUpdated,
        confidence: best.score.score >= 14 ? 'high' : 'medium',
      });
      continue;
    }

    byId.set(incoming.eventId, incoming);
    const isExpectedBowlInsert =
      incoming.stage === 'bowl' && Boolean(normalized(incoming.bowlName));
    diagnostics.push({
      eventId: incoming.eventId,
      action: 'inserted',
      reason: isExpectedBowlInsert
        ? `bowl-slot-created-from-provider-identity (${participantSummary(incoming)})`
        : `no-placeholder-match (${participantSummary(incoming)})`,
      fieldsUpdated: ['event'],
      confidence: isExpectedBowlInsert ? 'medium' : 'low',
    });
  }

  for (const template of baseEvents) {
    if (byId.has(template.eventId)) {
      diagnostics.push({
        eventId: template.eventId,
        action: 'template-preserved',
        reason: 'seeded-postseason-slot',
        fieldsUpdated: [],
        confidence: 'high',
      });
    }
  }

  return { games: Array.from(byId.values()), diagnostics };
}
