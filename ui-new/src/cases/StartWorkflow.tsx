import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { activeAgents } from "@/api/agents";
import { casesApi, type CaseSummary } from "@/api/cases";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { startWorkflowInput, type StartWorkflowDraft } from "./start-workflow";
import { newId } from "@/tasks/new-task";
import { useWorkflowDiagrams } from "./queries";

/*
 * Start workflow, for a case with no work yet (board C2's draft case). It hands the case to an
 * agent (`POST /companies/:id/case-handoffs`): the server makes the case's main task, assigns it,
 * copies the workflow onto it and wakes the agent. The workflow is one of the company's templates or
 * text written here; the first phase defaults to the template diagram's first.
 */

export function StartWorkflowDialog(props: { kase: CaseSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const workflows = createQuery(() => ({
    queryKey: queryKeys.cases.workflows(company().id),
    queryFn: ({ signal }) => casesApi.workflows(company().id, signal),
    enabled: props.open,
    staleTime: 60_000,
  }));
  const [draft, setDraft] = createSignal<StartWorkflowDraft>({ workflowId: "", workflowText: "", agentId: "", phase: "", instructions: "" });
  const change = (patch: Partial<StartWorkflowDraft>) => setDraft({ ...draft(), ...patch });
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const diagrams = useWorkflowDiagrams(() => (draft().workflowId ? [draft().workflowId] : []));
  const firstPhase = createMemo(() => diagrams().get(draft().workflowId)?.phases[0]?.name ?? "");
  // A template's first phase fills the phase in, unless one was typed.
  createEffect(
    on(firstPhase, (phase, previous) => {
      if (phase && (!draft().phase || draft().phase === previous)) change({ phase });
    }),
  );
  let key = newId();

  const submit = async () => {
    const built = startWorkflowInput(props.kase, draft(), key);
    if (typeof built === "string") return setProblem(built);
    setProblem(null);
    setBusy(true);
    try {
      const result = await casesApi.handoff(company().id, built);
      pushToast({ tone: "success", title: `Started ${props.kase.identifier}`, body: `Main task ${result.taskIdentifier}` });
      void client.invalidateQueries({ queryKey: queryKeys.cases.all(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
      key = newId();
      props.onOpenChange(false);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const id = (name: string) => `sw-${props.kase.id}-${name}`;
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      width={520}
      title={`Start ${props.kase.identifier}`}
      description="Hands the case to an agent with a new main task, and wakes them to start its first phase."
      footer={
        <>
          <Show when={problem()}>
            <span class="field-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Button variant="quiet" onClick={() => props.onOpenChange(false)} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy()}>
            {busy() ? "Starting…" : "Start workflow"}
          </Button>
        </>
      }
    >
      <div class="case-start">
        <Field label="Workflow template" for={id("workflow")}>
          <select id={id("workflow")} class="input" value={draft().workflowId} onChange={(event) => change({ workflowId: event.currentTarget.value })}>
            <option value="">None: write the workflow here</option>
            <For each={workflows.data ?? []}>{(workflow) => <option value={workflow.id}>{workflow.name}</option>}</For>
          </select>
        </Field>
        <Show when={!draft().workflowId}>
          <Field label="Workflow" for={id("text")} help="Markdown. A Mermaid stateDiagram-v2 whose states are the phase names draws the phase track.">
            <TextArea id={id("text")} rows={5} value={draft().workflowText} onInput={(event) => change({ workflowText: event.currentTarget.value })} />
          </Field>
        </Show>
        <Field label="First phase" for={id("phase")}>
          <TextInput id={id("phase")} value={draft().phase} placeholder="Research" onInput={(event) => change({ phase: event.currentTarget.value })} />
        </Field>
        <Field label="Agent" for={id("agent")}>
          <select id={id("agent")} class="input" value={draft().agentId} onChange={(event) => change({ agentId: event.currentTarget.value })}>
            <option value="">Pick an agent</option>
            <For each={activeAgents(agents.data)}>
              {(agent) => (
                <option value={agent.id}>
                  {agent.name}
                  {agent.status === "paused" ? " (paused)" : ""}
                </option>
              )}
            </For>
          </select>
        </Field>
        <Field label="Instructions" for={id("instructions")}>
          <TextArea
            id={id("instructions")}
            rows={4}
            value={draft().instructions}
            placeholder="What the first phase should do"
            onInput={(event) => change({ instructions: event.currentTarget.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}
