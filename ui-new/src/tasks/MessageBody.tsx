import { useNavigate } from "@solidjs/router";
import { createEffect, createMemo } from "solid-js";
import { useCompany } from "@/lib/company";
import { renderMarkdown } from "@/ui/Markdown";
import { decorateMentions, taskRefFromHref } from "./composer/mentions";
import { parseGitHubLink, patchLines, type GitHubLink } from "./message-format";
import "./MessageBody.css";

/*
 * A comment's text: Markdown, with @-mentions of agents, people and projects drawn as chips and
 * task links ("TRA-41", or a link to it) opening the task in this board rather than a new tab.
 *
 * Since the 2026-11-07 sync (U68): GitHub links show what they point at, `owner/repo#12` with a pull
 * request or issue icon (upstream #19476); `diff` and `patch` code blocks colour their lines and stay
 * inside the message, scrolling sideways (#19478); and two or more images standing on their own
 * lines share a grid of thumbnails (as #19626 groups a run's image results), each opening in full in
 * a new tab as before.
 */

/*
 * The icons, as lucide draws them: git-pull-request, circle-dot, and the GitHub mark (lucide dropped
 * brand icons; ui/src/components/icons/github-icon.tsx keeps the old one). They're added to links
 * already in the page, so they're built as plain SVG rather than rendered as components.
 */
const ICON_SHAPES: Record<GitHubLink["kind"], string> = {
  pull_request: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  issue: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  repository:
    '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  github: "",
};
ICON_SHAPES.github = ICON_SHAPES.repository;

function icon(kind: GitHubLink["kind"]) {
  const holder = document.createElement("span");
  holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="gh-icon" aria-hidden="true">${ICON_SHAPES[kind]}</svg>`;
  return holder.firstElementChild!;
}

const SPOKEN: Record<GitHubLink["kind"], string> = {
  pull_request: "GitHub pull request: ",
  issue: "GitHub issue: ",
  repository: "GitHub repository: ",
  github: "GitHub: ",
};

function decorateGitHubLink(link: HTMLAnchorElement, github: GitHubLink) {
  const href = link.getAttribute("href")!;
  link.dataset.githubLink = github.kind;
  if (!link.title) link.title = `${github.description}\n${href}`;
  // A bare URL reads as its label; written link text is kept.
  if (github.label && link.textContent?.trim() === href) link.textContent = github.label;
  const spoken = document.createElement("span");
  spoken.className = "sr-only";
  spoken.textContent = SPOKEN[github.kind];
  // The icon keeps to the label's first word, so a line never breaks between them.
  const only = link.childNodes.length === 1 && link.firstChild?.nodeType === Node.TEXT_NODE ? link.textContent ?? "" : null;
  if (only) {
    const [first = "", ...rest] = only.split(/(?=\s)/);
    const lead = document.createElement("span");
    lead.className = "gh-lead";
    lead.append(icon(github.kind), first);
    link.replaceChildren(spoken, lead, rest.join(""));
  } else {
    link.prepend(spoken, icon(github.kind));
  }
}

/** Draws a `diff` or `patch` block's lines in their colours, keeping the source text as it was. */
function decoratePatch(code: HTMLElement) {
  const text = code.textContent ?? "";
  code.replaceChildren(
    ...patchLines(text).map((line) => {
      const span = document.createElement("span");
      span.className = "patch-line";
      span.dataset.patchLine = line.kind;
      span.textContent = line.text;
      return span;
    }),
  );
  code.closest("pre")?.classList.add("patch");
}

/** An element that is only images (or linked images) and line breaks. */
function imagesOnly(element: Element): HTMLElement[] | null {
  if (element.tagName !== "P") return null;
  const images: HTMLElement[] = [];
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue;
    if (!(node instanceof HTMLElement)) return null;
    if (node.tagName === "BR") continue;
    const image = node.tagName === "IMG" || (node.tagName === "A" && node.children.length === 1 && node.firstElementChild?.tagName === "IMG" && !node.textContent?.trim());
    if (!image) return null;
    images.push(node);
  }
  return images.length > 0 ? images : null;
}

/** Runs of paragraphs holding only images, two images or more, become one grid of thumbnails. */
function groupImages(root: HTMLElement) {
  let run: { paragraphs: Element[]; images: HTMLElement[] } = { paragraphs: [], images: [] };
  const flush = () => {
    if (run.images.length >= 2) {
      const grid = document.createElement("div");
      grid.className = "msg-images";
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", `${run.images.length} images`);
      run.paragraphs[0]!.before(grid);
      for (const image of run.images) {
        let cell = image;
        if (image.tagName !== "A") {
          cell = document.createElement("a");
          cell.setAttribute("href", image.getAttribute("src") ?? "");
          cell.setAttribute("target", "_blank");
          cell.setAttribute("rel", "noopener noreferrer");
          cell.title = image.getAttribute("alt") || "Open the image";
          cell.append(image);
        }
        cell.classList.add("msg-thumb");
        grid.append(cell);
      }
      for (const paragraph of run.paragraphs) paragraph.remove();
    }
    run = { paragraphs: [], images: [] };
  };
  for (const child of Array.from(root.children)) {
    const images = imagesOnly(child);
    if (!images) {
      flush();
      continue;
    }
    run.paragraphs.push(child);
    run.images.push(...images);
  }
  flush();
}

export function MessageBody(props: { source: string; class?: string }) {
  const company = useCompany();
  const navigate = useNavigate();
  const html = createMemo(() => renderMarkdown(decorateMentions(props.source, company().issuePrefix)));
  let root: HTMLDivElement | undefined;

  // Task links point at this board's task page and stay in the tab. A fragment such as
  // `#document-plan` is kept, so the page (or the chat it redirects to) can open the document.
  createEffect(() => {
    html();
    if (!root) return;
    for (const link of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const href = link.getAttribute("href");
      const ref = parseGitHubLink(href) ? null : taskRefFromHref(href);
      if (ref) {
        const hash = href!.includes("#") ? href!.slice(href!.indexOf("#")) : "";
        link.setAttribute("href", `/${company().issuePrefix}/issues/${ref}${hash}`);
        link.removeAttribute("target");
        link.classList.add("task-link");
        continue;
      }
      const github = link.dataset.githubLink || link.querySelector("img") ? null : parseGitHubLink(href);
      if (github) decorateGitHubLink(link, github);
    }
    for (const code of root.querySelectorAll<HTMLElement>("pre:not(.patch) > code.language-diff, pre:not(.patch) > code.language-patch")) decoratePatch(code);
    groupImages(root);
  });

  return (
    <div
      ref={root}
      class={props.class ? `md msg ${props.class}` : "md msg"}
      innerHTML={html()}
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest?.("a.task-link") as HTMLAnchorElement | null;
        if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(link.getAttribute("href")!);
      }}
    />
  );
}
