// How an operator credential is read, in one place (PLATFORM-620 sibling; issue
// #703).
//
// Two files, two privileges, and the split is the point. `.env.operator.local`
// carried BOTH the read-only rail and a production read-WRITE `DATABASE_URL`,
// and `CLAUDE.md` instructs copying it into every worktree — so the write
// credential was present in both implementation lanes by setup instruction, and
// the only guardrail against an unauthorised production write was agent
// compliance. During Item 110A's review a lane could not rule out that one of
// its own forked review agents had written to production; the write turned out to
// be the owner's authorised apply, but the investigation was reasonable precisely
// because nothing made it impossible.
//
// NEITHER READER PUTS ANYTHING IN `process.env`. `dotenv`'s `processEnv` option
// is what makes that true: each takes the one key it needs into a private object,
// so a file that holds two credentials cannot hand a process the one it has no
// business having.

import path from 'node:path';

import dotenv from 'dotenv';

/** The read-only rail: `audit_ro`, CONNECT/USAGE/SELECT, on the RO endpoint. */
export const OPERATOR_READ_ENV_FILE = '.env.operator.local';

/**
 * The production write credential. Deliberately a SEPARATE file, and deliberately
 * NOT part of the new-worktree setup instruction — its absence from a lane is the
 * guarantee, and agent compliance is what it replaces.
 */
export const OPERATOR_WRITE_ENV_FILE = '.env.operator.write.local';

/**
 * The operator's read-only credential, read out of `.env.operator.local` WITHOUT
 * touching `process.env`.
 *
 * `dotenv`'s `processEnv` option is what makes that true: the file also holds the
 * full-privilege `DATABASE_URL`, and an earlier version of PLATFORM-102 slice 4
 * loaded the whole file into the environment of all ten CLIs — putting a
 * production write credential in six processes that never touch the store, and
 * disabling `appStateStore`'s local-file fallback so a stray store call would have
 * written to production. Only the one key this reader needs is taken, and only
 * into a private object.
 *
 * A value already in the ambient environment still wins, so a deployed or
 * shell-exported context works without the file. `directory` exists so a test can
 * point the lookup at a fixture — without it, "the file is absent" is a claim about
 * the machine running the suite rather than about this function.
 */
export function operatorReadOnlyEnv(
  ambient: Record<string, string | undefined> = process.env,
  directory: string = process.cwd()
): Record<string, string | undefined> {
  if (ambient.DATABASE_URL_RO?.trim()) return { DATABASE_URL_RO: ambient.DATABASE_URL_RO };
  const parsed: Record<string, string> = {};
  dotenv.config({ path: path.join(directory, OPERATOR_READ_ENV_FILE), processEnv: parsed });
  return { DATABASE_URL_RO: parsed.DATABASE_URL_RO };
}

/**
 * The operator's WRITE credential, read out of `.env.operator.write.local` the
 * same way — one key, private object, `process.env` untouched.
 *
 * Returns `null` rather than throwing so the caller can refuse with a message
 * that names the file; see {@link OPERATOR_WRITE_CREDENTIAL_REFUSAL}, and note
 * that a caller which merely warns and continues would land on the local file
 * fallback, which is not what an operator asking to write production wants.
 */
export function operatorWriteConnectionString(
  ambient: Record<string, string | undefined> = process.env,
  directory: string = process.cwd()
): string | null {
  if (ambient.DATABASE_URL?.trim()) return ambient.DATABASE_URL;
  const parsed: Record<string, string> = {};
  dotenv.config({ path: path.join(directory, OPERATOR_WRITE_ENV_FILE), processEnv: parsed });
  return parsed.DATABASE_URL?.trim() ? parsed.DATABASE_URL : null;
}

/**
 * THE PROHIBITION IS IN THE ERROR TEXT, NOT ONLY IN `CLAUDE.md`. The person
 * reading this is, by definition, not reading the docs — and a message that says
 * only "missing credential" is exactly how the next operator reaches for
 * `vercel env pull`, which writes every production secret to disk to supply one.
 * That is the thing the read-only rail exists to prevent.
 */
export const OPERATOR_WRITE_CREDENTIAL_REFUSAL =
  `${OPERATOR_WRITE_ENV_FILE} is not present. It holds DATABASE_URL, used only by ` +
  '`apply --apply`. Copy it from the Neon primary connection string. Do NOT run ' +
  '`vercel env pull` — it writes every production secret to disk to supply one.';

/**
 * The refusal for the READ side, in the same shape and for the same reason: an
 * operator without the rail must be told which file and which key, or the next
 * move is the one above.
 */
export const OPERATOR_READ_CREDENTIAL_REFUSAL =
  `${OPERATOR_READ_ENV_FILE} does not supply DATABASE_URL_RO, and every read here goes ` +
  'through that read-only rail. Copy it from the Neon RO endpoint using the DIRECT host, ' +
  'not `-pooler`. Do NOT run `vercel env pull` — it writes every production secret to disk ' +
  'to supply one, and the write credential is not what this needs.';
