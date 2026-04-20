export default function HistoryLoading() {
  return (
    <div className="animate-pulse space-y-5 bg-white p-4 sm:p-6 dark:bg-zinc-950">
      {/* Header — mirrors LeaguePageShell header structure */}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:flex-nowrap">
          {/* League name + founded year subtitle */}
          <div className="min-w-0 flex-1 md:flex-none">
            <div className="h-6 w-40 rounded bg-gray-200 dark:bg-zinc-800" />
            <div className="mt-1.5 h-4 w-20 rounded bg-gray-200 dark:bg-zinc-800" />
          </div>
          {/* Tab nav */}
          <div className="w-full md:flex md:w-auto md:flex-1 md:flex-col md:items-end">
            <div className="flex items-center gap-6 border-b border-gray-200 pb-2.5 dark:border-zinc-700">
              <div className="h-3.5 w-14 rounded bg-gray-200 dark:bg-zinc-800" />
              <div className="h-3.5 w-16 rounded bg-gray-200 dark:bg-zinc-800" />
              <div className="h-3.5 w-16 rounded bg-gray-200 dark:bg-zinc-800" />
              <div className="h-3.5 w-14 rounded bg-gray-200 dark:bg-zinc-800" />
              <div className="h-4 w-px bg-gray-300 dark:bg-zinc-600" />
              <div className="h-3.5 w-12 rounded bg-gray-200 dark:bg-zinc-800" />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-5xl">
        {/* Championships banner */}
        <div className="h-24 rounded-xl bg-gray-200 dark:bg-zinc-800" />

        {/* Two-column grid — left 60% / right 40% */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Left column */}
          <div className="flex flex-col gap-6 lg:col-span-3">
            {/* All-time standings table */}
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-zinc-800">
              {/* Table header */}
              <div className="flex items-center gap-4 border-b border-gray-200 px-4 py-2.5 dark:border-zinc-800">
                <div className="h-3 w-4 rounded bg-gray-200 dark:bg-zinc-800" />
                <div className="h-3 flex-1 rounded bg-gray-200 dark:bg-zinc-800" />
                <div className="h-3 w-8 rounded bg-gray-200 dark:bg-zinc-800" />
                <div className="h-3 w-10 rounded bg-gray-200 dark:bg-zinc-800" />
                <div className="h-3 w-10 rounded bg-gray-200 dark:bg-zinc-800" />
              </div>
              {/* Table rows */}
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-zinc-800/60"
                >
                  <div className="h-3 w-4 rounded bg-gray-200 dark:bg-zinc-800" />
                  <div
                    className="h-3 flex-1 rounded bg-gray-200 dark:bg-zinc-800"
                    style={{ maxWidth: `${55 + (i % 5) * 12}px` }}
                  />
                  <div className="h-3 w-8 rounded bg-gray-200 dark:bg-zinc-800" />
                  <div className="h-3 w-10 rounded bg-gray-200 dark:bg-zinc-800" />
                  <div className="h-3 w-10 rounded bg-gray-200 dark:bg-zinc-800" />
                </div>
              ))}
            </div>

            {/* Season list panel */}
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-zinc-800">
              <div className="border-b border-gray-200 px-4 py-3 dark:border-zinc-800">
                <div className="h-4 w-28 rounded bg-gray-200 dark:bg-zinc-800" />
              </div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-zinc-800/60"
                >
                  <div className="h-3 w-10 rounded bg-gray-200 dark:bg-zinc-800" />
                  <div className="h-3 w-24 rounded bg-gray-200 dark:bg-zinc-800" />
                  <div className="ml-auto h-3 w-16 rounded bg-gray-200 dark:bg-zinc-800" />
                </div>
              ))}
            </div>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            {/* Head-to-head panel */}
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-zinc-800">
              <div className="border-b border-gray-200 px-4 py-3 dark:border-zinc-800">
                <div className="h-4 w-32 rounded bg-gray-200 dark:bg-zinc-800" />
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-zinc-800/60"
                >
                  <div className="h-3 w-20 rounded bg-gray-200 dark:bg-zinc-800" />
                  <div className="h-3 w-8 rounded bg-gray-200 dark:bg-zinc-800" />
                  <div className="h-3 w-20 rounded bg-gray-200 dark:bg-zinc-800" />
                </div>
              ))}
            </div>

            {/* Most-improved panel */}
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-zinc-800">
              <div className="border-b border-gray-200 px-4 py-3 dark:border-zinc-800">
                <div className="h-4 w-28 rounded bg-gray-200 dark:bg-zinc-800" />
              </div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-zinc-800/60"
                >
                  <div className="h-3 w-24 rounded bg-gray-200 dark:bg-zinc-800" />
                  <div className="ml-auto h-3 w-14 rounded bg-gray-200 dark:bg-zinc-800" />
                </div>
              ))}
            </div>

            {/* Dynasty / drought panel */}
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-zinc-800">
              <div className="border-b border-gray-200 px-4 py-3 dark:border-zinc-800">
                <div className="h-4 w-36 rounded bg-gray-200 dark:bg-zinc-800" />
              </div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-zinc-800/60"
                >
                  <div className="h-3 w-24 rounded bg-gray-200 dark:bg-zinc-800" />
                  <div className="ml-auto h-3 w-12 rounded bg-gray-200 dark:bg-zinc-800" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
