import type { AgentConfigurationWarning } from "@paperclipai/shared";
import { pushToast } from "@/ui/Toast";

/*
 * Configuration warnings after a save (U140, upstream #21280). `PATCH /projects/:id` and the routine
 * writes answer with `configurationWarnings` when the saved environment variables include one the
 * Runner protects (the same warnings an agent's save returns). The save still worked, so they show as
 * a warning toast titled "Project saved" or "Routine saved", as the old UI does.
 */

/** The warnings' messages as one line, or null when there are none. */
export function configurationWarningMessages(result: unknown): string | null {
  const warnings = result && typeof result === "object" ? (result as { configurationWarnings?: unknown }).configurationWarnings : undefined;
  if (!Array.isArray(warnings)) return null;
  const messages = (warnings as Partial<AgentConfigurationWarning>[])
    .map((warning) => (typeof warning?.message === "string" ? warning.message.trim() : ""))
    .filter(Boolean);
  return messages.length > 0 ? messages.join(" ") : null;
}

/** Shows the save's configuration warnings as a warning toast; true when there were any. */
export function toastConfigurationWarnings(result: unknown, title: "Project saved" | "Routine saved"): boolean {
  const body = configurationWarningMessages(result);
  if (!body) return false;
  pushToast({ tone: "warn", title, body });
  return true;
}
