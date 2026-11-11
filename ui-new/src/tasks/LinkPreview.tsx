import { recognizeLinkPreview, type LinkPreviewResult, type LinkPreviewState, type LinkPreviewTarget } from "@paperclipai/shared";
import { createQuery, QueryClientContext } from "@tanstack/solid-query";
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, TriangleAlert, type LucideProps } from "lucide-solid";
import { createEffect, createSignal, For, onCleanup, onMount, Show, useContext, type JSX } from "solid-js";
import { Dynamic, Portal } from "solid-js/web";
import { linkPreviewsApi } from "@/api/link-previews";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import { Popover } from "@/ui/Popover";
import { LINK_PREVIEW_STATE_LABEL, parseGitHubLink, previewLinkLabel, previewMarkLabel, previewMeta } from "./message-format";
import "./LinkPreview.css";

/*
 * A GitHub pull request link's status mark and card (U113, since the 2026-11-10 sync, upstream
 * #20593 and #20654, after the old UI's LinkPreview.tsx and MarkdownUrlLink.tsx). MessageBody puts
 * the mark just before the link, in place of U68's pull request icon:
 *
 * - The mark is the pull request icon until the state is known, then that state's icon and colour:
 *   open green, merged violet, merge conflicts amber, draft and closed muted.
 * - The card shows the link, its state, title, author, last update and address. It opens after a
 *   moment's hover on the link or the mark, on keyboard focus of the link, and on a click or tap
 *   of the mark, so a touch screen reaches it too; on a phone it's a bottom sheet (Popover).
 * - The preview is read only then, once per link, viewer and company: every copy of the link reads
 *   the same cached answer (`queryKeys.linkPreview`) for as long as its `maxAgeMs`. A failed read
 *   counts as no preview for a minute rather than an error.
 *
 * Without a query client (tests of other screens) the mark is the plain icon.
 *
 * Which links get a mark, and the slot it's drawn into, are here too (`decoratePreviewLinks`,
 * `PreviewMarks`), so a finished message (MessageBody.tsx) and a reply still streaming
 * (chat/LiveReply.tsx `LiveText`) treat pull request links alike.
 */

const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 150;
const ABSENT_MAX_AGE_MS = 60_000;

const STATE_ICON: Record<LinkPreviewState, (props: LucideProps) => JSX.Element> = {
  unknown: GitPullRequest,
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
  conflicts: TriangleAlert,
};

/** A pull request link that gets a status mark: GitHub's pull request page, as upstream recognizes it. */
export function previewTargetFor(href: string | null | undefined): LinkPreviewTarget | null {
  return parseGitHubLink(href)?.kind === "pull_request" ? recognizeLinkPreview(href) : null;
}

/** A pull request link with its status mark's slot, just before it. */
export type PreviewLink = { anchor: HTMLAnchorElement; slot: HTMLElement; target: LinkPreviewTarget };

/**
 * Wraps a pull request link with a slot for its status mark, and returns it. The wrapper keeps the
 * mark on the label's first line; the label itself can still wrap. A bare URL reads as its label.
 */
export function decoratePreviewLink(link: HTMLAnchorElement, target: LinkPreviewTarget): PreviewLink {
  const href = link.getAttribute("href")!;
  link.dataset.githubLink = "pull_request";
  link.dataset.linkPreview = target.canonicalUrl;
  // No native tooltip: the card says what the link is, and the tooltip would cover it.
  if (link.textContent?.trim() === href) link.textContent = target.label;
  const spoken = document.createElement("span");
  spoken.className = "sr-only";
  spoken.textContent = "GitHub pull request: ";
  link.prepend(spoken);
  const wrapper = document.createElement("span");
  wrapper.className = "gh-pr";
  const slot = document.createElement("span");
  slot.className = "gh-pr-mark";
  link.replaceWith(wrapper);
  wrapper.append(slot, link);
  return { anchor: link, slot, target };
}

/** Decorates every pull request link under `root` not decorated yet (links around images stay as they are). */
export function decoratePreviewLinks(root: ParentNode): PreviewLink[] {
  const found: PreviewLink[] = [];
  for (const link of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (link.dataset.githubLink || link.querySelector("img")) continue;
    const target = previewTargetFor(link.getAttribute("href"));
    if (target) found.push(decoratePreviewLink(link, target));
  }
  return found;
}

/** The marks, each drawn into its link's slot. Keyed by entry: a link kept from one render to the next keeps its mark. */
export function PreviewMarks(props: { links: PreviewLink[] }) {
  return (
    <For each={props.links}>
      {(entry) => (
        <Portal mount={entry.slot} ref={(container) => (container.style.display = "contents")}>
          <LinkPreviewMark anchor={entry.anchor} target={entry.target} />
        </Portal>
      )}
    </For>
  );
}

/** Whose preview this is: the signed-in user, or `local-board` without sign-in, as the saved reads name them (persisted-cache.ts). */
function viewerId(): () => string | null {
  try {
    return useSession().youId;
  } catch {
    return () => null;
  }
}

export function LinkPreviewMark(props: { anchor: HTMLAnchorElement; target: LinkPreviewTarget }) {
  return (
    <Show when={useContext(QueryClientContext)} fallback={<GitPullRequest size={13} class="gh-icon" aria-hidden="true" />}>
      <ConnectedMark anchor={props.anchor} target={props.target} />
    </Show>
  );
}

function ConnectedMark(props: { anchor: HTMLAnchorElement; target: LinkPreviewTarget }) {
  const company = useCompany();
  const userId = viewerId();
  const [open, setOpen] = createSignal(false);
  const [byHover, setByHover] = createSignal(false);
  let timer: number | undefined;
  let pressed = false;
  const clear = () => window.clearTimeout(timer);
  onCleanup(clear);

  const preview = createQuery(() => ({
    queryKey: queryKeys.linkPreview(company().id, userId(), props.target.canonicalUrl),
    queryFn: async ({ signal }): Promise<LinkPreviewResult> => {
      try {
        return await linkPreviewsApi.get(company().id, props.target.canonicalUrl, signal);
      } catch {
        // Optional detail: a failed read is a cached absence, not an error on the page.
        return { preview: null, maxAgeMs: ABSENT_MAX_AGE_MS };
      }
    },
    // Read only while someone's looking at the card; the mark shows what's cached either way.
    enabled: open(),
    staleTime: (query) => query.state.data?.maxAgeMs ?? ABSENT_MAX_AGE_MS,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }));
  const found = () => preview.data?.preview ?? null;
  const state = (): LinkPreviewState => found()?.state ?? "unknown";

  // The link itself says the state too, for screen readers and for styling.
  createEffect(() => {
    props.anchor.dataset.linkState = state();
    const label = previewLinkLabel(props.target, found());
    if (label) props.anchor.setAttribute("aria-label", label);
    else props.anchor.removeAttribute("aria-label");
  });

  const openSoon = () => {
    clear();
    if (open()) return;
    timer = window.setTimeout(() => {
      setByHover(true);
      setOpen(true);
    }, HOVER_OPEN_MS);
  };
  const closeSoon = () => {
    clear();
    if (byHover()) timer = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };
  const hoverIn = (event: PointerEvent) => event.pointerType === "mouse" && openSoon();
  const hoverOut = (event: PointerEvent) => event.pointerType === "mouse" && closeSoon();
  const focusVisible = () => {
    try {
      return props.anchor.matches(":focus-visible");
    } catch {
      return true;
    }
  };
  const focusIn = () => {
    if (!focusVisible() || open()) return;
    clear();
    setByHover(true);
    setOpen(true);
  };
  const focusOut = () => {
    clear();
    if (byHover()) setOpen(false);
  };
  onMount(() => {
    const link = props.anchor;
    link.addEventListener("pointerenter", hoverIn);
    link.addEventListener("pointerleave", hoverOut);
    link.addEventListener("focus", focusIn);
    link.addEventListener("blur", focusOut);
    onCleanup(() => {
      link.removeEventListener("pointerenter", hoverIn);
      link.removeEventListener("pointerleave", hoverOut);
      link.removeEventListener("focus", focusIn);
      link.removeEventListener("blur", focusOut);
    });
  });

  const changed = (next: boolean) => {
    clear();
    // A click on a mark whose card hovered open keeps it open, now as if clicked.
    if (!next && pressed && byHover()) {
      pressed = false;
      setByHover(false);
      return;
    }
    pressed = false;
    if (!next) setByHover(false);
    setOpen(next);
  };

  return (
    <Popover open={open()} onOpenChange={changed}>
      <Popover.Trigger
        class="lp-mark"
        data-state={state()}
        aria-label={previewMarkLabel(props.target, state())}
        onPointerDown={() => (pressed = true)}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
      >
        <Dynamic component={STATE_ICON[state()]} size={13} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Content
        label={`Pull request ${props.target.label}`}
        width={320}
        hideClose={byHover()}
        class="lp-popover"
        onOpenAutoFocus={(event) => byHover() && event.preventDefault()}
      >
        <div class="lp-card" data-state={state()} onPointerEnter={(event) => event.pointerType === "mouse" && clear()} onPointerLeave={hoverOut}>
          <div class="lp-head">
            <Dynamic component={STATE_ICON[state()]} size={15} class="lp-icon" aria-hidden="true" />
            <span class="mono lp-label">{props.target.label}</span>
            <Show when={found()}>
              <span class="lp-state">{LINK_PREVIEW_STATE_LABEL[state()]}</span>
            </Show>
          </div>
          <Show
            when={found()}
            fallback={
              <p class="lp-note" role="status">
                {preview.data ? "No details from GitHub for this pull request." : "Loading pull request…"}
              </p>
            }
          >
            {(details) => (
              <>
                <p class="lp-title">{details().title}</p>
                <Show when={previewMeta(details())}>{(meta) => <p class="lp-meta">{meta()}</p>}</Show>
              </>
            )}
          </Show>
          <a class="mono lp-url" href={props.target.canonicalUrl} target="_blank" rel="noopener noreferrer">
            {props.target.canonicalUrl}
          </a>
        </div>
      </Popover.Content>
    </Popover>
  );
}
