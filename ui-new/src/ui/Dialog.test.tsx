import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { Dialog } from "./Dialog";

function Harness() {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog open={open()} onOpenChange={setOpen} title="New task">
        <input aria-label="Title" />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  // In jsdom Kobalte returns focus to the opener by itself, so this checks the outcome; it doesn't
  // reproduce the browser case `restoreFocus` in Dialog.tsx exists for.
  it("returns focus to the opener when a controlled dialog closes", async () => {
    render(() => <Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("New task");

    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});
