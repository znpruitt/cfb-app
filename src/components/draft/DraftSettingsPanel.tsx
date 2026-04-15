'use client';

import React, { useState, useRef, useCallback } from 'react';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { DraftState, DraftSettings } from '@/lib/draft';

type DraftOrderMode = 'random' | 'manual' | 'reverse-champ';

type DraftSettingsPanelProps = {
  slug: string;
  year: number;
  draftState: DraftState;
  priorOwners: string[];
  priorChampOrder: string[] | null;
  fbsTeamCount: number;
  onAdvance: (draft: DraftState) => void;
};

const TIMER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'No timer', value: null },
  { label: '30 seconds', value: 30 },
  { label: '60 seconds', value: 60 },
  { label: '90 seconds', value: 90 },
  { label: '2 minutes', value: 120 },
];

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function maxRounds(fbsTeamCount: number, ownerCount: number): number {
  if (ownerCount === 0) return 1;
  return Math.floor(fbsTeamCount / ownerCount);
}

export default function DraftSettingsPanel({
  slug,
  year,
  draftState,
  priorOwners,
  priorChampOrder,
  fbsTeamCount,
  onAdvance,
}: DraftSettingsPanelProps): React.ReactElement {
  const [owners] = useState<string[]>(() => {
    if (draftState.owners.length > 0) return draftState.owners;
    return priorOwners.length > 0 ? priorOwners : [];
  });
  const existing = draftState.settings;

  // Detect initial order mode
  function detectInitialMode(): DraftOrderMode {
    if (existing.draftOrder.length === 0) return 'random';
    if (
      priorChampOrder &&
      existing.draftOrder.length === priorChampOrder.length &&
      existing.draftOrder.every((o, i) => o === priorChampOrder[i])
    ) {
      return 'reverse-champ';
    }
    return 'manual';
  }

  const [orderMode, setOrderMode] = useState<DraftOrderMode>(detectInitialMode);
  const [manualOrder, setManualOrder] = useState<string[]>(() => {
    if (existing.draftOrder.length > 0) return existing.draftOrder;
    return [...owners];
  });
  const [timerSeconds, setTimerSeconds] = useState<number | null>(existing.pickTimerSeconds);
  const [expiryBehavior, setExpiryBehavior] = useState<DraftSettings['timerExpiryBehavior']>(
    existing.timerExpiryBehavior
  );
  const [autoPickMetric, setAutoPickMetric] = useState<DraftSettings['autoPickMetric']>(
    existing.autoPickMetric
  );
  const maxRoundsValue = maxRounds(fbsTeamCount, owners.length);
  const [totalRounds, setTotalRounds] = useState<number>(() => {
    const initial = existing.totalRounds > 1 ? existing.totalRounds : maxRoundsValue;
    return Math.min(initial, maxRoundsValue);
  });
  const [scheduledAt, setScheduledAt] = useState<string>(existing.scheduledAt ?? '');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Drag and drop state ---
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const dragCounterRef = useRef(0);

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    // Make the dragged element semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      requestAnimationFrame(() => {
        (e.currentTarget as HTMLElement).style.opacity = '0.4';
      });
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    setDragIdx(null);
    setDropTargetIdx(null);
    dragCounterRef.current = 0;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragEnter = useCallback((_e: React.DragEvent, idx: number) => {
    dragCounterRef.current++;
    setDropTargetIdx(idx);
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      setDropTargetIdx(null);
      dragCounterRef.current = 0;
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    const sourceIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(sourceIdx) || sourceIdx === targetIdx) {
      setDragIdx(null);
      setDropTargetIdx(null);
      dragCounterRef.current = 0;
      return;
    }
    setManualOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(targetIdx, 0, moved!);
      return next;
    });
    setDragIdx(null);
    setDropTargetIdx(null);
    dragCounterRef.current = 0;
  }, []);

  // --- Direct number entry ---
  const handlePositionChange = useCallback((currentIdx: number, newPosition: number) => {
    setManualOrder((prev) => {
      const clamped = Math.max(1, Math.min(prev.length, newPosition)) - 1;
      if (clamped === currentIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(currentIdx, 1);
      next.splice(clamped, 0, moved!);
      return next;
    });
  }, []);

  function buildDraftOrder(): string[] {
    switch (orderMode) {
      case 'random':
        return shuffleArray(owners);
      case 'reverse-champ':
        if (priorChampOrder && priorChampOrder.length > 0) {
          const newOwners = owners.filter((o) => !priorChampOrder.includes(o));
          const existing = priorChampOrder.filter((o) => owners.includes(o));
          return [...newOwners, ...existing];
        }
        return shuffleArray(owners);
      case 'manual':
        return manualOrder.filter((o) => owners.includes(o));
      default:
        return shuffleArray(owners);
    }
  }

  async function handleSave(targetPhase: 'settings' | 'preview' | 'live') {
    setError(null);

    const trimmedOwners = owners.map((o) => o.trim()).filter(Boolean);
    if (trimmedOwners.length < 2) {
      setError('At least 2 owners are required.');
      return;
    }

    setLoading(true);

    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;

      // Ensure draft exists (auto-create if needed)
      if (!draftState.createdAt || draftState.phase === 'settings' && draftState.owners.length === 0) {
        const createRes = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authHeaders },
          body: JSON.stringify({ owners: trimmedOwners }),
        });
        // 409 = draft already exists, that's fine
        if (!createRes.ok && createRes.status !== 409) {
          const data = (await createRes.json()) as { error?: string };
          setError(data.error ?? `Failed to create draft (${createRes.status})`);
          return;
        }
      }

      const draftOrder = buildDraftOrder();
      const settings: DraftSettings = {
        style: 'snake',
        draftOrder,
        pickTimerSeconds: timerSeconds,
        timerExpiryBehavior: expiryBehavior,
        autoPickMetric: expiryBehavior === 'auto-pick' ? autoPickMetric : null,
        totalRounds: Math.max(1, Math.min(totalRounds, suggestedRounds)),
        scheduledAt: scheduledAt.trim() ? new Date(scheduledAt).toISOString() : null,
      };

      const body: { owners: string[]; settings: DraftSettings; phase?: string } = {
        owners: trimmedOwners,
        settings,
      };
      if (targetPhase !== 'settings') {
        body.phase = targetPhase;
      }

      const res = await fetch(`/api/draft/${encodeURIComponent(slug)}/${year}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? `Failed to save settings (${res.status})`);
        return;
      }

      const data = (await res.json()) as { draft: DraftState };

      if (targetPhase === 'live' || targetPhase === 'preview') {
        window.location.href = `/league/${slug}/draft`;
        return;
      }

      onAdvance(data.draft);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const suggestedRounds = maxRounds(fbsTeamCount, owners.length);
  const trimmedOwners = owners.map((o) => o.trim()).filter(Boolean);
  const canSave = trimmedOwners.length >= 2 && !loading;

  return (
    <div className="rounded-2xl border border-gray-300 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-4 text-lg font-semibold text-gray-950 dark:text-zinc-50">
        Draft Settings
      </h2>

      <div className="space-y-6">
        {/* Draft Order */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-zinc-100">
            Draft Order
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setOrderMode('random')}
              className={`rounded border px-3 py-1.5 text-sm transition ${
                orderMode === 'random'
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60'
              }`}
            >
              Random
            </button>
            {priorChampOrder && priorChampOrder.length > 0 && (
              <button
                type="button"
                onClick={() => setOrderMode('reverse-champ')}
                className={`rounded border px-3 py-1.5 text-sm transition ${
                  orderMode === 'reverse-champ'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60'
                }`}
              >
                Reverse Champ Order
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOrderMode('manual');
                // Sync manual order with current owners
                setManualOrder((prev) => {
                  const inOwners = prev.filter((o) => owners.includes(o));
                  const missing = owners.filter((o) => !prev.includes(o));
                  return [...inOwners, ...missing];
                });
              }}
              className={`rounded border px-3 py-1.5 text-sm transition ${
                orderMode === 'manual'
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60'
              }`}
            >
              Manual
            </button>
          </div>

          {orderMode === 'random' && (
            <p className="mt-2 text-xs text-gray-500 dark:text-zinc-400">
              Draft order will be randomized when the draft starts.
            </p>
          )}
          {orderMode === 'reverse-champ' && priorChampOrder && (
            <div className="mt-2">
              <p className="mb-1 text-xs text-gray-500 dark:text-zinc-400">
                Last-place owner picks first (reverse of {year - 1} final standings).
              </p>
              <ol className="space-y-0.5">
                {priorChampOrder.map((owner, i) => (
                  <li key={owner} className="text-sm text-gray-700 dark:text-zinc-300">
                    <span className="mr-2 text-gray-400 dark:text-zinc-500">{i + 1}.</span>
                    {owner}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {orderMode === 'manual' && (
            <div className="mt-2">
              <p className="mb-1.5 text-xs text-gray-500 dark:text-zinc-400">
                Drag to reorder, or type a position number to move an owner.
              </p>
              <ul className="space-y-1">
                {manualOrder
                  .filter((o) => owners.includes(o))
                  .map((owner, idx) => (
                    <li
                      key={owner}
                      draggable
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragEnd={handleDragEnd}
                      onDragOver={handleDragOver}
                      onDragEnter={(e) => handleDragEnter(e, idx)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, idx)}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
                        dragIdx === idx
                          ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30'
                          : dropTargetIdx === idx
                            ? 'border-blue-400 bg-blue-50/60 dark:border-blue-600 dark:bg-blue-950/20'
                            : 'border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800'
                      }`}
                    >
                      {/* Drag handle */}
                      <span className="cursor-grab text-gray-400 dark:text-zinc-500" title="Drag to reorder">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                          <circle cx="4" cy="2" r="1" />
                          <circle cx="8" cy="2" r="1" />
                          <circle cx="4" cy="6" r="1" />
                          <circle cx="8" cy="6" r="1" />
                          <circle cx="4" cy="10" r="1" />
                          <circle cx="8" cy="10" r="1" />
                        </svg>
                      </span>
                      {/* Position number input */}
                      <input
                        type="number"
                        min={1}
                        max={manualOrder.filter((o) => owners.includes(o)).length}
                        value={idx + 1}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val)) handlePositionChange(idx, val);
                        }}
                        className="w-8 rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-center text-xs text-gray-700 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
                        title="Type a position number"
                      />
                      <span className="flex-1 text-sm text-gray-900 dark:text-zinc-100">{owner}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>

        {/* Pick Timer */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-zinc-100">
            Pick Timer
          </h3>
          <div className="flex flex-wrap gap-2">
            {TIMER_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setTimerSeconds(opt.value)}
                className={`rounded border px-3 py-1.5 text-sm transition ${
                  timerSeconds === opt.value
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Timer Expiry Behavior */}
        {timerSeconds !== null && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-zinc-100">
              Timer Expiry
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setExpiryBehavior('pause-and-prompt')}
                className={`rounded border px-3 py-1.5 text-sm transition ${
                  expiryBehavior === 'pause-and-prompt'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60'
                }`}
              >
                Pause and prompt
              </button>
              <button
                type="button"
                onClick={() => setExpiryBehavior('auto-pick')}
                className={`rounded border px-3 py-1.5 text-sm transition ${
                  expiryBehavior === 'auto-pick'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60'
                }`}
              >
                Auto-pick
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
              {expiryBehavior === 'pause-and-prompt'
                ? 'Draft pauses — commissioner chooses to auto-pick or select manually.'
                : 'Pick is made automatically when timer expires.'}
            </p>
            {expiryBehavior === 'auto-pick' && (
              <div className="mt-2">
                <p className="mb-1 text-xs font-medium text-gray-700 dark:text-zinc-300">
                  Auto-pick metric
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAutoPickMetric('sp-plus')}
                    className={`rounded border px-3 py-1.5 text-sm transition ${
                      autoPickMetric === 'sp-plus'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60'
                    }`}
                  >
                    SP+ (highest available)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAutoPickMetric('preseason-rank')}
                    className={`rounded border px-3 py-1.5 text-sm transition ${
                      autoPickMetric === 'preseason-rank'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60'
                    }`}
                  >
                    Preseason rank (best available)
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Total Rounds */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-zinc-100">
            Total Rounds
          </h3>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={totalRounds}
              min={1}
              max={suggestedRounds}
              onChange={(e) => setTotalRounds(Math.max(1, Math.min(suggestedRounds, Number(e.target.value))))}
              className="w-20 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            {owners.length > 0 && (
              <span className="text-xs text-gray-500 dark:text-zinc-400">
                Max: {suggestedRounds} ({fbsTeamCount} FBS teams ÷ {owners.length} owners)
              </span>
            )}
          </div>
        </section>

        {/* Scheduled Start */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-zinc-100">
            Scheduled Start{' '}
            <span className="text-xs font-normal text-gray-500 dark:text-zinc-400">(optional)</span>
          </h3>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
            If set, both the commissioner and spectator view will show a countdown to the draft
            start time.
          </p>
        </section>
      </div>

      {error && <p className="mt-4 text-sm text-red-700 dark:text-red-400">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4 dark:border-zinc-700">
        <button
          type="button"
          onClick={() => void handleSave('preview')}
          disabled={!canSave}
          className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Save and Preview'}
        </button>
        <button
          type="button"
          onClick={() => void handleSave('live')}
          disabled={!canSave}
          className="rounded border border-green-600 bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start Draft Now
        </button>
      </div>
    </div>
  );
}
