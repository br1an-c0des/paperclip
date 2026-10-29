import type { PluginLocalFolderDeclaration } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { PluginLocalFolderStatus } from "@/api/plugins";
import { folderChecks, folderPathProblem, folderRequirements, folderSaveInput, rootNotInspected, savedMessage } from "./local-folders-model";

const declaration: PluginLocalFolderDeclaration = {
  folderKey: "vault",
  displayName: "Vault",
  access: "readWrite",
  requiredDirectories: ["notes"],
  requiredFiles: ["index.md", "config.json"],
};

const status = (patch: Partial<PluginLocalFolderStatus> = {}): PluginLocalFolderStatus => ({
  folderKey: "vault",
  configured: true,
  path: "/srv/vault",
  realPath: "/srv/vault",
  access: "readWrite",
  readable: true,
  writable: true,
  requiredDirectories: ["notes"],
  requiredFiles: ["index.md", "config.json"],
  missingDirectories: [],
  missingFiles: ["config.json"],
  healthy: false,
  problems: [],
  checkedAt: "2026-10-29T00:00:00.000Z",
  ...patch,
});

describe("local folders", () => {
  it("accepts only full paths", () => {
    expect(folderPathProblem("  ")).toBe("Enter the folder's path.");
    expect(folderPathProblem("notes/vault")).toMatch(/full path/);
    expect(folderPathProblem("/srv/vault")).toBeNull();
    expect(folderPathProblem("C:\\vault")).toBeNull();
    expect(folderPathProblem("\\\\share\\vault")).toBeNull();
  });

  it("saves the trimmed path with the manifest's access and requirements", () => {
    expect(folderSaveInput(declaration, " /srv/vault ")).toEqual({
      path: "/srv/vault",
      access: "readWrite",
      requiredDirectories: ["notes"],
      requiredFiles: ["index.md", "config.json"],
    });
  });

  it("doesn't ask for write access a read-only folder doesn't need", () => {
    const checks = folderChecks({ ...declaration, access: "read" }, status({ access: "read", writable: false }));
    expect(checks.map((check) => [check.label, check.value, check.ok])).toEqual([
      ["Set", "Yes", true],
      ["Readable", "Yes", true],
      ["Writable", "Not needed", true],
    ]);
  });

  it("lists what's missing, and everything before the first save", () => {
    const saved = folderRequirements(declaration, status());
    expect(saved.map((item) => [item.title, item.state.label, item.missing])).toEqual([
      ["Required folders", "All there", []],
      ["Required files", "1 missing", ["config.json"]],
    ]);
    const unsaved = folderRequirements(declaration, undefined);
    expect(unsaved[1]!.missing).toEqual(["index.md", "config.json"]);
    expect(folderRequirements({ folderKey: "x", displayName: "X" }, undefined)).toEqual([]);
  });

  it("says the contents weren't checked when the folder can't be opened", () => {
    const unreadable = status({ readable: false, problems: [{ code: "missing", message: "The folder doesn't exist." }] });
    expect(rootNotInspected(unreadable)).toBe(true);
    expect(folderRequirements(declaration, unreadable).map((item) => item.state.label)).toEqual(["Not checked", "Not checked"]);
    expect(rootNotInspected(status())).toBe(false);
  });

  it("reports a save that still fails its checks", () => {
    expect(savedMessage(status({ healthy: true }))).toBe("Folder saved.");
    expect(savedMessage(status())).toMatch(/doesn't pass/);
  });
});
