/*
 * Loads the React side of plugin hosting (react/runtime.ts) on demand. It's a separate chunk, so a
 * page with no plugin area never downloads React; the first plugin area to mount pays for it once.
 */

type ReactRuntime = typeof import("./react/runtime");

let pending: Promise<ReactRuntime> | null = null;

export function loadReactRuntime(): Promise<ReactRuntime> {
  pending ??= import("./react/runtime").catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}
