import type { Agent, ClaudeRunPreview, IssueStatus, RunPromptDraft } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { ScanText } from "lucide-solid";
import { createMemo, createSignal, createUniqueId, Show, untrack } from "solid-js";
import { agentsApi } from "@/api/agents";
import { ApiError, ApiUnavailableError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { promptPreviewView, unsupportedText } from "@/agents/settings/run-preview-model";
import { useCompany } from "@/lib/company";
import { PendingMark, PromptSections } from "@/runs/PromptSections";
import { Dialog } from "@/ui/Dialog";
import { InfoTip } from "@/ui/InfoTip";
import "./NewTaskPromptPreview.css";

/*
 * The New task dialog's prompt preview (fork/task-prompt-preview.md): an icon button beside the
 * assignee that opens, over the dialog, the prompt the assigned agent would get once the task is
 * created, from `POST /agents/:id/run-preview/draft` and the run view's sections. It reads the
 * draft as it stands when opened; opening it again after edits reads it again. It doesn't follow
 * typing.
 *
 * Offered for an agent on claude_local's CLI engine with Repeat off; otherwise the button is
 * disabled with the reason beside it.
 */

/** The create payload's fields the preview reads (new-task.ts `buildCreatePayload`). */
const DRAFT_FIELDS = [
  "title",
  "description",
  "projectId",
  "parentId",
  "goalId",
  "status",
  "priority",
  "workMode",
  "projectWorkspaceId",
  "executionWorkspaceId",
  "executionWorkspacePreference",
  "executionWorkspaceSettings",
] as const satisfies readonly (keyof RunPromptDraft)[];

/** The preview's draft: the fields of the payload the dialog would create the task with. */
export function draftFromPayload(payload: Record<string, unknown>): RunPromptDraft {
  const draft: Record<string, unknown> = {};
  for (const field of DRAFT_FIELDS) if (payload[field] !== undefined) draft[field] = payload[field];
  return draft as RunPromptDraft;
}

/** Whether the agent's runs use claude_local's CLI engine: as the server decides, anything but `acp`. */
export function usesClaudeCli(agent: Pick<Agent, "adapterType" | "adapterConfig">): boolean {
  if (agent.adapterType !== "claude_local") return false;
  const engine = (agent.adapterConfig as Record<string, unknown> | null | undefined)?.engine;
  return !(typeof engine === "string" && engine.trim().toLowerCase() === "acp");
}

/** Statuses a new task's assignee isn't woken in. */
const NO_WAKE: Partial<Record<IssueStatus, string>> = {
  backlog: "A Backlog task doesn't start a run",
  done: "A done task doesn't start a run",
  cancelled: "A cancelled task doesn't start a run",
};

export type PromptPreviewAvailability = { agentId: string } | { reason: string };

/** Whether the preview can be opened, and why not when it can't. */
export function promptPreviewAvailability(input: {
  assignee: { kind: "agent" | "user"; id: string } | null;
  agent: Pick<Agent, "id" | "adapterType" | "adapterConfig"> | undefined;
  repeating: boolean;
  status: IssueStatus;
  hasContent: boolean;
}): PromptPreviewAvailability {
  if (input.repeating) return { reason: "Not for recurring tasks" };
  if (!input.assignee) return { reason: "No assignee yet" };
  if (input.assignee.kind === "user") return { reason: "Assigned to a person" };
  if (!input.agent) return { reason: "No assignee yet" };
  if (input.agent.adapterType !== "claude_local") return { reason: "Only for Claude agents" };
  if (!usesClaudeCli(input.agent)) return { reason: "Not on the ACP engine" };
  const noWake = NO_WAKE[input.status];
  if (noWake) return { reason: noWake };
  if (!input.hasContent) return { reason: "Write a title or description first" };
  return { agentId: input.agent.id };
}

/** The state line the dialog shows when there's no prompt to draw. */
export function previewFailure(error: unknown, offline: boolean): string {
  if (offline || error instanceof TypeError || error instanceof ApiUnavailableError) {
    return "Paperclip can't be reached, so the prompt can't be drafted. Try again when you're back online.";
  }
  if (error instanceof ApiError) {
    if (error.status === 422) return error.message;
    if (error.status === 404) return `${error.message}. Check the project, parent and goal.`;
    return `Couldn't draft the prompt. ${error.message}`;
  }
  return "Couldn't draft the prompt.";
}

/** No prompt for this agent: the server's reason, for an agent it doesn't draft for. */
function noPromptText(preview: ClaudeRunPreview): string | null {
  if (!preview.supported) return unsupportedText(preview.reason);
  return preview.prompt ? null : "No prompt could be drafted for this agent.";
}

export function NewTaskPromptPreview(props: {
  availability: PromptPreviewAvailability;
  /** The draft as it stands; read when the preview opens. */
  draft: () => RunPromptDraft;
  /** Whether Paperclip is out of reach right now. */
  offline?: () => boolean;
}) {
  const company = useCompany();
  const [open, setOpen] = createSignal(false);
  // Each opening reads the draft afresh, under its own key.
  const [opening, setOpening] = createSignal<{ n: number; agentId: string; draft: RunPromptDraft } | null>(null);
  let openings = 0;
  const agentId = () => ("agentId" in props.availability ? props.availability.agentId : null);
  const reason = () => ("reason" in props.availability ? props.availability.reason : null);
  const show = () => {
    const id = agentId();
    if (!id) return;
    openings += 1;
    setOpening({ n: openings, agentId: id, draft: untrack(props.draft) });
    setOpen(true);
  };

  const preview = createQuery(() => {
    const current = opening();
    return {
      queryKey: queryKeys.agents.part(current?.agentId ?? "__none__", "run-preview-draft", String(current?.n ?? 0)),
      queryFn: ({ signal }: { signal: AbortSignal }) => agentsApi.runPreviewDraft(current!.agentId, current!.draft, company().id, signal),
      enabled: open() && Boolean(current),
      retry: false,
      gcTime: 0,
      staleTime: Infinity,
    };
  });
  const view = createMemo(() => {
    const data = preview.data;
    return data?.supported && data.prompt ? promptPreviewView(data.prompt) : null;
  });
  const reasonId = createUniqueId();

  return (
    <span class="ntp">
      <button
        type="button"
        class="ntp-button"
        aria-label="Preview the prompt"
        aria-describedby={reason() ? reasonId : undefined}
        disabled={!agentId()}
        onClick={show}
      >
        <ScanText size={16} aria-hidden="true" />
      </button>
      <InfoTip label="About the prompt preview">
        Shows what the agent would be sent when this task is created and assigned: the system prompt and first message, from the
        task as written so far. Open it again after editing to see the changes.
      </InfoTip>
      <Show when={reason()}>
        {(text) => (
          <span class="ntp-reason" id={reasonId}>
            {text()}
          </span>
        )}
      </Show>

      <Dialog
        open={open()}
        onOpenChange={setOpen}
        title="Prompt preview"
        info="The prompt a new session of this agent would get once the task is created and assigned, drafted with the same builder a run uses. Values marked “filled in at launch” are only known then, such as the task's identifier."
        width={900}
        class="ntp-dialog"
      >
        <Show when={preview.isPending && open()}>
          <p class="ntp-state" role="status">
            Drafting the prompt…
          </p>
        </Show>
        <Show when={preview.isError}>
          <p class="ntp-state ntp-state--error" role="alert">
            {previewFailure(preview.error, props.offline?.() ?? false)}
          </p>
        </Show>
        <Show when={preview.data ? noPromptText(preview.data) : null}>
          {(text) => <p class="ntp-state">{text()}</p>}
        </Show>
        <Show when={view()}>
          {(shown) => (
            <div class="ntp-body">
              <PromptSections view={shown()} idPrefix="ntp" headingLevel={3} renderPending={(why) => <PendingMark why={why} />} />
            </div>
          )}
        </Show>
      </Dialog>
    </span>
  );
}
