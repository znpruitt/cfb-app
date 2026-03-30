'use client';

import React, { useState } from 'react';

import {
  FEEDBACK_CATEGORIES,
  submitFeedbackReport,
  type FeedbackCategory,
} from '../lib/feedbackApi.ts';

export default function FeedbackForm(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory | ''>('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!category) return;

    setSubmitting(true);
    setError('');
    try {
      await submitFeedbackReport(category, note.trim());
      setSubmitted(true);
      setOpen(false);
      setCategory('');
      setNote('');
      window.setTimeout(() => setSubmitted(false), 4000);
    } catch {
      setError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel(): void {
    setOpen(false);
    setCategory('');
    setNote('');
    setError('');
  }

  return (
    <div className="mt-4 border-t border-gray-200 pt-3 dark:border-zinc-800">
      {submitted ? (
        <p className="text-xs text-green-700 dark:text-green-400">Thanks — report submitted.</p>
      ) : open ? (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-2 text-sm">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
            required
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="" disabled>
              Select an issue type
            </option>
            {FEEDBACK_CATEGORIES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional details (e.g. team name, week number)"
            maxLength={500}
            rows={2}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!category || submitting}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm text-gray-500 underline underline-offset-2 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-300"
        >
          Report an issue
        </button>
      )}
    </div>
  );
}
