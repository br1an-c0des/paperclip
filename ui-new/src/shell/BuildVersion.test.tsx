import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import { uiCommit } from "../../vite.config";
import { BuildVersion } from "./BuildVersion";

const UI = "9f92e49ba0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5";
const SERVER = "49a2b7b245fec7b78cb4467cb547c06be6d30ea1";

afterEach(cleanup);

function renderWith(health: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.health, health);
  const fetch = vi.spyOn(globalThis, "fetch");
  render(() => (
    <QueryClientProvider client={client}>
      <BuildVersion />
    </QueryClientProvider>
  ));
  return { fetch };
}

describe("BuildVersion", () => {
  it("shows both short commits and opens its details on a tap", async () => {
    vi.stubGlobal("__UI_COMMIT__", UI);
    vi.stubGlobal("__UI_BUILT_AT__", "2026-11-16T10:42:00.000Z");
    const { fetch } = renderWith({ status: "ok", commit: SERVER });
    const button = screen.getByRole("button", { name: "Build: ui 9f92e49 · server 49a2b7b" });
    expect(button.textContent).toBe("ui 9f92e49 · server 49a2b7b");
    // The session gate's health is reused, not fetched again.
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(button);
    const tip = await screen.findByText(UI, { selector: ".tip code" });
    expect(tip).toBeTruthy();
    expect(screen.getByText(SERVER, { selector: ".tip code" })).toBeTruthy();
    expect(document.querySelector(".tip time")?.getAttribute("datetime")).toBe("2026-11-16T10:42:00.000Z");
  });

  it("leaves the server out when health has no commit, and says unknown for the UI", () => {
    vi.stubGlobal("__UI_COMMIT__", null);
    vi.stubGlobal("__UI_BUILT_AT__", "2026-11-16T10:42:00.000Z");
    renderWith({ status: "ok", commit: null });
    expect(screen.getByRole("button").textContent).toBe("ui unknown");
  });
});

describe("uiCommit (vite.config.ts)", () => {
  const noGit = () => {
    throw new Error("not a git repository");
  };

  it("prefers PAPERCLIP_UI_COMMIT, then PAPERCLIP_BUILD_COMMIT, then git", () => {
    expect(uiCommit({ PAPERCLIP_UI_COMMIT: ` ${UI.toUpperCase()}\n`, PAPERCLIP_BUILD_COMMIT: SERVER }, () => SERVER)).toBe(UI);
    expect(uiCommit({ PAPERCLIP_UI_COMMIT: "", PAPERCLIP_BUILD_COMMIT: SERVER }, () => UI)).toBe(SERVER);
    expect(uiCommit({}, () => `${UI}\n`)).toBe(UI);
  });

  it("is null without an env commit or git, as in a Docker build given no arg", () => {
    expect(uiCommit({ PAPERCLIP_UI_COMMIT: "" }, noGit)).toBeNull();
    expect(uiCommit({ PAPERCLIP_UI_COMMIT: "not-a-sha" }, () => "fatal: not a git repository")).toBeNull();
  });
});
