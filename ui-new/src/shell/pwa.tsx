import { ExternalLink, RefreshCw, Share2 } from "lucide-solid";
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { isCompact } from "@/layout/breakpoints";
import { theme } from "@/lib/theme";
import { buttonClass } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { removeServiceWorkers, startServiceWorkerUpdates } from "./service-worker-updates";
import "./pwa.css";

/*
 * The installable app (decision 39, D11): the browser chrome's colour, the service worker, and on a
 * phone running from the home screen (no address bar), Refresh, Share and Open in browser, after
 * ui/src/components/StandaloneBrowserControls.tsx and ui/src/lib/pwa-display-mode.ts. The manifest
 * and icons are in ui-new/public/, the worker in public/sw.js.
 */

/** `--ground` in each theme, which the browser's bar and the home-screen splash take. */
export const THEME_COLORS = { dark: "#0a0a0a", light: "#f2f2f4" } as const;

/** Keeps `<meta name="theme-color">` on the drawn theme. */
export function useThemeColor() {
  createEffect(() => {
    const color = THEME_COLORS[theme()];
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", color));
  });
}

/** Production builds register the worker once the page has loaded; development removes any. */
export function useServiceWorker() {
  onMount(() => {
    if (!import.meta.env.PROD) return removeServiceWorkers();
    let stop = () => {};
    const start = () => {
      stop = startServiceWorkerUpdates();
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    onCleanup(() => {
      window.removeEventListener("load", start);
      stop();
    });
  });
}

export const CHROMELESS_DISPLAY_MODES = ["standalone", "fullscreen", "window-controls-overlay"] as const;

type MatchMedia = (query: string) => Pick<MediaQueryList, "matches">;

/** Whether the app runs without the browser's own controls: installed to the home screen. */
export function isChromelessDisplayMode(
  matchMedia: MatchMedia | undefined = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : undefined,
  iosStandalone: boolean | undefined = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { standalone?: boolean }).standalone,
) {
  if (iosStandalone === true) return true;
  if (!matchMedia) return false;
  return CHROMELESS_DISPLAY_MODES.some((mode) => matchMedia(`(display-mode: ${mode})`).matches);
}

function useChromeless() {
  const [chromeless, setChromeless] = createSignal(isChromelessDisplayMode());
  onMount(() => {
    if (typeof window.matchMedia !== "function") return;
    const update = () => setChromeless(isChromelessDisplayMode());
    const queries = CHROMELESS_DISPLAY_MODES.map((mode) => window.matchMedia(`(display-mode: ${mode})`));
    queries.forEach((query) => query.addEventListener?.("change", update));
    onCleanup(() => queries.forEach((query) => query.removeEventListener?.("change", update)));
  });
  return chromeless;
}

/**
 * The row at the top of a phone screen: `lead` on the left (the detail pages' Back), and, running
 * as the installed app, Refresh, Share (the share sheet, or copy the link) and Open in browser on
 * the right, which the missing address bar would otherwise offer. Nothing when there's neither.
 */
export function PhoneTopBar(props: { lead?: JSX.Element; showLead?: boolean }) {
  const chromeless = useChromeless();
  return (
    <Show when={isCompact() && (props.showLead || chromeless())}>
      <div class="phone-top">
        <Show when={props.showLead}>{props.lead}</Show>
        <StandaloneControls chromeless={chromeless()} />
      </div>
    </Show>
  );
}

function StandaloneControls(props: { chromeless: boolean }) {
  const chromeless = () => props.chromeless;
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title || "Paperclip", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      pushToast({ tone: "success", title: "Link copied" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      pushToast({ tone: "error", title: "Couldn't share the link", body: "Try opening the page in your browser." });
    }
  };
  return (
    <Show when={chromeless()}>
      <div class="pwa-bar" role="toolbar" aria-label="Page">
        <button type="button" class={buttonClass({ variant: "icon", size: "compact", ghost: true })} aria-label="Refresh" onClick={() => window.location.reload()}>
          <RefreshCw size={16} aria-hidden="true" />
        </button>
        <button type="button" class={buttonClass({ variant: "icon", size: "compact", ghost: true })} aria-label="Share" onClick={() => void share()}>
          <Share2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class={buttonClass({ variant: "icon", size: "compact", ghost: true })}
          aria-label="Open in browser"
          onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink size={16} aria-hidden="true" />
        </button>
      </div>
    </Show>
  );
}
