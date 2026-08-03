import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// PLATFORM-086F2G1 — deterministic retirement guard.
//
// Proves by source scan that no production code (i.e. non-test source) loads,
// sorts by, or exposes SP+ ratings / win totals anywhere (the two draft pages
// included), that the two retired admin API routes are gone, and that the
// orphaned CFBD SP+ URL helper and the dead `autoPickMetric` seam are removed.
// Existing durable AppState rows are intentionally left inert; nothing here
// deletes them. Test files are excluded — the retirement tests legitimately name
// the retired symbols they assert against.
// ---------------------------------------------------------------------------

const SRC = join(process.cwd(), 'src');

// Retired scope keys, types, derived fields, helpers, and the dead setting.
const FORBIDDEN = [
  'sp-ratings',
  'win-totals',
  'SpRatingEntry',
  'WinTotalEntry',
  'SpRatingCacheEntry',
  'spRating',
  'winTotal',
  'spTier',
  'sosTier',
  'awaitingRatings',
  'autoPickMetric',
  'buildCfbdSpRatingsUrl',
];

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__') continue; // production code only
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

test('no source file references any retired SP+/win-total/autoPickMetric symbol', () => {
  const files = collectSourceFiles(SRC);
  const offenders: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const needle of FORBIDDEN) {
      if (text.includes(needle)) {
        offenders.push(`${file.replace(SRC, 'src')} :: ${needle}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `retired references still present:\n${offenders.join('\n')}`);
});

test('the two draft pages perform no SP+/win-total AppState reads', () => {
  for (const page of [
    'app/league/[slug]/draft/page.tsx',
    'app/league/[slug]/draft/board/page.tsx',
  ]) {
    const text = readFileSync(join(SRC, page), 'utf8');
    assert.ok(!text.includes('sp-ratings'), `${page}: no sp-ratings read`);
    assert.ok(!text.includes('win-totals'), `${page}: no win-totals read`);
    assert.ok(text.includes('selectDraftTeamInsights'), `${page}: still derives neutral insights`);
  }
});

test('the two retired admin API routes are absent', () => {
  assert.ok(
    !existsSync(join(SRC, 'app/api/admin/cache-sp-ratings')),
    'cache-sp-ratings route removed'
  );
  assert.ok(!existsSync(join(SRC, 'app/api/admin/win-totals')), 'win-totals route removed');
});

test('the orphaned CFBD SP+ URL helper is removed', () => {
  const cfbd = readFileSync(join(SRC, 'lib/cfbd.ts'), 'utf8');
  assert.ok(!cfbd.includes('ratings/sp'), 'CFBD SP+ ratings endpoint helper removed');
});
