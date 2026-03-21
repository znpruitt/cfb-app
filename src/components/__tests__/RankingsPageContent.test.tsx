import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import RankingsPageContent from '../RankingsPageContent';

test('rankings page renders CFP first and AP as a separate section', () => {
  const html = renderToStaticMarkup(
    <RankingsPageContent
      season={2025}
      loading={false}
      error={null}
      latestWeek={{
        season: 2025,
        seasonType: 'regular',
        week: 12,
        primarySource: 'cfp',
        teams: [],
        polls: {
          cfp: [{ teamId: 'oregon', teamName: 'Oregon', rank: 1, rankSource: 'cfp' }],
          ap: [{ teamId: 'texas', teamName: 'Texas', rank: 2, rankSource: 'ap' }],
          coaches: [],
        },
      }}
    />
  );

  const cfpIndex = html.indexOf('CFP rankings');
  const apIndex = html.indexOf('AP Top 25');
  assert.ok(cfpIndex >= 0);
  assert.ok(apIndex > cfpIndex);
  assert.match(html, /#1 Oregon/);
  assert.match(html, /#2 Texas/);
});
