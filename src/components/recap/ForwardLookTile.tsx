'use client';

import { useId, useState } from 'react';
import { RecapHeader } from './RecapPrimitives';
import type { ForwardLook } from '@/lib/selectors/forwardLook';

export default function ForwardLookTile({ look }: { look: ForwardLook }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const panelId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-lg bg-zinc-900 px-6 py-6 sm:px-7">
      <RecapHeader
        headingId={headingId}
        headline={look.lines[0]?.title ?? `${look.weekLabel} ahead`}
        weekLabel={look.weekLabel}
        eyebrow="Forward look"
        compact
      />
      {look.lines.length > 0 ? (
        <>
          <div id={panelId} hidden={!expanded} className="mt-5 border-t border-zinc-800 pt-5">
            <ul className="grid gap-x-10 min-[821px]:grid-cols-2">
              {look.lines.map((line) => (
                <li key={line.id} className="border-b-[0.5px] border-zinc-800/80 py-[6px]">
                  <div className="flex items-baseline justify-between gap-3 text-[13.5px] font-medium text-zinc-100">
                    <span>{line.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                      {line.value}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400">{line.detail}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4">
            <button
              type="button"
              aria-controls={panelId}
              aria-expanded={expanded}
              className="text-[13px] text-blue-400 hover:underline"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? 'Collapse' : 'View the week ahead'}{' '}
              <span aria-hidden="true">{expanded ? '↑' : '→'}</span>
            </button>
          </div>
        </>
      ) : (
        <p className="mt-2 text-[13px] text-zinc-400">Follow {look.weekLabel} on the schedule.</p>
      )}
    </section>
  );
}
