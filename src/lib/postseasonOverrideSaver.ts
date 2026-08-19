import type { AppGame } from './schedule';

export type PostseasonOverridesMap = Record<string, Partial<AppGame>>;

/**
 * Effects a single save performs. Injected rather than imported so the ordering
 * and failure semantics below can be exercised without a DOM: the component
 * supplies the real fetch, `localStorage`, and React setters.
 */
export type PostseasonOverrideSaveEffects = {
  /** The durable write. Must reject on a non-2xx — the confirm-first rule rests on it. */
  save: (map: PostseasonOverridesMap) => Promise<unknown>;
  /** Durable write rejected. NOTHING was committed; tell the author so. */
  onSaveFailed: (error: unknown) => void;
  /** Durable write committed. Local state may now follow it. */
  onCommitted: (map: PostseasonOverridesMap) => void;
  /** Best-effort local cache of the committed map. */
  writeCache: (map: PostseasonOverridesMap) => void;
  /** The cache write threw. The durable write still holds. */
  onCacheFailed: (error: unknown) => void;
  /** Committed and cached — rebuild the surfaces that read the map. */
  onApplied: (map: PostseasonOverridesMap) => void;
};

export type PostseasonOverrideSaveRequest = {
  eventId: string;
  patch: Partial<AppGame>;
  /**
   * The map to build on when this saver has not yet confirmed a write of its
   * own — i.e. render state, freshly loaded by the schedule bootstrap.
   */
  fallbackBase: PostseasonOverridesMap;
  effects: PostseasonOverrideSaveEffects;
};

export type PostseasonOverrideSaver = {
  /** Enqueue a save. Resolves when this save has settled, never rejects. */
  enqueue: (request: PostseasonOverrideSaveRequest) => Promise<void>;
  /** Forget the confirmed map — call when the season or league changes. */
  reset: () => void;
  /** The last map this saver confirmed durably, or `null`. Read by tests. */
  confirmed: () => PostseasonOverridesMap | null;
};

export function composePostseasonOverride(
  base: PostseasonOverridesMap,
  eventId: string,
  patch: Partial<AppGame>
): PostseasonOverridesMap {
  return { ...base, [eventId]: { ...(base[eventId] ?? {}), ...patch } };
}

/**
 * Serializes postseason override saves and records what actually persisted.
 *
 * Two facts drive the design:
 *
 * 1. The overrides route STORES THE PAYLOAD WHOLESALE — it does not merge. So a
 *    payload built from a map that is missing another edit DELETES that edit,
 *    durably, while both requests report success. Building each payload at SEND
 *    time from the last confirmed map is what makes concurrent edits compose.
 * 2. Only a CONFIRMED write updates that map. After a failure the next payload
 *    is built on what actually persisted, never on an edit that never landed —
 *    which is the same confirm-first guarantee the caller depends on.
 */
export function createPostseasonOverrideSaver(): PostseasonOverrideSaver {
  let confirmed: PostseasonOverridesMap | null = null;
  let chain: Promise<void> = Promise.resolve();

  const run = async (request: PostseasonOverrideSaveRequest): Promise<void> => {
    const { eventId, patch, fallbackBase, effects } = request;
    // Read the base HERE, not when the click happened. Queued behind an earlier
    // save, this runs after that save has recorded what it durably wrote.
    const next = composePostseasonOverride(confirmed ?? fallbackBase, eventId, patch);

    try {
      await effects.save(next);
    } catch (error) {
      effects.onSaveFailed(error);
      return;
    }

    confirmed = next;
    effects.onCommitted(next);

    try {
      effects.writeCache(next);
    } catch (error) {
      // The durable write has already committed. The cache is only a copy of it,
      // so its failure must not reach `onSaveFailed` — that would claim nothing
      // changed while the server holds the edit, and would skip `onApplied`.
      effects.onCacheFailed(error);
    }

    effects.onApplied(next);
  };

  return {
    enqueue(request) {
      // `.then(run, run)` — a predecessor that rejected must not strand every
      // later edit behind a permanently rejected chain.
      const started = chain.then(
        () => run(request),
        () => run(request)
      );
      // The chain itself must stay resolved for the same reason.
      chain = started.catch(() => {});
      return chain;
    },
    reset() {
      confirmed = null;
    },
    confirmed() {
      return confirmed;
    },
  };
}
