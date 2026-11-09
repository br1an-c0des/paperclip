import type { Company } from "@paperclipai/shared";
import { useNavigate } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { createMemo } from "solid-js";
import "./Markdown.css";

/*
 * Markdown from tasks, comments and documents, rendered with `marked` (GitHub-flavoured) and
 * sanitized with DOMPurify before it reaches the page. Links leave in a new tab.
 *
 * Since the 2026-11-09 sync (U86, upstream #19986): agents sometimes write a company link as
 * `//PAP/issues/PAP-1`, which a browser reads as a link to a host named `PAP`. When that "host" is
 * exactly a known company prefix, the link becomes the company path `/PAP/issues/PAP-1` and opens in
 * this board, through the router; every other link stays as written.
 */

/** Marks a link that stays in the app; clicks on it go through the router. */
export const APP_LINK_ATTRIBUTE = "data-app-link";

/**
 * `//PAP/...` as the company path `/PAP/...` when `PAP` is a known company prefix, keeping its
 * query and fragment; any other href unchanged. After the old UI's companyPathFromProtocolRelativeHref.
 */
export function companyPathFromProtocolRelativeHref(href: string, knownPrefixes: readonly string[] | undefined): string {
  if (!href || !knownPrefixes?.length) return href;
  const match = /^\/\/([^/?#]+)((?:[/?#].*)?)$/.exec(href.trim());
  if (!match || !knownPrefixes.includes(match[1]!)) return href;
  return `/${match[1]}${match[2] || ""}`;
}

// The prefixes of the render in progress; DOMPurify's hooks are global and sanitizing is synchronous.
let renderingPrefixes: readonly string[] | undefined;

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName !== "A") return;
  const href = node.getAttribute("href");
  if (!href) return;
  const inApp = companyPathFromProtocolRelativeHref(href, renderingPrefixes);
  if (inApp !== href) {
    node.setAttribute("href", inApp);
    node.setAttribute(APP_LINK_ATTRIBUTE, "");
    node.removeAttribute("target");
    node.removeAttribute("rel");
    return;
  }
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
});

export function renderMarkdown(source: string, options: { knownPrefixes?: readonly string[] } = {}) {
  const html = marked.parse(source, { gfm: true, breaks: false, async: false });
  renderingPrefixes = options.knownPrefixes;
  try {
    return DOMPurify.sanitize(html);
  } finally {
    renderingPrefixes = undefined;
  }
}

/**
 * The company prefixes this person can open: those of the companies list the company layout loads
 * (`companies.list`), and the page's company when the caller holds it. Without a query client (a
 * test), only what's passed. It reads the cache rather than subscribing: the list is loaded before
 * any company page renders.
 */
export function useKnownPrefixes(company?: () => Pick<Company, "issuePrefix">): () => string[] {
  let client: ReturnType<typeof useQueryClient> | null = null;
  try {
    client = useQueryClient();
  } catch {
    client = null;
  }
  return () => {
    const prefixes = new Set<string>();
    const current = company?.()?.issuePrefix;
    if (current) prefixes.add(current);
    // queryKeys.companies.list(userId) is ["companies", "list", userId].
    for (const [, companies] of client?.getQueriesData<Company[]>({ queryKey: ["companies", "list"] }) ?? []) {
      for (const each of Array.isArray(companies) ? companies : []) if (each?.issuePrefix) prefixes.add(each.issuePrefix);
    }
    return [...prefixes];
  };
}

/** The router's navigate, or null outside a router (the link then loads as a page, still in the app). */
export function useOptionalNavigate(): ((href: string) => void) | null {
  try {
    return useNavigate();
  } catch {
    return null;
  }
}

/**
 * Follows a click on an in-app link in rendered Markdown through the router, leaving modified
 * clicks (new tab, new window) to the browser. Returns whether it handled the click.
 */
export function followAppLink(event: MouseEvent, navigate: ((href: string) => void) | null, selector = `a[${APP_LINK_ATTRIBUTE}]`) {
  if (!navigate || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return false;
  const link = (event.target as HTMLElement | null)?.closest?.(selector) as HTMLAnchorElement | null;
  const href = link?.getAttribute("href");
  if (!href) return false;
  event.preventDefault();
  navigate(href);
  return true;
}

export function Markdown(props: { source: string; class?: string }) {
  const prefixes = useKnownPrefixes();
  const navigate = useOptionalNavigate();
  const html = createMemo(() => renderMarkdown(props.source, { knownPrefixes: prefixes() }));
  return <div class={props.class ? `md ${props.class}` : "md"} innerHTML={html()} onClick={(event) => followAppLink(event, navigate)} />;
}
