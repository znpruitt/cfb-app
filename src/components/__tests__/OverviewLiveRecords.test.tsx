import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { queryAllByRole } from '@testing-library/dom';
import OverviewPanel from '../OverviewPanel';
import StandingsPanel from '../StandingsPanel';
import { deriveLeagueInsights, deriveOverviewInsights } from '../../lib/selectors/insights';
import type { OwnerStandingsRow } from '../../lib/standings';
import type { StandingsHistory } from '../../lib/standingsHistory';
import { selectOverviewViewModel } from '../../lib/selectors/overview';

function row(
  owner: string,
  wins: number,
  losses: number,
  diff: number,
  gb: number
): OwnerStandingsRow {
  return {
    owner,
    wins,
    losses,
    winPct: wins / (wins + losses),
    pointsFor: 200 + diff,
    pointsAgainst: 200,
    pointDifferential: diff,
    gamesBack: gb,
    finalGames: wins + losses,
  };
}

const week1 = [
  row('Chamness', 10, 2, 90, 0),
  row('BHooper', 9, 3, 70, 1),
  row('Surowiec', 8, 4, 60, 2),
];
const week2 = [
  row('BHooper', 15, 4, 130, 0),
  row('Surowiec', 14, 4, 120, 0.5),
  row('Chamness', 14, 6, 100, 1.5),
];
const live = [
  row('Chamness', 17, 6, 160, 0),
  row('Surowiec', 16, 4, 150, 0.5),
  row('BHooper', 15, 6, 110, 1),
];
const history: StandingsHistory = {
  weeks: [1, 2, 3],
  byWeek: Object.fromEntries(
    [week1, week2, live].map((rows, i) => [
      i + 1,
      {
        week: i + 1,
        played: i < 2,
        coverage: { state: 'complete', message: null },
        standings: rows.map((r) => ({ ...r, ties: 0 })),
      },
    ])
  ),
  byOwner: Object.fromEntries(
    live.map((r) => [
      r.owner,
      [week1, week2, live].map((rows, i) => ({
        ...rows.find((s) => s.owner === r.owner)!,
        week: i + 1,
        ties: 0,
      })),
    ])
  ),
};
const base = {
  standingsLeaders: live,
  standingsHistory: history,
  standingsCoverage: { state: 'complete' as const, message: null },
  context: { scopeDetail: 'Week 3' },
  liveItems: [],
  keyMatchups: [],
  matchupMatrix: { owners: [], rows: [] },
  rankingsByTeamId: new Map(),
  seasonContext: 'in-season' as const,
};
function render(overrides: Partial<React.ComponentProps<typeof OverviewPanel>> = {}) {
  const inputs = { ...base, ...overrides };
  return new JSDOM(
    renderToStaticMarkup(
      <OverviewPanel
        {...base}
        sectionItems={[]}
        nowMs={Date.parse('2026-09-19T18:00:00Z')}
        onOwnerSelect={() => {}}
        {...overrides}
        canonicalStandings={{
          slug: 'tsc',
          year: 2026,
          source: 'live',
          lifecycle: 'mid_season',
          rows: inputs.standingsLeaders,
          standingsHistory: inputs.standingsHistory ?? null,
          coverage: inputs.standingsCoverage,
          noClaimRow: null,
          ownerColorOrder: live.map((r) => r.owner),
          ownersRosterSource: 'csv',
          archiveYearResolved: null,
          inferredSeasonStart: null,
          generatedAt: '2026-09-19T18:00:00Z',
        }}
      />
    )
  ).window.document;
}
function tableRows(doc: Document) {
  const heading = [...doc.querySelectorAll('p')].find((p) => p.textContent === 'Standings')!;
  return [...heading.parentElement!.parentElement!.querySelectorAll('button')].map((button) => {
    const primary = button.parentElement!.parentElement!;
    return {
      owner: button.textContent,
      rank: primary.firstElementChild!.firstChild!.textContent,
      record: button.parentElement!.nextElementSibling!.textContent,
      secondary: primary.nextElementSibling!.textContent,
      gb: primary.lastElementChild!.textContent,
    };
  });
}
test('827: partial-week table and in-season podium share live records and ordering', () => {
  const model = selectOverviewViewModel(base);
  assert.equal(model.heroMode, 'leader', 'fixture exercises the in-season hero branch');
  assert.deepEqual(model.podiumLeaders, [], 'completed-season podium selector is unused');
  const doc = render();
  const podium = [...doc.querySelectorAll('article')].slice(0, 3).map((card) => ({
    owner: card.querySelector(':scope > div > p')!.textContent,
    record: card.querySelector(':scope > div > p + p')!.textContent,
  }));
  assert.deepEqual(
    podium,
    live.map((r) => ({ owner: r.owner, record: `${r.wins}–${r.losses}` })),
    'in-season podium stays live'
  );
  const rows = tableRows(doc);
  assert.deepEqual(
    rows.map(({ owner, record }) => ({ owner, record })),
    podium,
    'partial-week table matches the rendered in-season podium'
  );
  assert.deepEqual(
    rows.map((r) => r.rank),
    ['1', '2', '3'],
    'table ranks follow live order'
  );
  assert.deepEqual(
    rows.map((r) => r.secondary),
    live.map((r) => `Win% ${r.winPct.toFixed(3)}Diff +${r.pointDifferential}`),
    'table Win% and Diff stay live'
  );
  assert.deepEqual(
    rows.map((r) => r.gb),
    ['—', '0.5 GB', '1 GB'],
    'table GB stays live'
  );
});

function arrowLabels(doc: Document) {
  const heading = [...doc.querySelectorAll('p')].find((p) => p.textContent === 'Standings')!;
  return [...heading.parentElement!.parentElement!.querySelectorAll('button')].map((button) => ({
    owner: button.textContent,
    label:
      button
        .parentElement!.previousElementSibling!.querySelector('[aria-label]')
        ?.getAttribute('aria-label') ?? null,
  }));
}
test('827: arrows are owner-keyed resolved movement beside live ranks', () => {
  const doc = render();
  assert.ok(
    doc.body.textContent!.includes('Movement · through W2'),
    'movement names latest resolved boundary'
  );
  assert.deepEqual(
    arrowLabels(doc),
    [
      { owner: 'Chamness', label: 'Moved down 2 places from W1 to W2' },
      { owner: 'Surowiec', label: 'Moved up 1 place from W1 to W2' },
      { owner: 'BHooper', label: 'Moved up 1 place from W1 to W2' },
    ],
    'arrows compare W1 to W2 by owner even when live rank reverses movement'
  );
});

test('827: movement arrows expose an accessible image name with both resolved boundaries', () => {
  const doc = render();
  assert.equal(
    queryAllByRole(doc.body, 'img', { name: 'Moved down 2 places from W1 to W2' }).length,
    1,
    'down arrow exposes its full comparison as an accessible image name'
  );
  assert.equal(
    queryAllByRole(doc.body, 'img', { name: 'Moved up 1 place from W1 to W2' }).length,
    2,
    'up arrows expose their full comparison as accessible image names'
  );
});

test('827: zero or one resolved snapshot shows the boundary but no arrow', () => {
  for (const count of [0, 1]) {
    const limited = { ...history, weeks: history.weeks.slice(0, count) };
    const doc = render({ standingsHistory: limited });
    assert.ok(
      doc.body.textContent!.includes(
        count === 0 ? 'Movement · awaiting first resolved week' : 'Movement · through W1'
      ),
      'sparse history label is truthful'
    );
    assert.ok(
      arrowLabels(doc).every((r) => r.label === null),
      'two resolved snapshots are required for arrows'
    );
    assert.deepEqual(
      tableRows(doc).map((r) => r.record),
      ['17–6', '16–4', '15–6'],
      'history absence never erases live records'
    );
  }
  assert.deepEqual(
    tableRows(render({ standingsHistory: null })).map((r) => r.owner),
    live.map((r) => r.owner),
    'null history preserves row population'
  );
});

function section(doc: Document, title: string) {
  const heading = [...doc.querySelectorAll('p,h2')].find((p) => p.textContent === title);
  assert.ok(heading, `${title} observer finds rendered section`);
  return heading.parentElement!.parentElement!;
}
test('827: fallback insights retain resolved rows while engine insights lead', () => {
  const expected = deriveOverviewInsights(
    deriveLeagueInsights({ rows: week2, standingsHistory: history, seasonContext: 'in-season' })
  );
  const race = expected.find((i) => i.type === 'race')!;
  assert.ok(race, 'fixture produces a resolved race insight');
  const liveRace = deriveOverviewInsights(
    deriveLeagueInsights({ rows: live, standingsHistory: history, seasonContext: 'in-season' })
  ).find((i) => i.type === 'race')!;
  assert.notEqual(
    race.description,
    liveRace.description,
    'fixture distinguishes resolved and live insight inputs'
  );
  const engine = {
    ...race,
    id: 'engine-sentinel',
    title: 'Engine first',
    description: 'Precomputed engine insight.',
    priorityScore: 999,
  };
  const text = section(render({ engineInsights: [engine] }), 'Insights').textContent!;
  assert.ok(text.includes(race.description), 'fallback race describes the resolved leader');
  assert.ok(!text.includes(liveRace.description), 'fallback does not substitute live race');
  assert.ok(text.includes(engine.description), 'engine insight remains present');
  assert.ok(
    text.indexOf(engine.description) < text.indexOf(race.description),
    'engine insight precedes resolved fallback'
  );
});

test('827: GB Race keeps resolved chart points and live companion totals', () => {
  const current = section(render(), 'GB Race');
  const resolved = section(render({ standingsLeaders: week2 }), 'GB Race');
  assert.ok(current.querySelectorAll('svg path').length > 0, 'chart observer sees plotted paths');
  assert.deepEqual(
    [...current.querySelectorAll('svg')].map((s) => s.outerHTML),
    [...resolved.querySelectorAll('svg')].map((s) => s.outerHTML),
    'GB chart ignores live row changes'
  );
  assert.ok(!current.textContent!.includes('W3'), 'unresolved week stays off GB Race');
  const rows = [...current.querySelectorAll('div')].filter(
    (d) => d.firstElementChild?.textContent === 'BHooper'
  );
  assert.ok(
    rows.some((d) => d.lastElementChild?.textContent === '1'),
    'GB companion uses live BHooper total'
  );
  assert.notEqual(
    current.textContent,
    resolved.textContent,
    'live total observer detects the distinct resolved snapshot'
  );
});

test('827: Standings page retains its live endpoint pending issue 851', () => {
  const doc = new JSDOM(
    renderToStaticMarkup(
      <StandingsPanel
        rows={live}
        season={2026}
        coverage={base.standingsCoverage}
        ownerColorMap={{}}
        standingsHistory={history}
        seasonContext="in-season"
      />
    )
  ).window.document;
  const rows = [...doc.querySelectorAll('tbody tr')];
  assert.ok(rows.length >= 3, 'Standings observer finds owner rows');
  assert.ok(rows[0].textContent!.includes('Chamness'), 'Standings leader remains live');
  assert.ok(rows[0].textContent!.includes('17'), 'Standings record remains live');
  assert.ok(
    rows[2].querySelector('[aria-label="Moved down 1 spot from last week"]'),
    'Standings keeps W1 to live W3 movement'
  );
});

test('827: table limit and overflow use the live population', () => {
  const extra = [
    ...live,
    row('Fourth', 5, 5, 0, 5),
    row('Fifth', 4, 6, -10, 6),
    row('Sixth', 3, 7, -20, 7),
  ];
  const model = selectOverviewViewModel({ ...base, standingsLeaders: extra });
  assert.deepEqual(model.standingsTopN, extra.slice(0, 5), 'top N comes from live population');
  assert.equal(model.standingsHasMore, true, 'overflow comes from live population');
});
