import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog } from "./Dialog";
import { Popover } from "./Popover";

afterEach(cleanup);

/** Kobalte hides the page from screen readers a frame after a modal layer opens. */
const settle = () => new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => setTimeout(resolve, 20)), 20));

function hiddenAncestor(element: Element) {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true") return node;
  }
  return null;
}

describe("Popover", () => {
  it("stays reachable by screen readers when it opens inside a dialog", async () => {
    render(() => (
      <Dialog open title="New task">
        <Popover>
          <Popover.Trigger>Start date</Popover.Trigger>
          <Popover.Content label="Pick a start date">
            <button type="button">Today</button>
          </Popover.Content>
        </Popover>
      </Dialog>
    ));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Start date" }));
    const popover = await screen.findByRole("dialog", { name: "Pick a start date" });
    await settle();

    expect(hiddenAncestor(popover)).toBeNull();
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
    // The dialog itself stays reachable too.
    expect(hiddenAncestor(screen.getByRole("dialog", { name: "New task" }))).toBeNull();
  });
});
