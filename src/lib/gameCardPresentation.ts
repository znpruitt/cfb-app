import { classifyStatusLabel } from './gameStatus';
import type { ScorePack } from './scores';
import {
  MEDIA_TYPE_DISPLAY_PRIORITY,
  type ScheduleMediaItem,
} from './schedule/schedulePresentation';

type VenueDetails = {
  stadium?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

function cleanVenuePart(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * The SHARED TBD-aware kickoff formatter (PLATFORM-086E1C1) for every `AppGame`
 * kickoff surface that has access to `startTimeTBD`:
 *   - a missing or unparseable date is `TBD` (unchanged);
 *   - a confirmed kickoff (`startTimeTBD` not `true`) keeps the exact
 *     pre-existing localized format;
 *   - `startTimeTBD === true` with a usable date renders the DATE plus
 *     `Time TBD` — the provider's placeholder clock is never displayed as a
 *     confirmed kickoff time.
 */
export function formatExpandedKickoff(
  date: string | null,
  timeZone: string,
  startTimeTBD?: boolean | null
): string {
  if (!date) return 'TBD';
  const kickoff = new Date(date);
  if (Number.isNaN(kickoff.getTime())) return 'TBD';
  if (startTimeTBD === true) {
    const dateOnly = kickoff.toLocaleString(undefined, {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return `${dateOnly} · Time TBD`;
  }
  return kickoff.toLocaleString(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Choose ONE primary display outlet deterministically (PLATFORM-086E1C1):
 * media-type priority `tv → web → ppv → mobile → radio`, then case-insensitive
 * outlet order within a type. TV/PPV display the outlet directly; web/mobile
 * get an explicit streaming label; radio-only data gets an explicit radio
 * label. Returns `null` when no usable media row exists. The full normalized
 * media list stays on the wire/application model — this helper only compresses
 * it for the compact card display.
 */
export function formatPrimaryBroadcastLabel(
  media: ScheduleMediaItem[] | null | undefined
): string | null {
  if (!Array.isArray(media) || media.length === 0) return null;
  let best: ScheduleMediaItem | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;
  for (const row of media) {
    const priority = MEDIA_TYPE_DISPLAY_PRIORITY.indexOf(row.mediaType);
    const outlet = typeof row.outlet === 'string' ? row.outlet.trim() : '';
    if (priority < 0 || outlet.length === 0) continue;
    if (
      priority < bestPriority ||
      (priority === bestPriority &&
        best !== null &&
        outlet.toLowerCase().localeCompare(best.outlet.trim().toLowerCase()) < 0)
    ) {
      best = { ...row, outlet };
      bestPriority = priority;
    }
  }
  if (!best) return null;
  switch (best.mediaType) {
    case 'web':
    case 'mobile':
      return `Streaming · ${best.outlet}`;
    case 'radio':
      return `Radio · ${best.outlet}`;
    default:
      return best.outlet;
  }
}

export function formatVenueLabel(venue: VenueDetails | string | null | undefined): string | null {
  if (!venue) return null;
  if (typeof venue === 'string') return cleanVenuePart(venue);

  const stadium = cleanVenuePart(venue.stadium);
  const city = cleanVenuePart(venue.city);
  const state = cleanVenuePart(venue.state);
  const country = cleanVenuePart(venue.country);

  const stateOrCountry = state ?? country;
  const location = city ? [city, stateOrCountry].filter(Boolean).join(', ') : null;

  if (stadium && location) return `${stadium} • ${location}`;
  if (stadium) return stadium;
  return location;
}

export function deriveExpandedMetadataLines(params: {
  date: string | null;
  timeZone: string;
  useNeutralSemantics: boolean;
  venue?: VenueDetails | string | null;
  /** Presentation metadata (PLATFORM-086E1C1) — optional, absent keeps prior output. */
  startTimeTBD?: boolean | null;
  media?: ScheduleMediaItem[] | null;
}): { primary: string[]; secondary: string | null } {
  const lineOne = [formatExpandedKickoff(params.date, params.timeZone, params.startTimeTBD)];
  const broadcast = formatPrimaryBroadcastLabel(params.media);
  if (broadcast) {
    lineOne.push(broadcast);
  }
  if (params.useNeutralSemantics) {
    lineOne.push('Neutral Site');
  }

  return {
    primary: lineOne,
    secondary: formatVenueLabel(params.venue),
  };
}

export function deriveScoreOutcomePresentation(score?: ScorePack): {
  winner: 'away' | 'home' | null;
  shouldEmphasize: boolean;
} {
  const bucket = classifyStatusLabel(score?.status);
  if (!score || bucket !== 'final') {
    return { winner: null, shouldEmphasize: false };
  }

  const awayScore = score.away.score;
  const homeScore = score.home.score;
  if (awayScore == null || homeScore == null || awayScore === homeScore) {
    return { winner: null, shouldEmphasize: false };
  }

  return {
    winner: awayScore > homeScore ? 'away' : 'home',
    shouldEmphasize: true,
  };
}
