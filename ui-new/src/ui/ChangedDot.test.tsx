import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { SwitchRow } from "@/agents/shared";
import { extraChangedFrom } from "@/agents/harness-model";
import { continueFrom, heartbeatFrom } from "@/agents/runtime-dots";
import { runtimeDraft } from "@/agents/agent-model";
import { changedText, ChangedDot, savedText, type Changed } from "./ChangedDot";
import { Field, SettingsRow } from "./Field";

afterEach(cleanup);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const dot = (name: string) => screen.queryByRole("button", { name: `Unsaved change: ${name}` });
const description = (button: HTMLElement) => document.getElementById(button.getAttribute("aria-describedby")!)?.textContent;

describe("changedText", () => {
  it("says what the setting was, or only that it changed", () => {
    expect(changedText({ from: "Every 5 minutes" })).toBe("Changed from Every 5 minutes. Not saved yet.");
    expect(changedText(true)).toBe("Changed. Not saved yet.");
    expect(changedText(false)).toBeNull();
    expect(changedText(undefined)).toBeNull();
  });

  it("puts a saved value on one short line", () => {
    expect(savedText("")).toBe("empty");
    expect(savedText("  ", "not set")).toBe("not set");
    expect(savedText("line one\n  line two")).toBe("line one line two");
    expect(savedText("x".repeat(80))).toHaveLength(60);
    expect(savedText("x".repeat(80)).endsWith("…")).toBe(true);
  });
});

describe("ChangedDot", () => {
  it("is a named button described by its text, only while there's a change", async () => {
    const [changed, setChanged] = createSignal<Changed>(false);
    render(() => <ChangedDot label="Model" changed={changed()} />);
    expect(dot("Model")).toBeNull();
    setChanged({ from: "Claude Sonnet 5" });
    const button = dot("Model")!;
    expect(button.getAttribute("type")).toBe("button");
    expect(description(button)).toBe("Changed from Claude Sonnet 5. Not saved yet.");
    // A tap opens the tip (phones have no hover).
    fireEvent.click(button);
    expect(await screen.findByText("Changed from Claude Sonnet 5. Not saved yet.", { selector: ".tip span" })).toBeTruthy();
    setChanged(false);
    await flush();
    expect(dot("Model")).toBeNull();
  });
});

describe("the rows' changed prop", () => {
  it("lights SettingsRow's dot after the label and its i, and puts it out", () => {
    const [changed, setChanged] = createSignal<Changed>({ from: "20 runs" });
    render(() => (
      <SettingsRow label="Runs at once" info="How many at a time." for="runs" changed={changed()}>
        <input id="runs" />
      </SettingsRow>
    ));
    const line = screen.getByText("Runs at once").parentElement!;
    const buttons = [...line.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
    expect(buttons).toEqual(["About Runs at once", "Unsaved change: Runs at once"]);
    expect(line.closest(".frow")?.hasAttribute("data-changed")).toBe(true);
    // The dot isn't part of the control's name.
    expect(screen.getByLabelText("Runs at once").id).toBe("runs");
    setChanged(false);
    expect(dot("Runs at once")).toBeNull();
    expect(line.closest(".frow")?.hasAttribute("data-changed")).toBe(false);
  });

  it("lights a row without an i too, and Field's and SwitchRow's", () => {
    render(() => (
      <>
        <SettingsRow label="Model" changed={{ from: "the default" }}>
          <span />
        </SettingsRow>
        <Field label="Name" changed>
          <input />
        </Field>
        <SwitchRow label="Browser access" checked onChange={() => {}} changed={{ from: "off" }} />
      </>
    ));
    expect(description(dot("Model")!)).toBe("Changed from the default. Not saved yet.");
    expect(description(dot("Name")!)).toBe("Changed. Not saved yet.");
    expect(description(dot("Browser access")!)).toBe("Changed from off. Not saved yet.");
  });

  it("doesn't toggle the row's switch or submit a form when pressed", () => {
    let submitted = false;
    let toggled = false;
    render(() => (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <SwitchRow label="Browser access" checked={false} onChange={() => (toggled = true)} changed={{ from: "on" }} />
      </form>
    ));
    fireEvent.click(dot("Browser access")!);
    expect(toggled).toBe(false);
    expect(submitted).toBe(false);
  });
});

describe("what the dots say", () => {
  it("never shows a secret's value", () => {
    expect(changedText(extraChangedFrom({ key: "apiKey", label: "API key", type: "text" }, "sk-123"))).toBe("Changed. Not saved yet.");
    expect(changedText(extraChangedFrom({ key: "token", label: "Token", type: "text", meta: { secret: true } }, ""))).toBe("Changed. Not saved yet.");
  });

  it("names a harness setting's saved option, switch or text", () => {
    const select = { key: "engine", label: "Execution engine", type: "select" as const, options: [{ value: "auto", label: "Default (ACP)" }] };
    expect(changedText(extraChangedFrom(select, "auto"))).toBe("Changed from Default (ACP). Not saved yet.");
    expect(changedText(extraChangedFrom({ key: "fast", label: "Fast", type: "toggle" }, false))).toBe("Changed from off. Not saved yet.");
    expect(changedText(extraChangedFrom({ key: "dir", label: "Directory", type: "text" }, ""))).toBe("Changed from empty. Not saved yet.");
  });

  it("describes the heartbeat and follow-up rows", () => {
    const base = runtimeDraft({ adapterType: "claude_local", adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: true, intervalSec: 300 } }, defaultEnvironmentId: null });
    expect(heartbeatFrom(base, { ...base, heartbeatEnabled: false })).toEqual({ from: "on, every 5 minutes" });
    expect(heartbeatFrom(base, { ...base, intervalSec: "900" })).toEqual({ from: "every 5 minutes" });
    expect(continueFrom(base)).toEqual({ from: "on, up to 2 more runs, 1 second apart" });
    expect(continueFrom({ ...base, continueEnabled: false })).toEqual({ from: "off" });
  });
});
