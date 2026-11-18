import { z } from "zod";
import type { PaperclipTool } from "./types.js";

export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const rows = (value: unknown): unknown[] => Array.isArray(value) ? value
  : Array.isArray(object(value).items) ? object(value).items as unknown[] : [];
export const pick = (value: unknown, keys: readonly string[]) => {
  const source = object(value);
  return Object.fromEntries(keys.filter(key => key in source).map(key => [key, source[key]]));
};
export const pathId = (id: unknown) => encodeURIComponent(String(id));

/** A task, by UUID or identifier such as `TES-12`. */
export const taskId = z.string().trim().min(1).max(100).describe("Task UUID or identifier, e.g. TES-12");

export const TASK_FIELDS = [
  "id", "identifier", "title", "description", "status", "priority", "assigneeAgentId", "assigneeUserId",
  "projectId", "parentId", "labelIds", "blockedByIssueIds", "unblockDescriptor", "hiddenAt", "updatedAt", "completedAt",
] as const;
export const TASK_ROW_FIELDS = [
  "id", "identifier", "title", "status", "priority", "assigneeAgentId", "assigneeUserId", "projectId", "parentId", "updatedAt",
] as const;
export const COMMENT_FIELDS = ["id", "body", "authorAgentId", "authorUserId", "createdAt"] as const;
export const DOCUMENT_FIELDS = ["key", "title", "format", "body", "latestRevisionId", "latestRevisionNumber", "updatedAt"] as const;

/** Declares a tool with its input type inferred from its schema. */
export function tool<S extends z.ZodType>(definition: PaperclipTool<S>): PaperclipTool {
  return definition as unknown as PaperclipTool;
}
