import { Upload } from "lucide-solid";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";

/*
 * Files dropped anywhere on the screen go to the composer that's showing (#18849, after
 * ui/src/components/task-chat/ComposerFileDropTarget.tsx), so a file needn't be aimed at the text
 * box. A full-screen overlay says where it's going.
 *
 * - The last composer to mount wins: the run modal's over the task's. While a dialog is open, only
 *   a composer inside it takes drops (the new-task dialog over a task page); hidden ones never do.
 * - Drop areas of their own come first: one that handles the drag itself (the task's Docs and files
 *   section), a document editor, or anything marked `data-file-drop-target`.
 * - Text and link drags are left alone.
 */

const EXPLICIT = "[data-file-drop-target], .cm-editor";
const UNAVAILABLE = '[inert], [hidden], [aria-hidden="true"]';
const DIALOGS = '[data-layer="dialog"], [aria-modal="true"], [role="alertdialog"]';

type Target = { element: () => HTMLElement | undefined; reset: () => void };
const targets: Target[] = [];

function usable(element: Element) {
  return element.isConnected && !element.closest(UNAVAILABLE) && element.getClientRects().length > 0;
}

/** The composer that takes a drop now, if any. */
function activeTarget() {
  const dialog = Array.from(document.querySelectorAll(DIALOGS))
    .filter((found) => !found.closest(UNAVAILABLE))
    .at(-1);
  return targets.findLast((target) => {
    const element = target.element();
    return !!element && usable(element) && (!dialog || dialog.contains(element));
  });
}

const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
const onExplicit = (event: DragEvent) => event.target instanceof Element && !!event.target.closest(EXPLICIT);

/**
 * Registers a composer as a screen-wide drop target. `element` is the composer's root; `enabled`
 * false still claims the drop (so the browser doesn't open the file) but takes nothing. Returns
 * whether a file drag is over the screen for this composer.
 */
export function createFileDropTarget(options: { element: () => HTMLElement | undefined; enabled: () => boolean; onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = createSignal(false);
  let depth = 0;
  const reset = () => {
    depth = 0;
    setDragging(false);
  };
  const target: Target = { element: options.element, reset };
  const owns = (event: DragEvent) => carriesFiles(event) && activeTarget() === target && !event.defaultPrevented && !onExplicit(event);

  // Bubble phase, so a drop area that handles the drag itself has had its turn (defaultPrevented).
  const enter = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    depth += 1;
    if (owns(event)) event.preventDefault();
  };
  const over = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    if (!owns(event)) return setDragging(false);
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = options.enabled() ? "copy" : "none";
    setDragging(options.enabled());
  };
  const leave = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0 || !event.relatedTarget) reset();
  };
  const drop = (event: DragEvent) => {
    const owned = owns(event);
    reset();
    if (!owned) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (options.enabled() && files.length) options.onFiles(files);
  };

  onMount(() => {
    targets.forEach((other) => other.reset());
    targets.push(target);
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
  });
  onCleanup(() => {
    const at = targets.indexOf(target);
    if (at >= 0) targets.splice(at, 1);
    document.removeEventListener("dragenter", enter);
    document.removeEventListener("dragover", over);
    document.removeEventListener("dragleave", leave);
    document.removeEventListener("drop", drop);
    window.removeEventListener("dragend", reset);
    window.removeEventListener("blur", reset);
  });

  return dragging;
}

/** The full-screen "Drop files to attach" overlay. It lets events through to what's under it. */
export function FileDropOverlay(props: { show: boolean; newTask?: boolean }) {
  return (
    <Show when={props.show}>
      <Portal>
        <div class="cmp-drop-overlay" role="status">
          <div class="cmp-drop-frame">
            <Upload size={36} aria-hidden="true" />
            <p class="disp">Drop files to attach</p>
            <p class="cmp-drop-note">{props.newTask ? "They're added to your new task" : "They're added to your message"}</p>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
