import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPostseasonOverrideSaver,
  type PostseasonOverrideSaveEffects,
  type PostseasonOverridesMap,
} from '../postseasonOverrideSaver';

// ---------------------------------------------------------------------------
// POLISH-005 review remediation. Two defects, both reported by both reviewers:
//
//   1. Overlapping saves erased each other. Each payload was built from the
//      render-closure map, and the overrides route STORES THE PAYLOAD WHOLESALE,
//      so the second write deleted the first — durably, with both PUTs
//      returning 200 and nothing surfaced to the author.
//   2. A `localStorage` throw AFTER a committed durable write rejected the
//      shared promise chain, so the author was told "nothing was changed" while
//      the server held the edit, and the schedule rebuild was skipped.
//
// Both live in a client callback that `renderWithAppContext` cannot reach —
// it renders with `renderToStaticMarkup`, which never fires event handlers. The
// orchestration is extracted so the ordering and failure semantics are tested
// directly rather than through a proxy that cannot observe them.
// ---------------------------------------------------------------------------

type Recorded = {
  saved: PostseasonOverridesMap[];
  committed: PostseasonOverridesMap[];
  cached: PostseasonOverridesMap[];
  applied: PostseasonOverridesMap[];
  saveFailures: unknown[];
  cacheFailures: unknown[];
};

function recorder(): Recorded {
  return {
    saved: [],
    committed: [],
    cached: [],
    applied: [],
    saveFailures: [],
    cacheFailures: [],
  };
}

function effects(
  log: Recorded,
  overrides: Partial<PostseasonOverrideSaveEffects> = {}
): PostseasonOverrideSaveEffects {
  return {
    save: async (map) => {
      log.saved.push(map);
    },
    onSaveFailed: (error) => log.saveFailures.push(error),
    onCommitted: (map) => log.committed.push(map),
    writeCache: (map) => {
      log.cached.push(map);
    },
    onCacheFailed: (error) => log.cacheFailures.push(error),
    onApplied: (map) => log.applied.push(map),
    ...overrides,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

const label = (name: string) => ({ csvHome: name }) as const;

/** Drain the microtask queue so everything not blocked on a deferred has run. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test('a second edit made while the first is in flight COMPOSES with it', async () => {
  const log = recorder();
  const saver = createPostseasonOverrideSaver();
  const firstSave = deferred();

  // Both callers pass the SAME stale base — exactly what a render closure hands
  // over when the first save has not resolved and state has not advanced. This
  // is the whole scenario: if the payload were built from `fallbackBase` both
  // times, the second write would carry only `bowl-b`.
  const stale: PostseasonOverridesMap = {};

  const a = saver.enqueue({
    eventId: 'bowl-a',
    patch: label('Alamo'),
    fallbackBase: stale,
    effects: effects(log, {
      save: async (map) => {
        log.saved.push(map);
        await firstSave.promise;
      },
    }),
  });

  const b = saver.enqueue({
    eventId: 'bowl-b',
    patch: label('Belk'),
    fallbackBase: stale,
    effects: effects(log),
  });

  // Positive control. After the queue has drained everything that is not
  // blocked, exactly ONE save is in flight: the second is still waiting. Without
  // serialization both would be sent here, and the assertion below would pass
  // for the wrong reason — two payloads existing says nothing about ordering.
  await flush();
  assert.equal(log.saved.length, 1, 'the second save must wait for the first');

  firstSave.resolve();
  await Promise.all([a, b]);

  assert.equal(log.saved.length, 2);
  const second = log.saved[1]!;
  assert.deepEqual(
    second,
    { 'bowl-a': { csvHome: 'Alamo' }, 'bowl-b': { csvHome: 'Belk' } },
    'the second payload must carry the first edit; the route stores it wholesale'
  );
});

test('a FAILED save does not seed the next payload', async () => {
  const log = recorder();
  const saver = createPostseasonOverrideSaver();
  const firstSave = deferred();

  const a = saver.enqueue({
    eventId: 'bowl-a',
    patch: label('Alamo'),
    fallbackBase: {},
    effects: effects(log, {
      save: async (map) => {
        log.saved.push(map);
        await firstSave.promise;
      },
    }),
  });

  const b = saver.enqueue({
    eventId: 'bowl-b',
    patch: label('Belk'),
    fallbackBase: {},
    effects: effects(log),
  });

  firstSave.reject(new Error('PUT 500'));
  await Promise.all([a, b]);

  assert.equal(log.saveFailures.length, 1, 'the failure must be reported');
  assert.deepEqual(
    log.saved[1],
    { 'bowl-b': { csvHome: 'Belk' } },
    'an edit that never persisted must not appear in a later payload'
  );
  assert.equal(saver.confirmed()?.['bowl-a'], undefined);
});

test('a cache write that throws does NOT report the durable save as failed', async () => {
  const log = recorder();
  const saver = createPostseasonOverrideSaver();
  const quota = new Error('QuotaExceededError');

  await saver.enqueue({
    eventId: 'bowl-a',
    patch: label('Alamo'),
    fallbackBase: {},
    effects: effects(log, {
      writeCache: () => {
        throw quota;
      },
    }),
  });

  assert.deepEqual(
    log.saveFailures,
    [],
    'the durable write committed — claiming otherwise is a lie'
  );
  assert.deepEqual(log.cacheFailures, [quota]);
  assert.equal(log.committed.length, 1, 'local state must still follow the committed write');
  assert.equal(log.applied.length, 1, 'the schedule rebuild must still run');
  assert.deepEqual(saver.confirmed(), { 'bowl-a': { csvHome: 'Alamo' } });
});

test('a failed durable write commits, caches and applies NOTHING', async () => {
  const log = recorder();
  const saver = createPostseasonOverrideSaver();

  await saver.enqueue({
    eventId: 'bowl-a',
    patch: label('Alamo'),
    fallbackBase: {},
    effects: effects(log, {
      save: async () => {
        throw new Error('PUT 403');
      },
    }),
  });

  assert.equal(log.saveFailures.length, 1);
  assert.deepEqual(
    log.committed,
    [],
    'confirm-first: nothing local moves before the server agrees'
  );
  assert.deepEqual(log.cached, []);
  assert.deepEqual(log.applied, []);
  assert.equal(saver.confirmed(), null);
});

test('an effect that throws does not strand later saves behind a rejected chain', async () => {
  const log = recorder();
  const saver = createPostseasonOverrideSaver();

  const a = saver.enqueue({
    eventId: 'bowl-a',
    patch: label('Alamo'),
    fallbackBase: {},
    effects: effects(log, {
      onApplied: () => {
        throw new Error('router.refresh blew up');
      },
    }),
  });

  const b = saver.enqueue({
    eventId: 'bowl-b',
    patch: label('Belk'),
    fallbackBase: {},
    effects: effects(log),
  });

  await Promise.all([a, b]);
  assert.equal(log.saved.length, 2, 'the second edit must still reach the server');
});

test('reset() drops the confirmed map so the next payload rebases on render state', async () => {
  const log = recorder();
  const saver = createPostseasonOverrideSaver();

  await saver.enqueue({
    eventId: 'bowl-a',
    patch: label('Alamo'),
    fallbackBase: {},
    effects: effects(log),
  });
  assert.deepEqual(saver.confirmed(), { 'bowl-a': { csvHome: 'Alamo' } });

  // The season changed: the bootstrap has reloaded that season's overrides into
  // state, and 2025's labels must not ride along into a 2026 payload.
  saver.reset();
  assert.equal(saver.confirmed(), null);

  await saver.enqueue({
    eventId: 'bowl-c',
    patch: label('Citrus'),
    fallbackBase: { 'bowl-z': { csvHome: 'Zaxbys' } },
    effects: effects(log),
  });

  assert.deepEqual(log.saved[1], {
    'bowl-z': { csvHome: 'Zaxbys' },
    'bowl-c': { csvHome: 'Citrus' },
  });
});
