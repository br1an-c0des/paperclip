import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGitHubLink, patchLines } from "./message-format";

afterEach(cleanup);

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
const navigate = vi.fn();
vi.mock("@solidjs/router", () => ({ useNavigate: () => navigate }));

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
    expect(pull!.querySelector("svg")).not.toBeNull();
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
