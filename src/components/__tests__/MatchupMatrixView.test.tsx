import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MatchupMatrixView from '../MatchupMatrixView';

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

  assert.match(html, /Matchup matrix/);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /1–1/);
  assert.match(html, /<table/);
});

test('matchup matrix view renders explicit empty state when no owners exist', () => {
  const html = renderToStaticMarkup(<MatchupMatrixView matrix={{ owners: [], rows: [] }} />);

  assert.match(html, /No matrix data yet/);
  assert.doesNotMatch(html, /<table/);
});
