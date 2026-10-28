import type { PluginBridgeErrorCode, PluginLauncherRenderContextSnapshot } from "@paperclipai/shared";
import type {
  HostLocation,
  HostNavigation,
  HostNavigationLinkOptions,
  HostNavigationOptions,
  PluginActionFn,
  PluginBridgeError,
  PluginDataResult,
  PluginHostContext,
  PluginRenderEnvironmentContext,
  PluginStreamResult,
  PluginToastFn,
  PluginToastInput,
} from "@paperclipai/plugin-sdk/ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { pluginsApi } from "@/api/plugins";
import { ApiError } from "@/api/client";
import { pushToast } from "@/ui/Toast";
import { hostStore } from "../host";
import { resolveHostNavigationHref, sameOriginPath } from "../model";

/*
 * The SDK's bridge hooks, implemented by the host (ui/src/plugins/bridge.ts). A plugin component
 * calls `usePluginData`, `usePluginAction`, `useHostContext`… from `@paperclipai/plugin-sdk/ui`;
 * the loader points that import at these. Each mount wraps the plugin in a PluginBridgeContext
 * provider naming the plugin and its host context, and the hooks read it from there.
 *
 * - `usePluginData` → `POST /api/plugins/:id/data/:key`, refetched when the key, params, company
 *   or render environment change, retried twice when the worker is starting or slow.
 * - `usePluginAction` → `POST /api/plugins/:id/actions/:key`; failures throw `{ code, message }`.
 * - `usePluginStream` → the worker's SSE channel, `GET /api/plugins/:id/bridge/stream/:channel`.
 * - Navigation, location and toasts go through the Solid host (host.ts, ui/Toast).
 */

export type PluginBridgeContextValue = { pluginId: string; hostContext: PluginHostContext };

export const PluginBridgeContext = createContext<PluginBridgeContextValue | null>(null);

function useBridge(): PluginBridgeContextValue {
  const value = useContext(PluginBridgeContext);
  if (!value) throw new Error("Plugin bridge hook called outside a plugin mount. Render the component through a Paperclip plugin slot.");
  return value;
}

/** The `{ code, message, details }` a bridge endpoint answers with, from any thrown error. */
export function extractBridgeError(error: unknown): PluginBridgeError {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const body = error.body as Record<string, unknown>;
    if (typeof body.code === "string" && typeof body.message === "string") {
      return { code: body.code as PluginBridgeErrorCode, message: body.message, details: body.details };
    }
    if (typeof body.error === "string") return { code: "UNKNOWN", message: body.error };
  }
  return { code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
}

function serializeParams(params?: Record<string, unknown>) {
  if (!params) return "";
  try {
    return JSON.stringify(params, Object.keys(params).sort());
  } catch {
    return "";
  }
}

function snapshot(environment: PluginRenderEnvironmentContext | null | undefined): PluginLauncherRenderContextSnapshot | null {
  return environment ? { environment: environment.environment, launcherId: environment.launcherId, bounds: environment.bounds } : null;
}

const RETRYABLE: PluginBridgeErrorCode[] = ["WORKER_UNAVAILABLE", "TIMEOUT"];

export function usePluginData<T = unknown>(key: string, params?: Record<string, unknown>): PluginDataResult<T> {
  const { pluginId, hostContext } = useBridge();
  const companyId = hostContext.companyId;
  const environment = snapshot(hostContext.renderEnvironment);
  const environmentKey = environment ? JSON.stringify(environment) : "";
  const paramsKey = serializeParams(params);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PluginBridgeError | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    setLoading(true);
    const request = () => {
      pluginsApi
        .bridgeGetData(pluginId, key, params, companyId, environment)
        .then((response) => {
          if (cancelled) return;
          setData(response.data as T);
          setError(null);
          setLoading(false);
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          const bridgeError = extractBridgeError(caught);
          if (RETRYABLE.includes(bridgeError.code) && attempt < 2) {
            attempt += 1;
            timer = setTimeout(() => !cancelled && request(), 150 * attempt);
            return;
          }
          setError(bridgeError);
          setData(null);
          setLoading(false);
        });
    };
    request();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // params is tracked through paramsKey, the environment through environmentKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, key, paramsKey, tick, companyId, environmentKey]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { data, loading, error, refresh };
}

export function usePluginAction(key: string): PluginActionFn {
  const bridge = useBridge();
  const latest = useRef(bridge);
  latest.current = bridge;
  return useCallback(
    async (params?: Record<string, unknown>) => {
      const { pluginId, hostContext } = latest.current;
      try {
        const response = await pluginsApi.bridgePerformAction(pluginId, key, params, hostContext.companyId, snapshot(hostContext.renderEnvironment));
        return response.data;
      } catch (caught) {
        throw extractBridgeError(caught);
      }
    },
    [key],
  );
}

export function useHostContext(): PluginHostContext {
  return useBridge().hostContext;
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
}

export function useHostNavigation(): HostNavigation {
  const { hostContext } = useBridge();
  const prefix = hostContext.companyPrefix;
  return useMemo(() => {
    const resolveHref = (to: string) => resolveHostNavigationHref(to, prefix);
    const navigate = (to: string, options?: HostNavigationOptions) => {
      const href = resolveHref(to);
      const local = sameOriginPath(href);
      if (local === null) window.location.assign(href);
      else hostStore.navigate(local, options);
    };
    return {
      resolveHref,
      navigate,
      linkProps: (to: string, options?: HostNavigationLinkOptions) => {
        const href = resolveHref(to);
        return {
          href,
          target: options?.target,
          rel: options?.rel,
          onClick: (event: MouseEvent<HTMLAnchorElement>) => {
            if (!isPlainLeftClick(event)) return;
            if (options?.target && options.target !== "_self") return;
            if (event.currentTarget.hasAttribute("download") || sameOriginPath(href) === null) return;
            event.preventDefault();
            navigate(href, options);
          },
        };
      },
    };
  }, [prefix]);
}

export function useHostLocation(): HostLocation {
  return useSyncExternalStore(hostStore.subscribe, hostStore.location);
}

export function usePluginToast(): PluginToastFn {
  return useCallback(
    (input: PluginToastInput) =>
      pushToast({
        id: input.id,
        dedupeKey: input.dedupeKey,
        title: input.title,
        body: input.body,
        tone: input.tone,
        ttlMs: input.ttlMs,
        action: input.action ? { label: input.action.label, href: input.action.href } : undefined,
      }),
    [],
  );
}

export function usePluginStream<T = unknown>(channel: string, options?: { companyId?: string }): PluginStreamResult<T> {
  const { pluginId, hostContext } = useBridge();
  const companyId = options?.companyId ?? hostContext.companyId ?? undefined;
  const [events, setEvents] = useState<T[]>([]);
  const [lastEvent, setLastEvent] = useState<T | null>(null);
  const [connecting, setConnecting] = useState(Boolean(companyId));
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const source = useRef<EventSource | null>(null);

  const close = useCallback(() => {
    source.current?.close();
    source.current = null;
    setConnecting(false);
    setConnected(false);
  }, []);

  useEffect(() => {
    setEvents([]);
    setLastEvent(null);
    setError(null);
    if (!companyId) {
      close();
      return;
    }
    const query = new URLSearchParams({ companyId });
    const next = new EventSource(`/api/plugins/${encodeURIComponent(pluginId)}/bridge/stream/${encodeURIComponent(channel)}?${query}`, { withCredentials: true });
    source.current = next;
    setConnecting(true);
    setConnected(false);
    const settle = () => {
      next.close();
      if (source.current === next) source.current = null;
      setConnecting(false);
      setConnected(false);
    };
    next.onopen = () => {
      setConnecting(false);
      setConnected(true);
      setError(null);
    };
    next.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as T;
        setEvents((current) => [...current, parsed]);
        setLastEvent(parsed);
      } catch (caught) {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      }
    };
    next.addEventListener("close", settle);
    next.onerror = () => {
      settle();
      setError(new Error(`Couldn't connect to the plugin stream "${channel}".`));
    };
    return () => {
      next.close();
      if (source.current === next) source.current = null;
    };
  }, [channel, close, companyId, pluginId]);

  return { events, lastEvent, connecting, connected, error, close };
}

/** Copies text, with a fallback for plain-HTTP deployments where the Clipboard API is off. */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (window.isSecureContext !== false && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Blocked: fall through.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("aria-hidden", "true");
  area.tabIndex = -1;
  Object.assign(area.style, { position: "fixed", top: "0", left: "-9999px" });
  const container = document.activeElement?.closest('[role="dialog"]') ?? document.body;
  container.appendChild(area);
  const focused = document.activeElement as HTMLElement | null;
  area.focus();
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  focused?.focus?.();
  if (!copied) throw new Error("Couldn't copy to the clipboard.");
}
