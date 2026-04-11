'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { DraftState } from '@/lib/draft';
import type { DraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import DraftBoardGrid from './DraftBoardGrid';
import DraftCard from './DraftCard';
import DraftHeaderArea from './DraftHeaderArea';

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

  const teamShortNameMap = Object.fromEntries(
    teamInsights.map((t) => [t.teamId.toLowerCase(), t.shortName])
  );

  const availableInsights = teamInsights
    .filter((t) => !pickedTeamsLower.has(t.teamId.toLowerCase()))
    .filter((t) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        t.teamName.toLowerCase().includes(q) ||
        t.teamId.toLowerCase().includes(q) ||
        t.shortName.toLowerCase().includes(q) ||
        (t.conference?.toLowerCase().includes(q) ?? false)
      );
    });

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_210px]">
        {/* Left column: header + board — single scroll container so header
             matches table width rather than driving the column wider */}
        <div className="min-w-0 space-y-4" style={{ overflowX: 'auto' }}>
          <DraftHeaderArea draft={draft} />
          <DraftBoardGrid draft={draft} teamColorMap={teamColorMap} teamShortNameMap={teamShortNameMap} />
        </div>

        {/* Right column: available teams — sticky, independently scrollable */}
        <aside
          className="flex flex-col rounded-lg border border-gray-100 bg-gray-50/40 p-3 dark:border-zinc-800 dark:bg-zinc-800/30"
          style={{ position: 'sticky', top: '1rem', maxHeight: 'calc(100vh - 2rem)' }}
        >
          <h2 className="mb-2 shrink-0 text-xs font-bold uppercase tracking-[0.15em] text-gray-600 border-b border-gray-200 pb-1.5 dark:text-zinc-300 dark:border-zinc-700">
            Available Teams
          </h2>
          <input
            type="search"
            placeholder="Search teams…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-3 w-full shrink-0 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
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
  );
}
