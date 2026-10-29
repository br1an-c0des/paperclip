import type { ServerInfoSnapshot } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { Clock3, FileDiff, GitCommit } from "lucide-solid";
import { For, Show } from "solid-js";
import { healthApi, type HealthStatus } from "@/api/health";
import { queryKeys } from "@/api/queryKeys";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { Menu } from "@/ui/Menu";
import { serverInfoRows } from "./server-info-model";

/*
 * The server's details in the You menu, when `enableServerInfoDebugView` is on (after
 * ui/src/components/SidebarServerInfo.tsx): when it last restarted, the commit it runs, and whether
 * its checkout has local changes, from `GET /api/health`'s `serverInfo`. It mounts only while the
 * menu is open, so it reads health afresh each time, and every 2s on a development server, which
 * restarts on its own.
 */

type Health = HealthStatus & { serverInfo?: ServerInfoSnapshot };

const ICONS = { restarted: Clock3, commit: GitCommit, checkout: FileDiff };

export function ServerInfo() {
  const settings = useExperimentalSettingsQuery();
  const enabled = () => settings.data?.enableServerInfoDebugView === true;
  const health = createQuery(() => ({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get() as Promise<Health>,
    enabled: enabled(),
    refetchOnMount: "always" as const,
    refetchInterval: (query: { state: { data?: Health } }) => (query.state.data?.devServer?.enabled ? 2000 : false),
  }));
  const rows = () => serverInfoRows(health.data as Health | undefined, { loading: health.isPending, failed: health.isError });
  return (
    <Show when={enabled()}>
      <Menu.Separator />
      <div class="mh">Server</div>
      <div class="nav-server">
        <For each={rows()}>
          {(row) => {
            const Icon = ICONS[row.key];
            return (
              <div class="nav-server-row">
                <Icon size={15} aria-hidden="true" />
                <span>
                  <b>{row.label}</b>
                  <Show when={row.dateTime} fallback={<small>{row.value}</small>}>
                    {(at) => (
                      <small>
                        <time dateTime={at()}>{row.value}</time>
                      </small>
                    )}
                  </Show>
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
