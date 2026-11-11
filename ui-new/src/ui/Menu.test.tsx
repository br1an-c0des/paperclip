import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

// A phone-sized viewport, where a menu is a bottom sheet; flipped per test.
const compact = vi.hoisted(() => ({ value: true }));
vi.mock("@/layout/breakpoints", async (original) => ({
  ...(await original<typeof import("@/layout/breakpoints")>()),
  isCompact: () => compact.value,
}));

const { Menu } = await import("./Menu");

afterEach(() => {
  cleanup();
  compact.value = true;
});

function mount(onDelete: () => void) {
  render(() => (
    <Menu>
      <Menu.Trigger>More actions</Menu.Trigger>
      <Menu.Content label="Environment actions">
        <Menu.Item onSelect={onDelete}>Delete…</Menu.Item>
      </Menu.Content>
    </Menu>
  ));
}

/** A mouse press on the trigger opens the menu; its release then lands on the item that rose under it. */
async function pressAndReleaseOver() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), { button: 0, pointerType: "mouse" });
  const item = await screen.findByRole("menuitem", { name: "Delete…" });
  fireEvent.pointerUp(item, { button: 0, pointerType: "mouse" });
  return item;
}

describe("Menu on a phone-sized viewport", () => {
  it("doesn't pick the item under the release of the press that opened the sheet", async () => {
    const onDelete = vi.fn();
    mount(onDelete);
    const item = await pressAndReleaseOver();
    expect(onDelete).not.toHaveBeenCalled();
    expect(item.isConnected).toBe(true);
    // A real pick, pressed and released on the item, still works.
    fireEvent.pointerDown(item, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(item, { button: 0, pointerType: "mouse" });
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("keeps press, drag and release to pick on an anchored menu", async () => {
    compact.value = false;
    const onDelete = vi.fn();
    mount(onDelete);
    await pressAndReleaseOver();
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
