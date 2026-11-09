import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const navigate = vi.fn();
vi.mock("@solidjs/router", async (original) => ({ ...(await original<object>()), useNavigate: () => navigate }));

const { LiveText } = await import("./LiveReply");
const { renderMarkdown } = await import("@/ui/Markdown");

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
