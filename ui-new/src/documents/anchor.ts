import type { DocumentAnnotationAnchorSelector } from "@paperclipai/shared";
import {
  createDocumentAnchorSelector,
  normalizeAnchorText,
  projectMarkdownToText,
  resolveProjectionRange,
} from "@paperclipai/shared/document-anchors";

/*
 * Turning a text selection in the rendered document into the anchor an annotation thread stores.
 * The helpers come from `@paperclipai/shared/document-anchors` at runtime, like ClipLab
 * (decision 9): the server re-anchors threads with the same code when a document changes, so the
 * two must agree.
 */

export type SelectionAnchor = { selector: DocumentAnnotationAnchorSelector; selectedText: string };

/**
 * The anchor for a passage selected in the rendered document. The rendered text and the Markdown
 * source differ (formatting, list markers), so the selection is matched against the Markdown's text
 * projection; when it occurs more than once, the occurrence at the same relative position wins.
 *
 * `renderedText` is the container's whole text and `renderedStart` where the selection begins in it.
 */
export function anchorForSelection(input: {
  markdown: string;
  renderedText: string;
  renderedStart: number;
  selectedText: string;
}): SelectionAnchor | null {
  const projection = projectMarkdownToText(input.markdown);
  const needle = normalizeAnchorText(input.selectedText);
  if (!needle) return null;
  const occurrences: number[] = [];
  for (let at = projection.text.indexOf(needle); at !== -1; at = projection.text.indexOf(needle, at + 1)) occurrences.push(at);
  if (occurrences.length === 0) return null;
  const ratio = input.renderedStart / Math.max(1, normalizeAnchorText(input.renderedText).length);
  const expected = Math.round(ratio * Math.max(1, projection.text.length));
  const start = occurrences.reduce((best, at) => (Math.abs(at - expected) < Math.abs(best - expected) ? at : best));
  const range = resolveProjectionRange(projection, start, start + needle.length);
  if (!range || normalizeAnchorText(range.text) !== needle) return null;
  return { selector: createDocumentAnchorSelector(projection, range), selectedText: range.text };
}

