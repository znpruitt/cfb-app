/* scripts/fetch-cfbd-teams.ts
 * Build a local team catalog with smart aliases by combining CFBD data + derived variants
 * Run: npx tsx scripts/fetch-cfbd-teams.ts --year 2025
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

// Load .env.local explicitly (fallback .env)
const root = process.cwd();
const envLocal = path.join(root, '.env.local');
if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
} else {
  dotenv.config();
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env var ${name}. Add it to .env.local or .env`);
  return v.trim();
}

type CFBDTeam = {
  id: number;
  school: string; // "San José State"
  mascot?: string | null; // "Spartans"
  conference?: string | null; // "Mountain West"
};

type CatalogItem = {
  school: string;
  mascot: string | null;
  conference: string | null;
  alts: string[]; // lowercased, deduped aliases
};

const yearArg = (() => {
  const i = process.argv.indexOf('--year');
  if (i >= 0 && process.argv[i + 1]) return Number.parseInt(process.argv[i + 1]!, 10);
  return new Date().getFullYear();
})();

/** Lightweight normalizers & alias builders **/
const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const soft = (s: string) => stripDiacritics(s).toLowerCase().trim();

function withoutUniversityPhrases(s: string): string {
  // Collapse "University of", "Univ", "&", etc.
  return s
    .replace(/\b(university|univ)\b/gi, ' ')
    .replace(/\bof\b/gi, ' ')
    .replace(/\band\b/gi, ' ')
    .replace(/&/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function swapStateAbbrev(s: string): string[] {
  // Turn "State" into "St" and "St." variants
  if (!/state/i.test(s)) return [];
  const base = s
    .replace(/\bstate\b/gi, 'st')
    .replace(/\s+/g, ' ')
    .trim();
  const withDot = base.replace(/\bst\b/gi, 'st.');
  return [base, withDot];
}

function amVariants(s: string): string[] {
  // Texas A&M special cases
  if (!/a&m/i.test(s)) return [];
  const noAmp = s.replace(/a&m/gi, 'a and m');
  const amPlain = s.replace(/a&m/gi, 'am');
  return [noAmp, amPlain];
}

function knownShorts(school: string): string[] {
  // A few curated short names that help real-world CSVs
  const m = new Map<string, string[]>([
    ['appalachian state', ['app state', 'app st']],
    ['san jose state', ['sjsu']],
    ['connecticut', ['uconn']],
    ['massachusetts', ['umass']],
    ['central florida', ['ucf']],
    ['brigham young', ['byu']],
    ['southern methodist', ['smu']],
    ['texas san antonio', ['utsa']],
    ['louisiana monroe', ['ul monroe']],
    ['southeastern louisiana', ['se louisiana']],
    ['albany', ['ualbany']],
    ['washington state', ['wash st']],
    ['colorado state', ['colorado st']],
  ]);
  const key = soft(school);
  return m.get(key) ?? [];
}

function buildDerivedAlts(school: string, mascot?: string | null): string[] {
  const s0 = soft(school);
  const s1 = soft(withoutUniversityPhrases(school)); // remove “University of”
  const diac = soft(stripDiacritics(school)); // accentless

  const withMascot =
    mascot && mascot.trim()
      ? [
          `${s0} ${soft(mascot)}`, // "san jose state spartans"
          `${s1} ${soft(mascot)}`, // "san jose spartans"
        ]
      : [];

  const stAlts = [...swapStateAbbrev(school).map(soft), ...swapStateAbbrev(s1).map(soft)];

  const amAlts = [...amVariants(school).map(soft), ...amVariants(s1).map(soft)];

  const shorts = knownShorts(school);

  const basePieces = new Set<string>([
    s0, // "san josé state"
    diac, // "san jose state"
    s1, // "san jose state" (without university/of/etc)
    ...withMascot, // "san jose state spartans", "san jose spartans"
    ...stAlts, // "san jose st", "san jose st."
    ...amAlts, // "texas a and m", "texas am"
    ...shorts, // curated short names eg "sjsu", "app state"
  ]);

  // Also add tokens-first join for 2-token schools (e.g., "ohio state" -> "ohiostate")
  for (const b of Array.from(basePieces)) {
    const tokens = b.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) basePieces.add(tokens[0] + tokens[1]);
    if (tokens.length >= 3) basePieces.add(tokens[0] + tokens[1] + tokens[2]);
  }

  // Filter empties and dedupe
  return Array.from(basePieces).filter(Boolean);
}

function mergeWithOverrides(items: CatalogItem[], overridesPath: string): CatalogItem[] {
  if (!fs.existsSync(overridesPath)) return items;

  type OverrideItem = {
    school: string; // canonical school name (case-insensitive match)
    add?: string[]; // aliases to add
    remove?: string[]; // aliases to remove (exact match after soft())
  };

  const raw = fs.readFileSync(overridesPath, 'utf8');
  const list = JSON.parse(raw) as OverrideItem[];

  const bySchool = new Map(items.map((it) => [soft(it.school), it]));

  for (const ov of list) {
    const key = soft(ov.school);
    const target = bySchool.get(key);
    if (!target) continue;

    const cur = new Set(target.alts);
    if (ov.add) ov.add.map(soft).forEach((a) => cur.add(a));
    if (ov.remove) ov.remove.map(soft).forEach((a) => cur.delete(a));
    target.alts = Array.from(cur);
  }

  return items;
}

async function main(): Promise<void> {
  const apiKey = requiredEnv('CFBD_API_KEY');

  const url = new URL('https://api.collegefootballdata.com/teams/fbs');
  url.searchParams.set('year', String(yearArg));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CFBD teams fetch failed: ${res.status} ${body}`);
  }

  const rows = (await res.json()) as CFBDTeam[];

  let items: CatalogItem[] = rows.map((r) => ({
    school: r.school,
    mascot: r.mascot ?? null,
    conference: r.conference ?? null,
    alts: buildDerivedAlts(r.school, r.mascot),
  }));

  // Optional overrides from src/data/alias-overrides.json
  const overridesPath = path.join(root, 'src', 'data', 'alias-overrides.json');
  items = mergeWithOverrides(items, overridesPath);

  // Output
  const outDir = path.join(root, 'src', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, 'teams.json');

  const payload = { year: yearArg, items };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`✓ Saved ${items.length} teams with aliases to:\n  - ${path.relative(root, outFile)}`);
}

main().catch((err) => {
  console.error('✗ fetch-cfbd-teams failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
