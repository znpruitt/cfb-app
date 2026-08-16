import React from 'react';

import type { InsightFate, InsightsDiagnostics } from '@/lib/server/insightsDiagnostics';

/**
 * INSIGHTS-019 — renders the funnel view model. Maps model to markup and derives
 * nothing (AGENTS.md invariant 9).
 *
 * DESIGN.md constraints observed:
 * - No colour for decoration. The only colour here encodes an insight's FATE,
 *   which is the page's entire subject. Amber is untouched (champion/podium
 *   only) and blue is untouched (interactivity only) — the three fates use
 *   neutral / muted-neutral / red-tinted, reading as full-strength, dimmed, and
 *   cut off.
 * - Density is a feature: tight rows, no card chrome, no section header
 *   restating the page title.
 * - Column priority is declared per table below, per the responsive rules.
 */

const FATE_LABEL: Record<InsightFate, string> = {
  rendered: 'On the Overview',
  'served-not-rendered': 'Served, not shown',
  'generated-not-served': 'Cut before serving',
};

/**
 * Fate is the one thing colour encodes on this page. Full-strength text = the
 * reader sees it; dimmed = it exists but never reaches the screen; red = it did
 * not survive the cut at all.
 */
const FATE_ROW_CLASS: Record<InsightFate, string> = {
  rendered: 'text-gray-900 dark:text-zinc-100',
  'served-not-rendered': 'text-gray-500 dark:text-zinc-400',
  'generated-not-served': 'text-red-700/80 dark:text-red-400/80',
};

function Stat({
  value,
  label,
  hint,
}: {
  value: number | string;
  label: string;
  hint?: string;
}): React.ReactElement {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-zinc-400">
        {label}
      </div>
      {hint && <div className="mt-0.5 text-xs text-gray-400 dark:text-zinc-500">{hint}</div>}
    </div>
  );
}

export default function InsightsDiagnosticsView({
  model,
}: {
  model: InsightsDiagnostics;
}): React.ReactElement {
  const { counts } = model;
  const poolExceedsFeed = counts.generated > counts.servedCap;

  return (
    <div className="space-y-6">
      <div className="text-sm text-gray-500 dark:text-zinc-400">
        {model.slug} · {model.year} · lifecycle{' '}
        <span className="font-medium text-gray-700 dark:text-zinc-200">{model.lifecycleState}</span>
      </div>

      {/* The funnel. Three numbers, in the order the feed passes through them. */}
      <div className="grid grid-cols-3 gap-4 border-y border-gray-200 py-4 dark:border-zinc-800">
        <Stat value={counts.generated} label="Generated" hint="by all generators" />
        <Stat value={counts.served} label="Served" hint={`cap ${counts.servedCap}`} />
        <Stat value={counts.rendered} label="On the Overview" hint={`cap ${counts.renderedCap}`} />
      </div>

      {/* The one conclusion the page exists to state, since INSIGHTS-023 and
          INSIGHTS-018 both turn on it. */}
      <p className="text-sm text-gray-600 dark:text-zinc-300">
        {poolExceedsFeed ? (
          <>
            The pool is <strong>larger</strong> than the feed — {counts.generated} generated for{' '}
            {counts.servedCap} slots, so {counts.generated - counts.servedCap} never leave the
            server. Rotation would have something to rotate.
          </>
        ) : (
          <>
            The pool is <strong>not yet larger</strong> than the feed — {counts.generated} generated
            for {counts.servedCap} slots. Rotation has nothing to rotate until breadth work widens
            this.
          </>
        )}
      </p>

      {/* Generators. Column priority: id (never drops) → produced → category. */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Generators</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="py-1.5 font-medium">Generator</th>
              <th className="py-1.5 font-medium">Category</th>
              <th className="py-1.5 text-right font-medium">Produced</th>
            </tr>
          </thead>
          <tbody>
            {model.generators.map((g) => (
              <tr key={g.id} className="border-b border-gray-100 dark:border-zinc-900">
                <td className="py-1.5 font-mono text-xs">{g.id}</td>
                <td className="py-1.5 text-gray-500 dark:text-zinc-400">{g.category}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {g.skippedBy ? (
                    <span className="text-xs text-gray-400 dark:text-zinc-500">
                      {g.skippedBy === 'lifecycle' ? 'not in this lifecycle' : 'gated'}
                    </span>
                  ) : (
                    g.produced
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Every insight and what happened to it. Column priority: rank + title
          (never drop) → fate → owner → score → generator. */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Every insight, and where it ended up</h2>
        {model.insights.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            No generator produced anything for this league in this lifecycle state.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="py-1.5 font-medium">#</th>
                <th className="py-1.5 font-medium">Insight</th>
                <th className="py-1.5 font-medium">Owner</th>
                <th className="py-1.5 text-right font-medium">Score</th>
                <th className="py-1.5 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {model.insights.map((i) => (
                <tr
                  key={i.id}
                  className={`border-b border-gray-100 dark:border-zinc-900 ${FATE_ROW_CLASS[i.fate]}`}
                >
                  <td className="py-1.5 tabular-nums">{i.rank}</td>
                  <td className="py-1.5">
                    <div>{i.title}</div>
                    <div className="font-mono text-xs text-gray-400 dark:text-zinc-500">
                      {i.type} · {i.generatorId}
                    </div>
                  </td>
                  <td className="py-1.5">{i.owner ?? '—'}</td>
                  <td className="py-1.5 text-right tabular-nums">{i.priorityScore}</td>
                  <td className="py-1.5 text-xs">{FATE_LABEL[i.fate]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-xs text-gray-400 dark:text-zinc-500">
        Computed live at {model.generatedAt} — this page bypasses the insights cache on purpose, so
        it shows what the generators produce right now.
      </p>
    </div>
  );
}
