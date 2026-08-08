import { JSDOM } from 'jsdom';

/**
 * PLATFORM-086F2J — install the JSDOM globals BEFORE `react-dom` is evaluated.
 *
 * Every `.tsx` suite here builds its own JSDOM in the module BODY, after the
 * import list. That is too late. ES module imports are evaluated before the
 * importing module's body runs, so by the time `globalThis.document` is assigned,
 * `react-dom` has already been evaluated with no DOM present — and it captures
 * that once, at load:
 *
 *     var canUseDOM = !!(typeof window !== 'undefined' && ...);
 *     isInputEventSupported = isEventSupported('input') && ...;   // false
 *
 * With `isInputEventSupported` false, React's ChangeEventPlugin falls back to the
 * legacy IE path and calls `activeElement.attachEvent('onpropertychange')` when
 * focus moves between inputs. JSDOM has no `attachEvent`, so the handler throws
 * and the change events for the newly focused field are never delivered.
 *
 * The visible symptom is badly misleading: the field typed SECOND silently keeps
 * its DOM value while React state never updates, so a multi-field form appears to
 * lose whichever field you filled last, and it happens under `fireEvent` exactly
 * as it does under `userEvent`. It is easy to misread as a quirk of one component.
 * It is not — it is import order, and it affects any multi-field form.
 *
 * Import this module FIRST, before `@testing-library/react`, so the globals exist
 * when `react-dom` is evaluated:
 *
 *     import './path/to/domEnvironment.ts';
 *     import { render } from '@testing-library/react';
 *
 * The other `.tsx` suites still inline their own setup. They pass because each
 * drives a single field, so no focus transition occurs; migrating them is
 * mechanical and is recorded as follow-up rather than folded in here.
 */
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://example.test/',
});

(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { self: Window }).self = dom.window as unknown as Window;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

export { dom };
