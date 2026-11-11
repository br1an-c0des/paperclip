import type { LinkPreviewResult } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { LINK_PREVIEW_STATE_LABEL, parseGitHubLink, patchLines, previewMeta } from "./message-format";

afterEach(cleanup);

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
const navigate = vi.fn();
vi.mock("@solidjs/router", () => ({ useNavigate: () => navigate }));
const previews = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/link-previews", () => ({ linkPreviewsApi: previews }));

const { MessageBody } = await import("./MessageBody");

describe("GitHub links (U68, #19476)", () => {
  it("knows pull requests, issues and repositories, and leaves GitHub's own pages alone", () => {
    expect(parseGitHubLink("https://github.com/paperclipai/paperclip/pull/19476")).toMatchObject({ kind: "pull_request", label: "paperclipai/paperclip#19476" });
    expect(parseGitHubLink("https://github.com/paperclipai/paperclip/issues/12")).toMatchObject({ kind: "issue", label: "paperclipai/paperclip#12" });
    expect(parseGitHubLink("https://github.com/paperclipai/paperclip")).toMatchObject({ kind: "repository", label: "paperclipai/paperclip" });
    expect(parseGitHubLink("https://github.com/settings/profile")).toMatchObject({ kind: "github", label: null });
    expect(parseGitHubLink("http://github.com/a/b/pull/1")).toBeNull();
    expect(parseGitHubLink("https://example.com/a/b/pull/1")).toBeNull();
  });

  it("labels a bare link owner/repo#n with its icon, and keeps written link text", () => {
    const { container } = render(() => (
      <MessageBody source={"See https://github.com/paperclipai/paperclip/pull/19476 and [the fix](https://github.com/paperclipai/paperclip/issues/12)."} />
    ));
    const [pull, issue] = Array.from(container.querySelectorAll("a"));
    expect(pull!.dataset.githubLink).toBe("pull_request");
    expect(pull!.textContent).toBe("GitHub pull request: paperclipai/paperclip#19476");
    // A pull request's icon is its status mark, just before the link (U113).
    expect(pull!.closest(".gh-pr")?.querySelector(".gh-pr-mark svg")).not.toBeNull();
    expect(pull!.getAttribute("target")).toBe("_blank");
    expect(issue!.dataset.githubLink).toBe("issue");
    expect(issue!.textContent).toBe("GitHub issue: the fix");
    expect(issue!.querySelector("svg circle")).not.toBeNull();
  });

  it("marks a repository link with the GitHub mark", () => {
    const { container } = render(() => <MessageBody source={"[the repo](https://github.com/paperclipai/paperclip)"} />);
    const link = container.querySelector("a")!;
    expect(link.dataset.githubLink).toBe("repository");
    expect(link.querySelectorAll("svg path")).toHaveLength(2);
    expect(link.textContent).toBe("GitHub repository: the repo");
  });
});

describe("pull request previews (U113, #20593, #20654)", () => {
  const PR = "https://github.com/Acme/App/pull/12";
  const merged: LinkPreviewResult = {
    preview: {
      target: { provider: "github", kind: "pull_request", canonicalUrl: "https://github.com/acme/app/pull/12", label: "Acme/App#12" },
      title: "Fix the build",
      state: "merged",
      author: "octocat",
      updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    },
    maxAgeMs: 300_000,
  };

  beforeEach(() => previews.get.mockReset());

  function mount(source: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
    render(() => (
      <QueryClientProvider client={client}>
        <MessageBody source={source} />
      </QueryClientProvider>
    ));
    return client;
  }

  it("words a pull request's state and its card's meta line", () => {
    expect(LINK_PREVIEW_STATE_LABEL.conflicts).toBe("Merge conflicts");
    const now = new Date("2026-11-11T12:00:00Z");
    expect(previewMeta({ author: "octocat", updatedAt: "2026-11-11T10:00:00Z" }, now)).toBe("octocat · Updated 2h ago");
    expect(previewMeta({ author: null, updatedAt: "2026-11-03T10:00:00Z" }, now)).toBe("Updated Nov 3");
    expect(previewMeta({ author: " ", updatedAt: "not a date" }, now)).toBeNull();
  });

  it("reads nothing until someone asks, then opens the card from the mark, tap or click", async () => {
    previews.get.mockResolvedValue(merged);
    mount(`See ${PR}.`);
    const mark = screen.getByRole("button", { name: "Pull request Acme/App#12: show its status" });
    expect(mark.dataset.state).toBe("unknown");
    expect(previews.get).not.toHaveBeenCalled();
    fireEvent.click(mark);
    const card = await screen.findByRole("dialog", { name: "Pull request Acme/App#12" });
    await waitFor(() => expect(card.textContent).toContain("Fix the build"));
    expect(previews.get).toHaveBeenCalledTimes(1);
    expect(previews.get.mock.calls[0]!.slice(0, 2)).toEqual(["co1", "https://github.com/acme/app/pull/12"]);
    expect(card.textContent).toContain("Merged");
    expect(card.textContent).toContain("octocat · Updated 2h ago");
    expect(card.querySelector("a")!.getAttribute("href")).toBe("https://github.com/acme/app/pull/12");
    // The mark and the link take the state.
    expect(mark.dataset.state).toBe("merged");
    expect(mark.getAttribute("aria-label")).toBe("Pull request Acme/App#12: Merged. Show details");
    const link = screen.getByRole("link", { name: "Acme/App#12 Merged: Fix the build" });
    expect(link.dataset.linkState).toBe("merged");
    expect(link.hasAttribute("title")).toBe(false);
  });

  it("asks once per link: every copy of it reads the cached answer", async () => {
    previews.get.mockResolvedValue(merged);
    const client = mount(`First ${PR}, then [the same one](${PR}/files).`);
    const [first, second] = screen.getAllByRole("button", { name: /^Pull request Acme\/App#12/ });
    fireEvent.click(first!);
    await waitFor(() => expect(second!.dataset.state).toBe("merged"));
    // A second message with the link, later on: no new read.
    mount(`Again: ${PR}`, client);
    const marks = screen.getAllByRole("button", { name: "Pull request Acme/App#12: Merged. Show details" });
    expect(marks).toHaveLength(3);
    fireEvent.click(marks[2]!);
    await screen.findAllByRole("dialog");
    expect(previews.get).toHaveBeenCalledTimes(1);
  });

  it("says when GitHub has no details, without an error", async () => {
    // A plain function: vitest fails a test when a mock's returned promise rejects, even if it's caught.
    const original = previews.get;
    (previews as { get: unknown }).get = () => Promise.reject(new Error("Request failed: 502"));
    onTestFinished(() => void ((previews as { get: unknown }).get = original));
    mount(PR);
    fireEvent.click(screen.getByRole("button", { name: /^Pull request Acme\/App#12/ }));
    await screen.findByText("No details from GitHub for this pull request.");
    expect(screen.getByRole("button", { name: "Pull request Acme/App#12: show its status" }).dataset.state).toBe("unknown");
  });

  it("leaves issue and repository links as they were", () => {
    mount("[an issue](https://github.com/acme/app/issues/3) and [the repo](https://github.com/acme/app)");
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelectorAll("a svg")).toHaveLength(2);
  });
});

describe("patch code blocks (U68, #19478)", () => {
  it("classifies a unified diff's lines", () => {
    const lines = patchLines("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n");
    expect(lines.map((line) => line.kind)).toEqual(["skip", "skip", "skip", "hunk", "context", "remove", "add"]);
  });

  it("colours a diff block's lines and keeps its text", () => {
    const source = "```diff\n@@ -1 +1 @@\n-old\n+new\n```";
    const { container } = render(() => <MessageBody source={source} />);
    const pre = container.querySelector("pre")!;
    expect(pre.classList.contains("patch")).toBe(true);
    expect(Array.from(pre.querySelectorAll<HTMLElement>(".patch-line")).map((line) => line.dataset.patchLine)).toEqual(["hunk", "remove", "add"]);
    expect(pre.textContent).toBe("@@ -1 +1 @@\n-old\n+new\n");
  });
});

describe("image grids (U68, #19626)", () => {
  it("puts two or more images on their own lines in one grid, and leaves a single image be", () => {
    const { container } = render(() => <MessageBody source={"Screens:\n\n![a](/a.png)\n![b](/b.png)\n\n![c](/c.png)\n\nDone."} />);
    const grid = container.querySelector(".msg-images")!;
    expect(grid.getAttribute("aria-label")).toBe("3 images");
    expect(Array.from(grid.querySelectorAll("a.msg-thumb")).map((link) => link.getAttribute("href"))).toEqual(["/a.png", "/b.png", "/c.png"]);
    expect(container.querySelectorAll("p").length).toBe(2);
    cleanup();
    const single = render(() => <MessageBody source={"![a](/a.png)"} />);
    expect(single.container.querySelector(".msg-images")).toBeNull();
  });
});

describe("//PREFIX/... links (U86, #19986)", () => {
  it("opens the company's own pages in the board, through the router", () => {
    const { container } = render(() => <MessageBody source={"See [the task](//TES/issues/TES-4#document-plan) and [its run](//TES/agents/a1/runs/r1)."} />);
    const [task, run] = Array.from(container.querySelectorAll("a"));
    expect(task!.getAttribute("href")).toBe("/TES/issues/TES-4#document-plan");
    expect(task!.classList.contains("task-link")).toBe(true);
    expect(run!.getAttribute("href")).toBe("/TES/agents/a1/runs/r1");
    expect(run!.hasAttribute("target")).toBe(false);
    fireEvent.click(run!);
    expect(navigate).toHaveBeenCalledWith("/TES/agents/a1/runs/r1");
  });
});
