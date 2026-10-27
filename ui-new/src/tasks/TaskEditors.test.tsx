import type { Issue } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DescriptionEditor, StatusControl, TitleEditor } from "./TaskEditors";

afterEach(cleanup);

describe("StatusControl", () => {
  it("steps the status on and marks it done", () => {
    const onChange = vi.fn();
    render(() => <StatusControl status="in_progress" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to In review" }));
    expect(onChange).toHaveBeenLastCalledWith({ status: "in_review" });
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(onChange).toHaveBeenLastCalledWith({ status: "done" });
  });

  it("has no step or Mark done once the task is closed", () => {
    render(() => <StatusControl status="done" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /Move to/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
  });
});

describe("TitleEditor", () => {
  it("saves a changed title on Enter and drops it on Escape", async () => {
    const onChange = vi.fn();
    render(() => <TitleEditor title="Old title" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit the title/ }));
    const field = screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement;
    field.value = "New title";
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({ title: "New title" });

    fireEvent.click(screen.getByRole("button", { name: /Edit the title/ }));
    const again = screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement;
    again.value = "Discarded";
    fireEvent.keyDown(again, { key: "Escape" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Edit the title/ })).toBeTruthy();
  });
});

describe("DescriptionEditor", () => {
  const task = { id: "t1", description: "First line", descriptionTruncated: false } as Issue;

  it("renders Markdown and saves an edit", () => {
    const onChange = vi.fn();
    render(() => <DescriptionEditor task={task} onChange={onChange} />);
    expect(screen.getByText("First line")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit the description" }));
    const field = screen.getByRole("textbox", { name: "Description, in Markdown" });
    fireEvent.input(field, { target: { value: "Second line\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenLastCalledWith({ description: "Second line" });
  });

  it("offers to add one when there's none", () => {
    render(() => <DescriptionEditor task={{ ...task, description: null }} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a description" }));
    expect(screen.getByRole("textbox", { name: "Description, in Markdown" })).toBeTruthy();
  });
});
