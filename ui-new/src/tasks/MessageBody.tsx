import { useNavigate } from "@solidjs/router";
import { createEffect, createMemo } from "solid-js";
import { useCompany } from "@/lib/company";
import { renderMarkdown } from "@/ui/Markdown";
import { decorateMentions, taskRefFromHref } from "./composer/mentions";
import "./MessageBody.css";

/*
 * A comment's text: Markdown, with @-mentions of agents, people and projects drawn as chips and
 * task links ("TRA-41", or a link to it) opening the task in this board rather than a new tab.
 */

export function MessageBody(props: { source: string; class?: string }) {
  const company = useCompany();
  const navigate = useNavigate();
  const html = createMemo(() => renderMarkdown(decorateMentions(props.source, company().issuePrefix)));
  let root: HTMLDivElement | undefined;

  // Task links point at this board's task page and stay in the tab. A fragment such as
  // `#document-plan` is kept, so the page (or the chat it redirects to) can open the document.
  createEffect(() => {
    html();
    for (const link of root?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []) {
      const href = link.getAttribute("href");
      const ref = taskRefFromHref(href);
      if (!ref) continue;
      const hash = href!.includes("#") ? href!.slice(href!.indexOf("#")) : "";
      link.setAttribute("href", `/${company().issuePrefix}/issues/${ref}${hash}`);
      link.removeAttribute("target");
      link.classList.add("task-link");
    }
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
