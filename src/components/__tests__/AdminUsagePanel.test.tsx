import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AdminUsagePanel from '../AdminUsagePanel';

test('admin usage panel renders odds snapshot timestamp field', () => {
  const html = renderToStaticMarkup(
    <AdminUsagePanel
      initialOddsUsage={{
        used: 100,
        remaining: 400,
        lastCost: 3,
        limit: 500,
        capturedAt: '2026-01-01T12:00:00.000Z',
        source: 'quota-error-fallback',
        sportKey: 'americanfootball_ncaaf',
        markets: ['h2h'],
        regions: ['us'],
        endpointType: 'odds',
        cacheStatus: 'miss',
      }}
    />
  );

  assert.match(html, /Odds API Usage \(latest known snapshot\)/);
  assert.match(html, /Last Updated:/);
  assert.match(html, /conservative fallback generated from a quota error response/i);
});
