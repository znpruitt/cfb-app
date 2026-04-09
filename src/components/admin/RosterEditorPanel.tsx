'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { getAdminAuthHeaders } from '@/lib/adminAuth';

type TeamEntry = { school: string; conference: string };

type Props = {
  slug: string;
  year: number;
  teams: TeamEntry[];
};

type SortKey = 'school' | 'conference';
type SortDir = 'asc' | 'desc';

function csvField(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Parse a single RFC 4180 row into fields. */
function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= row.length) {
    if (row[i] === '"') {
      // Quoted field — consume until closing unescaped quote
      i++; // skip opening quote
      let field = '';
      while (i < row.length) {
        if (row[i] === '"') {
          if (row[i + 1] === '"') {
            // Escaped quote
            field += '"';
            i += 2;
          } else {
            // Closing quote
            i++;
            break;
          }
        } else {
          field += row[i];
          i++;
        }
      }
      fields.push(field);
      if (row[i] === ',') i++; // skip comma separator
    } else {
      // Unquoted field — read until next comma or end of string
      const end = row.indexOf(',', i);
      if (end === -1) {
        fields.push(row.slice(i).trim());
        break;
      } else {
        fields.push(row.slice(i, end).trim());
        i = end + 1;
      }
    }
  }
  return fields;
}

function parseCsv(csvText: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!csvText) return map;
  const lines = csvText.split('\n').slice(1); // skip header
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = parseCsvRow(line);
    const team = fields[0] ?? '';
    const owner = fields[1] ?? '';
    if (team) map.set(team, owner);
  }
  return map;
}

function buildCsv(teams: TeamEntry[], owners: Map<string, string>): string {
  const rows = teams
    .filter((t) => owners.get(t.school))
    .map((t) => `${csvField(t.school)},${csvField(owners.get(t.school) ?? '')}`);
  return ['Team,Owner', ...rows].join('\n');
}

function mapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

export default function RosterEditorPanel({ slug, year, teams }: Props): React.ReactElement {
  const [savedOwners, setSavedOwners] = useState<Map<string, string>>(new Map());
  const [draftOwners, setDraftOwners] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('school');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [bulkFrom, setBulkFrom] = useState('');
  const [bulkTo, setBulkTo] = useState('');

  const hasChanges = !mapsEqual(draftOwners, savedOwners);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/owners?league=${encodeURIComponent(slug)}&year=${year}`,
        { cache: 'no-store' }
      );
      if (!res.ok) throw new Error(`GET /api/owners ${res.status}`);
      const data = (await res.json()) as { csvText: string | null };
      const parsed = parseCsv(data.csvText);
      setSavedOwners(parsed);
      setDraftOwners(new Map(parsed));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load roster');
    } finally {
      setLoading(false);
    }
  }, [slug, year]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  function handleOwnerChange(school: string, value: string) {
    setSaveSuccess(false);
    setDraftOwners((prev) => {
      const next = new Map(prev);
      next.set(school, value);
      return next;
    });
  }

  function handleDiscard() {
    setDraftOwners(new Map(savedOwners));
    setSaveError(null);
    setSaveSuccess(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const csvText = buildCsv(teams, draftOwners);
      const res = await fetch(
        `/api/owners?league=${encodeURIComponent(slug)}&year=${year}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', ...getAdminAuthHeaders() },
          body: JSON.stringify({ csvText }),
        }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { detail?: string; error?: string }
          | null;
        setSaveError(data?.detail ?? data?.error ?? `Save failed (${res.status})`);
        return;
      }
      const updated = (await res.json()) as { csvText: string | null };
      const parsed = parseCsv(updated.csvText);
      setSavedOwners(parsed);
      setDraftOwners(new Map(parsed));
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSaving(false);
    }
  }

  function handleBulkReassign() {
    const from = bulkFrom.trim();
    const to = bulkTo.trim();
    if (!from) return;
    setSaveSuccess(false);
    setDraftOwners((prev) => {
      const next = new Map(prev);
      for (const [school, owner] of next) {
        if (owner === from) next.set(school, to);
      }
      return next;
    });
    setBulkFrom('');
    setBulkTo('');
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const filtered = teams
    .filter((t) => t.school.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = sortKey === 'school' ? a.school : a.conference;
      const bv = sortKey === 'school' ? b.school : b.conference;
      const cmp = av.localeCompare(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      <span className="ml-1 text-gray-500 dark:text-zinc-400">{sortDir === 'asc' ? '▲' : '▼'}</span>
    ) : (
      <span className="ml-1 text-gray-200 dark:text-zinc-700">⇅</span>
    );

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5">
        <p className="text-sm text-gray-500 dark:text-zinc-400">Loading roster…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-3">
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        <button
          onClick={() => void loadRoster()}
          className="rounded border border-gray-300 dark:border-zinc-600 bg-gray-50 dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 hover:bg-gray-100 dark:hover:bg-zinc-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-5">

      {/* ---- Toolbar ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="rounded bg-amber-50 dark:bg-amber-900/40 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400 border border-amber-300/40 dark:border-amber-700/40">
              Unsaved changes
            </span>
          )}
          {saveSuccess && !hasChanges && (
            <span className="text-sm text-green-600 dark:text-green-400">Saved successfully</span>
          )}
          {saveError && (
            <span className="text-sm text-red-600 dark:text-red-400">{saveError}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDiscard}
            disabled={!hasChanges || saving}
            className="rounded border border-gray-300 dark:border-zinc-600 bg-gray-50 dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Discard Changes
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!hasChanges || saving}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-gray-900 dark:text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* ---- Search ---- */}
      <input
        type="text"
        placeholder="Search teams…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-xs rounded border border-gray-300 dark:border-zinc-600 bg-gray-50 dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500"
      />

      {/* ---- Table ---- */}
      <div className="overflow-x-auto rounded border border-gray-200 dark:border-zinc-700">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-zinc-800 text-xs text-gray-500 dark:text-zinc-400">
            <tr>
              <th
                className="px-4 py-2.5 text-left cursor-pointer select-none hover:text-gray-800 dark:hover:text-zinc-200"
                onClick={() => toggleSort('school')}
              >
                Team <SortIcon col="school" />
              </th>
              <th
                className="px-4 py-2.5 text-left cursor-pointer select-none hover:text-gray-800 dark:hover:text-zinc-200"
                onClick={() => toggleSort('conference')}
              >
                Conference <SortIcon col="conference" />
              </th>
              <th className="px-4 py-2.5 text-left">Owner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-zinc-800">
            {filtered.map((team) => {
              const owner = draftOwners.get(team.school) ?? '';
              const saved = savedOwners.get(team.school) ?? '';
              const dirty = owner !== saved;
              return (
                <tr key={team.school} className={dirty ? 'bg-amber-50 dark:bg-amber-950/20' : 'hover:bg-gray-50/50 dark:hover:bg-zinc-800/50'}>
                  <td className="px-4 py-2 text-gray-900 dark:text-zinc-100 whitespace-nowrap">{team.school}</td>
                  <td className="px-4 py-2 text-gray-500 dark:text-zinc-400 whitespace-nowrap">{team.conference}</td>
                  <td className="px-4 py-1.5">
                    <input
                      type="text"
                      value={owner}
                      onChange={(e) => handleOwnerChange(team.school, e.target.value)}
                      className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600 hover:border-gray-300 dark:hover:border-zinc-600 focus:border-zinc-500 focus:bg-gray-50 dark:focus:bg-zinc-800 focus:outline-none"
                      placeholder="—"
                    />
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-center text-sm text-gray-400 dark:text-zinc-500">
                  No teams match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---- Bulk Reassign ---- */}
      <div className="rounded border border-gray-200 dark:border-zinc-700 bg-gray-50/40 dark:bg-zinc-800/40 p-4 space-y-3">
        <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">Bulk Reassign</h3>
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          Move all teams from one owner to another. Updates local state only — click Save Changes to persist.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 dark:text-zinc-400">From owner</label>
            <input
              type="text"
              value={bulkFrom}
              onChange={(e) => setBulkFrom(e.target.value)}
              placeholder="Current owner name"
              className="rounded border border-gray-300 dark:border-zinc-600 bg-gray-50 dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 dark:text-zinc-400">To owner</label>
            <input
              type="text"
              value={bulkTo}
              onChange={(e) => setBulkTo(e.target.value)}
              placeholder="New owner name (blank to unassign)"
              className="w-56 rounded border border-gray-300 dark:border-zinc-600 bg-gray-50 dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500"
            />
          </div>
          <button
            onClick={handleBulkReassign}
            disabled={!bulkFrom.trim()}
            className="rounded border border-gray-300 dark:border-zinc-600 bg-gray-100 dark:bg-zinc-700 px-4 py-1.5 text-sm text-gray-900 dark:text-zinc-100 hover:bg-gray-200 dark:hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reassign all teams
          </button>
        </div>
      </div>
    </div>
  );
}
