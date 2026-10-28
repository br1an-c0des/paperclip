import type { ToolActionRequestListItem } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation } from "@tanstack/solid-query";
import { Check, ShieldQuestion, X } from "lucide-solid";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import { toolsApi } from "@/api/tools";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { agoLabel } from "@/runs/run-model";
import { Button } from "@/ui/Button";
import { Markdown } from "@/ui/Markdown";
import { pushToast } from "@/ui/Toast";
import { canAlwaysAllow, displayName, requestTitle } from "./apps-model";
import { failureText, usePendingRequests, useRefreshTools } from "./shared";

/*
 * Review (`/apps/review`, and a connection's Review tab): app calls an agent wants to make that
 * need your OK first (`GET tools/action-requests?status=pending`). Allow once approves this call;
 * Always allow also makes a trust rule, so the agent isn't asked again for that action on that
 * connection; Decline stops it. The old UI's ReviewQueueCard; a request tied to a task's thread
 * links to the task, where the Inbox shows it too.
 */

export function ReviewPage() {
  return (
    <section class="card ap-card" aria-labelledby="ap-review">
      <header class="chead">
        <h3 id="ap-review" class="disp">
          Waiting for your OK
        </h3>
        <p>Actions your agents want to run that ask you first. Allow once, always allow, or decline.</p>
      </header>
      <ReviewQueue />
    </section>
  );
}

/** The pending requests, all of them or one connection's. */
export function ReviewQueue(props: { connectionId?: string }) {
  const pending = usePendingRequests();
  const items = createMemo(() => {
    const all = pending.data?.actionRequests ?? [];
    return props.connectionId ? all.filter((item) => item.connectionId === props.connectionId) : all;
  });
  return (
    <Switch>
      <Match when={pending.isPending}>
        <p class="ap-empty" role="status">
          Loading requests…
        </p>
      </Match>
      <Match when={pending.isError}>
        <div class="ap-empty" role="alert">
          <p>Could not load requests: {(pending.error as Error).message}</p>
          <Button size="compact" onClick={() => void pending.refetch()}>
            Retry
          </Button>
        </div>
      </Match>
      <Match when={items().length === 0}>
        <p class="ap-empty">Nothing is waiting for your OK right now.</p>
      </Match>
      <Match when={true}>
        <ul class="ap-rows">
          <For each={items()}>{(item) => <ReviewRow item={item} />}</For>
        </ul>
      </Match>
    </Switch>
  );
}

function ReviewRow(props: { item: ToolActionRequestListItem }) {
  const company = useCompany();
  const agents = useAgentsQuery();
  const refresh = useRefreshTools();
  const title = () => requestTitle(props.item);
  const agentName = () => agents.data?.find((agent) => agent.id === props.item.requestedByAgentId)?.name ?? null;
  const preview = () => props.item.request.previewMarkdown?.trim() ?? "";

  const resolve = createMutation(() => ({
    mutationFn: (choice: "once" | "always" | "decline") =>
      choice === "decline"
        ? toolsApi.declineActionRequest(company().id, props.item.request.id)
        : toolsApi.approveActionRequest(company().id, props.item.request.id, choice === "always"),
    onSuccess: (_result, choice) => {
      const body =
        choice === "decline" ? `${title()} won't run.` : choice === "always" ? `${title()} won't ask again.` : `${title()} can run this time.`;
      pushToast({ title: choice === "decline" ? "Declined" : choice === "always" ? "Always allowed" : "Allowed once", body, tone: choice === "decline" ? "info" : "success" });
    },
    onError: (error) => pushToast({ title: "Couldn't save that", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => void refresh(),
  }));
  const busy = () => resolve.isPending;

  return (
    <li class="ap-request">
      <div class="ap-request-head">
        <ShieldQuestion size={16} aria-hidden="true" />
        <span class="ap-request-title">{title()}</span>
        <Show when={props.item.applicationName ?? props.item.connectionName}>
          {(app) => <span class="ap-row-meta">in {displayName(app())}</span>}
        </Show>
        <span class="ap-row-meta">
          · {agentName() ? `${agentName()} asked ` : "asked "}
          {agoLabel(props.item.request.createdAt)}
        </span>
      </div>
      <Show when={preview()} fallback={<p class="ap-request-body">An agent wants to run this action. Its connection asks you first.</p>}>
        <div class="ap-request-preview">
          <Markdown source={preview()} />
        </div>
      </Show>
      <Show when={canAlwaysAllow(props.item)}>
        <p class="ap-row-meta">
          Always allow lets this agent use this action with other arguments on this connection, within the current project when there is one.
        </p>
      </Show>
      <div class="ap-request-actions">
        <Button size="compact" variant="primary" disabled={busy()} icon={<Check size={14} aria-hidden="true" />} onClick={() => resolve.mutate("once")}>
          {busy() && resolve.variables === "once" ? "Allowing…" : "Allow once"}
        </Button>
        <Show when={canAlwaysAllow(props.item)}>
          <Button size="compact" disabled={busy()} onClick={() => resolve.mutate("always")}>
            {busy() && resolve.variables === "always" ? "Saving…" : "Always allow"}
          </Button>
        </Show>
        <Button size="compact" variant="quiet" disabled={busy()} icon={<X size={14} aria-hidden="true" />} onClick={() => resolve.mutate("decline")}>
          Decline
        </Button>
        <Show when={props.item.request.issueId}>
          {(issueId) => (
            <A class="ap-request-link" href={`/${company().issuePrefix}/issues/${issueId()}`}>
              Open the task
            </A>
          )}
        </Show>
      </div>
    </li>
  );
}
