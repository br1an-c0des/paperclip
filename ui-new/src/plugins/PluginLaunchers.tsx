import type { PluginRenderCloseEvent, PluginRenderCloseHandler, PluginRenderEnvironmentContext } from "@paperclipai/plugin-sdk/ui";
import type { PluginLauncherBounds, PluginLauncherPlacementZone, PluginUiSlotEntityType } from "@paperclipai/shared";
import { useLocation, useNavigate } from "@solidjs/router";
import { X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { pluginsApi } from "@/api/plugins";
import { buttonClass } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { useHostUserId, usePluginLaunchers } from "./contributions";
import { hostContextFor, launcherDisplayName, launcherNavigationTarget, opensComponent, type PluginSlotContext, type ResolvedPluginLauncher } from "./model";
import { PluginExportMount } from "./PluginSlot";
import "./plugins.css";

/*
 * Plugin launchers (ui/src/plugins/launchers.tsx): buttons a plugin adds to the nav or a toolbar.
 * A launcher navigates (`navigate`, `deepLink`), calls the plugin's worker (`performAction`), or
 * opens one of its components in a host modal, drawer or popover. The overlay follows the old
 * host's rules: the plugin can ask for other bounds (`requestModalBounds`), hook into closing
 * (`closeLifecycle`), and Escape, the backdrop, Close or navigating away closes it.
 *
 * The buttons are plain Solid; React loads only when a launcher opens a component.
 */

type LauncherInstance = {
  key: string;
  launcher: ResolvedPluginLauncher;
  context: PluginSlotContext;
  source: HTMLElement | null;
  sourceRect: DOMRect | null;
  beforeClose: Set<PluginRenderCloseHandler>;
  onClose: Set<PluginRenderCloseHandler>;
};

/** PLUGIN_LAUNCHER_BOUNDS in @paperclipai/shared (types only are imported from it). */
const BOUNDS = new Set<string>(["inline", "compact", "default", "wide", "full"] satisfies PluginLauncherBounds[]);
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The launcher list item style for each place it's shown. */
function triggerClass(zone: PluginLauncherPlacementZone) {
  if (zone === "sidebar" || zone === "sidebarPanel") return "navi plugin-launcher-navi";
  if (zone === "toolbarButton" || zone === "globalToolbarButton") return buttonClass({ size: "compact" });
  return buttonClass({ size: "compact", ghost: true });
}

export function PluginLauncherOutlet(props: {
  placementZones: readonly PluginLauncherPlacementZone[];
  context: PluginSlotContext;
  entityType?: PluginUiSlotEntityType | null;
  class?: string;
  errorBehavior?: "inline" | "hidden";
}) {
  const navigate = useNavigate();
  const { query, launchers } = usePluginLaunchers(
    () => ({ placementZones: props.placementZones, entityType: props.entityType ?? props.context.entityType ?? null }),
    () => Boolean(props.context.companyId),
  );
  const [open, setOpen] = createSignal<LauncherInstance[]>([]);
  const contribution = (pluginId: string) => query.data?.find((entry) => entry.pluginId === pluginId);

  const activate = async (launcher: ResolvedPluginLauncher, source: HTMLElement) => {
    const action = launcher.action;
    const prefix = props.context.companyPrefix;
    switch (action.type) {
      case "navigate":
        return navigate(launcherNavigationTarget(action.target, prefix));
      case "deepLink":
        if (/^https?:\/\//.test(action.target)) window.open(action.target, "_blank", "noopener,noreferrer");
        else navigate(launcherNavigationTarget(action.target, prefix));
        return;
      case "performAction":
        try {
          await pluginsApi.bridgePerformAction(launcher.pluginId, action.target, action.params, props.context.companyId ?? null);
        } catch (error) {
          pushToast({ tone: "error", title: `${launcher.displayName} didn't work`, body: error instanceof Error ? error.message : undefined });
        }
        return;
      default:
        if (!opensComponent(launcher)) return;
        setOpen((current) => [
          ...current,
          {
            key: `${launcher.pluginId}:${launcher.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            launcher,
            context: { ...props.context },
            source,
            sourceRect: source.getBoundingClientRect(),
            beforeClose: new Set(),
            onClose: new Set(),
          },
        ]);
    }
  };

  const close = async (key: string, event: PluginRenderCloseEvent) => {
    const instance = open().find((entry) => entry.key === key);
    if (!instance) return;
    for (const handler of [...instance.beforeClose]) await handler(event);
    setOpen((current) => current.filter((entry) => entry.key !== key));
    queueMicrotask(() => {
      for (const handler of [...instance.onClose]) void handler(event);
      if (instance.source?.isConnected) instance.source.focus();
    });
  };

  // Navigating away closes every open launcher.
  const location = useLocation();
  createEffect(
    on(
      () => location.pathname,
      () => {
        for (const instance of open()) void close(instance.key, { reason: "hostNavigation" });
      },
      { defer: true },
    ),
  );

  return (
    <>
      <Show when={query.isError && props.errorBehavior !== "hidden"}>
        <div class="plugin-error" role="alert">
          Plugin launchers unavailable: {query.error instanceof Error ? query.error.message : "unknown error"}
        </div>
      </Show>
      <Show when={launchers().length > 0}>
        <div class={props.class}>
          <For each={launchers()}>
            {(launcher) => (
              <button
                type="button"
                class={triggerClass(launcher.placementZone)}
                data-plugin={launcher.pluginKey}
                title={`${launcher.displayName} (from ${launcher.pluginDisplayName})`}
                onClick={(event) => void activate(launcher, event.currentTarget)}
              >
                <Show when={launcher.placementZone === "sidebar"}>
                  <span class="plugin-launcher-mark" aria-hidden="true" />
                </Show>
                <span class="navi-label">{launcherDisplayName(launcher, contribution(launcher.pluginId))}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <For each={open()}>
        {(instance, index) => <LauncherShell instance={instance} stackIndex={index()} topmost={index() === open().length - 1} onClose={(event) => close(instance.key, event)} />}
      </For>
    </>
  );
}

function boundsStyle(bounds: PluginLauncherBounds): Record<string, string> {
  switch (bounds) {
    case "compact":
      return { width: "min(28rem, calc(100vw - 2rem))" };
    case "wide":
      return { width: "min(64rem, calc(100vw - 2rem))" };
    case "full":
      return { width: "calc(100vw - 2rem)", height: "calc(100vh - 2rem)" };
    case "inline":
      return { width: "min(24rem, calc(100vw - 2rem))" };
    default:
      return { width: "min(40rem, calc(100vw - 2rem))" };
  }
}

function LauncherShell(props: { instance: LauncherInstance; stackIndex: number; topmost: boolean; onClose: (event: PluginRenderCloseEvent) => Promise<void> }) {
  const userId = useHostUserId();
  const launcher = () => props.instance.launcher;
  const kind = () => launcher().action.type as "openModal" | "openDrawer" | "openPopover";
  const [bounds, setBounds] = createSignal<PluginLauncherBounds>(launcher().render?.bounds ?? "default");
  let panel!: HTMLDivElement;
  const titleId = `plugin-launcher-${props.instance.key.replace(/[^\w-]/g, "")}`;

  const environment: PluginRenderEnvironmentContext = {
    environment: launcher().render?.environment ?? "hostOverlay",
    launcherId: launcher().id,
    get bounds() {
      return bounds();
    },
    requestModalBounds: async (request) => {
      // Only the host's presets; anything else is ignored so a plugin can't break the layout.
      if (BOUNDS.has(request.bounds)) setBounds(request.bounds);
    },
    closeLifecycle: {
      onBeforeClose: (handler) => {
        props.instance.beforeClose.add(handler);
        return () => props.instance.beforeClose.delete(handler);
      },
      onClose: (handler) => {
        props.instance.onClose.add(handler);
        return () => props.instance.onClose.delete(handler);
      },
    },
  };
  const hostContext = createMemo(() => ({ ...hostContextFor(props.instance.context, userId()), renderEnvironment: { ...environment, bounds: bounds() } }));

  onMount(() => requestAnimationFrame(() => (panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus()));
  const onKey = (event: KeyboardEvent) => {
    if (!props.topmost) return;
    if (event.key === "Escape") {
      event.preventDefault();
      void props.onClose({ reason: "escapeKey", nativeEvent: event });
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return event.preventDefault();
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKey);
  onCleanup(() => document.removeEventListener("keydown", onKey));

  const style = () => {
    const base = boundsStyle(bounds());
    const z = { "z-index": String(60 + props.stackIndex * 2 + 1) };
    if (kind() === "openPopover") {
      const rect = props.instance.sourceRect;
      const top = rect ? `${Math.min(rect.bottom + 8, window.innerHeight - 32)}px` : "4rem";
      const left = rect ? `${Math.min(Math.max(rect.left, 16), Math.max(16, window.innerWidth - 360))}px` : "50%";
      return { ...base, ...z, top, left, "max-height": "min(70vh, 36rem)" };
    }
    if (kind() === "openDrawer") return { width: base.width ?? "min(44rem, 100vw)", ...z };
    return { ...base, ...z };
  };

  return (
    <Portal>
      <div
        class="plugin-scrim"
        classList={{ "plugin-scrim--clear": kind() === "openPopover" }}
        style={{ "z-index": String(60 + props.stackIndex * 2) }}
        aria-hidden="true"
        onMouseDown={(event) => props.topmost && event.target === event.currentTarget && void props.onClose({ reason: "backdrop", nativeEvent: event })}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        class={`plugin-launcher-panel plugin-launcher-panel--${kind()}`}
        style={style()}
      >
        <header class="plugin-launcher-head">
          <div class="plugin-launcher-titles">
            <h2 id={titleId} class="disp">
              {launcher().displayName}
            </h2>
            <span class="plugin-launcher-sub">{launcher().pluginDisplayName}</span>
          </div>
          <button type="button" class={buttonClass({ variant: "icon", ghost: true, size: "compact" })} aria-label="Close" onClick={() => void props.onClose({ reason: "programmatic" })}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div class="plugin-launcher-body">
          <PluginExportMount
            pluginId={launcher().pluginId}
            pluginKey={launcher().pluginKey}
            pluginDisplayName={launcher().pluginDisplayName}
            exportName={launcher().action.target}
            name={launcher().displayName}
            hostContext={hostContext()}
            componentProps={{ launcher: launcher(), context: hostContext() }}
            elementProps={{ pluginLauncher: launcher() }}
            missing="placeholder"
            fallback={
              <Show
                when={launcher().render?.environment === "iframe"}
                fallback={
                  <div class="plugin-error" role="alert">
                    {launcher().pluginDisplayName}: couldn't find “{launcher().action.target}” in its UI.
                  </div>
                }
              >
                <iframe
                  class="plugin-iframe"
                  src={`/_plugins/${encodeURIComponent(launcher().pluginId)}/ui/${launcher().action.target}`}
                  title={`${launcher().pluginDisplayName} ${launcher().displayName}`}
                />
              </Show>
            }
          />
        </div>
      </div>
    </Portal>
  );
}
