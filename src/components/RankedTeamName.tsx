import React from 'react';

import { rankSourceLabel, type TeamRankingEnrichment } from '../lib/rankings';

type RankedTeamNameProps = {
  teamName: string;
  ranking?: TeamRankingEnrichment | null;
  className?: string;
};

export default function RankedTeamName({
  teamName,
  ranking,
  className,
}: RankedTeamNameProps): React.ReactElement {
  const rank = ranking?.rank ?? null;
  const source = ranking?.rankSource ?? null;
  const title = rank != null && source ? `${rankSourceLabel(source)} rank #${rank}` : undefined;

  return (
    <span className={className} title={title}>
      {rank != null ? `#${rank} ` : ''}
      {teamName}
    </span>
  );
}
