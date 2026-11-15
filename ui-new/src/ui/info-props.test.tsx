import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { SectionTitle as AgentSectionTitle, SwitchRow as AgentSwitchRow } from "@/agents/shared";
import { Card } from "@/apps/chat/parts";
import { Standalone } from "@/auth/Standalone";
import { CardNote, saveNote } from "@/projects/settings/shared";
import { InfoTip as RepeatInfoTip } from "@/recurring/RepeatMenu";
import { SectionTitle as AppSectionTitle, SwitchRow as AppSwitchRow } from "@/settings/app/shared";
import { CardHead } from "@/settings/company/shared";
import { ChoiceCard } from "./ChoiceCard";
import { Dialog } from "./Dialog";
import { InfoHeading, SettingsCard } from "./Field";
import { Switch } from "./Switch";

/*
 * Every component that takes `info` (InfoTip.tsx lists them): the "i" is a button named "About
 * <label>", its press opens the tip and doesn't reach the control, a form or the dialog, and with
 * no `info` there's no button at all.
 */

afterEach(cleanup);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Renders `ui` in a form and reports whether it was submitted. */
function inForm(ui: () => unknown) {
  let submitted = false;
  render(() => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submitted = true;
      }}
    >
      {ui() as never}
    </form>
  ));
  return () => submitted;
}

async function pressOpens(name: string, text: string) {
  fireEvent.click(screen.getByRole("button", { name }));
  expect(await screen.findByText(text, { selector: ".tip span" })).toBeTruthy();
}

describe("InfoHeading", () => {
  it("renders the heading at its level with a named button beside it", async () => {
    render(() => (
      <InfoHeading level={2} info="Where the code comes from.">
        Repositories
      </InfoHeading>
    ));
    const heading = screen.getByRole("heading", { level: 2, name: "Repositories" });
    const button = screen.getByRole("button", { name: "About Repositories" });
    expect(heading.contains(button)).toBe(false);
    await pressOpens("About Repositories", "Where the code comes from.");
  });

  it("is the bare heading without info", () => {
    render(() => (
      <InfoHeading level={4} class="disp">
        Repositories
      </InfoHeading>
    ));
    expect(screen.getByRole("heading", { level: 4 }).parentElement?.classList.contains("info-line")).toBe(false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("takes a name for a heading that isn't plain text", () => {
    render(() => (
      <InfoHeading level={3} info="Tip." infoLabel="About Repositories">
        <b>Repositories</b>
      </InfoHeading>
    ));
    expect(screen.getByRole("button", { name: "About Repositories" })).toBeTruthy();
  });

  it("is what SettingsCard's title uses", () => {
    render(() => <SettingsCard title="Task checkouts" info="Tip." />);
    expect(screen.getByRole("heading", { level: 3, name: "Task checkouts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "About Task checkouts" })).toBeTruthy();
  });
});

describe("Dialog info", () => {
  it("puts the button beside the title; a press opens the tip and keeps the dialog open", async () => {
    const [open, setOpen] = createSignal(true);
    let submitted = false;
    render(() => (
      <Dialog open={open()} onOpenChange={setOpen} title="Share" info="Who can see the task.">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitted = true;
          }}
        >
          <input aria-label="Email" />
        </form>
      </Dialog>
    ));
    const dialog = await screen.findByRole("dialog");
    const button = screen.getByRole("button", { name: "About Share" });
    expect(dialog.querySelector(".dialog-title")?.contains(button)).toBe(false);
    await pressOpens("About Share", "Who can see the task.");
    await flush();
    expect(open()).toBe(true);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(submitted).toBe(false);
  });

  it("doesn't start focus on the button, which would open its tip", async () => {
    render(() => (
      <Dialog open title="Share" info="Who can see the task.">
        <input aria-label="Email" />
      </Dialog>
    ));
    await screen.findByRole("dialog");
    await flush();
    expect(document.activeElement?.classList.contains("infotip")).toBe(false);
  });

  it("has no button without info", async () => {
    render(() => (
      <Dialog open title="Share" hideClose>
        <p>Body</p>
      </Dialog>
    ));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /^About/ })).toBeNull();
  });
});

describe("Switch info", () => {
  it("is named after the label, and a press doesn't toggle the switch", async () => {
    const [checked, setChecked] = createSignal(false);
    const submitted = inForm(() => <Switch label="Show archived" info="Includes archived tasks." checked={checked()} onChange={setChecked} />);
    const control = screen.getByRole("switch", { name: "Show archived" });
    await pressOpens("About Show archived", "Includes archived tasks.");
    expect(checked()).toBe(false);
    expect((control as HTMLInputElement).checked).toBe(false);
    expect(submitted()).toBe(false);
  });

  it("keeps the button visible when the label is hidden", () => {
    render(() => <Switch label="Show archived" labelHidden info="Tip." checked={false} onChange={() => {}} />);
    const button = screen.getByRole("button", { name: "About Show archived" });
    expect(button.closest(".sr-only")).toBeNull();
  });
});

describe("ChoiceCard info", () => {
  it("keeps the button outside the label, so a press doesn't pick the card", async () => {
    let picked = false;
    const submitted = inForm(() => (
      <ChoiceCard name="method" title="Client secret" info="A secret the provider issues." checked={false} onSelect={() => (picked = true)} />
    ));
    const radio = screen.getByRole("radio", { name: "Client secret" });
    expect(radio.closest("label")?.querySelector(".infotip")).toBeNull();
    await pressOpens("About Client secret", "A secret the provider issues.");
    expect(picked).toBe(false);
    expect((radio as HTMLInputElement).checked).toBe(false);
    expect(submitted()).toBe(false);
  });

  it("is picked through its label", () => {
    let picked = false;
    render(() => <ChoiceCard name="method" title="Client secret" checked={false} onSelect={() => (picked = true)} />);
    fireEvent.click(screen.getByText("Client secret"));
    expect(picked).toBe(true);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("settings helpers' info", () => {
  it("agent SwitchRow: named, doesn't toggle, help optional", async () => {
    const [checked, setChecked] = createSignal(false);
    const submitted = inForm(() => <AgentSwitchRow label="Can hire" info="Lets it hire agents." checked={checked()} onChange={setChecked} />);
    await pressOpens("About Can hire", "Lets it hire agents.");
    expect(checked()).toBe(false);
    expect(submitted()).toBe(false);
    expect(document.querySelector(".fhelp")).toBeNull();
  });

  it("app SwitchRow: named, doesn't toggle", async () => {
    const [checked, setChecked] = createSignal(false);
    const submitted = inForm(() => <AppSwitchRow label="Keyboard shortcuts" info="Single-key shortcuts." checked={checked()} onChange={setChecked} />);
    await pressOpens("About Keyboard shortcuts", "Single-key shortcuts.");
    expect(checked()).toBe(false);
    expect(submitted()).toBe(false);
  });

  it("agent and app SectionTitle", async () => {
    render(() => (
      <>
        <AgentSectionTitle title="Budget" info="What it may spend." />
        <AppSectionTitle title="General" info="Instance-wide settings." />
      </>
    ));
    expect(screen.getByRole("heading", { level: 2, name: "Budget" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "General" })).toBeTruthy();
    await pressOpens("About Budget", "What it may spend.");
    await pressOpens("About General", "Instance-wide settings.");
  });

  it("company CardHead keeps its id on the heading", async () => {
    render(() => <CardHead id="cs-people" title="People" info="Who's in the organization." />);
    expect(screen.getByRole("heading", { level: 3, name: "People" }).id).toBe("cs-people");
    await pressOpens("About People", "Who's in the organization.");
  });

  it("chat Card passes info to its SettingsCard", async () => {
    render(() => <Card title="Task defaults" info="What new tasks get." />);
    await pressOpens("About Task defaults", "What new tasks get.");
  });

  it("Standalone puts the button beside the page title", async () => {
    render(() => <Standalone title="Sign in" info="Use your Paperclip account." />);
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    await pressOpens("About Sign in", "Use your Paperclip account.");
  });

  it("none of them render a button without info", () => {
    render(() => (
      <>
        <AgentSwitchRow label="Can hire" help="Visible." checked={false} onChange={() => {}} />
        <AppSwitchRow label="Shortcuts" checked={false} onChange={() => {}} />
        <AgentSectionTitle title="Budget" />
        <AppSectionTitle title="General" />
        <CardHead title="People" />
        <Card title="Task defaults" />
        <Standalone title="Sign in" />
      </>
    ));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Visible.")).toBeTruthy();
  });
});

describe("recurring's InfoTip", () => {
  it("opens on a press, like ui/InfoTip", async () => {
    render(() => <RepeatInfoTip label="About inputs" text="Inputs fill the placeholders." />);
    const button = screen.getByRole("button", { name: "About inputs" });
    expect(button.classList.contains("infotip")).toBe(true);
    await pressOpens("About inputs", "Inputs fill the placeholders.");
  });
});

describe("CardNote and saveNote", () => {
  it("CardNote still shows children beside the save status", () => {
    render(() => (
      <CardNote state="saving" error={null}>
        Changes save as you make them.
      </CardNote>
    ));
    expect(screen.getByText("Changes save as you make them.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Saving…");
  });

  it("CardNote works without children", () => {
    render(() => <CardNote state="saved" error={null} />);
    expect(screen.getByRole("status").textContent).toContain("Saved");
  });

  it("saveNote is nothing while idle, so a card has no empty description", () => {
    expect(saveNote("idle", null)).toBeUndefined();
    render(() => <SettingsCard title="Details" description={saveNote("error", "Couldn't save.")} />);
    expect(screen.getByRole("alert").textContent).toBe("Couldn't save.");
  });
});
