import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../lib/leagueRegistry';
import { resolveLeagueSeason } from '../../../lib/leagueSeason';
import { listSeasonArchives } from '../../../lib/seasonArchive';
import { canonicalStandingsClientProps } from '../../../lib/selectors/canonicalStandingsClient';
import { getCanonicalStandings } from '../../../lib/selectors/leagueStandings';
import { resolveDisplayLeagueStatus } from '../../../lib/selectors/leagueLifecycle';
import { isPlatformAdminSession } from '../../../lib/server/adminAuth';
import {
  EMPTY_TEAM_RECORDS_CLIENT_PROPS,
  loadTeamRecordsClientProps,
} from '../../../lib/server/teamRecordsClient';
import type { ScoreboardTeamLogoDisplaySize } from '../../../lib/teamLogos';
import { renderLeagueGateIfBlocked } from './leagueGate';

export const dynamic = 'force-dynamic';

const TEAM_LOGO_PROTOTYPE_SIZE_BY_PARAM = {
  logo: 14,
  logo18: 18,
  logo20: 20,
  logo22: 22,
  logo24: 24,
  logo28: 28,
} as const satisfies Record<string, ScoreboardTeamLogoDisplaySize>;

function teamLogoPrototypeSize(value: string | undefined): ScoreboardTeamLogoDisplaySize | null {
  if (!value || !(value in TEAM_LOGO_PROTOTYPE_SIZE_BY_PARAM)) return null;
  return TEAM_LOGO_PROTOTYPE_SIZE_BY_PARAM[value as keyof typeof TEAM_LOGO_PROTOTYPE_SIZE_BY_PARAM];
}

export default async function LeaguePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ teamColorBar?: string | string[] }>;
}): Promise<React.ReactElement> {
  const queryPromise: Promise<{ teamColorBar?: string | string[] }> =
    searchParams ?? Promise.resolve({});
  const [{ slug }, query] = await Promise.all([params, queryPromise]);
  const teamColorBarParam = Array.isArray(query.teamColorBar)
    ? query.teamColorBar[0]
    : query.teamColorBar;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;
  const leaguePromise = getLeague(slug);
  const teamRecordPropsPromise = leaguePromise.then(async (league) => {
    if (!league) return EMPTY_TEAM_RECORDS_CLIENT_PROPS;
    const enrichmentYear = resolveLeagueSeason({
      leagueStatus: resolveDisplayLeagueStatus(league),
      leagueYear: league.year,
      defaultSeason: league.year,
    });
    return loadTeamRecordsClientProps({ leagueSlug: slug, year: enrichmentYear });
  });
  const [league, archiveYears, canonicalStandings, isAdmin, teamRecordProps] = await Promise.all([
    leaguePromise,
    listSeasonArchives(slug),
    getCanonicalStandings({ slug }),
    isPlatformAdminSession(),
    teamRecordPropsPromise,
  ]);
  const leagueStatus = resolveDisplayLeagueStatus(league);
  const mostRecentArchivedYear =
    archiveYears.length > 0 ? [...archiveYears].sort((a, b) => b - a)[0] : undefined;
  return (
    <main>
      <CFBScheduleApp
        initialNowMs={Date.now()}
        leagueSlug={slug}
        leagueDisplayName={league?.displayName}
        leagueYear={league?.year}
        leagueStatus={leagueStatus}
        // PLATFORM-198 REVIEW PROTOTYPE — these real-page comparison seams must
        // be removed before merge.
        teamColorPrototypeMode={
          teamColorBarParam === 'outline' ? 'alternate-outline' : 'remap-only'
        }
        teamLogoPrototypeSize={teamLogoPrototypeSize(teamColorBarParam)}
        assignmentMethod={league?.assignmentMethod}
        mostRecentArchivedYear={mostRecentArchivedYear}
        {...canonicalStandingsClientProps(canonicalStandings)}
        {...teamRecordProps}
        isAdmin={isAdmin}
      />
    </main>
  );
}
