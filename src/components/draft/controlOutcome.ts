import type { DraftState } from '@/lib/draft';

/**
 * PLATFORM-102 — what a draft-control response MEANS, decided separately from
 * what the component does about it.
 *
 * The control helpers used to act only on success: no error state, no refresh.
 * That was survivable while refusals were unreachable — the buttons were hidden
 * in the states that would fail. This slice made them reachable (Undo answers
 * 409 when the board has moved on; auto-pick answers 422 when the timer is not
 * paused-expired), and silence then reads as a dead button.
 *
 * Split out because the decision is the part worth testing. Mounting the board
 * and mocking `fetch` to prove "a 409 shows a message" tests React; this proves
 * the mapping, which is where the bug was.
 */
export type ControlOutcome =
  | { kind: 'error'; message: string }
  | { kind: 'redirect-setup' }
  | { kind: 'applied'; draft: DraftState };

export function resolveControlOutcome(
  res: { ok: boolean; status: number },
  data: { draft?: DraftState; error?: string },
  fallback: string
): ControlOutcome {
  // A refusal carries the server's own words when it has them — "The board has
  // moved on — pick 2 is no longer the last pick" is far more useful than a
  // status code, and it tells the operator what to do next.
  if (!res.ok) {
    return { kind: 'error', message: data.error ?? `${fallback} (${res.status})` };
  }

  // 200 with no draft is not success. It is the shape a proxy or an unexpected
  // payload produces, and treating it as success is what made a failed control
  // look like a dead button.
  if (!data.draft) {
    return { kind: 'error', message: fallback };
  }

  // A control that resets the draft sends the operator back to setup; the board
  // has nothing left to render.
  if (data.draft.phase === 'setup') {
    return { kind: 'redirect-setup' };
  }

  return { kind: 'applied', draft: data.draft };
}
