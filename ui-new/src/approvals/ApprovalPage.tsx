import type { Approval } from "@paperclipai/shared";
import { A, Navigate, useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ChevronRight, CircleCheck, Trash2, Undo2, Wallet } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { approvalsApi } from "@/api/approvals";
import { queryKeys } from "@/api/queryKeys";
import { useCompaniesQuery, useCompany } from "@/lib/company";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { RequestCard } from "@/requests/RequestCard";
import { approvalTitle, requestFromApproval } from "@/requests/request-model";
import { useTaskPeople } from "@/tasks/people";
import { stampLabel } from "@/tasks/thread-model";
import { Button, buttonClass } from "@/ui/Button";
import { PageHeader } from "@/ui/PageHeader";
import { Capsule, StatusCapsule } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { pushToast } from "@/ui/Toast";
import { afterApproval, approvalFollowUps, approvalStatus, hiredAgentId } from "./approval-model";
import "./Approvals.css";

/*
 * `/:prefix/approvals/:approvalId`, one approval on its own page (after
 * ui/src/pages/ApprovalDetail.tsx). The `paperclip` skill tells agents to link here, so it has to
 * work from a cold link. The request card (board 15, src/requests/) does the deciding and holds the
 * approval's discussion; around it the page adds what the card doesn't: the tasks it's linked to,
 * "Mark resubmitted" after Request changes, deleting the agent a rejected hire left behind, the
 * budget controls for a budget stop, and the full request as sent.
 *
 * An approval that belongs to another company you can open moves to that company's address.
 */

export function ApprovalPage() {
  const params = useParams<{ approvalId: string }>();
  const company = useCompany();
  const companies = useCompaniesQuery();
  const people = useTaskPeople();
  const [search, setSearch] = useSearchParams<{ resolved?: string }>();

  const approval = createQuery(() => ({
    queryKey: queryKeys.inbox.approval(company().id, params.approvalId),
    queryFn: ({ signal }) => approvalsApi.get(params.approvalId, signal),
    retry: false,
  }));
  const tasks = createQuery(() => ({
    queryKey: queryKeys.inbox.approvalIssues(company().id, params.approvalId),
    queryFn: ({ signal }) => approvalsApi.issues(params.approvalId, signal),
    enabled: approval.isSuccess,
  }));

  const elsewhere = createMemo(() => {
    const found = approval.data;
    if (!found || found.companyId === company().id) return null;
    return companies.data?.find((entry) => entry.id === found.companyId) ?? null;
  });

  const request = createMemo(() => {
    const found = approval.data;
    if (!found) return null;
    const first = tasks.data?.[0];
    return requestFromApproval(found, {
      youId: people.youId(),
      agentName: (id) => people.agent(id)?.name,
      personName: (id) => people.personName(id),
      task: first ? { id: first.id, identifier: first.identifier, title: first.title } : null,
    });
  });

  // The card refreshes the approval; once it's approved, the banner says so and points to what's next.
  const onSettled = () => setSearch({ resolved: "decided" }, { replace: true });

  return (
    <Switch>
      <Match when={elsewhere()}>{(other) => <Navigate href={`/${other().issuePrefix}/approvals/${params.approvalId}`} />}</Match>
      <Match when={approval.isError}>
        <PageHeader crumbs={<ApprovalsCrumb />} title="Approval" />
        <section class="card apv-note">
          <p>This approval couldn't be loaded: {(approval.error as Error).message}</p>
          <p>
            <A href={`/${company().issuePrefix}/inbox`}>Open the Inbox</A>
          </p>
        </section>
      </Match>
      <Match when={approval.isPending}>
        <PageHeader crumbs={<ApprovalsCrumb />} title="Approval" />
        <p class="card apv-note" role="status">
          Loading the approval…
        </p>
      </Match>
      <Match when={approval.data && request()}>
        <PageHeader
          crumbs={<ApprovalsCrumb />}
          title={approvalTitle(approval.data!)}
          numbers={
            <>
              <span class="apv-status">
                <Capsule gradient={approvalStatus(approval.data!.status).gradient} size="tiny" />
                {approvalStatus(approval.data!.status).label}
              </span>
              <span class="muted">Asked {stampLabel(approval.data!.createdAt)}</span>
              <Show when={approval.data!.decidedAt}>{(at) => <span class="muted">Decided {stampLabel(at())}</span>}</Show>
            </>
          }
        />
        <Show when={search.resolved && approval.data!.status === "approved"}>
          <ApprovedBanner approval={approval.data!} tasks={tasks.data ?? []} onDismiss={() => setSearch({ resolved: undefined }, { replace: true })} />
        </Show>
        <div class="apv-page">
          <div class="apv-main">
            <RequestCard request={request()!} taskId={tasks.data?.[0]?.id ?? ""} people={people} onSettled={onSettled} />
            <FollowUps approval={approval.data!} />
            <RawRequest approval={approval.data!} />
          </div>
          <aside class="apv-side">
            <LinkedTasks approval={approval.data!} tasks={tasks.data} loading={tasks.isPending} />
          </aside>
        </div>
      </Match>
    </Switch>
  );
}

function ApprovalsCrumb() {
  const company = useCompany();
  return <A href={`/${company().issuePrefix}/approvals/all`}>Approvals</A>;
}

function ApprovedBanner(props: { approval: Approval; tasks: { id: string; identifier: string | null }[]; onDismiss: () => void }) {
  const company = useCompany();
  const people = useTaskPeople();
  const next = () => {
    const agentId = hiredAgentId(props.approval);
    return afterApproval(props.approval, props.tasks, agentId ? people.agent(agentId)?.urlKey : null);
  };
  return (
    <section class="card apv-banner" role="status">
      <CircleCheck size={18} aria-hidden="true" />
      <div>
        <b>Approved</b>
        <p>The requesting agent was told to review this approval and its linked tasks.</p>
      </div>
      <A class={buttonClass({ size: "compact", variant: "primary" })} href={`/${company().issuePrefix}/${next().href}`}>
        {next().label}
      </A>
      <Button size="compact" variant="quiet" onClick={props.onDismiss}>
        Dismiss
      </Button>
    </section>
  );
}

/** Resubmit, delete a rejected hire, or the budget controls: whichever applies. */
function FollowUps(props: { approval: Approval }) {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const people = useTaskPeople();
  const follow = () => approvalFollowUps(props.approval);
  const [confirming, setConfirming] = createSignal(false);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["approvals", company().id] });
    void client.invalidateQueries({ queryKey: queryKeys.inbox.attention(company().id) });
    void client.invalidateQueries({ queryKey: queryKeys.agents.list(company().id) });
  };
  const resubmit = createMutation(() => ({
    mutationFn: () => approvalsApi.resubmit(props.approval.id),
    onSuccess: () => {
      refresh();
      pushToast({ tone: "success", title: "Marked as resubmitted", body: "It's back to waiting on a decision." });
    },
    onError: (error: Error) => pushToast({ tone: "error", title: "Couldn't mark it resubmitted", body: error.message }),
  }));
  const hireName = () => {
    const id = hiredAgentId(props.approval);
    return (id && people.agent(id)?.name) || (typeof props.approval.payload?.name === "string" ? props.approval.payload.name : "the agent");
  };
  const remove = async () => {
    try {
      await approvalsApi.removeAgent(hiredAgentId(props.approval)!);
      refresh();
      pushToast({ tone: "success", title: `Deleted ${hireName()}` });
      navigate(`/${company().issuePrefix}/inbox`);
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't delete ${hireName()}`, body: (error as Error).message });
    }
  };
  return (
    <Show when={follow().resubmit || follow().removeHire || follow().budget}>
      <section class="card apv-follow">
        <Show when={follow().resubmit}>
          <div class="apv-follow-row">
            <div>
              <b>Changes were requested</b>
              <p>The agent resubmits once it has made them. If it already has, or you've sorted it out together, mark it resubmitted.</p>
            </div>
            <Button size="compact" icon={<Undo2 size={14} aria-hidden="true" />} disabled={resubmit.isPending} onClick={() => resubmit.mutate()}>
              Mark resubmitted
            </Button>
          </div>
        </Show>
        <Show when={follow().removeHire}>
          <div class="apv-follow-row">
            <div>
              <b>The hire was rejected</b>
              <p>{hireName()} still exists as a pending agent that can't run. Delete it to tidy up.</p>
            </div>
            <Button size="compact" variant="danger" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setConfirming(true)}>
              Delete {hireName()}
            </Button>
          </div>
          <ConfirmDialog
            open={confirming()}
            onOpenChange={setConfirming}
            title={`Delete ${hireName()}?`}
            body="The agent the rejected hire created is deleted. This can't be undone."
            confirmLabel="Delete agent"
            danger
            onConfirm={remove}
          />
        </Show>
        <Show when={follow().budget}>
          <div class="apv-follow-row">
            <div>
              <b>A budget stop</b>
              <p>Raise the limit or keep the work paused from the budget controls; approving here doesn't lift it.</p>
            </div>
            <A class={buttonClass({ size: "compact" })} href={`/${company().issuePrefix}/company/settings/budgets`}>
              <Wallet size={14} aria-hidden="true" />
              Budget controls
            </A>
          </div>
        </Show>
      </section>
    </Show>
  );
}

function RawRequest(props: { approval: Approval }) {
  const [open, setOpen] = createSignal(false);
  return (
    <section class="card apv-raw">
      <button type="button" class="apv-raw-toggle" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <ChevronRight size={14} aria-hidden="true" class="apv-raw-caret" />
        The full request, as sent
        <span class="mono muted">{props.approval.type}</span>
      </button>
      <Show when={open()}>
        <pre class="apv-raw-body mono">{JSON.stringify(props.approval.payload ?? {}, null, 2)}</pre>
      </Show>
    </section>
  );
}

function LinkedTasks(props: { approval: Approval; tasks: { id: string; identifier: string | null; title: string; status: string }[] | undefined; loading: boolean }) {
  const company = useCompany();
  return (
    <section class="card apv-tasks" aria-labelledby="apv-tasks-h">
      <h2 id="apv-tasks-h" class="apv-h">
        Linked tasks
      </h2>
      <Show when={!props.loading} fallback={<p class="muted">Loading…</p>}>
        <Show when={(props.tasks ?? []).length > 0} fallback={<p class="muted">No tasks are linked to this approval.</p>}>
          <ul class="apv-task-list">
            <For each={props.tasks}>
              {(task) => (
                <li>
                  <A class="apv-task" href={`/${company().issuePrefix}/issues/${encodeURIComponent(task.identifier ?? task.id)}`}>
                    <Show when={task.status in STATUS_META} fallback={<Capsule gradient="ash" size="row" />}>
                      <StatusCapsule status={task.status as keyof typeof STATUS_META} size="row" />
                    </Show>
                    <span class="mono muted">{task.identifier ?? task.id.slice(0, 8)}</span>
                    <span class="apv-task-title">{task.title}</span>
                  </A>
                </li>
              )}
            </For>
          </ul>
          <p class="apv-hint">Linked tasks stay open until the requesting agent follows up and closes them.</p>
        </Show>
      </Show>
    </section>
  );
}
