import { useSearchParams } from "@solidjs/router";
import { createQueries, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, on, Show, untrack } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useLiveRunsQuery } from "@/lib/company-data";
import { useLiveEvent, useRunInterest } from "@/lib/live-events";
import { useAgentEnvironmentSlots } from "./agent-environment";
import { usePluginLaunchers, usePluginSlots } from "./contributions";
import { pluginTabValue, type PluginSlotContext, type ResolvedPluginSlot } from "./model";
import {
  activated,
  AVAILABILITY_RETRY_MS,
  mergeActivations,
  panelsForActivity,
  retryAvailability,
  taskPanelsApi,
  type PanelActivation,
} from "./task-panels-model";
import { PluginLauncherOutlet } from "./PluginLaunchers";
import { PluginSlotMount, PluginSlotOutlet } from "./PluginSlot";
import "./plugins.css";

/*
 * What plugins add to a task, for its sections (tasks/TaskSections.tsx):
 *
 * - Sections: each `detailTab` slot for issues (the old task page's plugin tabs), and each agent
 *   `detailTab` slot that opted into the task side panel (`taskSidePanel`, task-panels-model.ts).
 *   A panel is there whenever the task has an agent (the one running it, else its assignee), so it
 *   opens by hand while the agent is idle. One that declares an activation opens itself the first
 *   time the running run's activity asks for it and the plugin says it's ready. One that names an
 *   `agentEnvironmentDriver` is there only when that agent's environment uses the plugin's driver
 *   (agent-environment.ts). Section ids are `plugin:<pluginKey>:<slotId>`.
 * - Extras above the open section: the plugins' toolbar buttons and launchers for tasks, and their
 *   `taskDetailView` blocks.
 *
 * With no plugin contributing to tasks, none of this renders anything or loads React.
 */

export type TaskPluginSection = { id: string; label: string; slot: ResolvedPluginSlot; context: PluginSlotContext };

/** Panels opened by their run's activity, so leaving one doesn't reopen it (per run and panel). */
const autoOpened = new Set<string>();

export function useTaskPluginSections(taskId: () => string) {
  const company = useCompany();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams<{ section?: string }>();
  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(taskId()),
    queryFn: ({ signal }) => issuesApi.get(taskId(), signal),
  }));
  const tabs = usePluginSlots(() => ({ slotTypes: ["detailTab"], entityType: "issue" }));
  const declared = usePluginSlots(() => ({ slotTypes: ["detailTab"], entityType: "agent", taskSidePanel: true }));
  const liveRuns = useLiveRunsQuery();
  const run = createMemo(() => {
    if (declared.slots().length === 0) return undefined;
    const current = task.data;
    return (liveRuns.data ?? []).find(
      (entry) => entry.issueId === taskId() && entry.status === "running" && (!current?.executionRunId || entry.id === current.executionRunId),
    );
  });
  const agentId = () => run()?.agentId ?? task.data?.assigneeAgentId ?? null;
  // A panel that needs a plugin environment driver shows only when that agent runs there (U114).
  const panels = useAgentEnvironmentSlots(declared.slots, agentId);

  // Panels that can open themselves, and the activity the running run has recorded for them.
  const activating = createMemo(() => panels.slots().filter((slot) => slot.taskSidePanel?.activation));
  const watching = () => !!run() && activating().length > 0;
  const activationKey = () => ["plugins", "task-panel-activations", taskId(), run()?.id ?? ""] as const;
  const activations = createQuery(() => ({
    queryKey: activationKey(),
    queryFn: ({ signal }) => taskPanelsApi.activations(run()!.id, signal),
    enabled: watching(),
    staleTime: 0,
    // Activations only grow: a reread never drops one a live event added.
    structuralSharing: (previous: unknown, incoming: unknown) => mergeActivations(previous as PanelActivation[] | undefined, incoming as PanelActivation[]),
    retry: retryAvailability,
    retryDelay: AVAILABILITY_RETRY_MS,
  }));
  // The run's live events carry new activity; once they're streaming, read the history again for
  // what came before the subscription.
  const streaming = useRunInterest(() => (watching() ? [run()!.id] : []));
  createEffect(on(streaming, (live) => live && void client.invalidateQueries({ queryKey: activationKey(), exact: true }), { defer: true }));
  useLiveEvent(["heartbeat.run.event"], (event) => {
    const current = untrack(run);
    if (!current || !untrack(watching)) return;
    const asked = panelsForActivity(event.payload, { runId: current.id, agentId: current.agentId, issueId: untrack(taskId) }, untrack(activating));
    if (asked.length === 0) return;
    client.setQueryData<PanelActivation[]>(untrack(activationKey), (previous) => mergeActivations(previous, asked));
    // A check that gave up is tried again on new activity.
    void client.invalidateQueries({
      queryKey: ["plugins", "task-panel-availability", untrack(taskId), current.id],
      predicate: (query) => query.state.status === "error" && query.state.fetchStatus === "idle",
    });
  });
  const availability = createQueries(() => ({
    queries: activating().map((slot) => ({
      queryKey: ["plugins", "task-panel-availability", taskId(), run()?.id ?? "", run()?.agentId ?? "", slot.pluginId, slot.id, slot.pluginVersion, slot.taskSidePanel!.availabilityPath],
      queryFn: ({ signal }: { signal: AbortSignal }) => taskPanelsApi.availability(slot, run()!.agentId, run()!.id, taskId(), signal),
      enabled: watching() && !activations.isError && activated(activations.data, slot),
      staleTime: Infinity,
      retry: retryAvailability,
      retryDelay: AVAILABILITY_RETRY_MS,
    })),
  }));
  const ready = (slot: ResolvedPluginSlot) => {
    const index = activating().indexOf(slot);
    return index >= 0 && availability[index]?.data?.available === true && activated(activations.data, slot);
  };
  // A panel opens itself the first time it's ready for a run. It's a section of the task, chosen in
  // the address as the rail's are.
  createEffect(() => {
    const current = run();
    if (!current) return;
    for (const slot of activating()) {
      if (!ready(slot)) continue;
      const key = JSON.stringify([taskId(), current.id, slot.pluginKey, slot.id]);
      if (autoOpened.has(key)) continue;
      autoOpened.add(key);
      const id = pluginTabValue(slot);
      if (untrack(() => params.section) !== id) setParams({ section: id }, { replace: true });
    }
  });

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
    const agent = agentId();
    if (agent) {
      for (const slot of panels.slots()) {
        out.push({
          id: pluginTabValue(slot),
          label: slot.displayName,
          slot,
          context: context(agent, "agent"),
        });
      }
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
