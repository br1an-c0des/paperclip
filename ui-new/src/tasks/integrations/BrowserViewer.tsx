import type { BrowserUseControl, BrowserUseViewportPreset, BrowserUseViewportRequest, BrowserUseViewportState, TaskBrowser } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Globe } from "lucide-solid";
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { browserUseApi } from "@/api/browser-use";
import { queryKeys } from "@/api/queryKeys";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useNow } from "@/lib/clock";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { browserHeadline, costText, currentBrowser, idleCountdown, isViewable, paneSize, SIZE_OPTIONS } from "./integrations-model";

/*
 * Browsers an agent opened for the task (Browser Use): a row while one is open, with Watch, which
 * opens a live view of it. The view's address is short-lived and carries a token, so it's fetched
 * when the view opens, renewed every 15 seconds, and never stored. In the view:
 *
 * - Size: Fit (the remote window follows this pane) or a preset (phone, tablet, laptop, desktop).
 *   When someone else's view sets the size, Take control claims it for this one.
 * - Keep open (an idle browser closes after ten minutes; watching an idle one keeps it open too),
 *   Stop the agent's browsing, and End the browser.
 *
 * Not here: following the pane while it's being resized (Fit measures when the view loads and
 * when you pick it) and the old panel's automatic reconnect after a stalled load.
 */

const BROWSERS_KEY = (taskId: string) => queryKeys.issues.section(taskId, "browsers");

export function TaskBrowsers(props: { taskId: string }) {
  const browsers = createQuery(() => ({
    queryKey: BROWSERS_KEY(props.taskId),
    queryFn: ({ signal }) => browserUseApi.list(props.taskId, signal),
    // Quick while one is open; a slower look otherwise, since an agent may open one at any time.
    refetchInterval: (query) => (currentBrowser(query.state.data) ? 3000 : 15000),
    retry: false,
  }));
  const browser = () => currentBrowser(browsers.data);
  return <Show when={browser()}>{(current) => <BrowserRow taskId={props.taskId} browser={current()} />}</Show>;
}

function useBrowserControl(taskId: string, browser: () => TaskBrowser) {
  const client = useQueryClient();
  return createMutation(() => ({
    mutationFn: (action: BrowserUseControl) => browserUseApi.control(taskId, browser().id, action),
    onSuccess: (_result, action) => {
      void client.invalidateQueries({ queryKey: BROWSERS_KEY(taskId) });
      if (action === "keep_open") pushToast({ tone: "success", title: "The browser stays open" });
    },
    onError: () => pushToast({ tone: "error", title: "The browser action failed", body: "Try again." }),
  }));
}

function BrowserRow(props: { taskId: string; browser: TaskBrowser }) {
  const [open, setOpen] = createSignal(false);
  const now = useNow(() => props.browser.status === "idle");
  const meta = () =>
    [props.browser.progress, idleCountdown(props.browser, now()), costText(props.browser.costCents)].filter(Boolean).join(" · ");
  return (
    <div class="tn ti">
      <section class="tn-row" data-tone={props.browser.error ? "amber" : "neutral"} aria-label="Browser">
        <span class="tn-icon" aria-hidden="true">
          <Globe size={16} />
        </span>
        <span class="tn-text">
          <b>{browserHeadline(props.browser)}</b>
          <Show when={props.browser.error ?? meta()}>
            <span class="ti-meta">{props.browser.error ?? meta()}</span>
          </Show>
        </span>
        <span class="tn-action">
          <Button size="compact" disabled={!isViewable(props.browser)} onClick={() => setOpen(true)}>
            Watch
          </Button>
        </span>
      </section>
      <Dialog open={open()} onOpenChange={setOpen} title="Live browser" width={1300} class="ti-viewer-dialog">
        <Show when={open()}>
          <BrowserView taskId={props.taskId} browser={props.browser} now={now()} />
        </Show>
      </Dialog>
    </div>
  );
}

export function BrowserView(props: { taskId: string; browser: TaskBrowser; now: number }) {
  const viewerId = crypto.randomUUID();
  const control = useBrowserControl(props.taskId, () => props.browser);
  const [size, setSize] = createSignal<BrowserUseViewportState>({ preset: "fit" });
  const [loaded, setLoaded] = createSignal(false);
  const [sizeError, setSizeError] = createSignal<string | null>(null);
  const [ending, setEnding] = createSignal(false);
  const [presenceFailed, setPresenceFailed] = createSignal(false);
  let pane: HTMLDivElement | undefined;

  const viewer = createQuery(() => ({
    queryKey: [...BROWSERS_KEY(props.taskId), props.browser.id, "viewer", viewerId],
    queryFn: ({ signal }) => browserUseApi.viewer(props.taskId, props.browser.id, viewerId, signal),
    enabled: isViewable(props.browser),
    refetchInterval: 15000,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  }));
  createEffect(on(() => viewer.data?.url, () => setLoaded(false)));
  createEffect(
    on(
      () => viewer.data,
      (data) => data && setSize(data.viewportState ?? { preset: data.viewport ?? "fit" }),
      { defer: true },
    ),
  );

  const resize = createMutation(() => ({
    mutationFn: (request: BrowserUseViewportRequest) => browserUseApi.resize(props.taskId, props.browser.id, request),
    onSuccess: (state) => {
      setSize(state);
      setSizeError(null);
    },
    onError: () => setSizeError("Couldn't change the browser's size. Pick a size to try again."),
  }));
  const fit = (takeControl = false) => {
    const rect = pane?.getBoundingClientRect();
    const measured = rect ? paneSize(rect.width, rect.height) : null;
    if (measured) resize.mutate({ preset: "fit", ...measured, viewerId, ...(takeControl ? { takeControl: true } : {}) });
  };
  const pick = (preset: BrowserUseViewportPreset) => (preset === "fit" ? fit(true) : resize.mutate({ preset, viewerId }));

  // An idle browser stays open while someone watches it.
  const renewPresence = () => {
    if (props.browser.status !== "idle" || document.visibilityState === "hidden") return;
    browserUseApi.presence(props.taskId, props.browser.id).then(
      () => setPresenceFailed(false),
      () => setPresenceFailed(true),
    );
  };
  const timer = setInterval(renewPresence, 30_000);
  renewPresence();
  onCleanup(() => {
    clearInterval(timer);
    void browserUseApi.releaseViewport(props.taskId, props.browser.id, viewerId).catch(() => undefined);
  });

  return (
    <div class="ti-viewer">
      <div class="ti-viewer-pane" ref={pane}>
        <Show
          when={isViewable(props.browser) && viewer.data?.url}
          fallback={
            <p class="ti-viewer-state" role={viewer.isError ? "alert" : "status"}>
              {viewer.isError ? "The live view disconnected." : isViewable(props.browser) ? "Connecting to the browser…" : browserHeadline(props.browser)}
            </p>
          }
        >
          {(url) => (
            <iframe
              title="Live browser"
              src={url()}
              referrerPolicy="no-referrer"
              allow="autoplay; clipboard-write"
              onLoad={() => {
                if (!loaded() && size().preset === "fit" && !size().controlledElsewhere) fit();
                setLoaded(true);
              }}
            />
          )}
        </Show>
      </div>
      <Show when={size().controlledElsewhere}>
        <p class="ti-note" data-tone="warn" role="status">
          Someone else's view sets this browser's size.{" "}
          <Button size="compact" disabled={resize.isPending} onClick={() => fit(true)}>
            Take control
          </Button>
        </p>
      </Show>
      <Show when={sizeError() ?? (presenceFailed() ? "Couldn't keep this browser open. Check your connection before it closes." : null)}>
        {(message) => (
          <p class="ti-note" data-tone="error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <div class="ti-viewer-bar">
        <Segmented label="Browser size" options={SIZE_OPTIONS} value={size().preset === "default" ? "fit" : size().preset} onChange={pick} />
        <span class="ti-meta">
          {[idleCountdown(props.browser, props.now), costText(props.browser.costCents)].filter(Boolean).join(" · ")}
        </span>
        <span class="ti-viewer-actions">
          <Show when={props.browser.status === "idle"}>
            <Button size="compact" disabled={control.isPending} onClick={() => control.mutate("keep_open")}>
              Keep open
            </Button>
          </Show>
          <Show when={props.browser.status === "running"}>
            <Button size="compact" disabled={control.isPending} onClick={() => control.mutate("cancel")}>
              Stop
            </Button>
          </Show>
          <Button size="compact" variant="danger" disabled={control.isPending} onClick={() => setEnding(true)}>
            End browser
          </Button>
        </span>
      </div>
      <ConfirmDialog
        open={ending()}
        onOpenChange={setEnding}
        title="End this browser?"
        body="The browser closes and its session ends. The agent can open a new one if it needs to."
        confirmLabel="End browser"
        danger
        onConfirm={() => control.mutateAsync("end")}
      />
    </div>
  );
}
