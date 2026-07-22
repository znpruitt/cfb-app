import { setAppState } from '../../server/appStateStore.ts';
import {
  WRITER_CONTROL_KEY,
  WRITER_CONTROL_RECORD_VERSION,
  WRITER_CONTROL_SCOPE,
  initialLegacyWriterControl,
  type WriterControlState,
} from '../writerFence.ts';

/**
 * Seed the durable writer-control row in an exact valid state. `legacy` is the
 * state the one-shot initializer establishes before the fenced legacy writer is
 * deployed; every other state is only ever reachable through the strict
 * transition authority (PLATFORM-086H3D), which tests bypass here to establish
 * a precondition directly.
 */
export async function seedWriterControlState(state: WriterControlState): Promise<void> {
  await setAppState(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY, {
    recordVersion: WRITER_CONTROL_RECORD_VERSION,
    state,
  });
}

/**
 * Seed a valid `legacy` record — the production state until the staged rollout
 * (E). Any test that exercises the real LIVE game-stats write path
 * (`setCachedGameStats`, the manual route, or the cron) must seed this so the
 * fence permits the write, exactly as production does after initialization
 * (PLATFORM-086H3B-REPLACEMENT-LEGACY-WRITER-FENCE).
 */
export async function seedLegacyWriterControl(): Promise<void> {
  await setAppState(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY, initialLegacyWriterControl());
}

/**
 * Seed a valid `active` record — the ONLY state under which the dormant H2
 * durable merge service (`mergeGameStatsPartitionDurable`) may persist a
 * partition (PLATFORM-086H3D). Tests that intentionally exercise H2/C2 merging
 * seed this to represent the post-activation world.
 */
export async function seedActiveWriterControl(): Promise<void> {
  await seedWriterControlState('active');
}
