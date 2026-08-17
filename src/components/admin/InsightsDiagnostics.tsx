import React from 'react';

import type { InsightFate, InsightsDiagnostics } from '@/lib/server/insightsDiagnostics';
import type { LeagueMembersSource } from '@/lib/insights/types';

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

/**
 * A caption for EVERY source. Written as a total record rather than a ternary
 * chain because the chain silently absorbed a fourth value: `current-roster` —
 * the source for every in-season league — fell through to the "neither exists"
 * message and printed it directly above the owners it had just said do not
 * exist. Exactly the wrong inference this section was added to prevent.
 *
 * `Record<LeagueMembersSource, string>` makes the compiler refuse a new source
 * without a caption.
 */
const MEMBERSHIP_SOURCE_CAPTION: Record<LeagueMembersSource, string> = {
  confirmed: 'From the confirmed owner list — a new roster has been named for this season.',
  'official-roster':
    'No confirmed list for this season, so the season’s team-by-team roster is standing in for one.',
  'partial-roster':
    'The season’s roster names only one owner — too few to confirm a league, so anything named here rests on a single person.',
  'previous-roster': 'No new roster named yet, so last season’s owners are still the league.',
  none: 'Neither a confirmed owner list nor a roster exists — no insights can name anyone.',
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

  if (model.contextError) {
    return (
      <div className="space-y-4">
        {/* Light base, dark variant — the repo's admin error pattern
            (AssignmentMethodCard, ScoreAttachmentRecoveryPanel). The first
            version was dark-only, copied from a draft surface that is always
            dark: in light mode `bg-red-950/30` over white sits at roughly the
            same luminance as `text-red-300`, making the ONE message this page
            exists to deliver in a failure state effectively invisible. */}
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
        >
          The insights context could not be built for {model.slug} {model.year}, so there is nothing
          to diagnose — and the league&apos;s feed is empty for the same reason.
        </p>
        <p className="font-mono text-xs break-all text-gray-600 dark:text-zinc-400">
          {model.contextError}
        </p>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          This is a store read failure (owners, standings or archives), not an absence of content.
          The public feed degrades quietly to empty in this state; this page is where it is supposed
          to be visible.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-gray-500 dark:text-zinc-400">
        {model.slug} · {model.year} · lifecycle{' '}
        <span className="font-medium text-gray-700 dark:text-zinc-200">{model.lifecycleState}</span>
      </div>

      {/* WHO the engine thinks is playing. First, because an unchanged feed means
          nothing until you know whether membership reached the engine at all. */}
      <section className="border-b border-gray-200 pb-4 dark:border-zinc-800">
        <h2 className="mb-1 text-sm font-semibold">
          In the league{' '}
          <span className="font-normal text-gray-500 dark:text-zinc-400">
            ({model.membership.owners.length})
          </span>
        </h2>
        <p className="mb-2 text-xs text-gray-500 dark:text-zinc-400">
          {MEMBERSHIP_SOURCE_CAPTION[model.membership.source]}
        </p>
        {model.membership.owners.length > 0 ? (
          <p className="text-sm">{model.membership.owners.join(', ')}</p>
        ) : (
          <p className="text-sm text-gray-500 dark:text-zinc-400">Nobody.</p>
        )}
        {/* WHY membership-change cards are or are not published. The generic
            `gated` badge in the generator table cannot say whether the draft is
            simply not confirmed yet — the ordinary preseason state, with nothing
            to fix — or whether something else stopped it. Neutral emphasis, not
            amber: DESIGN.md reserves amber/gold for champion/podium signals. */}
        <p className="mt-2 text-xs text-gray-500 dark:text-zinc-400">
          Membership changes:{' '}
          {model.membership.seasonOwners ? (
            <>
              <span className="font-medium text-gray-700 dark:text-zinc-200">publishable</span> —{' '}
              {model.membership.seasonOwners.year} draft confirmed, naming{' '}
              {model.membership.seasonOwners.owners.length} owners. (Cards still need archived
              seasons to compare against, so this is what the feed MAY say, not what it will.)
            </>
          ) : (
            <>
              <span className="font-medium text-gray-700 dark:text-zinc-200">withheld</span> — no
              confirmed draft for this season, so who is playing is not settled. Nothing to fix; the
              cards appear once the draft is confirmed.
            </>
          )}
        </p>
      </section>

      {/* The funnel. Three numbers, in the order the feed passes through them. */}
      <div className="grid grid-cols-3 gap-4 border-y border-gray-200 py-4 dark:border-zinc-800">
        <Stat value={counts.generated} label="Generated" hint="by all generators" />
        <Stat value={counts.served} label="On All Insights" hint={`cap ${counts.servedCap}`} />
        <Stat
          value={counts.onOverview}
          label="On the Overview"
          hint={
            counts.overviewSlotsUnfilledByEngine > 0
              ? `${counts.overviewSlotsUnfilledByEngine} of ${counts.renderedCap} slots unfilled`
              : `cap ${counts.renderedCap}`
          }
        />
      </div>

      {/* The one conclusion the page exists to state, since INSIGHTS-023 and
          INSIGHTS-018 both turn on it. */}
      {counts.overviewSlotsUnfilledByEngine > 0 && (
        <p className="text-sm text-gray-600 dark:text-zinc-300">
          The engine fills {counts.onOverview} of the Overview&apos;s {counts.renderedCap} slots.
          The Overview may substitute fallback cards derived from standings for some of the rest, so
          what a reader sees there is not a measure of insight coverage. It substitutes nothing
          before any games are played.
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
