'use client';

import React, { useState } from 'react';

import AliasEditorPanel from '@/components/AliasEditorPanel';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import { normalizeAliasLookup } from '@/lib/teamNormalization';

type DraftRow = { key: string; value: string };
type AliasMap = Record<string, string>;

type SectionStatus = 'idle' | 'loading' | 'success' | 'error';

function StatusBadge({ status, error }: { status: SectionStatus; error?: string }) {
  if (status === 'loading') return <span className="text-xs text-gray-500 dark:text-zinc-400">Working…</span>;
  if (status === 'success') return <span className="text-xs text-green-600 dark:text-green-400">Done</span>;
  if (status === 'error') return <span className="text-xs text-red-600 dark:text-red-400">{error ?? 'Failed'}</span>;
  return null;
}

export default function LeagueDataPanel({
  slug,
  year,
}: {
  slug: string;
  year: number;
}): React.ReactElement {
  // ---- Aliases ----
  const [aliasOpen, setAliasOpen] = useState(false);
  const [aliasDraft, setAliasDraft] = useState<DraftRow[]>([]);
  const [aliasStatus, setAliasStatus] = useState<SectionStatus>('idle');
  const [aliasError, setAliasError] = useState<string | undefined>();

  async function openAliasEditor() {
    setAliasStatus('loading');
    setAliasError(undefined);
    try {
      const res = await fetch(
        `/api/aliases?league=${encodeURIComponent(slug)}&year=${year}`,
        { cache: 'no-store' }
      );
      if (!res.ok) throw new Error(`GET /api/aliases ${res.status}`);
      const data = (await res.json()) as { map: AliasMap };
      setAliasDraft(
        Object.entries(data.map).map(([k, v]) => ({ key: k, value: v }))
      );
      setAliasStatus('idle');
      setAliasOpen(true);
    } catch (err) {
      setAliasError(err instanceof Error ? err.message : 'Failed to load aliases');
      setAliasStatus('error');
    }
  }

  async function saveAliases() {
    setAliasStatus('loading');
    setAliasError(undefined);
    try {
      const map = Object.fromEntries(
        aliasDraft
          .filter((r) => r.key.trim() && r.value.trim())
          .map((r) => [normalizeAliasLookup(r.key.trim()), r.value.trim()])
      );
      const res = await fetch(
        `/api/aliases?league=${encodeURIComponent(slug)}&year=${year}`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            ...(requireAdminAuthHeaders() as Record<string, string>),
          },
          body: JSON.stringify({ map }),
        }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setAliasError(`Error ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
        setAliasStatus('error');
        return;
      }
      setAliasStatus('success');
      setAliasOpen(false);
    } catch (err) {
      setAliasError(err instanceof Error ? err.message : 'Unexpected error');
      setAliasStatus('error');
    }
  }

  function addAliasRow() {
    setAliasDraft((prev) => [...prev, { key: '', value: '' }]);
  }

  function updateAliasKey(idx: number, value: string) {
    setAliasDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, key: value } : r)));
  }

  function updateAliasValue(idx: number, value: string) {
    setAliasDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, value } : r)));
  }

  function removeAliasRow(idx: number) {
    setAliasDraft((prev) => prev.filter((_, i) => i !== idx));
  }

  const sectionClass = 'rounded-lg border border-gray-200 bg-white p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900';
  const buttonClass =
    'rounded border border-gray-300 bg-gray-50 px-4 py-1.5 text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';

  return (
    <div className="space-y-4">
      {/* ---- Aliases ---- */}
      <section className={sectionClass}>
        <div>
          <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">Aliases</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
            Fix team name mismatches from the data provider.
          </p>
        </div>
        {!aliasOpen && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => void openAliasEditor()}
              disabled={aliasStatus === 'loading'}
              className={buttonClass}
            >
              {aliasStatus === 'loading' ? 'Loading…' : 'Edit Aliases'}
            </button>
            <StatusBadge status={aliasStatus} error={aliasError} />
          </div>
        )}
        {aliasOpen && (
          <>
            {aliasError && (
              <p className="text-xs text-red-600 dark:text-red-400">{aliasError}</p>
            )}
            <AliasEditorPanel
              open={aliasOpen}
              season={year}
              draft={aliasDraft}
              onClose={() => setAliasOpen(false)}
              onAddRow={addAliasRow}
              onSave={() => void saveAliases()}
              onUpdateKey={updateAliasKey}
              onUpdateValue={updateAliasValue}
              onRemoveRow={removeAliasRow}
            />
          </>
        )}
      </section>
    </div>
  );
}
