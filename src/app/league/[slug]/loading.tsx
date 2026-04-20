export default function LeagueLoading() {
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
          {/* Tab nav — Overview / Standings / Matchups / Members | History */}
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

      {/* Content — overview card cluster */}
      <div className="space-y-3">
        {/* Summary bar */}
        <div className="h-9 rounded-lg bg-gray-200 dark:bg-zinc-800" />
        {/* Week selector pills */}
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-8 w-12 shrink-0 rounded-md bg-gray-200 dark:bg-zinc-800" />
          ))}
        </div>
        {/* Game card grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-gray-200 dark:bg-zinc-800" />
          ))}
        </div>
        {/* Insights strip header */}
        <div className="mt-1 h-5 w-28 rounded bg-gray-200 dark:bg-zinc-800" />
        {/* Insight rows */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-gray-200 dark:bg-zinc-800" />
        ))}
      </div>
    </div>
  );
}
