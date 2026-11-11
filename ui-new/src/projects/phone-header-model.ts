import type { CompanyArtifactGroup } from "@paperclipai/shared";
import { searchPath } from "@/search/search-url";
import { EMPTY_FILTERS } from "@/search/filters";
import type { CrewMember, CrewState } from "./dashboard-model";

/*
 * The phone project header's rules (design/mobile.md M1, M12, M13), kept apart from the component
 * so they can be tested: which agents sit in the header and how each is named, what the Docs view
 * counts, and where the header's search goes.
 */

/** The project views a phone shows (M1, M12, M13). Board, workload and settings stay on desktop. */
export type PhoneProjectView = "overview" | "list" | "docs" | "other";

/** How many agents the header draws before "+N". The boards draw four. */
export const HEADER_AGENTS = 4;

/** The state bar under each avatar, as on the boards: Ion running, Flare blocked, Ember paused. */
const STATE_BAR: Partial<Record<CrewState, string>> = {
  running: "var(--g-ion)",
  queued: "var(--g-ion)",
  blocked: "var(--g-flare)",
  error: "var(--g-flare)",
  paused: "var(--g-ember)",
};

const STATE_WORD: Record<CrewState, string> = {
  running: "running",
  queued: "queued",
  blocked: "blocked",
  error: "in error",
  paused: "paused",
  idle: "idle",
};

export type HeaderAgent = {
  agentId: string;
  name: string;
  /** The agent's page key (its chat on a phone, M9). */
  key: string;
  state: CrewState;
  /** The bar's gradient, or null for an idle agent. */
  bar: string | null;
  /** "Quant Researcher, running": the avatar's accessible name. */
  label: string;
  /** "Quant Researcher · Running TRA-41": the long-press title. */
  title: string;
};

type AgentInfo = { id: string; name: string; urlKey?: string | null };

function sentence(word: string) {
  return word.slice(0, 1).toUpperCase() + word.slice(1);
}

/** What the agent is doing, for the title: "Running TRA-41", "Blocked on TRA-45", "Paused". */
function doing(member: CrewMember) {
  const task = member.task?.identifier ?? null;
  if (!task) return sentence(STATE_WORD[member.state]);
  if (member.state === "running" || member.state === "queued") return `${sentence(STATE_WORD[member.state])} ${task}`;
  if (member.state === "blocked") return `Blocked on ${task}`;
  if (member.state === "idle") return `On ${task}`;
  return sentence(STATE_WORD[member.state]);
}

/**
 * The agents on the project, as the header draws them: the crew (dashboard-model's `crew`, already
 * sorted running first), the first `max`, and how many more there are.
 */
export function headerAgents(
  members: readonly CrewMember[],
  agents: readonly AgentInfo[] | undefined,
  max = HEADER_AGENTS,
): { shown: HeaderAgent[]; more: number } {
  const byId = new Map((agents ?? []).map((agent) => [agent.id, agent] as const));
  const all = members.map((member): HeaderAgent => {
    const agent = byId.get(member.agentId);
    const name = agent?.name ?? "Agent";
    return {
      agentId: member.agentId,
      name,
      key: agent?.urlKey || member.agentId,
      state: member.state,
      bar: STATE_BAR[member.state] ?? null,
      label: `${name}, ${STATE_WORD[member.state]}`,
      title: `${name} · ${doing(member)}`,
    };
  });
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/** The Docs view's numbers (M13): every doc and file from the project's tasks, and how many tasks have some. */
export function docsNumbers(groups: readonly Pick<CompanyArtifactGroup, "count">[] | undefined) {
  if (!groups) return null;
  const withFiles = groups.filter((group) => group.count > 0);
  return { items: withFiles.reduce((sum, group) => sum + group.count, 0), tasks: withFiles.length };
}

/**
 * Where the header's search goes: the Search page (M14), narrowed to the project, for tasks on the
 * overview and for documents on Docs. The list has its own search in its toolbar, so the header
 * leaves it out there (null).
 */
export function headerSearch(view: PhoneProjectView, prefix: string, projectId: string): { href: string; label: string } | null {
  if (view === "list") return null;
  const filters = { ...EMPTY_FILTERS, projectId };
  if (view === "docs") return { href: searchPath(prefix, { scope: "documents", filters }), label: "Search docs and files" };
  return { href: searchPath(prefix, { filters }), label: "Search this project" };
}

/** Which phone view a project tab is: the dashboard is Overview, the task list (and a task open in it) List. */
export function phoneView(tab: string): PhoneProjectView {
  const path = tab.replace(/\/$/, "");
  if (path === "" || path === "overview") return "overview";
  if (path === "issues" || path.startsWith("issues/")) return "list";
  if (path === "docs") return "docs";
  return "other";
}
