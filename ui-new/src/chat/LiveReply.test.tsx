import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const navigate = vi.fn();
vi.mock("@solidjs/router", async (original) => ({ ...(await original<object>()), useNavigate: () => navigate }));

const { LiveText } = await import("./LiveReply");
const { renderMarkdown } = await import("@/ui/Markdown");
const { LiveRunStatusLine } = await import("@/tasks/LiveRunStatus");

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
