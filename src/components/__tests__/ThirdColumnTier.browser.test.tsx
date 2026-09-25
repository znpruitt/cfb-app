import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import tailwindcss from '@tailwindcss/postcss';
import { build } from 'esbuild';
import postcss from 'postcss';

import { withBrowserFixture, type BrowserFixturePage } from '../../test/browserFixture';
import { buildScheduleFromApi } from '../../lib/schedule';
import { getTeamAbbreviation } from '../../lib/teamAbbreviations';
import population from './fixtures/thirdColumnPopulation';

const breakpoints = {
  schedule: 1162,
  matchups: 1469,
};
type Surface = keyof typeof breakpoints;
type Geometry = {
  container: number;
  columns: number;
  track: number;
  gap: number;
  row: number;
  padding: number;
  namesFit: boolean;
  scoreInside: boolean;
  missingName: string | null;
  missingWraps: boolean;
};
let markupPromise: Promise<string> | undefined;
function markup(): Promise<string> {
  return (markupPromise ??= (async () => {
    const from = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
    const source =
      (await readFile(from, 'utf8')).replace(
        "@import 'tailwindcss';",
        "@import 'tailwindcss' source(none);"
      ) +
      `
      @source '../components/GameWeekPanel.tsx';
      @source '../components/MatchupsWeekPanel.tsx';
      @source '../components/CompactGameScoreboard.tsx';
      @source '../components/ScoreboardTeamName.tsx';
      @source '../components/__tests__/fixtures/ThirdColumnTierFixture.tsx';
      @source '../lib/teamLogos.ts';`;
    const css = await postcss([tailwindcss()]).process(source, { from });
    const bundle = await build({
      entryPoints: [
        fileURLToPath(new URL('./fixtures/ThirdColumnTierFixture.tsx', import.meta.url)),
      ],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"test"' },
      plugins: [
        {
          name: 'image-stub',
          setup(b) {
            b.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'stub' }));
            b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
              contents: 'export default function Image(){return null}',
              loader: 'js',
            }));
          },
        },
      ],
    });
    return `<!doctype html><html><head><meta charset="utf-8"><style>${css.css}</style></head><body><div data-fixture-root></div><script>window.process={env:{NODE_ENV:'test'}};window.tierErrors=[];window.addEventListener('error',e=>window.tierErrors.push(e.message));</script><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
  })());
}
async function ready(page: BrowserFixturePage): Promise<void> {
  const result = await page.evaluate<string[]>(`(async()=>{
    await document.fonts.ready;
    for(let i=0;i<120 && document.documentElement.dataset.tierReady!=='true';i++) await new Promise(r=>requestAnimationFrame(r));
    if(document.documentElement.dataset.tierReady!=='true') return ['fixture did not render',...window.tierErrors];
    return window.tierErrors;
  })()`);
  assert.deepEqual(result, [], 'both production panels render without browser errors');
}
async function geometry(
  page: BrowserFixturePage,
  surface: Surface,
  width: number | null
): Promise<Geometry> {
  return page.evaluate<Geometry>(`(async()=>{
    const parent=document.querySelector('[data-surface="${surface}"]');
    parent.style.width=${width === null ? "''" : JSON.stringify(`${width}px`)};
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const grid=${surface === 'schedule' ? "parent.querySelector('[data-schedule-scoreboard-grid]')" : "parent.querySelector('[data-owner-card]').parentElement"};
    const style=getComputedStyle(grid), card=grid.children[0];
    const row=card.querySelector('[data-scoreboard-side]');
    const rows=[...grid.querySelectorAll('[data-scoreboard-side]')];
    const missing=rows.find(r=>r.textContent.includes('Westgate Christian University'))?.querySelector('[data-scoreboard-team]');
    const range=document.createRange();if(missing)range.selectNodeContents(missing);
    return {container:parent.getBoundingClientRect().width,columns:style.gridTemplateColumns.split(' ').length,track:card.getBoundingClientRect().width,gap:parseFloat(style.columnGap),row:row.getBoundingClientRect().width,padding:card.getBoundingClientRect().width-row.getBoundingClientRect().width,
      namesFit:rows.every(r=>{const n=r.querySelector('[data-scoreboard-team]');return n.scrollWidth<=n.clientWidth+1 && n.scrollHeight<=n.clientHeight+1}),
      scoreInside:rows.every(r=>{const v=r.querySelector('[data-scoreboard-value]');return !v || v.getBoundingClientRect().right<=r.getBoundingClientRect().right+0.1}),
      missingName:missing?.textContent??null,missingWraps:missing?range.getClientRects().length>1:false};
  })()`);
}
for (const surface of ['schedule', 'matchups'] as const) {
  test(`${surface}: both sides of the old and new column thresholds`, async (t) => {
    await withBrowserFixture(
      t,
      { directoryPrefix: `cfb-${surface}-tiers-`, markup },
      async (page) => {
        await ready(page);
        const threshold = surface === 'schedule' ? 760.01 : 976;
        const widths = [
          390,
          Math.floor(threshold) - (surface === 'matchups' ? 1 : 0),
          surface === 'schedule' ? 761 : 976,
          breakpoints[surface] - 1,
          breakpoints[surface],
          breakpoints[surface] + 1,
          1920,
        ];
        const expected = [1, 1, 2, 2, 3, 3, 3];
        for (let index = 0; index < widths.length; index++) {
          await page.setViewport(widths[index] + 48, 900);
          const measurement = await geometry(page, surface, widths[index]);
          assert.equal(
            measurement.columns,
            expected[index],
            `${surface} columns at ${widths[index]}px`
          );
          assert.equal(
            measurement.scoreInside,
            true,
            `${surface} score anchor at ${widths[index]}px`
          );
          assert.equal(
            measurement.namesFit,
            true,
            `${surface} untruncated names at ${widths[index]}px`
          );
        }
        const atTier = await geometry(page, surface, breakpoints[surface]);
        if (surface === 'schedule') {
          assert.equal(
            atTier.missingName,
            'Westgate Christian University',
            'Schedule retains the no-abbreviation control'
          );
          assert.equal(
            atTier.missingWraps,
            false,
            'Schedule no-abbreviation control fits one line at the third tier'
          );
        }
      }
    );
  });
  test(`${surface}: third tier derives from measured two-column tracks and padding`, async (t) => {
    await withBrowserFixture(
      t,
      { directoryPrefix: `cfb-${surface}-derivation-`, markup },
      async (page) => {
        await ready(page);
        const two = await geometry(page, surface, surface === 'schedule' ? 761 : 976);
        const three = await geometry(page, surface, breakpoints[surface]);
        assert.equal(
          breakpoints[surface],
          Math.ceil(3 * two.track + 2 * two.gap),
          `${surface} breakpoint equals the measured three-track requirement`
        );
        assert.equal(
          two.padding,
          surface === 'schedule' ? 20 : 44,
          `${surface} measured card inset`
        );
        assert.ok(
          three.row >= two.row - 0.02,
          `${surface} third-tier row preserves two-column entry width`
        );
        t.diagnostic(
          `${surface}: two-column track ${two.track}px, gap ${two.gap}px, inset ${two.padding}px -> ${breakpoints[surface]}px; third-tier row ${three.row}px`
        );
      }
    );
  });
}
test('Matchups conversion preserves the app-shell viewport boundary and responds to its own container', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-matchups-coordinate-', markup },
    async (page) => {
      await ready(page);
      for (const [viewport, width, columns] of [
        [1023, 975, 1],
        [1024, 976, 2],
      ] as const) {
        await page.setViewport(viewport, 800);
        const m = await geometry(page, 'matchups', null);
        assert.equal(m.container, width, `Matchups container at ${viewport}px viewport`);
        assert.equal(m.columns, columns, `Matchups preserved transition at ${viewport}px viewport`);
      }
      await page.setViewport(1920, 800);
      assert.equal(
        (await geometry(page, 'matchups', 975)).columns,
        1,
        'Matchups constrained container overrides a wide viewport'
      );
    }
  );
});
for (const surface of ['schedule', 'matchups'] as const) {
  test(`${surface}: rendered population fits abbreviation, record and full owner at its third-tier row width`, async (t) => {
    assert.equal(population.teams.length, 238, 'Schedule normalized population is enumerated');
    assert.equal(
      population.teams.filter(([name]) => !getTeamAbbreviation(String(name))).length,
      0,
      'normalized 2026 participants all have a fallback'
    );
    await withBrowserFixture(
      t,
      { directoryPrefix: 'cfb-tier-population-', markup },
      async (page) => {
        await ready(page);
        const report = await page.evaluate<
          Array<{
            surface: string;
            count: number;
            failures: string[];
            widest: string;
            required: number;
          }>
        >(`(()=>{
      return [...document.querySelectorAll('[data-population]')].map(container=>{
        let widest='',required=0;const failures=[];
        const teams=[...container.querySelectorAll('[data-population-team]')];
        for(const team of teams){const row=team.querySelector('[data-scoreboard-side="away"]'),name=row.querySelector('[data-scoreboard-team-label]'),ab=row.querySelector('[data-scoreboard-team-abbreviation]'),owner=row.querySelector('[data-scoreboard-owner]'),record=row.querySelector('[data-scoreboard-record]'),score=row.querySelector('[data-scoreboard-value]');
          if(!ab || !name || name.scrollWidth>name.clientWidth+1 || (owner && owner.scrollWidth>owner.clientWidth+1) || (record && record.scrollWidth>record.clientWidth+1)) failures.push(team.dataset.populationTeam);
          const intrinsic=row.getBoundingClientRect().width-name.getBoundingClientRect().width+ab.getBoundingClientRect().width;
          if(intrinsic>required){required=intrinsic;widest=team.dataset.populationTeam;}
          if(score.getBoundingClientRect().right>row.getBoundingClientRect().right+0.1)failures.push(team.dataset.populationTeam+' score');
        }
        return {surface:container.dataset.population,count:teams.length,failures,widest,required};
      });
    })()`);
        assert.deepEqual(
          report.map((x) => x.count),
          [238, 237],
          'Schedule and owner-slate opponent populations are both measured'
        );
        for (const r of report.filter((r) => r.surface === surface)) {
          assert.deepEqual(
            r.failures,
            [],
            `${r.surface} fallback, record, full owner and score fit`
          );
          t.diagnostic(
            `${r.surface}: ${r.count} participant names; governing final stress row ${r.widest}, ${r.required}px intrinsic; rank #25 on owned rows, record 12–0 only on Matchups, owner Shambaugh, score 100`
          );
        }
      }
    );
  });
}
test('the current eligibility gate excludes Westgate, while its missing abbreviation stays explicit', () => {
  assert.equal(getTeamAbbreviation('Westgate Christian University'), null);
  const built = buildScheduleFromApi({
    season: 2026,
    teams: [],
    aliasMap: {},
    scheduleItems: [
      {
        id: 'excluded-westgate',
        week: 1,
        startDate: '2026-09-05T16:00:00Z',
        seasonType: 'regular',
        neutralSite: false,
        conferenceGame: false,
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
        awayTeam: 'Westgate Christian University',
        homeTeam: 'Missouri S&T',
        homeClassification: 'ii',
      },
      {
        id: 'included-westgate',
        week: 1,
        startDate: '2026-09-05T16:00:00Z',
        seasonType: 'regular',
        neutralSite: false,
        conferenceGame: false,
        homeConference: '',
        awayConference: '',
        status: 'scheduled',
        awayTeam: 'Westgate Christian University',
        homeTeam: 'Ohio State',
        homeClassification: 'fbs',
      },
    ],
  });
  assert.deepEqual(
    built.games.map((g) => g.providerGameId),
    ['included-westgate'],
    'eligibility excludes the non-FBS pairing, not missing abbreviations themselves'
  );
});
