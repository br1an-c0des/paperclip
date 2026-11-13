import type { ToastInput } from "@/ui/Toast";

/*
 * Try again on a run the provider failed for its model (since the 2026-11-13 sync, upstream #21244;
 * the old UI's lib/model-retry-refusal.ts). The server checks the model again before it retries:
 * while the rejected model is still the one selected it refuses with 409 and
 * `details.code: "native_provider_model_still_unavailable"`, naming where it's set (`setting`): the
 * agent's own model, or this task's model override. The toast says so, and for the agent's model
 * links to its Model and runtime settings; a task override is changed on the task, so no link.
 */

export const MODEL_STILL_UNAVAILABLE_CODE = "native_provider_model_still_unavailable";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The model-settings toast for a Retry the server refused because the model is still unavailable, or null for any other error. */
export function modelStillUnavailableToast(
  error: unknown,
  agent: { id: string; name?: string | null; urlKey?: string | null } | null | undefined,
  prefix: string,
): ToastInput | null {
  const details = record(record(record(error).body).details);
  if (details.code !== MODEL_STILL_UNAVAILABLE_CODE) return null;
  const body = error instanceof Error && error.message ? error.message : "The selected model is still unavailable.";
  const agentSetting = details.setting !== "task_model_override";
  const agentId = typeof details.agentId === "string" ? details.agentId : agent?.id;
  return {
    tone: "error",
    title: "Model still unavailable",
    body,
    ttlMs: 15_000,
    dedupeKey: `model-still-unavailable:${agentId ?? ""}`,
    ...(agentSetting && agent
      ? { action: { label: `Open ${agent.name ?? "the agent"}'s model settings`, href: `/${prefix}/agents/${agent.urlKey ?? agent.id}/runtime` } }
      : {}),
  };
}
