import { A } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import { approvalsApi } from "@/api/approvals";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { approvalTitle } from "@/requests/request-model";
import { useTaskPeople } from "@/tasks/people";
import { stampLabel } from "@/tasks/thread-model";
import { HeaderNumber, PageHeader } from "@/ui/PageHeader";
import { Capsule } from "@/ui/Status";
import { approvalStatus, isOpenApproval, sortApprovals } from "./approval-model";
import "./Approvals.css";

/*
 * `/:prefix/approvals/all`: every approval in the company, a short history (the old Approvals page's
 * All tab). Open ones are answered in the Inbox, which `/approvals` and `/approvals/pending` open;
 * here they sit first, then the rest newest first. Each row opens the approval's page.
 */

export function ApprovalHistory() {
  const company = useCompany();
  const people = useTaskPeople();
  const list = createQuery(() => ({
    queryKey: queryKeys.approvals.list(company().id),
    queryFn: ({ signal }) => approvalsApi.list(company().id, undefined, signal),
  }));
  const rows = createMemo(() => sortApprovals(list.data ?? []));
  const open = () => rows().filter(isOpenApproval).length;
  const asker = (agentId: string | null, userId: string | null) => {
    if (agentId) return people.agent(agentId)?.name ?? "An agent";
    if (userId) return userId === people.youId() ? "You" : people.personName(userId);
    return "Someone";
  };
  return (
    <>
      <PageHeader
        crumbs={<span>{company().name}</span>}
        title="Approvals"
        numbers={
          <Show when={list.data}>
            <HeaderNumber value={open()} label="open" tone={open() > 0 ? "amber" : undefined} />
            <span class="muted">{rows().length} in all</span>
            <Show when={open() > 0}>
              <A class="apv-link" href={`/${company().issuePrefix}/inbox`}>Answer them in the Inbox</A>
            </Show>
          </Show>
        }
      />
      <section class="card apv-history">
        <Switch>
          <Match when={list.isPending}>
            <p class="muted" role="status">
              Loading approvals…
            </p>
          </Match>
          <Match when={list.isError}>
            <p role="alert">Couldn't load approvals: {(list.error as Error).message}</p>
          </Match>
          <Match when={rows().length === 0}>
            <p class="muted">No approvals yet. When an agent asks for one, it shows up in the Inbox.</p>
          </Match>
          <Match when={rows().length > 0}>
            <ul class="apv-rows">
              <For each={rows()}>
                {(approval) => (
                  <li>
                    <A class="apv-row" href={`/${company().issuePrefix}/approvals/${approval.id}`}>
                      <Capsule gradient={approvalStatus(approval.status).gradient} size="row" />
                      <span class="apv-row-title">{approvalTitle(approval)}</span>
                      <span class="apv-row-meta">
                        {approvalStatus(approval.status).label} · {asker(approval.requestedByAgentId, approval.requestedByUserId)} · {stampLabel(approval.createdAt)}
                      </span>
                    </A>
                  </li>
                )}
              </For>
            </ul>
          </Match>
        </Switch>
      </section>
    </>
  );
}
