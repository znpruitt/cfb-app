import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYTICS_REQUIRED_CATEGORIES,
  GAME_STAT_CATEGORY_SPECS,
  MAX_POSSESSION_MINUTES,
  NEGATIVE_ALLOWED_CATEGORIES,
  buildV2GameStats,
  classifyGameStatsRow,
  evaluateGameStatsRow,
  hasProviderAddressableGameId,
  isAnalyticsEligible,
  isCompleteStatRow,
  isPersistableIncomingRow,
  isValidPointsValue,
  parseCategoryValue,
  parseV2GameObservation,
  toAnalyticsGameStats,
} from '../contract.ts';
import {
  blankSchoolLegacyRow,
  completeLegacyRow,
  explicitZeroLegacyRow,
  invalidStoredPointsLegacyRow,
  leadingSpacePossessionLegacyRow,
  longPossessionLegacyRow,
  malformedOptionalLegacyRow,
  malformedRequiredLegacyRow,
  missingRequiredLegacyRow,
  normalizedMismatchLegacyRow,
  prototypeNamedCategoryLegacyRow,
  statlessLegacyRow,
  v2RowLike,
  wireGame,
} from './fixtures.ts';

// PLATFORM-086H1-PROTOTYPE-SAFE-CATEGORY-LOOKUP-REMEDIATION-v1: untrusted
// provider categories named after Object.prototype members must resolve as
// unknown categories via an own-property guard — never as inherited object
// values, and never as a thrown TypeError anywhere downstream.
const PROTOTYPE_NAMED_CATEGORIES = [
  'toString',
  'constructor',
  'hasOwnProperty',
  'valueOf',
  '__proto__',
] as const;

test('prototype-named categories always resolve as unknown, never as inherited specs', () => {
  for (const category of PROTOTYPE_NAMED_CATEGORIES) {
    const result = parseCategoryValue(category, '3');
    assert.deepEqual(result, { status: 'unknown-category' }, category);
  }
});

test('prototype-named categories never crash classification or establish authority', () => {
  // A v2 row carrying ONLY prototype-named categories takes the normal
  // unknown-only path and returns a valid typed result.
  const unknownOnly = classifyGameStatsRow(
    v2RowLike({
      homeRaw: { ['toString']: '3', ['__proto__']: 'x' },
      awayRaw: { ['constructor']: '55' },
    })
  );
  assert.equal(unknownOnly.state, 'non-persistable-unknown-only');

  // A legacy row carrying only prototype-named categories classifies through
  // the normal malformed path (required categories missing) without throwing.
  assert.equal(classifyGameStatsRow(prototypeNamedCategoryLegacyRow()).state, 'legacy-malformed');

  // A complete row with an ADDITIONAL prototype-named category stays complete
  // on the strength of its valid recognized required evidence alone.
  const completeRaw = {
    totalYards: '412',
    rushingYards: '187',
    netPassingYards: '225',
    turnovers: '1',
    thirdDownEff: '6-14',
    possessionTime: '31:24',
  };
  const completePlus = v2RowLike({
    homeRaw: { ...completeRaw, ['toString']: '55' },
    awayRaw: { ...completeRaw, ['hasOwnProperty']: '1' },
  });
  assert.equal(classifyGameStatsRow(completePlus).state, 'v2-complete');
  assert.equal(isCompleteStatRow(completePlus), true);
  const legacyRow = completeLegacyRow(77);
  const legacyPlus = {
    ...legacyRow,
    home: { ...legacyRow.home, raw: { ...legacyRow.home.raw, ['valueOf']: '1' } },
  };
  assert.equal(classifyGameStatsRow(legacyPlus).state, 'legacy-compatible');

  // Prototype-named categories establish NO persistence authority.
  const wire = wireGame();
  wire.teams = wire.teams.map((t) => ({
    ...t,
    stats: [{ category: 'toString', stat: '3' }],
  }));
  const parsed = parseV2GameObservation(wire);
  assert.ok(parsed.ok);
  assert.equal(isPersistableIncomingRow(parsed.ok ? parsed.observation : (null as never)), false);
});

// === Category specification ===

test('category specification: six analytics-required categories, negatives only for yardage', () => {
  assert.deepEqual(ANALYTICS_REQUIRED_CATEGORIES, [
    'netPassingYards',
    'possessionTime',
    'rushingYards',
    'thirdDownEff',
    'totalYards',
    'turnovers',
  ]);
  assert.deepEqual([...NEGATIVE_ALLOWED_CATEGORIES].sort(), [
    'interceptionYards',
    'kickReturnYards',
    'netPassingYards',
    'puntReturnYards',
    'rushingYards',
    'totalYards',
  ]);
  // Inventory-confirmed raw-only categories are recognized…
  assert.ok(GAME_STAT_CATEGORY_SPECS.kickReturns);
  assert.ok(GAME_STAT_CATEGORY_SPECS.puntReturns);
  // …while observed-but-unmodeled ones stay unknown.
  assert.equal(GAME_STAT_CATEGORY_SPECS.completionAttempts, undefined);
  assert.equal(parseCategoryValue('completionAttempts', '22-33').status, 'unknown-category');
  assert.equal(parseCategoryValue('sacks', '3').status, 'unknown-category');
});

// === Strict parsers (table-driven) ===

test('strict parsers reject the malformed-value table for every parser class', () => {
  const malformedTable: unknown[] = [
    '350yards',
    '6x-14y',
    '30:99',
    '12.5',
    '15-6', // efficiency ordering violation (valid for count-yards, tested below)
    '9007199254740992', // Number.MAX_SAFE_INTEGER + 1
    '',
    '   ',
    null,
    undefined,
    42, // numeric category value — strings only, never coerced
    '1e3',
    '+5',
    '007',
  ];
  for (const value of malformedTable) {
    assert.equal(
      parseCategoryValue('turnovers', value).status,
      'malformed',
      `count turnovers=${String(value)}`
    );
    assert.equal(
      parseCategoryValue('totalYards', value).status,
      'malformed',
      `signed totalYards=${String(value)}`
    );
    assert.equal(
      parseCategoryValue('thirdDownEff', value).status,
      'malformed',
      `efficiency thirdDownEff=${String(value)}`
    );
    if (value !== '15-6') {
      assert.equal(
        parseCategoryValue('totalPenaltiesYards', value).status,
        'malformed',
        `count-yards totalPenaltiesYards=${String(value)}`
      );
    }
    if (value !== '30:99') {
      assert.equal(
        parseCategoryValue('possessionTime', value).status,
        'malformed',
        `clock possessionTime=${String(value)}`
      );
    }
  }
  // The two carve-outs above are malformed for their OWN reasons:
  assert.equal(parseCategoryValue('possessionTime', '30:99').status, 'malformed');
  assert.equal(parseCategoryValue('totalPenaltiesYards', 'x-1').status, 'malformed');
});

test('negative values parse only for the six inventory-confirmed yardage categories', () => {
  for (const category of NEGATIVE_ALLOWED_CATEGORIES) {
    const result = parseCategoryValue(category, '-7');
    assert.equal(result.status, 'valid', `${category}=-7 accepted`);
    assert.deepEqual(result.status === 'valid' ? result.value : null, {
      kind: 'signed-yardage',
      value: -7,
    });
    // Canonical grammar still applies to negatives: no "-0", no decimals.
    assert.equal(parseCategoryValue(category, '-0').status, 'malformed');
    assert.equal(parseCategoryValue(category, '-7.5').status, 'malformed');
  }
  for (const category of ['turnovers', 'firstDowns', 'rushingAttempts', 'kickReturns']) {
    assert.equal(parseCategoryValue(category, '-1').status, 'malformed', `${category}=-1 rejected`);
  }
  assert.equal(parseCategoryValue('thirdDownEff', '1--1').status, 'malformed');
  assert.equal(parseCategoryValue('totalPenaltiesYards', '1--1').status, 'malformed');
});

test('efficiency fractions require made <= attempted; penalties-yards has no ordering', () => {
  for (const category of ['thirdDownEff', 'fourthDownEff']) {
    assert.deepEqual(parseCategoryValue(category, '6-14'), {
      status: 'valid',
      value: { kind: 'efficiency', made: 6, attempted: 14 },
    });
    assert.deepEqual(parseCategoryValue(category, '0-0'), {
      status: 'valid',
      value: { kind: 'efficiency', made: 0, attempted: 0 },
    });
    // Observed wire garbage: negative components and made > attempted.
    for (const bad of ['15-6', '2-1', '1--1', '0--1', '6 - 14', '6-14-2']) {
      assert.equal(parseCategoryValue(category, bad).status, 'malformed', `${category}=${bad}`);
    }
  }
  assert.deepEqual(parseCategoryValue('totalPenaltiesYards', '15-6'), {
    status: 'valid',
    value: { kind: 'count-yards', count: 15, yards: 6 },
  });
  assert.deepEqual(parseCategoryValue('totalPenaltiesYards', '7-65'), {
    status: 'valid',
    value: { kind: 'count-yards', count: 7, yards: 65 },
  });
});

test('possession clock: strict grammar, trim-only leniency, 90-minute ceiling', () => {
  const valid: Array<[string, number]> = [
    ['0:00', 0],
    ['00:00', 0],
    ['9:12', 552],
    [' 9:12', 552], // observed leading-space wire convention
    [' 7:16', 436],
    [' 2:07', 127],
    [' 00:00', 0],
    ['31:24 ', 1884], // trailing whitespace also trimmed
    ['59:59', 3599],
    ['90:00', 5400],
  ];
  for (const [value, seconds] of valid) {
    assert.deepEqual(
      parseCategoryValue('possessionTime', value),
      { status: 'valid', value: { kind: 'clock', seconds } },
      `possessionTime=${JSON.stringify(value)}`
    );
  }
  assert.equal(MAX_POSSESSION_MINUTES, 90);
  for (const bad of [
    '91:00',
    '120:00',
    '30:99',
    '30:9',
    '3 0:00',
    '9: 12',
    '552',
    '9.2:00',
    ':30',
  ]) {
    assert.equal(
      parseCategoryValue('possessionTime', bad).status,
      'malformed',
      `possessionTime=${JSON.stringify(bad)}`
    );
  }
  // No other category trims whitespace.
  assert.equal(parseCategoryValue('turnovers', ' 1').status, 'malformed');
  assert.equal(parseCategoryValue('thirdDownEff', ' 6-14').status, 'malformed');
});

test('structural points evidence: finite non-negative safe JSON integers only', () => {
  assert.equal(isValidPointsValue(0), true);
  assert.equal(isValidPointsValue(21), true);
  for (const bad of [
    '0',
    '21',
    -1,
    3.5,
    NaN,
    Infinity,
    -Infinity,
    9007199254740992,
    null,
    undefined,
  ]) {
    assert.equal(isValidPointsValue(bad), false, `points=${String(bad)}`);
  }
});

// === Typed classifier ===

test('classifier: addressability and schema-version interpretation per game row', () => {
  assert.equal(classifyGameStatsRow(null).state, 'unaddressable');
  assert.equal(classifyGameStatsRow('row').state, 'unaddressable');
  for (const id of [0, -5, 1.5, '123', null, undefined, 9007199254740992]) {
    assert.equal(
      classifyGameStatsRow({ providerGameId: id }).state,
      'unaddressable',
      `id=${String(id)}`
    );
  }

  // Missing own schemaVersion property → legacy.
  assert.equal(classifyGameStatsRow(completeLegacyRow()).state, 'legacy-compatible');
  // Exact numeric 2 → v2.
  assert.equal(classifyGameStatsRow(v2RowLike()).state, 'v2-complete');
  // Unknown FUTURE integers → unsupported; never legacy fallback.
  for (const version of [3, 4, 99]) {
    assert.equal(
      classifyGameStatsRow(v2RowLike({ schemaVersion: version })).state,
      'unsupported-version'
    );
  }
  // Present malformed values → malformed-v2; never legacy fallback.
  for (const version of ['2', 2.5, null, undefined, 0, 1, -1, true]) {
    assert.equal(
      classifyGameStatsRow(v2RowLike({ schemaVersion: version })).state,
      'malformed-v2',
      `schemaVersion=${String(version)}`
    );
  }
});

test('classifier: v2 content states are deterministic and mutually exclusive', () => {
  assert.equal(
    classifyGameStatsRow(v2RowLike({ homeRaw: {}, awayRaw: {} })).state,
    'non-persistable-empty'
  );
  assert.equal(
    classifyGameStatsRow(v2RowLike({ homeRaw: { sacks: '3' }, awayRaw: { tackles: '55' } })).state,
    'non-persistable-unknown-only'
  );
  assert.equal(
    classifyGameStatsRow(v2RowLike({ homeRaw: { turnovers: 'x' }, awayRaw: { sacks: '3' } })).state,
    'non-persistable-malformed-only'
  );
  assert.equal(
    classifyGameStatsRow(v2RowLike({ awayRaw: { totalYards: 'garbage' } })).state,
    'non-persistable-one-sided'
  );
  // One valid recognized category per side but not all six → sparse.
  const sparse = classifyGameStatsRow(
    v2RowLike({ homeRaw: { turnovers: '1' }, awayRaw: { turnovers: '2' } })
  );
  assert.equal(sparse.state, 'v2-sparse');
  assert.ok(sparse.reasons.some((r) => r === 'home:required-not-valid:possessionTime'));
  // All six required but no structural points evidence → sparse, not complete.
  assert.equal(
    classifyGameStatsRow(v2RowLike({ homeOverrides: { pointsProvided: false } })).state,
    'v2-sparse'
  );
  assert.equal(
    classifyGameStatsRow(v2RowLike({ homeOverrides: { points: '31' } })).state,
    'v2-sparse'
  );
  assert.equal(classifyGameStatsRow(v2RowLike()).state, 'v2-complete');
  // v2 identity is held to the full standard (positive safe team ids).
  assert.equal(
    classifyGameStatsRow(v2RowLike({ homeOverrides: { schoolId: 0 } })).state,
    'unusable-identity'
  );
});

test('classifier: legacy states match the inventory contract', () => {
  assert.equal(classifyGameStatsRow(completeLegacyRow()).state, 'legacy-compatible');
  assert.equal(classifyGameStatsRow(explicitZeroLegacyRow()).state, 'legacy-compatible');
  assert.equal(classifyGameStatsRow(leadingSpacePossessionLegacyRow()).state, 'legacy-compatible');
  assert.equal(classifyGameStatsRow(malformedOptionalLegacyRow()).state, 'legacy-compatible');
  assert.equal(classifyGameStatsRow(longPossessionLegacyRow()).state, 'legacy-compatible');

  assert.equal(classifyGameStatsRow(statlessLegacyRow()).state, 'legacy-statless');

  const malformed = classifyGameStatsRow(malformedRequiredLegacyRow());
  assert.equal(malformed.state, 'legacy-malformed');
  assert.ok(malformed.reasons.includes('home:required-not-valid:totalYards'));
  assert.equal(classifyGameStatsRow(missingRequiredLegacyRow()).state, 'legacy-malformed');
  assert.equal(classifyGameStatsRow(invalidStoredPointsLegacyRow()).state, 'legacy-malformed');

  const mismatch = classifyGameStatsRow(normalizedMismatchLegacyRow());
  assert.equal(mismatch.state, 'legacy-normalized-mismatch');
  assert.ok(mismatch.reasons.includes('normalized-mismatch:totalYards:home'));

  assert.equal(classifyGameStatsRow(blankSchoolLegacyRow()).state, 'unusable-identity');
});

// === Derived predicates ===

test('derived predicates align with the classifier', () => {
  assert.equal(hasProviderAddressableGameId(completeLegacyRow()), true);
  assert.equal(hasProviderAddressableGameId({ providerGameId: 0 }), false);
  assert.equal(hasProviderAddressableGameId(null), false);

  assert.equal(isCompleteStatRow(v2RowLike()), true);
  // Legacy compatibility is analytics-eligible but NEVER strict completeness.
  assert.equal(isCompleteStatRow(completeLegacyRow()), false);
  assert.equal(isAnalyticsEligible(v2RowLike()), true);
  assert.equal(isAnalyticsEligible(completeLegacyRow()), true);
  for (const ineligible of [
    v2RowLike({ homeRaw: { turnovers: '1' }, awayRaw: { turnovers: '2' } }),
    v2RowLike({ schemaVersion: 3 }),
    v2RowLike({ schemaVersion: '2' }),
    statlessLegacyRow(),
    malformedRequiredLegacyRow(),
    normalizedMismatchLegacyRow(),
  ]) {
    assert.equal(isAnalyticsEligible(ineligible), false);
  }
});

// === Incoming v2 observation parsing ===

test('parseV2GameObservation: typed representation of successfully parsed wire data', () => {
  assert.deepEqual(parseV2GameObservation(null), { ok: false, reason: 'not-an-object' });
  assert.deepEqual(parseV2GameObservation({ id: 'x', teams: [] }), {
    ok: false,
    reason: 'unaddressable-game-id',
  });
  assert.deepEqual(parseV2GameObservation({ id: 5, teams: 'nope' }), {
    ok: false,
    reason: 'invalid-teams-shape',
  });

  const base = wireGame();
  // Invalid side designations are ignored; a missing side rejects.
  assert.deepEqual(
    parseV2GameObservation({ id: 5, teams: [{ ...base.teams[0], homeAway: 'neutral' }] }),
    {
      ok: false,
      reason: 'missing-home-side',
    }
  );
  assert.deepEqual(parseV2GameObservation({ id: 5, teams: [base.teams[0]] }), {
    ok: false,
    reason: 'missing-away-side',
  });
  assert.deepEqual(parseV2GameObservation({ id: 5, teams: [base.teams[0], base.teams[0]] }), {
    ok: false,
    reason: 'duplicate-home-side',
  });
  for (const badTeam of [
    { ...base.teams[1], team: '   ' },
    { ...base.teams[1], teamId: 0 },
    { ...base.teams[1], teamId: 1.5 },
  ]) {
    assert.deepEqual(parseV2GameObservation({ id: 5, teams: [base.teams[0], badTeam] }), {
      ok: false,
      reason: 'unusable-identity',
    });
  }

  const parsed = parseV2GameObservation(base);
  assert.ok(parsed.ok);
  const observation = parsed.ok ? parsed.observation : null;
  assert.equal(observation!.providerGameId, base.id);
  assert.equal(observation!.home.pointsProvided, true);
  assert.equal(observation!.home.points, 31);
  assert.equal(observation!.home.raw.totalYards, '412');

  // Non-string stat values are never coerced (they simply carry no evidence);
  // duplicate categories collapse last-wins like the durable JSONB map; string
  // points establish NO evidence.
  const quirky = parseV2GameObservation({
    id: 7,
    teams: [
      {
        ...base.teams[0],
        points: '31',
        stats: [
          { category: 'turnovers', stat: 2 },
          { category: 'totalYards', stat: '300' },
          { category: 'totalYards', stat: '412' },
        ],
      },
      base.teams[1],
    ],
  });
  assert.ok(quirky.ok);
  const quirkyHome = quirky.ok ? quirky.observation.home : null;
  assert.equal(quirkyHome!.pointsProvided, false);
  assert.equal(quirkyHome!.points, null);
  assert.equal(quirkyHome!.raw.turnovers, undefined);
  assert.equal(quirkyHome!.raw.totalYards, '412');
});

test('isPersistableIncomingRow: both sides need one strictly valid recognized category', () => {
  const parse = (game: unknown) => {
    const result = parseV2GameObservation(game);
    assert.ok(result.ok);
    return result.ok ? result.observation : (null as never);
  };

  assert.equal(isPersistableIncomingRow(parse(wireGame())), true);
  // Sparse is persistable; points are NOT required.
  const sparse = wireGame();
  sparse.teams = sparse.teams.map((t) => ({
    ...t,
    points: undefined as unknown as number,
    stats: [{ category: 'turnovers', stat: '1' }],
  }));
  assert.equal(isPersistableIncomingRow(parse(sparse)), true);

  const emptySides = wireGame();
  emptySides.teams = emptySides.teams.map((t) => ({ ...t, stats: [] }));
  assert.equal(isPersistableIncomingRow(parse(emptySides)), false);

  const unknownOnly = wireGame();
  unknownOnly.teams = unknownOnly.teams.map((t) => ({
    ...t,
    stats: [{ category: 'sacks', stat: '3' }],
  }));
  assert.equal(isPersistableIncomingRow(parse(unknownOnly)), false);

  const malformedOnly = wireGame();
  malformedOnly.teams = malformedOnly.teams.map((t) => ({
    ...t,
    stats: [{ category: 'turnovers', stat: 'x' }],
  }));
  assert.equal(isPersistableIncomingRow(parse(malformedOnly)), false);

  const oneSided = wireGame();
  oneSided.teams = oneSided.teams.map((t, i) => ({
    ...t,
    stats: i === 0 ? t.stats : [{ category: 'sacks', stat: '3' }],
  }));
  assert.equal(isPersistableIncomingRow(parse(oneSided)), false);
});

test('buildV2GameStats: pure constructor through the single strict normalization path', () => {
  const parsed = parseV2GameObservation(
    wireGame({ home: { statOverrides: { possessionTime: ' 9:12', fourthDownEff: '2-1' } } })
  );
  assert.ok(parsed.ok);
  const row = buildV2GameStats(parsed.ok ? parsed.observation : (null as never), 5, 'regular');
  assert.equal(row.schemaVersion, 2);
  assert.equal(classifyGameStatsRow(row).state, 'v2-complete');
  assert.equal(row.home.pointsProvided, true);
  assert.equal(row.home.points, 31);
  // Trim-only clock leniency flows through; malformed OPTIONAL values fall back
  // to public zeroes without poisoning completeness.
  assert.equal(row.home.possessionSeconds, 552);
  assert.equal(row.home.fourthDownConversions, 0);
  assert.equal(row.home.fourthDownAttempts, 0);
  assert.equal(row.home.raw.fourthDownEff, '2-1');
});

// === Season-aware recovery policy ===

test('evaluateGameStatsRow: explicit season relation drives disposition, never eligibility', () => {
  const cases: Array<{ row: unknown; current: string; historical: string; eligible: boolean }> = [
    { row: v2RowLike(), current: 'satisfied', historical: 'satisfied', eligible: true },
    {
      row: v2RowLike({ homeRaw: { turnovers: '1' }, awayRaw: { turnovers: '2' } }),
      current: 'retry-current',
      historical: 'manual-migration-only',
      eligible: false,
    },
    {
      row: completeLegacyRow(),
      current: 'retry-current',
      historical: 'historical-covered',
      eligible: true,
    },
    {
      row: malformedRequiredLegacyRow(),
      current: 'retry-current',
      historical: 'manual-migration-only',
      eligible: false,
    },
    {
      row: statlessLegacyRow(),
      current: 'retry-current',
      historical: 'manual-migration-only',
      eligible: false,
    },
    {
      row: normalizedMismatchLegacyRow(),
      current: 'retry-current',
      historical: 'manual-migration-only',
      eligible: false,
    },
    {
      row: v2RowLike({ schemaVersion: 3 }),
      current: 'blocked-unsupported-schema',
      historical: 'blocked-unsupported-schema',
      eligible: false,
    },
    {
      row: v2RowLike({ schemaVersion: '2' }),
      current: 'blocked-unsupported-schema',
      historical: 'blocked-unsupported-schema',
      eligible: false,
    },
  ];
  for (const { row, current, historical, eligible } of cases) {
    const currentEval = evaluateGameStatsRow(row, { seasonRelation: 'current' });
    const historicalEval = evaluateGameStatsRow(row, { seasonRelation: 'historical' });
    assert.equal(currentEval.disposition, current);
    assert.equal(historicalEval.disposition, historical);
    assert.equal(currentEval.analyticsEligible, eligible);
    assert.equal(historicalEval.analyticsEligible, eligible);
    assert.equal(currentEval.classification.state, historicalEval.classification.state);
  }
});

// === Canonical analytics projection ===

test('toAnalyticsGameStats: strict evidence in, null for everything ineligible', () => {
  const legacy = toAnalyticsGameStats(completeLegacyRow());
  assert.ok(legacy);
  assert.equal(legacy!.source, 'legacy');
  assert.equal(legacy!.home.totalYards, 412);
  assert.equal(legacy!.home.passingYards, 225);
  assert.equal(legacy!.home.thirdDownConversions, 6);
  assert.equal(legacy!.home.thirdDownAttempts, 14);
  assert.equal(legacy!.home.possessionSeconds, 31 * 60 + 24);
  assert.equal(legacy!.home.points, 31);

  const trimmed = toAnalyticsGameStats(leadingSpacePossessionLegacyRow());
  assert.equal(trimmed!.home.possessionSeconds, 552);

  const v2 = toAnalyticsGameStats(v2RowLike());
  assert.ok(v2);
  assert.equal(v2!.source, 'v2');
  assert.equal(v2!.away.turnovers, 1);

  // Fallback zeroes are never exposed as observed facts: ineligible rows have
  // NO projection at all, rather than a zero-filled one.
  for (const ineligible of [
    statlessLegacyRow(),
    malformedRequiredLegacyRow(),
    missingRequiredLegacyRow(),
    normalizedMismatchLegacyRow(),
    invalidStoredPointsLegacyRow(),
    v2RowLike({ homeRaw: { turnovers: '1' }, awayRaw: { turnovers: '2' } }),
    v2RowLike({ schemaVersion: 3 }),
    blankSchoolLegacyRow(),
    null,
  ]) {
    assert.equal(toAnalyticsGameStats(ineligible), null);
  }
});

// Deterministic duplicate-game selection moved to the schedule-aware evidence
// authority (PLATFORM-086H3C1). The former context-free `selectAnalyticsRows`
// was removed as a second read-side duplicate authority; its winner-selection
// and conflict behavior is now covered by `evidenceAuthority.test.ts`. The
// projection-only `toAnalyticsGameStats` above remains the single analytics view
// of one already-selected row.
