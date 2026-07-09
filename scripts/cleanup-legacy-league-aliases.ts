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

import path from 'node:path';

import dotenv from 'dotenv';

import { getAppStateStorageStatus } from '../src/lib/server/appStateStore.ts';
import {
  cleanupLegacyLeagueScopedAliases,
  reportLegacyLeagueScopedAliases,
} from '../src/lib/server/legacyAliasCleanup.ts';

async function main(): Promise<void> {
  // Load durable-storage env BEFORE any app-state access. Without this the store
  // silently falls back to a local file and the cleanup would operate on an empty
  // dev store instead of the real (Postgres) data. `.env.local` wins over `.env`.
  dotenv.config({ path: path.join(process.cwd(), '.env.local') });
  dotenv.config();

  // Fail loudly if we are not pointed at the shared durable store. This script
  // mutates production alias data — it must never run against the file fallback.
  const storage = getAppStateStorageStatus();
  if (storage.mode !== 'postgres') {
    console.error(
      `Refusing to run: app-state storage mode is "${storage.mode}", not "postgres". ` +
        'Set DATABASE_URL (and any PG* vars) so this operates on the real durable store.'
    );
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');

  const report = await reportLegacyLeagueScopedAliases();
  console.log(`Alias migration complete: ${report.migrationDone ? 'yes' : 'no'}`);
  console.log(`Legacy league-scoped alias keys found: ${report.scopes.length}`);
  for (const s of report.scopes) {
    console.log(
      `  ${s.scope} — ${s.entryCount} entr${s.entryCount === 1 ? 'y' : 'ies'} ` +
        `(${s.seedCopyCount} seed-copy, ${s.promotedRepairCount} promoted, ` +
        `${s.unpromotedRepairCount} un-promoted) → ` +
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
