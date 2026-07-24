import assert from 'node:assert/strict';
import test from 'node:test';

import teamsCatalog from '../../data/teams.json';
import {
  buildDerivedTeamAliases,
  buildTeamDatabaseFile,
  normalizeCfbdTeamRecord,
} from '../teamDatabase.ts';

test('normalizes CFBD team metadata into local team reference shape', () => {
  const normalized = normalizeCfbdTeamRecord({
    id: 42,
    school: 'Texas',
    displayName: 'Texas Longhorns',
    shortDisplayName: 'Texas',
    abbreviation: 'TEX',
    mascot: 'Longhorns',
    conference: 'SEC',
    classification: 'fbs',
    color: 'bf5700',
    altColor: '#FFFFFF',
    logos: ['https://example.com/texas.svg'],
  });

  assert.ok(normalized.item);
  assert.equal(normalized.item?.id, 'texas');
  assert.equal(normalized.item?.providerId, 42);
  assert.equal(normalized.item?.school, 'Texas');
  assert.equal(normalized.item?.classification, 'fbs');
  assert.equal(normalized.item?.color, '#BF5700');
  assert.equal(normalized.item?.altColor, '#FFFFFF');
  assert.deepEqual(normalized.item?.logos, ['https://example.com/texas.svg']);
  assert.ok(normalized.item);
  assert.ok(normalized.item.alts?.includes('texas'));
  assert.ok(normalized.item.alts?.includes('texas longhorns'));
});

test('normalization keeps missing colors safe and reports skipped rows', () => {
  const { file, summary } = buildTeamDatabaseFile({
    records: [
      {
        id: 1,
        school: 'Rice',
        mascot: 'Owls',
        color: null,
        altColor: 'not-a-color',
      },
      {
        id: 2,
        school: '',
      },
    ],
  });

  assert.equal(file.items.length, 1);
  assert.equal(file.items[0]?.id, 'rice');
  assert.equal(file.items[0]?.color, null);
  assert.equal(file.items[0]?.altColor, null);
  assert.equal(summary.fetchedCount, 2);
  assert.equal(summary.writtenCount, 1);
  assert.equal(summary.withColorCount, 0);
  assert.equal(summary.withAltColorCount, 0);
  assert.equal(summary.missingColorCount, 1);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.errors.length, 1);
});

test('sync summary tracks updated rows against previous durable items', () => {
  const previousTexas = normalizeCfbdTeamRecord({
    id: 42,
    school: 'Texas',
    abbreviation: 'TEX',
    mascot: 'Longhorns',
    conference: 'SEC',
    color: '#BF5700',
    altColor: '#FFFFFF',
  }).item;

  assert.ok(previousTexas);

  const { summary } = buildTeamDatabaseFile({
    previousItems: [previousTexas],
    records: [
      {
        id: 42,
        school: 'Texas',
        abbreviation: 'TEX',
        mascot: 'Longhorns',
        conference: 'SEC',
        color: '#BF5700',
        altColor: '#FFFFFF',
      },
      {
        id: 99,
        school: 'Rice',
        mascot: 'Owls',
        conference: 'American Athletic',
      },
    ],
  });

  assert.equal(summary.writtenCount, 2);
  assert.equal(summary.updatedCount, 1);
});

// ---------------------------------------------------------------------------
// PLATFORM-086-TEAM-CATALOG-DERIVED-ALIAS-SAFETY: automatic compaction must
// never truncate a multi-token school to a two-token prefix — "San Diego
// State" → "sandiego" hijacked the (uncataloged) University of San Diego's
// identity and credited its stats to SDSU's owner. Legitimate shorthand for
// longer names belongs in curated src/data/alias-overrides.json.
// ---------------------------------------------------------------------------

test('derived aliases never truncate a multi-token school to a two-token prefix', () => {
  const sdsu = buildDerivedTeamAliases('San Diego State', 'Aztecs');
  assert.ok(!sdsu.includes('sandiego'), 'no truncated sandiego prefix');
  // Full compact forms of the whole name remain.
  assert.ok(sdsu.includes('san diego state'));
  assert.ok(sdsu.includes('sandiegostate'));
  assert.ok(sdsu.includes('san diego st'));

  const nmsu = buildDerivedTeamAliases('New Mexico State', 'Aggies');
  assert.ok(!nmsu.includes('newmexico'), 'no truncated newmexico prefix');
  assert.ok(nmsu.includes('newmexicostate'));

  // Two-token schools keep their legitimate whole-name compact join.
  const osu = buildDerivedTeamAliases('Ohio State', 'Buckeyes');
  assert.ok(osu.includes('ohiostate'));
});

test('buildTeamDatabaseFile applies the curated San Diego State override', () => {
  const { file } = buildTeamDatabaseFile({
    records: [
      { school: 'San Diego State', mascot: 'Aztecs', classification: 'fbs' },
      { school: 'San José State', mascot: 'Spartans', classification: 'fbs' },
    ],
  });
  const sdsu = file.items.find((i) => i.school === 'San Diego State');
  assert.ok(sdsu);
  assert.ok(sdsu!.alts?.includes('sdsu'), 'sanctioned SDSU shorthand added');
  assert.ok(!sdsu!.alts?.includes('sandiego'), 'sandiego defensively removed');

  // The existing San José State override keeps its sanctioned shorthand.
  const sjsu = file.items.find((i) => i.school === 'San José State');
  assert.ok(sjsu);
  assert.ok(sjsu!.alts?.includes('san jose'));
  assert.ok(sjsu!.alts?.includes('sjsu'));
});

test('checked-in catalog invariants: no truncated collision aliases, sanctioned shorthand present', () => {
  const bySchool = new Map(teamsCatalog.items.map((item) => [item.school, item]));
  const sdsu = bySchool.get('San Diego State');
  assert.ok(sdsu);
  assert.ok(!sdsu!.alts.includes('sandiego'));
  assert.ok(sdsu!.alts.includes('sdsu'));
  const sjsu = bySchool.get('San José State');
  assert.ok(sjsu);
  assert.ok(sjsu!.alts.includes('san jose'));
  assert.ok(sjsu!.alts.includes('sjsu'));
  const nmsu = bySchool.get('New Mexico State');
  assert.ok(nmsu);
  assert.ok(!nmsu!.alts.includes('newmexico'));
  const tamu = bySchool.get('Texas A&M');
  assert.ok(tamu);
  assert.ok(!tamu!.alts.includes('texasa'));
});
