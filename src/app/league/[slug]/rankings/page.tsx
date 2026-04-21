import { renderLeagueGateIfBlocked } from '../leagueGate';
import RankingsPageClient from './RankingsPageClient';

export const dynamic = 'force-dynamic';

export default async function LeagueRankingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;
  return <RankingsPageClient slug={slug} />;
}
