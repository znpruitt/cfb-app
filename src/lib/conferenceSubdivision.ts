import {
  CURRENT_FOOTBALL_CONFERENCES,
  type CurrentFootballConferencePolicy,
} from '../data/currentFootballConferences.ts';

export type ConferenceSubdivision = 'FBS' | 'FCS' | 'OTHER' | 'UNKNOWN';

export type CfbdConferenceClassification = 'fbs' | 'fcs' | 'ii' | 'iii' | string;

export type CfbdConferenceRecord = {
  id?: number | null;
  name?: string | null;
  shortName?: string | null;
  abbreviation?: string | null;
  classification?: CfbdConferenceClassification | null;
};

export type ConferenceCandidateRecord = {
  id: number | null;
  name: string | null;
  shortName: string | null;
  abbreviation: string | null;
  classification: ConferenceSubdivision;
};

type ConferenceResolutionSource =
  | 'present_day_policy'
  | 'cfbd_conference_lookup'
  | 'ambiguous'
  | 'unresolved';

export type ConferenceClassificationMatch = {
  rawConference: string;
  normalizedConference: string;
  matchedAlias: string | null;
  matchedPolicyConference: string | null;
  candidates: ConferenceCandidateRecord[];
  ambiguous: boolean;
  overrideApplied: boolean;
  matchedRecord: ConferenceCandidateRecord | null;
  subdivision: ConferenceSubdivision;
  source: ConferenceResolutionSource;
};

const FBS_POLICY_ALIASES = new Set(
  CURRENT_FOOTBALL_CONFERENCES.filter((entry) => entry.classification === 'fbs').flatMap(
    (entry) => entry.aliases
  )
);
const FCS_POLICY_ALIASES = new Set(
  CURRENT_FOOTBALL_CONFERENCES.filter((entry) => entry.classification === 'fcs').flatMap(
    (entry) => entry.aliases
  )
);

export const FBS_CONFERENCE_HINTS = FBS_POLICY_ALIASES;
export const FCS_CONFERENCE_HINTS = FCS_POLICY_ALIASES;

const POLICY_INDEX = new Map<string, CurrentFootballConferencePolicy>();
for (const policy of CURRENT_FOOTBALL_CONFERENCES) {
  for (const alias of policy.aliases) {
    POLICY_INDEX.set(alias, policy);
  }
}

let CONFERENCE_INDEX = new Map<string, ConferenceCandidateRecord[]>();

export function normalizeConferenceKey(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function toSubdivision(classification?: string | null): ConferenceSubdivision {
  const value = (classification ?? '').trim().toLowerCase();
  if (value === 'fbs') return 'FBS';
  if (value === 'fcs') return 'FCS';
  if (!value) return 'UNKNOWN';
  return 'OTHER';
}

export function resolvePresentDayConferencePolicy(rawConference: string | null | undefined): {
  normalizedKey: string;
  policy: CurrentFootballConferencePolicy;
  source: 'present_day_policy';
} | null {
  const normalizedKey = normalizeConferenceKey(rawConference);
  if (!normalizedKey) return null;

  const policy = POLICY_INDEX.get(normalizedKey);
  if (!policy) return null;

  return {
    normalizedKey,
    policy,
    source: 'present_day_policy',
  };
}

export function setConferenceClassificationRecords(records: CfbdConferenceRecord[]): void {
  const next = new Map<string, ConferenceCandidateRecord[]>();

  for (const record of records) {
    const normalized: ConferenceCandidateRecord = {
      id: typeof record.id === 'number' ? record.id : null,
      name: typeof record.name === 'string' ? record.name.trim() : null,
      shortName: typeof record.shortName === 'string' ? record.shortName.trim() : null,
      abbreviation: typeof record.abbreviation === 'string' ? record.abbreviation.trim() : null,
      classification: toSubdivision(record.classification),
    };

    const keys = [
      normalizeConferenceKey(normalized.name),
      normalizeConferenceKey(normalized.shortName),
      normalizeConferenceKey(normalized.abbreviation),
    ].filter(Boolean);

    for (const key of keys) {
      const current = next.get(key) ?? [];
      const signature = [
        normalized.id ?? '',
        normalized.name ?? '',
        normalized.shortName ?? '',
        normalized.abbreviation ?? '',
        normalized.classification,
      ].join('|');

      const exists = current.some(
        (entry) =>
          [
            entry.id ?? '',
            entry.name ?? '',
            entry.shortName ?? '',
            entry.abbreviation ?? '',
            entry.classification,
          ].join('|') === signature
      );

      if (!exists) current.push(normalized);
      next.set(key, current);
    }
  }

  CONFERENCE_INDEX = next;
}

export function resetConferenceClassificationRecords(): void {
  CONFERENCE_INDEX = new Map<string, ConferenceCandidateRecord[]>();
}

function fromPolicyMatch(
  rawConference: string,
  normalizedConference: string
): ConferenceClassificationMatch {
  const policyMatch = resolvePresentDayConferencePolicy(rawConference);
  if (!policyMatch) {
    return {
      rawConference,
      normalizedConference,
      matchedAlias: null,
      matchedPolicyConference: null,
      candidates: [],
      ambiguous: false,
      overrideApplied: false,
      matchedRecord: null,
      subdivision: 'OTHER',
      source: 'unresolved',
    };
  }

  return {
    rawConference,
    normalizedConference,
    matchedAlias: policyMatch.normalizedKey,
    matchedPolicyConference: policyMatch.policy.name,
    candidates: [],
    ambiguous: false,
    overrideApplied: true,
    matchedRecord: null,
    subdivision: policyMatch.policy.classification === 'fbs' ? 'FBS' : 'FCS',
    source: 'present_day_policy',
  };
}

export function classifyConferenceForSubdivision(
  conference: string | null | undefined
): ConferenceClassificationMatch {
  const rawConference = (conference ?? '').trim();
  const normalizedConference = normalizeConferenceKey(rawConference);
  if (!normalizedConference) {
    return {
      rawConference,
      normalizedConference,
      matchedAlias: null,
      matchedPolicyConference: null,
      candidates: [],
      ambiguous: false,
      overrideApplied: false,
      matchedRecord: null,
      subdivision: 'UNKNOWN',
      source: 'unresolved',
    };
  }

  const policyMatch = resolvePresentDayConferencePolicy(rawConference);
  if (policyMatch) {
    return {
      rawConference,
      normalizedConference,
      matchedAlias: policyMatch.normalizedKey,
      matchedPolicyConference: policyMatch.policy.name,
      candidates: [],
      ambiguous: false,
      overrideApplied: true,
      matchedRecord: null,
      subdivision: policyMatch.policy.classification === 'fbs' ? 'FBS' : 'FCS',
      source: 'present_day_policy',
    };
  }

  const candidates = CONFERENCE_INDEX.get(normalizedConference) ?? [];
  if (candidates.length === 1) {
    const matchedRecord = candidates[0];
    return {
      rawConference,
      normalizedConference,
      matchedAlias: null,
      matchedPolicyConference: null,
      candidates,
      ambiguous: false,
      overrideApplied: false,
      matchedRecord,
      subdivision: matchedRecord.classification,
      source: 'cfbd_conference_lookup',
    };
  }

  if (candidates.length > 1) {
    const hasClassificationConflict =
      new Set(candidates.map((candidate) => candidate.classification)).size > 1;

    if (hasClassificationConflict) {
      return {
        rawConference,
        normalizedConference,
        matchedAlias: null,
        matchedPolicyConference: null,
        candidates,
        ambiguous: true,
        overrideApplied: false,
        matchedRecord: null,
        subdivision: 'OTHER',
        source: 'ambiguous',
      };
    }

    return {
      rawConference,
      normalizedConference,
      matchedAlias: null,
      matchedPolicyConference: null,
      candidates,
      ambiguous: false,
      overrideApplied: false,
      matchedRecord: candidates[0],
      subdivision: candidates[0].classification,
      source: 'cfbd_conference_lookup',
    };
  }

  return fromPolicyMatch(rawConference, normalizedConference);
}

export function inferSubdivisionFromConference(
  conference: string | null | undefined
): ConferenceSubdivision {
  return classifyConferenceForSubdivision(conference).subdivision;
}
