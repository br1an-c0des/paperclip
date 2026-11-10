import type { AgentInteractionPermissionsState, AgentPermissions } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { trustUpdate } from "../trust-model";
import {
  deniedCount,
  INTERACTION_KEYS,
  interactionAllowed,
  interactionGroups,
  interactionOverridden,
  overriddenKeys,
  resetAllPatch,
  resetPatch,
  switchPatch,
} from "./interactions-model";

const allowed = Object.fromEntries(INTERACTION_KEYS.map((key) => [key, true])) as AgentInteractionPermissionsState["effective"];

function state(overrides: AgentInteractionPermissionsState["overrides"]): AgentInteractionPermissionsState {
  const effective = { ...allowed };
  for (const [key, value] of Object.entries(overrides)) effective[key as keyof typeof effective] = value !== false;
  return { agentId: "a1", companyId: "co", overrides, effective };
}

describe("interaction switches", () => {
  it("lists all eleven keys once, six outgoing and five incoming", () => {
    const groups = interactionGroups("Ada");
    expect(groups.map((group) => [group.direction, group.rows.length])).toEqual([
      ["outgoing", 6],
      ["incoming", 5],
    ]);
    const keys = groups.flatMap((group) => group.rows.map((row) => row.key));
    expect(new Set(keys).size).toBe(11);
    expect(keys).toEqual([...INTERACTION_KEYS]);
    expect(groups[1]!.title).toBe("What other agents may do to Ada");
  });

  it("is on unless the agent's own setting turns it off", () => {
    const current = state({ canMentionAgents: false, canEditOtherTasks: true });
    expect(interactionAllowed(current, "canMentionAgents")).toBe(false);
    expect(interactionAllowed(current, "canEditOtherTasks")).toBe(true);
    expect(interactionAllowed(current, "canAssignTasksToAgents")).toBe(true);
    // Before the state loads, or without an effective map, the sparse overrides decide.
    expect(interactionAllowed(undefined, "canMentionAgents")).toBe(true);
    expect(interactionAllowed({ overrides: { canMentionAgents: false } } as AgentInteractionPermissionsState, "canMentionAgents")).toBe(false);
    expect(deniedCount(current)).toBe(1);
  });

  it("counts an explicit true as the agent's own setting, which Reset removes", () => {
    const current = state({ canMentionAgents: false, canEditOtherTasks: true });
    expect(interactionOverridden(current, "canEditOtherTasks")).toBe(true);
    expect(interactionOverridden(current, "canCommentOnOtherTasks")).toBe(false);
    expect(overriddenKeys(current)).toEqual(["canMentionAgents", "canEditOtherTasks"]);
  });

  it("writes a boolean for a switch and null for a reset", () => {
    expect(switchPatch("canReceiveCommentsFromAgents", false)).toEqual({ canReceiveCommentsFromAgents: false });
    expect(switchPatch("canReceiveCommentsFromAgents", true)).toEqual({ canReceiveCommentsFromAgents: true });
    expect(resetPatch("canReceiveCommentsFromAgents")).toEqual({ canReceiveCommentsFromAgents: null });
  });

  it("resets every setting at once, and sends nothing when there's none", () => {
    expect(resetAllPatch(state({ canMentionAgents: false, canEditOtherTasks: true }))).toEqual({ canMentionAgents: null, canEditOtherTasks: null });
    expect(resetAllPatch(state({}))).toBeNull();
    expect(resetAllPatch(undefined)).toBeNull();
  });

  it("keeps interactions out of the legacy /permissions body", () => {
    const permissions = { canCreateAgents: false, trustPreset: "standard", interactions: { canMentionAgents: false } } as Partial<AgentPermissions>;
    const body = trustUpdate({ canCreateAgents: false, canCreateSkills: true, canAssignTasks: false }, permissions);
    expect(body).not.toHaveProperty("interactions");
  });
});
