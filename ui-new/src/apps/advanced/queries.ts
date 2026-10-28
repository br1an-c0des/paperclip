import { createQueries, createQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { routinesApi } from "@/api/routines";
import { toolAccessApi } from "@/api/tool-access";
import { toolsApi } from "@/api/tools";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useProjectsQuery } from "@/lib/company-data";
import { useApplications, useConnections } from "../shared";
import { groupCatalogByApp, type Names } from "./profile-model";

/*
 * The queries the gateway, profile and agent-tools pages share. Everything sits under
 * `["tools", companyId]`, so tool activity refreshes it (live-events.tsx). Gateway changes aren't
 * logged as activity, so those pages refresh their own list after each change.
 */

export function useProfiles() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.tools.profiles(company().id),
    queryFn: ({ signal }) => toolsApi.profiles(company().id, signal),
  }));
}

export function usePolicies() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.tools.policies(company().id),
    queryFn: ({ signal }) => toolsApi.policies(company().id, signal),
  }));
}

export function useGateways() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.tools.gateways(company().id),
    queryFn: ({ signal }) => toolAccessApi.gateways(company().id, signal),
  }));
}

export function useRoutines() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.routines.list(company().id),
    queryFn: ({ signal }) => routinesApi.list(company().id, {}, signal),
  }));
}

/**
 * The company's whole catalog. No request returns it, so it's read connection by connection, as the
 * old UI does; each connection's catalog shares the key its page uses.
 */
export function useCompanyCatalog() {
  const company = useCompany();
  const connections = useConnections();
  const applications = useApplications();
  const live = createMemo(() => (connections.data?.connections ?? []).filter((connection) => connection.status !== "archived"));
  const catalogs = createQueries(() => ({
    queries: live().map((connection) => ({
      queryKey: queryKeys.tools.connectionPart(company().id, connection.id, "catalog"),
      queryFn: ({ signal }: { signal: AbortSignal }) => toolsApi.catalog(connection.id, signal),
      staleTime: 60_000,
    })),
  }));
  const catalog = createMemo(() => catalogs.flatMap((query) => query.data?.catalog ?? []).filter((tool) => tool.status === "active"));
  const applicationNames = createMemo(() => new Map((applications.data?.applications ?? []).map((application) => [application.id, application.name])));
  const connectionNames = createMemo(() => new Map(live().map((connection) => [connection.id, connection.name])));
  const groups = createMemo(() => groupCatalogByApp(catalog(), applicationNames(), connectionNames()));
  // Right after the connections arrive, the catalog queries for them aren't there yet.
  const loading = () =>
    connections.isPending || applications.isPending || catalogs.length < live().length || catalogs.some((query) => query.isPending);
  return { connections, applications, live, catalog, groups, applicationNames, loading };
}

/** Agent, project and recurring-task names, for assignments. */
export function useTargetNames() {
  const agents = useAgentsQuery();
  const projects = useProjectsQuery();
  const routines = useRoutines();
  const gateways = useGateways();
  const names = createMemo<Names>(() => ({
    agents: new Map((agents.data ?? []).map((agent) => [agent.id, agent.name])),
    projects: new Map((projects.data ?? []).map((project) => [project.id, project.name])),
    routines: new Map((routines.data ?? []).map((routine) => [routine.id, routine.title])),
    gateways: new Map((gateways.data?.gateways ?? []).map((gateway) => [gateway.id, gateway.name])),
  }));
  return { agents, projects, routines, names };
}
