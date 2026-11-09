import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const navigate = vi.fn();
vi.mock("@solidjs/router", () => ({ useNavigate: () => navigate }));

const { companyPathFromProtocolRelativeHref, Markdown, renderMarkdown } = await import("./Markdown");

describe("//PREFIX/... links (U86, upstream #19986)", () => {
  it("reads //PREFIX/... as that company's path when the prefix is known, keeping query and fragment", () => {
    expect(companyPathFromProtocolRelativeHref("//PAP/issues/PAP-1", ["PAP"])).toBe("/PAP/issues/PAP-1");
    expect(companyPathFromProtocolRelativeHref("//PAP/issues/PAP-1#document-plan", ["PAP"])).toBe("/PAP/issues/PAP-1#document-plan");
    expect(companyPathFromProtocolRelativeHref("//PAP/agents/a?tab=runs", ["PAP"])).toBe("/PAP/agents/a?tab=runs");
    expect(companyPathFromProtocolRelativeHref("//PAP", ["PAP"])).toBe("/PAP");
  });

  it("leaves everything else as written", () => {
    expect(companyPathFromProtocolRelativeHref("//docs.example.com/PAP/guide", ["PAP"])).toBe("//docs.example.com/PAP/guide");
    expect(companyPathFromProtocolRelativeHref("//OTHER/issues/OTHER-1", ["PAP"])).toBe("//OTHER/issues/OTHER-1");
    expect(companyPathFromProtocolRelativeHref("//pap/issues/PAP-1", ["PAP"])).toBe("//pap/issues/PAP-1");
    expect(companyPathFromProtocolRelativeHref("//PAP/issues/PAP-1", [])).toBe("//PAP/issues/PAP-1");
    expect(companyPathFromProtocolRelativeHref("//PAP/issues/PAP-1", undefined)).toBe("//PAP/issues/PAP-1");
    expect(companyPathFromProtocolRelativeHref("/PAP/issues/PAP-1", ["PAP"])).toBe("/PAP/issues/PAP-1");
    expect(companyPathFromProtocolRelativeHref("https://PAP/x", ["PAP"])).toBe("https://PAP/x");
  });

  it("renders a known company's link in the app and every other link in a new tab", () => {
    const html = renderMarkdown("[Run](//PAP/agents/a/runs/r) [Docs](//docs.example.com/x) [Site](https://example.com)", { knownPrefixes: ["PAP"] });
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const [run, docs, site] = Array.from(holder.querySelectorAll("a"));
    expect(run!.getAttribute("href")).toBe("/PAP/agents/a/runs/r");
    expect(run!.hasAttribute("data-app-link")).toBe(true);
    expect(run!.hasAttribute("target")).toBe(false);
    expect(docs!.getAttribute("href")).toBe("//docs.example.com/x");
    expect(docs!.getAttribute("target")).toBe("_blank");
    expect(site!.getAttribute("target")).toBe("_blank");
  });

  it("rewrites nothing without known prefixes", () => {
    expect(renderMarkdown("[Run](//PAP/agents/a)")).toContain('href="//PAP/agents/a"');
  });

  it("opens an in-app link through the router, and leaves a modified click to the browser", () => {
    const client = new QueryClient();
    client.setQueryData(["companies", "list", "u1"], [
      { id: "co1", issuePrefix: "TES" },
      { id: "co2", issuePrefix: "PAP" },
    ]);
    const { container } = render(() => (
      <QueryClientProvider client={client}>
        <Markdown source={"[Task](//PAP/issues/PAP-1) [Here](//TES/projects) [Away](https://example.com)"} />
      </QueryClientProvider>
    ));
    const [task, here, away] = Array.from(container.querySelectorAll("a"));
    expect(task!.getAttribute("href")).toBe("/PAP/issues/PAP-1");
    expect(here!.getAttribute("href")).toBe("/TES/projects");
    expect(away!.getAttribute("target")).toBe("_blank");
    fireEvent.click(task!);
    expect(navigate).toHaveBeenCalledWith("/PAP/issues/PAP-1");
    navigate.mockClear();
    fireEvent.click(here!, { metaKey: true });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(away!);
    expect(navigate).not.toHaveBeenCalled();
  });
});
