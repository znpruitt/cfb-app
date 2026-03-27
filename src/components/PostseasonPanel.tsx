import React from 'react';

import type { CombinedOdds } from '../lib/odds';
import { isTruePostseasonGame } from '../lib/postseason-display';
import type { ScorePack } from '../lib/scores';
import type { AppGame } from '../lib/schedule';
import type { TeamCatalogItem } from '../lib/teamIdentity';
import GameWeekPanel from './GameWeekPanel';

type PostseasonPanelProps = {
  games: AppGame[];
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam: Map<string, string>;
  isDebug: boolean;
  teamCatalogById?: Map<string, TeamCatalogItem>;
  onSavePostseasonOverride?: (eventId: string, patch: Partial<AppGame>) => void;
  focusedGameId?: string | null;
};

const GROUP_ORDER = ['bowl', 'playoff', 'national_championship'] as const;

type GroupKey = (typeof GROUP_ORDER)[number];

const GROUP_LABEL: Record<GroupKey, string> = {
  bowl: 'Bowls',
  playoff: 'Playoff',
  national_championship: 'National Championship',
};

function kickoffSort(a: AppGame, b: AppGame): number {
  const dateCmp = (a.date ?? '').localeCompare(b.date ?? '');
  return (
    dateCmp || a.week - b.week || a.slotOrder - b.slotOrder || a.eventId.localeCompare(b.eventId)
  );
}

export default function PostseasonPanel({
  games,
  oddsByKey,
  scoresByKey,
  rosterByTeam,
  isDebug,
  teamCatalogById = new Map(),
  onSavePostseasonOverride,
  focusedGameId = null,
}: PostseasonPanelProps): React.ReactElement {
  const postseason = games.filter(isTruePostseasonGame);

  const grouped = new Map<GroupKey, AppGame[]>();
  GROUP_ORDER.forEach((key) => grouped.set(key, []));

  for (const game of postseason) {
    const inferredRole = game.postseasonRole ?? (game.stage === 'playoff' ? 'playoff' : 'bowl');
    if (inferredRole === 'conference_championship') continue;
    const bucket = grouped.get(inferredRole);
    if (bucket) {
      bucket.push(game);
    }
  }

  const visibleGroups = GROUP_ORDER.map((key) => {
    const groupGames = [...(grouped.get(key) ?? [])].sort(kickoffSort);
    return { key, groupGames };
  }).filter((group) => group.groupGames.length > 0);

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Postseason</h2>
      {visibleGroups.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-zinc-400">
          No postseason games match the current filters.
        </p>
      ) : (
        visibleGroups.map(({ key, groupGames }) => (
          <div key={key} className="space-y-2">
            <h3 className="text-lg font-medium">{GROUP_LABEL[key]}</h3>
            <GameWeekPanel
              games={groupGames}
              byes={[]}
              hideByes
              oddsByKey={oddsByKey}
              scoresByKey={scoresByKey}
              rosterByTeam={rosterByTeam}
              isDebug={isDebug}
              teamCatalogById={teamCatalogById}
              onSavePostseasonOverride={onSavePostseasonOverride}
              focusedGameId={focusedGameId}
            />
          </div>
        ))
      )}
    </section>
  );
}
