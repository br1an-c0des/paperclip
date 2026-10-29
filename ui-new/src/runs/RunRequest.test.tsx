import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunRequest } from "./RunRequest";
import type { RuntimeRequest } from "./transcript-model";

/* Answering a runtime request from the transcript; the request itself is mocked. */

afterEach(cleanup);

const permission: RuntimeRequest = {
  requestId: "q1",
  requestKind: "command_approval",
  turnId: "turn-1",
  requestType: "permission",
  status: "pending",
  prompt: "Run pnpm migrate?",
  choices: [
    { key: "accept", label: "Allow once" },
    { key: "decline", label: "Deny" },
  ],
  fields: [],
};

describe("RunRequest", () => {
  it("answers a permission with the chosen action while the run goes", async () => {
    const onAnswer = vi.fn(async () => {});
    render(() => <RunRequest request={permission} live onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(permission, { action: "accept" }));
  });

  it("submits input fields", async () => {
    const onAnswer = vi.fn(async () => {});
    const input: RuntimeRequest = { ...permission, requestKind: "user_input", requestType: "input", choices: [], fields: [{ name: "branch", label: "Branch", placeholder: null }] };
    render(() => <RunRequest request={input} live onAnswer={onAnswer} />);
    fireEvent.input(screen.getByLabelText("Branch"), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(input, { action: "submit", values: { branch: "main" } }));
  });

  it("shows an answered or ended request without its choices", () => {
    render(() => <RunRequest request={{ ...permission, status: "resolved", resolvedAction: "decline" }} live onAnswer={vi.fn()} />);
    expect(screen.getByText("Answered · Deny")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    cleanup();
    render(() => <RunRequest request={permission} live={false} onAnswer={vi.fn()} />);
    expect(screen.getByText(/run has ended/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
  });
});
