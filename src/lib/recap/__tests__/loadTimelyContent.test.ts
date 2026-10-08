import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import type { loadTimelyContent, loadWeeklyRecap } from '../loadWeeklyRecap.ts';
import { FORWARD_NOW, FORWARD_SCOPE } from '../../../test/forwardLookFixtures.ts';

test('timely loader isolates composer failures and the recap page never composes a preview', async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../loadWeeklyRecap.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'composer-faults',
        setup(builder) {
          const exports: Record<string, string> = {
            loadRecapContext: 'loadRecapContextForSeasonScope',
            composeWeeklyRecap: 'composeWeeklyRecap',
            composeForwardLook: 'composeForwardLook',
          };
          builder.onLoad(
            { filter: /\/(loadRecapContext|composeWeeklyRecap|composeForwardLook)\.ts$/ },
            ({ path }) => {
              const name = Object.keys(exports).find((key) => path.endsWith(`/${key}.ts`))!;
              return {
                contents: `export function ${exports[name]}() {
          globalThis.calls.push('${name}');
          if (globalThis.fault === '${name}') throw new Error('injected ${name} failure');
          return ${name === 'loadRecapContext' ? '{}' : name === 'composeWeeklyRecap' ? "{status:'available'}" : "{weekLabel:'Week 6'}"};
        }`,
              };
            }
          );
        },
      },
    ],
  });
  const bundledModule = {
    exports: {} as {
      loadTimelyContent: typeof loadTimelyContent;
      loadWeeklyRecap: typeof loadWeeklyRecap;
    },
  };
  const sandbox = {
    module: bundledModule,
    exports: bundledModule.exports,
    calls: [] as string[],
    fault: '',
  };
  runInNewContext(bundle.outputFiles[0].text, sandbox);
  const args = { ...FORWARD_SCOPE, now: FORWARD_NOW, leagueSlug: 'test' };
  const healthy = await bundledModule.exports.loadTimelyContent(args);
  assert.equal(healthy.weeklyRecap.status, 'available');
  assert.equal(healthy.forwardLook?.weekLabel, 'Week 6');
  assert.equal(
    sandbox.calls.filter((call) => call === 'loadRecapContext').length,
    1,
    'both occupants share one gather'
  );
  sandbox.fault = 'composeForwardLook';
  const previewFailure = await bundledModule.exports.loadTimelyContent(args);
  assert.equal(
    previewFailure.weeklyRecap.status,
    'available',
    'preview assembly failure preserves recap'
  );
  assert.equal(previewFailure.forwardLook, null);
  sandbox.fault = 'composeWeeklyRecap';
  const recapFailure = await bundledModule.exports.loadTimelyContent(args);
  assert.equal(recapFailure.weeklyRecap.status, 'unavailable');
  assert.equal(
    recapFailure.forwardLook?.weekLabel,
    'Week 6',
    'recap assembly failure preserves preview'
  );
  sandbox.calls.length = 0;
  sandbox.fault = 'composeForwardLook';
  assert.equal((await bundledModule.exports.loadWeeklyRecap(args)).status, 'available');
  assert.equal(
    sandbox.calls.includes('composeForwardLook'),
    false,
    'recap-only page never composes the preview'
  );
});
