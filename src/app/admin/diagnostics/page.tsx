import React from 'react';

import SystemHealthDashboard from '@/components/admin/systemHealth/SystemHealthDashboard';
import { getLeagues } from '@/lib/leagueRegistry';
import { buildSystemHealthViewModel } from '@/lib/server/systemHealth';
import { resolveOperationalSeasonYear } from '@/lib/server/systemHealthYear';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-086F2G — System Health. A current-status surface: it builds exactly
 * ONE F2F view model for the SERVER-RESOLVED operational season and renders it.
 * There is no `?year=` selection — a caller cannot make the page browse a
 * historical year. The scheduler, automation, quota, and storage FACTS are
 * current/global and take no year; only the provider-domain inputs are
 * season-scoped, though the issues and freshness derived from them do reach the
 * headline Overall verdict. The season itself is resolved from PRODUCTION
 * leagues only — the demo league neither contributes a year nor changes the
 * selection (PLATFORM-086F2H1T5). No `/api/admin/system-health`, no internal
 * HTTP, no client fetch. Admin-authenticated via existing middleware; route stays
 * `/admin/diagnostics`.
 */
export default async function AdminSystemHealthPage(): Promise<React.ReactElement> {
  const nowMs = Date.now();
  const leagues = await getLeagues();
  const year = resolveOperationalSeasonYear({ leagues, nowMs });
  const model = await buildSystemHealthViewModel({ year, nowMs });

  return <SystemHealthDashboard model={model} nowMs={nowMs} />;
}
