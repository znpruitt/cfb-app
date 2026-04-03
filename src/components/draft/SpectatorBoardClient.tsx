'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { DraftState } from '@/lib/draft';
import type { DraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import DraftBoardGrid from './DraftBoardGrid';
import DraftCard from './DraftCard';
import OwnerRosterPanel from './OwnerRosterPanel';
import PickNavigator from './PickNavigator';
import TimerDisplay from './TimerDisplay';

type SpectatorBoardClientProps = {
  slug: string;
  year: number;
  initialDraft: DraftState;
  teamInsights: DraftTeamInsights[];
};

export default function SpectatorBoardClient({
  slug,
  year,
  initialDraft,
  teamInsights,
}: SpectatorBoardClientProps): React.ReactElement {
  const [draft, setDraft] = useState(initialDraft);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`);
      if (res.ok) {
        const data = (await res.json()) as { draft: DraftState };
        setDraft(data.draft);
      }
    } catch {
      // ignore transient fetch errors
    }
  }, [slug, year]);

  // 3-second polling for spectator view
  useEffect(() => {
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const pickedTeamsLower = new Set(draft.picks.map((p) => p.team.toLowerCase()));

  return (
    <div>
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50/60 px-4 py-2 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-400">
        Spectator view — updates every 3 seconds
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr_280px]">
        {/* Left: rosters */}
        <aside>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-zinc-400">
            Rosters
          </h2>
          <OwnerRosterPanel draft={draft} />
        </aside>

        {/* Center: board */}
        <div className="space-y-4">
          <PickNavigator draft={draft} />
          {draft.settings.pickTimerSeconds && <TimerDisplay draft={draft} />}
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-zinc-400">
              Draft Board
            </h2>
            <DraftBoardGrid draft={draft} />
          </div>
        </div>

        {/* Right: available teams (read-only) */}
        <aside>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-zinc-400">
            Available Teams
          </h2>
          <div className="space-y-2">
            {teamInsights
              .filter((t) => !pickedTeamsLower.has(t.teamId.toLowerCase()))
              .slice(0, 30)
              .map((insights) => (
                <DraftCard
                  key={insights.teamId}
                  insights={insights}
                  isDrafted={false}
                />
              ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
