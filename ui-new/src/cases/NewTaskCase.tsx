import { createQuery } from "@tanstack/solid-query";
import { Check, ChevronDown, Repeat2 } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { casesApi } from "@/api/cases";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { InfoTip } from "@/recurring/RepeatMenu";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { Switch } from "@/ui/Switch";
import { isClosedCase } from "./case-model";
import { CaseIcon, caseTicks, phaseSummary, PhaseTicks } from "./CaseChip";
import { useCaseIndex } from "./queries";
import { diagramLoops, parseWorkflowDiagram, workflowSummary } from "./workflow-diagram";
import "./cases.css";

/*
 * New task's case box (board C5), shown while the instance has cases on (not on phones, M6):
 *
 * - **Start a case** on: the assignee sets up a case and makes this task its main task. A line
 *   asking for it is added to the description when the task is made (new-task.ts). A workflow
 *   template (one of the company's workflows) can be named in that line; picking one previews it:
 *   its first paragraph, how many cases use it, its phases and its loops, read from its diagram.
 * - Off: **Add to case** links the new task to an open case once it's made, as Work or Reference.
 *
 * Left out: the board's phase owners in the preview, and the assignee defaulting to the first
 * phase's agent. A workflow's diagram names phases, not agents (decision 16), so there's nothing
 * to read them from.
 */

export type CaseChoice = {
  startCase: boolean;
  caseTemplate: { id: string; name: string } | null;
  addToCase: { caseId: string; role: "work" | "reference" } | null;
};

const ROLES = [
  { value: "work" as const, label: "Work" },
  { value: "reference" as const, label: "Reference" },
];

export function NewTaskCase(props: { value: CaseChoice; onChange: (patch: Partial<CaseChoice>) => void }) {
  const company = useCompany();
  const index = useCaseIndex({ enabled: () => true });
  const workflows = createQuery(() => ({
    queryKey: queryKeys.cases.workflows(company().id),
    queryFn: ({ signal }) => casesApi.workflows(company().id, signal),
    enabled: props.value.startCase,
    staleTime: 60_000,
  }));
  const template = createQuery(() => ({
    queryKey: queryKeys.cases.workflow(company().id, props.value.caseTemplate?.id ?? ""),
    queryFn: ({ signal }) => casesApi.workflow(props.value.caseTemplate!.id, signal),
    enabled: props.value.startCase && !!props.value.caseTemplate,
    staleTime: 5 * 60_000,
  }));
  const diagram = createMemo(() => parseWorkflowDiagram(template.data?.prompt));
  const loops = createMemo(() => {
    const found = diagram();
    return found ? diagramLoops(found) : [];
  });
  const used = () => (props.value.caseTemplate ? (index.usedBy().get(props.value.caseTemplate.id) ?? 0) : 0);
  const openCases = createMemo(() => index.cases().filter((kase) => !isClosedCase(kase.status)));
  const linked = () => (props.value.addToCase ? index.byId().get(props.value.addToCase.caseId) : undefined);

  return (
    <section class="ntc" classList={{ "ntc--on": props.value.startCase }} aria-label="Case">
      <div class="ntc-head">
        <span class="ntc-icon" aria-hidden="true">
          <CaseIcon size={15} />
        </span>
        <Switch
          checked={props.value.startCase}
          onChange={(on) => props.onChange({ startCase: on })}
          label="Start a case"
          description={props.value.startCase ? "The assignee sets up a case with this task as its main task." : undefined}
        />
        <InfoTip
          label="About Start a case"
          text="The assignee sets up a case for this task and makes this task its main task. A line asking for this is added to the description."
        />
        <Show when={!props.value.startCase}>
          <Menu>
            <Menu.Trigger class="nt-pill ntc-link" classList={{ "ntc-link--on": !!linked() }} aria-label={linked() ? `In ${linked()!.identifier}` : "Add to case"}>
              <CaseIcon size={13} />
              {linked() ? `In ${linked()!.identifier}` : "Add to case"}
              <ChevronDown size={13} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Content label="Add to case" width={320}>
              <Menu.Item onSelect={() => props.onChange({ addToCase: null })} description="Just a task" hint={props.value.addToCase ? undefined : <Check size={14} />}>
                No case
              </Menu.Item>
              <Menu.Separator />
              <For each={openCases()} fallback={<p class="nt-menu-note">No open cases.</p>}>
                {(kase) => (
                  <Menu.Item
                    onSelect={() => props.onChange({ addToCase: { caseId: kase.id, role: props.value.addToCase?.role ?? "work" } })}
                    description={`${kase.identifier} · ${kase.caseType} · ${phaseSummary(kase)}`}
                    hint={props.value.addToCase?.caseId === kase.id ? <Check size={14} /> : undefined}
                  >
                    {kase.title}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
        </Show>
      </div>

      <Show when={props.value.startCase}>
        <div class="ntc-body">
          <div class="ntc-row">
            <span class="ntc-label" id="ntc-template">
              Workflow template
            </span>
            <InfoTip
              label="About workflow templates"
              text={
                props.value.caseTemplate
                  ? "The agent copies the template into the case and can adjust it. Editing the template later doesn't change this case."
                  : "Without a template, the agent writes the workflow itself."
              }
            />
            <Menu>
              <Menu.Trigger class="nt-pill ntc-template" aria-labelledby="ntc-template ntc-template-value">
                <span id="ntc-template-value">{props.value.caseTemplate?.name ?? "No template"}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Content label="Workflow template" width={300}>
                <Menu.Item onSelect={() => props.onChange({ caseTemplate: null })} hint={props.value.caseTemplate ? undefined : <Check size={14} />}>
                  No template
                </Menu.Item>
                <Menu.Separator />
                <For each={workflows.data ?? []} fallback={<p class="nt-menu-note">{workflows.isPending ? "Loading…" : "This company has no workflow templates yet."}</p>}>
                  {(workflow) => (
                    <Menu.Item
                      onSelect={() => props.onChange({ caseTemplate: { id: workflow.id, name: workflow.name } })}
                      hint={props.value.caseTemplate?.id === workflow.id ? <Check size={14} /> : undefined}
                    >
                      {workflow.name}
                    </Menu.Item>
                  )}
                </For>
              </Menu.Content>
            </Menu>
          </div>
          <Show when={props.value.caseTemplate && template.data}>
            {(found) => (
              <div class="ntc-preview" role="group" aria-label="Template preview">
                <div class="ntc-preview-top">
                  <span class="ntc-preview-desc">{workflowSummary(found().prompt) || found().name}</span>
                  <span class="ntc-muted">
                    {used() > 0 ? `Used by ${used()} case${used() === 1 ? "" : "s"} · ` : ""}edited {new Date(found().updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
                <Show when={diagram()} fallback={<span class="ntc-muted">No phase diagram: the agents follow its text.</span>}>
                  {(shown) => (
                    <ol class="ntc-phases" aria-label="Phases">
                      <For each={shown().phases}>
                        {(phase, at) => (
                          <>
                            <Show when={at() > 0}>
                              <span class="ntc-arrow" aria-hidden="true">
                                →
                              </span>
                            </Show>
                            <li class="ntc-phase">{phase.name}</li>
                          </>
                        )}
                      </For>
                    </ol>
                  )}
                </Show>
                <Show when={loops().length > 0}>
                  <div class="ntc-facts">
                    <For each={loops()}>
                      {(loop) => (
                        <span class="ntc-fact">
                          <Repeat2 size={13} aria-hidden="true" />
                          {loop.from.name} can send it back to {loop.to.name}
                          {loop.label ? ` (${loop.label})` : ""}
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>

      <Show when={!props.value.startCase && linked()}>
        {(kase) => (
          <div class="ntc-linked">
            <span class="ntc-linked-title">Adds this task to {kase().title}</span>
            <span class="case-chip" title={`${kase().identifier}: ${phaseSummary(kase())}`}>
              <span class="mono">{kase().identifier}</span>
              <Show when={caseTicks(kase(), index.diagram(kase().workflowId)).length > 0}>
                <PhaseTicks ticks={caseTicks(kase(), index.diagram(kase().workflowId))} />
              </Show>
            </span>
            <span class="ntc-role">
              <span class="ntc-label">Role</span>
              <InfoTip label="About roles" text="Work counts toward getting the case done. Reference is related context only." />
              <Segmented
                label="Role in the case"
                options={ROLES}
                value={props.value.addToCase!.role}
                onChange={(role) => props.onChange({ addToCase: { caseId: kase().id, role } })}
              />
            </span>
          </div>
        )}
      </Show>
    </section>
  );
}
