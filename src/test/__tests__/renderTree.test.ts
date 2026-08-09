import assert from 'node:assert/strict';
import test from 'node:test';

import { renderDeep } from '../renderTree.ts';
import SignOutControl from '../../components/home/SignOutControl.tsx';

// ---------------------------------------------------------------------------
// The helper's own contract, because the landing suites' NEGATIVE assertions
// depend on it. An earlier version swallowed every error and returned the
// element unrendered, which made `no <img>`, `no inline SVG under the wordmark`,
// and `no marketing descriptor` pass green for a component that had failed or
// gone async. AGENTS.md requires a proven observer behind a negative assertion;
// this file is that proof.
// ---------------------------------------------------------------------------

function hostTypes(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) hostTypes(n, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (typeof el.type === 'string') out.push(el.type);
  hostTypes(el.props?.children, out);
  return out;
}

const wrap = (Component: unknown) => ({
  type: 'div',
  props: { children: [{ type: Component, props: {} }] },
});

test('a server component is rendered, so its output is visible to assertions', () => {
  const Banned = () => ({ type: 'img', props: { src: '/x.png' } });
  assert.ok(hostTypes(renderDeep(wrap(Banned))).includes('img'));
});

// REGRESSION TEST — a genuine failure must NOT be disguised as an empty subtree.
test('a throwing component rethrows rather than vanishing', () => {
  const Boom = () => {
    throw new Error('server component blew up');
  };
  assert.throws(() => renderDeep(wrap(Boom)), /server component blew up/);
});

// REGRESSION TEST — an async component silently dropped its entire subtree.
test('an async component is a hard error, not a hole in the tree', () => {
  const Later = async () => ({ type: 'img', props: {} });
  assert.throws(() => renderDeep(wrap(Later)), /async component/i);
});

// The one tolerated failure: a client component reaching for a hook outside
// React's dispatcher. Left intact so PRESENCE assertions keep working.
test('a hook-bearing client component is left intact', () => {
  const view = renderDeep(wrap(SignOutControl)) as {
    props: { children: Array<{ type: unknown }> };
  };
  assert.equal(view.props.children[0]!.type, SignOutControl, 'still findable by type');
});
