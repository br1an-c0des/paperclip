import type { BuiltInAgentState, BuiltInAgentStatus, BuiltInManagedResourceState } from "@/api/agents";
import type { Tone } from "@/ui/Status";

/*
 * Built-in agents' pure logic (`enableBuiltInAgents`): how their state reads, what each managed
 * resource offers, and the provisioning request, after the old UI's AgentDetail, BuiltInBundlePanel
 * and ConfigureBuiltInAgentModal.
 */

export const BUILT_IN_STATUS: Record<BuiltInAgentStatus, { label: string; tone: Tone }> = {
  not_provisioned: { label: "Not set up", tone: "violet" },
  pending_approval: { label: "Waiting for approval", tone: "amber" },
  needs_setup: { label: "Needs setup", tone: "amber" },
  ready: { label: "Ready", tone: "green" },
  paused: { label: "Paused", tone: "violet" },
};

/** The built-in this agent is, when the flag is on and the list knows it. */
export function builtInFor(states: readonly BuiltInAgentState[] | undefined, agentId: string) {
  return states?.find((state) => state.agentId === agentId);
}

/** "Briefs, Summaries": the features a built-in serves. */
export function featureList(featureKeys: readonly string[]) {
  return featureKeys.map((key) => key.charAt(0).toUpperCase() + key.slice(1).replace(/[_-]/g, " ")).join(", ");
}

const RESOURCE_LABEL: Record<BuiltInManagedResourceState["resourceKind"], string> = {
  instructions: "Instructions",
  skill: "Skill",
  routine: "Recurring task",
};

export function resourceLabel(kind: BuiltInManagedResourceState["resourceKind"]) {
  return RESOURCE_LABEL[kind];
}

/**
 * What a managed resource says and offers: an unedited resource with a newer default can take it,
 * an edited one can go back to the default (losing the edits), a missing one is recreated by either.
 */
export function resourceState(resource: BuiltInManagedResourceState): { text: string; tone: Tone; action: "update" | "reset" | null } {
  if (resource.stockStatus === "missing") return { text: "Missing", tone: "red", action: "reset" };
  if (resource.updateAvailable || resource.stockStatus === "stock_update_available") return { text: "Update available", tone: "cyan", action: "update" };
  if (resource.stockStatus === "operator_modified")
    return {
      text: resource.changedFiles?.length ? `Edited: ${resource.changedFiles.join(", ")}` : "Edited",
      tone: "amber",
      action: resource.resetAvailable ? "reset" : null,
    };
  return { text: `Paperclip's default, ${resource.stockVersion}`, tone: "green", action: null };
}

/** Harnesses the provisioning dialog offers: the definition's allowed list, or every enabled one. */
export function provisionHarnesses(state: Pick<BuiltInAgentState, "definition">, enabled: readonly string[]) {
  const allowed = state.definition.allowedAdapterTypes;
  return allowed?.length ? enabled.filter((type) => allowed.includes(type)) : [...enabled];
}

/** Dollars typed into the budget field as cents; null when it isn't a number, undefined when empty. */
export function budgetCents(text: string): number | null | undefined {
  const value = text.trim().replace(/^\$/, "");
  if (!value) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}
