/*
 * Test setup. jsdom has no `matchMedia`, which the breakpoints file (layout/breakpoints.ts) reads on
 * import. This one answers `min-width` queries from `window.innerWidth` (1024 in jsdom, so
 * "tablet"); a test can set `innerWidth` before importing a component to try another viewport.
 * Every other query, such as `(hover: none)`, doesn't match. `scrollTo` (Kobalte's scroll lock)
 * is a no-op.
 */

window.scrollTo = () => {};

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
