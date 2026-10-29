/*
 * Registers `/sw.js` and keeps the installed worker fresh on a long-lived tab, ported from
 * ui/src/lib/service-worker-updates.ts (D11).
 *
 * Browsers only re-fetch a service worker's script on navigation or on a ~24h timer, and Paperclip is
 * a tab people park for weeks. So:
 *
 * - `registration.update()` runs when the tab becomes visible and every hour, so a parked tab learns
 *   about a new worker without navigating.
 * - When a new worker takes control (`controllerchange`; the worker calls `skipWaiting` and
 *   `clients.claim`), the page reloads once onto the new build, but only while the tab is hidden:
 *   an update landing mid-session waits for the next time you leave the tab. A first install skips
 *   the reload, since the page is already running the code the server just sent.
 *
 * The production build stamps a build id into `sw.js` (vite.config.ts), so every deploy changes the
 * file and installs a new worker. That's also what replaces the old UI's worker in browsers that
 * had it: same scope, same address, new bytes.
 */

const DEFAULT_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function startServiceWorkerUpdates(
  options: {
    container?: ServiceWorkerContainer;
    documentRef?: Document;
    reload?: () => void;
    updateIntervalMs?: number;
  } = {},
): () => void {
  const container = options.container ?? (typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : undefined);
  if (!container) return () => {};
  const documentRef = options.documentRef ?? document;
  const reload = options.reload ?? (() => window.location.reload());
  const updateIntervalMs = options.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;

  // Only a page a worker already controlled can be running stale code when the controller changes.
  let wasControlled = Boolean(container.controller);
  let reloaded = false;
  let reloadPending = false;
  const applyUpdate = () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  };
  const onControllerChange = () => {
    if (!wasControlled) {
      wasControlled = true;
      return;
    }
    if (documentRef.visibilityState === "hidden") applyUpdate();
    else reloadPending = true;
  };
  container.addEventListener("controllerchange", onControllerChange);

  let registration: ServiceWorkerRegistration | undefined;
  // update() rejects while offline or mid-deploy; the next visibility change or tick retries.
  const checkForUpdates = () => void registration?.update().catch(() => {});
  const onVisibilityChange = () => {
    if (documentRef.visibilityState === "visible") checkForUpdates();
    else if (reloadPending) applyUpdate();
  };
  documentRef.addEventListener("visibilitychange", onVisibilityChange);
  const intervalId = setInterval(checkForUpdates, updateIntervalMs);

  void container
    .register("/sw.js")
    .then((reg) => {
      registration = reg;
    })
    .catch(() => {
      // Private windows and hardened browsers can refuse; the app works without the offline page.
    });

  return () => {
    container.removeEventListener("controllerchange", onControllerChange);
    documentRef.removeEventListener("visibilitychange", onVisibilityChange);
    clearInterval(intervalId);
  };
}

/**
 * In development Vite serves the app and reloads it itself, so no worker may sit in between: drop
 * any registration (such as one a production preview on the same port left behind).
 */
export function removeServiceWorkers(container: ServiceWorkerContainer | undefined = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined) {
  if (!container?.getRegistrations) return;
  void container
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => {});
}
