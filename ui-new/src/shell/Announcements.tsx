import type { Announcement, AnnouncementAction } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { ArrowUpRight, X } from "lucide-solid";
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { announcementsApi } from "@/api/announcements";
import { useCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import { buttonClass } from "@/ui/Button";
import { pushToast, toasts } from "@/ui/Toast";
import { actionHref, readDismissals, saveDismissal, showableAnnouncement } from "./announcement-model";
import "./Announcements.css";

/*
 * Paperclip's announcement card (ui/src/components/AnnouncementWell.tsx and AnnouncementCard.tsx):
 * one card at the bottom left of main (above the dock on a phone) with an eyebrow, a title, a short
 * description, an optional image, a main action and maybe a second link. Following either, or ×,
 * or Escape, dismisses it.
 *
 * As in the old UI: it's asked for when the board opens and when the tab comes back, and shows only
 * after a 3-second settle; it stays hidden while a dialog or a toast is up; it hides at its expiry.
 * Dismissing saves in this browser first (shared with the old UI), then tells the server, retrying
 * later when that fails. The old card's animation (a sandboxed HTML file) isn't shown; its still
 * image is.
 */

const SETTLE_MS = 3_000;
const MODAL_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';

export function Announcements() {
  const session = useSession();
  const company = useCompany();
  const [shown, setShown] = createSignal<Announcement | null>(null);
  const [modalOpen, setModalOpen] = createSignal(false);
  const [imageFailed, setImageFailed] = createSignal(false);
  let dismissImpl: (id: string) => void = () => setShown(null);

  createEffect(
    on(
      () => session.youId(),
      (userId) => {
        setShown(null);
        if (!userId) return;
        let disposed = false;
        let generation = 0;
        let controller: AbortController | null = null;
        let settle: number | undefined;
        let expiry: number | undefined;
        let warned = false;

        const sync = async (id: string) => {
          try {
            await announcementsApi.dismiss(id, company().id);
            if (!disposed) saveDismissal(userId, id, false);
          } catch {
            if (!disposed && !warned) {
              warned = true;
              pushToast({ tone: "info", title: "Dismissed in this browser", body: "Couldn't save it for your other devices. It'll try again later." });
            }
          }
        };
        const flush = () => {
          for (const [id, pending] of readDismissals(userId)) if (pending) void sync(id);
        };
        const suspend = () => {
          generation++;
          window.clearTimeout(settle);
          window.clearTimeout(expiry);
          controller?.abort();
          controller = null;
          setShown(null);
        };
        const resume = () => {
          if (disposed || document.visibilityState === "hidden") return;
          suspend();
          const current = generation;
          const request = new AbortController();
          controller = request;
          let settled = false;
          let candidate: Announcement | null | undefined;
          const show = () => {
            if (disposed || current !== generation || !settled || candidate === undefined) return;
            if (!candidate || readDismissals(userId).has(candidate.id)) return;
            setImageFailed(false);
            setShown(candidate);
            if (candidate.expiresAt) {
              const remaining = Date.parse(candidate.expiresAt) - Date.now();
              expiry = window.setTimeout(() => setShown(null), Math.min(Math.max(remaining, 0), 2_147_483_647));
            }
          };
          settle = window.setTimeout(() => {
            settled = true;
            show();
          }, SETTLE_MS);
          flush();
          announcementsApi
            .current(request.signal)
            .then((payload) => {
              candidate = showableAnnouncement(payload);
              show();
            })
            .catch(() => {
              // Optional: with no answer there's simply no card.
            });
        };
        const onVisibility = () => (document.visibilityState === "hidden" ? suspend() : resume());
        // Dismissed in another tab.
        const onStorage = () => {
          const current = shown();
          if (current && readDismissals(userId).has(current.id)) setShown(null);
        };
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("online", flush);
        window.addEventListener("storage", onStorage);
        resume();

        dismissImpl = (id: string) => {
          saveDismissal(userId, id, true);
          generation++;
          controller?.abort();
          setShown(null);
          void sync(id);
        };
        onCleanup(() => {
          disposed = true;
          suspend();
          document.removeEventListener("visibilitychange", onVisibility);
          window.removeEventListener("online", flush);
          window.removeEventListener("storage", onStorage);
          dismissImpl = () => setShown(null);
        });
      },
    ),
  );

  // Dialogs (the command palette, sheets, plugin overlays) cover it; it waits for them to close.
  createEffect(() => {
    if (!shown()) return;
    const scan = () => setModalOpen(Boolean(document.querySelector(MODAL_SELECTOR)));
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "aria-modal", "open"] });
    onCleanup(() => observer.disconnect());
  });

  return (
    <Show when={!modalOpen() && toasts().length === 0 && shown()} keyed>
      {(announcement) => {
        const dismiss = () => dismissImpl(announcement.id);
        const titleId = `announcement-${announcement.id}`;
        return (
          <aside class="ann-well" aria-label="Paperclip announcements">
            <section
              class="card ann-card"
              aria-labelledby={titleId}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                dismiss();
              }}
            >
              <Show when={announcement.image && !imageFailed()}>
                <img
                  class="ann-image"
                  src={announcementsApi.imageUrl(announcement.id)}
                  alt={announcement.image!.alt}
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                />
              </Show>
              <button type="button" class={`${buttonClass({ variant: "icon", size: "compact" })} ann-close`} aria-label="Dismiss announcement" onClick={dismiss}>
                <X size={15} aria-hidden="true" />
              </button>
              <div class="ann-body">
                <span class="ann-eyebrow">{announcement.eyebrow}</span>
                <h2 class="disp ann-title" id={titleId}>
                  {announcement.title}
                </h2>
                <p class="ann-text">{announcement.description}</p>
              </div>
              <div class="ann-actions">
                <Show when={announcement.secondaryLink}>{(link) => <Action action={link()} prefix={company().issuePrefix} onFollow={dismiss} />}</Show>
                <Action action={announcement.primaryAction} prefix={company().issuePrefix} onFollow={dismiss} primary />
              </div>
            </section>
          </aside>
        );
      }}
    </Show>
  );
}

function Action(props: { action: AnnouncementAction; prefix: string; onFollow: () => void; primary?: boolean }) {
  const cls = () => `${buttonClass({ variant: props.primary ? "primary" : "quiet", size: "compact" })} ${props.primary ? "ann-primary" : ""}`;
  const onAux = (event: MouseEvent) => event.button === 1 && props.onFollow();
  return (
    <Show
      when={props.action.kind === "external"}
      fallback={
        <A class={cls()} href={actionHref(props.action, props.prefix)} onClick={() => props.onFollow()} onAuxClick={onAux}>
          {props.action.label}
        </A>
      }
    >
      <a class={cls()} href={actionHref(props.action, props.prefix)} target="_blank" rel="noopener noreferrer" onClick={() => props.onFollow()} onAuxClick={onAux}>
        {props.action.label}
        <Show when={!props.primary}>
          <ArrowUpRight size={13} aria-hidden="true" />
        </Show>
      </a>
    </Show>
  );
}
