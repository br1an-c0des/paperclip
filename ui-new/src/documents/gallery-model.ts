/*
 * A document's image gallery (`documents-artifacts/documents`, since the 2026-11-01 sync, upstream
 * cd5f93055): the images the rendered document shows, in reading order, repeated ones and those
 * written as references included, each opened in a gallery with Previous and Next that wrap round.
 * Positions are 1-based, as the old UI writes them in links (`#document-report&image=2`).
 */

export type GalleryImage = { src: string; alt: string };

/** The images under `root`, in the order they're read. Images without a source are left out. */
export function documentImages(root: ParentNode): { element: HTMLImageElement; image: GalleryImage }[] {
  return [...root.querySelectorAll("img")].flatMap((element) => {
    const src = element.currentSrc || element.getAttribute("src") || "";
    return src ? [{ element, image: { src, alt: element.getAttribute("alt")?.trim() ?? "" } }] : [];
  });
}

/** The position after a step of `by` from `position` (1-based), wrapping round at either end. */
export function stepImage(position: number, by: 1 | -1, count: number) {
  if (count <= 0) return null;
  return ((((position - 1 + by) % count) + count) % count) + 1;
}

/** A position from a link, or null when it's past the images there are. */
export function clampImage(position: number | null | undefined, count: number) {
  return position && Number.isInteger(position) && position >= 1 && position <= count ? position : null;
}

/** "Image 2 of 5", with the image's description when it has one. */
export function imageLabel(position: number, count: number, alt = "") {
  return `Image ${position} of ${count}${alt ? `: ${alt}` : ""}`;
}
