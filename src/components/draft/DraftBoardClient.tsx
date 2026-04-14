'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { hasStoredAdminToken, requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { DraftState, DraftPick } from '@/lib/draft';
import type { LeagueStatus } from '@/lib/league';
import type { DraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import DraftBoardGrid from './DraftBoardGrid';
import DraftHeaderArea from './DraftHeaderArea';

type DraftBoardClientProps = {
  slug: string;
  year: number;
  initialDraft: DraftState;
  teamInsights: DraftTeamInsights[];
  leagueStatus?: LeagueStatus;
};

export default function DraftBoardClient({
  slug,
  year,
  initialDraft,
  teamInsights,
  leagueStatus,
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
  const [controlsLoading, setControlsLoading] = useState(false);

  // Local timer start: set to Date.now() right before the pick POST fires so
  // DraftHeaderArea can begin counting down immediately without waiting for the
  // server round-trip. Cleared when the server response arrives. Stored as a
  // ref so mutations don't trigger re-renders and won't restart the timer effect.
  const localTimerStartRef = useRef<number | null>(null);

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

  // Round-boundary auto-pause is now handled server-side in the pick response,
  // so no client-side second round-trip is needed.

  // Return nothing while redirecting non-admins to spectator view.
  // Placed after all hooks so Rules of Hooks are satisfied.
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

  const teamShortNameMap = Object.fromEntries(
    teamInsights.map((t) => [t.teamId.toLowerCase(), t.shortName])
  );

  // Detect round-boundary pause: paused, at a round boundary, timer not expired
  const n = draft.owners.length;
  const totalPicks = draft.settings.totalRounds * n;
  const isRoundBoundaryPause =
    draft.phase === 'paused' &&
    draft.currentPickIndex > 0 &&
    draft.currentPickIndex % n === 0 &&
    draft.currentPickIndex < totalPicks &&
    draft.timerState !== 'expired';

  const canPick = isAdmin && (draft.phase === 'live' || isRoundBoundaryPause);

  async function handlePick(teamId: string) {
    if (!canPick) return;
    setPickError(null);
    setPickLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;

      // If paused at a round boundary, resume to live first (API requires phase === 'live')
      if (isRoundBoundaryPause) {
        const body: Record<string, unknown> = { phase: 'live' };
        if (draft.settings.pickTimerSeconds) body.timerAction = 'start';
        const resumeRes = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', ...authHeaders },
          body: JSON.stringify(body),
        });
        if (!resumeRes.ok) {
          const data = (await resumeRes.json()) as { error?: string };
          setPickError(data.error ?? `Failed to start round (${resumeRes.status})`);
          return;
        }
      }

      // Start local countdown immediately — DraftHeaderArea reads this ref each
      // interval tick to show the timer without waiting for the server round-trip.
      if (draft.settings.pickTimerSeconds) {
        localTimerStartRef.current = Date.now();
      }

      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}/pick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ team: teamId }),
      });
      const data = (await res.json()) as { draft?: DraftState; error?: string };
      if (!res.ok || !data.draft) {
        localTimerStartRef.current = null;
        setPickError(data.error ?? `Pick failed (${res.status})`);
        return;
      }
      // Server response arrived — hand off to server-authoritative timerExpiresAt.
      localTimerStartRef.current = null;
      setDraft(data.draft);
    } catch (err) {
      localTimerStartRef.current = null;
      setPickError((err as Error).message);
    } finally {
      setPickLoading(false);
    }
  }

  // F4: exclude already-drafted teams from the available panel entirely
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

  // --- Draft control helpers (admin-only, used by DraftHeaderArea) ---

  async function draftPut(body: Record<string, unknown>) {
    setControlsLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { draft?: DraftState };
      if (res.ok && data.draft) {
        if (data.draft.phase === 'setup') {
          window.location.href = `/league/${slug}/draft/setup`;
          return;
        }
        setDraft(data.draft);
      }
    } catch { /* network error — polling will recover */ }
    finally { setControlsLoading(false); }
  }

  async function draftPost(path: string) {
    setControlsLoading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: '{}',
      });
      const data = (await res.json()) as { draft?: DraftState };
      if (res.ok && data.draft) {
        if (data.draft.phase === 'setup') {
          window.location.href = `/league/${slug}/draft/setup`;
          return;
        }
        setDraft(data.draft);
      }
    } catch { /* network error — polling will recover */ }
    finally { setControlsLoading(false); }
  }

  function handlePause() { void draftPut({ timerAction: 'pause' }); }

  function handleResume() {
    if (draft.phase === 'paused') {
      const body: Record<string, unknown> = { phase: 'live' };
      if (draft.settings.pickTimerSeconds) body.timerAction = 'start';
      void draftPut(body);
    } else if (draft.timerState === 'paused') {
      void draftPut({ timerAction: 'resume' });
    } else if (draft.timerState === 'off' && draft.settings.pickTimerSeconds) {
      void draftPut({ timerAction: 'start' });
    }
  }

  function handleUndo() { void draftPost('unpick'); }
  function handleAutoPick() { void draftPut({ timerAction: 'expire' }); }
  function handleSelectManually() { void draftPut({ phase: 'live' }); }

  function handleStartRound() {
    const body: Record<string, unknown> = { phase: 'live' };
    if (draft.settings.pickTimerSeconds) body.timerAction = 'start';
    void draftPut(body);
  }

  return (
    <div style={{ height: 'calc(100dvh - 10rem)', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: '100%' }}>
      {/* TOP — fixed header area (cards, controls, banners) */}
      <div style={{ flexShrink: 0 }}>
        <DraftHeaderArea
          draft={draft}
          isAdmin={isAdmin}
          slug={slug}
          leagueStatus={leagueStatus}
          localTimerStartRef={localTimerStartRef}
          onPause={handlePause}
          onResume={handleResume}
          onUndo={handleUndo}
          onAutoPick={handleAutoPick}
          onSelectManually={handleSelectManually}
          onStartRound={handleStartRound}
          settingsHref={`/league/${slug}/draft/setup`}
          summaryHref={`/league/${slug}/draft/summary`}
          controlsLoading={controlsLoading}
        />
      </div>

      {/* MIDDLE — table scrolls both axes within remaining space */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', marginTop: 12, width: '100%' }}>
        <DraftBoardGrid draft={draft} teamColorMap={teamColorMap} teamShortNameMap={teamShortNameMap} />
      </div>

      {/* BOTTOM — Available Teams strip, fixed at bottom */}
      <div style={{ flexShrink: 0, borderTop: '0.5px solid #1f2937', paddingTop: 8, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b7280' }}>
            Available Teams
          </span>
          <input
            type="search"
            placeholder="Search by Team or Conference"
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
        {pickError && (
          <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 6 }}>{pickError}</p>
        )}
        <div
          className="draft-chip-scroll"
          style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}
        >
          {availableInsights.map((t) => {
            const barColor = t.teamColor ?? '#94a3b8';
            const clickable = canPick && !pickLoading;
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
                  cursor: clickable ? 'pointer' : 'default',
                }}
                onMouseEnter={clickable ? (e) => { e.currentTarget.style.borderColor = '#4b5563'; } : undefined}
                onMouseLeave={clickable ? (e) => { e.currentTarget.style.borderColor = '#374151'; } : undefined}
                onClick={clickable ? () => void handlePick(t.teamId) : undefined}
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
