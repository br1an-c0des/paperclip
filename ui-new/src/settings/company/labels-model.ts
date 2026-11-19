import type { IssueLabel } from "@paperclipai/shared";
import { errorCodes } from "@/lib/offline/errors";

/*
 * The label manager's rules (LabelsSection.tsx): the order labels are listed in, what a name may be,
 * and the name clash the server reports. Names follow `createIssueLabelSchema`: trimmed, 1–48
 * characters, unique in the company (compared exactly, as the server does).
 */

export const LABEL_NAME_MAX = 48;

/** Labels by name, ignoring case, so the list reads like the label pickers. */
export function sortLabels(labels: readonly IssueLabel[] | undefined): IssueLabel[] {
  return [...(labels ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/**
 * What's wrong with `name` as the new name of `labelId`, or null when it can be saved. An unchanged
 * name is fine (there's nothing to save); another label's name is a clash.
 */
export function labelNameProblem(labels: readonly IssueLabel[] | undefined, labelId: string, name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "A label needs a name.";
  if (trimmed.length > LABEL_NAME_MAX) return `Names can be up to ${LABEL_NAME_MAX} characters.`;
  if ((labels ?? []).some((label) => label.id !== labelId && label.name === trimmed)) return nameTakenMessage(trimmed);
  return null;
}

export function nameTakenMessage(name: string) {
  return `Another label is already called “${name}”.`;
}

/** The server's 409 for a name another label has (`label_name_taken`). */
export function isLabelNameTaken(error: unknown): boolean {
  return errorCodes(error).includes("label_name_taken");
}

/** A colour the API takes: `#rrggbb`. The colour input always gives one; this guards a pasted value. */
export function isLabelColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}
