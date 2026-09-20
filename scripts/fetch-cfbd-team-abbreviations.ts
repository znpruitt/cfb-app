/*
 * Generate the client-safe, all-division CFBD team-abbreviation lookup.
 *
 * This is deliberately separate from both the FBS-only team catalog and the
 * Odds mascot-alias artifact. It makes exactly one provider request and requires
 * a pinned season:
 *   npm run fetch:team-abbreviations -- --year 2026
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import dotenv from 'dotenv';

import {
  fetchTeamAbbreviationArtifact,
  requirePinnedTeamAbbreviationSeason,
} from './lib/teamAbbreviationArtifact.ts';

const root = process.cwd();
const envLocal = path.join(root, '.env.local');
if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
} else {
  dotenv.config();
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing env var ${name}. Add it to .env.local or .env`);
  return value.trim();
}

async function main(): Promise<void> {
  const year = requirePinnedTeamAbbreviationSeason(process.argv);
  const artifact = await fetchTeamAbbreviationArtifact({
    year,
    apiKey: requiredEnv('CFBD_API_KEY'),
  });
  const outFile = path.join(root, 'src', 'data', 'team-abbreviations.json');
  fs.writeFileSync(outFile, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(
    `✓ Saved ${artifact.items.length} pinned ${year} team abbreviations to ${path.relative(
      root,
      outFile
    )}`
  );
}

main().catch((error) => {
  console.error(
    '✗ fetch-cfbd-team-abbreviations failed:',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
