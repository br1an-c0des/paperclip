import type { Issue } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => cleanup());

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
const issues = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/issues", () => ({
  issuesApi: issues,
  issuePath: (prefix: string, issue: { id: string; identifier: string | null }) => `/${prefix}/issues/${issue.identifier ?? issue.id}`,
}));

const { TaskParentCrumb } = await import("./TaskParentCrumb");

function renderCrumb(detail: Partial<Issue>, onOpenTask = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["issues", "detail", "t1"], { id: "t1", identifier: "TES-20", ...detail });
  render(() => (
    <QueryClientProvider client={client}>
      <TaskParentCrumb taskId="t1" onOpenTask={onOpenTask} />
    </QueryClientProvider>
  ));
  return onOpenTask;
}

describe("TaskParentCrumb", () => {
  it("links the parent and opens it the way the header opens tasks", () => {
    const onOpenTask = renderCrumb({ parentId: "p1", ancestors: [{ id: "p1", identifier: "TES-12", title: "Prepare the launch" }] as Issue["ancestors"] });
    const link = screen.getByRole("link", { name: "Parent task: Prepare the launch" });
    expect(link.getAttribute("href")).toBe("/TES/issues/TES-12");
    // The title alone, with no task number (U128, #20804).
    expect(link.textContent).toBe("Prepare the launch");
    fireEvent.click(link);
    expect(onOpenTask).toHaveBeenCalledWith({ id: "p1", identifier: "TES-12" });
  });

  it("leaves a modifier click to the browser", () => {
    const onOpenTask = renderCrumb({ parentId: "p1", ancestors: [{ id: "p1", identifier: "TES-12", title: "Prepare" }] as Issue["ancestors"] });
    fireEvent.click(screen.getByRole("link"), { metaKey: true });
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("shows a private parent as a lock with no link", () => {
    renderCrumb({ parentId: "p1", ancestors: [{ id: "p1", identifier: "TES-12", locked: true }] as unknown as Issue["ancestors"] });
    expect(screen.queryByRole("link")).toBeNull();
    const chip = screen.getByTestId("locked-relation");
    expect(chip.getAttribute("aria-label")).toBe("Parent task, private, you don't have access");
    expect(chip.textContent).toBe("Private");
  });

  it("shows nothing for a top-level task", () => {
    renderCrumb({ parentId: null, ancestors: [] });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("/")).toBeNull();
  });
});
