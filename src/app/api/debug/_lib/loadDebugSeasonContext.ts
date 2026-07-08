import type { CfbdConferenceRecord } from '@/lib/conferenceSubdivision';
import type { ScheduleWireItem } from '@/lib/schedule';

export type DebugSeasonContext = {
  year: number;
  origin: string;
  scheduleItems: ScheduleWireItem[];
  teamItems: Array<Record<string, unknown>>;
  aliasMap: Record<string, string>;
  conferenceItems: CfbdConferenceRecord[];
};

export function parseDebugYear(url: URL): number {
  const raw = url.searchParams.get('year');
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
}

/**
 * Forward the incoming admin request's authorization onto an internal fetch.
 * These debug routes are already `requireAdminAuth`-gated, so re-authorizing an
 * internal `/api/scores?refresh=1` sub-request as the same admin (Clerk session
 * cookie or ADMIN_API_TOKEN) is exactly the caller's own credentials — required
 * because scores upstream fetches are gated to authorized callers (PLATFORM-075).
 */
export function forwardAdminAuthHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const cookie = req.headers.get('cookie');
  if (cookie) headers.cookie = cookie;
  const authorization = req.headers.get('authorization');
  if (authorization) headers.authorization = authorization;
  const adminToken = req.headers.get('x-admin-token');
  if (adminToken) headers['x-admin-token'] = adminToken;
  return headers;
}

export async function loadDebugSeasonContext(params: {
  year: number;
  origin: string;
}): Promise<DebugSeasonContext> {
  const { year, origin } = params;
  const [scheduleRes, teamsRes, aliasesRes, conferencesRes] = await Promise.all([
    fetch(`${origin}/api/schedule?year=${year}`, { cache: 'no-store' }),
    fetch(`${origin}/api/teams`, { cache: 'no-store' }),
    // `scope=effective` returns the RESOLVER alias map (stored global > year >
    // SEED_ALIASES) — the exact precedence production identity resolution uses
    // via getScopedAliasMap('', year). The default (year-only stored) scope would
    // drop global + SEED aliases, making debug diagnostics resolve against a
    // strictly weaker alias set than production (PLATFORM-076).
    fetch(`${origin}/api/aliases?year=${year}&scope=effective`, { cache: 'no-store' }),
    fetch(`${origin}/api/conferences`, { cache: 'no-store' }),
  ]);

  const scheduleJson = (await scheduleRes.json().catch(() => ({ items: [] }))) as {
    items?: ScheduleWireItem[];
  };
  const teamsJson = (await teamsRes.json().catch(() => ({ items: [] }))) as {
    items?: Array<Record<string, unknown>>;
  };
  const aliasesJson = (await aliasesRes.json().catch(() => ({ map: {} }))) as {
    map?: Record<string, string>;
  };
  const conferencesJson = (await conferencesRes.json().catch(() => ({ items: [] }))) as {
    items?: CfbdConferenceRecord[];
  };

  return {
    year,
    origin,
    scheduleItems: scheduleJson.items ?? [],
    teamItems: teamsJson.items ?? [],
    aliasMap: aliasesJson.map ?? {},
    conferenceItems: conferencesJson.items ?? [],
  };
}
