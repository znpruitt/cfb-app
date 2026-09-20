import React from 'react';
import Link from 'next/link';

import { draftScope, type DraftPhase } from '@/lib/draft';
import { getAppState } from '@/lib/server/appStateStore';
import { canonicalScheduleAggregateServes } from '@/lib/server/canonicalScheduleCache';

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatScheduledAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${ok ? 'bg-green-500' : 'bg-amber-400'}`}
    />
  );
}

function GrayDot() {
  return (
    <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-gray-200 dark:bg-zinc-600" />
  );
}

function GreenDot() {
  return <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />;
}

function AmberDot() {
  return <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" />;
}

type StoredDraftState = {
  phase: DraftPhase;
  settings?: {
    scheduledAt?: string | null;
  };
};

export default async function LeagueStatusPanel({
  slug,
  year,
}: {
  slug: string;
  year: number;
}): Promise<React.ReactElement | null> {
  let rosterRecord: Awaited<ReturnType<typeof getAppState<string>>> = null;
  let scheduleRecord: Awaited<ReturnType<typeof getAppState<unknown>>> = null;
  let scoresRecord: Awaited<ReturnType<typeof getAppState<unknown>>> = null;
  let draftRecord: Awaited<ReturnType<typeof getAppState<StoredDraftState>>> = null;

  try {
    [rosterRecord, scheduleRecord, scoresRecord, draftRecord] = await Promise.all([
      getAppState<string>(`owners:${slug}:${year}`, 'csv'),
      // PLATFORM-833: the aggregate serves only when it carries ROWS.
      //
      // This was `getAppState(...'-all-all').then((r) => r ?? getAppState(...'-all-regular'))`,
      // which fell back on RECORD absence — a `-all-all` record holding `items: []`
      // is present, so `??` kept it, the fallback never fired, and the panel
      // reported on a key it should have skipped. The shared predicate decides it
      // now, so the fallback keys on rows.
      //
      // IT STILL READS `-all-regular` ONLY, while the canonical reader falls back to
      // BOTH partition keys — so a store whose only populated partition is
      // `-all-postseason` reads "not cached" here while every canonical reader serves
      // the season. Round 1 switched to that reader and review round 2 reverted it:
      // the canonical entry carries `at` (provider-observation time) and no
      // `updatedAt`, which made this row measure a different quantity from the Scores
      // row beside it while looking identical — and rendered a 1970 age for any
      // record lacking `at`, which is the legacy state the fallback exists for.
      // Closing the postseason-only gap without that regression is its own item.
      getAppState<unknown>('schedule', `${year}-all-all`).then((r) =>
        canonicalScheduleAggregateServes(r?.value)
          ? r
          : getAppState<unknown>('schedule', `${year}-all-regular`)
      ),
      getAppState<unknown>('scores', `${year}-all-regular`),
      getAppState<StoredDraftState>(draftScope(slug), String(year)),
    ]);
  } catch {
    // Storage not available (e.g. production-misconfigured); skip panel
    return null;
  }

  const csvText = typeof rosterRecord?.value === 'string' ? rosterRecord.value : '';
  const hasRoster = csvText.trim().length > 0;

  // PLATFORM-833: CONTENT, not presence. Both flags were `Boolean(record)`, so a
  // record holding `items: []` rendered a green dot and a freshness age for a
  // season with no games — the panel asserting health from the existence of a
  // container. `hasRoster` above already derived from content (it trims the CSV and
  // checks length); these two were the outliers, nine lines below a correct sibling.
  //
  // ONE SPELLING of "does this carry rows", applied to both records. The predicate is
  // schedule-named and is answering a scores question, which reads oddly and is
  // deliberate: both values are `{ items: [...] }` shaped, and a second spelling is
  // worse than one odd name — spelling it differently is how the schedule precedence
  // drifted into four copies to begin with. Generalising the name is a rename
  // candidate, not this slice's work.
  const hasSchedule = canonicalScheduleAggregateServes(scheduleRecord?.value);
  const hasScores = canonicalScheduleAggregateServes(scoresRecord?.value);
  const draftPhase = draftRecord?.value?.phase ?? null;
  const scheduledAt = draftRecord?.value?.settings?.scheduledAt ?? null;

  // Derive draft dot and label
  const isSetupPhase =
    draftPhase === 'setup' || draftPhase === 'settings' || draftPhase === 'preview';

  let draftDot: React.ReactElement;
  let draftLabel: React.ReactElement;

  if (!draftPhase) {
    draftDot = <GrayDot />;
    draftLabel = <span className="text-gray-400 dark:text-zinc-500">not started</span>;
  } else if (isSetupPhase && !scheduledAt) {
    draftDot = <GrayDot />;
    draftLabel = <span className="text-gray-500 dark:text-zinc-400">configured, not started</span>;
  } else if (isSetupPhase && scheduledAt) {
    draftDot = <GrayDot />;
    draftLabel = (
      <span className="text-gray-500 dark:text-zinc-400">
        Scheduled &middot; {formatScheduledAt(scheduledAt)}
      </span>
    );
  } else if (draftPhase === 'live') {
    draftDot = <GreenDot />;
    draftLabel = (
      <Link
        href={`/league/${slug}/draft`}
        className="text-green-600 hover:underline dark:text-green-400"
      >
        live →
      </Link>
    );
  } else if (draftPhase === 'paused') {
    draftDot = <AmberDot />;
    draftLabel = (
      <Link
        href={`/league/${slug}/draft`}
        className="text-amber-600 hover:underline dark:text-amber-400"
      >
        paused →
      </Link>
    );
  } else {
    // complete
    draftDot = <GreenDot />;
    draftLabel = <span className="text-gray-600 dark:text-zinc-300">complete</span>;
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 space-y-3 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">Status</h2>
      <div className="space-y-2 text-sm">
        {/* Roster */}
        <div className="flex items-center gap-2">
          {hasRoster ? (
            <StatusDot ok={true} />
          ) : (
            <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
          )}
          <span className="w-20 text-gray-600 dark:text-zinc-300">Roster</span>
          {hasRoster ? (
            <span className="text-gray-500 dark:text-zinc-400">Roster set</span>
          ) : (
            <span className="text-red-600 dark:text-red-400">Not configured</span>
          )}
        </div>

        {/* Schedule */}
        <div className="flex items-center gap-2">
          <StatusDot ok={hasSchedule} />
          <span className="w-20 text-gray-600 dark:text-zinc-300">Schedule</span>
          {hasSchedule ? (
            <span className="text-gray-500 dark:text-zinc-400">
              {formatAge(scheduleRecord!.updatedAt)}
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">not cached</span>
          )}
        </div>

        {/* Scores */}
        <div className="flex items-center gap-2">
          <StatusDot ok={hasScores} />
          <span className="w-20 text-gray-600 dark:text-zinc-300">Scores</span>
          {hasScores ? (
            <span className="text-gray-500 dark:text-zinc-400">
              {formatAge(scoresRecord!.updatedAt)}
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">not cached</span>
          )}
        </div>

        {/* Draft */}
        <div className="flex items-center gap-2">
          {draftDot}
          <span className="w-20 text-gray-600 dark:text-zinc-300">Draft</span>
          {draftLabel}
        </div>
      </div>
    </section>
  );
}
