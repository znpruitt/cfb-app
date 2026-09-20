import assert from 'node:assert/strict';
import test from 'node:test';

import teamAbbreviationArtifact from '@/data/team-abbreviations.json';
import teamCatalog from '@/data/teams.json';
import { getFBSTeams } from '@/lib/rosterUploadValidator';
import { selectDraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import {
  getTeamAbbreviation,
  TEAM_ABBREVIATIONS_SOURCE_URL,
  TEAM_ABBREVIATIONS_YEAR,
} from '@/lib/teamAbbreviations';
import type { TeamCatalogItem } from '@/lib/teamIdentity';

import {
  buildCfbdTeamAbbreviationsUrl,
  buildTeamAbbreviationArtifact,
  fetchTeamAbbreviationArtifact,
  requirePinnedTeamAbbreviationSeason,
  type TeamAbbreviationArtifact,
} from '../../../scripts/lib/teamAbbreviationArtifact.ts';

const PINNED_YEAR = 2026;
const PINNED_SOURCE_URL = 'https://api.collegefootballdata.com/teams?year=2026';
const CATALOG_CONSUMER_BOUNDARY_ASSERTION =
  'draft boards and owner validation observe the same FBS catalog boundary';
const committedArtifact = teamAbbreviationArtifact as TeamAbbreviationArtifact;

function assertCatalogConsumerBoundary(teams: TeamCatalogItem[]): void {
  const draftTeamIds = selectDraftTeamInsights({
    teams,
    schedule: [],
    apPoll: null,
    year: PINNED_YEAR,
  })
    .map((team) => team.teamId)
    .sort((left, right) => left.localeCompare(right));
  const ownerValidationTeamIds = getFBSTeams(teams).sort((left, right) =>
    left.localeCompare(right)
  );

  assert.deepEqual(draftTeamIds, ownerValidationTeamIds, CATALOG_CONSUMER_BOUNDARY_ASSERTION);
}

test('the generator requires an explicit season pin', () => {
  assert.throws(
    () => requirePinnedTeamAbbreviationSeason(['node', 'script']),
    /requires --year YYYY/
  );
  assert.equal(
    requirePinnedTeamAbbreviationSeason(['node', 'script', '--year', String(PINNED_YEAR)]),
    PINNED_YEAR
  );
});

test('artifact construction preserves every provider row and explicit null abbreviation', () => {
  const artifact = buildTeamAbbreviationArtifact({
    rows: [
      { school: 'Zulu State', abbreviation: undefined },
      { school: 'Alpha State', abbreviation: ' AS ' },
    ],
    year: PINNED_YEAR,
    generatedAt: '2026-09-20T00:00:00.000Z',
  });

  assert.deepEqual(artifact.items, [
    { school: 'Alpha State', abbreviation: 'AS' },
    { school: 'Zulu State', abbreviation: null },
  ]);
  assert.equal(artifact.sourceUrl, PINNED_SOURCE_URL);
});

test('artifact construction rejects malformed or duplicate provider rows', () => {
  assert.throws(
    () =>
      buildTeamAbbreviationArtifact({
        rows: [{ school: null, abbreviation: 'BAD' }],
        year: PINNED_YEAR,
      }),
    /row 0 is missing school/
  );
  assert.throws(
    () =>
      buildTeamAbbreviationArtifact({
        rows: [
          { school: 'Duplicate', abbreviation: 'DUP' },
          { school: 'Duplicate', abbreviation: 'DUP2' },
        ],
        year: PINNED_YEAR,
      }),
    /duplicate school: Duplicate/
  );
  assert.throws(
    () =>
      buildTeamAbbreviationArtifact({
        rows: [
          {
            school: 'Bad Abbreviation',
            abbreviation: 123 as unknown as string,
          },
        ],
        year: PINNED_YEAR,
      }),
    /non-string abbreviation/
  );
});

test('the generator fetches the exact pinned source once with no retry', async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const artifact = await fetchTeamAbbreviationArtifact({
    year: PINNED_YEAR,
    apiKey: 'test-key',
    generatedAt: '2026-09-20T00:00:00.000Z',
    fetchImpl: async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: input.toString(),
        authorization: headers.get('Authorization'),
      });
      return Response.json([{ school: 'Alpha State', abbreviation: 'AS' }]);
    },
  });

  assert.deepEqual(requests, [{ url: PINNED_SOURCE_URL, authorization: 'Bearer test-key' }]);
  assert.equal(artifact.sourceUrl, PINNED_SOURCE_URL);
});

test('the committed lookup pins its 2026 metadata and generated source URL', () => {
  assert.equal(committedArtifact.year, PINNED_YEAR);
  assert.equal(committedArtifact.sourceUrl, PINNED_SOURCE_URL);
  assert.equal(
    committedArtifact.sourceUrl,
    buildCfbdTeamAbbreviationsUrl(committedArtifact.year).toString()
  );
  assert.equal(TEAM_ABBREVIATIONS_YEAR, PINNED_YEAR);
  assert.equal(TEAM_ABBREVIATIONS_SOURCE_URL, PINNED_SOURCE_URL);
});

test('the committed lookup preserves all 682 provider rows with explicit abbreviation fields', () => {
  assert.equal(committedArtifact.items.length, 682);
  assert.equal(
    new Set(committedArtifact.items.map((item) => item.school)).size,
    committedArtifact.items.length,
    'every provider row retains a unique school key'
  );
  for (const item of committedArtifact.items) {
    assert.ok(
      Object.hasOwn(item, 'abbreviation'),
      `${item.school} retains an explicit abbreviation field`
    );
    assert.ok(
      item.abbreviation === null || typeof item.abbreviation === 'string',
      `${item.school} abbreviation is a string or explicit null`
    );
  }
});

test('the reader returns provider abbreviations and preserves missing values as null', () => {
  assert.equal(getTeamAbbreviation('Southeast Missouri State'), 'SEMO');
  assert.equal(getTeamAbbreviation('Mississippi Valley State'), 'MVSU');
  assert.equal(getTeamAbbreviation('Long Island University'), 'LIU');
  assert.equal(getTeamAbbreviation('North Carolina Central'), 'NCCU');
  assert.equal(getTeamAbbreviation('Chicago State'), null);
  assert.equal(getTeamAbbreviation('Unknown University'), null);
  assert.equal(getTeamAbbreviation(''), null);
});

test('the real catalog keeps draft boards and owner validation on the same FBS boundary', () => {
  assertCatalogConsumerBoundary(teamCatalog.items as TeamCatalogItem[]);
});

test('catalog widening mutation fires the named draft observer assertion', () => {
  const widenedCatalog = [
    ...(teamCatalog.items as TeamCatalogItem[]),
    {
      school: 'Southeast Missouri State',
      displayName: 'Southeast Missouri State',
      abbreviation: 'SEMO',
      level: 'FCS',
      classification: 'fcs',
      conference: 'Ohio Valley',
    },
  ];

  assert.throws(
    () => assertCatalogConsumerBoundary(widenedCatalog),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(CATALOG_CONSUMER_BOUNDARY_ASSERTION));
      return true;
    },
    'mutation control must prove the named catalog-boundary assertion can fail'
  );
});
