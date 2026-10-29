import type { PluginLocalFolderDeclaration } from "@paperclipai/shared";
import type { PluginLocalFolderSaveInput, PluginLocalFolderStatus } from "@/api/plugins";
import type { Tone } from "@/ui/Status";

/*
 * A plugin's local folders (PluginLocalFoldersSettings in ui/src/pages/PluginSettings.tsx): what each
 * declared folder's status says, and checking a path before it's saved.
 */

/** A full path on the server: `/…`, `C:\…` or a `\\share`. */
export function isLikelyAbsolutePath(value: string) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/** Why a path can't be saved, or null. */
export function folderPathProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter the folder's path.";
  if (!isLikelyAbsolutePath(trimmed)) return "Use the folder's full path, starting with / (or a drive letter on Windows).";
  return null;
}

/** The save request: the path, with the access and requirements the manifest declares. */
export function folderSaveInput(declaration: PluginLocalFolderDeclaration, path: string): PluginLocalFolderSaveInput {
  return {
    path: path.trim(),
    access: declaration.access,
    requiredDirectories: declaration.requiredDirectories,
    requiredFiles: declaration.requiredFiles,
  };
}

export function folderAccess(declaration: PluginLocalFolderDeclaration, status?: PluginLocalFolderStatus) {
  return status?.access ?? declaration.access ?? "readWrite";
}

/** The three checks the old page shows: configured, readable, and writable (when asked for). */
export function folderChecks(declaration: PluginLocalFolderDeclaration, status?: PluginLocalFolderStatus) {
  const readOnly = folderAccess(declaration, status) === "read";
  return [
    { label: "Set", value: status?.configured ? "Yes" : "No", ok: Boolean(status?.configured) },
    { label: "Readable", value: status?.readable ? "Yes" : "No", ok: Boolean(status?.readable) },
    { label: "Writable", value: readOnly ? "Not needed" : status?.writable ? "Yes" : "No", ok: readOnly || Boolean(status?.writable) },
  ];
}

/** A set folder the server couldn't open, so its required contents weren't checked. */
export function rootNotInspected(status?: PluginLocalFolderStatus) {
  if (!status?.configured || status.readable) return false;
  return status.problems.some((problem) => problem.code === "missing" || problem.code === "not_readable" || problem.code === "not_directory");
}

export type Requirement = {
  title: string;
  items: string[];
  missing: string[];
  state: { label: string; tone: Tone | null };
};

/** The required directories and files, each list with what's missing; none when nothing is required. */
export function folderRequirements(declaration: PluginLocalFolderDeclaration, status?: PluginLocalFolderStatus): Requirement[] {
  const directories = status?.requiredDirectories ?? declaration.requiredDirectories ?? [];
  const files = status?.requiredFiles ?? declaration.requiredFiles ?? [];
  if (directories.length === 0 && files.length === 0) return [];
  const unchecked = rootNotInspected(status);
  const build = (title: string, items: string[], missing: string[]): Requirement => ({
    title,
    items,
    missing: unchecked ? [] : missing,
    state: unchecked
      ? { label: "Not checked", tone: "amber" }
      : missing.length > 0
        ? { label: `${missing.length} missing`, tone: "red" }
        : { label: items.length > 0 ? "All there" : "None", tone: items.length > 0 ? "green" : null },
  });
  return [
    // Before a first save there's no status: everything required counts as missing, as in the old UI.
    build("Required folders", directories, status?.missingDirectories ?? directories),
    build("Required files", files, status?.missingFiles ?? files),
  ];
}

/** What a save reports: saved and healthy, or saved with checks still failing. */
export function savedMessage(status: PluginLocalFolderStatus) {
  return status.healthy ? "Folder saved." : "Folder saved, but it doesn't pass the plugin's checks yet.";
}
