/*
 * A streaming reply's text, updated in place (LiveReply.tsx `LiveText`): each chunk renders the
 * whole text again, and `morphChildren` brings the page's copy up to it node by node instead of
 * replacing it, so what was already there stays the same element. That keeps a pull request
 * link's status mark (tasks/LinkPreview.tsx) mounted while the text after it grows, with its card
 * open if it was, and keeps a selection in the text that's already written.
 *
 * - Nodes are matched by position. A node of another kind, another tag, or a pull request link
 *   (`.gh-pr`) to another pull request takes the old one's place; the rest are updated.
 * - A mark's slot (`.gh-pr-mark`) holds the mark, which the page draws: it's left as it is.
 * - What the mark sets on its link (its state, its accessible name) is kept.
 */

/** Attributes the status mark sets on its link (LinkPreview.tsx `ConnectedMark`). */
const MARK_OWNED = new Set(["data-link-state", "aria-label"]);

const previewOf = (element: Element) =>
  element.classList.contains("gh-pr") ? element.querySelector<HTMLAnchorElement>("a[data-link-preview]")?.dataset.linkPreview ?? "" : null;

function same(current: Node, next: Node) {
  if (current.nodeType !== next.nodeType) return false;
  if (!(current instanceof Element) || !(next instanceof Element)) return true;
  return current.tagName === next.tagName && previewOf(current) === previewOf(next);
}

function patchAttributes(current: Element, next: Element) {
  const owned = current.hasAttribute("data-link-preview") ? MARK_OWNED : null;
  for (const name of current.getAttributeNames()) {
    if (!next.hasAttribute(name) && !owned?.has(name)) current.removeAttribute(name);
  }
  for (const name of next.getAttributeNames()) {
    if (owned?.has(name)) continue;
    const value = next.getAttribute(name)!;
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
}

function patch(current: Node, next: Node) {
  if (!(current instanceof Element) || !(next instanceof Element)) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  patchAttributes(current, next);
  if (current.classList.contains("gh-pr-mark")) return;
  morphChildren(current, next);
}

/** Brings `current`'s children up to `next`'s, keeping the nodes that match. `next` is emptied of the nodes it gives. */
export function morphChildren(current: Node, next: Node) {
  const existing = Array.from(current.childNodes);
  const incoming = Array.from(next.childNodes);
  incoming.forEach((node, index) => {
    const old = existing[index];
    if (!old) current.appendChild(node);
    else if (same(old, node)) patch(old, node);
    else current.replaceChild(node, old);
  });
  for (const extra of existing.slice(incoming.length)) extra.parentNode?.removeChild(extra);
}
