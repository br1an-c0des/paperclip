import type { LinkPreviewResult } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const navigate = vi.fn();
vi.mock("@solidjs/router", async (original) => ({ ...(await original<object>()), useNavigate: () => navigate }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
const previews = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/link-previews", () => ({ linkPreviewsApi: previews }));

const { LiveText } = await import("./LiveReply");
const { renderMarkdown } = await import("@/ui/Markdown");
const { LiveRunStatusLine } = await import("@/tasks/LiveRunStatus");
const { morphChildren } = await import("./live-morph");

describe("what the run is doing (U107, #20460)", () => {
  it("says the tool it's using and how long since its last sign of life, while the reply runs", () => {
    const at = new Date(Date.now() - 3_000).toISOString();
    const run = { currentToolName: "Bash", lastAssistantSnippet: "Checking the build", currentStatusUpdatedAt: at, lastEventAt: at };
    const { container } = render(() => <LiveRunStatusLine runId="r1" run={run} active />);
    expect(container.querySelector(".lrs")?.textContent).toMatch(/^Using Bash · [34]s ago$/);
  });

  it("shows a storage wait, and nothing once the reply has ended", () => {
    const at = new Date(Date.now() - 20_000).toISOString();
    const run = { currentStatusMessage: "Waiting for file storage before starting the run log (45s so far)", currentStatusUpdatedAt: at, lastEventAt: at };
    const live = render(() => <LiveRunStatusLine runId="r1" run={run} active />);
    expect(live.container.textContent).toMatch(/^Waiting for file storage before starting the run log \(45s so far\) · no output for 2[01]s$/);
    live.unmount();
    const ended = render(() => <LiveRunStatusLine runId="r1" run={run} active={false} />);
    expect(ended.container.querySelector(".lrs")).toBeNull();
  });
});

describe("a streaming reply's links (U86, #19986)", () => {
  it("opens a known company's //PREFIX/... link through the router, and other links in a new tab", () => {
    const html = renderMarkdown("Opened [PAP-1](//PAP/issues/PAP-1) and [the docs](//docs.example.com/x).", { knownPrefixes: ["PAP"] });
    const { container } = render(() => <LiveText html={html} caret />);
    const [task, docs] = Array.from(container.querySelectorAll("a"));
    expect(task!.getAttribute("href")).toBe("/PAP/issues/PAP-1");
    expect(task!.hasAttribute("target")).toBe(false);
    expect(docs!.getAttribute("target")).toBe("_blank");
    fireEvent.click(task!);
    expect(navigate).toHaveBeenCalledWith("/PAP/issues/PAP-1");
    navigate.mockClear();
    fireEvent.click(docs!);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("pull request links in a streaming reply (U113)", () => {
  const PR = "https://github.com/Acme/App/pull/12";
  const merged: LinkPreviewResult = {
    preview: {
      target: { provider: "github", kind: "pull_request", canonicalUrl: "https://github.com/acme/app/pull/12", label: "Acme/App#12" },
      title: "Fix the build",
      state: "merged",
      author: "octocat",
      updatedAt: null,
    },
    maxAgeMs: 300_000,
  };

  beforeEach(() => previews.get.mockReset());

  function stream(first: string) {
    const [text, setText] = createSignal(first);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(() => (
      <QueryClientProvider client={client}>
        <LiveText html={renderMarkdown(text())} caret />
      </QueryClientProvider>
    ));
    return { ...view, write: (more: string) => setText(more) };
  }

  it("marks the link as a finished message does, and reads nothing while the text grows", () => {
    const { container, write } = stream(`Opened ${PR}`);
    const mark = screen.getByRole("button", { name: "Pull request Acme/App#12: show its status" });
    const link = container.querySelector<HTMLAnchorElement>("a[data-link-preview]")!;
    expect(link.textContent).toBe("GitHub pull request: Acme/App#12");
    expect(link.closest(".gh-pr")?.querySelector(".gh-pr-mark .lp-mark")).toBe(mark);

    write(`Opened ${PR} for the build`);
    write(`Opened ${PR} for the build fix.\n\nNext I'll run`);
    write(`Opened ${PR} for the build fix.\n\nNext I'll run the tests, then [check it](${PR}/files).`);
    // The same link and mark, not new ones for each chunk.
    expect(container.querySelector("a[data-link-preview]")).toBe(link);
    const marks = screen.getAllByRole("button", { name: /^Pull request Acme\/App#12/ });
    expect(marks).toHaveLength(2);
    expect(marks[0]).toBe(mark);
    expect(container.querySelector(".ch-live-text")!.textContent).toContain("Next I'll run the tests");
    expect(previews.get).not.toHaveBeenCalled();
  });

  it("keeps an open card open, and the state it learned, while the reply goes on", async () => {
    previews.get.mockResolvedValue(merged);
    const { container, write } = stream(`See ${PR}`);
    const mark = screen.getByRole("button", { name: /^Pull request Acme\/App#12/ });
    fireEvent.click(mark);
    const card = await screen.findByRole("dialog", { name: "Pull request Acme/App#12" });
    await waitFor(() => expect(card.textContent).toContain("Fix the build"));
    write(`See ${PR}, merged an hour ago.`);
    write(`See ${PR}, merged an hour ago.\n\n- one\n- two`);
    expect(screen.getByRole("dialog", { name: "Pull request Acme/App#12" })).toBe(card);
    expect(mark.isConnected).toBe(true);
    expect(mark.dataset.state).toBe("merged");
    const link = container.querySelector<HTMLAnchorElement>("a[data-link-preview]")!;
    expect(link.dataset.linkState).toBe("merged");
    expect(link.getAttribute("aria-label")).toBe("Acme/App#12 Merged: Fix the build");
    expect(previews.get).toHaveBeenCalledTimes(1);
  });

  it("gives a link that turns out to be another pull request a mark of its own", () => {
    const { write } = stream("See https://github.com/acme/app/pull/1");
    const first = screen.getByRole("button", { name: /^Pull request acme\/app#1:/ });
    write("See https://github.com/acme/app/pull/12");
    expect(screen.queryByRole("button", { name: /^Pull request acme\/app#1:/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Pull request acme\/app#12:/ })).not.toBe(first);
    expect(first.isConnected).toBe(false);
  });
});

describe("morphChildren", () => {
  const html = (source: string) => {
    const element = document.createElement("div");
    element.innerHTML = source;
    return element;
  };

  it("keeps the nodes that match, updates their text and attributes, and swaps the rest", () => {
    const live = html('<p>Hello <a href="/a">a</a></p><p>old</p><ul><li>x</li></ul>');
    const [paragraph, second] = Array.from(live.children);
    const link = live.querySelector("a")!;
    morphChildren(live, html('<p>Hello there <a href="/b" class="x">a</a></p><ol><li>x</li></ol>'));
    expect(live.innerHTML).toBe('<p>Hello there <a href="/b" class="x">a</a></p><ol><li>x</li></ol>');
    expect(live.firstElementChild).toBe(paragraph);
    expect(live.querySelector("a")).toBe(link);
    expect(second!.isConnected).toBe(false);
  });
});
