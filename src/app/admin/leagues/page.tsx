'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminAuthPanel from 'components/AdminAuthPanel';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { PublicLeague } from '@/lib/league';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const inputClass =
  'w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100';
const controlButtonClass =
  'px-3 py-2 rounded border border-gray-300 bg-white text-sm text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60';
const secondaryButtonClass =
  'px-3 py-2 rounded border border-gray-200 bg-gray-50 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800';
const destructiveButtonClass =
  'px-3 py-2 rounded border border-red-300 bg-white text-sm text-red-700 transition-colors hover:bg-red-50 hover:border-red-400 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950/40';

type EditState = {
  displayName: string;
  year: string;
  error: string | null;
  saving: boolean;
};

export default function AdminLeaguesPage() {
  const router = useRouter();
  const [leagues, setLeagues] = useState<PublicLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editMap, setEditMap] = useState<Record<string, EditState>>({});
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void fetchLeagues();
  }, []);

  async function fetchLeagues() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/admin/leagues', {
        cache: 'no-store',
        headers: { ...requireAdminAuthHeaders() },
      });
      if (!res.ok) throw new Error(`GET /api/admin/leagues ${res.status}`);
      const data = (await res.json()) as { leagues: PublicLeague[] };
      setLeagues(data.leagues);
    } catch (err) {
      setFetchError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(league: PublicLeague) {
    setEditMap((prev) => ({
      ...prev,
      [league.slug]: {
        displayName: league.displayName,
        year: String(league.year),
        error: null,
        saving: false,
      },
    }));
  }

  function cancelEdit(slug: string) {
    setEditMap((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
  }

  async function handleDelete(league: PublicLeague) {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${league.displayName}"? This removes the league from the registry but does not delete its stored data (owners, aliases, overrides). This cannot be undone.`
    );
    if (!confirmed) return;

    let authHeaders: Record<string, string>;
    try {
      authHeaders = requireAdminAuthHeaders() as Record<string, string>;
    } catch {
      setDeleteErrors((prev) => ({
        ...prev,
        [league.slug]: 'No admin token set. Enter your token in the Auth panel above.',
      }));
      return;
    }

    setDeleting((prev) => ({ ...prev, [league.slug]: true }));
    setDeleteErrors((prev) => {
      const next = { ...prev };
      delete next[league.slug];
      return next;
    });
    try {
      const res = await fetch(`/api/admin/leagues/${encodeURIComponent(league.slug)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!res.ok) {
        const text = await res.text();
        setDeleteErrors((prev) => ({
          ...prev,
          [league.slug]: text || `DELETE ${res.status}`,
        }));
        return;
      }
      const data = (await res.json()) as { leagues: PublicLeague[] };
      setLeagues(data.leagues);
    } catch (err) {
      setDeleteErrors((prev) => ({ ...prev, [league.slug]: (err as Error).message }));
    } finally {
      setDeleting((prev) => ({ ...prev, [league.slug]: false }));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);

    const trimmedSlug = slug.trim();
    const trimmedName = displayName.trim();
    const yearNum = Number(year);

    if (!trimmedSlug) {
      setCreateError('Slug is required.');
      return;
    }
    if (!SLUG_PATTERN.test(trimmedSlug)) {
      setCreateError(
        'Slug must be lowercase alphanumeric words separated by hyphens (e.g. tsc, work-league).'
      );
      return;
    }
    if (!trimmedName) {
      setCreateError('Display name is required.');
      return;
    }
    if (!Number.isFinite(yearNum) || yearNum < 2000) {
      setCreateError('Year must be a valid season year (2000 or later).');
      return;
    }

    let authHeaders: Record<string, string>;
    try {
      authHeaders = requireAdminAuthHeaders() as Record<string, string>;
    } catch {
      setCreateError('No admin token set. Enter your token in the Auth panel above.');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/admin/leagues', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ slug: trimmedSlug, displayName: trimmedName, year: yearNum }),
      });
      if (!res.ok) {
        const text = await res.text();
        setCreateError(text || `POST /api/admin/leagues ${res.status}`);
        return;
      }
      router.push(`/admin/${trimmedSlug}`);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(leagueSlug: string) {
    const state = editMap[leagueSlug];
    if (!state) return;

    const trimmedName = state.displayName.trim();
    const yearNum = Number(state.year);

    if (!trimmedName) {
      setEditMap((prev) => ({
        ...prev,
        [leagueSlug]: { ...prev[leagueSlug], error: 'Display name is required.' },
      }));
      return;
    }
    if (!Number.isFinite(yearNum) || yearNum < 2000) {
      setEditMap((prev) => ({
        ...prev,
        [leagueSlug]: { ...prev[leagueSlug], error: 'Year must be a valid season year.' },
      }));
      return;
    }

    let authHeaders: Record<string, string>;
    try {
      authHeaders = requireAdminAuthHeaders() as Record<string, string>;
    } catch {
      setEditMap((prev) => ({
        ...prev,
        [leagueSlug]: {
          ...prev[leagueSlug],
          error: 'No admin token set. Enter your token in the Auth panel above.',
        },
      }));
      return;
    }

    setEditMap((prev) => ({
      ...prev,
      [leagueSlug]: { ...prev[leagueSlug], saving: true, error: null },
    }));
    try {
      const res = await fetch(`/api/admin/leagues/${encodeURIComponent(leagueSlug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ displayName: trimmedName, year: yearNum }),
      });
      if (!res.ok) {
        const text = await res.text();
        setEditMap((prev) => ({
          ...prev,
          [leagueSlug]: {
            ...prev[leagueSlug],
            saving: false,
            error: text || `PATCH ${res.status}`,
          },
        }));
        return;
      }
      const data = (await res.json()) as { league: PublicLeague };
      setLeagues((prev) => prev.map((l) => (l.slug === leagueSlug ? data.league : l)));
      cancelEdit(leagueSlug);
    } catch (err) {
      setEditMap((prev) => ({
        ...prev,
        [leagueSlug]: { ...prev[leagueSlug], saving: false, error: (err as Error).message },
      }));
    }
  }

  return (
    <div className="space-y-5 bg-white p-4 text-gray-900 sm:p-6 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="flex items-center gap-3">
        <Link href="/admin" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          ← Admin
        </Link>
        <span className="text-gray-400 dark:text-zinc-600">/</span>
        <span className="text-sm font-medium">League Management</span>
      </div>

      <div className="rounded-2xl border border-gray-300 bg-gray-50/80 p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/60">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-400">
            Admin
          </p>
          <h2 className="text-xl font-semibold text-gray-950 dark:text-zinc-50">
            League Management
          </h2>
          <p className="max-w-2xl text-sm text-gray-600 dark:text-zinc-300">
            Set up and manage your leagues. Each league gets its own URL, a display name, and an
            active season year. Once created, a league&apos;s URL cannot be changed.
          </p>
        </div>
      </div>

      <AdminAuthPanel />

      <div className="rounded-2xl border border-gray-300 bg-gray-50/80 p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/60 space-y-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-50">Leagues</h3>

        {loading && <p className="text-sm text-gray-500 dark:text-zinc-400">Loading…</p>}
        {fetchError && (
          <p className="text-sm text-red-700 dark:text-red-400">Failed to load: {fetchError}</p>
        )}

        {!loading && !fetchError && leagues.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            No leagues configured yet. Use the form below to create your first league. For example:
            league URL — <span className="font-mono">work-league</span>, display name —{' '}
            <span className="font-mono">Work League</span>, year —{' '}
            <span className="font-mono">2025</span>.
          </p>
        )}

        {leagues.length > 0 && (
          <div className="divide-y divide-gray-200 dark:divide-zinc-700">
            {leagues.map((league) => {
              const editing = editMap[league.slug];
              return (
                <div key={league.slug} className="py-3 first:pt-0 last:pb-0">
                  {editing ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono text-gray-500 dark:text-zinc-400">
                          {league.slug}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-zinc-500">
                          (URL — permanent)
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500 dark:text-zinc-400">
                            Display name
                          </label>
                          <input
                            className={inputClass}
                            value={editing.displayName}
                            onChange={(e) =>
                              setEditMap((prev) => ({
                                ...prev,
                                [league.slug]: {
                                  ...prev[league.slug],
                                  displayName: e.target.value,
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500 dark:text-zinc-400">Year</label>
                          <input
                            className={inputClass}
                            type="number"
                            value={editing.year}
                            onChange={(e) =>
                              setEditMap((prev) => ({
                                ...prev,
                                [league.slug]: { ...prev[league.slug], year: e.target.value },
                              }))
                            }
                          />
                        </div>
                      </div>
                      {editing.error && (
                        <p className="text-xs text-red-700 dark:text-red-400">{editing.error}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          className={controlButtonClass}
                          onClick={() => void handleSaveEdit(league.slug)}
                          disabled={editing.saving}
                        >
                          {editing.saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          className={secondaryButtonClass}
                          onClick={() => cancelEdit(league.slug)}
                          disabled={editing.saving}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                            {league.displayName}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-zinc-400">
                            <span className="font-mono">{league.slug}</span>
                            {' · '}
                            {league.year}
                            {' · '}
                            <Link
                              href={`/league/${league.slug}`}
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              /league/{league.slug}
                            </Link>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            className={secondaryButtonClass}
                            onClick={() => startEdit(league)}
                          >
                            Edit
                          </button>
                          <button
                            className={destructiveButtonClass}
                            onClick={() => void handleDelete(league)}
                            disabled={deleting[league.slug]}
                          >
                            {deleting[league.slug] ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                      {deleteErrors[league.slug] && (
                        <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                          {deleteErrors[league.slug]}
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-300 bg-gray-50/80 p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/60 space-y-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-50">Create league</h3>
        <form onSubmit={(e) => void handleCreate(e)} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-500 dark:text-zinc-400">League URL</label>
              <input
                className={inputClass}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="my-league"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-gray-400 dark:text-zinc-500">
                Becomes part of your league&apos;s web address:{' '}
                <span className="font-mono">/league/your-url/</span>. Permanent — cannot be changed
                after creation.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500 dark:text-zinc-400">Display name</label>
              <input
                className={inputClass}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My Fantasy League"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500 dark:text-zinc-400">Year</label>
              <input
                className={inputClass}
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder={String(new Date().getFullYear())}
              />
            </div>
          </div>
          {createError && <p className="text-xs text-red-700 dark:text-red-400">{createError}</p>}
          <button type="submit" className={controlButtonClass} disabled={creating}>
            {creating ? 'Creating…' : 'Create league'}
          </button>
        </form>
      </div>
    </div>
  );
}
