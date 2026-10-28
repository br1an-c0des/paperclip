import { createMemo, createSignal, For, Show } from "solid-js";
import { useCompany } from "@/lib/company";
import { usePluginLaunchers, usePluginSlots } from "./contributions";
import { pluginTabValue, type PluginSlotContext } from "./model";
import { PluginLauncherOutlet } from "./PluginLaunchers";
import { PluginSlotMount, PluginSlotOutlet } from "./PluginSlot";
import "./plugins.css";

/*
 * What plugins add to a workspace (ui/src/pages/ExecutionWorkspaceDetail.tsx and
 * ProjectWorkspaceDetail.tsx): their `detailTab` slots for execution or project workspaces, and
 * their toolbar buttons for execution workspaces. The old UI has a page per workspace with these as
 * tabs; ui-new shows workspaces inside the task's Workspace section and the project's Code settings,
 * so the plugin views are a row of tabs there, with the open one below. None is open until picked,
 * so React loads only when someone opens one (or a toolbar button is present).
 */

export function WorkspacePlugins(props: {
  kind: "execution_workspace" | "project_workspace";
  workspaceId: string;
  projectId?: string | null;
}) {
  const company = useCompany();
  const tabs = usePluginSlots(() => ({ slotTypes: ["detailTab"], entityType: props.kind }));
  const tools = usePluginSlots(() => ({ slotTypes: ["toolbarButton", "contextMenuItem"], entityType: props.kind }));
  const launchers = usePluginLaunchers(() => ({ placementZones: ["toolbarButton"], entityType: props.kind }));
  const [open, setOpen] = createSignal<string | null>(null);
  const openSlot = createMemo(() => tabs.slots().find((slot) => pluginTabValue(slot) === open()));
  const context = (): PluginSlotContext => ({
    companyId: company().id,
    companyPrefix: company().issuePrefix,
    projectId: props.projectId ?? null,
    entityId: props.workspaceId,
    entityType: props.kind,
  });
  const hasTools = () => tools.slots().length > 0 || launchers.launchers().length > 0;

  return (
    <Show when={tabs.slots().length > 0 || hasTools()}>
      <section class="plugin-workspace" aria-label="From plugins">
        <Show when={hasTools()}>
          <div class="plugin-toolbar">
            <PluginSlotOutlet slotTypes={["toolbarButton", "contextMenuItem"]} entityType={props.kind} context={context()} class="plugin-toolbar-group" missing="placeholder" errorBehavior="hidden" />
            <PluginLauncherOutlet placementZones={["toolbarButton"]} entityType={props.kind} context={context()} class="plugin-toolbar-group" errorBehavior="hidden" />
          </div>
        </Show>
        <Show when={tabs.slots().length > 0}>
          <div class="plugin-workspace-tabs" role="tablist" aria-label="Plugin views">
            <For each={tabs.slots()}>
              {(slot) => {
                const value = pluginTabValue(slot);
                return (
                  <button
                    type="button"
                    role="tab"
                    class="btn btn--well btn--compact"
                    aria-selected={open() === value}
                    title={`${slot.pluginDisplayName}: ${slot.displayName}`}
                    onClick={() => setOpen(open() === value ? null : value)}
                  >
                    {slot.displayName}
                  </button>
                );
              }}
            </For>
          </div>
          <Show when={openSlot()} keyed>
            {(slot) => (
              <div class="card plugin-workspace-view" role="tabpanel" aria-label={slot.displayName}>
                <PluginSlotMount slot={slot} context={context()} class="plugin-tab" missing="placeholder" />
              </div>
            )}
          </Show>
        </Show>
      </section>
    </Show>
  );
}
