import type { Agent, Project } from "@paperclipai/shared";
import { useLocation } from "@solidjs/router";
import { createMemo } from "solid-js";
import { activeAgents } from "@/api/agents";
import { openProjects } from "@/api/projects";
import { useAgentStars } from "@/agents/AgentStar";
import { starredAgents } from "@/agents/star-model";
import { openChatAgentKey } from "@/chat/chat-model";
import { useUnreadChats } from "@/chat/chat-read";
import { agentState, runningAgentIds, sortAgentsForNav } from "@/lib/agent-state";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useLiveRunsQuery, useProjectsQuery } from "@/lib/company-data";
import { useProjectOrder, useProjectStars } from "./nav-prefs";
import { visibleProjects } from "./nav-model";

/*
 * The nav's projects and agents, as both the full nav (Nav.tsx) and the rail's flyouts (NavRail.tsx)
 * list them: projects you haven't left, in your order, with the starred ones apart; agents with the
 * running ones first, the starred ones apart; which agents run now; and the unread chat counts.
 *
 * Rows are keyed by id, not by the object. Every refetch of a list (a page that reads it mounting
 * after 30 seconds, the window regaining focus, a live event, a reload's saved list being replaced)
 * brings new objects, since solid-query keeps no structural sharing; keyed by object, <For> rebuilt
 * every row: each project's plugin items mounted again as new React roots, showing until their
 * plugin's config hid them, and an agent's open "…" menu closed. A row now stays mounted while its
 * project or agent is listed, follows the latest object for its id (`latestProject`,
 * `latestAgent`), and moves when the order changes (running agents go first).
 */

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => id === b[index]);
const idsOf = (list: () => readonly { id: string }[]) => createMemo(() => list().map((item) => item.id), [], { equals: sameIds });
// The latest object for an id; the last one stays while a refetch that dropped it removes the row.
const latest = <T,>(byId: () => ReadonlyMap<string, T>, id: string) => createMemo<T | undefined>((last) => byId().get(id) ?? last);

export function useNavLists() {
  const company = useCompany();
  const location = useLocation();
  const projects = useProjectsQuery();
  const agents = useAgentsQuery();
  const liveRuns = useLiveRunsQuery();
  const stars = useAgentStars();
  const projectStars = useProjectStars();
  const projectOrder = useProjectOrder();

  const running = createMemo(() => runningAgentIds(liveRuns.data));
  const agentsById = createMemo(() => new Map(activeAgents(agents.data).map((agent) => [agent.id, agent] as const)));
  const starred = createMemo(() => starredAgents(stars.memberships.data, [...agentsById().values()]));
  const starredIds = createMemo(() => new Set(starred().map((agent) => agent.id)));
  const navAgents = createMemo(() => sortAgentsForNav([...agentsById().values()], running()));
  const otherAgents = createMemo(() => navAgents().filter((agent) => !starredIds().has(agent.id)));
  const runningCount = () => navAgents().filter((agent) => agentState(agent, running()).key === "running").length;
  const openChatAgentId = createMemo(() => {
    const key = openChatAgentKey(location.pathname, company().issuePrefix);
    return key ? (navAgents().find((agent) => agent.urlKey === key || agent.id === key)?.id ?? null) : null;
  });
  const unreadChats = useUnreadChats(openChatAgentId);

  // Projects you haven't left, in your order; starred ones move up to Starred.
  const projectsById = createMemo(() => new Map(openProjects(projects.data).map((project) => [project.id, project] as const)));
  const shownProjects = createMemo(() => projectOrder.ordered(visibleProjects([...projectsById().values()], projectStars.memberships.data)));
  const starredProjects = createMemo(() => (projectStars.memberships.data?.starredProjectIds ?? []).flatMap((id) => projectsById().get(id) ?? []));
  const otherProjects = createMemo(() => shownProjects().filter((project) => !projectStars.starred(project.id)));
  // Project rows wait for your order and your memberships (stars, projects you left), so they're
  // drawn once as you arranged them instead of shuffling as each read lands. A reload has all three
  // at once from the saved reads (lib/offline/persisted-cache.ts); a read that fails doesn't hold them.
  const projectsArranged = () => projectOrder.settled() && !projectStars.memberships.isLoading;

  return {
    running,
    runningCount,
    navAgents,
    starredAgents: starred,
    otherAgents,
    starredAgentIds: idsOf(starred),
    otherAgentIds: idsOf(otherAgents),
    unreadChats,
    shownProjects,
    starredProjects,
    otherProjects,
    starredProjectIds: idsOf(starredProjects),
    otherProjectIds: idsOf(otherProjects),
    projectsArranged,
    projectOrder,
    /** The latest project for a row's id (call once per row, inside it). */
    latestProject: (id: string) => latest<Project>(projectsById, id),
    /** The latest agent for a row's id (call once per row, inside it). */
    latestAgent: (id: string) => latest<Agent>(agentsById, id),
  };
}
