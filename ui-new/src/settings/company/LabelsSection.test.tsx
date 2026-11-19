import type { IssueLabel } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import type { JSX } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  cleanup();
});

const actions = vi.hoisted(() => ({ updateLabel: vi.fn(), deleteLabel: vi.fn(), createLabel: vi.fn() }));
const issues = vi.hoisted(() => ({ listLabels: vi.fn() }));
vi.mock("@/api/task-actions", () => ({ taskActionsApi: actions }));
vi.mock("@/api/issues", () => ({ issuesApi: issues }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));

const { LabelsSection } = await import("./LabelsSection");
const { NewLabelDialog } = await import("@/tasks/NewLabelDialog");

const label = (id: string, name: string, color = "#6366f1"): IssueLabel => ({ id, companyId: "co1", name, color, createdAt: new Date(0), updatedAt: new Date(0) });

let client: QueryClient;

function mount(ui: () => JSX.Element) {
  const history = createMemoryHistory();
  history.set({ value: "/TES/company/settings/labels" });
  render(() => (
    <QueryClientProvider client={client}>
      <MemoryRouter history={history} root={() => ui()}>
        <Route path="*" component={() => null} />
      </MemoryRouter>
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  issues.listLabels.mockResolvedValue([label("l1", "ui", "#22b5a5"), label("l2", "bug")]);
  actions.updateLabel.mockImplementation(async (id: string, body: { name?: string; color?: string }) => ({ ...label(id, body.name ?? "x"), ...body }));
  actions.deleteLabel.mockImplementation(async (id: string) => label(id, "x"));
});

describe("LabelsSection", () => {
  it("lists the company's labels by name", async () => {
    mount(() => <LabelsSection />);
    expect(await screen.findByText("bug")).toBeTruthy();
    expect(screen.getByText("2 labels")).toBeTruthy();
    const names = screen.getAllByRole("button", { name: /^Rename / }).map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual(["Rename bug", "Rename ui"]);
  });

  it("renames a label and refreshes the shared label query", async () => {
    mount(() => <LabelsSection />);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: "Rename bug" }));
    const field = screen.getByRole("textbox", { name: "New name for bug" });
    fireEvent.input(field, { target: { value: "  defect " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.updateLabel).toHaveBeenCalledWith("l2", { name: "defect" }));
    // The labels key sits under the company's task-list prefix, so this refreshes the pickers too.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.issues.list("co1") }));
    expect(queryKeys.issues.labels("co1").slice(0, 2)).toEqual([...queryKeys.issues.list("co1")]);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "New name for bug" })).toBeNull());
  });

  it("shows a clash with another label on the field, before and after sending", async () => {
    mount(() => <LabelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename bug" }));
    const field = screen.getByRole("textbox", { name: "New name for bug" });
    fireEvent.input(field, { target: { value: "ui" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Another label is already called “ui”.");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(actions.updateLabel).not.toHaveBeenCalled();

    // A clash the list didn't know about (another tab created it) comes back as a 409.
    actions.updateLabel.mockRejectedValueOnce(new ApiError("A label named \"api\" already exists in this company.", 409, { error: "x", details: { code: "label_name_taken" } }));
    fireEvent.input(field, { target: { value: "api" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Another label is already called “api”."));
    expect(screen.getByRole("textbox", { name: "New name for bug" })).toBeTruthy();
  });

  it("cancels a rename with Escape", async () => {
    mount(() => <LabelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename ui" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New name for ui" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "New name for ui" })).toBeNull());
    expect(actions.updateLabel).not.toHaveBeenCalled();
  });

  it("recolours a label when the colour changes", async () => {
    mount(() => <LabelsSection />);
    const swatch = (await screen.findByLabelText("Color of ui")) as HTMLInputElement;
    fireEvent.change(swatch, { target: { value: "#f2286f" } });
    await waitFor(() => expect(actions.updateLabel).toHaveBeenCalledWith("l1", { color: "#f2286f" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("deletes a label only once confirmed", async () => {
    mount(() => <LabelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete ui" }));
    expect(await screen.findByText("Delete “ui”?")).toBeTruthy();
    expect(actions.deleteLabel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete label" }));
    await waitFor(() => expect(actions.deleteLabel).toHaveBeenCalledWith("l1"));
    await waitFor(() => expect(screen.queryByText("Delete “ui”?")).toBeNull());
  });

  it("says so when there are no labels", async () => {
    issues.listLabels.mockResolvedValue([]);
    mount(() => <LabelsSection />);
    expect(await screen.findByText("No labels yet.")).toBeTruthy();
  });
});

describe("NewLabelDialog", () => {
  it("links to the label manager from a task's label menu", async () => {
    mount(() => <NewLabelDialog open onClose={() => {}} onCreated={() => {}} />);
    const link = await screen.findByRole("link", { name: "Edit labels" });
    expect(link.getAttribute("href")).toBe("/TES/company/settings/labels");
    expect(screen.getByRole("button", { name: "Create and add" })).toBeTruthy();
  });

  it("drops the link inside the manager", async () => {
    mount(() => <NewLabelDialog open onClose={() => {}} onCreated={() => {}} submitLabel="Create" manageLink={false} />);
    expect(await screen.findByRole("button", { name: "Create" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Edit labels" })).toBeNull();
  });
});
