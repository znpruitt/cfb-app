import React from 'react';

import type { CombinedOdds } from '../lib/odds';
import type { ScorePack } from '../lib/scores';
import type { AppGame } from '../lib/schedule';
import GameWeekPanel from './GameWeekPanel';

type PostseasonPanelProps = {
  games: AppGame[];
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam: Map<string, string>;
  isDebug: boolean;
  onSavePostseasonOverride?: (eventId: string, patch: Partial<AppGame>) => void;
};

const GROUP_ORDER = [
  'conference_championship',
  'bowl',
  'playoff',
  'national_championship',
] as const;

type GroupKey = (typeof GROUP_ORDER)[number];

const GROUP_LABEL: Record<GroupKey, string> = {
  conference_championship: 'Conference Championships',
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
  onSavePostseasonOverride,
}: PostseasonPanelProps): React.ReactElement | null {
  const postseason = games.filter((g) => g.stage !== 'regular');
  if (!postseason.length) return null;

  const grouped = new Map<GroupKey, AppGame[]>();
  GROUP_ORDER.forEach((key) => grouped.set(key, []));

  for (const game of postseason) {
    const role: GroupKey =
      game.postseasonRole ??
      (game.stage === 'conference_championship'
        ? 'conference_championship'
        : game.stage === 'playoff'
          ? 'playoff'
          : 'bowl');
    const bucket = grouped.get(role);
    if (bucket) {
      bucket.push(game);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Postseason</h2>
      {GROUP_ORDER.map((key) => {
        const groupGames = [...(grouped.get(key) ?? [])].sort(kickoffSort);
        if (!groupGames.length) return null;

        return (
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
              onSavePostseasonOverride={onSavePostseasonOverride}
            />
          </div>
        );
      })}
    </section>
  );
}
