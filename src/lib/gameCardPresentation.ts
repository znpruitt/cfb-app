import { classifyStatusLabel } from './gameStatus';
import type { ScorePack } from './scores';

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

export function formatExpandedKickoff(date: string | null, timeZone: string): string {
  if (!date) return 'TBD';
  const kickoff = new Date(date);
  if (Number.isNaN(kickoff.getTime())) return 'TBD';
  return kickoff.toLocaleString(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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
}): { primary: string[]; secondary: string | null } {
  const lineOne = [formatExpandedKickoff(params.date, params.timeZone)];
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
