import { useLocation, useNavigate } from "@solidjs/router";
import { createEffect } from "solid-js";

/*
 * What plugin React code needs from the Solid host, as a tiny store with no framework in its API:
 * the router's location (for `useHostLocation`), a navigate function (for `useHostNavigation`),
 * and the signed-in user (for the host context). Every plugin outlet keeps it current with
 * `useSyncHost()`, so it's set wherever a plugin can render.
 */

export type HostLocationSnapshot = { pathname: string; search: string; hash: string; state?: unknown };
export type HostNavigate = (to: string, options?: { replace?: boolean; state?: unknown }) => void;

let location: HostLocationSnapshot = typeof window === "undefined"
  ? { pathname: "/", search: "", hash: "" }
  : { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash };
let navigate: HostNavigate = (to) => window.location.assign(to);
const listeners = new Set<() => void>();

export const hostStore = {
  location: () => location,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  navigate: (to: string, options?: { replace?: boolean; state?: unknown }) => navigate(to, options),
};

export function setHostLocation(next: HostLocationSnapshot) {
  if (next.pathname === location.pathname && next.search === location.search && next.hash === location.hash && next.state === location.state) return;
  location = next;
  for (const listener of [...listeners]) listener();
}

export function setHostNavigate(next: HostNavigate) {
  navigate = next;
}

/** Keeps the host store in step with the Solid router. Call inside any plugin outlet. */
export function useSyncHost() {
  const routerLocation = useLocation();
  const routerNavigate = useNavigate();
  setHostNavigate((to, options) => routerNavigate(to, { replace: options?.replace, state: options?.state }));
  createEffect(() =>
    setHostLocation({ pathname: routerLocation.pathname, search: routerLocation.search, hash: routerLocation.hash, state: routerLocation.state }),
  );
}
