import type { Issue, IssueRecoveryAction } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The forms added in the 2026-11-10 sync: confirming a run that never recorded its process stopped
 * (#20310) and recording original-host containment (#19813). Nothing reaches a server: the calls
 * are mocked.
 */

const api = vi.hoisted(() => ({
  confirmRunStopped: vi.fn(),
  recordControllerContainment: vi.fn(),
}));
vi.mock("@/api/issues", () => ({
  confirmRunStopped: api.confirmRunStopped,
  recordControllerContainment: api.recordControllerContainment,
  confirmOwnerGone: vi.fn(),
  issuesApi: {},
}));
let localTrusted = true;
vi.mock("./TaskActions", () => ({ useBoardAccess: () => () => ({ access: null, localTrusted, youId: "u1" }) }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "c1", issuePrefix: "TES" }) }));
vi.mock("./people", () => ({ useTaskPeople: () => ({}) }));

const { ConfirmServerStopped, ContainmentForm } = await import("./TaskRecovery");

afterEach(cleanup);
beforeEach(() => {
  localTrusted = true;
  api.confirmRunStopped.mockReset().mockResolvedValue({ runId: "run-9", alreadyStopped: false, presentation: null });
  api.recordControllerContainment.mockReset().mockResolvedValue({});
});

const task = { id: "t1", companyId: "c1", status: "in_progress" } as Issue;

function mount(view: () => unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => <QueryClientProvider client={client}>{view() as never}</QueryClientProvider>);
}

const type = (element: HTMLElement, value: string) => fireEvent.input(element, { target: { value } });

describe("confirm a run that never recorded its process stopped (#20310)", () => {
  it("asks how it was checked, then sends the run and the evidence", async () => {
    mount(() => <ConfirmServerStopped stop={{ kind: "run", runId: "run-9" }} actionId={null} task={task} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm it stopped" }));
    const area = screen.getByLabelText("How did you confirm that no agent is still working on this task?");
    const submit = screen.getByRole("button", { name: "Confirm and resume" }) as HTMLButtonElement;
    type(area, "checked");
    expect(submit.disabled).toBe(true);
    type(area, "No codex process for this task is running on the host.");
    fireEvent.click(submit);
    await screen.findByText("Starting your Retry…");
    expect(api.confirmRunStopped).toHaveBeenCalledWith("t1", { runId: "run-9", stopEvidence: "No codex process for this task is running on the host." });
  });

  it("tells someone who can't confirm who can", () => {
    localTrusted = false;
    mount(() => <ConfirmServerStopped stop={{ kind: "run", runId: "run-9" }} actionId={null} task={task} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("A company owner or admin can confirm that the previous run stopped.")).toBeTruthy();
  });
});

describe("original-host containment (#19813)", () => {
  const DIGEST = "a".repeat(64);
  const RUN = "00000000-0000-4000-8000-000000000041";
  const action = { id: "ra1" } as IssueRecoveryAction;

  it("needs both stops confirmed separately, then records them without retrying", async () => {
    mount(() => <ContainmentForm containment={{ runId: RUN, digest: DIGEST }} action={action} task={task} />);
    expect(document.body.textContent).toContain("doesn't retry the task");
    expect(document.body.textContent).not.toContain(DIGEST);
    const record = screen.getByRole("button", { name: "Record containment" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Reviewed external action outcomes"), { target: { value: "mixed" } });
    type(screen.getByLabelText("Original-host containment evidence, and actions that must not be repeated"), "Both stopped on the original host; actions reviewed.");
    const [controller, provider] = screen.getAllByRole("checkbox");
    expect(record.disabled).toBe(true);
    fireEvent.click(controller!);
    expect(record.disabled).toBe(true);
    fireEvent.click(provider!);
    expect(record.disabled).toBe(false);
    fireEvent.click(record);
    await screen.findByText("Containment recorded. Use Retry when you want another attempt.");
    expect(api.recordControllerContainment).toHaveBeenCalledWith("t1", {
      actionId: "ra1",
      outcome: "restored",
      sourceIssueStatus: "in_progress",
      executionReconciliation: {
        runId: RUN,
        controllerStopped: true,
        providerStopped: true,
        controllerAuthorityDigest: DIGEST,
        actionOutcome: "mixed",
        outcomeEvidence: "Both stopped on the original host; actions reviewed.",
      },
    });
  });

  it("shows no form to someone without owner-stop authority", () => {
    localTrusted = false;
    mount(() => <ContainmentForm containment={{ runId: RUN, digest: DIGEST }} action={action} task={task} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.body.textContent).toContain("A company owner, company admin or instance admin");
  });
});
