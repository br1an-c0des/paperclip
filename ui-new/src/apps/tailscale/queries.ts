import { createQuery } from "@tanstack/solid-query";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/api/queryKeys";
import { tailscaleApi } from "@/api/tailscale";
import { useCompany } from "@/lib/company";
import { canManageTailscale } from "./tailscale-model";

/** Whether you may manage Tailscale networks: instance admins, and local implicit board access. */
export function useTailscaleAccess() {
  const access = createQuery(() => ({ queryKey: queryKeys.access.currentBoardAccess, queryFn: accessApi.currentBoardAccess, staleTime: 30_000 }));
  return { access, canManage: () => canManageTailscale(access.data) };
}

/** The company's tailnets, loaded only for people who may manage them (the server refuses the rest). */
export function useTailscaleConnections(when: () => boolean = () => true) {
  const company = useCompany();
  const { access, canManage } = useTailscaleAccess();
  const connections = createQuery(() => ({
    queryKey: queryKeys.tailscale.connections(company().id),
    queryFn: ({ signal }) => tailscaleApi.list(company().id, signal),
    enabled: canManage() && when(),
    staleTime: 30_000,
    retry: false,
  }));
  return { access, canManage, connections };
}
