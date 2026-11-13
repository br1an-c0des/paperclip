import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsCard, SettingsRow } from "./Field";
import { InfoTip } from "./InfoTip";

afterEach(cleanup);

describe("InfoTip", () => {
  it("is a named button described by its text", () => {
    render(() => <InfoTip label="About Repositories">Where the code comes from.</InfoTip>);
    const button = screen.getByRole("button", { name: "About Repositories" });
    expect(button.getAttribute("type")).toBe("button");
    const description = document.getElementById(button.getAttribute("aria-describedby")!);
    expect(description?.textContent).toBe("Where the code comes from.");
  });

  it("opens on a click and stays open until the next one", async () => {
    render(() => <InfoTip label="About Repositories">Where the code comes from.</InfoTip>);
    const button = screen.getByRole("button", { name: "About Repositories" });
    fireEvent.click(button);
    expect(await screen.findByText("Where the code comes from.", { selector: ".tip span" })).toBeTruthy();
    fireEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector(".tip")).toBeNull();
  });

  it("doesn't submit a form or toggle the control of a row's label", () => {
    let submitted = false;
    render(() => (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <SettingsCard title="Task checkouts" info="Whether each task gets its own worktree.">
          <SettingsRow label="Separate checkout per task" info="Lets tasks use their own worktree." for="row-check">
            <input id="row-check" type="checkbox" />
          </SettingsRow>
        </SettingsCard>
      </form>
    ));
    expect(screen.getByRole("button", { name: "About Task checkouts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About Separate checkout per task" }));
    const checkbox = screen.getByLabelText("Separate checkout per task") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(submitted).toBe(false);
  });
});
