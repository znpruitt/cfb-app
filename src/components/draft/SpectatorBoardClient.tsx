'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { DraftState } from '@/lib/draft';
import type { DraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import DraftBoardGrid from './DraftBoardGrid';
import DraftCard from './DraftCard';
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
  const [search, setSearch] = useState('');

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

  // Build lowercase teamId → color map for DraftBoardGrid completed-cell left bars.
  // Lowercase keys tolerate casing differences between the CFBD catalog (insights)
  // and the pick API (static catalog).
  const teamColorMap = Object.fromEntries(
    teamInsights
      .filter((t) => t.teamColor !== null)
      .map((t) => [t.teamId.toLowerCase(), t.teamColor as string])
  );

  const availableInsights = teamInsights
    .filter((t) => !pickedTeamsLower.has(t.teamId.toLowerCase()))
    .filter((t) =>
      search
        ? t.teamName.toLowerCase().includes(search.toLowerCase()) ||
          t.teamId.toLowerCase().includes(search.toLowerCase())
        : true
    );

  return (
    <div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_210px]">
        {/* Left column: board */}
        <div className="space-y-4">
          <PickNavigator draft={draft} />
          {draft.settings.pickTimerSeconds && <TimerDisplay draft={draft} />}
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-zinc-400">
              Draft Board
            </h2>
            <DraftBoardGrid draft={draft} teamColorMap={teamColorMap} />
          </div>
        </div>

        {/* Right column: available teams (read-only) */}
        <aside>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-zinc-400">
            Available Teams
          </h2>
          <input
            type="search"
            placeholder="Search teams…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-3 w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <div className="space-y-2">
            {availableInsights.map((insights) => (
              <DraftCard
                key={insights.teamId}
                insights={insights}
                isDrafted={false}
              />
            ))}
            {availableInsights.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-zinc-500">
                {search ? 'No teams match.' : 'All teams have been drafted.'}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
