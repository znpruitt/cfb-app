type CandidateRecord = {
  id: number | null;
  name: string | null;
  shortName: string | null;
  abbreviation: string | null;
  classification: string;
};

export type UnresolvedConferenceObservation = {
  normalizedKey: string;
  rawLabelsSeen: string[];
  count: number;
  sampleTeams: string[];
  sampleGames: string[];
  contexts: string[];
  lastSeenAt: string;
};

export type AmbiguousConferenceObservation = {
  normalizedKey: string;
  rawLabelsSeen: string[];
  count: number;
  sampleTeams: string[];
  sampleGames: string[];
  contexts: string[];
  candidateRecords: CandidateRecord[];
  lastSeenAt: string;
};

export type PresentDayPolicyObservation = {
  normalizedKey: string;
  rawLabelsSeen: string[];
  count: number;
  policyConference: string;
  policyClassification: 'FBS' | 'FCS';
  sampleTeams: string[];
  sampleGames: string[];
  contexts: string[];
  lastSeenAt: string;
};

const unresolvedStore = new Map<string, UnresolvedConferenceObservation>();
const ambiguousStore = new Map<string, AmbiguousConferenceObservation>();
const policyStore = new Map<string, PresentDayPolicyObservation>();

function pushUnique(target: string[], value: string, max = 8): void {
  if (!value || target.includes(value)) return;
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
    normalizedKey,
    rawLabelsSeen: [],
    count: 0,
    sampleTeams: [],
    sampleGames: [],
    contexts: [],
    lastSeenAt: new Date(0).toISOString(),
  };

  current.count += 1;
  current.lastSeenAt = new Date().toISOString();
  pushUnique(current.rawLabelsSeen, rawConference);
  pushUnique(current.contexts, context);
  pushUnique(current.sampleTeams, teamName ?? '');
  pushUnique(current.sampleGames, gameId ?? '');

  unresolvedStore.set(key, current);
}

export function recordAmbiguousConference(params: {
  rawConference: string;
  normalizedKey: string;
  context: string;
  teamName?: string;
  gameId?: string;
  candidateRecords: CandidateRecord[];
}): void {
  const { rawConference, normalizedKey, context, teamName, gameId, candidateRecords } = params;
  const key = normalizedKey || '__empty__';
  const current = ambiguousStore.get(key) ?? {
    normalizedKey,
    rawLabelsSeen: [],
    count: 0,
    sampleTeams: [],
    sampleGames: [],
    contexts: [],
    candidateRecords,
    lastSeenAt: new Date(0).toISOString(),
  };

  current.count += 1;
  current.lastSeenAt = new Date().toISOString();
  pushUnique(current.rawLabelsSeen, rawConference);
  if (current.candidateRecords.length === 0 && candidateRecords.length > 0) {
    current.candidateRecords = candidateRecords;
  }

  pushUnique(current.contexts, context);
  pushUnique(current.sampleTeams, teamName ?? '');
  pushUnique(current.sampleGames, gameId ?? '');

  ambiguousStore.set(key, current);
}

export function recordPresentDayPolicyConference(params: {
  rawConference: string;
  normalizedKey: string;
  context: string;
  teamName?: string;
  gameId?: string;
  policyConference: string;
  policyClassification: 'FBS' | 'FCS';
}): void {
  const {
    rawConference,
    normalizedKey,
    context,
    teamName,
    gameId,
    policyConference,
    policyClassification,
  } = params;

  const key = normalizedKey || '__empty__';
  const current = policyStore.get(key) ?? {
    normalizedKey,
    rawLabelsSeen: [],
    count: 0,
    policyConference,
    policyClassification,
    sampleTeams: [],
    sampleGames: [],
    contexts: [],
    lastSeenAt: new Date(0).toISOString(),
  };

  current.count += 1;
  current.lastSeenAt = new Date().toISOString();
  pushUnique(current.rawLabelsSeen, rawConference);
  pushUnique(current.contexts, context);
  pushUnique(current.sampleTeams, teamName ?? '');
  pushUnique(current.sampleGames, gameId ?? '');

  policyStore.set(key, current);
}

export function getUnresolvedConferenceDiagnostics(): UnresolvedConferenceObservation[] {
  return Array.from(unresolvedStore.values()).sort((a, b) => b.count - a.count);
}

export function getAmbiguousConferenceDiagnostics(): AmbiguousConferenceObservation[] {
  return Array.from(ambiguousStore.values()).sort((a, b) => b.count - a.count);
}

export function getPresentDayPolicyConferenceDiagnostics(): PresentDayPolicyObservation[] {
  return Array.from(policyStore.values()).sort((a, b) => b.count - a.count);
}

export function resetUnresolvedConferenceDiagnostics(): void {
  unresolvedStore.clear();
  ambiguousStore.clear();
  policyStore.clear();
}
