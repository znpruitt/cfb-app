import assert from 'node:assert/strict';
import test from 'node:test';

import { getProviderDatasetDescriptor } from '../providerDatasets.ts';

test('the Scores policy separates controlled provider polling from ungated browser reads', () => {
  const descriptor = getProviderDatasetDescriptor('scores');

  assert.equal(descriptor.hasActiveAutomation, true);
  assert.equal(descriptor.autoRefreshSettingConsumed, true);
  assert.match(descriptor.currentAutomation, /Every 3 minutes \(QStash/);
  assert.match(
    descriptor.currentAutomation,
    /honoring the global pause and the Scores auto-refresh toggle/
  );
  assert.match(
    descriptor.currentAutomation,
    /full eligible partition set cache-only every 90 seconds/i
  );
  assert.match(descriptor.currentAutomation, /hard 8-hour ceiling/i);
  assert.match(
    descriptor.currentAutomation,
    /Browser reads are not controlled by provider automation settings/
  );

  assert.match(descriptor.plannedPolicy, /QStash provider polling uses a fixed 3-minute/);
  assert.match(
    descriptor.plannedPolicy,
    /positive final score evidence can end the fast tier early/i
  );
  assert.match(descriptor.plannedPolicy, /8 hours after kickoff is its hard ceiling/i);
  assert.match(
    descriptor.plannedPolicy,
    /Browser reads are not controlled by provider automation settings/
  );
  assert.doesNotMatch(descriptor.plannedPolicy, /toggle pauses\/resumes the polling/i);
});
