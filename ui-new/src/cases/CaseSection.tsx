import type { IssueStatus } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createInfiniteQuery, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowRight, ChevronDown, CornerDownRight, FileText, Flag, Paperclip } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { caseAssetUrl, casesApi, type CaseDetail, type CaseHandoffView, type IssueCaseLink } from "@/api/cases";
import { issuePath, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { StatusCapsule } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { pushToast } from "@/ui/Toast";
import { useTaskPeople } from "@/tasks/people";
import { updatedLabel } from "@/tasks/list-model";
import {
  caseFields,
  handoffMove,
  handoffStateLabel,
  isPendingHandoff,
  phasePosition,
  phaseTrack,
  ROLE_LABEL,
  roundsOf,
  currentNote,
  type CaseRole,
  type TrackStep,
} from "./case-model";
import { CaseIcon, CaseStatusPill } from "./CaseChip";
import { useCase, useWorkflowDiagrams } from "./queries";
import { parseWorkflowDiagram } from "./workflow-diagram";
import "./cases.css";

/*
 * The task panel's Case section (board C1), shown when the instance has cases on and the task is in
 * one. It reads the case; agents write it. For each case the task is in (a picker when there's more
 * than one):
 *
 * - The case's type, identifier and status, and the task's part in it: "This is the case's main
 *   task", or its role and the main task.
 * - The title and summary.
 * - The workflow's phase track, read from the diagram in the main task's `workflow` document (the
 *   company workflow's when the task has none yet), each phase with the agent who took it, what
 *   it's doing and its rounds (case-model.ts). Without a diagram, the phase as text and its rounds.
 * - A strip while a hand-off is on its way, with Cancel hand-off when the server allows it.
 * - The case's fields, then its tasks' documents (they live on the tasks; each opens there) and
 *   attachments.
 * - The hand-offs between agents, newest first, which can be hidden.
 * - The main task and the other tasks in the case, and its parent and child cases.
 *
 * Left out (decision 16): the board's "waiting on you" strip (requests are the main task's own, in
 * its Details and the Inbox), "Open case" (there's no case page, decision F) and case documents,
 * revisions and annotations (gone upstream).
 */

type AgentDisc = (id: string | null, name: string | null | undefined, size?: 20 | 24) => JSX.Element;

export function useTaskCases(taskId: () => string, enabled: () => boolean) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.cases.forTask(company().id, taskId()),
    queryFn: ({ signal }) => casesApi.forIssue(taskId(), signal),
    enabled: enabled(),
    staleTime: 60_000,
  }));
}

/** The task's cases, its main-task cases first. */
export function sortedLinks(links: readonly IssueCaseLink[], taskId: string) {
  const main = (link: IssueCaseLink) => (link.case.workIssueId === taskId ? 0 : 1);
  return [...links].sort((a, b) => main(a) - main(b));
}

export function TaskCaseSection(props: {
  taskId: string;
  links: readonly IssueCaseLink[];
  onOpenTask: (task: { id: string; identifier: string | null }) => void;
}) {
  const links = createMemo(() => sortedLinks(props.links, props.taskId));
  const [picked, setPicked] = createSignal<string | null>(null);
  const current = () => links().find((link) => link.case.id === picked()) ?? links()[0];
  return (
    <section class="tcase" aria-label="Case">
      <div class="tsec-head">
        <h2 class="disp">{links().length > 1 ? `${links().length} cases` : "Case"}</h2>
        <Show when={links().length > 1}>
          <div class="tsec-head-tools">
            <Segmented
              label="Case"
              options={links().map((link) => ({ value: link.case.id, label: link.case.identifier }))}
              value={current()?.case.id ?? ""}
              onChange={setPicked}
            />
          </div>
        </Show>
      </div>
      <div class="tsec-scroll">
        <Show when={current()} keyed>
          {(link) => <CaseView caseId={link.case.id} taskId={props.taskId} linkRole={link.role} onOpenTask={props.onOpenTask} />}
        </Show>
      </div>
    </section>
  );
}

function CaseView(props: { caseId: string; taskId: string; linkRole: IssueCaseLink["role"]; onOpenTask: (task: { id: string; identifier: string | null }) => void }) {
  const detail = useCase(() => props.caseId);
  return (
    <Switch>
      <Match when={detail.data}>{(kase) => <CaseBody kase={kase()} taskId={props.taskId} linkRole={props.linkRole} onOpenTask={props.onOpenTask} />}</Match>
      <Match when={detail.isError}>
        <p class="tsec-muted" role="alert">
          The case couldn't be loaded: {(detail.error as Error).message}
        </p>
      </Match>
      <Match when={true}>
        <p class="tsec-muted" aria-busy="true">
          Loading the case…
        </p>
      </Match>
    </Switch>
  );
}

function CaseBody(props: { kase: CaseDetail; taskId: string; linkRole: IssueCaseLink["role"]; onOpenTask: (task: { id: string; identifier: string | null }) => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const people = useTaskPeople();
  const kase = () => props.kase;
  const isMain = () => kase().workIssueId === props.taskId;
  const role = (): CaseRole => (isMain() ? "main" : props.linkRole);

  // The workflow: the main task's own `workflow` document, which the agents keep, else the company
  // workflow the case follows.
  const hasTaskWorkflow = () =>
    !!kase().workIssueId && (kase().taskDocuments ?? []).some((doc) => doc.taskId === kase().workIssueId && doc.key === "workflow");
  const workflowDoc = createQuery(() => ({
    queryKey: queryKeys.issues.section(kase().workIssueId ?? "", "documents", "workflow"),
    queryFn: ({ signal }) => issuesApi.getDocument(kase().workIssueId!, "workflow", signal),
    enabled: hasTaskWorkflow(),
    staleTime: 60_000,
  }));
  const companyDiagrams = useWorkflowDiagrams(() => (!hasTaskWorkflow() && kase().workflowId ? [kase().workflowId!] : []));
  const diagram = createMemo(() =>
    hasTaskWorkflow() ? parseWorkflowDiagram(workflowDoc.data?.body) : kase().workflowId ? (companyDiagrams().get(kase().workflowId!) ?? null) : null,
  );

  const handoffs = createInfiniteQuery(() => ({
    queryKey: queryKeys.cases.handoffs(company().id, kase().id),
    queryFn: ({ pageParam, signal }) => casesApi.handoffs(kase().id, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? null,
    enabled: !!kase().workIssueId,
    staleTime: 30_000,
  }));
  const handoffList = createMemo(() => (handoffs.data?.pages ?? []).flatMap((page) => page.items));
  const canControl = () => handoffs.data?.pages[0]?.canControl === true;
  const pending = () => (isPendingHandoff(kase().pendingHandoff) ? kase().pendingHandoff : null);

  const track = createMemo(() => {
    const found = diagram();
    if (!found) return null;
    return phaseTrack({
      diagram: found,
      phase: kase().phase,
      status: kase().status,
      taskStatus: kase().workIssue?.status,
      pending: pending(),
      handoffs: handoffList(),
    });
  });

  const children = createQuery(() => ({
    queryKey: queryKeys.cases.children(company().id, kase().id),
    queryFn: ({ signal }) => casesApi.list(company().id, { parent: kase().id, limit: 50 }, signal),
    staleTime: 60_000,
  }));

  const others = createMemo(() => kase().issueLinks.filter((link) => link.issueId !== props.taskId && link.issueId !== kase().workIssueId));
  const fields = createMemo(() => caseFields(kase().fields));
  const documents = () => kase().taskDocuments ?? [];
  const [historyOpen, setHistoryOpen] = createSignal(true);

  const [cancelling, setCancelling] = createSignal(false);
  const cancel = async (handoff: CaseHandoffView) => {
    setCancelling(true);
    try {
      await casesApi.cancelHandoff(kase().id, handoff.id);
      pushToast({ tone: "success", title: "Hand-off cancelled", body: `${kase().identifier} stays with its current agent.` });
      void client.invalidateQueries({ queryKey: queryKeys.cases.all(company().id) });
      if (kase().workIssueId) void client.invalidateQueries({ queryKey: queryKeys.issues.detail(kase().workIssueId!) });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't cancel the hand-off", body: error instanceof Error ? error.message : String(error) });
    } finally {
      setCancelling(false);
    }
  };

  const taskHref = (task: { id: string; identifier: string | null }) => issuePath(company().issuePrefix, task);
  const openTask = (event: MouseEvent, task: { id: string; identifier: string | null }) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    props.onOpenTask(task);
  };
  /** A document on one of the case's tasks: on this task, a fragment the panel opens; elsewhere, the task's page. */
  const docHref = (taskId: string, identifier: string | null, key: string) =>
    taskId === props.taskId ? `#document-${encodeURIComponent(key)}` : `${taskHref({ id: taskId, identifier })}#document-${encodeURIComponent(key)}`;

  const agentDisc: AgentDisc = (id, name, size = 24) => {
    const agent = people.agent(id);
    if (agent) return <AgentAvatar agent={agent} size={size} ring={false} />;
    if (id || name) return <InitialsDisc name={name ?? "Agent"} seed={id ?? name ?? ""} size={size} />;
    return <span class="tcase-disc-none" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" />;
  };

  return (
    <div class="tcase-body">
      <div class="tcase-intro">
        <div class="tcase-meta">
          <span class="case-chip case-chip--head">
            <CaseIcon size={14} />
            {kase().caseType}
            <span class="mono">{kase().identifier}</span>
          </span>
          <CaseStatusPill status={kase().status} />
          <span class="tcase-role">
            <Show
              when={isMain()}
              fallback={
                <>
                  {ROLE_LABEL[role()]}
                  <Show when={kase().workIssue}>
                    {(main) => (
                      <>
                        {" · main task "}
                        <a href={taskHref(main())} onClick={(event) => openTask(event, main())}>
                          {main().identifier ?? main().title}
                        </a>
                      </>
                    )}
                  </Show>
                </>
              }
            >
              This is the case's main task
            </Show>
          </span>
        </div>
        <h3 class="disp tcase-title">{kase().title}</h3>
        <Show when={kase().summary}>
          <p class="tcase-summary">{kase().summary}</p>
        </Show>
        <Show when={kase().labels.length > 0}>
          <div class="tcase-labels">
            <For each={kase().labels}>{(label) => <span class="tcase-pill">{label.name}</span>}</For>
          </div>
        </Show>
      </div>

      <Show
        when={kase().workIssueId}
        fallback={
          <section class="tcase-well">
            <p class="tsec-muted">No work yet: no agent has started this case's workflow.</p>
          </section>
        }
      >
        <section class="tcase-well" aria-labelledby={`tcase-ph-${kase().id}`}>
          <div class="tcase-well-head">
            <h4 class="tcase-h" id={`tcase-ph-${kase().id}`}>
              {kase().workflow?.name ?? (hasTaskWorkflow() ? "Workflow" : "Case instructions")}
            </h4>
            <Show when={diagram() && phasePosition(diagram()!, kase().phase)}>
              {(position) => <span class="tcase-muted">{position()}</span>}
            </Show>
            <Show when={hasTaskWorkflow() && kase().workIssue}>
              {(main) => (
                <a class="tcase-well-link" href={docHref(main().id, main().identifier, "workflow")}>
                  Workflow
                  <Show when={workflowDoc.data?.latestRevisionNumber}>{(rev) => ` · rev ${rev()}`}</Show>
                </a>
              )}
            </Show>
          </div>
          <Show
            when={track()}
            fallback={
              <p class="tcase-phase-text">
                <Show when={kase().phase} fallback={<span class="tcase-muted">No phase yet</span>}>
                  <b>{kase().phase}</b>
                  <Show when={currentNote(kase().workIssue?.status, pending())}>{(note) => <span class="tcase-note">{note()}</span>}</Show>
                  <Show when={roundsOf(handoffList(), kase().phase) > 1}>
                    <span class="tcase-muted">{roundsOf(handoffList(), kase().phase)} rounds</span>
                  </Show>
                </Show>
                <Show when={workflowDoc.isSuccess || !hasTaskWorkflow()}>
                  <span class="tcase-muted tcase-phase-why">The workflow has no phase diagram, so its phases aren't drawn.</span>
                </Show>
              </p>
            }
          >
            {(steps) => <PhaseTrack steps={steps()} agentDisc={agentDisc} />}
          </Show>
        </section>
      </Show>

      <Show when={pending()}>
        {(handoff) => (
          <div class="tcase-strip" role="status">
            <span class="capsule capsule--pill" style={{ background: "var(--g-ion)" }} aria-hidden="true" />
            <div class="tcase-strip-text">
              <strong>{handoff().destinationKind === "done" ? "Closing the case" : `Hand-off to ${handoff().phase}`}</strong>
              <span>
                {handoff().destinationKind === "done"
                  ? "The case closes when its main task is done."
                  : `${handoff().toAgentName ?? "The next agent"}: ${handoffStateLabel(handoff()).toLowerCase()}.`}
                <Show when={handoff().lastError}>{(why) => ` ${why()}`}</Show>
              </span>
            </div>
            <Show when={canControl() && handoff().destinationKind === "agent"}>
              <Button size="compact" disabled={cancelling()} onClick={() => void cancel(handoff())}>
                {cancelling() ? "Cancelling…" : "Cancel hand-off"}
              </Button>
            </Show>
          </div>
        )}
      </Show>

      <Show when={fields().length > 0}>
        <section class="tcase-part" aria-labelledby={`tcase-fl-${kase().id}`}>
          <div class="tcase-part-head">
            <h4 class="tcase-h" id={`tcase-fl-${kase().id}`}>
              Fields
            </h4>
            <span class="tcase-muted">{fields().length}</span>
            <span class="tcase-muted tcase-part-end">Kept up to date by the agents</span>
          </div>
          <dl class="tcase-kv">
            <For each={fields()}>
              {(row) => (
                <>
                  <dt class="mono">{row.key}</dt>
                  <dd>
                    <Switch>
                      <Match when={row.value.kind === "unset"}>
                        <span class="mono tcase-muted">not set</span>
                      </Match>
                      <Match when={row.value.kind === "list" && row.value}>
                        {(value) => <For each={value().items}>{(item) => <span class="mono tcase-pill">{item}</span>}</For>}
                      </Match>
                      <Match when={row.value.kind === "text" && row.value}>{(value) => <span>{value().text}</span>}</Match>
                    </Switch>
                  </dd>
                </>
              )}
            </For>
          </dl>
        </section>
      </Show>

      <Show when={documents().length > 0 || kase().attachments.length > 0}>
        <section class="tcase-part" aria-labelledby={`tcase-dc-${kase().id}`}>
          <h4 class="tcase-h" id={`tcase-dc-${kase().id}`}>
            Documents and files
          </h4>
          <div class="tcase-tiles">
            <For each={documents()}>
              {(doc) => (
                <a class="tcase-tile" href={docHref(doc.taskId, doc.taskIdentifier, doc.key)}>
                  <FileText size={14} aria-hidden="true" />
                  {doc.document.title || doc.key}
                  <span class="tcase-muted">
                    {doc.document.latestRevisionNumber ? `· rev ${doc.document.latestRevisionNumber}` : ""}
                    {doc.taskId === props.taskId ? "" : ` · from ${doc.taskIdentifier ?? "a task"}`}
                  </span>
                </a>
              )}
            </For>
            <For each={kase().attachments}>
              {(file) => (
                <a class="tcase-tile" href={caseAssetUrl(file)} target="_blank" rel="noreferrer">
                  <Paperclip size={14} aria-hidden="true" />
                  {file.asset.originalFilename ?? "Attachment"}
                  <span class="tcase-muted">· {Math.max(1, Math.round(file.asset.byteSize / 1024))} KB</span>
                </a>
              )}
            </For>
          </div>
          <Show when={kase().taskDocumentsOmitted}>
            <p class="tcase-muted">More documents are on the case's tasks.</p>
          </Show>
        </section>
      </Show>

      <Show when={kase().workIssueId}>
        <section class="tcase-part" aria-labelledby={`tcase-ho-${kase().id}`}>
          <div class="tcase-part-head">
            <h4 class="tcase-h" id={`tcase-ho-${kase().id}`}>
              Hand-offs
            </h4>
            <span class="tcase-muted">{handoffList().length}{handoffs.hasNextPage ? "+" : ""}</span>
            <button type="button" class="tcase-toggle" aria-expanded={historyOpen()} onClick={() => setHistoryOpen(!historyOpen())}>
              {historyOpen() ? "Hide" : "Show"}
              <ChevronDown size={12} stroke-width={2.2} aria-hidden="true" classList={{ "tcase-toggle-open": historyOpen() }} />
            </button>
          </div>
          <Show when={historyOpen()}>
            <Switch>
              <Match when={handoffs.isError}>
                <p class="tsec-muted" role="alert">
                  The hand-offs couldn't be loaded.
                </p>
              </Match>
              <Match when={handoffs.isPending}>
                <p class="tsec-muted">Loading hand-offs…</p>
              </Match>
              <Match when={handoffList().length === 0}>
                <p class="tsec-muted">No hand-offs yet.</p>
              </Match>
              <Match when={true}>
                <ol class="tcase-hops">
                  <For each={handoffList()}>{(handoff) => <HandoffRow handoff={handoff} agentDisc={agentDisc} />}</For>
                </ol>
                <Show when={handoffs.hasNextPage}>
                  <Button ghost size="compact" disabled={handoffs.isFetchingNextPage} onClick={() => void handoffs.fetchNextPage()}>
                    Load older hand-offs
                  </Button>
                </Show>
              </Match>
            </Switch>
          </Show>
        </section>
      </Show>

      <section class="tcase-part" aria-labelledby={`tcase-rl-${kase().id}`}>
        <h4 class="tcase-h" id={`tcase-rl-${kase().id}`}>
          Also in this case
        </h4>
        <div class="tcase-rows">
          <Show when={!isMain() && kase().workIssue}>
            {(main) => <TaskRow task={main()} role="main" href={taskHref(main())} onOpen={(event) => openTask(event, main())} agentDisc={agentDisc(main().assigneeAgentId, main().assigneeAgentName)} />}
          </Show>
          <For each={others()}>
            {(link) => <TaskRow task={link.issue} role={link.role} href={taskHref(link.issue)} onOpen={(event) => openTask(event, link.issue)} />}
          </For>
          <Show when={(isMain() || !kase().workIssue) && others().length === 0}>
            <div class="tcase-row tcase-row--note">No other tasks in this case.</div>
          </Show>
          <Show when={kase().parent}>
            {(parent) => (
              <div class="tcase-row">
                <CaseIcon />
                <span class="tcase-muted">Part of</span>
                <span class="mono tcase-muted">{parent().identifier}</span>
                <span class="tcase-row-title">{parent().title}</span>
                <CaseStatusPill status={parent().status} />
              </div>
            )}
          </Show>
          <Show
            when={(children.data ?? []).length > 0}
            fallback={
              <Show when={children.isSuccess}>
                <div class="tcase-row tcase-row--note">No child cases. Agents add one when part of the work can be checked on its own.</div>
              </Show>
            }
          >
            <For each={children.data ?? []}>
              {(child) => (
                <div class="tcase-row">
                  <CornerDownRight size={13} aria-hidden="true" class="tcase-muted" />
                  <span class="mono tcase-muted">{child.identifier}</span>
                  <Show when={child.workIssue} fallback={<span class="tcase-row-title">{child.title}</span>}>
                    {(main) => (
                      <a class="tcase-row-title" href={taskHref(main())} onClick={(event) => openTask(event, main())}>
                        {child.title}
                      </a>
                    )}
                  </Show>
                  <CaseStatusPill status={child.status} />
                </div>
              )}
            </For>
          </Show>
        </div>
      </section>
    </div>
  );
}

function PhaseTrack(props: { steps: TrackStep[]; agentDisc: AgentDisc }) {
  return (
    <ol class="tcase-track" aria-label="Phases">
      <For each={props.steps}>
        {(step, index) => (
          <>
            <Show when={index() > 0}>
              <span class="tcase-conn" classList={{ "tcase-conn--done": step.state === "done" || step.state === "current" }} aria-hidden="true" />
            </Show>
            <li
              class="tcase-step"
              data-state={step.state}
              aria-label={`${step.name}, ${step.end ? "finish" : (step.agentName ?? "no agent yet")}, ${step.state === "done" ? "done" : step.note || "not started"}`}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              <span class="tcase-step-disc">
                <Show when={!step.end} fallback={<Flag size={14} aria-hidden="true" />}>
                  <Show when={step.agentId || step.agentName} fallback={<span class="tcase-disc-none" aria-hidden="true" />}>
                    {props.agentDisc(step.agentId, step.agentName)}
                  </Show>
                </Show>
              </span>
              <span class="tcase-step-name">{step.name}</span>
              <span class="tcase-step-who">{step.end ? "Finish" : (step.agentName ?? "—")}</span>
              <Show when={step.note}>
                <span class="tcase-step-note">{step.note}</span>
              </Show>
            </li>
          </>
        )}
      </For>
    </ol>
  );
}

function HandoffRow(props: { handoff: CaseHandoffView; agentDisc: AgentDisc }) {
  const [open, setOpen] = createSignal(false);
  const from = () => props.handoff.fromAgentName ?? (props.handoff.actorType === "user" ? "You" : "System");
  return (
    <li class="tcase-hop" data-state={props.handoff.state}>
      <time class="mono tcase-muted" datetime={new Date(props.handoff.createdAt).toISOString()} title={new Date(props.handoff.createdAt).toLocaleString()}>
        {updatedLabel(props.handoff.createdAt)}
      </time>
      <span class="tcase-hop-who" aria-label={`From ${from()} to ${props.handoff.toAgentName ?? (props.handoff.destinationKind === "done" ? "done" : "an agent")}`}>
        <Show when={props.handoff.fromAgentId} fallback={<InitialsDisc name={from()} seed={props.handoff.actorId} size={24} />}>
          {props.agentDisc(props.handoff.fromAgentId, props.handoff.fromAgentName)}
        </Show>
        <ArrowRight size={11} stroke-width={2.4} aria-hidden="true" />
        <Show when={props.handoff.destinationKind === "agent"} fallback={<Flag size={14} aria-hidden="true" />}>
          {props.agentDisc(props.handoff.toAgentId, props.handoff.toAgentName)}
        </Show>
      </span>
      <span class="tcase-hop-text">
        <strong>{handoffMove(props.handoff)}</strong>
        <button type="button" class="tcase-hop-note" classList={{ "tcase-hop-note--open": open() }} aria-expanded={open()} onClick={() => setOpen(!open())}>
          {props.handoff.instructions}
        </button>
      </span>
      <span class="tcase-hop-state">{handoffStateLabel(props.handoff)}</span>
    </li>
  );
}

function TaskRow(props: {
  task: { id: string; identifier: string | null; title: string; status: string };
  role: CaseRole;
  href: string;
  onOpen: (event: MouseEvent) => void;
  agentDisc?: JSX.Element;
}) {
  const status = () => (STATUS_META[props.task.status as IssueStatus] ? (props.task.status as IssueStatus) : null);
  return (
    <div class="tcase-row">
      <Show when={status()} fallback={<span class="capsule capsule--row" style={{ background: "var(--g-ash)" }} aria-hidden="true" />}>
        {(found) => <StatusCapsule status={found()} size="row" />}
      </Show>
      <span class="mono tcase-muted">{props.task.identifier}</span>
      <a class="tcase-row-title" href={props.href} onClick={(event) => props.onOpen(event)}>
        {props.task.title}
      </a>
      <span class="tcase-role-pill">{ROLE_LABEL[props.role]}</span>
      {props.agentDisc}
    </div>
  );
}
