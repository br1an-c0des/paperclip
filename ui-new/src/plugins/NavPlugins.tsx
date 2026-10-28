import type { Project } from "@paperclipai/shared";
import { Show } from "solid-js";
import { useCompany } from "@/lib/company";
import { usePluginLaunchers, usePluginSlots } from "./contributions";
import { PluginLauncherOutlet } from "./PluginLaunchers";
import { PluginSlotOutlet } from "./PluginSlot";
import "./plugins.css";

/*
 * What plugins add to the left nav (ui/src/components/Sidebar.tsx): `sidebar` slots and sidebar
 * launchers as entries in their own group, `sidebarPanel` slots as small panels under them, and
 * `projectSidebarItem` slots under each project. The nav stays quiet if the plugin list can't load,
 * and nothing renders (or loads React) without plugins.
 */

export function NavPlugins() {
  const company = useCompany();
  const context = () => ({ companyId: company().id, companyPrefix: company().issuePrefix });
  const entries = usePluginSlots(() => ({ slotTypes: ["sidebar", "sidebarPanel"] }));
  const launchers = usePluginLaunchers(() => ({ placementZones: ["sidebar"] }));
  return (
    <Show when={entries.slots().length > 0 || launchers.launchers().length > 0}>
      <div class="nav-group" aria-label="From plugins" role="group">
        <div class="nav-head">
          <h2>Plugins</h2>
        </div>
        <PluginSlotOutlet slotTypes={["sidebar"]} context={context()} class="plugin-nav" missing="placeholder" errorBehavior="hidden" />
        <PluginLauncherOutlet placementZones={["sidebar"]} context={context()} class="plugin-nav" errorBehavior="hidden" />
        <PluginSlotOutlet slotTypes={["sidebarPanel"]} context={context()} class="plugin-nav-panels" itemClass="plugin-nav-panel" missing="placeholder" errorBehavior="hidden" />
      </div>
    </Show>
  );
}

/** A project's `projectSidebarItem` slots, under its row in the nav. */
export function NavProjectPlugins(props: { project: Pick<Project, "id" | "urlKey"> }) {
  const company = useCompany();
  return (
    <PluginSlotOutlet
      slotTypes={["projectSidebarItem"]}
      entityType="project"
      context={{
        companyId: company().id,
        companyPrefix: company().issuePrefix,
        projectId: props.project.id,
        projectRef: props.project.urlKey,
        entityId: props.project.id,
        entityType: "project",
      }}
      class="plugin-project-items"
      errorBehavior="hidden"
    />
  );
}
