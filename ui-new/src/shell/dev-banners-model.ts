import type { DevServerHealthStatus } from "@/api/health";

/*
 * What the development banners say (ui/src/components/DevRestartBanner.tsx, WorktreeBanner.tsx,
 * lib/worktree-branding.ts). Pure, for tests.
 */

export function restartReason(devServer: Pick<DevServerHealthStatus, "reason">): string {
  if (devServer.reason === "backend_changes_and_pending_migrations") return "Backend files changed and migrations are pending.";
  if (devServer.reason === "pending_migrations") return "Pending migrations need a fresh start.";
  return "Backend files changed since this server started.";
}

/** "just now", "5m ago", "2h ago", "3d ago", or null for a missing or bad time. */
export function changedAgo(value: string | null, now = Date.now()): string | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  if (Number.isNaN(at)) return null;
  const ms = now - at;
  if (ms < 60_000) return "just now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "a, b, c +4 more": the first few of a list, and how many weren't named. */
export function sampleList(items: readonly string[], total: number, shown = 3): string {
  const sample = items.slice(0, shown);
  const rest = Math.max(total, items.length) - sample.length;
  return rest > 0 ? `${sample.join(", ")} +${rest} more` : sample.join(", ");
}

export function liveRunsLabel(count: number) {
  return `${count} live run${count === 1 ? "" : "s"}`;
}

/** What the restart state line says: waiting for runs, auto-restart, or how to restart by hand. */
export function restartPlan(devServer: Pick<DevServerHealthStatus, "waitingForIdle" | "autoRestartEnabled" | "activeRunCount">): string {
  if (devServer.waitingForIdle) return `Waiting for ${liveRunsLabel(devServer.activeRunCount)} to finish.`;
  if (devServer.autoRestartEnabled) return "It restarts by itself once nothing is running.";
  return "Restart it once the running work is safe to interrupt.";
}

// ---------------------------------------------------------------------------------------------
// Worktree branding: the server marks a worktree preview instance with meta tags.

export type WorktreeBranding = { name: string; color: string; textColor: string };

export function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) return `#${[...hex].map((char) => char + char).join("").toLowerCase()}`;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  return null;
}

/** Dark or light text, whichever reads better on the colour. */
export function readableTextColor(background: string): string {
  const hex = normalizeHexColor(background) ?? "#000000";
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#f8fafc" : "#111827";
}

/** The branding from `<meta name="paperclip-worktree-*">`, or null outside a worktree preview. */
export function worktreeBranding(read: (name: string) => string | null): WorktreeBranding | null {
  if (read("paperclip-worktree-enabled") !== "true") return null;
  const name = read("paperclip-worktree-name")?.trim();
  const color = normalizeHexColor(read("paperclip-worktree-color"));
  if (!name || !color) return null;
  return { name, color, textColor: normalizeHexColor(read("paperclip-worktree-text-color")) ?? readableTextColor(color) };
}
