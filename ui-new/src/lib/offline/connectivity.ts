import { onlineManager } from "@tanstack/solid-query";
import { createSignal, type Accessor } from "solid-js";
import { isConnectivityError } from "./errors";

/*
 * One answer to "can we reach Paperclip?", after ui/src/lib/connectivity.ts (#15754).
 *
 * - A request that fails as if the server were gone (a dropped connection, a proxy's 502–504)
 *   starts a check: `GET /api/health`. If that fails too the app is offline, and the check repeats
 *   with backoff (1s, 2s, 5s, 10s, then every 15s) until it passes.
 * - Only the health check or the live-events socket opening says the server is back; one unrelated
 *   request getting through isn't proof, so it only brings the next check forward.
 * - The browser's own offline and online events count too (a phone losing signal).
 *
 * While offline, TanStack Query pauses reads instead of failing them (they keep their data), and
 * refetches the open ones once it's back (`installQueryConnectivity`). Queued writes wait for the
 * same signal (write-runner.ts).
 */

export type Connectivity = "online" | "checking" | "offline";

export const PROBE_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 15_000] as const;
const PROBE_TIMEOUT_MS = 8_000;

export type ConnectivityStore = {
  status: Accessor<Connectivity>;
  /** A request failed; a connectivity failure starts the check. */
  reportFailure: (error: unknown) => void;
  /** A request to the server got an answer. While offline that brings the next check forward. */
  reportSuccess: () => void;
  /** The live-events socket opened: the server is reachable. */
  reportOnline: () => void;
  /** Check now ("Try again"). */
  checkNow: () => void;
  /** Called each time the app goes from offline back to online. */
  onRecovered: (listener: () => void) => () => void;
  /** Called with every status change. */
  subscribe: (listener: (status: Connectivity) => void) => () => void;
  dispose: () => void;
};

/** `GET /api/health` answered with JSON. A proxy's HTML page or a 5xx isn't the server being back. */
export async function probeHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch("/api/health", { credentials: "include", cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) return false;
    JSON.parse(await response.text());
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createConnectivityStore(options: { probe?: () => Promise<boolean>; target?: Window | null } = {}): ConnectivityStore {
  const probe = options.probe ?? probeHealth;
  const target = options.target === undefined ? (typeof window === "undefined" ? null : window) : options.target;
  const [status, setStatus] = createSignal<Connectivity>(target && target.navigator?.onLine === false ? "offline" : "online");
  const recovered = new Set<() => void>();
  const listeners = new Set<(status: Connectivity) => void>();
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let probing = false;
  let disposed = false;

  const set = (next: Connectivity) => {
    const previous = status();
    if (previous === next) return;
    setStatus(next);
    for (const listener of [...listeners]) listener(next);
    if (next === "online" && previous === "offline") for (const listener of [...recovered]) listener();
  };
  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const online = () => {
    stopTimer();
    attempt = 0;
    set("online");
  };
  const check = async () => {
    if (probing || disposed) return;
    probing = true;
    stopTimer();
    const ok = await probe().catch(() => false);
    probing = false;
    if (disposed) return;
    if (ok) return online();
    set("offline");
    const delay = PROBE_BACKOFF_MS[Math.min(attempt, PROBE_BACKOFF_MS.length - 1)]!;
    attempt += 1;
    timer = setTimeout(() => void check(), delay);
  };

  const onOffline = () => {
    set("offline");
    if (timer === undefined && !probing) timer = setTimeout(() => void check(), PROBE_BACKOFF_MS[0]);
  };
  const onOnline = () => void check();
  target?.addEventListener("offline", onOffline);
  target?.addEventListener("online", onOnline);
  if (status() === "offline") onOffline();

  return {
    status,
    reportFailure: (error) => {
      if (!isConnectivityError(error) || status() !== "online") return;
      set("checking");
      void check();
    },
    reportSuccess: () => {
      if (status() === "offline" && !probing) void check();
    },
    reportOnline: online,
    checkNow: () => void check(),
    onRecovered: (listener) => {
      recovered.add(listener);
      return () => recovered.delete(listener);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      disposed = true;
      stopTimer();
      target?.removeEventListener("offline", onOffline);
      target?.removeEventListener("online", onOnline);
    },
  };
}

/** The app's one store. */
export const connectivity = createConnectivityStore();

/** Reads pause while offline and refetch once it's back. */
export function installQueryConnectivity(store: ConnectivityStore = connectivity) {
  onlineManager.setEventListener((setOnline) => {
    setOnline(store.status() !== "offline");
    return store.subscribe((next) => setOnline(next !== "offline"));
  });
}
