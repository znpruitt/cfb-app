import { NextResponse } from 'next/server';

import {
  buildScheduleFromApi,
  classifyTeamSubdivision,
  getRegularSeasonEligibilityDecision,
  type ScheduleWireItem,
} from '@/lib/schedule';
import {
  classifyConferenceForSubdivision,
  setConferenceClassificationRecords,
  type CfbdConferenceRecord,
} from '@/lib/conferenceSubdivision';
import { createTeamIdentityResolver, type TeamCatalogItem } from '@/lib/teamIdentity';

export const dynamic = 'force-dynamic';

function parseYear(raw: string | null): number {
  const parsed = Number(raw ?? new Date().getFullYear());
  return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = parseYear(url.searchParams.get('year'));
  const weekParam = url.searchParams.get('week');
  const seasonTypeParam = url.searchParams.get('seasonType');
  const week = weekParam && /^\d+$/.test(weekParam) ? Number.parseInt(weekParam, 10) : null;
  const origin = `${url.protocol}//${url.host}`;

  const seasonTypeQuery =
    seasonTypeParam === 'regular' || seasonTypeParam === 'postseason'
      ? `&seasonType=${seasonTypeParam}`
      : '';
  const weekQuery = week != null ? `&week=${week}` : '';

  const [scheduleRes, teamsRes, aliasesRes, conferencesRes] = await Promise.all([
    fetch(`${origin}/api/schedule?year=${year}${weekQuery}${seasonTypeQuery}`, {
      cache: 'no-store',
    }),
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
    meta?: { source?: 'cfbd_live' | 'cache' | 'local_snapshot' };
  };

  const scheduleItems = scheduleJson.items ?? [];
  const teams = (teamsJson.items ?? []) as TeamCatalogItem[];
  const aliasMap = aliasesJson.map ?? {};
  const conferenceRecords = conferencesJson.items ?? [];
  const conferenceDataSource = conferencesJson.meta?.source ?? 'unresolved';

  setConferenceClassificationRecords(conferenceRecords);

  const providerNames = Array.from(
    new Set(scheduleItems.flatMap((item) => [item.homeTeam, item.awayTeam]))
  );

  const resolver = createTeamIdentityResolver({
    teams,
    aliasMap,
    observedNames: providerNames,
  });

  const canonicalTeamMetadataByName = new Map<string, TeamCatalogItem>();
  for (const team of teams) {
    const canonicalName = resolver.resolveName(team.school).canonicalName ?? team.school;
    canonicalTeamMetadataByName.set(canonicalName, team);
  }

  const regularRows = scheduleItems.filter((item) => item.gamePhase !== 'postseason');
  const scopedRows = regularRows.filter((item) => {
    if (week != null && item.week !== week) return false;
    if (seasonTypeParam === 'postseason') return false;
    return true;
  });

  const analyzed = scopedRows.map((item) => {
    const homeResolved = resolver.resolveName(item.homeTeam);
    const awayResolved = resolver.resolveName(item.awayTeam);
    const canonicalHome = homeResolved.canonicalName ?? item.homeTeam;
    const canonicalAway = awayResolved.canonicalName ?? item.awayTeam;

    const homeConferenceMatch = classifyConferenceForSubdivision(item.homeConference ?? '');
    const awayConferenceMatch = classifyConferenceForSubdivision(item.awayConference ?? '');

    const homeSubdivision = classifyTeamSubdivision({
      canonicalTeamName: canonicalHome,
      conference: item.homeConference ?? '',
      teamMetadataByCanonicalName: canonicalTeamMetadataByName,
      resolver,
    });
    const awaySubdivision = classifyTeamSubdivision({
      canonicalTeamName: canonicalAway,
      conference: item.awayConference ?? '',
      teamMetadataByCanonicalName: canonicalTeamMetadataByName,
      resolver,
    });

    const eligibility = getRegularSeasonEligibilityDecision({
      homeSubdivision,
      awaySubdivision,
      homeResolved: homeResolved.status === 'resolved',
      awayResolved: awayResolved.status === 'resolved',
    });

    return {
      id: item.id,
      week: item.week,
      seasonType: item.seasonType ?? 'regular',
      gamePhase: item.gamePhase ?? 'regular',
      upstream: {
        homeName: item.homeTeam,
        awayName: item.awayTeam,
        homeId: null,
        awayId: null,
      },
      canonical: {
        homeTeamId: homeResolved.identityKey,
        awayTeamId: awayResolved.identityKey,
        homeTeamName: canonicalHome,
        awayTeamName: canonicalAway,
      },
      resolution: {
        homeResolved: homeResolved.status === 'resolved',
        awayResolved: awayResolved.status === 'resolved',
        homeResolutionSource: homeResolved.resolutionSource,
        awayResolutionSource: awayResolved.resolutionSource,
      },
      conference: {
        home: {
          rawConference: item.homeConference ?? '',
          matchSource: homeConferenceMatch.source,
          matchedName: homeConferenceMatch.matchedRecord?.name ?? null,
          matchedAbbreviation: homeConferenceMatch.matchedRecord?.abbreviation ?? null,
          matchedClassification: homeConferenceMatch.matchedRecord?.classification ?? null,
          inferredSubdivision: homeConferenceMatch.subdivision,
          classificationSource:
            homeConferenceMatch.source === 'cfbd_conference_lookup'
              ? conferenceDataSource
              : 'unresolved',
        },
        away: {
          rawConference: item.awayConference ?? '',
          matchSource: awayConferenceMatch.source,
          matchedName: awayConferenceMatch.matchedRecord?.name ?? null,
          matchedAbbreviation: awayConferenceMatch.matchedRecord?.abbreviation ?? null,
          matchedClassification: awayConferenceMatch.matchedRecord?.classification ?? null,
          inferredSubdivision: awayConferenceMatch.subdivision,
          classificationSource:
            awayConferenceMatch.source === 'cfbd_conference_lookup'
              ? conferenceDataSource
              : 'unresolved',
        },
      },
      classification: {
        home: {
          subdivision: homeSubdivision,
          isFbs: homeSubdivision === 'FBS',
        },
        away: {
          subdivision: awaySubdivision,
          isFbs: awaySubdivision === 'FBS',
        },
      },
      eligibility,
    };
  });

  const built = buildScheduleFromApi({
    scheduleItems,
    teams,
    aliasMap,
    season: year,
    conferenceRecords,
  });

  return NextResponse.json({
    year,
    week,
    seasonType: seasonTypeParam ?? 'all',
    totalScheduleRows: scheduleItems.length,
    regularRowsAnalyzed: analyzed.length,
    canonicalTrackedCount: built.games.length,
    conferenceRecordsCount: conferenceRecords.length,
    conferenceDataSource,
    analyzed,
  });
}
