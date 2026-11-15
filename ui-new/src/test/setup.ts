/*
 * Test setup. jsdom has no `matchMedia`, which the breakpoints file (layout/breakpoints.ts) reads on
 * import. This one answers `min-width` queries from `window.innerWidth` (1024 in jsdom, so
 * "tablet"); a test can set `innerWidth` before importing a component to try another viewport.
 * Every other query, such as `(hover: none)`, doesn't match. `scrollTo` (Kobalte's scroll lock)
 * is a no-op.
 */

import { afterAll } from "vitest";

window.scrollTo = () => {};

/*
 * Timeouts still pending when a test file ends would fire after Vitest has torn down its jsdom,
 * where `window` is gone, and fail the run with "ReferenceError: window is not defined" even though
 * every test passed. Kobalte's Tooltip (ui/Tooltip.tsx, ui/InfoTip.tsx) leaves one whenever a tip
 * closes: its 300 ms `skipDelayDuration` timer, whose callback calls `window.clearTimeout`. So each
 * timeout set through `window.setTimeout` is tracked, and the ones left over are cleared once the
 * file's tests and hooks are done (this hook is registered first, so it runs after theirs). Fake
 * timers (`vi.useFakeTimers`) replace this wrapper while they're on and put it back after.
 */
const realSetTimeout = window.setTimeout.bind(window);
const realClearTimeout = window.clearTimeout.bind(window);
const pendingTimeouts = new Set<number>();

window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  if (typeof handler !== "function") return realSetTimeout(handler, timeout, ...args);
  const id = realSetTimeout(
    (...callArgs: unknown[]) => {
      pendingTimeouts.delete(id);
      (handler as (...a: unknown[]) => void)(...callArgs);
    },
    timeout,
    ...args,
  );
  pendingTimeouts.add(id);
  return id;
}) as typeof window.setTimeout;

window.clearTimeout = ((id?: number) => {
  if (id !== undefined) pendingTimeouts.delete(id);
  realClearTimeout(id);
}) as typeof window.clearTimeout;

afterAll(() => {
  for (const id of pendingTimeouts) realClearTimeout(id);
  pendingTimeouts.clear();
});

window.matchMedia = (query: string): MediaQueryList => {
  const minWidth = /\(min-width:\s*(\d+)px\)/.exec(query);
  return {
    matches: minWidth ? window.innerWidth >= Number(minWidth[1]) : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
};
