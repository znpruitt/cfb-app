import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTeamDatabaseFile, normalizeCfbdTeamRecord } from '../teamDatabase.ts';

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
