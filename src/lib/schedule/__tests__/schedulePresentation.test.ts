import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeScheduleMediaCacheEntry,
  normalizeScheduleMediaPayload,
  normalizeScheduleMediaRow,
  normalizeVenueCatalogCacheEntry,
  normalizeVenueCatalogPayload,
  normalizeVenueCatalogRow,
} from '../schedulePresentation.ts';

const ELIGIBLE = new Set(['101', '102', '103']);

test('camelCase and snake_case media payloads normalize identically', () => {
  const camel = normalizeScheduleMediaPayload(
    [{ id: 101, mediaType: 'TV', outlet: ' ESPN ' }],
    ELIGIBLE
  );
  const snake = normalizeScheduleMediaPayload(
    [{ id: '101', media_type: 'tv', outlet: 'ESPN' }],
    ELIGIBLE
  );
  assert.equal(camel.kind, 'rows');
  assert.equal(snake.kind, 'rows');
  if (camel.kind !== 'rows' || snake.kind !== 'rows') return;
  assert.deepEqual(camel.items, snake.items);
  assert.deepEqual(camel.items, [{ gameId: '101', mediaType: 'tv', outlet: 'ESPN' }]);
});

test('camelCase and snake_case venue payloads normalize identically', () => {
  const camel = normalizeVenueCatalogRow({
    id: 3504,
    name: ' Kyle Field ',
    city: 'College Station',
    state: 'TX',
    countryCode: 'US',
    timezone: 'America/Chicago',
    capacity: 102733,
    grass: false,
    dome: false,
  });
  const snake = normalizeVenueCatalogRow({
    id: '3504',
    name: 'Kyle Field',
    city: 'College Station',
    state: 'TX',
    country_code: 'US',
    timezone: 'America/Chicago',
    capacity: 102733,
    grass: false,
    dome: false,
  });
  assert.deepEqual(camel, snake);
  assert.equal(camel?.id, 3504);
  assert.equal(camel?.name, 'Kyle Field');
  assert.equal(camel?.countryCode, 'US');
});

test('media types normalize case-insensitively to the closed union; unknown and blank values are rejected', () => {
  assert.equal(
    normalizeScheduleMediaRow({ id: 101, mediaType: 'Web', outlet: 'ESPN+' })?.mediaType,
    'web'
  );
  assert.equal(
    normalizeScheduleMediaRow({ id: 101, mediaType: 'PPV', outlet: 'FloSports' })?.mediaType,
    'ppv'
  );
  // Unknown type, blank type, blank outlet, and whitespace outlet are unusable.
  assert.equal(normalizeScheduleMediaRow({ id: 101, mediaType: 'satellite', outlet: 'X' }), null);
  assert.equal(normalizeScheduleMediaRow({ id: 101, mediaType: '', outlet: 'X' }), null);
  assert.equal(normalizeScheduleMediaRow({ id: 101, mediaType: 'tv', outlet: '' }), null);
  assert.equal(normalizeScheduleMediaRow({ id: 101, mediaType: 'tv', outlet: '   ' }), null);
});

test('media game ids accept only positive safe integers or canonical decimal strings', () => {
  for (const bad of [0, -5, 1.5, '1e3', '0x10', '+16', '12.5', '', '  ', null, undefined, true]) {
    assert.equal(
      normalizeScheduleMediaRow({ id: bad, mediaType: 'tv', outlet: 'ESPN' }),
      null,
      `id ${String(bad)} must be rejected`
    );
  }
  assert.equal(
    normalizeScheduleMediaRow({ id: '000101', mediaType: 'tv', outlet: 'ESPN' })?.gameId,
    '101',
    'a decimal string canonicalizes to the exact canonical form'
  );
});

test('exact game-id filtering retains tracked games and rejects schedule-absent rows', () => {
  const result = normalizeScheduleMediaPayload(
    [
      { id: 101, mediaType: 'tv', outlet: 'ESPN' },
      { id: 999, mediaType: 'tv', outlet: 'FOX' }, // not in the canonical schedule
      { id: 103, mediaType: 'web', outlet: 'ESPN+' },
    ],
    ELIGIBLE
  );
  assert.equal(result.kind, 'rows');
  if (result.kind !== 'rows') return;
  assert.equal(result.usableRows, 3, 'structurally usable rows counted pre-filter');
  assert.deepEqual(
    result.items.map((row) => row.gameId),
    ['101', '103']
  );
});

test('multiple legitimate outlets for one game survive; exact duplicates collapse', () => {
  const result = normalizeScheduleMediaPayload(
    [
      { id: 101, mediaType: 'tv', outlet: 'ESPN' },
      { id: 101, mediaType: 'tv', outlet: 'espn' }, // case-insensitive duplicate
      { id: 101, mediaType: 'tv', outlet: 'ESPN2' }, // second legitimate TV outlet
      { id: 101, mediaType: 'radio', outlet: 'ESPN Radio' },
      { id: 101, mediaType: 'web', outlet: 'ESPN+' },
    ],
    ELIGIBLE
  );
  assert.equal(result.kind, 'rows');
  if (result.kind !== 'rows') return;
  assert.deepEqual(result.items, [
    { gameId: '101', mediaType: 'tv', outlet: 'ESPN' },
    { gameId: '101', mediaType: 'tv', outlet: 'ESPN2' },
    { gameId: '101', mediaType: 'web', outlet: 'ESPN+' },
    { gameId: '101', mediaType: 'radio', outlet: 'ESPN Radio' },
  ]);
});

test('media normalization sorts deterministically regardless of input order', () => {
  const rows = [
    { id: 103, mediaType: 'radio', outlet: 'Zeta' },
    { id: 101, mediaType: 'web', outlet: 'b-stream' },
    { id: 101, mediaType: 'tv', outlet: 'Alpha' },
  ];
  const forward = normalizeScheduleMediaPayload(rows, ELIGIBLE);
  const reversed = normalizeScheduleMediaPayload([...rows].reverse(), ELIGIBLE);
  assert.equal(forward.kind, 'rows');
  assert.equal(reversed.kind, 'rows');
  if (forward.kind !== 'rows' || reversed.kind !== 'rows') return;
  assert.deepEqual(forward.items, reversed.items);
});

test('a non-array media payload is invalid-payload; nonempty-but-unusable is schema-drift', () => {
  assert.equal(normalizeScheduleMediaPayload({ rows: [] }, ELIGIBLE).kind, 'invalid-payload');
  assert.equal(normalizeScheduleMediaPayload(null, ELIGIBLE).kind, 'invalid-payload');
  assert.equal(
    normalizeScheduleMediaPayload([{ id: 101, network: 'ESPN' }], ELIGIBLE).kind,
    'schema-drift',
    'renamed fields make every row unusable — drift, never valid absence'
  );
  const empty = normalizeScheduleMediaPayload([], ELIGIBLE);
  assert.equal(empty.kind, 'rows');
  if (empty.kind === 'rows') assert.equal(empty.items.length, 0);
});

test('identical duplicate venue rows collapse; conflicting rows for one id reject the payload', () => {
  const base = { id: 3504, name: 'Kyle Field', city: 'College Station', state: 'TX' };
  const collapsed = normalizeVenueCatalogPayload([base, { ...base }]);
  assert.equal(collapsed.kind, 'rows');
  if (collapsed.kind === 'rows') assert.equal(collapsed.items.length, 1);

  const conflicting = normalizeVenueCatalogPayload([base, { ...base, capacity: 90000 }]);
  assert.equal(
    conflicting.kind,
    'invalid-payload',
    'conflicting rows for the same venue id must reject the payload, never choose arbitrarily'
  );
});

test('venue normalization is allowlist-only — excluded provider fields never enter the model', () => {
  const normalized = normalizeVenueCatalogRow({
    id: 3504,
    name: 'Kyle Field',
    city: 'College Station',
    state: 'TX',
    zip: '77843',
    country_code: 'US',
    location: { x: 30.61, y: -96.34 },
    latitude: 30.61,
    longitude: -96.34,
    elevation: '103.9',
    capacity: 102733,
    construction_year: 1927,
    grass: false,
    dome: false,
  });
  assert.ok(normalized);
  assert.deepEqual(Object.keys(normalized!).sort(), [
    'capacity',
    'city',
    'countryCode',
    'dome',
    'grass',
    'id',
    'name',
    'state',
    'timezone',
  ]);
});

test('media normalization is allowlist-only — raw provider fields never enter the model', () => {
  const result = normalizeScheduleMediaPayload(
    [
      {
        id: 101,
        season: 2026,
        week: 1,
        seasonType: 'regular',
        startTime: '2026-08-29T23:00:00Z',
        isStartTimeTBD: false,
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        mediaType: 'tv',
        outlet: 'ESPN',
      },
    ],
    ELIGIBLE
  );
  assert.equal(result.kind, 'rows');
  if (result.kind !== 'rows') return;
  assert.deepEqual(Object.keys(result.items[0]!).sort(), ['gameId', 'mediaType', 'outlet']);
});

test('venue payload classification mirrors the media rules', () => {
  assert.equal(normalizeVenueCatalogPayload('nope').kind, 'invalid-payload');
  assert.equal(normalizeVenueCatalogPayload([{ venue_key: 'x' }]).kind, 'schema-drift');
  const empty = normalizeVenueCatalogPayload([]);
  assert.equal(empty.kind, 'rows');
  if (empty.kind === 'rows') assert.equal(empty.items.length, 0);
});

test('cache-entry normalizers drop malformed stored rows instead of surfacing them', () => {
  const media = normalizeScheduleMediaCacheEntry({
    at: 1,
    items: [
      { gameId: '101', mediaType: 'tv', outlet: 'ESPN' },
      null,
      42,
      { gameId: '102', mediaType: 'hologram', outlet: 'X' },
      { gameId: '103', mediaType: 'web', outlet: '' },
    ],
  });
  assert.ok(media);
  assert.deepEqual(media!.items, [{ gameId: '101', mediaType: 'tv', outlet: 'ESPN' }]);

  const venues = normalizeVenueCatalogCacheEntry({
    at: 1,
    items: [{ id: 3504, name: 'Kyle Field' }, null, { name: 'No Id Stadium' }],
  });
  assert.ok(venues);
  assert.equal(venues!.items.length, 1);
  assert.equal(venues!.items[0]!.id, 3504);
});

test('a nonempty stored array whose rows are ALL invalid is absence, never a fresh empty entry', () => {
  assert.equal(
    normalizeScheduleMediaCacheEntry({ at: 1, items: [null, 42, { junk: true }] }),
    null
  );
  assert.equal(normalizeVenueCatalogCacheEntry({ at: 1, items: [{ name: 'No Id' }, null] }), null);
  // A genuinely empty stored array is still a usable (empty) entry.
  assert.deepEqual(normalizeScheduleMediaCacheEntry({ at: 1, items: [] }), { at: 1, items: [] });
});
