import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { Segmented } from "./Segmented";

const options = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
] as const;

function Harness() {
  const [value, setValue] = createSignal<"list" | "board">("list");
  return <Segmented label="View" options={options} value={value()} onChange={setValue} />;
}

describe("Segmented", () => {
  it("marks the chosen segment and moves with the arrow keys", () => {
    render(() => <Harness />);
    const list = screen.getByRole("button", { name: "List" });
    const board = screen.getByRole("button", { name: "Board" });
    expect(list.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(board);
    expect(board.getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(board, { key: "ArrowRight" });
    expect(list.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(list);
  });
});
