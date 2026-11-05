import { api, ApiError } from "@/api/client";
import type { ResolvedPluginSlot } from "./model";

/*
 * Plugin task side panels (upstream #18131, #18363), as ui/src/hooks/useTaskPluginPanels.ts reads
 * them. A panel is an agent `detailTab` slot that opted in with `taskSidePanel`:
 *
 * - It can be opened by hand whenever the task has an agent: the one running it, else its assignee,
 *   so also while that agent is idle.
 * - A panel that declares `activation: { namespace, activityKey }` opens itself when the task's
 *   running run records matching runtime activity. The run's activations so far come from
 *   `GET /heartbeat-runs/:runId/events?view=plugin-panels` (they only grow), and new ones from the
 *   run's live `runtime.activity.recorded` events.
 * - Only then does the host ask the plugin whether the panel is ready
 *   (`GET /plugins/:id/api<availabilityPath>?runId=&issueId=`), up to three times a second apart,
 *   instead of polling every few seconds.
 */

/** A panel the run's activity asked for. */
export type PanelActivation = { pluginKey: string; slotId: string };

/** Tries of the availability check after activity: the first and two retries. */
export const AVAILABILITY_TRIES = 3;
export const AVAILABILITY_RETRY_MS = 1_000;

/** The plugin answered that the panel isn't ready yet; it's asked again. */
export class PanelNotReadyError extends Error {
  constructor() {
    super("The plugin panel isn't ready yet");
    this.name = "PanelNotReadyError";
  }
}

export const taskPanelsApi = {
  /** The panels the run's recorded activity has asked for (at most 128). */
  activations: (runId: string, signal?: AbortSignal) =>
    api.get<PanelActivation[]>(`/heartbeat-runs/${encodeURIComponent(runId)}/events?view=plugin-panels`, { signal }),
  /** Whether the panel is ready for this agent's run on this task; throws PanelNotReadyError when not. */
  availability: async (slot: ResolvedPluginSlot, agentId: string, runId: string, issueId: string, signal?: AbortSignal) => {
    const path = slot.taskSidePanel!.availabilityPath.replace(":entityId", encodeURIComponent(agentId));
    const query = new URLSearchParams({ runId, issueId });
    const result = await api.get<{ available: boolean }>(`/plugins/${encodeURIComponent(slot.pluginId)}/api${path}?${query}`, { signal });
    if (result?.available !== true) throw new PanelNotReadyError();
    return result;
  },
};

/** Retry the availability check twice more, a second apart, unless the plugin refused it (4xx). */
export function retryAvailability(failures: number, error: unknown) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failures < AVAILABILITY_TRIES - 1;
}

export function sameActivation(a: PanelActivation, b: PanelActivation) {
  return a.pluginKey === b.pluginKey && a.slotId === b.slotId;
}

/** Activations only grow: what was known, plus what's new. */
export function mergeActivations(known: readonly PanelActivation[] | undefined, incoming: readonly PanelActivation[]): PanelActivation[] {
  const out = [...(known ?? [])];
  for (const panel of incoming) if (!out.some((existing) => sameActivation(existing, panel))) out.push({ pluginKey: panel.pluginKey, slotId: panel.slotId });
  return out;
}

/** Whether the run's activity has asked for this panel. */
export function activated(activations: readonly PanelActivation[] | undefined, slot: Pick<ResolvedPluginSlot, "pluginKey" | "id">) {
  return (activations ?? []).some((panel) => panel.pluginKey === slot.pluginKey && panel.slotId === slot.id);
}

/**
 * The panels a live run event asks for: a `heartbeat.run.event` for this run, agent and task whose
 * Runner `runtime.activity.recorded` event carries exactly `{ namespace, activityKey }`, matched
 * against the panels' declared activations.
 */
export function panelsForActivity(
  payload: Record<string, unknown> | undefined,
  run: { runId: string; agentId: string; issueId: string },
  slots: readonly ResolvedPluginSlot[],
): PanelActivation[] {
  if (!payload || payload.runId !== run.runId || payload.agentId !== run.agentId || payload.issueId !== run.issueId) return [];
  if (payload.eventType !== "runtime.activity.recorded") return [];
  const native = payload.payload as { prpEvent?: { eventType?: unknown; sourceKind?: unknown; payload?: unknown } } | null | undefined;
  if (native?.prpEvent?.eventType !== "runtime.activity.recorded" || native.prpEvent.sourceKind !== "runner") return [];
  const activity = native.prpEvent.payload as { namespace?: unknown; activityKey?: unknown } | null | undefined;
  if (!activity || Object.keys(activity).length !== 2 || typeof activity.namespace !== "string" || typeof activity.activityKey !== "string") return [];
  return slots
    .filter((slot) => slot.taskSidePanel?.activation?.namespace === activity.namespace && slot.taskSidePanel?.activation?.activityKey === activity.activityKey)
    .map((slot) => ({ pluginKey: slot.pluginKey, slotId: slot.id }));
}
