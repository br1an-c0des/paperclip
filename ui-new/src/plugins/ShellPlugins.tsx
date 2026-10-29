import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { useCompany } from "@/lib/company";
import { useSession, useSignOut } from "@/lib/session";
import { usePluginLaunchers, usePluginSlots } from "./contributions";
import type { PluginSlotContext, ResolvedPluginSlot } from "./model";
import { PluginLauncherOutlet } from "./PluginLaunchers";
import { PluginSlotMount, PluginSlotOutlet } from "./PluginSlot";
import { loadReactRuntime } from "./runtime";
import "./plugins.css";

/*
 * What plugins add to the shell around every page:
 *
 * - <GlobalToolbarPlugins>: `globalToolbarButton` slots and launchers. The old UI draws them at the
 *   right of its breadcrumb bar (BreadcrumbBar.tsx); ui-new has no such bar, so they sit under the
 *   company switcher in the nav, and in the phone's switcher sheet.
 * - <AppShellOverlays>: `appShellOverlay` slots (ui/src/components/PluginAppShellOverlays.tsx),
 *   stacked at the bottom right above the phone dock. Each mounts once per person and company and
 *   survives navigation; switching company or account remounts them. Onboarding and sign-in are
 *   outside the company shell, so overlays never show there. A plugin list that can't load shows
 *   nothing: optional extensions never replace the page's own error states.
 *
 * - <PluginOrganizationSwitcher>: an `organizationSwitcher` slot replaces the nav's company switcher
 *   (ui/src/components/PluginOrganizationSwitcher.tsx), only when exactly one plugin offers one: the
 *   host never picks a winner. The built-in switcher shows while the plugin loads and whenever it
 *   fails to load or render, so the nav always has one.
 *
 * None renders anything, or loads React, without a plugin contributing to it.
 */

function useShellContext(): () => PluginSlotContext {
  const company = useCompany();
  return () => ({ companyId: company().id, companyPrefix: company().issuePrefix });
}

export function GlobalToolbarPlugins(props: { class?: string; heading?: JSX.Element }) {
  const context = useShellContext();
  const slots = usePluginSlots(() => ({ slotTypes: ["globalToolbarButton"] }));
  const launchers = usePluginLaunchers(() => ({ placementZones: ["globalToolbarButton"] }));
  return (
    <Show when={slots.slots().length > 0 || launchers.launchers().length > 0}>
      {props.heading}
      <div class={`plugin-global-toolbar ${props.class ?? ""}`} role="toolbar" aria-label="Plugin tools">
        <PluginSlotOutlet slotTypes={["globalToolbarButton"]} context={context()} class="plugin-toolbar-group" errorBehavior="hidden" />
        <PluginLauncherOutlet placementZones={["globalToolbarButton"]} context={context()} class="plugin-toolbar-group" errorBehavior="hidden" />
      </div>
    </Show>
  );
}

export function AppShellOverlays() {
  const company = useCompany();
  const youId = useYouId();
  const { query, slots } = usePluginSlots(() => ({ slotTypes: ["appShellOverlay"] }));
  // Who and where: a change remounts every overlay, so a plugin never carries one account's or one
  // company's state into another.
  const scope = createMemo(() => {
    const you = youId();
    return you ? `${you}:${company().id}` : null;
  });
  return (
    <Show when={!query.isError && slots().length > 0 && scope()} keyed>
      {(_scope) => (
        <aside class="plugin-shell-overlays" aria-label="Application extensions">
          <For each={slots()}>
            {(slot) => (
              <PluginSlotMount
                slot={slot}
                context={{ companyId: company().id, companyPrefix: company().issuePrefix }}
                class="plugin-shell-overlay"
              />
            )}
          </For>
        </aside>
      )}
    </Show>
  );
}

export function PluginOrganizationSwitcher(props: { children: JSX.Element }) {
  const company = useCompany();
  const { query, slots } = usePluginSlots(() => ({ slotTypes: ["organizationSwitcher"] }));
  const slot = createMemo(() => (!query.isError && slots().length === 1 ? slots()[0]! : null));
  return (
    <Show when={slot()} keyed fallback={props.children}>
      {(found) => <OrganizationSwitcherMount slot={found} company={company()} fallback={props.children} />}
    </Show>
  );
}

type SwitcherCompany = { id: string; name: string; issuePrefix: string; logoUrl?: string | null };

function OrganizationSwitcherMount(props: {
  slot: ResolvedPluginSlot;
  company: SwitcherCompany;
  fallback: JSX.Element;
}) {
  const signOut = useSignOut();
  const [open, setOpen] = createSignal(false);
  const [signingOut, setSigningOut] = createSignal(false);
  // renderIcon runs inside the plugin's React tree, so the runtime has loaded by the time it's called.
  let runtime: Awaited<ReturnType<typeof loadReactRuntime>> | null = null;
  void loadReactRuntime().then((loaded) => (runtime = loaded));
  // The nav keys the current company's disc by its id; others by name (renderIcon gets no id).
  const seedFor = (name: string) => (name === props.company.name ? props.company.id : name);
  const componentProps = createMemo(() => ({
    organizationSwitcher: {
      currentCompany: { name: props.company.name, logoUrl: props.company.logoUrl ?? null },
      // ui-new's nav doesn't collapse to icons; when hidden it isn't drawn at all.
      collapsed: false,
      open: open(),
      onOpenChange: (next: boolean) => setOpen(next),
      onNavigate: () => setOpen(false),
      onSignOut: () => {
        setSigningOut(true);
        void signOut().finally(() => setSigningOut(false));
      },
      signingOut: signingOut(),
      renderIcon: (name: string, logoUrl: string | null, inMenu: boolean) => runtime?.renderCompanyIcon(name, logoUrl, inMenu, seedFor(name)) ?? null,
    },
  }));
  return (
    <PluginSlotMount
      slot={props.slot}
      context={{ companyId: props.company.id, companyPrefix: props.company.issuePrefix }}
      componentProps={componentProps()}
      class="plugin-org-switcher"
      fallback={props.fallback}
      replaces
    />
  );
}

/** The signed-in person, or the local board on a local_trusted instance; null until it's known. */
function useYouId(): () => string | null {
  try {
    const session = useSession();
    return () => session.youId();
  } catch {
    return () => "local-board";
  }
}
