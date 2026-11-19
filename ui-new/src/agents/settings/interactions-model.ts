import type { AgentInteractionPermissionKey, AgentInteractionPermissionsPatch, AgentInteractionPermissionsState } from "@paperclipai/shared";

/*
 * The agent's interaction switches (U105, upstream #20411 and #20422,
 * doc/agent-interaction-permissions.md): seven deny-only restrictions on what an agent may do to
 * other agents and their work, and what other agents may do to it. Each is allowed until someone
 * turns it off, and nothing is stored for a switch left alone. `GET` and
 * `PATCH /agents/:id/interaction-permissions` read and set them: a switch writes `true` or
 * `false` for itself, and Reset writes `null`, which removes the setting so the default applies.
 * The old UI has no screen for them; this card follows the Trust card's switches.
 *
 * Since step 4a four of the six outgoing switches are access actions instead (the Access card,
 * AccessCard.tsx): assigning to agents and to people is `tasks:assign`, editing other tasks
 * `tasks:update_any`, configuring other agents `agents:configure`. The server no longer reads,
 * reports or accepts them (`RETIRED_AGENT_INTERACTION_PERMISSION_KEYS` in the shared package).
 *
 * They live under `permissions.interactions` but only this route changes them: the agent and
 * `/permissions` routes answer 422 to a body that carries them, and the Trust card's
 * `trustUpdate` body names its fields one by one, so it never does.
 */

export type InteractionRow = { key: AgentInteractionPermissionKey; label: string; help: string };
export type InteractionGroup = { direction: "outgoing" | "incoming"; title: string; rows: InteractionRow[] };

/** Every switch's words. A `Record` over the shared key type, so a new key fails the typecheck here. */
const WORDS: Record<AgentInteractionPermissionKey, { label: string; help: string }> = {
  canMentionAgents: { label: "Mention agents", help: "Link another agent in a comment or a task. A name in plain text isn't a mention." },
  canCommentOnOtherTasks: { label: "Comment on other tasks", help: "Comment on tasks another agent or a person owns." },
  canReceiveAssignmentsFromAgents: { label: "Take assignments from agents", help: "Other agents may assign or hand off work to it." },
  canReceiveMentionsFromAgents: { label: "Be mentioned by agents", help: "Other agents may mention it in comments and tasks." },
  canReceiveCommentsFromAgents: { label: "Take comments from agents", help: "Other agents may comment on its tasks and send it messages." },
  canReceiveTaskEditsFromAgents: { label: "Have its tasks edited by agents", help: "Other agents may change the tasks it owns." },
  canReceiveConfigurationChangesFromAgents: {
    label: "Be configured by agents",
    help: "Other agents may change its instructions, settings, skills or tools.",
  },
};

const OUTGOING: AgentInteractionPermissionKey[] = ["canMentionAgents", "canCommentOnOtherTasks"];

const INCOMING: AgentInteractionPermissionKey[] = [
  "canReceiveAssignmentsFromAgents",
  "canReceiveMentionsFromAgents",
  "canReceiveCommentsFromAgents",
  "canReceiveTaskEditsFromAgents",
  "canReceiveConfigurationChangesFromAgents",
];

/** Every key the card lists, in its order. */
export const INTERACTION_KEYS: readonly AgentInteractionPermissionKey[] = [...OUTGOING, ...INCOMING];

const row = (key: AgentInteractionPermissionKey): InteractionRow => ({ key, ...WORDS[key] });

/** The card's two groups: what the agent may do, then what other agents may do to it. */
export function interactionGroups(name: string): InteractionGroup[] {
  return [
    { direction: "outgoing", title: `What ${name} may do`, rows: OUTGOING.map(row) },
    { direction: "incoming", title: `What other agents may do to ${name}`, rows: INCOMING.map(row) },
  ];
}

type State = Pick<AgentInteractionPermissionsState, "overrides" | "effective">;

/** Whether the switch is on: the server's resolved value, or allowed unless it's set to false. */
export function interactionAllowed(state: State | undefined, key: AgentInteractionPermissionKey) {
  return state?.effective?.[key] ?? state?.overrides?.[key] !== false;
}

/** Whether this agent has its own setting for the switch, which Reset removes. */
export function interactionOverridden(state: State | undefined, key: AgentInteractionPermissionKey) {
  return typeof state?.overrides?.[key] === "boolean";
}

/** The switches this agent has its own setting for. */
export function overriddenKeys(state: State | undefined) {
  return INTERACTION_KEYS.filter((key) => interactionOverridden(state, key));
}

/** The body for turning one switch on or off. */
export function switchPatch(key: AgentInteractionPermissionKey, allowed: boolean): AgentInteractionPermissionsPatch {
  return { [key]: allowed };
}

/** The body for resetting one switch to its default. */
export function resetPatch(key: AgentInteractionPermissionKey): AgentInteractionPermissionsPatch {
  return { [key]: null };
}

/** The body for resetting every switch the agent has a setting for, or null when there's none (the server refuses an empty body). */
export function resetAllPatch(state: State | undefined): AgentInteractionPermissionsPatch | null {
  const keys = overriddenKeys(state);
  return keys.length ? Object.fromEntries(keys.map((key) => [key, null])) : null;
}

/** How many switches are off, for the card's summary. */
export function deniedCount(state: State | undefined) {
  return INTERACTION_KEYS.filter((key) => !interactionAllowed(state, key)).length;
}
