import { describe, expect, it } from "vitest";
import { enterKeyHint, isPickKey, isSubmitKey, submitHint, submitKeyFor } from "./submit-key";

const key = (init: Partial<KeyboardEvent> = {}) =>
  ({ key: "Enter", shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, isComposing: false, keyCode: 13, ...init }) as KeyboardEvent;

describe("submitKeyFor", () => {
  it("sends with Enter unless the legacy preference is on", () => {
    expect(submitKeyFor({ enableLegacyComposerSubmit: false })).toBe("enter");
    expect(submitKeyFor({} as never)).toBe("enter");
    expect(submitKeyFor({ enableLegacyComposerSubmit: true })).toBe("mod-enter");
  });

  it("keeps plain Enter a new line until the settings have loaded", () => {
    expect(submitKeyFor(undefined)).toBe("mod-enter");
    expect(submitKeyFor(null)).toBe("mod-enter");
  });
});

describe("isSubmitKey", () => {
  it("sends on Enter, and on Cmd/Ctrl+Enter, by default", () => {
    expect(isSubmitKey(key(), "enter")).toBe(true);
    expect(isSubmitKey(key({ metaKey: true }), "enter")).toBe(true);
    expect(isSubmitKey(key({ ctrlKey: true }), "enter")).toBe(true);
  });

  it("leaves Shift+Enter and Alt+Enter to add a line", () => {
    expect(isSubmitKey(key({ shiftKey: true }), "enter")).toBe(false);
    expect(isSubmitKey(key({ altKey: true }), "enter")).toBe(false);
    expect(isSubmitKey(key({ shiftKey: true, ctrlKey: true }), "mod-enter")).toBe(false);
  });

  it("sends only on Cmd/Ctrl+Enter with the legacy preference", () => {
    expect(isSubmitKey(key(), "mod-enter")).toBe(false);
    expect(isSubmitKey(key({ metaKey: true }), "mod-enter")).toBe(true);
    expect(isSubmitKey(key({ ctrlKey: true }), "mod-enter")).toBe(true);
  });

  it("never sends while an input method is composing", () => {
    expect(isSubmitKey(key({ isComposing: true }), "enter")).toBe(false);
    expect(isSubmitKey(key({ keyCode: 229 }), "enter")).toBe(false);
    expect(isSubmitKey(key({ isComposing: true, metaKey: true }), "mod-enter")).toBe(false);
  });

  it("ignores other keys", () => {
    expect(isSubmitKey(key({ key: "a" }), "enter")).toBe(false);
  });
});

describe("isPickKey", () => {
  it("picks with Enter or Tab, but not while composing or with a modifier", () => {
    expect(isPickKey(key())).toBe(true);
    expect(isPickKey(key({ key: "Tab" }))).toBe(true);
    expect(isPickKey(key({ shiftKey: true }))).toBe(false);
    expect(isPickKey(key({ ctrlKey: true }))).toBe(false);
    expect(isPickKey(key({ metaKey: true }))).toBe(false);
    expect(isPickKey(key({ isComposing: true }))).toBe(false);
    expect(isPickKey(key({ keyCode: 229 }))).toBe(false);
  });
});

describe("hints", () => {
  it("names the key, and labels the soft keyboard's Enter", () => {
    expect(submitHint("enter")).toBe("Enter");
    expect(submitHint("mod-enter")).toMatch(/^(⌘|Ctrl)\+Enter$/);
    expect(enterKeyHint("enter")).toBe("send");
    expect(enterKeyHint("mod-enter")).toBe("enter");
  });
});
