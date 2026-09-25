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
// Measure visible glyph rectangles against every clipping ancestor, including the
// suffix that can clip a shrink-0 record. Hidden fit probes are not visible content.
const visibleTextFits = `(element, row) => {
  if (!element) return false;
  const style = getComputedStyle(element);
  if (style.visibility !== 'visible' || style.display === 'none') return false;
  const box = element.getBoundingClientRect();
  let left = box.left, right = box.right, top = box.top, bottom = box.bottom;
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const rect = ancestor.getBoundingClientRect(), css = getComputedStyle(ancestor);
    if (ancestor === row || ['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX)) {
      left = Math.max(left, rect.left); right = Math.min(right, rect.right);
    }
    if (ancestor === row || ['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)) {
      top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom);
    }
    if (ancestor === row) break;
  }
  const range = document.createRange(); range.selectNodeContents(element);
  const glyphs = [...range.getClientRects()].filter(rect => rect.width > 0);
  return glyphs.length > 0 && glyphs.every(rect => rect.left >= left - 0.5 &&
    rect.right <= right + 0.5 && rect.top >= top - 0.5 && rect.bottom <= bottom + 0.5);
}`;
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
      /* Reproduce the measured 16px root / zero scrollbar-gutter coordinate system. */
      html { font-size: 16px; scrollbar-width: none; }
      @source '../components/CFBScheduleApp.tsx';
      @source '../components/GameWeekPanel.tsx';
      @source '../components/MatchupsWeekPanel.tsx';
      @source '../components/CompactGameScoreboard.tsx';
      @source '../components/ScoreboardTeamName.tsx';
      @source '../components/__tests__/fixtures/ThirdColumnTierFixture.tsx';
      @source '../lib/teamLogos.ts';`;
    const css = await postcss([tailwindcss()]).process(source, { from });
    const appSource = await readFile(new URL('../CFBScheduleApp.tsx', import.meta.url), 'utf8');
    const shell = appSource.match(/return\s*\(\s*<div className="([^"]+)"\s*>\s*<header/);
    assert.ok(shell, 'fixture must source the production app-root classes');
    const bundle = await build({
      entryPoints: [
        fileURLToPath(new URL('./fixtures/ThirdColumnTierFixture.tsx', import.meta.url)),
      ],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"test"', __CFB_SHELL_CLASS__: JSON.stringify(shell[1]) },
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
    const grid=${surface === 'schedule' ? "parent.querySelector('[data-schedule-scoreboard-grid]')" : "(parent.querySelector('[data-matchups-scoreboard-grid]') ?? parent.querySelector('[data-owner-card]').parentElement)"};
    const style=getComputedStyle(grid), card=grid.children[0];
    const row=card.querySelector('[data-scoreboard-side]');
    const rows=[...grid.querySelectorAll('[data-scoreboard-side]')];
    const missing=rows.find(r=>r.textContent.includes('Westgate Christian University'))?.querySelector('[data-scoreboard-team]');
    const range=document.createRange();if(missing)range.selectNodeContents(missing);
    return {container:parent.getBoundingClientRect().width,columns:style.gridTemplateColumns.split(' ').length,track:card.getBoundingClientRect().width,gap:parseFloat(style.columnGap),row:row.getBoundingClientRect().width,padding:card.getBoundingClientRect().width-row.getBoundingClientRect().width,
      namesFit:rows.every(r=>(${visibleTextFits})(r.querySelector('[data-scoreboard-team-visible]') ?? r.querySelector('[data-scoreboard-team]'),r)),
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
        {
          assert.equal(
            atTier.missingName,
            'Westgate Christian University',
            `${surface} retains the no-abbreviation control`
          );
          assert.equal(
            atTier.missingWraps,
            false,
            `${surface} no-abbreviation control fits one line at the third tier`
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
test('Matchups conversion preserves the measured 16px zero-gutter shell boundary and responds to its own container', async (t) => {
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
        const conditions = await page.evaluate<{
          rootFont: string;
          gutter: number;
          scrollbarPolicy: string;
          legacyLg: boolean;
          font: string;
          browser: string;
        }>(`({
          rootFont: getComputedStyle(document.documentElement).fontSize,
          gutter: innerWidth - document.documentElement.clientWidth,
          scrollbarPolicy: getComputedStyle(document.documentElement).scrollbarWidth,
          legacyLg: matchMedia('(min-width: 64rem)').matches,
          font: getComputedStyle(document.querySelector('[data-scoreboard-team-visible]')).font,
          browser: navigator.userAgent
        })`);
        assert.equal(conditions.rootFont, '16px', 'boundary measurement uses a 16px root font');
        assert.equal(
          conditions.scrollbarPolicy,
          'none',
          'boundary measurement disables scrollbar gutters on every host'
        );
        assert.equal(conditions.gutter, 0, 'boundary measurement reserves zero scrollbar width');
        assert.equal(
          conditions.legacyLg,
          viewport >= 1024,
          'legacy media-query rem uses the measured 16px browser default'
        );
        t.diagnostic(JSON.stringify({ viewport, ...conditions }));
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
test('both populations fit their measured tier rows and exercise the abbreviation fallback', async (t) => {
  assert.equal(population.teams.length, 238, 'Schedule normalized population is enumerated');
  assert.equal(
    population.teams.filter(([name]) => !getTeamAbbreviation(name)).length,
    0,
    'normalized 2026 participants all have a fallback'
  );
  await withBrowserFixture(t, { directoryPrefix: 'cfb-tier-population-', markup }, async (page) => {
    await ready(page);
    for (const surface of ['schedule', 'matchups'] as const) {
      await t.test(`${surface} visible population`, async () => {
        const actual = await geometry(page, surface, breakpoints[surface]);
        const report = await page.evaluate<
          Array<{
            width: number;
            rowWidths: number[];
            count: number;
            failures: string[];
            abbreviated: number;
            widest: string;
            required: number;
          }>
        >(`(async()=>{
          const container = document.querySelector('[data-population="${surface}"]');
          const fits = ${visibleTextFits};
          const report = [];
          for (const width of [${actual.row}, ${surface === 'schedule' ? 230 : 280}]) {
            container.style.width = width + 'px';
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            let widest='', required=0, abbreviated=0; const failures=[], rowWidths=[];
            const teams=[...container.querySelectorAll('[data-population-team]')];
            for(const team of teams) {
              const row=team.querySelector('[data-scoreboard-side="away"]');
              rowWidths.push(row.getBoundingClientRect().width);
              const name=row.querySelector('[data-scoreboard-team-label]');
              const visible=row.querySelector('[data-scoreboard-team-visible]');
              const ab=row.querySelector('[data-scoreboard-team-abbreviation]');
              const owner=row.querySelector('[data-scoreboard-owner]');
              const record=row.querySelector('[data-scoreboard-record]');
              const score=row.querySelector('[data-scoreboard-value]');
              if (!fits(visible,row)) failures.push(team.dataset.populationTeam+' name');
              if (owner && !fits(owner,row)) failures.push(team.dataset.populationTeam+' owner');
              if (record && !fits(record,row)) failures.push(team.dataset.populationTeam+' record');
              if (!fits(score,row)) failures.push(team.dataset.populationTeam+' score');
              if (name.dataset.scoreboardTeamDisplay === 'abbreviation') abbreviated++;
              const intrinsic=row.getBoundingClientRect().width-name.getBoundingClientRect().width+ab.getBoundingClientRect().width;
              if(intrinsic>required){required=intrinsic;widest=team.dataset.populationTeam;}
            }
            report.push({width,rowWidths,count:teams.length,failures,abbreviated,widest,required});
          }
          return report;
        })()`);
        for (const sample of report) {
          assert.ok(
            sample.rowWidths.every((width) => Math.abs(width - sample.width) <= 0.02),
            `${surface} every rendered population row matches its assigned budget of ${sample.width}px (observed ${Math.min(...sample.rowWidths)}–${Math.max(...sample.rowWidths)}px)`
          );
          assert.equal(
            sample.count,
            surface === 'schedule' ? 238 : 237,
            `${surface} complete participant population`
          );
          assert.deepEqual(
            sample.failures,
            [],
            `${surface} visible name, full owner, record and score fit at ${sample.width}px`
          );
        }
        assert.ok(
          report[1].abbreviated > 0,
          `${surface} narrow control actually renders abbreviations`
        );
        t.diagnostic(
          `${surface}: ${report[0].count} participants; ${report[0].widest} requires ${report[0].required}px; actual tier row ${actual.row}px; rendered population rows ${Math.min(...report[0].rowWidths)}–${Math.max(...report[0].rowWidths)}px; narrow control abbreviates ${report[1].abbreviated} rows`
        );
      });
    }
  });
});
test('visible-name and record-clipping observers reject their own poisoned controls', async (t) => {
  await withBrowserFixture(t, { directoryPrefix: 'cfb-tier-observers-', markup }, async (page) => {
    await ready(page);
    const report = await page.evaluate<{
      nameBefore: boolean;
      nameAfter: boolean;
      recordBefore: boolean;
      recordAfter: boolean;
    }>(`(()=>{
      const row=document.querySelector('[data-population="matchups"] [data-scoreboard-side="away"]');
      const fits=${visibleTextFits};
      const name=row.querySelector('[data-scoreboard-team-visible]');
      const record=row.querySelector('[data-scoreboard-record]');
      const suffix=row.querySelector('[data-scoreboard-suffix]');
      const nameBefore=fits(name,row), recordBefore=fits(record,row);
      name.style.width='1px'; name.style.height='1px'; name.style.overflow='hidden';
      suffix.style.maxWidth='1px';
      return {nameBefore,nameAfter:fits(name,row),recordBefore,recordAfter:fits(record,row)};
    })()`);
    assert.equal(report.nameBefore, true, 'visible-name positive control');
    assert.equal(report.nameAfter, false, 'visible-name observer detects clipped visible glyphs');
    assert.equal(report.recordBefore, true, 'record positive control');
    assert.equal(
      report.recordAfter,
      false,
      'record observer detects suffix clipping without an owner'
    );
  });
});
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
