import type { Company, CompactIssue } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import { CompanyProvider } from "@/lib/company";
import type { RecentTask } from "./nav-model";
import { RecentTasks } from "./RecentTasks";

const company = { id: "c1", name: "Test Co", issuePrefix: "TST" } as Company;
const YOU = "user-1";

vi.mock("@/lib/session", () => ({
  useSession: () => ({ isAuthenticatedMode: () => true, session: () => null, userId: () => YOU, youId: () => YOU }),
}));

const task = (id: string, extra: Partial<RecentTask> = {}): RecentTask => ({ id, identifier: `TST-${id}`, title: `Task ${id}`, status: "todo", at: 0, ...extra });
const child = (id: string, extra: Partial<CompactIssue> = {}) =>
  ({ id, companyId: "c1", parentId: "1", identifier: `TST-${id}`, title: `Sub ${id}`, status: "todo", ...extra }) as CompactIssue;

function renderList(tasks: RecentTask[], client: QueryClient) {
  const history = createMemoryHistory();
  history.set({ value: "/TST/dashboard" });
  render(() => (
    <QueryClientProvider client={client}>
      <CompanyProvider company={company}>
        <MemoryRouter history={history} root={() => <RecentTasks tasks={tasks} base="/TST" />}>
          <Route path="*" component={() => null} />
        </MemoryRouter>
      </CompanyProvider>
    </QueryClientProvider>
  ));
}

describe("RecentTasks", () => {
  let requests: string[];
  beforeEach(() => {
    localStorage.clear();
    requests = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      requests.push(String(input));
      return Promise.resolve(new Response(JSON.stringify([child("s1", { isUnreadForMe: true }), child("s2")]), { headers: { "content-type": "application/json" } }));
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("folds a parent with subtasks until you unfold it, and reads its subtasks only then", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderList([task("1", { subtaskCount: 2, unreadSubtaskCount: 1 }), task("2")], client);
    const toggle = screen.getByRole("button", { name: "Subtasks of Task 1: 2, 1 unread" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // A task without subtasks has no fold button, and keeps its identifier.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("TST-2")).toBeTruthy();
    expect(requests).toEqual([]);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const group = await screen.findByRole("group", { name: "Subtasks of Task 1" });
    expect(toggle.getAttribute("aria-controls")).toBe(group.id);
    await waitFor(() => expect(screen.getByText("Sub s1")).toBeTruthy());
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!, "http://x");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ view: "rows", parentId: "1", limit: "10", sortField: "id", sortDir: "asc", includeReadState: "true" });
    expect(screen.getByText("Sub s1").closest("a")?.classList.contains("navi--unread")).toBe(true);
    expect(client.getQueryData(queryKeys.recentSubtasks("c1", YOU, "1"))).toBeDefined();

    // Folding remembers it, per company and person.
    fireEvent.click(toggle);
    expect(screen.queryByRole("group", { name: "Subtasks of Task 1" })).toBeNull();
    expect(JSON.parse(localStorage.getItem(`paperclip.ui-new.recent-unfolded:c1:${YOU}`) ?? "null")).toEqual([]);
  });

  it("moves a recent subtask into its unfolded parent's group", async () => {
    localStorage.setItem(`paperclip.ui-new.recent-unfolded:c1:${YOU}`, JSON.stringify(["1"]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderList([task("1", { subtaskCount: 3 }), task("s9", { parentId: "1", title: "Recent sub" })], client);
    const group = await screen.findByRole("group", { name: "Subtasks of Task 1" });
    await waitFor(() => expect(group.textContent).toContain("Sub s2"));
    expect(group.textContent).toContain("Recent sub");
    expect(screen.getAllByText("Recent sub")).toHaveLength(1);
  });
});
