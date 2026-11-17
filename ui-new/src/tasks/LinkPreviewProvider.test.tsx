import type { LinkPreviewResult } from "@paperclipai/shared";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("@solidjs/router", async (original) => ({ ...(await original<object>()), useNavigate: () => vi.fn() }));
vi.mock("@/lib/company", () => ({
  useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }),
  useOptionalCompany: () => () => ({ id: "co1", issuePrefix: "TES" }),
}));
const previews = vi.hoisted(() => ({ get: vi.fn(), cached: vi.fn() }));
vi.mock("@/api/link-previews", () => ({ linkPreviewsApi: previews }));

const { LinkPreviewProvider } = await import("./LinkPreviewProvider");
const { LiveText } = await import("@/chat/LiveReply");
const { renderMarkdown } = await import("@/ui/Markdown");

const PR = "https://github.com/acme/app/pull/12";
const PR2 = "https://github.com/acme/app/pull/13";
const saved = (url: string, state: "merged" | "open", maxAgeMs = 60_000): LinkPreviewResult => ({
  preview: { target: { provider: "github", kind: "pull_request", canonicalUrl: url, label: "acme/app#1" }, title: "Fix the build", state, author: null, updatedAt: null },
  maxAgeMs,
});

describe("status marks on load (U175)", () => {
  it("shows a streaming reply's pull request status without a hover, from one saved-status read", async () => {
    previews.cached.mockResolvedValue({ results: { [PR]: saved(PR, "merged"), [PR2]: saved(PR2, "open") } });
    const client = new QueryClient();
    const [html, setHtml] = createSignal(renderMarkdown(`Opened ${PR}`));
    render(() => (
      <QueryClientProvider client={client}>
        <LinkPreviewProvider>
          <LiveText html={html()} caret />
        </LinkPreviewProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Pull request acme\/app#12/i }).dataset.state).toBe("merged"));
    expect(previews.cached).toHaveBeenCalledTimes(1);
    expect(previews.cached.mock.calls[0]!.slice(0, 2)).toEqual(["co1", [PR]]);

    // The reply grows: the link written before keeps its mark, the new one gets its own read.
    setHtml(renderMarkdown(`Opened ${PR} and ${PR2}`));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Pull request acme\/app#13/i }).dataset.state).toBe("open"));
    expect(previews.cached).toHaveBeenCalledTimes(2);
    expect(previews.cached.mock.calls[1]!.slice(0, 2)).toEqual(["co1", [PR2]]);
    expect(screen.getByRole("link", { name: "acme/app#12 Merged: Fix the build" })).toBeTruthy();
    expect(previews.get).not.toHaveBeenCalled();
  });
});
