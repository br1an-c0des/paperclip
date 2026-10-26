import { createQuery } from "@tanstack/solid-query";
import { accessApi } from "@/api/access";
import { agentsApi } from "@/api/agents";
import { goalsApi } from "@/api/goals";
import { heartbeatsApi } from "@/api/heartbeats";
import { instanceSettingsApi } from "@/api/instance-settings";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { sidebarBadgesApi } from "@/api/sidebar-badges";
import { useCompany } from "./company";

/*
 * Queries the shell shares: the nav, the command palette and the new-task dialog all read the same
 * cached lists, and the live-events socket keeps them fresh (live-events.tsx). Each hook must be
 * called inside a company route.
 */

export function useAgentsQuery() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.agents.list(company().id),
    queryFn: () => agentsApi.list(company().id),
  }));
}

export function useProjectsQuery() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.projects.list(company().id),
    queryFn: () => projectsApi.list(company().id),
  }));
}

export function useLiveRunsQuery() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.liveRuns(company().id),
    queryFn: () => heartbeatsApi.liveRuns(company().id),
  }));
}

export function useSidebarBadgesQuery() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.sidebarBadges(company().id),
    queryFn: () => sidebarBadgesApi.get(company().id),
  }));
}

export function useLabelsQuery() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.issues.labels(company().id),
    queryFn: () => issuesApi.listLabels(company().id),
  }));
}

export function useGoalsQuery(enabled: () => boolean = () => true) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.goals.list(company().id),
    queryFn: () => goalsApi.list(company().id),
    enabled: enabled(),
  }));
}

export function usePeopleQuery() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.access.userDirectory(company().id),
    queryFn: () => accessApi.userDirectory(company().id),
  }));
}

/** The instance's experimental settings; ui-new follows only the server-enforced ones. */
export function useExperimentalSettingsQuery() {
  return createQuery(() => ({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: instanceSettingsApi.experimental,
    staleTime: 60_000,
  }));
}
