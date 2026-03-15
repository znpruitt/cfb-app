export type ConferenceSubdivision = 'FBS' | 'FCS' | 'OTHER' | 'UNKNOWN';

const FBS_CONFERENCE_MARKERS = [
  'sec',
  'big ten',
  'acc',
  'big 12',
  'pac-12',
  'pac 12',
  'american athletic',
  'american',
  'mountain west',
  'mid-american',
  'mid american',
  'mac',
  'sun belt',
  'conference usa',
  'c-usa',
  'cusa',
] as const;

const FCS_CONFERENCE_MARKERS = [
  'fcs',
  'ivy',
  'patriot',
  'swac',
  'big sky',
  'missouri valley',
  'mvfc',
  'southern',
  'southland',
  'meac',
  'caa',
  'uac',
  'nec',
  'pioneer',
] as const;

export const FBS_CONFERENCE_HINTS = new Set<string>(FBS_CONFERENCE_MARKERS);
export const FCS_CONFERENCE_HINTS = new Set<string>(FCS_CONFERENCE_MARKERS);

export function inferSubdivisionFromConference(
  conference: string | null | undefined
): ConferenceSubdivision {
  const text = (conference ?? '').trim().toLowerCase();
  if (!text) return 'UNKNOWN';

  const isFcsConference = Array.from(FCS_CONFERENCE_HINTS).some((marker) => text.includes(marker));
  if (isFcsConference) return 'FCS';

  const isIndependentFbs = text.includes('independent') && !text.includes('fcs');
  const isFbsConference =
    isIndependentFbs || Array.from(FBS_CONFERENCE_HINTS).some((marker) => text.includes(marker));

  if (isFbsConference) return 'FBS';
  return 'OTHER';
}
