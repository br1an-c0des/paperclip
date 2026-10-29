import { describe, expect, it } from "vitest";
import { hasOpenDialog, isTextInputTarget, resolveShortcut } from "./shortcuts";

const idle = { goArmed: false, dialogOpen: false };
const key = (value: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ key: value, metaKey: false, ctrlKey: false, altKey: false, target: document.body, ...extra }) as KeyboardEvent;

describe("resolveShortcut", () => {
  it("maps the bare keys", () => {
    expect(resolveShortcut(key("c"), idle)).toBe("new-task");
    expect(resolveShortcut(key("/"), idle)).toBe("search");
    expect(resolveShortcut(key("?"), idle)).toBe("cheatsheet");
    expect(resolveShortcut(key("x"), idle)).toBeNull();
  });

  it("runs the g chords", () => {
    expect(resolveShortcut(key("g"), idle)).toBe("arm-g");
    expect(resolveShortcut(key("i"), { ...idle, goArmed: true })).toBe("go-inbox");
    expect(resolveShortcut(key("d"), { ...idle, goArmed: true })).toBe("go-dashboard");
    expect(resolveShortcut(key("c"), { ...idle, goArmed: true })).toBeNull();
  });

  it("opens the palette with Cmd/Ctrl+K even from a field or a dialog", () => {
    const input = document.createElement("input");
    expect(resolveShortcut(key("k", { metaKey: true, target: input }), { goArmed: false, dialogOpen: true })).toBe("palette");
    expect(resolveShortcut(key("K", { ctrlKey: true }), idle)).toBe("palette");
  });

  it("stays quiet while typing, in a dialog, or with other modifiers", () => {
    const textarea = document.createElement("textarea");
    expect(resolveShortcut(key("c", { target: textarea }), idle)).toBeNull();
    expect(resolveShortcut(key("c"), { goArmed: false, dialogOpen: true })).toBeNull();
    expect(resolveShortcut(key("c", { ctrlKey: true }), idle)).toBeNull();
  });
});

describe("isTextInputTarget", () => {
  it("treats text fields as typing targets, not checkboxes or buttons", () => {
    const text = document.createElement("input");
    const box = document.createElement("input");
    box.type = "checkbox";
    expect(isTextInputTarget(text)).toBe(true);
    expect(isTextInputTarget(box)).toBe(false);
    expect(isTextInputTarget(document.createElement("button"))).toBe(false);
  });
});

describe("hasOpenDialog", () => {
  it("looks for the Dialog wrapper's layer mark", () => {
    const root = document.createElement("div");
    expect(hasOpenDialog(root)).toBe(false);
    root.innerHTML = '<div data-layer="menu"></div>';
    expect(hasOpenDialog(root)).toBe(false);
    root.innerHTML = '<div data-layer="dialog"></div>';
    expect(hasOpenDialog(root)).toBe(true);
  });
});

describe("shortcuts on an open task", () => {
  it("needs a task for y and g c, and a panel to toggle for ]", () => {
    expect(resolveShortcut(key("["), idle)).toBe("toggle-nav");
    expect(resolveShortcut(key("]"), idle)).toBeNull();
    expect(resolveShortcut(key("]"), { ...idle, panelToggle: true })).toBe("toggle-panel");
    expect(resolveShortcut(key("y"), idle)).toBeNull();
    expect(resolveShortcut(key("y"), { ...idle, taskOpen: true })).toBe("archive-task");
    expect(resolveShortcut(key("c"), { ...idle, goArmed: true, taskOpen: true })).toBe("focus-composer");
    expect(resolveShortcut(key("c"), { ...idle, taskOpen: true })).toBe("new-task");
  });
});
