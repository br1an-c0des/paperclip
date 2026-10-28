import { createMemo, For, Show, type JSX } from "solid-js";
import { useCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import { usePluginLaunchers, usePluginSlots } from "./contributions";
import type { PluginSlotContext } from "./model";
import { PluginLauncherOutlet } from "./PluginLaunchers";
import { PluginSlotMount, PluginSlotOutlet } from "./PluginSlot";
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
 * Neither renders anything, or loads React, without a plugin contributing to it.
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

/** The signed-in person, or the local board on a local_trusted instance; null until it's known. */
function useYouId(): () => string | null {
  try {
    const session = useSession();
    return () => session.youId();
  } catch {
    return () => "local-board";
  }
}
