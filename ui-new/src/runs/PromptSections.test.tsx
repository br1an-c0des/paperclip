import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freshRecord, resumedRecord, unmatchedRecord } from "./fixtures/prompt-records";
import { promptViewFromLegacyPrompt, promptViewFromRecord } from "./prompt-sections";
import { PromptSections } from "./PromptSections";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const group = (name: string) => screen.getByRole("heading", { name }).closest("section")!;
const sectionNamed = (label: string) =>
  [...document.querySelectorAll<HTMLDetailsElement>("details.ps-sec")].find((el) => el.querySelector(".ps-label")?.textContent === label)!;

describe("PromptSections", () => {
  it("shows the two groups, each section folded with its label, reason, source, size and delivery", () => {
    render(() => <PromptSections view={promptViewFromRecord(freshRecord)} />);
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["System prompt", "First message"]);
    const system = within(group("System prompt"));
    expect(system.getByText("Agent instructions")).toBeTruthy();
    const sections = [...document.querySelectorAll<HTMLDetailsElement>("details.ps-sec")];
    expect(sections).toHaveLength(5);
    expect(sections.every((el) => !el.open)).toBe(true);
    const guidance = sectionNamed("Communication guidance");
    const summary = guidance.querySelector("summary")!.textContent!;
    for (const shown of ["a new session", "paperclipTaskCommunicationGuidance", "37 characters", "New sessions only"]) expect(summary).toContain(shown);
    expect(guidance.querySelector("summary button[aria-label='About Communication guidance']")).toBeTruthy();
  });

  it("unfolds a section to its parts", () => {
    render(() => <PromptSections view={promptViewFromRecord(freshRecord)} />);
    const wake = sectionNamed("Wake");
    fireEvent.click(wake.querySelector("summary")!);
    expect(wake.open).toBe(true);
    const parts = [...wake.querySelectorAll(".ps-part")];
    expect(parts.map((part) => part.querySelector(".ps-part-label")!.textContent)).toEqual(["Comments", "Continuation"]);
    expect(parts[0]!.querySelector("pre")!.textContent).toBe("## Comments\n\nBrian: please look at the failing test.");
    const brief = sectionNamed("Task brief");
    expect(brief.querySelectorAll(".ps-part")).toHaveLength(0);
    expect(brief.querySelector("pre")!.textContent).toBe("# TRA-41 Fix the parser\n\nThe parser drops the last line.");
  });

  it("copies the whole first message", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(() => <PromptSections view={promptViewFromRecord(freshRecord)} />);
    fireEvent.click(within(group("First message")).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(freshRecord.firstMessage.map((section) => section.text).join("\n\n")));
    expect(within(group("System prompt")).queryByRole("button", { name: "Copy" })).toBeNull();
  });

  it("says a resumed run's system prompt was kept from the session's start", () => {
    render(() => <PromptSections view={promptViewFromRecord(resumedRecord)} />);
    expect(within(group("System prompt")).getByText("Kept from the session's start")).toBeTruthy();
    expect(group("System prompt").querySelectorAll("details.ps-sec")).toHaveLength(0);
  });

  it("shows a note when the sections didn't match what was sent", () => {
    render(() => <PromptSections view={promptViewFromRecord(unmatchedRecord)} />);
    expect(screen.getByRole("note").textContent).toContain("didn't match");
  });

  it("shows no mismatch note when the sections matched", () => {
    render(() => <PromptSections view={promptViewFromRecord(freshRecord)} />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("shows a run recorded before step 5 as one section", () => {
    render(() => <PromptSections view={promptViewFromLegacyPrompt("You are agent 7c1e.")} />);
    const sections = [...document.querySelectorAll("details.ps-sec")];
    expect(sections).toHaveLength(1);
    expect(sections[0]!.querySelector(".ps-label")!.textContent).toBe("Recorded before sections");
    expect(within(group("System prompt")).getByText("Not recorded for this run")).toBeTruthy();
  });

  it("renders a pending marker through the slot it's given", () => {
    const view = promptViewFromRecord({
      ...freshRecord,
      firstMessage: [{ ...freshRecord.firstMessage[2]!, pending: "filled in at launch" }],
    });
    render(() => <PromptSections view={view} renderPending={(pending) => <span class="pending-mark">{pending}</span>} />);
    expect(document.querySelector(".pending-mark")!.textContent).toBe("filled in at launch");
  });
});
