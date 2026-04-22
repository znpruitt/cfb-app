'use client';

import React, { useEffect, useState } from 'react';

import AliasEditorPanel from '@/components/AliasEditorPanel';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import { normalizeAliasLookup } from '@/lib/teamNormalization';

type DraftRow = { key: string; value: string };
type AliasMap = Record<string, string>;

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function AdminAliasesPage(): React.ReactElement {
  const [aliasDraft, setAliasDraft] = useState<DraftRow[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | undefined>();
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    void loadAliases();
  }, []);

  async function loadAliases() {
    setStatus('loading');
    setError(undefined);
    try {
      const res = await fetch('/api/aliases?scope=global', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/aliases?scope=global ${res.status}`);
      const data = (await res.json()) as { map: AliasMap };
      setAliasDraft(
        Object.entries(data.map)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => ({ key: k, value: v }))
      );
      setStatus('idle');
      setEditorOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load aliases');
      setStatus('error');
    }
  }

  async function saveAliases() {
    setStatus('loading');
    setError(undefined);
    try {
      const upserts: AliasMap = {};
      for (const r of aliasDraft) {
        const key = normalizeAliasLookup(r.key.trim());
        const val = r.value.trim();
        if (key && val) upserts[key] = val;
      }
      const res = await fetch('/api/aliases?scope=global', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(requireAdminAuthHeaders() as Record<string, string>),
        },
        body: JSON.stringify({ upserts }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setError(`Error ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
      setStatus('error');
    }
  }

  const sectionClass =
    'rounded-lg border border-gray-200 bg-white p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <div className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <Breadcrumbs
            segments={[
              { label: 'Home', href: '/' },
              { label: 'Admin', href: '/admin' },
              { label: 'Aliases' },
            ]}
          />
          <h1 className="text-2xl font-semibold">Aliases</h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            Team name corrections applied across all leagues and seasons.
          </p>
        </div>

        <section className={sectionClass}>
          {status === 'loading' && !editorOpen && (
            <p className="text-sm text-gray-500 dark:text-zinc-400">Loading aliases…</p>
          )}
          {status === 'error' && !editorOpen && (
            <div className="space-y-2">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <button
                onClick={() => void loadAliases()}
                className="rounded border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              >
                Retry
              </button>
            </div>
          )}
          {editorOpen && (
            <>
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              {status === 'success' && (
                <p className="text-xs text-green-600 dark:text-green-400">Saved</p>
              )}
              <AliasEditorPanel
                open={editorOpen}
                season={0}
                draft={aliasDraft}
                onClose={() => setEditorOpen(false)}
                onAddRow={() => setAliasDraft((prev) => [...prev, { key: '', value: '' }])}
                onSave={() => void saveAliases()}
                onUpdateKey={(idx, value) =>
                  setAliasDraft((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, key: value } : r))
                  )
                }
                onUpdateValue={(idx, value) =>
                  setAliasDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, value } : r)))
                }
                onRemoveRow={(idx) => setAliasDraft((prev) => prev.filter((_, i) => i !== idx))}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
