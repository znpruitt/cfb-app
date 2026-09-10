import type { AppGame } from './schedule';
import { toTeamIdentityKey, type TeamCatalogItem } from './teamIdentity';

export type ScoreboardTeamLogo = Readonly<{
  lightUrl: string;
  darkUrl: string;
}>;

export type ScoreboardTeamLogosById = ReadonlyMap<string, ScoreboardTeamLogo>;

export const EMPTY_SCOREBOARD_TEAM_LOGOS_BY_ID: ScoreboardTeamLogosById = new Map();

const CFBD_LOGO_HOST = 'cdn.collegefootballdata.com';
const SCOREBOARD_LOGO_SIZE = '32';

function logoPairForProviderTeamId(providerTeamId: number): ScoreboardTeamLogo | null {
  if (!Number.isSafeInteger(providerTeamId) || providerTeamId <= 0) return null;

  return {
    lightUrl: `https://${CFBD_LOGO_HOST}/logos/${SCOREBOARD_LOGO_SIZE}/${providerTeamId}.png`,
    darkUrl: `https://${CFBD_LOGO_HOST}/logos-dark/${SCOREBOARD_LOGO_SIZE}/${providerTeamId}.png`,
  };
}

function selectCfbdLogo(
  logos: readonly string[] | null | undefined,
  family: 'logos' | 'logos-dark'
): string | null {
  for (const candidate of logos ?? []) {
    try {
      const url = new URL(candidate);
      const [pathFamily, size, filename, ...extra] = url.pathname.split('/').filter(Boolean);
      if (
        url.protocol === 'https:' &&
        url.hostname === CFBD_LOGO_HOST &&
        pathFamily === family &&
        size === SCOREBOARD_LOGO_SIZE &&
        filename?.endsWith('.png') &&
        extra.length === 0
      ) {
        return candidate;
      }
    } catch {
      // Ignore malformed provider values; the adjacent team name remains canonical identity.
    }
  }
  return null;
}

export function buildScoreboardTeamLogosById(
  teams: readonly TeamCatalogItem[],
  games: readonly AppGame[] = []
): ScoreboardTeamLogosById {
  const logosById = new Map<string, ScoreboardTeamLogo>();

  for (const team of teams) {
    const teamId = toTeamIdentityKey(team.school);
    if (!teamId) continue;

    const lightUrl = selectCfbdLogo(team.logos, 'logos');
    const darkUrl = selectCfbdLogo(team.logos, 'logos-dark');
    const fallbackUrl = lightUrl ?? darkUrl;
    if (!fallbackUrl) continue;

    logosById.set(teamId, {
      lightUrl: lightUrl ?? fallbackUrl,
      darkUrl: darkUrl ?? fallbackUrl,
    });
  }

  // The canonical team catalog intentionally remains FBS-only. Schedule rows
  // retain CFBD's numeric participant ids, though, so an FBS-vs-FCS opponent can
  // use the same provider-owned CDN asset without widening the ownable catalog.
  // Catalog metadata wins when present; this path fills only missing identities.
  for (const game of games) {
    for (const side of ['away', 'home'] as const) {
      const participant = game.participants[side];
      if (participant.kind !== 'team' || logosById.has(participant.teamId)) continue;

      const providerTeamId = side === 'home' ? game.homeProviderTeamId : game.awayProviderTeamId;
      if (typeof providerTeamId !== 'number') continue;

      const logo = logoPairForProviderTeamId(providerTeamId);
      if (logo) logosById.set(participant.teamId, logo);
    }
  }

  return logosById;
}
