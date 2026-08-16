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
  'on-overview': 'On the Overview',
  // NOT "not shown" — the All Insights page renders every served insight. The
  // first version said "Served, not shown", which was simply false.
  'all-insights-only': 'All Insights page only',
  'not-served': 'Cut before serving',
};

/**
 * Fate is the one thing colour encodes on this page. Full-strength text = the
 * reader sees it; dimmed = it exists but never reaches the screen; red = it did
 * not survive the cut at all.
 */
const FATE_ROW_CLASS: Record<InsightFate, string> = {
  'on-overview': 'text-gray-900 dark:text-zinc-100',
  'all-insights-only': 'text-gray-500 dark:text-zinc-400',
  'not-served': 'text-red-700/80 dark:text-red-400/80',
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
  // Against the OVERVIEW cap, not the loader cap. The first version compared
  // `generated > servedCap` (10) while the feed a reader sees is 5 — so with 7
  // generated it printed "rotation has nothing to rotate" directly above two
  // rows it had just labelled as not reaching the Overview. The page
  // contradicted itself on one screen, and this sentence is the go/no-go input
  // for INSIGHTS-023 and INSIGHTS-018.
  const poolExceedsFeed = counts.generated > counts.renderedCap;

  return (
    <div className="space-y-6">
      <div className="text-sm text-gray-500 dark:text-zinc-400">
        {model.slug} · {model.year} · lifecycle{' '}
        <span className="font-medium text-gray-700 dark:text-zinc-200">{model.lifecycleState}</span>
      </div>

      {/* The funnel. Three numbers, in the order the feed passes through them. */}
      <div className="grid grid-cols-3 gap-4 border-y border-gray-200 py-4 dark:border-zinc-800">
        <Stat value={counts.generated} label="Generated" hint="by all generators" />
        <Stat value={counts.served} label="On All Insights" hint={`cap ${counts.servedCap}`} />
        <Stat
          value={counts.onOverview}
          label="On the Overview"
          hint={
            counts.overviewFillerSlots > 0
              ? `${counts.overviewFillerSlots} more slot${counts.overviewFillerSlots === 1 ? '' : 's'} filled by fallback`
              : `cap ${counts.renderedCap}`
          }
        />
      </div>

      {/* The one conclusion the page exists to state, since INSIGHTS-023 and
          INSIGHTS-018 both turn on it. */}
      {counts.overviewFillerSlots > 0 && (
        <p className="text-sm text-gray-600 dark:text-zinc-300">
          The engine fills {counts.onOverview} of the Overview&apos;s {counts.renderedCap} slots.
          The remaining {counts.overviewFillerSlots} are covered by fallback cards derived on the
          client from standings — so the Overview looks fuller than the engine actually is.
        </p>
      )}

      <p className="text-sm text-gray-600 dark:text-zinc-300">
        {poolExceedsFeed ? (
          <>
            The pool is <strong>larger</strong> than the Overview feed — {counts.generated}{' '}
            generated for {counts.renderedCap} slots, so {counts.generated - counts.renderedCap} do
            not reach it. Rotation would have something to rotate.
          </>
        ) : (
          <>
            The pool is <strong>not yet larger</strong> than the Overview feed — {counts.generated}{' '}
            generated for {counts.renderedCap} slots. Rotation has nothing to rotate until breadth
            work widens this.
          </>
        )}
      </p>

      {/* Generators.
          Column priority (DESIGN.md responsive degradation): generator id and
          produced NEVER drop — the id identifies the row and produced is the
          table's defining metric. Category drops first: it is inferable from the
          id prefix and carries no information the id lacks. Implemented, not just
          declared. */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Generators</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="py-1.5 font-medium">Generator</th>
              <th className="hidden py-1.5 font-medium sm:table-cell">Category</th>
              <th className="py-1.5 text-right font-medium">Produced</th>
            </tr>
          </thead>
          <tbody>
            {model.generators.map((g) => (
              <tr key={g.id} className="border-b border-gray-100 dark:border-zinc-900">
                <td className="break-all py-1.5 font-mono text-xs">{g.id}</td>
                <td className="hidden py-1.5 text-gray-500 sm:table-cell dark:text-zinc-400">
                  {g.category}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {g.skippedBy === 'error' ? (
                    // Distinct from a quiet zero: a generator crashing on this
                    // league is a prime cause of a thin feed.
                    <span className="text-xs font-medium text-red-700 dark:text-red-400">
                      threw an error
                    </span>
                  ) : g.skippedBy ? (
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

      {/* Every insight and what happened to it.
          Column priority (DESIGN.md): rank and insight NEVER drop (identifier),
          nor does outcome (the table's defining metric — it is why this table
          exists). Score drops first: it is a ranking input already expressed by
          the row order. Owner drops next: it is repeated in the insight's own
          title text. Implemented below, not just declared. */}
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
                <th className="hidden py-1.5 font-medium sm:table-cell">Owner</th>
                <th className="hidden py-1.5 text-right font-medium md:table-cell">Score</th>
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
                  <td className="hidden py-1.5 sm:table-cell">{i.owner ?? '—'}</td>
                  <td className="hidden py-1.5 text-right tabular-nums md:table-cell">
                    {i.priorityScore}
                  </td>
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
