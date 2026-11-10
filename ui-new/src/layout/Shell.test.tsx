import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createRoot, createSignal, Show } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { layerMode } from "@/ui/layer";
import { isCompact, viewport, watchViewport } from "./breakpoints";
import type { NavMode } from "./nav-model";
import { Dock, Panel } from "./Panel";
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

  it("resizes the nav from its edge with the keys, and resets on a double click", () => {
    resizeTo(1440);
    const [width, setWidth] = createSignal(248);
    const saved: number[] = [];
    render(() => (
      <Shell
        nav={<p>Left nav</p>}
        navWidth={width()}
        onNavWidth={(next, done) => {
          setWidth(Math.min(420, Math.max(200, next)));
          if (done) saved.push(width());
        }}
      >
        <p>Page</p>
      </Shell>
    ));
    const handle = screen.getByRole("separator", { name: "Resize navigation" });
    expect(handle.getAttribute("aria-valuenow")).toBe("248");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("264");
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(width()).toBe(216);
    fireEvent.keyDown(handle, { key: "End" });
    expect(width()).toBe(420);
    fireEvent.dblClick(handle);
    expect(width()).toBe(248);
    expect(saved).toEqual([264, 216, 420, 248]);
    expect((document.querySelector(".shell") as HTMLElement).style.getPropertyValue("--nav-w")).toBe("248px");
  });

  it("folds to the rail and back from the seam's tab and the edge's keys, labels first then the column", async () => {
    resizeTo(1440);
    const [mode, setMode] = createSignal<NavMode>("full");
    const [width, setWidth] = createSignal(200);
    render(() => (
      <Shell
        nav={<p>Full nav</p>}
        rail={<p>Icon rail</p>}
        navMode={mode()}
        onNavMode={setMode}
        navWidth={width()}
        onNavWidth={(next) => setWidth(Math.min(420, Math.max(200, next)))}
      >
        <p>Page</p>
      </Shell>
    ));
    const shell = document.querySelector(".shell") as HTMLElement;
    const nav = screen.getByRole("navigation", { name: "Main" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(mode()).toBe("rail");
    // The labels fade first, the full nav still in place; then the rail, in a narrowing column.
    expect(nav.dataset.fold).toBe("out");
    expect(nav.textContent).toBe("Full nav");
    await waitFor(() => expect(nav.dataset.fold).toBe("narrow"));
    expect(nav.textContent).toBe("Icon rail");
    expect(shell.style.getPropertyValue("--nav-w")).toBe("68px");
    expect(shell.classList.contains("shell--sliding")).toBe(true);
    await waitFor(() => expect(nav.dataset.fold).toBeUndefined());

    // Expanding: the column first, then the full nav's labels.
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(nav.dataset.fold).toBe("widen");
    expect(shell.style.getPropertyValue("--nav-w")).toBe("200px");
    expect(nav.textContent).toBe("Icon rail");
    await waitFor(() => expect(nav.textContent).toBe("Full nav"));
    await waitFor(() => expect(nav.dataset.fold).toBeUndefined());

    // ← past the narrowest width on the focused edge snaps to the rail at once; → opens it out.
    const handle = screen.getByRole("separator", { name: "Resize navigation" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(mode()).toBe("rail");
    expect(nav.textContent).toBe("Icon rail");
    expect(handle.getAttribute("aria-valuenow")).toBe("68");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(mode()).toBe("full");
    expect(nav.textContent).toBe("Full nav");
    expect(width()).toBe(200);
  });

  it("has no rail or seam tab where the slot can't fold (settings)", () => {
    resizeTo(1440);
    render(() => (
      <Shell nav={<p>Settings sidebar</p>} rail={<p>Icon rail</p>} navMode="rail" canRail={false} onNavMode={() => {}} navWidth={248} onNavWidth={() => {}}>
        <p>Page</p>
      </Shell>
    ));
    expect(screen.getByRole("navigation", { name: "Main" }).textContent).toBe("Settings sidebar");
    expect(screen.queryByRole("button", { name: /sidebar/ })).toBeNull();
    expect((document.querySelector(".shell") as HTMLElement).style.getPropertyValue("--nav-w")).toBe("248px");
  });

  it("has no resize handle when the shell isn't given a width to change", () => {
    resizeTo(1440);
    render(() => (
      <Shell nav={<p>Left nav</p>}>
        <p>Page</p>
      </Shell>
    ));
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("docks a panel in the shell's column and splits main from it while it's open", async () => {
    resizeTo(1440);
    const [open, setOpen] = createSignal(true);
    render(() => (
      <Shell nav={<p>Left nav</p>}>
        <Dock>
          <p>The list</p>
          <Show when={open()}>
            <Panel label="Task TST-1" onClose={() => setOpen(false)}>
              <p>Details</p>
            </Panel>
          </Show>
        </Dock>
      </Shell>
    ));
    const shell = document.querySelector(".shell")!;
    const panel = screen.getByRole("complementary", { name: "Task TST-1" });
    expect(panel.closest(".shell-dock")).toBeTruthy();
    expect(panel.closest(".shell-main")).toBeNull();
    await waitFor(() => expect(shell.classList.contains("shell--split")).toBe(true));
    expect(document.activeElement).toBe(panel);

    screen.getByRole("button", { name: "Close" }).click();
    await waitFor(() => expect(shell.classList.contains("shell--split")).toBe(false));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("keeps a phone's panel a full-screen page, without splitting", () => {
    resizeTo(375);
    render(() => (
      <Shell nav={<p>Left nav</p>}>
        <Dock>
          <Panel label="Task TST-1" onClose={() => {}}>
            <p>Details</p>
          </Panel>
        </Dock>
      </Shell>
    ));
    const panel = screen.getByRole("complementary", { name: "Task TST-1" });
    expect(panel.classList.contains("panel--page")).toBe(true);
    expect(document.querySelector(".shell-dock")).toBeNull();
    expect(document.querySelector(".shell")!.classList.contains("shell--split")).toBe(false);
  });
});
