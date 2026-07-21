import { setAppState } from '../../server/appStateStore.ts';
import {
  WRITER_CONTROL_KEY,
  WRITER_CONTROL_SCOPE,
  initialLegacyWriterControl,
} from '../writerFence.ts';

/**
 * Seed the durable writer-control row as a valid `legacy` record — the state the
 * one-shot initializer establishes before the fenced legacy writer is deployed. Any
 * test that exercises the real game-stats write path (`setCachedGameStats`, the
 * manual route, or the cron) must seed this so the fence permits the write, exactly
 * as production does after initialization (PLATFORM-086H3B-REPLACEMENT-LEGACY-WRITER-FENCE).
 */
export async function seedLegacyWriterControl(): Promise<void> {
  await setAppState(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY, initialLegacyWriterControl());
}
