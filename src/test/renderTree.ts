/**
 * Invoke function components so an element tree can be inspected as RENDERED
 * output rather than as a list of component references.
 *
 * The element walkers in these suites descend `props.children`, which stops dead
 * at a function-component element: `<Wordmark />` has no children, so the brand
 * text it renders is invisible to any assertion about the page. Extracting shared
 * components therefore breaks surface-level tests that were previously reading
 * inline markup — not because the surface changed, but because the assertion can
 * no longer see it.
 *
 * Server components are plain functions, so calling them is all "rendering" means
 * here. CLIENT components are not: one that calls a hook throws when invoked
 * outside React's dispatcher. Those are left as unrendered elements, which is
 * exactly the shape assertions about their PRESENCE already expect — a test that
 * checks the page contains a `SignOutControl` keeps working, and one that reads
 * text from it never could.
 *
 * THE CATCH IS NARROW, AND THAT MATTERS. An earlier version swallowed EVERY
 * error and claimed in this comment that it "never reports success for a
 * component it failed to render". That was false, and it made the suite's
 * negative assertions vacuous: a component that threw a genuine error was
 * returned unrendered, so `no <img> on the landing`, `no inline SVG under the
 * wordmark`, and `no marketing descriptor` all passed green while production
 * would have rendered the banned element. Async components were worse — the
 * returned Promise fell through as a plain object and its entire subtree
 * vanished, silently.
 *
 * Now only the hook-dispatcher failure is tolerated; anything else rethrows, and
 * an async component is a hard error rather than a hole in the tree.
 */

/**
 * React's dispatcher is null outside a render, so a hook call fails on property
 * access. Matched narrowly and by shape rather than by exact string, since the
 * wording differs across React versions.
 */
function isHookOutsideRender(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /Invalid hook call/i.test(message) ||
    /Cannot read propert(y|ies) of null/i.test(message) ||
    /dispatcher is null/i.test(message)
  );
}

export function renderDeep(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(renderDeep);
  if (!node || typeof node !== 'object') return node;

  const el = node as { type?: unknown; props?: Record<string, unknown> };

  if (typeof el.type === 'function') {
    const name = (el.type as { name?: string }).name || 'anonymous';
    let rendered: unknown;
    try {
      rendered = (el.type as (props: unknown) => unknown)(el.props ?? {});
    } catch (err) {
      // A client component reached for a hook. Left intact so PRESENCE assertions
      // still hold; anything else is a real failure and must surface.
      if (isHookOutsideRender(err)) return el;
      throw err;
    }

    if (rendered && typeof (rendered as { then?: unknown }).then === 'function') {
      throw new Error(
        `renderDeep cannot render the async component <${name}>: its output is a Promise, ` +
          `and returning it would silently drop the whole subtree from every assertion. ` +
          `Await the component and pass its result in instead.`
      );
    }
    return renderDeep(rendered);
  }

  if (el.props && 'children' in el.props) {
    return { ...el, props: { ...el.props, children: renderDeep(el.props.children) } };
  }
  return el;
}
