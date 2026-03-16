export type ConferenceSubdivision = 'FBS' | 'FCS' | 'OTHER' | 'UNKNOWN';

export type CfbdConferenceClassification = 'fbs' | 'fcs' | 'ii' | 'iii' | string;

export type CfbdConferenceRecord = {
  name?: string | null;
  shortName?: string | null;
  abbreviation?: string | null;
  classification?: CfbdConferenceClassification | null;
};

export type NormalizedConferenceRecord = {
  name: string | null;
  shortName: string | null;
  abbreviation: string | null;
  classification: ConferenceSubdivision;
};

export type ConferenceClassificationMatch = {
  rawConference: string;
  normalizedConference: string;
  matchedRecord: NormalizedConferenceRecord | null;
  subdivision: ConferenceSubdivision;
  source: 'cfbd_conference_lookup' | 'fallback_exact' | 'unresolved';
};

const LEGACY_EXACT_FBS_KEYS = [
  'sec',
  'bigten',
  'acc',
  'big12',
  'pac12',
  'american',
  'americanathletic',
  'americanathleticconference',
  'mountainwest',
  'midamerican',
  'mac',
  'sunbelt',
  'conferenceusa',
  'cusa',
  'fbsindependent',
  'independent',
] as const;

const LEGACY_EXACT_FCS_KEYS = [
  'fcs',
  'ivy',
  'patriot',
  'swac',
  'bigsky',
  'missourivalley',
  'mvfc',
  'southern',
  'southland',
  'meac',
  'caa',
  'uac',
  'nec',
  'pioneer',
  'fcsindependent',
] as const;

export const FBS_CONFERENCE_HINTS = new Set<string>(LEGACY_EXACT_FBS_KEYS);
export const FCS_CONFERENCE_HINTS = new Set<string>(LEGACY_EXACT_FCS_KEYS);

const LEGACY_EXACT_FBS_SET = new Set<string>(LEGACY_EXACT_FBS_KEYS);
const LEGACY_EXACT_FCS_SET = new Set<string>(LEGACY_EXACT_FCS_KEYS);

let CONFERENCE_INDEX = new Map<string, NormalizedConferenceRecord>();

function normalizeConferenceToken(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function toSubdivision(classification?: string | null): ConferenceSubdivision {
  const value = (classification ?? '').trim().toLowerCase();
  if (value === 'fbs') return 'FBS';
  if (value === 'fcs') return 'FCS';
  if (!value) return 'UNKNOWN';
  return 'OTHER';
}

export function setConferenceClassificationRecords(records: CfbdConferenceRecord[]): void {
  const next = new Map<string, NormalizedConferenceRecord>();

  for (const record of records) {
    const normalized: NormalizedConferenceRecord = {
      name: typeof record.name === 'string' ? record.name.trim() : null,
      shortName: typeof record.shortName === 'string' ? record.shortName.trim() : null,
      abbreviation: typeof record.abbreviation === 'string' ? record.abbreviation.trim() : null,
      classification: toSubdivision(record.classification),
    };

    const keys = [
      normalizeConferenceToken(normalized.name),
      normalizeConferenceToken(normalized.shortName),
      normalizeConferenceToken(normalized.abbreviation),
    ].filter(Boolean);

    for (const key of keys) {
      if (!next.has(key)) next.set(key, normalized);
    }
  }

  CONFERENCE_INDEX = next;
}

export function resetConferenceClassificationRecords(): void {
  CONFERENCE_INDEX = new Map<string, NormalizedConferenceRecord>();
}

function fallbackSubdivision(normalizedConference: string): ConferenceClassificationMatch {
  if (LEGACY_EXACT_FCS_SET.has(normalizedConference)) {
    return {
      rawConference: normalizedConference,
      normalizedConference,
      matchedRecord: null,
      subdivision: 'FCS',
      source: 'fallback_exact',
    };
  }

  if (LEGACY_EXACT_FBS_SET.has(normalizedConference)) {
    return {
      rawConference: normalizedConference,
      normalizedConference,
      matchedRecord: null,
      subdivision: 'FBS',
      source: 'fallback_exact',
    };
  }

  return {
    rawConference: normalizedConference,
    normalizedConference,
    matchedRecord: null,
    subdivision: 'OTHER',
    source: 'unresolved',
  };
}

export function classifyConferenceForSubdivision(
  conference: string | null | undefined
): ConferenceClassificationMatch {
  const rawConference = (conference ?? '').trim();
  const normalizedConference = normalizeConferenceToken(rawConference);
  if (!normalizedConference) {
    return {
      rawConference,
      normalizedConference,
      matchedRecord: null,
      subdivision: 'UNKNOWN',
      source: 'unresolved',
    };
  }

  const matchedRecord = CONFERENCE_INDEX.get(normalizedConference) ?? null;
  if (matchedRecord) {
    return {
      rawConference,
      normalizedConference,
      matchedRecord,
      subdivision: matchedRecord.classification,
      source: 'cfbd_conference_lookup',
    };
  }

  const fallback = fallbackSubdivision(normalizedConference);
  return {
    ...fallback,
    rawConference,
  };
}

export function inferSubdivisionFromConference(
  conference: string | null | undefined
): ConferenceSubdivision {
  return classifyConferenceForSubdivision(conference).subdivision;
}
