import type { PluginHostContext } from "@paperclipai/plugin-sdk/ui";
import type { PluginUiSlotEntityType, PluginUiSlotType } from "@paperclipai/shared";
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch, type JSX } from "solid-js";
import { usePluginContributions, useHostUserId, usePluginSlots } from "./contributions";
import { useSyncHost } from "./host";
import { loadPluginModule, moduleState, onRegistryChange, resolveRegisteredComponent } from "./loader";
import { hostContextFor, pluginTabValue, type PluginSlotContext, type ResolvedPluginSlot } from "./model";
import { loadReactRuntime } from "./runtime";
import type { MountHandle } from "./react/runtime";
import "./plugins.css";

/*
 * Plugin outlets: where a plugin's React component appears inside a Solid page.
 *
 * - <PluginExportMount> renders one export of a plugin's UI module. It loads the React runtime and
 *   the module the first time, then mounts the export as its own React root in a host element.
 *   Failures stay inside it: a module that won't load, an export that's missing, or a component
 *   that throws (caught by the React error boundary in react/runtime.ts) shows a one-line note
 *   there, and the page and other plugins carry on.
 * - <PluginSlotMount> is that for a slot, with the slot and its context as props.
 * - <PluginSlotOutlet> renders every slot of some types (the sidebar's, a toolbar's). With no
 *   matching slot it renders nothing and never loads React.
 * - <PluginDetailTab> renders the slot a `plugin:<pluginKey>:<slotId>` tab names.
 */

type MountState = { status: "loading" } | { status: "ready" } | { status: "missing" } | { status: "error"; message: string };

export type PluginExportMountProps = {
  pluginId: string;
  pluginKey: string;
  pluginDisplayName: string;
  exportName: string;
  /** What the placeholder calls it: "<plugin>: <name>". */
  name: string;
  hostContext: PluginHostContext;
  /** The component's props (`context` and `slot`, or `context` and `launcher`). */
  componentProps: Record<string, unknown>;
  /** Properties set on a custom element when the export is a tag name. */
  elementProps?: Record<string, unknown>;
  class?: string;
  /** What shows while the component isn't there: nothing (default), or a quiet "<plugin>: <name>" line. */
  missing?: "hidden" | "placeholder";
  /** Shown instead of the placeholder when the export can't be found. */
  fallback?: JSX.Element;
};

export function PluginExportMount(props: PluginExportMountProps) {
  useSyncHost();
  const contributions = usePluginContributions();
  const contribution = createMemo(() => contributions.data?.find((entry) => entry.pluginId === props.pluginId));
  const [state, setState] = createSignal<MountState>({ status: "loading" });
  const [tick, setTick] = createSignal(0);
  onCleanup(onRegistryChange(() => setTick((value) => value + 1)));

  let area!: HTMLDivElement;
  let handle: MountHandle | null = null;
  let mounted: unknown = null;
  let disposed = false;

  const clear = () => {
    handle?.unmount();
    handle = null;
    mounted = null;
    area.replaceChildren();
  };
  onCleanup(() => {
    disposed = true;
    handle?.unmount();
    handle = null;
  });

  createEffect(() => {
    tick();
    const found = contribution();
    if (!found) {
      if (!contributions.isLoading) setState({ status: "missing" });
      return;
    }
    const registered = resolveRegisteredComponent(props.pluginKey, props.exportName);
    if (!registered) {
      const loaded = moduleState(found);
      if (loaded?.status === "error") setState({ status: "error", message: loaded.message });
      else if (loaded?.status === "loaded") setState({ status: "missing" });
      else {
        setState({ status: "loading" });
        loadReactRuntime()
          .then(() => loadPluginModule(found))
          .catch((error: unknown) => !disposed && setState({ status: "error", message: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (registered.kind === "web-component") {
      const elementProps = { ...props.elementProps, pluginContext: props.hostContext };
      if (mounted !== registered.tagName) {
        clear();
        area.append(document.createElement(registered.tagName));
        mounted = registered.tagName;
      }
      Object.assign(area.firstElementChild ?? {}, elementProps);
      setState({ status: "ready" });
      return;
    }
    const spec = {
      pluginId: props.pluginId,
      label: props.pluginDisplayName,
      component: registered.component,
      props: props.componentProps,
      hostContext: props.hostContext,
    };
    setState({ status: "ready" });
    void loadReactRuntime().then((runtime) => {
      if (disposed) return;
      if (handle && mounted === registered.component) handle.update(spec);
      else {
        clear();
        handle = runtime.mountPluginComponent(area, spec);
        mounted = registered.component;
      }
    });
  });

  const name = () => `${props.pluginDisplayName}: ${props.name}`;
  return (
    <div class={props.class ? `plugin-slot ${props.class}` : "plugin-slot"} data-plugin={props.pluginKey} data-export={props.exportName}>
      <Switch>
        <Match when={state().status === "error" && (state() as { message: string }).message}>
          {(message) => (
            <div class="plugin-error" role="alert" title={message()}>
              {props.pluginDisplayName}: couldn't load ({message()})
            </div>
          )}
        </Match>
        <Match when={state().status === "missing"}>
          {props.fallback ?? (
            <Show when={props.missing === "placeholder"}>
              <div class="plugin-placeholder">{name()}</div>
            </Show>
          )}
        </Match>
        <Match when={state().status === "loading" && props.missing === "placeholder"}>
          <div class="plugin-placeholder" role="status">
            Loading {name()}…
          </div>
        </Match>
      </Switch>
      <div ref={area} class="plugin-area" hidden={state().status !== "ready"} />
    </div>
  );
}

export type PluginSlotMountProps = {
  slot: ResolvedPluginSlot;
  context: PluginSlotContext;
  class?: string;
  missing?: "hidden" | "placeholder";
  /** Extra props for the component; `context` and `slot` are always the host's. */
  componentProps?: Record<string, unknown>;
  fallback?: JSX.Element;
};

export function PluginSlotMount(props: PluginSlotMountProps) {
  const userId = useHostUserId();
  const hostContext = createMemo(() => hostContextFor(props.context, userId()));
  return (
    <PluginExportMount
      pluginId={props.slot.pluginId}
      pluginKey={props.slot.pluginKey}
      pluginDisplayName={props.slot.pluginDisplayName}
      exportName={props.slot.exportName}
      name={props.slot.displayName}
      hostContext={hostContext()}
      componentProps={{ ...props.componentProps, slot: props.slot, context: hostContext() }}
      elementProps={{ pluginSlot: props.slot }}
      class={props.class}
      missing={props.missing}
      fallback={props.fallback}
    />
  );
}

export type PluginSlotOutletProps = {
  slotTypes: readonly PluginUiSlotType[];
  context: PluginSlotContext;
  entityType?: PluginUiSlotEntityType | null;
  class?: string;
  itemClass?: string;
  missing?: "hidden" | "placeholder";
  /** "hidden" keeps ambient chrome (the nav) quiet when the plugin list can't load. */
  errorBehavior?: "inline" | "hidden";
};

export function PluginSlotOutlet(props: PluginSlotOutletProps) {
  const { query, slots } = usePluginSlots(
    () => ({ slotTypes: props.slotTypes, entityType: props.entityType ?? props.context.entityType ?? null }),
    () => Boolean(props.context.companyId),
  );
  return (
    <>
      <Show when={query.isError && props.errorBehavior !== "hidden"}>
        <div class="plugin-error" role="alert">
          Plugin extensions unavailable: {query.error instanceof Error ? query.error.message : "unknown error"}
        </div>
      </Show>
      <Show when={slots().length > 0}>
        <div class={props.class}>
          <For each={slots()}>{(slot) => <PluginSlotMount slot={slot} context={props.context} class={props.itemClass} missing={props.missing} />}</For>
        </div>
      </Show>
    </>
  );
}

/** The slot a `plugin:<pluginKey>:<slotId>` tab names, or a note that it's gone. */
export function PluginDetailTab(props: { slots: readonly ResolvedPluginSlot[]; tab: string; loading: boolean; context: PluginSlotContext }) {
  const slot = createMemo(() => props.slots.find((candidate) => pluginTabValue(candidate) === props.tab));
  return (
    <Show
      when={slot()}
      keyed
      fallback={
        <p class="card plugin-note" role="status">
          {props.loading ? "Loading the plugin view…" : "This plugin view isn't available. The plugin may be turned off or removed."}
        </p>
      }
    >
      {(found) => <PluginSlotMount slot={found} context={props.context} class="plugin-tab" missing="placeholder" />}
    </Show>
  );
}
