import type { AppGame, ParticipantSlot } from './schedule';

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
  if (normalized(base.conference) && normalized(base.conference) === normalized(incoming.conference)) {
    score += 4;
    reasons.push('conference');
  }
  if (normalized(base.bowlName) && normalized(base.bowlName) === normalized(incoming.bowlName)) {
    score += 4;
    reasons.push('bowl');
  }
  if (normalized(base.playoffRound) && normalized(base.playoffRound) === normalized(incoming.playoffRound)) {
    score += 4;
    reasons.push('playoffRound');
  }

  if (base.stageOrder === incoming.stageOrder && base.slotOrder === incoming.slotOrder) {
    score += 2;
    reasons.push('slotOrder');
  }

  return { score, reason: reasons.join('+') || 'none' };
}

export function hydrateEvents(params: {
  baseEvents: AppGame[];
  providerEvents: AppGame[];
}): { games: AppGame[]; diagnostics: HydrationDiagnostic[] } {
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

    const candidates = Array.from(byId.values())
      .filter(
        (candidate) =>
          candidate.stage !== 'regular' &&
          incoming.stage !== 'regular' &&
          (candidate.isPlaceholder || !isTeam(candidate.participants.home) || !isTeam(candidate.participants.away))
      )
      .map((candidate) => ({ candidate, score: scoreCandidate(candidate, incoming) }))
      .sort((a, b) => b.score.score - a.score.score);

    const best = candidates[0];
    if (best && best.score.score >= 10) {
      const { merged, fieldsUpdated } = mergeGame(best.candidate, incoming);
      byId.set(best.candidate.eventId, merged);
      diagnostics.push({
        eventId: best.candidate.eventId,
        action: 'hydrated',
        reason: `matched-by-metadata:${best.score.reason} (${participantSummary(incoming)})`,
        fieldsUpdated,
        confidence: best.score.score >= 12 ? 'high' : 'medium',
      });
      continue;
    }

    byId.set(incoming.eventId, incoming);
    diagnostics.push({
      eventId: incoming.eventId,
      action: 'inserted',
      reason: `no-placeholder-match (${participantSummary(incoming)})`,
      fieldsUpdated: ['event'],
      confidence: 'low',
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
