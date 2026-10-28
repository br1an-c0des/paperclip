import { createQuery } from "@tanstack/solid-query";
import { RotateCcw, TriangleAlert } from "lucide-solid";
import { createSignal, onCleanup, Show } from "solid-js";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { pushToast } from "@/ui/Toast";
import { changedAgo, liveRunsLabel, restartPlan, restartReason, sampleList, worktreeBranding } from "./dev-banners-model";
import "./DevBanners.css";

/*
 * Banners for development instances, at the top of main:
 *
 * - <WorktreeBanner>: on a worktree preview instance, a strip in the worktree's colour with its name
 *   (click to copy). The server marks such instances with `paperclip-worktree-*` meta tags in the
 *   page it serves; ui-new's index.html carries the markers it fills in.
 * - <DevRestartBanner>: on `pnpm dev`, when backend files changed or migrations are pending
 *   (`devServer` in `GET /api/health`, polled every 2 seconds there, as in the old UI): what
 *   changed, whether it's waiting for runs or restarts by itself, and Restart now.
 */

const RESTART_PENDING_RESET_MS = 30_000;

export function DevBanners() {
  return (
    <>
      <WorktreeBanner />
      <DevRestartBanner />
    </>
  );
}

function WorktreeBanner() {
  const branding = worktreeBranding((name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() || null);
  const [copied, setCopied] = createSignal<"copied" | "failed" | null>(null);
  let timer: number | undefined;
  onCleanup(() => window.clearTimeout(timer));
  const copy = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setCopied(null), 1600);
  };
  return (
    <Show when={branding}>
      {(current) => (
        <div class="wt-banner" style={{ "--wt-bg": current().color, "--wt-fg": current().textColor }} role="note" aria-label="Worktree instance">
          <span class="wt-label">Worktree</span>
          <span class="wt-dot" aria-hidden="true" />
          <button type="button" class="wt-name" title="Copy the worktree's name" onClick={() => void copy(current().name)}>
            {copied() === "copied" ? "Copied" : copied() === "failed" ? "Couldn't copy" : current().name}
          </button>
        </div>
      )}
    </Show>
  );
}

function DevRestartBanner() {
  const health = createQuery(() => ({
    queryKey: queryKeys.health,
    queryFn: healthApi.get,
    retry: false,
    refetchInterval: (query) => (query.state.data?.devServer?.enabled ? 2_000 : false),
    refetchIntervalInBackground: false,
  }));
  const [confirming, setConfirming] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  let timer: number | undefined;
  onCleanup(() => window.clearTimeout(timer));
  const devServer = () => (health.data?.devServer?.enabled && health.data.devServer.restartRequired ? health.data.devServer : null);

  const restart = async () => {
    setConfirming(false);
    setPending(true);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setPending(false), RESTART_PENDING_RESET_MS);
    try {
      await healthApi.requestDevServerRestart();
    } catch (caught) {
      setPending(false);
      pushToast({ tone: "error", title: "Couldn't request a restart", body: caught instanceof Error ? caught.message : undefined });
    }
  };

  return (
    <Show when={devServer()}>
      {(server) => (
        <section class="dev-banner" role="status" aria-label="Restart required">
          <div class="dev-banner-main">
            <div class="dev-banner-title">
              <TriangleAlert size={14} aria-hidden="true" />
              Restart required
              <Show when={server().autoRestartEnabled}>
                <span class="dev-banner-chip">Auto-restart on</span>
              </Show>
            </div>
            <p class="dev-banner-text">
              {restartReason(server())}
              <Show when={changedAgo(server().lastChangedAt)}>{(ago) => <> Updated {ago()}.</>}</Show>
            </p>
            <Show when={server().changedPathsSample.length > 0 || server().pendingMigrations.length > 0}>
              <p class="dev-banner-detail mono">
                <Show when={server().changedPathsSample.length > 0}>
                  <span>Changed: {sampleList(server().changedPathsSample, server().changedPathCount)}</span>
                </Show>
                <Show when={server().pendingMigrations.length > 0}>
                  <span>Pending migrations: {sampleList(server().pendingMigrations, server().pendingMigrations.length, 2)}</span>
                </Show>
              </p>
            </Show>
          </div>
          <div class="dev-banner-actions">
            <span class="dev-banner-plan">{restartPlan(server())}</span>
            <Button size="compact" icon={<RotateCcw size={14} aria-hidden="true" />} disabled={pending()} onClick={() => setConfirming(true)}>
              {pending() ? "Restart requested" : "Restart now"}
            </Button>
          </div>
          <Dialog
            open={confirming()}
            onOpenChange={setConfirming}
            title="Restart Paperclip now?"
            description={server().activeRunCount > 0 ? `This may interrupt ${liveRunsLabel(server().activeRunCount)}.` : "Nothing is running right now."}
            width={440}
            hideClose
            footer={
              <>
                <Button ghost onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void restart()}>
                  Restart
                </Button>
              </>
            }
          />
        </section>
      )}
    </Show>
  );
}
