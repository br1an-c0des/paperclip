import { afterEach, describe, expect, it } from "vitest";
import { clearToasts, toasts } from "@/ui/Toast";
import { configurationWarningMessages, toastConfigurationWarnings } from "./configuration-warnings";

const warning = (message: string) => ({ code: "protected_environment_variable" as const, field: "env.PATH", message });

describe("configuration warnings", () => {
  afterEach(() => clearToasts());

  it("joins the messages, and is null without any", () => {
    expect(configurationWarningMessages({ configurationWarnings: [warning("PATH is protected."), warning("HOME is protected.")] })).toBe("PATH is protected. HOME is protected.");
    expect(configurationWarningMessages({ configurationWarnings: [] })).toBeNull();
    expect(configurationWarningMessages({ id: "project" })).toBeNull();
    expect(configurationWarningMessages(null)).toBeNull();
    expect(configurationWarningMessages({ configurationWarnings: [{ message: " " }, null] })).toBeNull();
  });

  it("shows a warning toast only when the save carried warnings", () => {
    expect(toastConfigurationWarnings({ id: "routine" }, "Routine saved")).toBe(false);
    expect(toasts()).toHaveLength(0);
    expect(toastConfigurationWarnings({ configurationWarnings: [warning("PATH is protected.")] }, "Project saved")).toBe(true);
    expect(toasts()).toMatchObject([{ tone: "warn", title: "Project saved", body: "PATH is protected." }]);
  });
});
