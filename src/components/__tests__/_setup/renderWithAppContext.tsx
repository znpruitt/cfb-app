import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ClerkInstanceContext, InitialStateProvider } from '@clerk/shared/react';

/**
 * Test render helper that mounts the contexts the CFBScheduleApp tree needs but which are
 * absent under `renderToStaticMarkup` (no Next.js / Clerk runtime):
 *
 * 1. App Router context — `useRouter()` from `next/navigation` throws
 *    "invariant expected app router to be mounted" without it.
 * 2. Clerk context — `AppHeaderActions` calls `useClerk()` / `useUser()`, which throw
 *    "useClerk can only be used within the <ClerkProvider /> component" without it.
 *
 * The tests assert on rendered markup and never invoke router navigation or Clerk actions
 * (event handlers are not fired during static rendering), so inert stubs are sufficient.
 * The Clerk stub models a "loaded, signed-out" user, which is the default surface state.
 */
const noop = (): void => {};

export const mockAppRouter: AppRouterInstance = {
  back: noop,
  forward: noop,
  refresh: noop,
  push: noop,
  replace: noop,
  prefetch: noop,
};

/**
 * Minimal Clerk instance stub. `useUser()` reads `loaded` and `addListener` off this object
 * (via `useSyncExternalStore`); with `loaded: false` it falls back to the initial state below.
 * The action methods are only referenced inside (unfired) event handlers.
 */
const mockClerkInstance = {
  loaded: false,
  addListener: () => noop,
  openSignIn: noop,
  openUserProfile: noop,
  signOut: noop,
};

// Clerk's createContextAndHook stores the value wrapped as `{ value }` and the consuming
// hooks read `ctx.value` at runtime, but the Provider's exposed prop type does not reflect
// that wrapper. Assert through the actual prop types so the runtime-correct shapes type-check.
type ClerkInstanceProviderValue = React.ComponentProps<
  typeof ClerkInstanceContext.Provider
>['value'];
type InitialState = React.ComponentProps<typeof InitialStateProvider>['initialState'];

export function renderWithAppContext(element: React.ReactElement): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={mockAppRouter}>
      <ClerkInstanceContext.Provider
        value={{ value: mockClerkInstance } as unknown as ClerkInstanceProviderValue}
      >
        <InitialStateProvider initialState={{ user: null } as unknown as InitialState}>
          {element}
        </InitialStateProvider>
      </ClerkInstanceContext.Provider>
    </AppRouterContext.Provider>
  );
}
