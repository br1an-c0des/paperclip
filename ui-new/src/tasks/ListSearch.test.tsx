import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { focusPageSearch } from "@/lib/shortcuts";
import { ListSearch } from "./ListSearch";

function renderSearch(initial = "") {
  const [value, setValue] = createSignal(initial);
  render(() => (
    <>
      <ListSearch value={value()} onInput={setValue} label="Search tasks" />
      <button type="button">Elsewhere</button>
    </>
  ));
  const slot = document.querySelector(".tv-search-slot")!;
  return {
    value,
    slot,
    isOpen: () => slot.classList.contains("tv-search-slot--open"),
    toggle: screen.getByRole("button", { name: "Search tasks" }),
    input: screen.getByRole("searchbox", { name: "Search tasks" }) as HTMLInputElement,
  };
}

describe("ListSearch", () => {
  afterEach(cleanup);

  it("opens focused from its button and folds back when it loses focus empty", () => {
    const { isOpen, toggle, input } = renderSearch();
    expect(isOpen()).toBe(false);
    fireEvent.click(toggle);
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe(input);
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    expect(isOpen()).toBe(false);
  });

  it("stays open while it holds a search, focused or not", () => {
    const { value, isOpen, toggle, input } = renderSearch();
    fireEvent.click(toggle);
    fireEvent.input(input, { target: { value: "deploy" } });
    expect(value()).toBe("deploy");
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    expect(isOpen()).toBe(true);
  });

  it("starts open when the list already has a search, as from a link", () => {
    expect(renderSearch("from-url").isOpen()).toBe(true);
  });

  it("clears with Escape, then folds and hands focus back to its button", () => {
    const { value, isOpen, toggle, input } = renderSearch();
    fireEvent.click(toggle);
    fireEvent.input(input, { target: { value: "deploy" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(value()).toBe("");
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it("opens focused for `/`, as the page's search", () => {
    const { isOpen, input } = renderSearch();
    expect(focusPageSearch()).toBe(true);
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("leaves `/` to the palette on a page without one", () => {
    expect(focusPageSearch()).toBe(false);
  });
});
