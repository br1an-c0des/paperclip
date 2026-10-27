import { matchOffsets } from "./find-model";

/*
 * Find in run, in the drawn view: every match of the search in the view's text, highlighted with
 * the CSS Custom Highlight API (no re-render, nothing added to the DOM), and the current one opened
 * (inside a closed tool call or thinking block) and scrolled into the middle of the view. Without the
 * highlight API the current match is still scrolled to and selected.
 *
 * A match has to sit inside one text node, so a phrase split by formatting (half bold) isn't found.
 */

const ALL = "run-find";
const CURRENT = "run-find-current";

/** The ranges of every match of `query` under `root`, in document order. */
export function findRanges(root: Node, query: string): Range[] {
  const ranges: Range[] = [];
  if (!query.trim()) return ranges;
  const length = query.trim().length;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest("[aria-hidden='true'], button, script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const offset of matchOffsets(node.textContent ?? "", query)) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + length);
      ranges.push(range);
    }
  }
  return ranges;
}

type HighlightRegistry = { set: (name: string, highlight: unknown) => void; delete: (name: string) => void };

function registry(): { highlights: HighlightRegistry; Highlight: new (...ranges: Range[]) => unknown } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  return css?.highlights && Highlight ? { highlights: css.highlights, Highlight } : null;
}

/** Marks every match, and the current one more strongly. */
export function paintMatches(ranges: readonly Range[], current: number) {
  const api = registry();
  if (!api) return;
  api.highlights.set(ALL, new api.Highlight(...ranges));
  const focused = ranges[current];
  if (focused) api.highlights.set(CURRENT, new api.Highlight(focused));
  else api.highlights.delete(CURRENT);
}

export function clearMatches() {
  const api = registry();
  api?.highlights.delete(ALL);
  api?.highlights.delete(CURRENT);
}

/** Opens the closed details around a match and scrolls it into the middle of the view. */
export function revealMatch(range: Range) {
  const element = range.startContainer.parentElement;
  if (!element) return;
  for (let details = element.closest("details"); details; details = details.parentElement?.closest("details") ?? null) {
    if (!details.open) details.open = true;
  }
  element.scrollIntoView?.({ block: "center" });
  if (!registry()) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}
