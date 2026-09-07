// The PROCESS-facing half of the shared QStash schedule policy (PLATFORM-102
// slice 4). Everything here touches `process`, the filesystem, or a devDependency;
// everything in `./qstashSchedule.ts` is pure policy with NO imports at all.
//
// WHY THE SPLIT EXISTS, and it is not tidiness. Slice 4's daily planner route
// drives the SAME orchestration an operator drives — `runManageSchedule` decides
// how a QStash mutation is confirmed, and one place must decide that or the
// planner and the CLI can report the same event differently. That made
// `qstashSchedule.ts` a module a Next.js route imports. It could not be: it
// imported `dotenv`, which is a devDependency, so a production bundle reaching it
// would fail to resolve at build time — and `node:path`, which has no business in
// a route bundle either. Both existed solely for {@link runScheduleCli}. Moving
// that one function out leaves the policy module import-free and importable from
// the server, and leaves the CLI wrapper where its dependencies belong.

import path from 'node:path';

import dotenv from 'dotenv';

import {
  runManageSchedule,
  scrubSecrets,
  type FetchLike,
  type RecordedIntentReader,
  type ScheduleContract,
} from './qstashSchedule.ts';

export type ScheduleCliOptions = {
  /**
   * Supplied ONLY by the two planner-owned jobs (PLATFORM-102 slice 4). Every
   * other script omits it, so `resolveExpectedContract` resolves `fixed` and the
   * five unowned schedules behave exactly as they did before the planner existed.
   *
   * It is wired HERE rather than in the contract because reading the record needs
   * a database client, and the policy module's whole safety argument is that it
   * carries neither a store nor an application import.
   */
  readRecordedIntent?: RecordedIntentReader;
};

/**
 * The process-facing CLI wrapper shared by every job script: load env, run the
 * contract's orchestration with native fetch, and set `process.exitCode` (never
 * `process.exit()`, which can truncate buffered output). An unexpected exception
 * prints only the job's opaque failure tag; its scrubbed detail appears solely
 * when the job's debug env var is `1`. Job scripts call this under their own
 * `import.meta`/`process.argv[1]` invoked-directly guard so importing the
 * module for tests never triggers it.
 */
export async function runScheduleCli(
  contract: ScheduleContract,
  options: ScheduleCliOptions = {}
): Promise<void> {
  // `.env.local` (gitignored, operator-held) wins; `.env` fills gaps. QSTASH_TOKEN
  // lives here or in the shell for an OPERATOR run. Since PLATFORM-102 slice 4 the
  // deployed planner also holds one in the Vercel environment; that is a second
  // copy of the same credential, not a move, and this file is still never a place
  // to commit one.
  dotenv.config({ path: path.join(process.cwd(), '.env.local') });
  dotenv.config();
  // `.env.operator.local` IS NOT LOADED HERE, and that is the point. It holds the
  // full-privilege production `DATABASE_URL` alongside the read-only one, so
  // loading it for all ten CLIs put a production WRITE credential in the process
  // of six jobs that never touch the store — and, worse, made `appStateStore`'s
  // local-file fallback stop applying, so anything in a CLI path that reached the
  // store would have written to PRODUCTION. `plannerIntentReader` reads the one key
  // it needs, out of a private object, and never through `process.env`.

  const nativeFetch: FetchLike = async (url, init) => {
    const res = await fetch(url, { method: init.method, headers: init.headers, cache: 'no-store' });
    return { status: res.status, json: () => res.json() };
  };

  let code = 1;
  try {
    code = await runManageSchedule(contract, {
      argv: process.argv.slice(2),
      env: process.env,
      fetchImpl: nativeFetch,
      log: (line) => console.log(line),
      errorLog: (line) => console.error(line),
      ...(options.readRecordedIntent ? { readRecordedIntent: options.readRecordedIntent } : {}),
    });
  } catch (err) {
    // Even the explicit debug channel scrubs the actual credential values, so an
    // unexpected exception whose message contains a token/secret cannot print it.
    const detail =
      process.env[contract.debugEnvVar] === '1' && err instanceof Error
        ? `: ${scrubSecrets(err.message, process.env)}`
        : '';
    console.error(
      `unexpected error [${contract.failureTag}] (set ${contract.debugEnvVar}=1 for detail)${detail}`
    );
    code = 1;
  }
  // Set exitCode and let the event loop drain rather than process.exit(), which
  // can truncate buffered stdout/stderr (the inspect summary) when output is
  // piped or redirected.
  process.exitCode = code;
}
