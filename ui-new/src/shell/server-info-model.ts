import type { ServerInfoSnapshot } from "@paperclipai/shared";
import type { HealthStatus } from "@/api/health";

/*
 * What the You menu's server details say (ui/src/components/SidebarServerInfo.tsx), kept apart so
 * it can be tested: a development server's last restart, else the process's start; the commit as
 * "short sha · subject"; and the checkout's state.
 */

export type ServerInfoRow = { key: "restarted" | "commit" | "checkout"; label: string; value: string; dateTime?: string };

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function checkoutLabel(info: ServerInfoSnapshot | undefined) {
  const git = info?.git;
  if (!git?.available) return "Unavailable";
  const changes = git.localChanges;
  if (!changes?.available) return "Change status unavailable";
  if (!changes.hasLocalChanges) return "Clean checkout";
  const parts = (
    [
      [changes.stagedFileCount, "staged"],
      [changes.unstagedFileCount, "unstaged"],
      [changes.untrackedFileCount, "untracked"],
    ] as const
  )
    .filter(([count]) => Number(count) > 0)
    .map(([count, label]) => `${count} ${label}`);
  return parts.length > 0 ? `Local changes (${parts.join(", ")})` : "Local changes";
}

export function serverInfoRows(health: (HealthStatus & { serverInfo?: ServerInfoSnapshot }) | undefined, state: { loading: boolean; failed: boolean }): ServerInfoRow[] {
  const placeholder = state.failed ? "Health unavailable" : state.loading && !health ? "Loading…" : null;
  const restartedAt = health?.devServer?.lastRestartAt ?? health?.serverInfo?.processStartedAt ?? null;
  const validAt = !!restartedAt && !Number.isNaN(new Date(restartedAt).getTime());
  const git = health?.serverInfo?.git;
  return [
    { key: "restarted", label: "Last restarted", value: placeholder ?? formatTimestamp(restartedAt), dateTime: !placeholder && validAt ? restartedAt! : undefined },
    { key: "commit", label: "Running commit", value: placeholder ?? (git?.available ? `${git.shortSha} · ${git.subject}` : "Commit unavailable") },
    { key: "checkout", label: "Checkout state", value: placeholder ?? checkoutLabel(health?.serverInfo) },
  ];
}
