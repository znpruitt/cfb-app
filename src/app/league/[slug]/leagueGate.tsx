import React from 'react';

import { notFound } from 'next/navigation';

import { getLeague } from '@/lib/leagueRegistry';
import { isAuthorizedForLeague } from '@/lib/leagueAuth';

import LeaguePasswordGate from './LeaguePasswordGate';

/**
 * Renders the password gate UI when the visitor is not authorized for the league.
 * Returns `null` when the visitor is authorized — pages should then render normally.
 *
 * Each page under /league/[slug]/* must `await renderLeagueGateIfBlocked(slug)`
 * before fetching league data. When this returns a ReactElement, the page must
 * return that element directly without loading or rendering any league content.
 */
export async function renderLeagueGateIfBlocked(slug: string): Promise<React.ReactElement | null> {
  const authorized = await isAuthorizedForLeague(slug);
  if (authorized) return null;

  const league = await getLeague(slug);
  if (!league) notFound();
  const displayName = league.displayName;
  return (
    <>
      {/* Discourage indexing of the gate itself. The URL stays valid (200), so
          well-behaved crawlers know the route exists but won't index gate copy. */}
      <meta name="robots" content="noindex, nofollow" />
      <LeaguePasswordGate slug={slug} leagueDisplayName={displayName} />
    </>
  );
}
