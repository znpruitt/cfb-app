'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { hasStoredAdminToken, requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { DraftState, DraftPick } from '@/lib/draft';
import type { DraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import DraftCard from './DraftCard';
import DraftBoardGrid from './DraftBoardGrid';
import DraftControls from './DraftControls';
import OwnerRosterPanel from './OwnerRosterPanel';
import PickNavigator from './PickNavigator';
import TimerDisplay from './TimerDisplay';

type DraftBoardClientProps = {
  slug: string;
  year: number;
  initialDraft: DraftState;
  teamInsights: DraftTeamInsights[];
};

export default function DraftBoardClient({
  slug,
  year,
  initialDraft,
  teamInsights,
}: DraftBoardClientProps): React.ReactElement {
  const [draft, setDraft] = useState(initialDraft);
  const [isAdmin] = useState(() => hasStoredAdminToken());
  const [search, setSearch] = useState('');
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickLoading, setPickLoading] = useState(false);

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

  // 1-second polling for commissioner view
  useEffect(() => {
    const id = setInterval(() => void refresh(), 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const pickedTeamsLower = new Set(draft.picks.map((p: DraftPick) => p.team.toLowerCase()));

  const canPick = isAdmin && draft.phase === 'live';

  async function handlePick(teamId: string) {
    if (!canPick) return;
    setPickError(null);
    setPickLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}/pick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ team: teamId }),
      });
      const data = (await res.json()) as { draft?: DraftState; error?: string };
      if (!res.ok || !data.draft) {
        setPickError(data.error ?? `Pick failed (${res.status})`);
        return;
      }
      setDraft(data.draft);
    } catch (err) {
      setPickError((err as Error).message);
    } finally {
      setPickLoading(false);
    }
  }

  const filteredInsights = teamInsights.filter((t) =>
    search
      ? t.teamName.toLowerCase().includes(search.toLowerCase()) ||
        t.teamId.toLowerCase().includes(search.toLowerCase())
      : true
  );

  return (
    <div>
      {/* Status bar */}
      {!isAdmin && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2 text-sm text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/20 dark:text-amber-400">
          Commissioner token not detected — viewing in read-only mode. Save your admin token to
          enable draft controls.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr_300px]">
        {/* Left column: owner rosters */}
        <aside>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-zinc-400">
            Rosters
          </h2>
          <OwnerRosterPanel draft={draft} />
        </aside>

        {/* Center column: board + controls */}
        <div className="space-y-4">
          <PickNavigator draft={draft} />

          {draft.settings.pickTimerSeconds && <TimerDisplay draft={draft} />}

          {isAdmin && (
            <DraftControls
              slug={slug}
              year={year}
              draft={draft}
              onUpdate={(updated) => setDraft(updated)}
            />
          )}

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-zinc-400">
              Draft Board
            </h2>
            <DraftBoardGrid draft={draft} />
          </div>
        </div>

        {/* Right column: available teams */}
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
          {pickError && (
            <p className="mb-2 text-sm text-red-700 dark:text-red-400">{pickError}</p>
          )}
          <div className="space-y-2">
            {filteredInsights.map((insights) => {
              const isDrafted = pickedTeamsLower.has(insights.teamId.toLowerCase());
              return (
                <DraftCard
                  key={insights.teamId}
                  insights={insights}
                  isDrafted={isDrafted}
                  onSelect={
                    canPick && !isDrafted && !pickLoading
                      ? () => void handlePick(insights.teamId)
                      : undefined
                  }
                />
              );
            })}
            {filteredInsights.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-zinc-500">No teams match.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
