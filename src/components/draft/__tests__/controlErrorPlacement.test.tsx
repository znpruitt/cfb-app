import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DraftHeaderArea from '../DraftHeaderArea';
import { type DraftState } from '@/lib/draft';

// ---------------------------------------------------------------------------
// PLATFORM-102 — the refusal must render WHERE THE BUTTON IS.
//
// The first version of this fix surfaced control refusals into the existing
// `pickError` line, which renders in the Available Teams strip at the bottom of
// a `calc(100dvh - 10rem)` layout — while Undo, Auto-pick, Start round and
// Pause/Resume all live in DraftHeaderArea at the top. Press Undo, get a 409,
// and the explanation appeared a full viewport below the button: at the point of
// interaction the button still read as dead, which is the exact symptom the fix
// existed to remove.
//
// I had asserted in a commit message that it rendered in "one place on this
// screen where things that went wrong appear" — a claim about layout I never
// checked. This test checks it by RENDERING, so the claim cannot drift from the
// markup again.
// ---------------------------------------------------------------------------

const OWNERS = ['Alice', 'Bob'];

function liveDraft(overrides: Partial<DraftState> = {}): DraftState {
  const now = '2026-08-01T00:00:00.000Z';
  return {
    leagueSlug: 'tsc',
    year: 2026,
    phase: 'live',
    owners: [...OWNERS],
    settings: {
      style: 'snake',
      draftOrder: [...OWNERS],
      pickTimerSeconds: 60,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 2,
      scheduledAt: null,
    },
    picks: [
      {
        pickNumber: 1,
        round: 0,
        roundPick: 0,
        owner: 'Alice',
        team: 'Georgia',
        pickedAt: now,
        autoSelected: false,
      },
    ],
    currentPickIndex: 1,
    timerState: 'running',
    timerExpiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const REFUSAL = 'The board has moved on — pick 2 is no longer the last pick.';

function render(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    React.createElement(DraftHeaderArea, {
      draft: liveDraft(),
      isAdmin: true,
      ...props,
    } as never)
  );
}

test('the refusal renders inside the same component as the controls', () => {
  const markup = render({
    controlError: REFUSAL,
    onUndo: () => {},
    onPause: () => {},
  });

  assert.ok(markup.includes(REFUSAL), 'the message must render in the header area, beside Undo');
  assert.ok(markup.includes('Undo'), 'and the Undo button must be in that same markup');
});

test('the refusal renders BEFORE the control buttons, not after them', () => {
  // Proximity is the whole point: above the row reads as "about these controls".
  const markup = render({
    controlError: REFUSAL,
    onUndo: () => {},
    onPause: () => {},
  });

  const messageAt = markup.indexOf(REFUSAL);
  const undoAt = markup.indexOf('>Undo<');
  assert.ok(messageAt > 0 && undoAt > 0, 'both must be present');
  assert.ok(messageAt < undoAt, 'the message must precede the button it explains');
});

test('no refusal, no message', () => {
  const markup = render({ controlError: null, onUndo: () => {}, onPause: () => {} });
  assert.ok(!markup.includes(REFUSAL));
  assert.ok(markup.includes('Undo'), 'the controls still render');
});

test('a non-admin never sees a control refusal', () => {
  const markup = renderToStaticMarkup(
    React.createElement(DraftHeaderArea, {
      draft: liveDraft(),
      isAdmin: false,
      controlError: REFUSAL,
    } as never)
  );
  assert.ok(!markup.includes(REFUSAL), 'controls are admin-only, so their errors are too');
});

test('the refusal is announced to assistive tech', () => {
  const markup = render({ controlError: REFUSAL, onUndo: () => {} });
  assert.match(
    markup,
    /role="alert"[^>]*>[^<]*The board has moved on|The board has moved on/,
    'the message carries an alert role so it is not silent to a screen reader'
  );
});
