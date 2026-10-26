import DOMPurify from "dompurify";
import { marked } from "marked";
import { createMemo } from "solid-js";
import "./Markdown.css";

/*
 * Markdown from tasks, comments and documents, rendered with `marked` (GitHub-flavoured) and
 * sanitized with DOMPurify before it reaches the page. Links leave in a new tab.
 */

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(source: string) {
  const html = marked.parse(source, { gfm: true, breaks: false, async: false });
  return DOMPurify.sanitize(html);
}

export function Markdown(props: { source: string; class?: string }) {
  const html = createMemo(() => renderMarkdown(props.source));
  return <div class={props.class ? `md ${props.class}` : "md"} innerHTML={html()} />;
}
