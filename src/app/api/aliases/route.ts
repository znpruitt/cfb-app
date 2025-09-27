import { promises as fs } from 'fs';
import path from 'path';

/** Canonical alias map type */
type AliasMap = Record<string, string>;

/** Accepted PUT body shapes:
 * - Replace all: { map: AliasMap }
 * - Patch: { upserts?: AliasMap, deletes?: string[] }
 */
type PutBody =
  | { map: AliasMap; upserts?: never; deletes?: never }
  | { map?: never; upserts?: AliasMap; deletes?: string[] };

/* ---------- helpers ---------- */

function clampYearMaybe(s: string | null): number {
  const fallback = new Date().getFullYear();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function dataDir(): string {
  return path.join(process.cwd(), 'data');
}

function fileForYear(year: number): string {
  return path.join(dataDir(), `aliases-${year}.json`);
}

async function readAliases(year: number): Promise<AliasMap> {
  try {
    const p = fileForYear(year);
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const map: AliasMap = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k === 'string' && typeof v === 'string') map[k] = v;
      }
      return map;
    }
    return {};
  } catch {
    // File not found or unreadable: start with empty map
    return {};
  }
}

async function writeAliases(year: number, map: AliasMap): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  const p = fileForYear(year);
  await fs.writeFile(p, JSON.stringify(map, null, 2), 'utf8');
}

/* ---------- GET /api/aliases?year=YYYY ---------- */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));
  const map = await readAliases(year);
  return Response.json({ year, map });
}

/* ---------- PUT /api/aliases?year=YYYY ---------- */
export async function PUT(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const year = clampYearMaybe(url.searchParams.get('year'));

  let bodyUnknown: unknown;
  try {
    bodyUnknown = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  // Type guards
  const isAliasMap = (x: unknown): x is AliasMap =>
    !!x &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    Object.entries(x as Record<string, unknown>).every(
      ([k, v]) => typeof k === 'string' && typeof v === 'string'
    );

  const isStringArray = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every((v) => typeof v === 'string');

  // Narrow the body to PutBody
  let body: PutBody | null = null;
  if (bodyUnknown && typeof bodyUnknown === 'object') {
    const obj = bodyUnknown as Record<string, unknown>;
    if ('map' in obj && isAliasMap(obj.map)) {
      body = { map: obj.map };
    } else if (
      ('upserts' in obj || 'deletes' in obj) &&
      (obj.upserts === undefined || isAliasMap(obj.upserts)) &&
      (obj.deletes === undefined || isStringArray(obj.deletes))
    ) {
      body = {
        upserts: (obj.upserts as AliasMap | undefined) ?? {},
        deletes: (obj.deletes as string[] | undefined) ?? [],
      };
    }
  }

  if (!body) {
    return new Response('Body must be { map } or { upserts, deletes }', {
      status: 400,
    });
  }

  // Load current aliases
  const current = await readAliases(year);

  // Apply either full replace or patch
  let next: AliasMap;
  if ('map' in body) {
    // Explicitly handle potential undefined with fallback (for TS satisfaction)
    const fullMap: AliasMap = body.map ?? {};
    next = fullMap;
  } else {
    next = { ...current };

    const upserts = body.upserts ?? {};
    for (const [k, v] of Object.entries(upserts)) {
      next[String(k).toLowerCase()] = String(v);
    }

    const deletes = body.deletes ?? [];
    for (const k of deletes) {
      const key = String(k).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        delete next[key];
      }
    }
  }

  await writeAliases(year, next);
  return Response.json({ year, map: next });
}
