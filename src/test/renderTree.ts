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
 * The catch is deliberately narrow in effect: it changes nothing that previously
 * worked, and it never reports success for a component it failed to render.
 */
export function renderDeep(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(renderDeep);
  if (!node || typeof node !== 'object') return node;

  const el = node as { type?: unknown; props?: Record<string, unknown> };

  if (typeof el.type === 'function') {
    try {
      const component = el.type as (props: unknown) => unknown;
      return renderDeep(component(el.props ?? {}));
    } catch {
      // A hook-bearing client component. Left intact so presence assertions hold.
      return el;
    }
  }

  if (el.props && 'children' in el.props) {
    return { ...el, props: { ...el.props, children: renderDeep(el.props.children) } };
  }
  return el;
}
