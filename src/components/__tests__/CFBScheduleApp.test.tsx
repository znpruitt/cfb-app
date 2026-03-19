import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CFBScheduleApp from '../CFBScheduleApp';

test('league surface links to admin tooling without rendering admin panels inline', () => {
  const html = renderToStaticMarkup(<CFBScheduleApp />);

  assert.match(html, /Admin \/ Debug/);
  assert.doesNotMatch(html, /Commissioner tools and diagnostics/);
  assert.doesNotMatch(html, /Admin diagnostics: API usage/);
});

test('admin surface renders dedicated admin and debug tooling', () => {
  const html = renderToStaticMarkup(<CFBScheduleApp surface="admin" />);

  assert.match(html, /Commissioner tools and diagnostics/);
  assert.match(html, /Admin diagnostics: API usage/);
  assert.match(html, /Back to league view/);
});
