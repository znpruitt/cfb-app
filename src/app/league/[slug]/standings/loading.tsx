export default function StandingsLoading() {
  return (
    <div className="animate-pulse space-y-5 bg-white p-4 sm:p-6 dark:bg-zinc-950">
      {/* Header — mirrors CFBScheduleApp header structure */}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:flex-nowrap">
          {/* League name + season subtitle */}
          <div className="min-w-0 flex-1 md:flex-none">
            <div className="h-6 w-40 rounded bg-gray-200 dark:bg-zinc-800" />
            <div className="mt-1.5 h-4 w-24 rounded bg-gray-200 dark:bg-zinc-800" />
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

      {/* Content — standings table */}
      <div className="space-y-3">
        {/* Sub-tab row (Table / Trends) */}
        <div className="flex gap-6 border-b border-gray-200 pb-2 dark:border-zinc-700">
          <div className="h-3.5 w-10 rounded bg-gray-200 dark:bg-zinc-800" />
          <div className="h-3.5 w-10 rounded bg-gray-200 dark:bg-zinc-800" />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-zinc-800">
          {/* Column header row */}
          <div className="flex items-center gap-4 border-b border-gray-200 px-4 py-2.5 dark:border-zinc-800">
            <div className="h-3 w-4 rounded bg-gray-200 dark:bg-zinc-800" />
            <div className="h-3 flex-1 rounded bg-gray-200 dark:bg-zinc-800" />
            <div className="h-3 w-8 rounded bg-gray-200 dark:bg-zinc-800" />
            <div className="h-3 w-10 rounded bg-gray-200 dark:bg-zinc-800" />
            <div className="h-3 w-10 rounded bg-gray-200 dark:bg-zinc-800" />
            <div className="h-3 w-8 rounded bg-gray-200 dark:bg-zinc-800" />
          </div>
          {/* Data rows */}
          {Array.from({ length: 14 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-zinc-800/60"
            >
              <div className="h-3 w-4 rounded bg-gray-200 dark:bg-zinc-800" />
              <div
                className="h-3 flex-1 rounded bg-gray-200 dark:bg-zinc-800"
                style={{ maxWidth: `${60 + (i % 4) * 15}px` }}
              />
              <div className="h-3 w-8 rounded bg-gray-200 dark:bg-zinc-800" />
              <div className="h-3 w-10 rounded bg-gray-200 dark:bg-zinc-800" />
              <div className="h-3 w-10 rounded bg-gray-200 dark:bg-zinc-800" />
              <div className="h-3 w-8 rounded bg-gray-200 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
