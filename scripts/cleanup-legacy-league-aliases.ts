// Legacy league-scoped alias cleanup (PLATFORM-081).
//
// Discovers redundant `aliases:${slug}:${year}` app-state keys — legacy storage
// no runtime path reads (PLATFORM-067) — and, with --apply, deletes the ones
// proven redundant. Never touches `aliases:global`, `aliases:${year}`, or any
// non-alias scope.
//
// Usage:
//   tsx scripts/cleanup-legacy-league-aliases.ts            # dry run (report only)
//   tsx scripts/cleanup-legacy-league-aliases.ts --apply    # delete redundant keys
//
// Requires the same durable-storage env (DATABASE_URL, etc.) as the app so it
// reads/writes the real app-state store. Run the dry run first and review it.

import {
  cleanupLegacyLeagueScopedAliases,
  reportLegacyLeagueScopedAliases,
} from '../src/lib/server/legacyAliasCleanup.ts';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const report = await reportLegacyLeagueScopedAliases();
  console.log(`Alias migration complete: ${report.migrationDone ? 'yes' : 'no'}`);
  console.log(`Legacy league-scoped alias keys found: ${report.scopes.length}`);
  for (const s of report.scopes) {
    console.log(
      `  ${s.scope} — ${s.entryCount} entr${s.entryCount === 1 ? 'y' : 'ies'} ` +
        `(${s.seedCopyCount} seed-copy, ${s.manualRepairCount} manual) → ` +
        `${s.safeToDelete ? 'SAFE to delete' : 'SKIP (un-promoted manual repairs)'}`
    );
  }

  if (report.scopes.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  const result = await cleanupLegacyLeagueScopedAliases({ apply });
  console.log('');
  if (apply) {
    console.log(`Deleted ${result.deleted.length} key(s):`);
    for (const scope of result.deleted) console.log(`  deleted ${scope}`);
  } else {
    console.log('Dry run — no keys deleted. Re-run with --apply to delete SAFE keys.');
  }
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length}:`);
    for (const { scope, reason } of result.skipped) console.log(`  skipped ${scope} — ${reason}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
