'use client';

import React from 'react';

import { describeFreshness, type FreshnessTone } from '@/lib/freshness';

/**
 * Subtle, dataset-specific freshness chip (PLATFORM-086A).
 *
 * Renders muted, small text like "Scores updated 3m ago" next to the data it
 * describes. It intentionally does NOT imply a single global freshness — each
 * instance is scoped to one dataset's own timestamp. Only meaningfully stale or
 * missing states get a restrained warning color; the default is muted gray.
 *
 * Not admin-only: safe for regular users. It exposes only a timestamp phrase,
 * never provider errors or internal detail.
 */

const TONE_CLASS: Record<FreshnessTone, string> = {
  fresh: 'text-gray-400 dark:text-zinc-500',
  aging: 'text-gray-400 dark:text-zinc-500',
  stale: 'text-amber-600/80 dark:text-amber-400/80',
  missing: 'text-gray-400 dark:text-zinc-500',
};

export type FreshnessLabelProps = {
  /** ISO string, epoch ms, or Date of the dataset's last successful update. */
  timestamp: string | number | Date | null | undefined;
  /** Dataset noun, e.g. "Scores", "Odds". Prefixed before the relative phrase. */
  label?: string;
  /** Age (ms) below which the data is treated as fresh. */
  freshWithinMs?: number;
  /** Age (ms) at/above which the data is treated as stale (warning tone). */
  staleAfterMs?: number;
  now?: number;
  className?: string;
};

export default function FreshnessLabel({
  timestamp,
  label,
  freshWithinMs,
  staleAfterMs,
  now,
  className,
}: FreshnessLabelProps): React.ReactElement | null {
  const descriptor = describeFreshness(timestamp, {
    now,
    freshWithinMs,
    staleAfterMs,
  });

  // Nothing to show when there is no timestamp AND no label context worth a
  // "not yet updated" note — keep the UI quiet rather than noisy.
  if (descriptor.relative == null && !label) return null;

  const prefix = label ? `${label} ` : '';
  const body =
    descriptor.relative == null
      ? `${label ?? 'Data'} not yet updated`
      : `${prefix}updated ${descriptor.relative}`;

  return (
    <span
      className={`text-[11px] leading-none ${TONE_CLASS[descriptor.tone]} ${className ?? ''}`}
      title={typeof timestamp === 'string' ? new Date(timestamp).toLocaleString() : descriptor.text}
    >
      {body}
    </span>
  );
}
