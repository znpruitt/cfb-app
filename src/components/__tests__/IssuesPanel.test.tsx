import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import IssuesPanel, { splitIssueDiagnostics } from '../IssuesPanel';
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

test('splitIssueDiagnostics excludes ignored provider rows from actionable diagnostics', () => {
  const actionable: DiagEntry = {
    kind: 'scores_miss',
    week: 4,
    providerHome: 'Home Team',
    providerAway: 'Away Team',
  };

  const result = splitIssueDiagnostics([ignoredRow, actionable]);

  assert.equal(result.actionableDiag.length, 1);
  assert.equal(result.ignoredDebugDiag.length, 1);
  assert.equal(result.actionableDiag[0].kind, 'scores_miss');
});

test('IssuesPanel renders ignored provider rows in informational diagnostics instead of main issues block', () => {
  const html = renderToStaticMarkup(
    <IssuesPanel
      issues={[]}
      diag={[ignoredRow]}
      aliasStaging={{ upserts: {}, deletes: [] }}
      aliasToast={null}
      pillClass={() => 'pill'}
      onCommitStagedAliases={() => undefined}
      onStageAlias={() => undefined}
    />
  );

  assert.match(html, /Ignored provider rows \(informational\) \(1\)/);
  assert.doesNotMatch(html, /<div class="font-medium">Issues<\/div>/);
  assert.match(html, /Ignored non-league provider row\./);
});
