export type UnresolvedConferenceObservation = {
  rawConference: string;
  normalizedKey: string;
  count: number;
  sampleTeams: string[];
  sampleGames: string[];
  contexts: string[];
  lastSeenAt: string;
};

const unresolvedStore = new Map<string, UnresolvedConferenceObservation>();

function pushUnique(target: string[], value: string, max = 5): void {
  if (!value) return;
  if (target.includes(value)) return;
  target.push(value);
  if (target.length > max) target.splice(0, target.length - max);
}

export function recordUnresolvedConference(params: {
  rawConference: string;
  normalizedKey: string;
  context: string;
  teamName?: string;
  gameId?: string;
}): void {
  const { rawConference, normalizedKey, context, teamName, gameId } = params;
  const key = normalizedKey || '__empty__';
  const current = unresolvedStore.get(key) ?? {
    rawConference,
    normalizedKey,
    count: 0,
    sampleTeams: [],
    sampleGames: [],
    contexts: [],
    lastSeenAt: new Date(0).toISOString(),
  };

  current.count += 1;
  current.lastSeenAt = new Date().toISOString();
  if (!current.rawConference && rawConference) current.rawConference = rawConference;
  pushUnique(current.contexts, context);
  pushUnique(current.sampleTeams, teamName ?? '');
  pushUnique(current.sampleGames, gameId ?? '');

  unresolvedStore.set(key, current);
}

export function getUnresolvedConferenceDiagnostics(): UnresolvedConferenceObservation[] {
  return Array.from(unresolvedStore.values()).sort((a, b) => b.count - a.count);
}

export function resetUnresolvedConferenceDiagnostics(): void {
  unresolvedStore.clear();
}
