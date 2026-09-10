import assert from 'node:assert/strict';
import test from 'node:test';

import teamsCatalog from '../../data/teams.json';
import {
  buildDerivedTeamAliases,
  buildTeamDatabaseFile,
  classifyTeamCatalogSync,
  normalizeCfbdTeamRecord,
  type CfbdTeamRecord,
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
    alternateColor: '#FFFFFF',
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
        alternateColor: 'not-a-color',
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
    alternateColor: '#FFFFFF',
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
        alternateColor: '#FFFFFF',
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
// PLATFORM-199: the provider field is `alternateColor`. `CfbdTeamRecord` used to
// declare `altColor` — a name CFBD does not send on `GET /teams/fbs` — so every
// alternate was read as `undefined` and discarded. Measured 2026-09-09: 138 of
// 138 provider rows carry `alternateColor`, none carries `altColor`, and the
// production catalog held 138 primaries and 0 alternates.
//
// Both directions are pinned, because a fixture using the wrong input name makes
// the positive test pass against the PRE-FIX code and prove nothing.
// ---------------------------------------------------------------------------

test('PLATFORM-199: a provider alternateColor becomes the stored altColor', () => {
  const normalized = normalizeCfbdTeamRecord({
    id: 26,
    school: 'California',
    mascot: 'Golden Bears',
    conference: 'ACC',
    classification: 'fbs',
    color: '#041e42',
    alternateColor: '#ffc72c',
  });

  // `alternateColor` in, `altColor` stored — one mapping, not a rename. The
  // stored name is what teamIdentity/teamDatabaseStore/teamColors all read.
  assert.equal(normalized.item?.color, '#041E42');
  assert.equal(normalized.item?.altColor, '#FFC72C');
});

test('PLATFORM-199: the retired altColor provider name yields no stored alternate', () => {
  // The cast is deliberate: `altColor` is no longer part of `CfbdTeamRecord`, so
  // the only way to build this row is to force it. That is the bug's own shape —
  // pre-fix this record produced `altColor: '#FFFFFF'`, which is why the previous
  // fixture passed while every real provider row resolved undefined.
  const retiredShape = {
    id: 42,
    school: 'Texas',
    mascot: 'Longhorns',
    color: '#BF5700',
    altColor: '#FFFFFF',
  } as unknown as CfbdTeamRecord;

  const normalized = normalizeCfbdTeamRecord(retiredShape);

  assert.equal(normalized.item?.color, '#BF5700', 'the primary still maps');
  assert.equal(
    normalized.item?.altColor,
    null,
    'the retired provider name must not be read as an alternate'
  );
});

test('PLATFORM-199: withAltColorCount counts alternates read from alternateColor', () => {
  const records: CfbdTeamRecord[] = [
    // Two rows in the real provider shape.
    {
      id: 1,
      school: 'Iowa',
      mascot: 'Hawkeyes',
      classification: 'fbs',
      color: '#000000',
      alternateColor: '#ffcd00',
    },
    {
      id: 2,
      school: 'Vanderbilt',
      mascot: 'Commodores',
      classification: 'fbs',
      color: '#000000',
      alternateColor: '#cfae70',
    },
    // One row carrying ONLY the retired name: it contributes a primary and no
    // alternate, so the witness separates the two field names rather than just
    // counting rows.
    {
      id: 3,
      school: 'Rice',
      mascot: 'Owls',
      classification: 'fbs',
      color: '#00205B',
      altColor: '#ffffff',
    } as unknown as CfbdTeamRecord,
  ];

  const { file, summary } = buildTeamDatabaseFile({ records });

  assert.equal(summary.writtenCount, 3);
  assert.equal(summary.withColorCount, 3);
  // The sync summary's own witness, surfaced to the operator in
  // ReferenceDataPanel. It reported 0 for every production sync before the fix.
  assert.equal(summary.withAltColorCount, 2);
  assert.equal(summary.missingColorCount, 0);

  const byId = new Map(file.items.map((item) => [item.id, item]));
  assert.equal(byId.get('iowa')?.altColor, '#FFCD00');
  assert.equal(byId.get('vanderbilt')?.altColor, '#CFAE70');
  assert.equal(byId.get('rice')?.altColor, null);
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

test('the alias-override policy hash is stable, nonempty, and folded into cache identities', async () => {
  const { ALIAS_OVERRIDES_HASH } = await import('../teamDatabase.ts');
  assert.match(ALIAS_OVERRIDES_HASH, /^[0-9a-f]{1,8}$/);
  const { canonicalStandingsCacheKeyParts } = await import('../selectors/leagueStandings.ts');
  assert.ok(
    canonicalStandingsCacheKeyParts('slug', 2025).includes(
      `alias-overrides:${ALIAS_OVERRIDES_HASH}`
    ),
    'standings cache identity carries the override-policy hash'
  );
  const { insightsCacheKeyParts } = await import('../insights/loadInsights.ts');
  assert.ok(
    insightsCacheKeyParts('slug', 2025).includes(`alias-overrides:${ALIAS_OVERRIDES_HASH}`),
    'insights cache identity carries the override-policy hash'
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-204 — the sync classifier's three branches, asserted independently.
// ---------------------------------------------------------------------------

test('classifyTeamCatalogSync: a payload that produced teams commits', () => {
  assert.equal(classifyTeamCatalogSync({ fetchedCount: 138, writtenCount: 138 }), 'commit');
  // A PARTIAL response is a deliberate non-event for this guard: 4 of 138 is a
  // well-formed answer and cannot be told from a legitimate one without a
  // magnitude threshold, which is an owner decision, not this classifier's.
  assert.equal(classifyTeamCatalogSync({ fetchedCount: 4, writtenCount: 4 }), 'commit');
  assert.equal(classifyTeamCatalogSync({ fetchedCount: 100, writtenCount: 100 }), 'commit');
  // Some rows dropped, some kept — still a commit; only TOTAL loss is refused.
  assert.equal(classifyTeamCatalogSync({ fetchedCount: 138, writtenCount: 1 }), 'commit');
});

test('classifyTeamCatalogSync: zero fetched rows is an empty replacement, never a no-op', () => {
  // Unlike the schedule classifier there is no `valid-noop` limb: `GET
  // /teams/fbs` has no publication calendar, so no season phase makes zero FBS
  // teams correct. The verdict does not depend on prior-good state.
  assert.equal(
    classifyTeamCatalogSync({ fetchedCount: 0, writtenCount: 0 }),
    'empty-replacement-rejected'
  );
});

test('classifyTeamCatalogSync: a nonempty payload yielding zero teams is schema drift', () => {
  // The branch a raw `rows.length === 0` check cannot reach, and the reason the
  // classification keys on the BUILT count.
  assert.equal(classifyTeamCatalogSync({ fetchedCount: 138, writtenCount: 0 }), 'schema-drift');
  assert.equal(classifyTeamCatalogSync({ fetchedCount: 1, writtenCount: 0 }), 'schema-drift');
});

test('PLATFORM-204: a whole payload of rows missing `school` builds an empty catalog', () => {
  // The classifier's schema-drift input is not hypothetical — this is what
  // `buildTeamDatabaseFile` returns when CFBD renames its identity field.
  const { file, summary } = buildTeamDatabaseFile({
    records: [{ mascot: 'Aces' }, { mascot: 'Bots' }] as never,
  });
  assert.equal(file.items.length, 0);
  assert.equal(summary.fetchedCount, 2);
  assert.equal(summary.writtenCount, 0);
  assert.equal(
    classifyTeamCatalogSync({
      fetchedCount: summary.fetchedCount,
      writtenCount: summary.writtenCount,
    }),
    'schema-drift'
  );
});
