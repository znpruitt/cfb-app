'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { hasStoredAdminToken, requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { DraftState, DraftPick } from '@/lib/draft';
import type { DraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import DraftCard from './DraftCard';
import DraftBoardGrid from './DraftBoardGrid';
import DraftControls from './DraftControls';
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

  // Auth priority: Clerk platform_admin session → sessionStorage token → spectator redirect
  const { user, isLoaded: clerkLoaded } = useUser();
  const [isTokenAdmin] = useState(() => hasStoredAdminToken());
  const clerkRole = (user?.publicMetadata as { role?: string } | undefined)?.role;
  const isAdmin = isTokenAdmin || (clerkLoaded && clerkRole === 'platform_admin');

  const [search, setSearch] = useState('');
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickLoading, setPickLoading] = useState(false);

  // Redirect non-admins to the spectator view.
  // If no sessionStorage token, wait for Clerk to finish loading before deciding.
  useEffect(() => {
    if (isTokenAdmin) return; // sessionStorage token confirms admin — no redirect
    if (!clerkLoaded) return; // Clerk not yet resolved — wait
    if (!isAdmin) {
      window.location.replace(`/league/${slug}/draft/board`);
    }
  }, [isTokenAdmin, clerkLoaded, isAdmin, slug]);

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
    if (!isAdmin) return;
    const id = setInterval(() => void refresh(), 1000);
    return () => clearInterval(id);
  }, [isAdmin, refresh]);

  // Ref to prevent duplicate expire dispatches for the same pick
  const expireDispatchedRef = useRef(false);

  // Reset the guard whenever a new pick timer starts (timerExpiresAt changes)
  useEffect(() => {
    expireDispatchedRef.current = false;
  }, [draft.timerExpiresAt]);

  // Dispatch timerAction: expire to server when the countdown reaches zero
  useEffect(() => {
    if (
      !isAdmin ||
      draft.phase !== 'live' ||
      draft.timerState !== 'running' ||
      !draft.timerExpiresAt
    ) {
      return;
    }

    const timerExpiresAt = draft.timerExpiresAt;
    const id = setInterval(() => {
      if (expireDispatchedRef.current) return;
      const remaining = new Date(timerExpiresAt).getTime() - Date.now();
      if (remaining > 0) return;

      expireDispatchedRef.current = true;
      void (async () => {
        try {
          const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
          const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', ...authHeaders },
            body: JSON.stringify({ timerAction: 'expire' }),
          });
          if (res.ok) {
            const data = (await res.json()) as { draft?: DraftState };
            if (data.draft) {
              if (data.draft.phase === 'setup') {
                window.location.href = `/league/${slug}/draft/setup`;
                return;
              }
              setDraft(data.draft);
            }
          }
        } catch {
          // Network error — reset guard so the next tick can retry
          expireDispatchedRef.current = false;
        }
      })();
    }, 500);

    return () => clearInterval(id);
  }, [draft.phase, draft.timerState, draft.timerExpiresAt, isAdmin, slug, year]);

  // Return nothing while redirecting non-admins to spectator view
  if (!isAdmin) return <></>;

  const pickedTeamsLower = new Set(draft.picks.map((p: DraftPick) => p.team.toLowerCase()));

  // Build lowercase teamId → color map for DraftBoardGrid completed-cell left bars.
  // Lowercase keys tolerate casing differences between the CFBD catalog (used for
  // insights) and the pick API (which resolves via the static teams catalog).
  const teamColorMap = Object.fromEntries(
    teamInsights
      .filter((t) => t.teamColor !== null)
      .map((t) => [t.teamId.toLowerCase(), t.teamColor as string])
  );

  const canPick = isAdmin && draft.phase === 'live';

  // Auto-pause at round boundaries: if the draft is live and currentPickIndex
  // sits exactly on a round boundary (i.e. the previous pick completed a round),
  // pause the draft so the commissioner must explicitly start the next round.
  const autoPauseRef = useRef<number | null>(null);

  const maybeAutoPauseForRound = useCallback(async (d: DraftState) => {
    const n = d.owners.length;
    const idx = d.currentPickIndex;
    const totalPicks = d.settings.totalRounds * n;
    const atRoundBoundary = idx > 0 && idx % n === 0 && idx < totalPicks;
    if (!atRoundBoundary || d.phase !== 'live') return d;
    if (autoPauseRef.current === idx) return d; // already paused for this boundary
    autoPauseRef.current = idx;
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const body: Record<string, unknown> = { phase: 'paused' };
      if (d.settings.pickTimerSeconds) body.timerAction = 'pause';
      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = (await res.json()) as { draft?: DraftState };
        if (data.draft) return data.draft;
      }
    } catch { /* non-fatal */ }
    return d;
  }, [slug, year]);

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
      // Auto-pause at round boundary
      const finalDraft = await maybeAutoPauseForRound(data.draft);
      setDraft(finalDraft);
    } catch (err) {
      setPickError((err as Error).message);
    } finally {
      setPickLoading(false);
    }
  }

  // F4: exclude already-drafted teams from the available panel entirely
  const availableInsights = teamInsights
    .filter((t) => !pickedTeamsLower.has(t.teamId.toLowerCase()))
    .filter((t) =>
      search
        ? t.teamName.toLowerCase().includes(search.toLowerCase()) ||
          t.teamId.toLowerCase().includes(search.toLowerCase())
        : true
    );

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_210px]">
        {/* Left column: board + controls */}
        <div className="space-y-0">
          <PickNavigator draft={draft} />

          {draft.settings.pickTimerSeconds && (
            <div className="border-t border-gray-200 pt-3 mt-3 dark:border-zinc-700">
              <TimerDisplay draft={draft} />
            </div>
          )}

          {isAdmin && (
            <div className="border-t border-gray-200 pt-3 mt-3 dark:border-zinc-700">
              <DraftControls
                slug={slug}
                year={year}
                draft={draft}
                onUpdate={(updated) => {
                  if (updated.phase === 'setup') {
                    window.location.href = `/league/${slug}/draft/setup`;
                    return;
                  }
                  setDraft(updated);
                }}
              />
            </div>
          )}

          <div className="border-t border-gray-200 pt-4 mt-4 dark:border-zinc-700">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.15em] text-gray-600 border-b border-gray-200 pb-1.5 dark:text-zinc-300 dark:border-zinc-700">
              Draft Board
            </h2>
            <DraftBoardGrid draft={draft} teamColorMap={teamColorMap} />
          </div>
        </div>

        {/* Right column: available teams */}
        <aside className="rounded-lg border border-gray-100 bg-gray-50/40 p-3 dark:border-zinc-800 dark:bg-zinc-800/30">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.15em] text-gray-600 border-b border-gray-200 pb-1.5 dark:text-zinc-300 dark:border-zinc-700">
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
            {availableInsights.map((insights) => (
              <DraftCard
                key={insights.teamId}
                insights={insights}
                isDrafted={false}
                onSelect={
                  canPick && !pickLoading
                    ? () => void handlePick(insights.teamId)
                    : undefined
                }
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
