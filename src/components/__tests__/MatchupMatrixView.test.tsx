import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MatchupMatrixView from '../MatchupMatrixView';
import type { CanonicalStandings } from '../../lib/selectors/leagueStandings';

test('matchup matrix view renders owner grid with records', () => {
  const html = renderToStaticMarkup(
    <MatchupMatrixView
      matrix={{
        owners: ['Alice', 'Bob'],
        rows: [
          {
            owner: 'Alice',
            cells: [
              { owner: 'Alice', gameCount: 0, record: null },
              { owner: 'Bob', gameCount: 2, record: '1–1' },
            ],
          },
          {
            owner: 'Bob',
            cells: [
              { owner: 'Alice', gameCount: 2, record: '1–1' },
              { owner: 'Bob', gameCount: 0, record: null },
            ],
          },
        ],
      }}
    />
  );

  assert.match(html, /<table/);
  assert.match(html, />Owner</);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /1–1/);
  assert.match(html, /data-owner-pair-cell="Alice::Bob"[^>]*><span>1–1<\/span>/);
});

test('matchup matrix view renders explicit empty state when no owners exist', () => {
  const html = renderToStaticMarkup(<MatchupMatrixView matrix={{ owners: [], rows: [] }} />);

  assert.match(html, /No matrix data yet/);
  assert.doesNotMatch(html, /<table/);
});

const canonicalForMatrix: CanonicalStandings = {
  slug: 'tsc',
  year: 2025,
  source: 'live',
  lifecycle: 'mid_season',
  rows: [],
  noClaimRow: null,
  // Canonical alphabetical order: Alice before Bob, but matrix.owners is
  // ['Bob', 'Alice'] (record-sorted) — canonical should win.
  ownerColorOrder: ['Alice', 'Bob'],
  standingsHistory: null,
  coverage: { state: 'complete', message: null },
  ownersRosterSource: 'csv',
  archiveYearResolved: null,
  generatedAt: '2026-04-26T00:00:00.000Z',
};

test('matchup matrix view reorders axis to canonical owner order when canonical is provided', () => {
  const html = renderToStaticMarkup(
    <MatchupMatrixView
      matrix={{
        // Reverse order from canonical — Bob first in source, Alice second.
        owners: ['Bob', 'Alice'],
        rows: [
          {
            owner: 'Bob',
            cells: [
              { owner: 'Bob', gameCount: 0, record: null },
              { owner: 'Alice', gameCount: 2, record: '0–2' },
            ],
          },
          {
            owner: 'Alice',
            cells: [
              { owner: 'Bob', gameCount: 2, record: '2–0' },
              { owner: 'Alice', gameCount: 0, record: null },
            ],
          },
        ],
      }}
      canonicalStandings={canonicalForMatrix}
    />
  );

  // After canonical reordering, Alice's row appears first (top), with the
  // Alice→Bob cell carrying record '2–0'. Bob's row follows.
  const aliceRowMatch = html.match(/data-owner-pair-cell="Alice::Alice"/);
  assert.ok(aliceRowMatch);
  const aliceIndex = html.indexOf('data-owner-pair-cell="Alice::Alice"');
  const bobIndex = html.indexOf('data-owner-pair-cell="Bob::Bob"');
  assert.ok(aliceIndex >= 0 && bobIndex >= 0);
  assert.ok(aliceIndex < bobIndex, 'Alice diagonal should appear before Bob diagonal');
});

test('matchup matrix view preserves source axis order when canonical is absent', () => {
  const html = renderToStaticMarkup(
    <MatchupMatrixView
      matrix={{
        owners: ['Bob', 'Alice'],
        rows: [
          {
            owner: 'Bob',
            cells: [
              { owner: 'Bob', gameCount: 0, record: null },
              { owner: 'Alice', gameCount: 2, record: '0–2' },
            ],
          },
          {
            owner: 'Alice',
            cells: [
              { owner: 'Bob', gameCount: 2, record: '2–0' },
              { owner: 'Alice', gameCount: 0, record: null },
            ],
          },
        ],
      }}
    />
  );

  // No canonical — source order preserved: Bob diagonal appears before Alice.
  const aliceIndex = html.indexOf('data-owner-pair-cell="Alice::Alice"');
  const bobIndex = html.indexOf('data-owner-pair-cell="Bob::Bob"');
  assert.ok(aliceIndex >= 0 && bobIndex >= 0);
  assert.ok(bobIndex < aliceIndex, 'source order should be preserved without canonical');
});

test('matchup matrix view appends matrix-only owners after canonical block', () => {
  const html = renderToStaticMarkup(
    <MatchupMatrixView
      matrix={{
        // Carlos exists in the matrix but not in canonical (mid-session add).
        owners: ['Bob', 'Alice', 'Carlos'],
        rows: [
          {
            owner: 'Bob',
            cells: [
              { owner: 'Bob', gameCount: 0, record: null },
              { owner: 'Alice', gameCount: 0, record: null },
              { owner: 'Carlos', gameCount: 0, record: null },
            ],
          },
          {
            owner: 'Alice',
            cells: [
              { owner: 'Bob', gameCount: 0, record: null },
              { owner: 'Alice', gameCount: 0, record: null },
              { owner: 'Carlos', gameCount: 0, record: null },
            ],
          },
          {
            owner: 'Carlos',
            cells: [
              { owner: 'Bob', gameCount: 0, record: null },
              { owner: 'Alice', gameCount: 0, record: null },
              { owner: 'Carlos', gameCount: 0, record: null },
            ],
          },
        ],
      }}
      canonicalStandings={canonicalForMatrix}
    />
  );

  // Canonical owners (Alice, Bob) should appear before the matrix-only Carlos.
  const aliceIndex = html.indexOf('data-owner-pair-cell="Alice::Alice"');
  const bobIndex = html.indexOf('data-owner-pair-cell="Bob::Bob"');
  const carlosIndex = html.indexOf('data-owner-pair-cell="Carlos::Carlos"');
  assert.ok(aliceIndex < bobIndex);
  assert.ok(bobIndex < carlosIndex);
});
