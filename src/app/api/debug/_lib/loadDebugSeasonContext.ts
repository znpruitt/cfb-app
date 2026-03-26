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

export async function loadDebugSeasonContext(params: {
  year: number;
  origin: string;
}): Promise<DebugSeasonContext> {
  const { year, origin } = params;
  const [scheduleRes, teamsRes, aliasesRes, conferencesRes] = await Promise.all([
    fetch(`${origin}/api/schedule?year=${year}`, { cache: 'no-store' }),
    fetch(`${origin}/api/teams`, { cache: 'no-store' }),
    fetch(`${origin}/api/aliases?year=${year}`, { cache: 'no-store' }),
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
