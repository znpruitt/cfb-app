'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { DraftState } from '@/lib/draft';
import type { DraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import DraftBoardGrid from './DraftBoardGrid';
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
    <div>
      {/* Header + board — single scroll container so header matches table width */}
      <div className="min-w-0 space-y-4" style={{ overflowX: 'auto' }}>
        <DraftHeaderArea draft={draft} />
        <DraftBoardGrid draft={draft} teamColorMap={teamColorMap} teamShortNameMap={teamShortNameMap} />
      </div>

      {/* Available Teams — horizontal bottom strip (spectator: non-clickable) */}
      <div style={{ borderTop: '0.5px solid #1f2937', paddingTop: 10, marginTop: 16 }}>
        {/* Header row: label + search */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b7280' }}>
            Available Teams
          </span>
          <input
            type="search"
            placeholder="Search or filter by conference…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: 220,
              fontSize: 12,
              padding: '4px 8px',
              background: '#111827',
              border: '0.5px solid #374151',
              borderRadius: 6,
              color: '#e5e7eb',
              outline: 'none',
            }}
          />
        </div>
        {/* Chip row — horizontally scrollable */}
        <div
          className="draft-chip-scroll"
          style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}
        >
          {availableInsights.map((t) => {
            const barColor = t.teamColor ?? '#94a3b8';
            return (
              <div
                key={t.teamId}
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  flexShrink: 0,
                  background: '#1f2937',
                  border: '0.5px solid #374151',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                <span style={{ width: 3, flexShrink: 0, backgroundColor: barColor }} />
                <div style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#e5e7eb' }}>
                    {t.shortName}
                  </span>
                  {t.conference && (
                    <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 6 }}>
                      {t.conference}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {availableInsights.length === 0 && (
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              {search ? 'No teams match.' : 'All teams have been drafted.'}
            </span>
          )}
        </div>
      </div>
      <style>{`
        .draft-chip-scroll::-webkit-scrollbar { height: 3px; }
        .draft-chip-scroll::-webkit-scrollbar-track { background: transparent; }
        .draft-chip-scroll::-webkit-scrollbar-thumb { background: #374151; border-radius: 2px; }
      `}</style>
    </div>
  );
}
