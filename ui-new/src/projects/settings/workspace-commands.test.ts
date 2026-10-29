import type { ProjectWorkspace } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { commandEntries, commandsRequest, commandsText, parseCommands } from "./workspace-commands";

const withRuntime = (workspaceRuntime: Record<string, unknown> | null): Pick<ProjectWorkspace, "runtimeConfig"> => ({
  runtimeConfig: { workspaceRuntime, desiredState: "manual", serviceStates: null },
});

describe("commandsText", () => {
  it("is empty without commands, and pretty JSON with them", () => {
    expect(commandsText(undefined)).toBe("");
    expect(commandsText({ runtimeConfig: null })).toBe("");
    expect(commandsText(withRuntime({}))).toBe("");
    expect(commandsText(withRuntime({ commands: [] }))).toBe('{\n  "commands": []\n}');
  });
});

describe("parseCommands", () => {
  it("takes empty text as none, and needs a JSON object otherwise", () => {
    expect(parseCommands("  ")).toEqual({ ok: true, value: null });
    expect(parseCommands('{"commands":[]}')).toEqual({ ok: true, value: { commands: [] } });
    expect(parseCommands("[1]")).toMatchObject({ ok: false, error: expect.stringMatching(/JSON object/) });
    expect(parseCommands("null")).toMatchObject({ ok: false });
    expect(parseCommands("{ commands: }")).toMatchObject({ ok: false, error: expect.stringMatching(/valid JSON/) });
  });
});

describe("commandsRequest", () => {
  const saved = withRuntime({ commands: [{ id: "web", command: "pnpm dev" }] });

  it("sends nothing when the commands didn't change, even reformatted", () => {
    expect(commandsRequest(saved, commandsText(saved))).toEqual({ kind: "none" });
    expect(commandsRequest(saved, '{"commands":[{"id":"web","command":"pnpm dev"}]}')).toEqual({ kind: "none" });
    expect(commandsRequest(undefined, "")).toEqual({ kind: "none" });
  });

  it("sets only workspaceRuntime, so the server keeps the services' desired states", () => {
    expect(commandsRequest(saved, '{"commands":[]}')).toEqual({ kind: "set", data: { runtimeConfig: { workspaceRuntime: { commands: [] } } } });
    expect(commandsRequest(undefined, '{"services":[]}')).toEqual({ kind: "set", data: { runtimeConfig: { workspaceRuntime: { services: [] } } } });
  });

  it("clears the commands when emptied, and reports bad JSON", () => {
    expect(commandsRequest(saved, "")).toEqual({ kind: "set", data: { runtimeConfig: { workspaceRuntime: null } } });
    expect(commandsRequest(saved, "{")).toMatchObject({ kind: "problem" });
  });
});

describe("commandEntries", () => {
  it("names commands with their kind, and falls back to the legacy services list", () => {
    expect(commandEntries(withRuntime(null))).toEqual([]);
    expect(
      commandEntries(withRuntime({ commands: [{ id: "web", kind: "service" }, { name: "db:migrate", kind: "job" }, { command: "pnpm worker" }, "junk"] })),
    ).toEqual([
      { name: "web", kind: "service" },
      { name: "db:migrate", kind: "job" },
      { name: "pnpm worker", kind: "service" },
    ]);
    expect(commandEntries(withRuntime({ services: [{ name: "api" }, {}] }))).toEqual([
      { name: "api", kind: "service" },
      { name: "Command 2", kind: "service" },
    ]);
  });
});
