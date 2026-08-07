'use client';

import { useState, useTransition } from 'react';
import {
  setTestLeagueStatus,
  resetTestLeague,
  resetTestDraft,
  migrateTestOwnersCsv,
  autoCompleteDraft,
} from '../actions';
import {
  describeAutoCompleteDraftResult,
  describeTestControlResult,
  type TestControlFeedback,
} from '@/lib/testLeagueControl';

const btnClass =
  'px-3 py-1.5 rounded border border-gray-300 bg-white text-sm text-gray-900 transition-colors hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60';

const resetBtnClass =
  'px-3 py-1.5 rounded border border-red-200 bg-white text-sm text-red-600 transition-colors hover:bg-red-50 hover:border-red-300 disabled:opacity-50 disabled:cursor-not-allowed dark:border-red-900 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-950/30';

const toneClass: Record<TestControlFeedback['tone'], string> = {
  success: 'text-green-700 dark:text-green-400',
  neutral: 'text-gray-600 dark:text-zinc-400',
  error: 'text-red-700 dark:text-red-400',
};

/**
 * PLATFORM-086F2H3B1 — the demo-league sandbox controls, now with persistent
 * typed feedback.
 *
 * Two things changed. (1) The lifecycle actions return
 * `TestControlResult` instead of `Promise<void>` + throw, so a refusal reads as
 * a specific condition rather than a generic Server Action rejection whose
 * message is REDACTED in production. (2) There is ONE feedback slot instead of
 * two independent ones, cleared at the start of every action, so a stale message
 * from an unrelated control can no longer sit beside a fresh result.
 *
 * The feedback is local state only — deliberately not persisted, so a reload
 * starts clean and no message can outlive the state it describes.
 */
export default function TestLeagueControls() {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<TestControlFeedback | null>(null);

  /**
   * Every control funnels through here, so "clear, run, replace" cannot drift
   * per button. The `catch` produces GENERIC copy: a thrown Server Action error
   * is an opaque digest in production, and rendering it presents an unreadable
   * identifier as an explanation.
   */
  function run(action: () => Promise<TestControlFeedback>) {
    setFeedback(null);
    startTransition(async () => {
      try {
        setFeedback(await action());
      } catch {
        setFeedback({ tone: 'error', message: 'Something went wrong. No change was confirmed.' });
      }
    });
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h2 className="text-base font-medium">Test Controls</h2>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          This demo league is manually controlled — no automatic lifecycle job moves it. Its state
          changes only through these controls and the commissioner actions above.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['season', 'offseason', 'preseason'] as const).map((state) => (
          <button
            key={state}
            className={btnClass}
            disabled={pending}
            onClick={() =>
              run(async () => describeTestControlResult(await setTestLeagueStatus(state)))
            }
          >
            {state === 'preseason'
              ? 'Set: Pre-Season'
              : `Set: ${state === 'season' ? 'Season' : 'Offseason'}`}
          </button>
        ))}
        <button
          className={btnClass}
          disabled={pending}
          onClick={() =>
            run(async () => ({ tone: 'neutral', message: await migrateTestOwnersCsv(2025, 2026) }))
          }
        >
          Migrate Owners 2025 → 2026
        </button>
        <button
          className={btnClass}
          disabled={pending}
          onClick={() =>
            run(async () => describeAutoCompleteDraftResult(await autoCompleteDraft()))
          }
        >
          Auto-complete Draft →
        </button>
        <button
          className={resetBtnClass}
          disabled={pending}
          onClick={() =>
            run(async () => {
              await resetTestDraft();
              return { tone: 'success', message: 'Draft state cleared.' };
            })
          }
        >
          Reset Draft
        </button>
        <button
          className={resetBtnClass}
          disabled={pending}
          onClick={() => run(async () => describeTestControlResult(await resetTestLeague()))}
        >
          Reset to 2025 Season
        </button>
      </div>
      {feedback && <p className={`text-xs ${toneClass[feedback.tone]}`}>{feedback.message}</p>}
    </div>
  );
}
