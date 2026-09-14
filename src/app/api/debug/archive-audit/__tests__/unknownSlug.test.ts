import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';

/**
 * #778 — `archive-audit` must refuse a `leagueSlug` no league holds, BEFORE it
 * reads the archive.
 *
 * WHY THESE FIXTURES PLANT A REAL ARCHIVE UNDER THE UNKNOWN SLUG. Without one,
 * an unknown slug would 404 anyway — for "no archive found" — and a status-code
 * assertion could not tell the guard from the pre-existing behaviour. With the
 * archive planted, the route would answer 200 if the guard were absent, so the
 * 404 discriminates. It is also the shape the defect actually had: the read that
 * minted the cache entry ran to completion and only then found nothing.
 *
 * THE CACHE MINT ITSELF IS NOT OBSERVABLE FROM `node:test` — `unstable_cache`
 * throws `incrementalCache missing` here and `seasonArchive.ts` falls back to a
 * direct store read, so there is no data cache to inspect. That observation was
 * made against a running dev server under `NEXT_PRIVATE_DEBUG_CACHE=1` and is
 * recorded in the branch closeout. What these tests pin is the refusal that
 * makes the mint unreachable, and that the refusal precedes the read.
 */

const KNOWN_SLUG = 'audit-known';
const UNKNOWN_SLUG = 'audit-absent';
const YEAR = 2024;

async function plantArchive(slug: string, year: number): Promise<void> {
  await setAppState(`standings-archive:${slug}`, String(year), {
    leagueSlug: slug,
    year,
    archivedAt: '2025-01-01T00:00:00.000Z',
    ownerRosterSnapshot: 'team,owner\nTexas,Alice\n',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: [],
    games: [],
    scoresByKey: {},
  });
}

async function plantRegistry(slugs: readonly string[]): Promise<void> {
  await setAppState(
    'leagues',
    'registry',
    slugs.map((slug) => ({
      slug,
      displayName: slug,
      year: 2025,
      createdAt: '2020-01-01T00:00:00.000Z',
      status: { state: 'season' as const, year: 2025 },
    }))
  );
}

function request(slug: string, year: number): Request {
  return new Request(`http://localhost/api/debug/archive-audit?leagueSlug=${slug}&year=${year}`);
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('#778: archive-audit answers 404 league-not-found for a slug no league holds', async () => {
  // Registry holds a DIFFERENT league: the refusal is for naming an absent one,
  // not for an empty registry.
  await plantRegistry([KNOWN_SLUG]);
  await plantArchive(UNKNOWN_SLUG, YEAR);

  const res = await GET(request(UNKNOWN_SLUG, YEAR));
  assert.equal(res.status, 404);

  const body = await res.json();
  assert.equal(
    body.error,
    'league-not-found',
    'the refusal must match `insights-career-diagnostic`, not the "no archive found" 404'
  );
  assert.equal(body.leagueSlug, UNKNOWN_SLUG);
});

test('CONTROL: archive-audit serves the SAME planted archive once a league holds the slug', async () => {
  await plantRegistry([KNOWN_SLUG]);
  await plantArchive(KNOWN_SLUG, YEAR);

  const res = await GET(request(KNOWN_SLUG, YEAR));
  assert.equal(
    res.status,
    200,
    'without this the refusal above could pass on a fixture the route can never serve'
  );
});

test('#778: the refusal is NOT the "no archive found" 404 — the two stay distinguishable', async () => {
  // A real league with no archive for the year must still get the archive 404,
  // so the new branch cannot have swallowed the old one.
  await plantRegistry([KNOWN_SLUG]);

  const res = await GET(request(KNOWN_SLUG, YEAR));
  assert.equal(res.status, 404);

  const body = await res.json();
  assert.notEqual(body.error, 'league-not-found');
  assert.match(String(body.error), /No archive found/);
});
