import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import RankedTeamName from '../RankedTeamName';

test('ranked team renders with prefixed rank and source hover text', () => {
  const html = renderToStaticMarkup(
    <RankedTeamName teamName="Alabama" ranking={{ rank: 6, rankSource: 'cfp' }} />
  );

  assert.match(html, /#6 Alabama/);
  assert.match(html, /title="CFP rank #6"/);
});

test('unranked team renders without rank prefix', () => {
  const html = renderToStaticMarkup(<RankedTeamName teamName="Alabama" />);

  assert.match(html, />Alabama</);
  assert.doesNotMatch(html, /#\d+/);
  assert.doesNotMatch(html, /title=/);
});
