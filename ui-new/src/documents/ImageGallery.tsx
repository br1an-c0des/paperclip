import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-solid";
import { Show } from "solid-js";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { imageLabel, stepImage, type GalleryImage } from "./gallery-model";
import "./ImageGallery.css";

/*
 * A document's images, one at a time (gallery-model.ts): the image at its own size up to the
 * window's, its description, Previous and Next (and ← →) that wrap round, and a link to the file.
 * The dialog keeps focus inside, closes on Escape, and gives focus back to the image it opened from.
 * `position` is 1-based; null closes it.
 */

export function ImageGallery(props: { images: readonly GalleryImage[]; position: number | null; onPosition: (position: number | null) => void }) {
  const count = () => props.images.length;
  const current = () => (props.position ? props.images[props.position - 1] : undefined);
  const go = (by: 1 | -1) => {
    const next = props.position ? stepImage(props.position, by, count()) : null;
    if (next) props.onPosition(next);
  };
  return (
    <Dialog
      open={!!current()}
      onOpenChange={(open) => !open && props.onPosition(null)}
      title={props.position ? `Image ${props.position} of ${count()}` : "Image"}
      width={1100}
      class="ig"
    >
      <Show when={current()}>
        {(image) => (
          <div
            class="ig-body"
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              go(event.key === "ArrowRight" ? 1 : -1);
            }}
          >
            <figure class="ig-figure">
              <img src={image().src} alt={image().alt || imageLabel(props.position!, count())} />
              <Show when={image().alt}>
                <figcaption>{image().alt}</figcaption>
              </Show>
            </figure>
            <div class="ig-bar">
              <Show when={count() > 1}>
                <Button size="compact" icon={<ChevronLeft size={14} aria-hidden="true" />} onClick={() => go(-1)}>
                  Previous
                </Button>
                <span class="ig-count" aria-live="polite">
                  {props.position} / {count()}
                </span>
                <Button size="compact" onClick={() => go(1)}>
                  Next
                  <ChevronRight size={14} aria-hidden="true" />
                </Button>
              </Show>
              <a class="btn btn--quiet btn--compact ig-open" href={image().src} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} aria-hidden="true" />
                Open image
              </a>
            </div>
          </div>
        )}
      </Show>
    </Dialog>
  );
}
