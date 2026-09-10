import type { AppGame } from './schedule';
import { toTeamIdentityKey, type TeamCatalogItem } from './teamIdentity';

export type ScoreboardTeamLogo = Readonly<{
  url: string;
}>;

export type ScoreboardTeamLogosById = ReadonlyMap<string, ScoreboardTeamLogo>;

export const EMPTY_SCOREBOARD_TEAM_LOGOS_BY_ID: ScoreboardTeamLogosById = new Map();
export const SCOREBOARD_TEAM_LOGO_DISPLAY_SIZE = 28;

const CFBD_LOGO_HOST = 'cdn.collegefootballdata.com';
const CFBD_SCOREBOARD_LOGO_ASSET_SIZE = 64;

function logoForProviderTeamId(providerTeamId: number): ScoreboardTeamLogo | null {
  if (!Number.isSafeInteger(providerTeamId) || providerTeamId <= 0) return null;

  return {
    url: `https://${CFBD_LOGO_HOST}/logos-dark/${CFBD_SCOREBOARD_LOGO_ASSET_SIZE}/${providerTeamId}.png`,
  };
}

function selectCfbdDarkLogo(logos: readonly string[] | null | undefined): string | null {
  for (const candidate of logos ?? []) {
    try {
      const url = new URL(candidate);
      const [pathFamily, size, filename, ...extra] = url.pathname.split('/').filter(Boolean);
      if (
        url.protocol === 'https:' &&
        url.hostname === CFBD_LOGO_HOST &&
        pathFamily === 'logos-dark' &&
        size === String(CFBD_SCOREBOARD_LOGO_ASSET_SIZE) &&
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
  const catalogTeamIds = new Set<string>();

  for (const team of teams) {
    const teamId = toTeamIdentityKey(team.school);
    if (!teamId) continue;
    catalogTeamIds.add(teamId);

    // The app is dark-only. A missing dark-surface asset is missing artwork,
    // not permission to substitute a light-surface mark with unreadable ink.
    const url = selectCfbdDarkLogo(team.logos);
    if (url) logosById.set(teamId, { url });
  }

  // The canonical team catalog intentionally remains FBS-only. Schedule rows
  // retain CFBD's numeric participant ids, though, so an FBS-vs-FCS opponent can
  // use the same provider-owned CDN asset without widening the ownable catalog.
  // Catalog membership is authoritative even when its artwork is rejected; this
  // fallback fills only identities absent from the catalog (normally FCS opponents).
  for (const game of games) {
    for (const side of ['away', 'home'] as const) {
      const participant = game.participants[side];
      if (
        participant.kind !== 'team' ||
        catalogTeamIds.has(participant.teamId) ||
        logosById.has(participant.teamId)
      ) {
        continue;
      }

      const providerTeamId = side === 'home' ? game.homeProviderTeamId : game.awayProviderTeamId;
      if (typeof providerTeamId !== 'number') continue;

      const logo = logoForProviderTeamId(providerTeamId);
      if (logo) logosById.set(participant.teamId, logo);
    }
  }

  return logosById;
}
