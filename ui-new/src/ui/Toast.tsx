import { A } from "@solidjs/router";
import { X } from "lucide-solid";
import { createSignal, For, Show, type JSX } from "solid-js";
import { Capsule } from "./Status";
import type { Gradient } from "./status-meta";
import "./Toast.css";

/*
 * Toasts: short-lived feedback in the bottom-left corner, with the old UI's rules
 * (ui/src/context/ToastContext.tsx):
 *
 * - Lifetimes by tone: info 4s, success 3.5s, warn 8s, error 10s, clamped to 1.5–15s.
 * - At most five at once, newest first.
 * - The same toast, or one with the same visible text, isn't shown twice within 3.5s.
 *
 * Which live events raise a toast is decided in lib/live-toasts.ts, after doc/TOASTS.md. Direct
 * action feedback ("Created TRA-52") calls `pushToast` itself.
 *
 * There's no board for toasts. They follow the design system: a card on --shadow-lg with the tone's
 * capsule, and one action link.
 */

export type ToastTone = "info" | "success" | "warn" | "error";

export type ToastAction = { label: string; href?: string; onClick?: () => void };

export type ToastInput = {
  id?: string;
  dedupeKey?: string;
  title: string;
  body?: string;
  tone?: ToastTone;
  ttlMs?: number;
  action?: ToastAction;
  /** Leading visual, such as the actor's avatar; defaults to the tone's capsule. */
  icon?: JSX.Element;
};

export type ToastItem = Required<Pick<ToastInput, "id" | "title" | "tone" | "ttlMs">> &
  Pick<ToastInput, "body" | "action" | "icon">;

const TTL_BY_TONE: Record<ToastTone, number> = { info: 4000, success: 3500, warn: 8000, error: 10000 };
const MIN_TTL_MS = 1500;
const MAX_TTL_MS = 15000;
const MAX_TOASTS = 5;
const DEDUPE_WINDOW_MS = 3500;
const DEDUPE_MAX_AGE_MS = 20000;

const TONE_GRADIENT: Record<ToastTone, Gradient> = { info: "ion", success: "lagoon", warn: "ember", error: "flare" };

const [toasts, setToasts] = createSignal<ToastItem[]>([]);
const timers = new Map<string, number>();
const recent = new Map<string, number>();
let nextId = 0;

export { toasts };

export function ttlFor(tone: ToastTone, ttlMs?: number) {
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs)) return TTL_BY_TONE[tone];
  return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, Math.floor(ttlMs)));
}

export function dismissToast(id: string) {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  setToasts((list) => list.filter((toast) => toast.id !== id));
}

export function clearToasts() {
  for (const handle of timers.values()) window.clearTimeout(handle);
  timers.clear();
  recent.clear();
  setToasts([]);
}

/** Shows a toast. Returns its id, or null when it was a duplicate. */
export function pushToast(input: ToastInput): string | null {
  const now = Date.now();
  const tone = input.tone ?? "info";
  const dedupeKey = input.dedupeKey ?? input.id ?? `${tone}|${input.title}|${input.body ?? ""}|${input.action?.href ?? ""}`;
  // Two distinct events can read the same; showing both looks like a duplicate.
  const contentKey = `content|${tone}|${input.title}|${input.body ?? ""}`;

  for (const [key, seen] of recent) if (now - seen > DEDUPE_MAX_AGE_MS) recent.delete(key);
  if ([dedupeKey, contentKey].some((key) => now - (recent.get(key) ?? -Infinity) < DEDUPE_WINDOW_MS)) return null;
  recent.set(dedupeKey, now);
  recent.set(contentKey, now);

  const id = input.id ?? `toast-${++nextId}`;
  const item: ToastItem = {
    id,
    title: input.title,
    body: input.body,
    tone,
    ttlMs: ttlFor(tone, input.ttlMs),
    action: input.action,
    icon: input.icon,
  };
  window.clearTimeout(timers.get(id));
  setToasts((list) => [item, ...list.filter((toast) => toast.id !== id)].slice(0, MAX_TOASTS));
  timers.set(
    id,
    window.setTimeout(() => dismissToast(id), item.ttlMs),
  );
  return id;
}

function ToastCard(props: { toast: ToastItem }) {
  const done = () => dismissToast(props.toast.id);
  return (
    <li class="toast" data-tone={props.toast.tone} role={props.toast.tone === "error" ? "alert" : "status"}>
      <span class="toast-icon">
        <Show when={props.toast.icon} fallback={<Capsule gradient={TONE_GRADIENT[props.toast.tone]} size="pill" />}>
          {props.toast.icon}
        </Show>
      </span>
      <div class="toast-text">
        <p class="toast-title">{props.toast.title}</p>
        <Show when={props.toast.body}>
          <p class="toast-body">{props.toast.body}</p>
        </Show>
        <Show when={props.toast.action}>
          {(action) => (
            <Show
              when={action().href}
              fallback={
                <button
                  type="button"
                  class="toast-action"
                  onClick={() => {
                    action().onClick?.();
                    done();
                  }}
                >
                  {action().label}
                </button>
              }
            >
              {(href) => (
                <A class="toast-action" href={href()} onClick={done}>
                  {action().label}
                </A>
              )}
            </Show>
          )}
        </Show>
      </div>
      <button type="button" class="toast-close" aria-label="Dismiss notification" onClick={done}>
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

/** The corner the toasts stack in. Mount once, inside the router. */
export function ToastViewport() {
  return (
    <section class="toasts" aria-label="Notifications" aria-live="polite">
      <ol>
        <For each={toasts()}>{(toast) => <ToastCard toast={toast} />}</For>
      </ol>
    </section>
  );
}
