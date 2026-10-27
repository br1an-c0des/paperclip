import { cleanup, render, screen } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { layerMode } from "@/ui/layer";
import { isCompact, viewport, watchViewport } from "./breakpoints";
import { Panel } from "./Panel";
import { Shell } from "./Shell";

// The test setup answers `min-width` queries from `window.innerWidth`, and its listeners never fire,
// so each resize here re-runs watchViewport to read the new width.
const startWidth = window.innerWidth;
const disposers: (() => void)[] = [];

function resizeTo(width: number) {
  window.innerWidth = width;
  createRoot((dispose) => {
    disposers.push(dispose);
    watchViewport();
  });
}

describe("phone breakpoint", () => {
  afterEach(() => {
    cleanup();
    resizeTo(startWidth);
    for (const dispose of disposers.splice(0)) dispose();
  });

  it("sets the viewport and turns layers into sheets", () => {
    resizeTo(375);
    expect(viewport()).toBe("phone");
    expect(isCompact()).toBe(true);
    expect(layerMode()).toBe("sheet");
    expect(document.documentElement.dataset.viewport).toBe("phone");

    resizeTo(800);
    expect(viewport()).toBe("tablet");
    expect(isCompact()).toBe(false);

    resizeTo(1440);
    expect(viewport()).toBe("desktop");
    expect(layerMode()).toBe("anchored");
  });

  it("swaps the left nav for the dock on a phone, and back", () => {
    resizeTo(1440);
    render(() => (
      <Shell nav={<p>Left nav</p>} dock={<p>The dock</p>}>
        <p>Page</p>
      </Shell>
    ));
    expect(screen.getByRole("navigation", { name: "Main" }).textContent).toContain("Left nav");
    expect(screen.queryByText("The dock")).toBeNull();

    resizeTo(375);
    expect(screen.queryByText("Left nav")).toBeNull();
    expect(screen.getByText("The dock")).toBeTruthy();
    expect(screen.getByRole("main").textContent).toContain("Page");

    resizeTo(800);
    expect(screen.getByText("Left nav")).toBeTruthy();
    expect(screen.queryByText("The dock")).toBeNull();
  });

  it("opens a panel as a full-screen page with a back control on a phone", () => {
    resizeTo(375);
    let closed = 0;
    render(() => (
      <Panel label="Task TST-1" onClose={() => closed++}>
        <p>Details</p>
      </Panel>
    ));
    const panel = screen.getByRole("complementary", { name: "Task TST-1" });
    expect(panel.classList.contains("panel--page")).toBe(true);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    screen.getByRole("button", { name: "Back" }).click();
    expect(closed).toBe(1);
  });

  it("keeps the close button on desktop", () => {
    resizeTo(1440);
    render(() => (
      <Panel label="Task TST-1" onClose={() => {}}>
        <p>Details</p>
      </Panel>
    ));
    expect(screen.getByRole("complementary", { name: "Task TST-1" }).classList.contains("panel--page")).toBe(false);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
