export default function InsightsLoading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <div className="animate-pulse">
        {/* Back link placeholder */}
        <div className="mb-4 h-3 w-16 rounded bg-gray-200 dark:bg-zinc-800" />
        {/* "All Insights" heading placeholder */}
        <div className="mb-4 h-8 w-36 rounded bg-gray-200 dark:bg-zinc-800" />
        {/* Insight rows — matches AllInsightsRow min-h-[44px] structure */}
        <div>
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="flex min-h-[44px] items-start gap-3 border-b border-gray-200 py-2.5 last:border-b-0 dark:border-zinc-800"
            >
              {/* Category label + title + description */}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-2.5 w-16 rounded bg-gray-200 dark:bg-zinc-800" />
                <div
                  className="h-4 rounded bg-gray-200 dark:bg-zinc-800"
                  style={{ width: `${55 + (i % 5) * 9}%` }}
                />
                <div
                  className="h-3 rounded bg-gray-200 dark:bg-zinc-800"
                  style={{ width: `${40 + (i % 4) * 10}%` }}
                />
              </div>
              {/* Arrow indicator */}
              <div className="mt-1 h-3.5 w-3 shrink-0 rounded bg-gray-200 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
