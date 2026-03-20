import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import IssuesPanel from '../IssuesPanel';
import { getAdminAlertCount, splitIssueDiagnostics } from '../../lib/adminDiagnostics';
import type { DiagEntry } from '../../lib/diagnostics';

const ignoredRow: DiagEntry = {
  kind: 'ignored_score_row',
  week: 3,
  providerHome: 'FCS Home',
  providerAway: 'FCS Away',
  reason: 'no_scheduled_match',
  diagnostic: {
    type: 'ignored_score_row',
    classification: 'ignored',
    reason: 'no_scheduled_match',
    userMessage: 'Ignored non-league provider row.',
    provider: {
      source: 'cfbd_scores',
      week: 3,
      homeTeamRaw: 'FCS Home',
      awayTeamRaw: 'FCS Away',
      seasonType: 'regular',
      providerGameId: null,
      homeScore: null,
      awayScore: null,
      status: null,
      kickoff: null,
    },
    normalization: {
      homeTeamNormalized: null,
      awayTeamNormalized: null,
    },
    resolution: {
      homeCanonical: null,
      awayCanonical: null,
      homeResolved: false,
      awayResolved: false,
    },
    trace: {
      candidateCount: 0,
      plausibleScheduledGameCount: 0,
      finalNote: 'Expected out-of-scope row.',
    },
  },
  debugOnly: true,
};

const actionableIgnoredScoreRow: DiagEntry = {
  kind: 'ignored_score_row',
  week: 7,
  providerHome: 'Provider Home',
  providerAway: 'Provider Away',
  reason: 'multiple_candidate_matches',
  diagnostic: {
    type: 'ignored_score_row',
    classification: 'actionable',
    reason: 'multiple_candidate_matches',
    userMessage: 'Action required: canonical schedule match is ambiguous',
    provider: {
      source: 'cfbd_scores',
      week: 7,
      homeTeamRaw: 'Provider Home',
      awayTeamRaw: 'Provider Away',
      seasonType: 'regular',
      providerGameId: 'abc',
      homeScore: 24,
      awayScore: 21,
      status: 'final',
      kickoff: '2026-10-18T18:00:00Z',
    },
    normalization: {
      homeTeamNormalized: 'provider home',
      awayTeamNormalized: 'provider away',
    },
    resolution: {
      homeCanonical: 'Provider Home',
      awayCanonical: 'Provider Away',
      homeResolved: true,
      awayResolved: true,
    },
    trace: {
      candidateCount: 2,
      plausibleScheduledGameCount: 2,
      finalNote: 'Multiple schedule candidates remain.',
    },
  },
  debugOnly: true,
};

test('splitIssueDiagnostics keeps actionable ignored-score diagnostics in the actionable bucket', () => {
  const result = splitIssueDiagnostics([ignoredRow, actionableIgnoredScoreRow]);

  assert.equal(result.actionableDiag.length, 1);
  assert.equal(result.ignoredDebugDiag.length, 1);
  assert.equal(result.actionableDiag[0]?.kind, 'ignored_score_row');
  if (result.actionableDiag[0]?.kind === 'ignored_score_row') {
    assert.equal(result.actionableDiag[0].diagnostic.classification, 'actionable');
  }
});

test('IssuesPanel keeps actionable score-attachment diagnostics in the main issues block', () => {
  const html = renderToStaticMarkup(
    <IssuesPanel
      issues={[]}
      diag={[actionableIgnoredScoreRow, ignoredRow]}
      aliasStaging={{ upserts: {}, deletes: [] }}
      aliasToast={null}
      pillClass={() => 'pill'}
      onCommitStagedAliases={() => undefined}
      onStageAlias={() => undefined}
    />
  );

  assert.match(html, /<div class="font-medium">Issues<\/div>/);
  assert.match(html, /Score attachment/);
  assert.match(html, /Action required: canonical schedule match is ambiguous/);
  assert.match(html, /Ignored provider rows \(informational\) \(1\)/);
  assert.match(html, /Ignored non-league provider row\./);
});

test('IssuesPanel keeps save staged aliases visible in ignored-row-only states', () => {
  const html = renderToStaticMarkup(
    <IssuesPanel
      issues={[]}
      diag={[ignoredRow]}
      aliasStaging={{ upserts: { 'UTSA Roadrunners': 'UTSA' }, deletes: [] }}
      aliasToast={null}
      pillClass={() => 'pill'}
      onCommitStagedAliases={() => undefined}
      onStageAlias={() => undefined}
    />
  );

  assert.match(html, /Staged alias changes/);
  assert.match(html, /Save staged aliases/);
  assert.match(
    html,
    /Save staged alias mappings to preserve commissioner repairs discovered in debug tools\./
  );
  assert.match(html, /Ignored provider rows \(informational\) \(1\)/);
});

test('admin alert count excludes informational ignored rows and includes actionable score diagnostics and staged aliases', () => {
  const count = getAdminAlertCount({
    issues: ['Alias repair needed'],
    diag: [ignoredRow, actionableIgnoredScoreRow],
    aliasStaging: { upserts: { 'UTSA Roadrunners': 'UTSA' }, deletes: ['Old Alias'] },
  });

  assert.equal(count, 4);
});
