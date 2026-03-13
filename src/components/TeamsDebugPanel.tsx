// src/components/TeamsDebugPanel.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';

type TeamItem = {
  school: string;
  mascot?: string | null;
  conference?: string | null;
  level?: 'FBS' | 'FCS' | 'D2' | 'D3' | 'NAIA' | 'Other' | string | null;
  subdivision?: 'FBS' | 'FCS' | 'D2' | 'D3' | 'NAIA' | 'Other' | string | null;
  alts?: string[];
};

type TeamsResponse = {
  year: number;
  count?: number;
  items: TeamItem[];
};

type AliasMap = Record<string, string>;

function levelOf(t: TeamItem): string {
  // Prefer explicit level, then subdivision, then "Other"
  return t.level ?? t.subdivision ?? 'Other';
}

function normKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(university|univ|the|of|and|&)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

// Server supports only ALL|FBS|FCS; D2/D3/NAIA/Other are client-filtered
const SERVER_LEVELS = new Set(['ALL', 'FBS', 'FCS']);

export default function TeamsDebugPanel(): React.ReactElement {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [level, setLevel] = useState<string>('ALL'); // ALL | FBS | FCS | D2 | D3 | NAIA | Other
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [aliasMap, setAliasMap] = useState<AliasMap>({});
  const [query, setQuery] = useState<string>('');
  const [pendingAliasKey, setPendingAliasKey] = useState<string>('');
  const [selectedSchool, setSelectedSchool] = useState<string>(''); // canonical target
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [issues, setIssues] = useState<string[]>([]);

  // Fetch teams (server-level filter when supported; otherwise ALL + client filter)
  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setIssues([]);
      try {
        const serverLevel = SERVER_LEVELS.has(level) ? level : 'ALL';
        const resp = await fetch(`/api/teams?level=${encodeURIComponent(serverLevel)}`, {
          cache: 'no-store',
        });
        if (!resp.ok) {
          const t = await resp.text().catch(() => '');
          setIssues((p) => [...p, `Teams error ${resp.status}: ${t}`]);
          setTeams([]);
          return;
        }
        const data = (await resp.json()) as TeamsResponse;
        setTeams(data.items || []);
      } catch (err) {
        setIssues((p) => [...p, `Teams fetch failed: ${(err as Error).message}`]);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [year, level]);

  // Load aliases for the year
  useEffect(() => {
    const getAliases = async () => {
      try {
        const r = await fetch(`/api/aliases?year=${year}`, { cache: 'no-store' });
        if (r.ok) {
          const json = (await r.json()) as { year: number; map: AliasMap };
          setAliasMap(json.map || {});
        } else {
          setAliasMap({});
        }
      } catch {
        setAliasMap({});
      }
    };
    void getAliases();
  }, [year]);

  // Text search across school/mascot/conf/level
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => {
      const school = t.school.toLowerCase();
      const mascot = (t.mascot ?? '').toLowerCase();
      const conf = (t.conference ?? '').toLowerCase();
      const lev = levelOf(t).toLowerCase();
      return (
        school.includes(q) ||
        mascot.includes(q) ||
        conf.includes(q) ||
        lev.includes(q) ||
        (t.alts || []).some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [teams, query]);

  // Client-side level filtering for D2/D3/NAIA/Other
  const filtered = useMemo(() => {
    if (level === 'ALL') return searched;
    if (SERVER_LEVELS.has(level)) return searched.filter((t) => levelOf(t) === level);
    // Client-only levels
    return searched.filter((t) => levelOf(t) === level);
  }, [searched, level]);

  const existingAliasesFor = (school: string): string[] => {
    const items: string[] = [];
    for (const [alias, target] of Object.entries(aliasMap)) {
      if (target === school) items.push(alias);
    }
    items.sort((a, b) => a.localeCompare(b));
    return items;
  };

  // Add alias using new API: PUT { upserts, deletes }
  const onAddAlias = async (): Promise<void> => {
    const rawAlias = pendingAliasKey.trim();
    const school = selectedSchool.trim();
    if (!rawAlias || !school) return;

    const key = normKey(rawAlias);
    if (!key) {
      setIssues((p) => [...p, 'Alias cannot be empty after normalization.']);
      return;
    }

    setSaving(true);
    setIssues([]);
    try {
      const r = await fetch(`/api/aliases?year=${year}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ upserts: { [key]: school }, deletes: [] as string[] }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        setIssues((p) => [...p, `Save failed ${r.status}: ${t}`]);
        return;
      }
      const data = (await r.json()) as { year: number; map: AliasMap };
      setAliasMap(data.map || {});
      setPendingAliasKey('');
    } catch (err) {
      setIssues((p) => [...p, `Save failed: ${(err as Error).message}`]);
    } finally {
      setSaving(false);
    }
  };

  // Remove alias using new API: PUT { upserts:{}, deletes:[alias] }
  const onRemoveAlias = async (alias: string): Promise<void> => {
    if (!alias) return;
    setSaving(true);
    setIssues([]);
    try {
      const r = await fetch(`/api/aliases?year=${year}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ upserts: {}, deletes: [alias] }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        setIssues((p) => [...p, `Delete failed ${r.status}: ${t}`]);
        return;
      }
      const data = (await r.json()) as { year: number; map: AliasMap };
      setAliasMap(data.map || {});
    } catch (err) {
      setIssues((p) => [...p, `Delete failed: ${(err as Error).message}`]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-4 text-gray-900 bg-white dark:text-zinc-100 dark:bg-zinc-950">
      <h1 className="text-2xl font-bold">Teams Debug</h1>
      <p className="text-sm text-gray-600 dark:text-zinc-400">
        Browse team catalog and edit saved aliases. Aliases persist via <code>/api/aliases</code>{' '}
        (season-scoped).
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-sm block mb-1">Season year</label>
          <input
            type="number"
            value={year}
            onChange={(e) =>
              setYear(Number.parseInt(e.target.value || String(new Date().getFullYear()), 10))
            }
            className="border rounded px-2 py-1 bg-white text-gray-900 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
            min={2000}
            max={2100}
          />
        </div>

        <div>
          <label className="text-sm block mb-1">Level</label>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="border rounded px-2 py-1 bg-white text-gray-900 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
          >
            <option value="ALL">All</option>
            <option value="FBS">FBS</option>
            <option value="FCS">FCS</option>
            <option value="D2">D2</option>
            <option value="D3">D3</option>
            <option value="NAIA">NAIA</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div className="grow">
          <label className="text-sm block mb-1">Search</label>
          <input
            placeholder="School, mascot, conference…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full border rounded px-2 py-1 bg-white text-gray-900 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
          />
        </div>
      </div>

      {issues.length > 0 && (
        <div className="rounded border border-l-4 border-gray-300 border-l-red-600 bg-red-50 p-3 text-sm text-gray-900 dark:border-zinc-700 dark:border-l-red-400 dark:bg-red-900/25 dark:text-zinc-100">
          <div className="font-medium mb-1">Issues</div>
          <ul className="list-disc pl-5 space-y-1">
            {issues.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-700 dark:text-zinc-300">
          {loading ? 'Loading teams…' : `Showing ${filtered.length} teams`}
        </div>
        <div className="text-sm text-gray-700 dark:text-zinc-300">
          Aliases saved for {year}: {Object.keys(aliasMap).length}
        </div>
      </div>

      {/* Alias editor */}
      <div className="rounded border border-gray-300 dark:border-zinc-700">
        <div className="p-3 border-b border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900/40">
          <div className="font-medium">Add alias</div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <input
              placeholder="Alias text (e.g., 'App State')"
              value={pendingAliasKey}
              onChange={(e) => setPendingAliasKey(e.target.value)}
              className="border rounded px-2 py-1 bg-white text-gray-900 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
            />
            <select
              value={selectedSchool}
              onChange={(e) => setSelectedSchool(e.target.value)}
              className="border rounded px-2 py-1 bg-white text-gray-900 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
            >
              <option value="">Select canonical school…</option>
              {filtered.map((t) => (
                <option key={t.school} value={t.school}>
                  {t.school}
                </option>
              ))}
            </select>
            <button
              onClick={() => void onAddAlias()}
              disabled={saving || !pendingAliasKey || !selectedSchool}
              className="px-3 py-1 rounded border border-gray-300 bg-white text-gray-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              title={
                !pendingAliasKey || !selectedSchool ? 'Enter alias and pick a school' : 'Save alias'
              }
            >
              {saving ? 'Saving…' : 'Add alias'}
            </button>
          </div>
        </div>

        {/* Teams table */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 dark:bg-zinc-900/50">
              <tr>
                <th className="text-left px-3 py-2 border-b dark:border-zinc-700">School</th>
                <th className="text-left px-3 py-2 border-b dark:border-zinc-700">Mascot</th>
                <th className="text-left px-3 py-2 border-b dark:border-zinc-700">Conference</th>
                <th className="text-left px-3 py-2 border-b dark:border-zinc-700">Level</th>
                <th className="text-left px-3 py-2 border-b dark:border-zinc-700">
                  Aliases (click × to remove)
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const levelText = levelOf(t);
                const aliases = existingAliasesFor(t.school);
                return (
                  <tr
                    key={t.school}
                    className="odd:bg-white even:bg-gray-50 dark:odd:bg-zinc-900 dark:even:bg-zinc-800"
                  >
                    <td className="px-3 py-2 border-b dark:border-zinc-700 font-medium">
                      {t.school}
                    </td>
                    <td className="px-3 py-2 border-b dark:border-zinc-700">{t.mascot ?? '—'}</td>
                    <td className="px-3 py-2 border-b dark:border-zinc-700">
                      {t.conference ?? '—'}
                    </td>
                    <td className="px-3 py-2 border-b dark:border-zinc-700">{levelText}</td>
                    <td className="px-3 py-2 border-b dark:border-zinc-700">
                      {aliases.length === 0 ? (
                        <span className="text-xs text-gray-500 dark:text-zinc-400">No aliases</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {aliases.map((a) => (
                            <span
                              key={`${t.school}::${a}`}
                              className="inline-flex items-center gap-1 text-xs border rounded px-2 py-0.5 bg-white text-gray-700 border-gray-300 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600"
                            >
                              {a}
                              <button
                                className="ml-1 text-gray-600 hover:text-red-600 dark:text-zinc-300"
                                onClick={() => void onRemoveAlias(a)}
                                title={`Remove alias "${a}"`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-gray-600 dark:text-zinc-400"
                  >
                    No teams found. Try a different filter/search.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-gray-600 dark:text-zinc-400"
                  >
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
