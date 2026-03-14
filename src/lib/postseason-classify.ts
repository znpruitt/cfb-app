import type { ScheduleWireItem, GameStage } from './schedule';

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
      eventId: string;
      eventKey: string;
      slotOrder: number;
      homeDisplay: string;
      awayDisplay: string;
      homeDerivedFrom?: string;
      awayDerivedFrom?: string;
    }
  | { kind: 'invalid_row'; reason: string };

const BOWL_SLOT_ORDER: Record<string, number> = {
  'rose-bowl': 10,
  'sugar-bowl': 11,
  'orange-bowl': 12,
  'cotton-bowl': 13,
};

const CONFERENCE_CHAMPIONSHIPS = [
  { conference: 'ACC', slug: 'acc' },
  { conference: 'SEC', slug: 'sec' },
  { conference: 'Big Ten', slug: 'big-ten' },
  { conference: 'Big 12', slug: 'big-12' },
  { conference: 'AAC', slug: 'aac' },
  { conference: 'C-USA', slug: 'c-usa' },
  { conference: 'MAC', slug: 'mac' },
  { conference: 'MWC', slug: 'mwc' },
  { conference: 'Sun Belt', slug: 'sun-belt' },
] as const;

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

function playoffRoundFromText(
  text: string
): 'quarterfinal' | 'semifinal' | 'national_championship' | 'playoff' {
  if (/quarterfinal/i.test(text)) return 'quarterfinal';
  if (/semifinal/i.test(text)) return 'semifinal';
  if (/national championship/i.test(text)) return 'national_championship';
  return 'playoff';
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
    /(championship game|college football playoff|\bcfp\b|quarterfinal|semifinal|national championship)/i.test(
      markerText
    ) || hasBowlMarker(markerText);

  const seasonType = (row.seasonType ?? '').toLowerCase();
  if (seasonType === 'postseason') return hasPostseasonMarkers;
  if (seasonType === 'regular') return false;
  return hasPostseasonMarkers || hasBowlMarker(text);
}

export function classifyScheduleRow(row: ScheduleWireItem, season: number): RowClassification {
  if (looksEmptyRow(row)) return { kind: 'invalid_row', reason: 'empty participant names' };

  const text = normalizedText(row);
  if (!isPostseasonContext(row, text)) return { kind: 'regular_game' };

  const conf = CONFERENCE_CHAMPIONSHIPS.find((entry) =>
    text.includes(`${entry.conference.toLowerCase()} championship game`)
  );

  if (conf) {
    const label = `${conf.conference} Championship Game`;
    return {
      kind: 'postseason_placeholder',
      stage: 'conference_championship',
      label,
      conference: conf.conference,
      eventId: `${season}-${conf.slug}-championship`,
      eventKey: `${conf.slug}-championship`,
      slotOrder: CONFERENCE_CHAMPIONSHIPS.findIndex((x) => x.slug === conf.slug) + 1,
      homeDisplay: `${conf.conference} Team TBD`,
      awayDisplay: `${conf.conference} Team TBD`,
    };
  }

  if (
    /(college football playoff|\bcfp\b|quarterfinal|semifinal|national championship)/i.test(text)
  ) {
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
    };
  }

  if (hasBowlMarker(text)) {
    const source = row.label?.trim() || row.homeTeam.trim() || row.awayTeam.trim();
    const bowlName = (source.match(/([A-Za-z0-9 .'-]+Bowl)/i)?.[1] ?? source).trim();
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
    };
  }

  return {
    kind: 'out_of_scope_postseason',
    reason: `unsupported postseason row: ${row.homeTeam} vs ${row.awayTeam}`,
  };
}

export type { RowClassification };
