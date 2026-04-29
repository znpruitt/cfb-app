import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TitleTimeline from '../history/TitleTimeline.tsx';
import type { ChampionshipEntry } from '../../lib/selectors/historySelectors';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

test('TitleTimeline: renders all championship years with their champions', () => {
  const championships: ChampionshipEntry[] = [
    { year: 2023, champion: 'Pruitt' },
    { year: 2024, champion: 'Whited' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const html = render(
    <TitleTimeline
      championships={championships}
      slug="tsc"
      activeOwners={new Set(['Pruitt', 'Whited'])}
    />
  );

  assert.match(html, /2023/);
  assert.match(html, /2024/);
  assert.match(html, /2025/);
  assert.match(html, /Pruitt/);
  assert.match(html, /Whited/);
});

test('TitleTimeline: renders champion link to /history/owner/[name]', () => {
  const championships: ChampionshipEntry[] = [{ year: 2025, champion: 'Pruitt' }];
  const html = render(
    <TitleTimeline championships={championships} slug="tsc" activeOwners={new Set(['Pruitt'])} />
  );

  assert.match(html, /href="\/league\/tsc\/history\/owner\/Pruitt"/);
});

test('TitleTimeline: shows FormerOwnerBadge for champion not in activeOwners', () => {
  const championships: ChampionshipEntry[] = [
    { year: 2018, champion: 'Hardiman' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const html = render(
    <TitleTimeline
      championships={championships}
      slug="tsc"
      activeOwners={new Set(['Pruitt'])} // Hardiman is former
    />
  );

  assert.match(html, /former/);
});

test('TitleTimeline: does not show FormerOwnerBadge when all champions are still active', () => {
  const championships: ChampionshipEntry[] = [
    { year: 2024, champion: 'Whited' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const html = render(
    <TitleTimeline
      championships={championships}
      slug="tsc"
      activeOwners={new Set(['Pruitt', 'Whited'])}
    />
  );

  assert.doesNotMatch(html, /former/);
});

test('TitleTimeline: encodes owner names with spaces in href', () => {
  const championships: ChampionshipEntry[] = [{ year: 2025, champion: 'John Smith' }];
  const html = render(
    <TitleTimeline
      championships={championships}
      slug="tsc"
      activeOwners={new Set(['John Smith'])}
    />
  );

  assert.match(html, /href="\/league\/tsc\/history\/owner\/John%20Smith"/);
});

test('TitleTimeline: empty championships shows fallback copy', () => {
  const html = render(
    <TitleTimeline championships={[]} slug="tsc" activeOwners={new Set<string>()} />
  );

  assert.match(html, /No champions yet/);
});

test('TitleTimeline: Unknown champion (archive without final standings) renders without link', () => {
  const championships: ChampionshipEntry[] = [{ year: 2020, champion: 'Unknown' }];
  const html = render(
    <TitleTimeline championships={championships} slug="tsc" activeOwners={new Set<string>()} />
  );

  assert.match(html, /Unknown/);
  assert.doesNotMatch(html, /href="[^"]*\/owner\/Unknown/);
  assert.doesNotMatch(html, /former/);
});
