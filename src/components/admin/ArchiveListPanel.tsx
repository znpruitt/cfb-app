import { getLeagues } from '@/lib/leagueRegistry';
import { listSeasonArchives } from '@/lib/seasonArchive';

export default async function ArchiveListPanel() {
  const leagues = await getLeagues();

  if (leagues.length === 0) {
    return (
      <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-5">
        <h2 className="mb-2 text-base font-semibold text-zinc-100">Season Archives</h2>
        <p className="text-sm text-zinc-400">No leagues configured.</p>
      </section>
    );
  }

  const archiveData = await Promise.all(
    leagues.map(async (league) => ({
      league,
      archivedYears: await listSeasonArchives(league.slug),
    }))
  );

  return (
    <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-5">
      <h2 className="mb-4 text-base font-semibold text-zinc-100">Season Archives</h2>
      <div className="space-y-4">
        {archiveData.map(({ league, archivedYears }) => {
          const sorted = [...archivedYears].sort((a, b) => b - a);
          return (
            <div key={league.slug}>
              <p className="mb-1 text-sm font-medium text-zinc-200">
                {league.displayName}
                <span className="ml-2 font-mono text-xs text-zinc-500">/{league.slug}</span>
              </p>
              {sorted.length === 0 ? (
                <p className="text-sm text-zinc-500">No archives yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {sorted.map((year) => (
                    <span
                      key={year}
                      className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300"
                    >
                      {year}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
