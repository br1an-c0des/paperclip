import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

let preference: "prompt" | "allowed" | "not_allowed" = "prompt";
const save = vi.fn(async (_taskId: string, input: { vote: string; targetId: string }) => ({ id: "v1", ...input }));

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
vi.mock("@/api/feedback-votes", () => ({ feedbackVotesApi: { list: vi.fn(async () => []), save: (taskId: string, input: { vote: string; targetId: string }) => save(taskId, input) } }));
vi.mock("@/api/instance-settings", () => ({ instanceSettingsApi: { general: vi.fn(async () => ({ feedbackDataSharingPreference: preference })) } }));

const { FeedbackVotes } = await import("./FeedbackVotes");

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <FeedbackVotes taskId="t1" commentId="c1" youId="me" />
    </QueryClientProvider>
  ));
}

describe("FeedbackVotes", () => {
  beforeEach(() => {
    save.mockClear();
    preference = "prompt";
  });

  it("asks about sharing first under 'Ask each time', with the terms", async () => {
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("button", { name: "Helpful" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("This vote is always saved here.");
    expect(screen.getByRole("link", { name: "Read the terms of service" }).getAttribute("href")).toBe("https://paperclip.ing/tos");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Don't allow" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("t1", { targetType: "issue_comment", targetId: "c1", vote: "up" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Helpful" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("saves straight away under 'Always allow', sharing the vote", async () => {
    preference = "allowed";
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Helpful" })).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("button", { name: "Helpful" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("t1", { targetType: "issue_comment", targetId: "c1", vote: "up", allowSharing: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks what could have been better after a thumbs down, and saves the note", async () => {
    preference = "not_allowed";
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("button", { name: "Needs work" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("t1", { targetType: "issue_comment", targetId: "c1", vote: "down" }));
    const note = await screen.findByRole("textbox", { name: "What could have been better?" });
    fireEvent.input(note, { target: { value: "Missed the tests" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith("t1", { targetType: "issue_comment", targetId: "c1", vote: "down", reason: "Missed the tests" }));
  });
});
