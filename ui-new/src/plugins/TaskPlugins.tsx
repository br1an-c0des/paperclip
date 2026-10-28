import { createQueries, createQuery } from "@tanstack/solid-query";
import { createMemo, Show } from "solid-js";
import { issuesApi } from "@/api/issues";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useLiveRunsQuery } from "@/lib/company-data";
import { usePluginLaunchers, usePluginSlots } from "./contributions";
import { pluginTabValue, type PluginSlotContext, type ResolvedPluginSlot } from "./model";
import { PluginLauncherOutlet } from "./PluginLaunchers";
import { PluginSlotMount, PluginSlotOutlet } from "./PluginSlot";
import "./plugins.css";

/*
 * What plugins add to a task, for its sections (tasks/TaskSections.tsx):
 *
 * - Sections: each `detailTab` slot for issues (the old task page's plugin tabs), and each agent
 *   `detailTab` slot that opted into the task side panel (`taskSidePanel`), shown while an agent
 *   is running the task and the plugin says the panel is available for that agent
 *   (ui/src/hooks/useTaskPluginPanels.ts). Section ids are `plugin:<pluginKey>:<slotId>`.
 * - Extras above the open section: the plugins' toolbar buttons and launchers for tasks, and their
 *   `taskDetailView` blocks.
 *
 * With no plugin contributing to tasks, none of this renders anything or loads React.
 */

export type TaskPluginSection = { id: string; label: string; slot: ResolvedPluginSlot; context: PluginSlotContext };

const AVAILABILITY_POLL_MS = 3_000;

export function useTaskPluginSections(taskId: () => string) {
  const company = useCompany();
  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(taskId()),
    queryFn: ({ signal }) => issuesApi.get(taskId(), signal),
  }));
  const tabs = usePluginSlots(() => ({ slotTypes: ["detailTab"], entityType: "issue" }));
  const panels = usePluginSlots(() => ({ slotTypes: ["detailTab"], entityType: "agent", taskSidePanel: true }));
  const liveRuns = useLiveRunsQuery();
  const run = createMemo(() => {
    if (panels.slots().length === 0) return undefined;
    const current = task.data;
    return (liveRuns.data ?? []).find(
      (entry) => entry.issueId === taskId() && entry.status === "running" && (!current?.executionRunId || entry.id === current.executionRunId),
    );
  });
  const availability = createQueries(() => ({
    queries: panels.slots().map((slot) => ({
      queryKey: queryKeys.plugins.panelAvailability(slot.pluginId, slot.id, run()?.agentId ?? "", run()?.id ?? ""),
      queryFn: ({ signal }: { signal: AbortSignal }) => pluginsApi.panelAvailability(slot.pluginId, slot.taskSidePanel!.availabilityPath, run()!.agentId, signal),
      enabled: Boolean(run()),
      refetchInterval: AVAILABILITY_POLL_MS,
      retry: false,
    })),
  }));

  const context = (entityId: string, entityType: "issue" | "agent"): PluginSlotContext => ({
    companyId: company().id,
    companyPrefix: company().issuePrefix,
    projectId: task.data?.projectId ?? null,
    entityId,
    entityType,
  });

  const sections = createMemo<TaskPluginSection[]>(() => {
    const out: TaskPluginSection[] = tabs.slots().map((slot) => ({
      id: pluginTabValue(slot),
      label: slot.displayName,
      slot,
      context: context(taskId(), "issue"),
    }));
    const current = run();
    if (current) {
      panels.slots().forEach((slot, index) => {
        if (availability[index]?.data?.available !== true) return;
        out.push({
          id: pluginTabValue(slot),
          label: slot.displayName,
          slot,
          context: context(current.agentId, "agent"),
        });
      });
    }
    return out;
  });
  return sections;
}

/** The open plugin section. It stays mounted while the plugin list refreshes. */
export function TaskPluginSectionView(props: { sections: readonly TaskPluginSection[]; id: string }) {
  const section = createMemo(() => props.sections.find((entry) => entry.id === props.id));
  return (
    <Show when={section()} fallback={<p class="plugin-note" role="status">This plugin section isn't available right now.</p>}>
      {(found) => <PluginSlotMount slot={found().slot} context={found().context} class="plugin-tab" missing="placeholder" />}
    </Show>
  );
}

/** The plugins' toolbar buttons, launchers and detail blocks for a task, above its open section. */
export function TaskPluginExtras(props: { taskId: string }) {
  const company = useCompany();
  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(props.taskId),
    queryFn: ({ signal }) => issuesApi.get(props.taskId, signal),
  }));
  const context = (): PluginSlotContext => ({
    companyId: company().id,
    companyPrefix: company().issuePrefix,
    projectId: task.data?.projectId ?? null,
    entityId: props.taskId,
    entityType: "issue",
  });
  const views = usePluginSlots(() => ({ slotTypes: ["taskDetailView", "toolbarButton", "contextMenuItem"], entityType: "issue" }));
  const launchers = usePluginLaunchers(() => ({ placementZones: ["toolbarButton"], entityType: "issue" }));
  return (
    <Show when={views.slots().length > 0 || launchers.launchers().length > 0}>
      <div class="plugin-task-extras">
        <div class="plugin-toolbar">
          <PluginSlotOutlet slotTypes={["toolbarButton", "contextMenuItem"]} context={context()} class="plugin-toolbar-group" errorBehavior="hidden" />
          <PluginLauncherOutlet placementZones={["toolbarButton"]} context={context()} class="plugin-toolbar-group" errorBehavior="hidden" />
        </div>
        <PluginSlotOutlet slotTypes={["taskDetailView"]} context={context()} class="plugin-stack" itemClass="card plugin-block" missing="placeholder" errorBehavior="hidden" />
      </div>
    </Show>
  );
}
