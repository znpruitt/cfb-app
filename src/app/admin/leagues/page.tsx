'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminAuthPanel from 'components/AdminAuthPanel';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { PublicLeague } from '@/lib/league';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * PLATFORM-086F2I — the old copy said "Enter your token in the Auth panel
 * above", but nothing on the page is labelled "Auth panel": `AdminAuthPanel`
 * renders a `<details>` disclosure whose summary reads "Admin access token", so
 * an operator was told to find something that is not there. Named for what
 * actually renders, and defined once instead of three times.
 */
const NO_TOKEN_MESSAGE =
  'No admin token set. Open "Admin access token" above and paste your token.';

const inputClass =
  'w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100';
const controlButtonClass =
  'px-3 py-2 rounded border border-gray-300 bg-white text-sm text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60';
const secondaryButtonClass =
  'px-3 py-2 rounded border border-gray-200 bg-gray-50 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800';
const destructiveButtonClass =
  'px-3 py-2 rounded border border-red-300 bg-white text-sm text-red-700 transition-colors hover:bg-red-50 hover:border-red-400 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950/40';

/**
 * PLATFORM-086F2I — display-name editing moved OUT of this page.
 *
 * League configuration (display name, founded year, password) belongs to
 * `/admin/[slug]/settings`; this page is the REGISTRY surface — create, list,
 * delete. The inline editor here was the only overlap between the two, and it
 * duplicated a field settings already owns. `PATCH /api/admin/leagues/[slug]`
 * is unchanged and still serves the settings page.
 */

type DeleteState = {
  /** The slug the operator has typed to confirm. Empty until they start. */
  confirmation: string;
  error: string | null;
  deleting: boolean;
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

  const [deleteMap, setDeleteMap] = useState<Record<string, DeleteState>>({});

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

  function armDelete(league: PublicLeague) {
    setDeleteMap((prev) => ({
      ...prev,
      [league.slug]: { confirmation: '', error: null, deleting: false },
    }));
  }

  function cancelDelete(slug: string) {
    setDeleteMap((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
  }

  async function handleDelete(league: PublicLeague) {
    const state = deleteMap[league.slug];
    if (!state) return;

    // Guarded here for feedback, and AGAIN in the route — the route is the
    // authority. A static `ADMIN_API_TOKEN` can call the endpoint directly and
    // never see this form, so a browser-only check would protect nobody.
    if (state.confirmation.trim() !== league.slug) {
      setDeleteMap((prev) => ({
        ...prev,
        [league.slug]: {
          ...prev[league.slug]!,
          error: `Type ${league.slug} exactly to confirm.`,
        },
      }));
      return;
    }

    let authHeaders: Record<string, string>;
    try {
      authHeaders = requireAdminAuthHeaders() as Record<string, string>;
    } catch {
      setDeleteMap((prev) => ({
        ...prev,
        [league.slug]: { ...prev[league.slug]!, error: NO_TOKEN_MESSAGE },
      }));
      return;
    }

    setDeleteMap((prev) => ({
      ...prev,
      [league.slug]: { ...prev[league.slug]!, deleting: true, error: null },
    }));
    try {
      const res = await fetch(
        `/api/admin/leagues/${encodeURIComponent(league.slug)}?confirm=${encodeURIComponent(
          league.slug
        )}`,
        { method: 'DELETE', headers: authHeaders }
      );
      if (!res.ok) {
        const text = await res.text();
        setDeleteMap((prev) => ({
          ...prev,
          [league.slug]: {
            ...prev[league.slug]!,
            deleting: false,
            error: text || `DELETE ${res.status}`,
          },
        }));
        return;
      }
      const data = (await res.json()) as { leagues: PublicLeague[] };
      setLeagues(data.leagues);
      cancelDelete(league.slug);
    } catch (err) {
      setDeleteMap((prev) => ({
        ...prev,
        [league.slug]: {
          ...prev[league.slug]!,
          deleting: false,
          error: (err as Error).message,
        },
      }));
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
      setCreateError(NO_TOKEN_MESSAGE);
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

  return (
    <div className="space-y-5 bg-white p-4 text-gray-900 sm:p-6 dark:bg-zinc-950 dark:text-zinc-100">
      <Breadcrumbs
        segments={[
          { label: 'Home', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: 'League Management' },
        ]}
      />

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
              const pending = deleteMap[league.slug];
              return (
                <div key={league.slug} className="py-3 first:pt-0 last:pb-0">
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
                      {/* Configuration lives on the league's own settings page —
                          this surface creates, lists, and deletes. */}
                      <Link
                        href={`/admin/${league.slug}/settings`}
                        className={secondaryButtonClass}
                      >
                        Settings
                      </Link>
                      {!pending && (
                        <button
                          className={destructiveButtonClass}
                          onClick={() => armDelete(league)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {pending && (
                    <div className="mt-3 space-y-2 rounded border border-red-300 bg-red-50/60 p-3 dark:border-red-800 dark:bg-red-950/20">
                      <p className="text-xs text-red-800 dark:text-red-300">
                        This removes <span className="font-mono">{league.slug}</span> from the
                        registry. Its stored data — owners, drafts, archives, overrides — is{' '}
                        <strong>not</strong> deleted, and this cannot be undone.
                      </p>
                      <label
                        className="block text-xs text-gray-600 dark:text-zinc-400"
                        htmlFor={`confirm-delete-${league.slug}`}
                      >
                        Type <span className="font-mono">{league.slug}</span> to confirm
                      </label>
                      <input
                        id={`confirm-delete-${league.slug}`}
                        aria-label={`Type ${league.slug} to confirm deletion`}
                        className={inputClass}
                        value={pending.confirmation}
                        autoComplete="off"
                        onChange={(e) =>
                          setDeleteMap((prev) => ({
                            ...prev,
                            [league.slug]: {
                              ...prev[league.slug]!,
                              confirmation: e.target.value,
                              error: null,
                            },
                          }))
                        }
                      />
                      {pending.error && (
                        <p className="text-xs text-red-700 dark:text-red-400">{pending.error}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={destructiveButtonClass}
                          onClick={() => void handleDelete(league)}
                          /* The typed slug — not a fixed word — because a fixed
                             word is identical on every row and would not catch
                             acting on the WRONG league. */
                          disabled={pending.deleting || pending.confirmation.trim() !== league.slug}
                        >
                          {pending.deleting ? 'Deleting…' : `Delete ${league.slug}`}
                        </button>
                        <button
                          className={secondaryButtonClass}
                          onClick={() => cancelDelete(league.slug)}
                          disabled={pending.deleting}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
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
