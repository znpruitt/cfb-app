import {
  CONFERENCE_CHAMPIONSHIP_SLOTS,
  matchConferenceChampionshipSlotByConference,
  matchConferenceChampionshipSlotByText,
} from './conferenceChampionships.ts';
import type { ScheduleWireItem, GameStage } from './schedule.ts';

type RowClassification =
  | { kind: 'regular_game' }
  | { kind: 'out_of_scope_postseason'; reason: string }
  | {
      kind: 'postseason_placeholder';
      stage: Exclude<GameStage, 'regular'>;
      label: string;
      conference?: string | null;
      bowlName?: string | null;
      playoffRound?: string | null;
      postseasonRole?: 'conference_championship' | 'bowl' | 'playoff' | 'national_championship';
      eventId: string;
      eventKey: string;
      slotOrder: number;
      homeDisplay: string;
      awayDisplay: string;
      homeDerivedFrom?: string;
      awayDerivedFrom?: string;
    }
  | { kind: 'invalid_row'; reason: string };

function classifyFromNormalizedMetadata(
  row: ScheduleWireItem,
  season: number
): RowClassification | null {
  if (
    row.gamePhase === 'conference_championship' ||
    row.regularSubtype === 'conference_championship'
  ) {
    return { kind: 'regular_game' };
  }

  if (row.gamePhase !== 'postseason') return null;

  const eventKey = (row.eventKey ?? '').trim();
  const stableEventKey = eventKey || slugify(`${row.id}-${row.week}`);
  const eventId = `${season}-${stableEventKey}`;
  const stage: Exclude<GameStage, 'regular'> =
    row.postseasonSubtype === 'playoff' ? 'playoff' : 'bowl';

  return {
    kind: 'postseason_placeholder',
    stage,
    label: row.label?.trim() || row.bowlName?.trim() || 'Postseason',
    conference: row.conferenceChampionshipConference ?? null,
    bowlName: row.bowlName ?? null,
    playoffRound: row.playoffRound ?? null,
    postseasonRole:
      stage === 'playoff'
        ? row.playoffRound === 'national_championship'
          ? 'national_championship'
          : 'playoff'
        : 'bowl',
    eventId,
    eventKey: stableEventKey,
    slotOrder: row.slotOrder ?? (stage === 'playoff' ? 20 : 80),
    homeDisplay: /tbd/i.test(row.homeTeam) ? row.homeTeam : 'Team TBD',
    awayDisplay: /tbd/i.test(row.awayTeam) ? row.awayTeam : 'Team TBD',
  };
}

const BOWL_SLOT_ORDER: Record<string, number> = {
  'rose-bowl': 10,
  'sugar-bowl': 11,
  'orange-bowl': 12,
  'cotton-bowl': 13,
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizedText(row: ScheduleWireItem): string {
  return [row.homeTeam, row.awayTeam, row.label ?? '', row.notes ?? '', row.venue ?? '']
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function postseasonMarkerText(row: ScheduleWireItem): string {
  return [row.homeTeam, row.awayTeam, row.label ?? '', row.notes ?? '']
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasBowlMarker(text: string): boolean {
  return /\bbowl\b/i.test(text) && !/\bbowl subdivision\b/i.test(text);
}

function hasPlayoffMarker(text: string): boolean {
  return /(college football playoff|\bcfp\b|quarterfinal|semifinal|national championship)/i.test(
    text
  );
}

function hasChampionshipMarker(text: string): boolean {
  return /\bchampionship\b/i.test(text);
}

function venueText(value: ScheduleWireItem['venue']): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.stadium ?? '';
}

function extractBowlName(row: ScheduleWireItem): string | null {
  const candidates = [row.label, row.notes, venueText(row.venue), row.homeTeam, row.awayTeam]
    .map((value) => (value ?? '').trim())
    .filter(Boolean);

  for (const source of candidates) {
    if (!hasBowlMarker(source)) continue;
    const match = source.match(/([A-Za-z0-9 .&'/-]*\bBowl\b)/i);
    if (match?.[1]) {
      return match[1].replace(/\s+/g, ' ').trim();
    }
    return source.replace(/\s+/g, ' ').trim();
  }

  return null;
}

function canonicalBowlName(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();

  const knownBowls = [
    'Rose Bowl',
    'Sugar Bowl',
    'Orange Bowl',
    'Cotton Bowl',
    'Fiesta Bowl',
    'Peach Bowl',
    'Alamo Bowl',
    'Citrus Bowl',
    'Holiday Bowl',
    'Sun Bowl',
    'Gator Bowl',
    'ReliaQuest Bowl',
    'Texas Bowl',
    'Music City Bowl',
    'Las Vegas Bowl',
    'Pinstripe Bowl',
    'Fenway Bowl',
    'Frisco Bowl',
    'Boca Raton Bowl',
    'Bahamas Bowl',
    'Armed Forces Bowl',
    'Independence Bowl',
    'Myrtle Beach Bowl',
    'New Mexico Bowl',
    'LendingTree Bowl',
    'Camellia Bowl',
    'Gasparilla Bowl',
    'Military Bowl',
    'First Responder Bowl',
    'LA Bowl',
    'Potato Bowl',
  ];

  const direct = knownBowls.find((name) => lower.includes(name.toLowerCase()));
  if (direct) return direct;

  const withoutPrefix = normalized.replace(/^[^A-Za-z0-9]*(the\s+)?/i, '');
  return withoutPrefix;
}

function playoffRoundFromText(
  text: string
): 'quarterfinal' | 'semifinal' | 'national_championship' | 'playoff' {
  if (/quarterfinal/i.test(text)) return 'quarterfinal';
  if (/semifinal/i.test(text)) return 'semifinal';
  if (/national championship/i.test(text)) return 'national_championship';
  return 'playoff';
}

function inferBowlPostseasonRole(text: string): 'bowl' | 'playoff' | 'national_championship' {
  if (/national championship/i.test(text)) return 'national_championship';
  if (/(college football playoff|\bcfp\b|quarterfinal|semifinal)/i.test(text)) return 'playoff';
  return 'bowl';
}

function playoffSlotNumber(text: string): number {
  const m = text.match(/\b([1-4])\b/);
  if (m?.[1]) return Number(m[1]);
  return NaN;
}

function fallbackPlayoffSlotKey(row: ScheduleWireItem): string {
  const key = slugify(row.id || `${row.startDate ?? ''}-${row.homeTeam}-${row.awayTeam}`);
  return key || 'unslotted';
}

function looksEmptyRow(row: ScheduleWireItem): boolean {
  return !row.homeTeam.trim() || !row.awayTeam.trim();
}

function isPostseasonContext(row: ScheduleWireItem, text: string): boolean {
  const markerText = postseasonMarkerText(row);
  const hasPostseasonMarkers =
    hasChampionshipMarker(markerText) || hasPlayoffMarker(markerText) || hasBowlMarker(markerText);
  const hasPostseasonMarkersWithVenue =
    hasChampionshipMarker(text) || hasPlayoffMarker(text) || hasBowlMarker(text);

  const seasonType = (row.seasonType ?? '').toLowerCase();
  if (seasonType === 'postseason') {
    return hasPostseasonMarkers || hasPostseasonMarkersWithVenue;
  }
  if (seasonType === 'regular') return false;
  return hasPostseasonMarkersWithVenue;
}

function classifyConferenceChampionship(
  row: ScheduleWireItem,
  text: string
): (typeof CONFERENCE_CHAMPIONSHIP_SLOTS)[number] | null {
  const hasChampionship = hasChampionshipMarker(text);
  if (hasPlayoffMarker(text)) return null;

  const seasonType = (row.seasonType ?? '').toLowerCase();
  const explicitConferenceInText =
    matchConferenceChampionshipSlotByText(row.label) ??
    matchConferenceChampionshipSlotByText(row.notes) ??
    matchConferenceChampionshipSlotByText(row.homeTeam) ??
    matchConferenceChampionshipSlotByText(row.awayTeam);

  if (explicitConferenceInText && hasChampionship) return explicitConferenceInText;

  const homeConferenceSlot = matchConferenceChampionshipSlotByConference(row.homeConference);
  const awayConferenceSlot = matchConferenceChampionshipSlotByConference(row.awayConference);
  const conferenceSlotFromTeams =
    homeConferenceSlot && awayConferenceSlot
      ? homeConferenceSlot.slug === awayConferenceSlot.slug
        ? homeConferenceSlot
        : null
      : (homeConferenceSlot ?? awayConferenceSlot);

  if (
    conferenceSlotFromTeams &&
    hasChampionship &&
    (row.conferenceGame || Boolean(homeConferenceSlot && awayConferenceSlot))
  ) {
    return conferenceSlotFromTeams;
  }

  if (seasonType === 'postseason' && row.conferenceGame && conferenceSlotFromTeams) {
    return conferenceSlotFromTeams;
  }

  return null;
}

export function classifyScheduleRow(row: ScheduleWireItem, season: number): RowClassification {
  if (looksEmptyRow(row)) return { kind: 'invalid_row', reason: 'empty participant names' };

  const byMetadata = classifyFromNormalizedMetadata(row, season);
  if (byMetadata) return byMetadata;

  const text = normalizedText(row);
  if (!isPostseasonContext(row, text)) return { kind: 'regular_game' };

  const conf = classifyConferenceChampionship(row, text);
  if (conf) {
    const label = `${conf.title} Championship Game`;
    return {
      kind: 'postseason_placeholder',
      stage: 'conference_championship',
      label,
      conference: conf.title,
      eventId: `${season}-${conf.slug}-championship`,
      eventKey: `${conf.slug}-championship`,
      slotOrder: CONFERENCE_CHAMPIONSHIP_SLOTS.findIndex((x) => x.slug === conf.slug) + 1,
      homeDisplay: `${conf.title} Team TBD`,
      awayDisplay: `${conf.title} Team TBD`,
      postseasonRole: 'conference_championship',
    };
  }

  if (hasPlayoffMarker(text)) {
    const round = playoffRoundFromText(text);
    const slot = playoffSlotNumber(text);
    const hasExplicitSlot = Number.isFinite(slot);
    const roundKey =
      round === 'national_championship'
        ? 'national-championship'
        : hasExplicitSlot
          ? `cfp-${round}-${slot}`
          : `cfp-${round}-${fallbackPlayoffSlotKey(row)}`;
    const label =
      round === 'national_championship'
        ? 'National Championship'
        : hasExplicitSlot
          ? `CFP ${round[0]?.toUpperCase()}${round.slice(1)} ${slot}`
          : `CFP ${round[0]?.toUpperCase()}${round.slice(1)}`;
    const slotOrder =
      round === 'quarterfinal'
        ? hasExplicitSlot
          ? 20 + slot
          : 29
        : round === 'semifinal'
          ? hasExplicitSlot
            ? 30 + slot
            : 39
          : 41;

    return {
      kind: 'postseason_placeholder',
      stage: 'playoff',
      label,
      playoffRound: round,
      eventId: `${season}-${roundKey}`,
      eventKey: roundKey,
      slotOrder,
      homeDisplay: row.homeTeam.includes('TBD') ? row.homeTeam : 'Team TBD',
      awayDisplay: row.awayTeam.includes('TBD') ? row.awayTeam : 'Team TBD',
      postseasonRole: round === 'national_championship' ? 'national_championship' : 'playoff',
    };
  }

  if (hasBowlMarker(text)) {
    const rawBowlName =
      extractBowlName(row) ?? row.label?.trim() ?? row.homeTeam.trim() ?? row.awayTeam.trim();
    const bowlName = canonicalBowlName(rawBowlName);
    const bowlSlug = slugify(bowlName);
    return {
      kind: 'postseason_placeholder',
      stage: 'bowl',
      label: bowlName,
      bowlName,
      eventId: `${season}-${bowlSlug}`,
      eventKey: bowlSlug,
      slotOrder: BOWL_SLOT_ORDER[bowlSlug] ?? 80,
      homeDisplay: row.homeTeam.includes('TBD') ? row.homeTeam : 'Team TBD',
      awayDisplay: row.awayTeam.includes('TBD') ? row.awayTeam : 'Team TBD',
      postseasonRole: inferBowlPostseasonRole(text),
    };
  }

  if ((row.seasonType ?? '').toLowerCase() === 'postseason' && row.conferenceGame) {
    return { kind: 'regular_game' };
  }

  return {
    kind: 'out_of_scope_postseason',
    reason: `unsupported postseason row: ${row.homeTeam} vs ${row.awayTeam}`,
  };
}

export type { RowClassification };
