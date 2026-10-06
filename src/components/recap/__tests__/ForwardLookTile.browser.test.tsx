import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { withBrowserFixture } from '../../../test/browserFixture';
import { composeForwardLook } from '../../../lib/recap/composeForwardLook';
import {
  addRivalry,
  forwardContext,
  FORWARD_NOW,
  FORWARD_SCOPE,
} from '../../../test/forwardLookFixtures';

async function markup(): Promise<string> {
  const context = forwardContext();
  addRivalry(context, ['Bob', 'Alice', 'Alice']);
  const look = composeForwardLook({ status: 'available', context }, FORWARD_NOW, FORWARD_SCOPE)!;
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import ForwardLookTile from './src/components/recap/ForwardLookTile';
        createRoot(document.getElementById('root')).render(React.createElement(ForwardLookTile, {look: ${JSON.stringify(look)}}));`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const from = fileURLToPath(new URL('../../../app/globals.css', import.meta.url));
  const source =
    (await readFile(from, 'utf8')).replace(
      "@import 'tailwindcss';",
      "@import 'tailwindcss' source(none);"
    ) +
    "\n@source '../components/recap/ForwardLookTile.tsx';\n@source '../components/recap/RecapPrimitives.tsx';";
  const css = (await postcss([tailwindcss()]).process(source, { from })).css;
  return `<!doctype html><html class="dark"><head><meta charset="utf-8"><style>${css}</style></head>
    <body style="background:#09090b;padding:16px"><div id="root"></div><section id="podium">Season podium</section>
    <script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
}

test('Forward Look browser disclosure pushes the podium down without horizontal overflow', async (t) => {
  await withBrowserFixture(t, { directoryPrefix: 'cfb-forward-look-', markup }, async (page) => {
    await page.evaluate(
      `new Promise(resolve => { const wait = () => document.querySelector('button') ? resolve(true) : requestAnimationFrame(wait); wait(); })`
    );
    for (const width of [320, 390, 820, 1280]) {
      await page.setViewport(width, 1000);
      const result = await page.evaluate<{
        before: number;
        after: number;
        overflow: number;
        expanded: string;
        items: number;
      }>(`(async () => {
        const button = document.querySelector('button');
        if (button.getAttribute('aria-expanded') === 'true') { button.click(); await new Promise(requestAnimationFrame); }
        const before = document.getElementById('podium').getBoundingClientRect().top;
        button.click(); await new Promise(requestAnimationFrame);
        return {before, after: document.getElementById('podium').getBoundingClientRect().top,
          overflow: document.documentElement.scrollWidth - innerWidth,
          expanded: button.getAttribute('aria-expanded'), items: document.querySelectorAll('li').length};
      })()`);
      assert.equal(result.expanded, 'true', `${width}px click expands`);
      assert.equal(result.items, 3, 'all three narrative families are visible');
      assert.ok(result.after > result.before + 40, `${width}px expansion pushes the podium down`);
      assert.ok(result.overflow <= 1, `${width}px no horizontal overflow`);
    }
  });
});
