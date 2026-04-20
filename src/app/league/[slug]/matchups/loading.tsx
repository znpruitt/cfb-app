export default function MatchupsLoading() {
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

      {/* Content — matchups view */}
      <div className="space-y-3">
        {/* Summary bar */}
        <div className="h-9 rounded-lg bg-gray-200 dark:bg-zinc-800" />
        {/* Week selector pills */}
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-8 w-12 shrink-0 rounded-md bg-gray-200 dark:bg-zinc-800" />
          ))}
        </div>
        {/* Sub-view tabs (Matchups / Schedule / Matrix) */}
        <div className="flex gap-6 border-b border-gray-200 pb-2 dark:border-zinc-700">
          <div className="h-3.5 w-16 rounded bg-gray-200 dark:bg-zinc-800" />
          <div className="h-3.5 w-14 rounded bg-gray-200 dark:bg-zinc-800" />
          <div className="h-3.5 w-12 rounded bg-gray-200 dark:bg-zinc-800" />
        </div>
        {/* Matchup cards grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-xl border border-gray-200 p-4 dark:border-zinc-800"
            >
              {/* Team row A */}
              <div className="flex items-center gap-3">
                <div className="h-6 w-6 rounded-full bg-gray-200 dark:bg-zinc-800" />
                <div className="h-3.5 w-28 rounded bg-gray-200 dark:bg-zinc-800" />
                <div className="ml-auto h-3.5 w-8 rounded bg-gray-200 dark:bg-zinc-800" />
              </div>
              {/* Divider */}
              <div className="h-px bg-gray-100 dark:bg-zinc-800" />
              {/* Team row B */}
              <div className="flex items-center gap-3">
                <div className="h-6 w-6 rounded-full bg-gray-200 dark:bg-zinc-800" />
                <div className="h-3.5 w-24 rounded bg-gray-200 dark:bg-zinc-800" />
                <div className="ml-auto h-3.5 w-8 rounded bg-gray-200 dark:bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
